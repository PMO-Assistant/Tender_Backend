const { getConnectedPool } = require('../../config/database');
const { downloadFile } = require('../../config/azureBlobService');
const { BlobServiceClient } = require('@azure/storage-blob');
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

/**
 * Create a new share link
 * POST /api/share
 */
async function createShareLink(req, res) {
  try {
    const { tenderId, packageId, packageName, duration, permissionLevel, description } = req.body;
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
    const tenderCheck = await pool.request()
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
        .input('AddBy', userId)
        .input('ExpiresAt', expiresAt)
        .input('PermissionLevel', permissionLevel)
        .input('Description', description || null)
        .query(`
          INSERT INTO tenderShareLink 
            (ShareToken, TenderID, PackageID, PackageName, AddBy, ExpiresAt, PermissionLevel, Description)
          OUTPUT INSERTED.ShareLinkID, INSERTED.ShareToken, INSERTED.ExpiresAt, INSERTED.CreatedAt
          VALUES (@ShareToken, @TenderID, @PackageID, @PackageName, @AddBy, @ExpiresAt, @PermissionLevel, @Description)
        `);

      const shareLink = result.recordset[0];
      const shareUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/share/${shareToken}`;

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
          permissionLevel,
          description
        }
      });
    } else {
      // Share all drawings (no specific package)
      const shareToken = generateShareToken();
      const expiresAt = calculateExpiration(duration);

      const result = await pool.request()
        .input('ShareToken', shareToken)
        .input('TenderID', parseInt(tenderId))
        .input('PackageID', null)
        .input('PackageName', null)
        .input('AddBy', userId)
        .input('ExpiresAt', expiresAt)
        .input('PermissionLevel', permissionLevel)
        .input('Description', description || null)
        .query(`
          INSERT INTO tenderShareLink 
            (ShareToken, TenderID, PackageID, PackageName, AddBy, ExpiresAt, PermissionLevel, Description)
          OUTPUT INSERTED.ShareLinkID, INSERTED.ShareToken, INSERTED.ExpiresAt, INSERTED.CreatedAt
          VALUES (@ShareToken, @TenderID, @PackageID, @PackageName, @AddBy, @ExpiresAt, @PermissionLevel, @Description)
        `);

      const shareLink = result.recordset[0];
      const shareUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/share/${shareToken}`;

      console.log(`[createShareLink] Created share link ${shareLink.ShareLinkID} for tender ${tenderId} (all packages)`);

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
    const tenderCheck = await pool.request()
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
      url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/share/${link.ShareToken}`,
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

    const result = await pool.request()
      .input('ShareToken', token)
      .query(`
        SELECT 
          ShareLinkID,
          ShareToken,
          TenderID,
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
        WHERE ShareToken = @ShareToken
      `);

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
        permissionLevel: shareLink.PermissionLevel,
        expiresAt: shareLink.ExpiresAt,
        description: shareLink.Description
      }
    });
  } catch (error) {
    console.error('[getShareLinkByToken] Error:', error);
    res.status(500).json({ error: 'Failed to get share link', details: error.message });
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

    // Get share link details
    const shareResult = await pool.request()
      .input('ShareToken', token)
      .query(`
        SELECT TenderID, PackageID, ExpiresAt, IsActive
        FROM tenderShareLink
        WHERE ShareToken = @ShareToken
      `);

    if (shareResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const shareLink = shareResult.recordset[0];

    // Check if expired
    if (new Date(shareLink.ExpiresAt) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    // Check if active
    if (!shareLink.IsActive) {
      return res.status(403).json({ error: 'Share link has been deactivated' });
    }

    // Get drawings for the tender and package (if specified)
    let query = `
      SELECT 
        d.DrawingID,
        d.DrawingNumber,
        d.Title,
        d.Description,
        d.Discipline,
        d.CurrentRevision,
        d.CreatedDate,
        f.FileID,
        f.DisplayName as FileName,
        f.ContentType,
        f.Size,
        f.UploadedOn
      FROM tenderDrawing d
      INNER JOIN tenderFile f ON d.FileID = f.FileID
      WHERE d.TenderID = @TenderID
        AND f.IsDeleted = 0
    `;

    if (shareLink.PackageID) {
      query += ` AND d.PackageID = @PackageID`;
    }

    query += ` ORDER BY d.DrawingNumber, d.CreatedDate DESC`;

    const request = pool.request()
      .input('TenderID', shareLink.TenderID);

    if (shareLink.PackageID) {
      request.input('PackageID', shareLink.PackageID);
    }

    const drawingsResult = await request.query(query);

    const drawings = drawingsResult.recordset.map(d => ({
      drawingId: d.DrawingID,
      drawingNumber: d.DrawingNumber,
      title: d.Title,
      description: d.Description,
      discipline: d.Discipline,
      currentRevision: d.CurrentRevision,
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
    res.status(500).json({ error: 'Failed to get shared drawings', details: error.message });
  }
}

/**
 * Download a file from a share link
 * GET /api/share/access/:token/download/:fileId
 */
async function downloadSharedFile(req, res) {
  try {
    const { token, fileId } = req.params;
    const pool = await getConnectedPool();

    // Get share link details
    const shareResult = await pool.request()
      .input('ShareToken', token)
      .query(`
        SELECT TenderID, PackageID, ExpiresAt, IsActive, PermissionLevel
        FROM tenderShareLink
        WHERE ShareToken = @ShareToken
      `);

    if (shareResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const shareLink = shareResult.recordset[0];

    // Check if expired
    if (new Date(shareLink.ExpiresAt) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    // Check if active
    if (!shareLink.IsActive) {
      return res.status(403).json({ error: 'Share link has been deactivated' });
    }

    // Check permission level
    if (shareLink.PermissionLevel !== 'download') {
      return res.status(403).json({ error: 'Download not allowed for this share link' });
    }

    // Verify file belongs to the shared tender and package (if specified)
    let fileQuery = `
      SELECT f.FileID, f.DisplayName, f.BlobPath, f.ContentType
      FROM tenderFile f
      INNER JOIN tenderDrawing d ON f.FileID = d.FileID
      WHERE f.FileID = @FileID
        AND d.TenderID = @TenderID
        AND f.IsDeleted = 0
    `;

    if (shareLink.PackageID) {
      fileQuery += ` AND d.PackageID = @PackageID`;
    }

    const request = pool.request()
      .input('FileID', parseInt(fileId))
      .input('TenderID', shareLink.TenderID);

    if (shareLink.PackageID) {
      request.input('PackageID', shareLink.PackageID);
    }

    const fileResult = await request.query(fileQuery);

    if (fileResult.recordset.length === 0) {
      return res.status(404).json({ error: 'File not found or not accessible through this share link' });
    }

    const file = fileResult.recordset[0];

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
      res.status(500).json({ error: 'Failed to download file', details: error.message });
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

    // Get share link details
    const shareResult = await pool.request()
      .input('ShareToken', token)
      .query(`
        SELECT TenderID, PackageID, ExpiresAt, IsActive, PermissionLevel
        FROM tenderShareLink
        WHERE ShareToken = @ShareToken
      `);

    if (shareResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const shareLink = shareResult.recordset[0];

    // Check if expired
    if (new Date(shareLink.ExpiresAt) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    // Check if active
    if (!shareLink.IsActive) {
      return res.status(403).json({ error: 'Share link has been deactivated' });
    }

    // Verify file belongs to the shared tender and package (if specified)
    let fileQuery = `
      SELECT f.FileID, f.DisplayName, f.BlobPath, f.ContentType
      FROM tenderFile f
      INNER JOIN tenderDrawing d ON f.FileID = d.FileID
      WHERE f.FileID = @FileID
        AND d.TenderID = @TenderID
        AND f.IsDeleted = 0
    `;

    if (shareLink.PackageID) {
      fileQuery += ` AND d.PackageID = @PackageID`;
    }

    const request = pool.request()
      .input('FileID', parseInt(fileId))
      .input('TenderID', shareLink.TenderID);

    if (shareLink.PackageID) {
      request.input('PackageID', shareLink.PackageID);
    }

    const fileResult = await request.query(fileQuery);

    if (fileResult.recordset.length === 0) {
      return res.status(404).json({ error: 'File not found or not accessible through this share link' });
    }

    const file = fileResult.recordset[0];

    // Generate SAS URL (read-only, expires in 1 hour)
    try {
      const account = process.env.AZURE_STORAGE_ACCOUNT_NAME;
      const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

      if (!account || !containerName) {
        console.error('[getSharedFileViewUrl] Azure Storage configuration missing');
        return res.status(500).json({ error: 'Azure Storage configuration missing' });
      }

      // Use DefaultAzureCredential for RBAC support
      const credential = new DefaultAzureCredential();
      const blobServiceClient = new BlobServiceClient(
        `https://${account}.blob.core.windows.net`,
        credential
      );
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
      return res.status(500).json({ error: 'Failed to generate view URL', details: sasError.message });
    }
  } catch (error) {
    console.error('[getSharedFileViewUrl] Error:', error);
    res.status(500).json({ error: 'Failed to get file view URL', details: error.message });
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

    // Get share link details
    const shareResult = await pool.request()
      .input('ShareToken', token)
      .query(`
        SELECT TenderID, PackageID, ExpiresAt, IsActive, PermissionLevel
        FROM tenderShareLink
        WHERE ShareToken = @ShareToken
      `);

    if (shareResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    const shareLink = shareResult.recordset[0];

    // Check if expired
    if (new Date(shareLink.ExpiresAt) < new Date()) {
      return res.status(410).json({ error: 'Share link has expired' });
    }

    // Check if active
    if (!shareLink.IsActive) {
      return res.status(403).json({ error: 'Share link has been deactivated' });
    }

    // Verify file belongs to the shared tender and package (if specified)
    let fileQuery = `
      SELECT f.FileID, f.DisplayName, f.BlobPath, f.ContentType
      FROM tenderFile f
      INNER JOIN tenderDrawing d ON f.FileID = d.FileID
      WHERE f.FileID = @FileID
        AND d.TenderID = @TenderID
        AND f.IsDeleted = 0
    `;

    if (shareLink.PackageID) {
      fileQuery += ` AND d.PackageID = @PackageID`;
    }

    const request = pool.request()
      .input('FileID', parseInt(fileId))
      .input('TenderID', shareLink.TenderID);

    if (shareLink.PackageID) {
      request.input('PackageID', shareLink.PackageID);
    }

    const fileResult = await request.query(fileQuery);

    if (fileResult.recordset.length === 0) {
      return res.status(404).json({ error: 'File not found or not accessible through this share link' });
    }

    const file = fileResult.recordset[0];

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
      res.status(500).json({ error: 'Failed to stream file', details: error.message });
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
  getSharedFileViewUrl,
  streamSharedFile
};

