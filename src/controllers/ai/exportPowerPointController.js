const PptxGenJS = require('pptxgenjs');
const { getConnectedPool } = require('../../config/database');
const { BlobServiceClient } = require('@azure/storage-blob');

// ADCO brand colors
const ADCO_COLORS = {
  yellow: '#FDCC09',
  dark: '#2b2b2b',
  white: '#FFFFFF'
};

/**
 * Convert pixel coordinates to PowerPoint EMU (English Metric Units)
 * PowerPoint uses EMU where 1 inch = 914400 EMU
 * At 96 DPI: 1 pixel = 914400 / 96 = 9525 EMU
 */
function pixelsToEmu(pixels) {
  return Math.round(pixels * 9525);
}

/**
 * Convert hex color to PowerPoint color format
 */
function hexToPowerPointColor(hex) {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // If it's an ADCO color, use exact value
  if (hex.toUpperCase() === 'FDCC09') return ADCO_COLORS.yellow;
  if (hex.toUpperCase() === '2B2B2B') return ADCO_COLORS.dark;
  if (hex.toUpperCase() === 'FFFFFF' || hex.toUpperCase() === 'FFF') return ADCO_COLORS.white;
  
  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  return { r, g, b, type: 'srgb' };
}

/**
 * Normalize color to ADCO palette
 */
function normalizeToAdcoColor(color) {
  if (!color || !color.startsWith('#')) return ADCO_COLORS.white;
  
  const hex = color.replace('#', '').toUpperCase();
  
  // Check if it's close to ADCO colors
  if (hex === 'FDCC09' || hex === 'FDC009') return ADCO_COLORS.yellow;
  if (hex === '2B2B2B' || hex === '2B2B2B') return ADCO_COLORS.dark;
  if (hex === 'FFFFFF' || hex === 'FFF') return ADCO_COLORS.white;
  
  // Default to white
  return ADCO_COLORS.white;
}

/**
 * Export presentation to PowerPoint format
 */
async function exportPowerPoint(req, res) {
  try {
    const { presentation, tenderId } = req.body;

    if (!presentation || !presentation.slides || presentation.slides.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No presentation data provided'
      });
    }

    console.log(`📤 Exporting presentation "${presentation.title}" with ${presentation.slides.length} slides`);

    // Create new PowerPoint presentation
    const pptx = new PptxGenJS();
    
    // Set presentation properties
    pptx.author = 'ADCO';
    pptx.company = 'ADCO';
    pptx.title = presentation.title || 'Untitled Presentation';
    pptx.layout = 'LAYOUT_WIDE'; // 16:9 aspect ratio
    
    // PowerPoint slide dimensions (16:9)
    const SLIDE_WIDTH = 10; // inches
    const SLIDE_HEIGHT = 5.625; // inches
    const CANVAS_WIDTH = 1920; // pixels
    const CANVAS_HEIGHT = 1080; // pixels
    
    // Scale factor: canvas pixels to PowerPoint inches
    const scaleX = SLIDE_WIDTH / CANVAS_WIDTH;
    const scaleY = SLIDE_HEIGHT / CANVAS_HEIGHT;

    // Process each slide
    for (const slideData of presentation.slides) {
      const slide = pptx.addSlide();
      
      // Set slide background (always white for ADCO)
      slide.background = { color: ADCO_COLORS.white };

      // Sort elements by zIndex to maintain layer order
      const sortedElements = [...slideData.elements].sort((a, b) => 
        (a.zIndex || 0) - (b.zIndex || 0)
      );

      // Process each element
      for (const element of sortedElements) {
        // Convert coordinates from canvas (1920x1080) to PowerPoint (10" x 5.625")
        const x = (element.x / CANVAS_WIDTH) * SLIDE_WIDTH;
        const y = (element.y / CANVAS_HEIGHT) * SLIDE_HEIGHT;
        const width = (element.width / CANVAS_WIDTH) * SLIDE_WIDTH;
        const height = (element.height / CANVAS_HEIGHT) * SLIDE_HEIGHT;

        try {
          switch (element.type) {
            case 'text':
              slide.addText(element.content || '', {
                x: x,
                y: y,
                w: width,
                h: height,
                fontSize: element.fontSize || 18,
                fontFace: element.fontFamily || 'Arial',
                color: hexToPowerPointColor(normalizeToAdcoColor(element.color)),
                bold: element.fontWeight === 'bold' || element.fontWeight === '700',
                italic: element.fontStyle === 'italic',
                underline: element.textDecoration === 'underline',
                align: element.textAlign || 'left',
                valign: 'top',
                rot: element.rotation || 0,
                opacity: element.opacity !== undefined ? element.opacity : 1,
              });
              break;

            case 'shape':
              const shapeColor = normalizeToAdcoColor(element.fillColor);
              const strokeColor = normalizeToAdcoColor(element.strokeColor);
              
              // Map shape types to pptxgenjs shape types
              let shapeType = pptx.ShapeType.rect;
              if (element.shapeType === 'circle') shapeType = pptx.ShapeType.ellipse;
              else if (element.shapeType === 'triangle') shapeType = pptx.ShapeType.triangle;
              else if (element.shapeType === 'line') shapeType = pptx.ShapeType.line;
              
              slide.addShape(shapeType, {
                x: x,
                y: y,
                w: width,
                h: height,
                fill: { color: hexToPowerPointColor(shapeColor) },
                line: { 
                  color: hexToPowerPointColor(strokeColor),
                  width: element.strokeWidth || 1
                },
                rot: element.rotation || 0,
                opacity: element.opacity !== undefined ? element.opacity : 1,
              });
              break;

            case 'image':
              // For images, we need to handle base64 or URLs
              // If it's a base64 data URL, extract the data
              let imageData = element.src;
              if (element.src.startsWith('data:')) {
                // Already a data URL
                imageData = element.src;
              } else if (element.src.startsWith('http://') || element.src.startsWith('https://')) {
                // URL - pptxgenjs can handle URLs directly
                imageData = element.src;
              } else {
                // Assume it's a relative path or blob URL - skip for now
                console.warn(`Skipping image with src: ${element.src}`);
                continue;
              }
              
              try {
                slide.addImage({
                  path: imageData,
                  x: x,
                  y: y,
                  w: width,
                  h: height,
                  rot: element.rotation || 0,
                  opacity: element.opacity !== undefined ? element.opacity : 1,
                });
              } catch (imgError) {
                console.warn(`Failed to add image: ${imgError.message}`);
                // Add a placeholder shape instead
                slide.addShape(pptx.ShapeType.rect, {
                  x: x,
                  y: y,
                  w: width,
                  h: height,
                  fill: { color: ADCO_COLORS.yellow },
                  line: { color: ADCO_COLORS.dark, width: 2 },
                });
                slide.addText(`[Image: ${element.alt || 'Placeholder'}]`, {
                  x: x,
                  y: y,
                  w: width,
                  h: height,
                  fontSize: 12,
                  color: ADCO_COLORS.dark,
                  align: 'center',
                  valign: 'middle',
                });
              }
              break;

            case 'table':
              // Convert cellData array to pptxgenjs table format
              const tableRows = element.cellData || [];
              
              if (tableRows.length > 0 && tableRows[0].length > 0) {
                slide.addTable(tableRows, {
                  x: x,
                  y: y,
                  w: width,
                  h: height,
                  colW: Array(element.columns).fill(width / element.columns),
                  border: { 
                    type: 'solid', 
                    color: hexToPowerPointColor(normalizeToAdcoColor(element.borderColor)),
                    pt: element.borderWidth || 1
                  },
                  fill: { color: hexToPowerPointColor(normalizeToAdcoColor(element.cellBackground)) },
                  fontSize: element.fontSize || 12,
                  fontFace: element.fontFamily || 'Arial',
                  color: hexToPowerPointColor(normalizeToAdcoColor(element.cellTextColor)),
                  align: 'left',
                  valign: 'middle',
                });
              }
              break;

            case 'video':
              // PowerPoint doesn't support video in the same way, add a placeholder
              slide.addShape(pptx.ShapeType.rect, {
                x: x,
                y: y,
                w: width,
                h: height,
                fill: { color: ADCO_COLORS.dark },
                line: { color: ADCO_COLORS.yellow, width: 2 },
              });
              slide.addText(`[Video: ${element.src || 'Placeholder'}]`, {
                x: x,
                y: y,
                w: width,
                h: height,
                fontSize: 14,
                color: ADCO_COLORS.yellow,
                align: 'center',
                valign: 'middle',
                bold: true,
              });
              break;

            default:
              console.warn(`Unknown element type: ${element.type}`);
          }
        } catch (elementError) {
          console.error(`Error processing element ${element.id}:`, elementError);
          // Continue with other elements
        }
      }
    }

    // Generate PowerPoint file
    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' });

    // If tenderId is provided, save to blob storage and database
    if (tenderId) {
      try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING
        );
        const containerClient = blobServiceClient.getContainerClient('tender-files');
        
        // Ensure container exists
        await containerClient.createIfNotExists();
        
        const fileName = `presentation_${tenderId}_${Date.now()}.pptx`;
        const blobPath = `tenders/${tenderId}/presentation/${fileName}`;
        const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
        
        // Upload to Azure Blob Storage
        await blockBlobClient.upload(pptxBuffer, pptxBuffer.length, {
          blobHTTPHeaders: { blobContentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }
        });
        
        console.log(`✅ Saved presentation to blob storage: ${blobPath}`);
        
        // Save file record to database
        const pool = await getConnectedPool();
        const userId = req.user?.UserID || req.user?.id;
        
        // Check if presentation file already exists for this tender
        const existingFile = await pool.request()
          .input('TenderId', parseInt(tenderId))
          .query(`
            SELECT FileID, BlobPath FROM tenderFile 
            WHERE DocID = @TenderId 
            AND ConnectionTable = 'tenderTender'
            AND DisplayName LIKE 'presentation_%.pptx'
            ORDER BY UploadedOn DESC
          `);
        
        if (existingFile.recordset.length > 0) {
          // Update existing file
          await pool.request()
            .input('FileID', existingFile.recordset[0].FileID)
            .input('BlobPath', blobPath)
            .input('Size', pptxBuffer.length)
            .input('UpdatedAt', new Date())
            .query(`
              UPDATE tenderFile 
              SET BlobPath = @BlobPath, 
                  Size = @Size,
                  UploadedOn = GETDATE()
              WHERE FileID = @FileID
            `);
          
          console.log(`✅ Updated presentation file record in database`);
        } else {
          // Create new file record
          // First, get the tender's folder ID
          const folderResult = await pool.request()
            .input('TenderId', parseInt(tenderId))
            .query(`
              SELECT FolderID FROM tenderFile 
              WHERE DocID = @TenderId 
              AND ConnectionTable = 'tenderTender'
              AND FolderID IS NOT NULL
              ORDER BY UploadedOn DESC
            `);
          
          const folderId = folderResult.recordset.length > 0 
            ? folderResult.recordset[0].FolderID 
            : null;
          
          await pool.request()
            .input('AddBy', userId)
            .input('FolderID', folderId)
            .input('DocID', parseInt(tenderId))
            .input('ConnectionTable', 'tenderTender')
            .input('BlobPath', blobPath)
            .input('DisplayName', fileName)
            .input('Size', pptxBuffer.length)
            .input('ContentType', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
            .input('Status', 1)
            .input('Metadata', JSON.stringify({ type: 'presentation', title: presentation.title }))
            .query(`
              INSERT INTO tenderFile (AddBy, FolderID, DocID, ConnectionTable, BlobPath, DisplayName, UploadedOn, Size, ContentType, Status, Metadata)
              VALUES (@AddBy, @FolderID, @DocID, @ConnectionTable, @BlobPath, @DisplayName, GETDATE(), @Size, @ContentType, @Status, @Metadata)
            `);
          
          console.log(`✅ Created presentation file record in database`);
        }
      } catch (saveError) {
        console.error('⚠️ Failed to save presentation to storage:', saveError);
        // Continue and return the file anyway
      }
    }

    // Return the PowerPoint file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${presentation.title || 'presentation'}.pptx"`);
    res.setHeader('Content-Length', pptxBuffer.length);
    res.send(pptxBuffer);

  } catch (error) {
    console.error('❌ Error exporting PowerPoint:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to export PowerPoint presentation'
    });
  }
}

/**
 * Load presentation from database (tenderId)
 */
async function loadPresentation(req, res) {
  try {
    const { tenderId } = req.params;

    if (!tenderId) {
      return res.status(400).json({
        success: false,
        error: 'Tender ID is required'
      });
    }

    const pool = await getConnectedPool();

    // Find presentation file for this tender
    const fileResult = await pool.request()
      .input('TenderId', parseInt(tenderId))
      .query(`
        SELECT TOP 1 FileID, BlobPath, DisplayName, Size, Metadata
        FROM tenderFile 
        WHERE DocID = @TenderId 
        AND ConnectionTable = 'tenderTender'
        AND DisplayName LIKE 'presentation_%.pptx'
        ORDER BY UploadedOn DESC
      `);

    if (fileResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No presentation found for this tender'
      });
    }

    const file = fileResult.recordset[0];

    // Download from blob storage
    const blobServiceClient = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING
    );
    const containerClient = blobServiceClient.getContainerClient('tender-files');
    const blockBlobClient = containerClient.getBlockBlobClient(file.BlobPath);

    // Check if blob exists
    const exists = await blockBlobClient.exists();
    if (!exists) {
      return res.status(404).json({
        success: false,
        error: 'Presentation file not found in storage'
      });
    }

    // Download blob
    const downloadResponse = await blockBlobClient.download();
    const chunks = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Return the file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${file.DisplayName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);

  } catch (error) {
    console.error('❌ Error loading presentation:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to load presentation'
    });
  }
}

module.exports = {
  exportPowerPoint,
  loadPresentation
};

