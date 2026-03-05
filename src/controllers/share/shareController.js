const { getConnectedPool } = require('../../config/database');
const { downloadFile } = require('../../config/azureBlobService');
const archiver = require('archiver');
const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const crypto = require('crypto');
require('dotenv').config();

/**
 * Generate a secure random token for share links
 */
function generateShareToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Calculate expiration date based on duration
 */
function calculateExpiration(duration) {
  const now = new Date();
  switch (duration) {
    case '1h':
      return new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
    case '24h':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
    case '1w':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 1 week
    case '1m':
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 1 month
    default:
      throw new Error('Invalid duration');
  }
}

function getShareFrontendBaseUrl(req) {
  const envUrl = process.env.FRONTEND_URL || process.env.FRONTEND_URI;
  if (envUrl && String(envUrl).trim()) {
    return String(envUrl).replace(/\/+$/, '');
  }

  // Production-safe fallback for outbound share links.
  if (process.env.NODE_ENV === 'production') {
    return 'https://www.adcotenderinghub.ie';
  }

  return 'http://localhost:3000';
}

function parseIdArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((id) => parseInt(id, 10))
        .filter((id) => !isNaN(id))
    )
  );
}

async function listScopeFiles(pool, { tenderId, packageId = null, folderId = null, selectedFileIds = [] }) {
  const request = pool.request().input('TenderID', parseInt(tenderId, 10));
  let query = '';

  if (selectedFileIds.length > 0) {
    request.input('SelectedFileIDs', selectedFileIds.join(','));
    query = `
      SELECT f.FileID, f.DisplayName, f.FolderID
      FROM tenderFile f
      WHERE f.DocID = @TenderID
        AND f.FileID IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@SelectedFileIDs, ','))
        AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
      ORDER BY f.DisplayName
    `;
  } else if (folderId) {
    const rootFolderIds = await resolveFolderScopeIds(pool, parseInt(tenderId, 10), parseInt(folderId, 10));
    request.input('RootFolderIDs', rootFolderIds.join(','));
    query = `
      ;WITH RootFolders AS (
        SELECT TRY_CAST(value AS INT) AS FolderID
        FROM STRING_SPLIT(@RootFolderIDs, ',')
        WHERE TRY_CAST(value AS INT) IS NOT NULL
      ),
      FolderTree AS (
        SELECT f.FolderID
        FROM tenderFolder f
        INNER JOIN RootFolders rf ON rf.FolderID = f.FolderID
        WHERE (f.IsActive = 1 OR f.IsActive IS NULL)
        UNION ALL
        SELECT c.FolderID FROM tenderFolder c INNER JOIN FolderTree ft ON c.ParentFolderID = ft.FolderID WHERE (c.IsActive = 1 OR c.IsActive IS NULL)
      )
      SELECT DISTINCT f.FileID, f.DisplayName, f.FolderID
      FROM tenderFile f
      INNER JOIN FolderTree ft ON f.FolderID = ft.FolderID
      WHERE (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
      ORDER BY f.DisplayName
    `;
  } else {
    query = `
      SELECT DISTINCT f.FileID, f.DisplayName, f.FolderID
      FROM tenderDrawing d
      INNER JOIN tenderFile f ON d.FileID = f.FileID
      WHERE d.TenderID = @TenderID
        AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
    `;
    if (packageId) {
      query += ` AND d.PackageID = @PackageID`;
      request.input('PackageID', parseInt(packageId, 10));
    }
    query += ` ORDER BY f.DisplayName`;
  }

  const result = await request.query(query);
  return result.recordset.map((f) => ({
    fileId: f.FileID,
    fileName: f.DisplayName,
    folderId: f.FolderID || null
  }));
}

async function resolveFolderScopeIds(pool, tenderId, folderId) {
  const base = await pool.request()
    .input('FolderID', folderId)
    .query(`
      SELECT TOP 1 FolderID, FolderPath
      FROM tenderFolder
      WHERE FolderID = @FolderID
    `);

  if (base.recordset.length === 0) return [folderId];

  const folderPath = String(base.recordset[0].FolderPath || '').trim();
  if (!folderPath) return [folderId];

  const siblings = await pool.request()
    .input('DocID', parseInt(tenderId, 10))
    .input('FolderPath', folderPath)
    .query(`
      SELECT FolderID
      FROM tenderFolder
      WHERE DocID = @DocID
        AND FolderPath = @FolderPath
        AND (IsActive = 1 OR IsActive IS NULL)
    `);

  const ids = siblings.recordset
    .map((row) => parseInt(row.FolderID, 10))
    .filter((id) => !isNaN(id));

  return ids.length > 0 ? Array.from(new Set(ids)) : [folderId];
}

function sanitizeZipEntryName(name) {
  return String(name || 'file')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'file';
}

/**
 * Create a new share link
 * POST /api/share
 */
async function createShareLink(req, res) {
  try {
    const { tenderId, packageId, packageName, duration, permissionLevel, description, folderId, folderName, selectedFileIds } = req.body;
    const userId = req.user?.UserID;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!tenderId) {
      return res.status(400).json({ error: 'Tender ID is required' });
    }

    if (!duration || !['1h', '24h', '1w', '1m'].includes(duration)) {
      return res.status(400).json({ error: 'Invalid duration. Must be: 1h, 24h, 1w, or 1m' });
    }

    if (!permissionLevel || !['view', 'download'].includes(permissionLevel)) {
      return res.status(400).json({ error: 'Invalid permission level. Must be: view or download' });
    }

    const pool = await getConnectedPool();
    
    // Verify tender exists and user has access
    // Admin users can create share links for any tender.
    const tenderCheck = req.userPermissions?.Admin
      ? await pool.request()
          .input('TenderID', parseInt(tenderId))
          .query(`
            SELECT TenderID
            FROM tenderTender
            WHERE TenderID = @TenderID
          `)
      : await pool.request()
          .input('TenderID', parseInt(tenderId))
          .input('UserID', userId)
          .query(`
            SELECT TenderID 
            FROM tenderTender 
            WHERE TenderID = @TenderID 
              AND (AddBy = @UserID OR TenderID IN (
                SELECT TenderID FROM tenderTenderManaging WHERE UserID = @UserID
              ))
          `);

    if (tenderCheck.recordset.length === 0) {
      return res.status(403).json({ error: 'Access denied to this tender' });
    }

    // Ensure optional columns exist (idempotent)
    try {
      await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('tenderShareLink') AND name = 'FolderID')
          ALTER TABLE tenderShareLink ADD FolderID INT NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('tenderShareLink') AND name = 'FolderName')
          ALTER TABLE tenderShareLink ADD FolderName NVARCHAR(500) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('tenderShareLink') AND name = 'SelectedFileIDs')
          ALTER TABLE tenderShareLink ADD SelectedFileIDs NVARCHAR(MAX) NULL;
      `);
    } catch (migErr) {
      console.warn('[createShareLink] Column migration warning:', migErr.message);
    }

    const normalizedSelectedIds = parseIdArray(selectedFileIds);
    const selectedFileIdsCsv = normalizedSelectedIds.length > 0 ? normalizedSelectedIds.join(',') : null;

    // If packageId is provided, verify it exists and belongs to the tender
    if (packageId) {
      const packageCheck = await pool.request()
        .input('PackageID', parseInt(packageId))
        .input('TenderID', parseInt(tenderId))
        .query(`
          SELECT PackageID, PackageName 
          FROM tenderBoQPackages 
          WHERE PackageID = @PackageID AND TenderID = @TenderID
        `);

      if (packageCheck.recordset.length === 0) {
        return res.status(404).json({ error: 'Package not found' });
      }

      // Use the actual package name from database
      const actualPackageName = packageCheck.recordset[0].PackageName;
      
      // Generate token and calculate expiration
      const shareToken = generateShareToken();
      const expiresAt = calculateExpiration(duration);

      // Create share link
      const result = await pool.request()
        .input('ShareToken', shareToken)
        .input('TenderID', parseInt(tenderId))
        .input('PackageID', parseInt(packageId))
        .input('PackageName', actualPackageName)
        .input('FolderID', folderId ? parseInt(folderId) : null)
        .input('FolderName', folderName || null)
        .input('SelectedFileIDs', selectedFileIdsCsv || null)
        .input('AddBy', userId)
        .input('ExpiresAt', expiresAt)
        .input('PermissionLevel', permissionLevel)
        .input('Description', description || null)
        .query(`
          INSERT INTO tenderShareLink 
            (ShareToken, TenderID, PackageID, PackageName, FolderID, FolderName, SelectedFileIDs, AddBy, ExpiresAt, PermissionLevel, Description)
          OUTPUT INSERTED.ShareLinkID, INSERTED.ShareToken, INSERTED.ExpiresAt, INSERTED.CreatedAt
          VALUES (@ShareToken, @TenderID, @PackageID, @PackageName, @FolderID, @FolderName, @SelectedFileIDs, @AddBy, @ExpiresAt, @PermissionLevel, @Description)
        `);

      const shareLink = result.recordset[0];
      const shareUrl = `${getShareFrontendBaseUrl(req)}/share/${shareToken}`;

      const expectedFiles = await listScopeFiles(pool, {
        tenderId: parseInt(tenderId, 10),
        packageId: parseInt(packageId, 10),
        folderId: folderId ? parseInt(folderId, 10) : null,
        selectedFileIds: normalizedSelectedIds
      });

      const actualFiles = await listScopeFiles(pool, {
        tenderId: parseInt(tenderId, 10),
        packageId: parseInt(packageId, 10),
        folderId: folderId ? parseInt(folderId, 10) : null,
        selectedFileIds: normalizedSelectedIds
      });

      const actualFileIdSet = new Set(actualFiles.map((f) => f.fileId));
      const missingIds = normalizedSelectedIds.filter((id) => !actualFileIdSet.has(id));
      const noFilesResolved = expectedFiles.length === 0;

      if (missingIds.length > 0 || noFilesResolved) {
        await pool.request()
          .input('ShareLinkID', shareLink.ShareLinkID)
          .query(`UPDATE tenderShareLink SET IsActive = 0 WHERE ShareLinkID = @ShareLinkID`);

        console.error('[createShareLink] Handshake validation failed (package scope)', {
          tenderId: parseInt(tenderId, 10),
          packageId: parseInt(packageId, 10),
          folderId: folderId ? parseInt(folderId, 10) : null,
          selectedFileIds: normalizedSelectedIds,
          expectedFiles,
          actualFiles,
          missingIds,
          noFilesResolved
        });

        return res.status(422).json({
          error: 'Something went wrong while validating the shared files. Please contact IT.',
          details: {
            missingFileIds: missingIds,
            expectedCount: expectedFiles.length,
            actualCount: actualFiles.length,
            noFilesResolved
          }
        });
      }

      console.log(`[createShareLink] Created share link ${shareLink.ShareLinkID} for tender ${tenderId}, package ${packageId}`);

      return res.json({
        success: true,
        shareLink: {
          id: shareLink.ShareLinkID,
          token: shareLink.ShareToken,
          url: shareUrl,
          expiresAt: shareLink.ExpiresAt,
          createdAt: shareLink.CreatedAt,
          packageId: parseInt(packageId),
          packageName: actualPackageName,
          folderId: folderId ? parseInt(folderId) : null,
          folderName: folderName || null,
          selectedFileIds: normalizedSelectedIds,
          validation: {
            status: 'ok',
            expectedFiles,
            actualFiles
          },
          permissionLevel,
          description
        }
      });
    } else {
      const shareToken = generateShareToken();
      const expiresAt = calculateExpiration(duration);

      const result = await pool.request()
        .input('ShareToken', shareToken)
        .input('TenderID', parseInt(tenderId))
        .input('PackageID', null)
        .input('PackageName', null)
        .input('FolderID', folderId ? parseInt(folderId) : null)
        .input('FolderName', folderName || null)
        .input('SelectedFileIDs', selectedFileIdsCsv || null)
        .input('AddBy', userId)
        .input('ExpiresAt', expiresAt)
        .input('PermissionLevel', permissionLevel)
        .input('Description', description || null)
        .query(`
          INSERT INTO tenderShareLink 
            (ShareToken, TenderID, PackageID, PackageName, FolderID, FolderName, SelectedFileIDs, AddBy, ExpiresAt, PermissionLevel, Description)
          OUTPUT INSERTED.ShareLinkID, INSERTED.ShareToken, INSERTED.ExpiresAt, INSERTED.CreatedAt
          VALUES (@ShareToken, @TenderID, @PackageID, @PackageName, @FolderID, @FolderName, @SelectedFileIDs, @AddBy, @ExpiresAt, @PermissionLevel, @Description)
        `);

      const shareLink = result.recordset[0];
      const shareUrl = `${getShareFrontendBaseUrl(req)}/share/${shareToken}`;

      const expectedFiles = await listScopeFiles(pool, {
        tenderId: parseInt(tenderId, 10),
        packageId: null,
        folderId: folderId ? parseInt(folderId, 10) : null,
        selectedFileIds: normalizedSelectedIds
      });

      const actualFiles = await listScopeFiles(pool, {
        tenderId: parseInt(tenderId, 10),
        packageId: null,
        folderId: folderId ? parseInt(folderId, 10) : null,
        selectedFileIds: normalizedSelectedIds
      });

      const actualFileIdSet = new Set(actualFiles.map((f) => f.fileId));
      const missingIds = normalizedSelectedIds.filter((id) => !actualFileIdSet.has(id));
      const noFilesResolved = expectedFiles.length === 0;

      if (missingIds.length > 0 || noFilesResolved) {
        await pool.request()
          .input('ShareLinkID', shareLink.ShareLinkID)
          .query(`UPDATE tenderShareLink SET IsActive = 0 WHERE ShareLinkID = @ShareLinkID`);

        console.error('[createShareLink] Handshake validation failed (tender scope)', {
          tenderId: parseInt(tenderId, 10),
          folderId: folderId ? parseInt(folderId, 10) : null,
          selectedFileIds: normalizedSelectedIds,
          expectedFiles,
          actualFiles,
          missingIds,
          noFilesResolved
        });

        return res.status(422).json({
          error: 'Something went wrong while validating the shared files. Please contact IT.',
          details: {
            missingFileIds: missingIds,
            expectedCount: expectedFiles.length,
            actualCount: actualFiles.length,
            noFilesResolved
          }
        });
      }

      console.log(`[createShareLink] Created share link ${shareLink.ShareLinkID} for tender ${tenderId}, folder ${folderId || 'all'}`);

      return res.json({
        success: true,
        shareLink: {
          id: shareLink.ShareLinkID,
          token: shareLink.ShareToken,
          url: shareUrl,
          expiresAt: shareLink.ExpiresAt,
          createdAt: shareLink.CreatedAt,
          packageId: null,
          packageName: null,
          folderId: folderId ? parseInt(folderId) : null,
          folderName: folderName || null,
          selectedFileIds: normalizedSelectedIds,
          validation: {
            status: 'ok',
            expectedFiles,
            actualFiles
          },
          permissionLevel,
          description
        }
      });
    }
  } catch (error) {
    console.error('[createShareLink] Error:', error);
    res.status(500).json({ error: 'Failed to create share link', details: error.message });
  }
}

/**
 * Get all share links for a tender
 * GET /api/share/tender/:tenderId
 */
async function getShareLinksByTender(req, res) {
  try {
    const { tenderId } = req.params;
    const userId = req.user?.UserID;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const pool = await getConnectedPool();

    // Verify user has access to tender
    // Admin users can view share links for any tender.
    const tenderCheck = req.userPermissions?.Admin
      ? await pool.request()
          .input('TenderID', parseInt(tenderId))
          .query(`
            SELECT TenderID
            FROM tenderTender
            WHERE TenderID = @TenderID
          `)
      : await pool.request()
          .input('TenderID', parseInt(tenderId))
          .input('UserID', userId)
          .query(`
            SELECT TenderID 
            FROM tenderTender 
            WHERE TenderID = @TenderID 
              AND (AddBy = @UserID OR TenderID IN (
                SELECT TenderID FROM tenderTenderManaging WHERE UserID = @UserID
              ))
          `);

    if (tenderCheck.recordset.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get all share links for this tender
    const result = await pool.request()
      .input('TenderID', parseInt(tenderId))
      .query(`
        SELECT 
          ShareLinkID,
          ShareToken,
          PackageID,
          PackageName,
          AddBy,
          CreatedAt,
          ExpiresAt,
          PermissionLevel,
          IsActive,
          AccessCount,
          LastAccessedAt,
          Description
        FROM tenderShareLink
        WHERE TenderID = @TenderID
        ORDER BY CreatedAt DESC
      `);

    const shareLinks = result.recordset.map(link => ({
      id: link.ShareLinkID,
      token: link.ShareToken,
      url: `${(process.env.FRONTEND_URL || process.env.FRONTEND_URI || 'http://localhost:3000').replace(/\/+$/, '')}/share/${link.ShareToken}`,
      packageId: link.PackageID,
      packageName: link.PackageName,
      createdAt: link.CreatedAt,
      expiresAt: link.ExpiresAt,
      permissionLevel: link.PermissionLevel,
      isActive: link.IsActive,
      accessCount: link.AccessCount,
      lastAccessedAt: link.LastAccessedAt,
      description: link.Description,
      isExpired: new Date(link.ExpiresAt) < new Date()
    }));

    return res.json({
      success: true,
      shareLinks
    });
  } catch (error) {
    console.error('[getShareLinksByTender] Error:', error);
    res.status(500).json({ error: 'Failed to get share links', details: error.message });
  }
}

/**
 * Delete/deactivate a share link
 * DELETE /api/share/:shareLinkId
 */
async function deleteShareLink(req, res) {
  try {
    const { shareLinkId } = req.params;
    const userId = req.user?.UserID;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const pool = await getConnectedPool();

    // Verify user owns this share link
    const shareCheck = await pool.request()
      .input('ShareLinkID', parseInt(shareLinkId))
      .input('UserID', userId)
      .query(`
        SELECT ShareLinkID 
        FROM tenderShareLink 
        WHERE ShareLinkID = @ShareLinkID AND AddBy = @UserID
      `);

    if (shareCheck.recordset.length === 0) {
      return res.status(404).json({ error: 'Share link not found or access denied' });
    }

    // Deactivate the share link
    await pool.request()
      .input('ShareLinkID', parseInt(shareLinkId))
      .query(`
        UPDATE tenderShareLink 
        SET IsActive = 0 
        WHERE ShareLinkID = @ShareLinkID
      `);

    console.log(`[deleteShareLink] Deactivated share link ${shareLinkId}`);

    return res.json({
      success: true,
      message: 'Share link deactivated successfully'
    });
  } catch (error) {
    console.error('[deleteShareLink] Error:', error);
    res.status(500).json({ error: 'Failed to delete share link', details: error.message });
  }
}

/**
 * Get share link details by token (for accessing shared content)
 * GET /api/share/access/:token
 */
async function getShareLinkByToken(req, res) {
  try {
    const { token } = req.params;
    const pool = await getConnectedPool();

    let result;
    try {
      result = await pool.request()
        .input('ShareToken', token)
        .query(`
          SELECT 
            ShareLinkID, ShareToken, TenderID, PackageID, PackageName,
            FolderID, FolderName, SelectedFileIDs,
            AddBy, CreatedAt, ExpiresAt, PermissionLevel, IsActive,
            AccessCount, LastAccessedAt, Description
          FROM tenderShareLink
          WHERE ShareToken = @ShareToken
        `);
    } catch (colErr) {
      result = await pool.request()
        .input('ShareToken', token)
        .query(`
          SELECT 
            ShareLinkID, ShareToken, TenderID, PackageID, PackageName,
            AddBy, CreatedAt, ExpiresAt, PermissionLevel, IsActive,
            AccessCount, LastAccessedAt, Description
          FROM tenderShareLink
          WHERE ShareToken = @ShareToken
        `);
    }

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const shareLink = result.recordset[0];

    // Check if expired
    if (new Date(shareLink.ExpiresAt) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    // Check if active
    if (!shareLink.IsActive) {
      return res.status(403).json({ error: 'Share link has been deactivated' });
    }

    // Update access count and last accessed
    await pool.request()
      .input('ShareLinkID', shareLink.ShareLinkID)
      .query(`
        UPDATE tenderShareLink 
        SET AccessCount = AccessCount + 1,
            LastAccessedAt = GETUTCDATE()
        WHERE ShareLinkID = @ShareLinkID
      `);

    return res.json({
      success: true,
      shareLink: {
        id: shareLink.ShareLinkID,
        tenderId: shareLink.TenderID,
        packageId: shareLink.PackageID,
        packageName: shareLink.PackageName,
        folderId: shareLink.FolderID || null,
        folderName: shareLink.FolderName || null,
        selectedFileIds: String(shareLink.SelectedFileIDs || '')
          .split(',')
          .map((v) => parseInt(v, 10))
          .filter((v) => !isNaN(v)),
        permissionLevel: shareLink.PermissionLevel,
        expiresAt: shareLink.ExpiresAt,
        description: shareLink.Description
      }
    });
  } catch (error) {
    console.error('[getShareLinkByToken] Error:', error);
    res.status(500).json({ error: 'Failed to get share link' });
  }
}

/**
 * Get drawings/files for a share link
 * GET /api/share/access/:token/drawings
 */
async function getSharedDrawings(req, res) {
  try {
    const { token } = req.params;
    const pool = await getConnectedPool();

    // Get share link details (include FolderID if column exists)
    let shareResult;
    try {
      shareResult = await pool.request()
        .input('ShareToken', token)
        .query(`
          SELECT TenderID, PackageID, ExpiresAt, IsActive, FolderID, SelectedFileIDs
          FROM tenderShareLink
          WHERE ShareToken = @ShareToken
        `);
    } catch (colErr) {
      // FolderID column may not exist yet
      shareResult = await pool.request()
        .input('ShareToken', token)
        .query(`
          SELECT TenderID, PackageID, ExpiresAt, IsActive
          FROM tenderShareLink
          WHERE ShareToken = @ShareToken
        `);
    }

    if (shareResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const shareLink = shareResult.recordset[0];

    if (new Date(shareLink.ExpiresAt) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    if (!shareLink.IsActive) {
      return res.status(403).json({ error: 'Share link has been deactivated' });
    }

    // Build query — filter by folder (recursive) if FolderID is set
    let query;
    const request = pool.request().input('TenderID', shareLink.TenderID);

    const selectedIds = String(shareLink.SelectedFileIDs || '')
      .split(',')
      .map((v) => parseInt(v, 10))
      .filter((v) => !isNaN(v));

    if (selectedIds.length > 0) {
      request.input('SelectedFileIDs', selectedIds.join(','));
      query = `
        SELECT
          d.DrawingID, d.DrawingNumber, d.Title, d.Description, d.Discipline,
          d.CurrentRevision, d.CreatedDate,
          f.FileID, f.DisplayName as FileName, f.ContentType, f.Size, f.UploadedOn
        FROM tenderFile f
        LEFT JOIN tenderDrawing d ON d.FileID = f.FileID AND d.TenderID = @TenderID
        WHERE f.DocID = @TenderID
          AND f.FileID IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@SelectedFileIDs, ','))
          AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
        ORDER BY COALESCE(d.DrawingNumber, f.DisplayName), f.UploadedOn DESC
      `;
    } else if (shareLink.FolderID) {
      // Use CTE to get all files in the folder and its subfolders, then join to drawings
      const rootFolderIds = await resolveFolderScopeIds(pool, parseInt(shareLink.TenderID, 10), parseInt(shareLink.FolderID, 10));
      request.input('RootFolderIDs', rootFolderIds.join(','));
      query = `
        ;WITH RootFolders AS (
          SELECT TRY_CAST(value AS INT) AS FolderID
          FROM STRING_SPLIT(@RootFolderIDs, ',')
          WHERE TRY_CAST(value AS INT) IS NOT NULL
        ),
        FolderTree AS (
          SELECT f.FolderID
          FROM tenderFolder f
          INNER JOIN RootFolders rf ON rf.FolderID = f.FolderID
          WHERE (f.IsActive = 1 OR f.IsActive IS NULL)
          UNION ALL
          SELECT c.FolderID FROM tenderFolder c INNER JOIN FolderTree ft ON c.ParentFolderID = ft.FolderID WHERE (c.IsActive = 1 OR c.IsActive IS NULL)
        )
        SELECT
          d.DrawingID, d.DrawingNumber, d.Title, d.Description, d.Discipline,
          d.CurrentRevision, d.CreatedDate,
          f.FileID, f.DisplayName as FileName, f.ContentType, f.Size, f.UploadedOn
        FROM tenderFile f
        INNER JOIN FolderTree ft ON f.FolderID = ft.FolderID
        LEFT JOIN tenderDrawing d ON d.FileID = f.FileID AND d.TenderID = @TenderID
        WHERE (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
        ORDER BY f.DisplayName, f.UploadedOn DESC
      `;
    } else {
      query = `
        SELECT 
          d.DrawingID, d.DrawingNumber, d.Title, d.Description, d.Discipline,
          d.CurrentRevision, d.CreatedDate,
          f.FileID, f.DisplayName as FileName, f.ContentType, f.Size, f.UploadedOn
        FROM tenderDrawing d
        INNER JOIN tenderFile f ON d.FileID = f.FileID
        WHERE d.TenderID = @TenderID AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
      `;

      if (shareLink.PackageID) {
        query += ` AND d.PackageID = @PackageID`;
        request.input('PackageID', shareLink.PackageID);
      }

      query += ` ORDER BY d.DrawingNumber, d.CreatedDate DESC`;
    }

    const drawingsResult = await request.query(query);

    const drawings = drawingsResult.recordset.map(d => ({
      drawingId: d.DrawingID || null,
      drawingNumber: d.DrawingNumber || null,
      title: d.Title || d.FileName || null,
      description: d.Description || null,
      discipline: d.Discipline || null,
      currentRevision: d.CurrentRevision || null,
      fileId: d.FileID,
      fileName: d.FileName,
      contentType: d.ContentType,
      size: d.Size,
      uploadedOn: d.UploadedOn
    }));

    return res.json({
      success: true,
      drawings
    });
  } catch (error) {
    console.error('[getSharedDrawings] Error:', error);
    res.status(500).json({ error: 'Failed to get shared drawings' });
  }
}

/**
 * Resolve a share link and verify a file belongs to it.
 * Returns { shareLink, file } or sends an error response.
 */
async function resolveShareFile(pool, token, fileId, res, requireDownload = false, requireRawRead = false) {
  let shareResult;
  try {
    shareResult = await pool.request()
      .input('ShareToken', token)
      .query(`SELECT TenderID, PackageID, FolderID, SelectedFileIDs, ExpiresAt, IsActive, PermissionLevel FROM tenderShareLink WHERE ShareToken = @ShareToken`);
  } catch (_) {
    shareResult = await pool.request()
      .input('ShareToken', token)
      .query(`SELECT TenderID, PackageID, ExpiresAt, IsActive, PermissionLevel FROM tenderShareLink WHERE ShareToken = @ShareToken`);
  }

  if (shareResult.recordset.length === 0) { res.status(404).json({ error: 'Share link not found' }); return null; }
  const shareLink = shareResult.recordset[0];

  if (new Date(shareLink.ExpiresAt) < new Date()) { res.status(410).json({ error: 'Share link has expired' }); return null; }
  if (!shareLink.IsActive) { res.status(403).json({ error: 'Share link has been deactivated' }); return null; }
  if (requireDownload && shareLink.PermissionLevel !== 'download') { res.status(403).json({ error: 'Download not allowed for this share link' }); return null; }
  if (requireRawRead && shareLink.PermissionLevel !== 'download') { res.status(403).json({ error: 'File access is restricted for this share link' }); return null; }

  const request = pool.request().input('FileID', parseInt(fileId));
  const selectedIds = String(shareLink.SelectedFileIDs || '')
    .split(',')
    .map((v) => parseInt(v, 10))
    .filter((v) => !isNaN(v));

  let fileQuery;
  if (selectedIds.length > 0) {
    request.input('TenderID', shareLink.TenderID);
    request.input('SelectedFileIDs', selectedIds.join(','));
    fileQuery = `
      SELECT f.FileID, f.DisplayName, f.BlobPath, f.ContentType
      FROM tenderFile f
      WHERE f.FileID = @FileID
        AND f.DocID = @TenderID
        AND f.FileID IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@SelectedFileIDs, ','))
        AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
    `;
  } else if (shareLink.FolderID) {
    const rootFolderIds = await resolveFolderScopeIds(pool, parseInt(shareLink.TenderID, 10), parseInt(shareLink.FolderID, 10));
    request.input('RootFolderIDs', rootFolderIds.join(','));
    fileQuery = `
      ;WITH RootFolders AS (
        SELECT TRY_CAST(value AS INT) AS FolderID
        FROM STRING_SPLIT(@RootFolderIDs, ',')
        WHERE TRY_CAST(value AS INT) IS NOT NULL
      ),
      FolderTree AS (
        SELECT f.FolderID
        FROM tenderFolder f
        INNER JOIN RootFolders rf ON rf.FolderID = f.FolderID
        WHERE (f.IsActive = 1 OR f.IsActive IS NULL)
        UNION ALL
        SELECT c.FolderID FROM tenderFolder c INNER JOIN FolderTree ft ON c.ParentFolderID = ft.FolderID WHERE (c.IsActive = 1 OR c.IsActive IS NULL)
      )
      SELECT f.FileID, f.DisplayName, f.BlobPath, f.ContentType
      FROM tenderFile f
      INNER JOIN FolderTree ft ON f.FolderID = ft.FolderID
      WHERE f.FileID = @FileID AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
    `;
  } else {
    request.input('TenderID', shareLink.TenderID);
    fileQuery = `
      SELECT f.FileID, f.DisplayName, f.BlobPath, f.ContentType
      FROM tenderFile f
      INNER JOIN tenderDrawing d ON f.FileID = d.FileID
      WHERE f.FileID = @FileID AND d.TenderID = @TenderID AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
    `;
    if (shareLink.PackageID) {
      fileQuery += ` AND d.PackageID = @PackageID`;
      request.input('PackageID', shareLink.PackageID);
    }
  }

  const fileResult = await request.query(fileQuery);
  if (fileResult.recordset.length === 0) { res.status(404).json({ error: 'File not found or not accessible through this share link' }); return null; }

  return { shareLink, file: fileResult.recordset[0] };
}

/**
 * Download a file from a share link
 * GET /api/share/access/:token/download/:fileId
 */
async function downloadSharedFile(req, res) {
  try {
    const { token, fileId } = req.params;
    const pool = await getConnectedPool();

    const resolved = await resolveShareFile(pool, token, fileId, res, true);
    if (!resolved) return;
    const { file } = resolved;

    // Download from Azure Blob Storage
    const stream = await downloadFile(file.BlobPath);

    if (!stream) {
      return res.status(500).json({ error: 'Failed to get file stream' });
    }

    // Set response headers
    res.setHeader('Content-Type', file.ContentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.DisplayName}"`);

    // Pipe the stream to response
    stream.pipe(res);

    console.log(`[downloadSharedFile] Downloaded file ${fileId} via share token ${token}`);
  } catch (error) {
    console.error('[downloadSharedFile] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download file' });
    }
  }
}

/**
 * Get SAS URL for viewing a file (for view-only shares)
 * GET /api/share/access/:token/view/:fileId
 */
async function getSharedFileViewUrl(req, res) {
  try {
    const { token, fileId } = req.params;
    const pool = await getConnectedPool();

    const resolved = await resolveShareFile(pool, token, fileId, res, false, true);
    if (!resolved) return;
    const { file } = resolved;

    // Generate SAS URL (read-only, expires in 1 hour)
    try {
      const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
      const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
      const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

      if (!account || !containerName) {
        console.error('[getSharedFileViewUrl] Azure Storage configuration missing');
        return res.status(500).json({ error: 'Azure Storage configuration missing' });
      }

      // Use account key by default (works on Heroku), use RBAC only if explicitly enabled
      let blobServiceClient;
      if (process.env.AZURE_USE_RBAC === 'true' && !accountKey) {
        const credential = new DefaultAzureCredential();
        blobServiceClient = new BlobServiceClient(
          `https://${account}.blob.core.windows.net`,
          credential
        );
      } else {
        if (!accountKey) {
          return res.status(500).json({ error: 'AZURE_STORAGE_ACCOUNT_KEY is required when AZURE_USE_RBAC is not enabled' });
        }
        const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey);
        blobServiceClient = new BlobServiceClient(
          `https://${account}.blob.core.windows.net`,
          sharedKeyCredential
        );
      }
      const containerClient = blobServiceClient.getContainerClient(containerName);
      const blobClient = containerClient.getBlobClient(file.BlobPath);

      // Check if blob exists
      const exists = await blobClient.exists();
      if (!exists) {
        console.error('[getSharedFileViewUrl] Blob not found:', file.BlobPath);
        return res.status(404).json({ error: 'File not found in storage' });
      }

      // Generate SAS URL with 1 hour expiry using the blobClient method (same as fileController)
      const sasUrl = await blobClient.generateSasUrl({
        permissions: 'r', // Read only
        expiresOn: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        protocol: 'https'
      });

      console.log('[getSharedFileViewUrl] SAS URL generated successfully for file:', file.DisplayName);
      
      return res.json({
        success: true,
        sasUrl: sasUrl,
        fileName: file.DisplayName,
        contentType: file.ContentType
      });
    } catch (sasError) {
      console.error('[getSharedFileViewUrl] Error generating SAS URL:', sasError);
      return res.status(500).json({ error: 'Failed to generate view URL' });
    }
  } catch (error) {
    console.error('[getSharedFileViewUrl] Error:', error);
    res.status(500).json({ error: 'Failed to get file view URL' });
  }
}

/**
 * Stream a file directly for viewing (fallback if SAS URL generation fails)
 * GET /api/share/access/:token/stream/:fileId
 */
async function streamSharedFile(req, res) {
  try {
    const { token, fileId } = req.params;
    const pool = await getConnectedPool();

    const resolved = await resolveShareFile(pool, token, fileId, res, false, true);
    if (!resolved) return;
    const { file } = resolved;

    // Stream file directly from Azure Blob Storage
    const stream = await downloadFile(file.BlobPath);

    if (!stream) {
      return res.status(500).json({ error: 'Failed to get file stream' });
    }

    // Set response headers for inline viewing
    res.setHeader('Content-Type', file.ContentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${file.DisplayName}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600'); // Cache for 1 hour

    // Pipe the stream to response
    stream.pipe(res);

    console.log(`[streamSharedFile] Streaming file ${fileId} via share token ${token}`);
  } catch (error) {
    console.error('[streamSharedFile] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream file' });
    }
  }
}

/**
 * Download all files for a share link as ZIP
 * GET /api/share/access/:token/download-all
 */
async function downloadAllSharedFiles(req, res) {
  try {
    const { token } = req.params;
    const pool = await getConnectedPool();

    let shareResult;
    try {
      shareResult = await pool.request()
        .input('ShareToken', token)
        .query(`SELECT TenderID, PackageID, FolderID, SelectedFileIDs, ExpiresAt, IsActive, PermissionLevel FROM tenderShareLink WHERE ShareToken = @ShareToken`);
    } catch (_) {
      shareResult = await pool.request()
        .input('ShareToken', token)
        .query(`SELECT TenderID, PackageID, ExpiresAt, IsActive, PermissionLevel FROM tenderShareLink WHERE ShareToken = @ShareToken`);
    }

    if (shareResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const shareLink = shareResult.recordset[0];
    if (new Date(shareLink.ExpiresAt) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }
    if (!shareLink.IsActive) {
      return res.status(403).json({ error: 'Share link has been deactivated' });
    }
    if (shareLink.PermissionLevel !== 'download') {
      return res.status(403).json({ error: 'Download not allowed for this share link' });
    }

    const request = pool.request().input('TenderID', shareLink.TenderID);
    const selectedIds = String(shareLink.SelectedFileIDs || '')
      .split(',')
      .map((v) => parseInt(v, 10))
      .filter((v) => !isNaN(v));

    let query;
    if (selectedIds.length > 0) {
      request.input('SelectedFileIDs', selectedIds.join(','));
      query = `
        SELECT DISTINCT f.FileID, f.DisplayName, f.BlobPath
        FROM tenderFile f
        WHERE f.DocID = @TenderID
          AND f.FileID IN (SELECT TRY_CAST(value AS INT) FROM STRING_SPLIT(@SelectedFileIDs, ','))
          AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
        ORDER BY f.DisplayName
      `;
    } else if (shareLink.FolderID) {
      const rootFolderIds = await resolveFolderScopeIds(pool, parseInt(shareLink.TenderID, 10), parseInt(shareLink.FolderID, 10));
      request.input('RootFolderIDs', rootFolderIds.join(','));
      query = `
        ;WITH RootFolders AS (
          SELECT TRY_CAST(value AS INT) AS FolderID
          FROM STRING_SPLIT(@RootFolderIDs, ',')
          WHERE TRY_CAST(value AS INT) IS NOT NULL
        ),
        FolderTree AS (
          SELECT f.FolderID
          FROM tenderFolder f
          INNER JOIN RootFolders rf ON rf.FolderID = f.FolderID
          WHERE (f.IsActive = 1 OR f.IsActive IS NULL)
          UNION ALL
          SELECT c.FolderID FROM tenderFolder c INNER JOIN FolderTree ft ON c.ParentFolderID = ft.FolderID WHERE (c.IsActive = 1 OR c.IsActive IS NULL)
        )
        SELECT DISTINCT f.FileID, f.DisplayName, f.BlobPath
        FROM tenderFile f
        INNER JOIN FolderTree ft ON f.FolderID = ft.FolderID
        WHERE (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
        ORDER BY f.DisplayName
      `;
    } else {
      query = `
        SELECT DISTINCT f.FileID, f.DisplayName, f.BlobPath
        FROM tenderDrawing d
        INNER JOIN tenderFile f ON d.FileID = f.FileID
        WHERE d.TenderID = @TenderID
          AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
      `;
      if (shareLink.PackageID) {
        query += ` AND d.PackageID = @PackageID`;
        request.input('PackageID', shareLink.PackageID);
      }
      query += ` ORDER BY f.DisplayName`;
    }

    const fileResult = await request.query(query);
    const files = fileResult.recordset || [];
    if (files.length === 0) {
      return res.status(404).json({ error: 'No files available for this share link' });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="shared-files-${timestamp}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[downloadAllSharedFiles] Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to prepare zip download' });
      } else {
        res.end();
      }
    });
    archive.pipe(res);

    const usedNames = new Set();
    for (const file of files) {
      if (!file.BlobPath) continue;
      const baseName = sanitizeZipEntryName(file.DisplayName || `file-${file.FileID}`);
      let entryName = baseName;
      let i = 1;
      while (usedNames.has(entryName.toLowerCase())) {
        const dot = baseName.lastIndexOf('.');
        if (dot > 0) {
          entryName = `${baseName.slice(0, dot)} (${i})${baseName.slice(dot)}`;
        } else {
          entryName = `${baseName} (${i})`;
        }
        i += 1;
      }
      usedNames.add(entryName.toLowerCase());

      try {
        const stream = await downloadFile(file.BlobPath);
        if (stream) {
          archive.append(stream, { name: entryName });
        }
      } catch (fileErr) {
        console.warn(`[downloadAllSharedFiles] Skipping file ${file.FileID}:`, fileErr.message);
      }
    }

    await archive.finalize();
    console.log(`[downloadAllSharedFiles] Downloaded ${files.length} files via share token ${token}`);
  } catch (error) {
    console.error('[downloadAllSharedFiles] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download all files' });
    }
  }
}

module.exports = {
  createShareLink,
  getShareLinksByTender,
  deleteShareLink,
  getShareLinkByToken,
  getSharedDrawings,
  downloadSharedFile,
  downloadAllSharedFiles,
  getSharedFileViewUrl,
  streamSharedFile
};

