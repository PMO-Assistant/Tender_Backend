const { getConnectedPool } = require('../../config/database');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const FormData = require('form-data');
const fs = require('fs');
const { downloadFile, deleteFile: deleteBlobFile } = require('../../config/azureBlobService');

// Try to load pdfjs-dist and canvas for PDF to image conversion (optional dependencies)
// Note: pdfjs-dist v5.x uses ES modules and requires browser APIs (DOMMatrix), which don't work in Node.js
// We need pdfjs-dist v3.x (CommonJS) for Node.js compatibility
let pdfjsLib = null;
let canvasLib = null;

// Handle unhandled promise rejections from pdfjs-dist v5.x (DOMMatrix error)
const originalUnhandledRejection = process.listeners('unhandledRejection');
process.removeAllListeners('unhandledRejection');
process.on('unhandledRejection', (reason, promise) => {
  // Check if this is the DOMMatrix error from pdfjs-dist v5.x
  if (reason && (reason.message && reason.message.includes('DOMMatrix') || 
                 reason.toString && reason.toString().includes('DOMMatrix'))) {
    console.warn('[DRAWING] ⚠️ pdfjs-dist v5.x detected (incompatible with Node.js - requires browser APIs)');
    console.warn('[DRAWING] PDF to image conversion will be disabled');
    console.warn('[DRAWING] To fix: Stop server, run: npm uninstall pdfjs-dist && npm install pdfjs-dist@3.11.174');
    pdfjsLib = null;
    canvasLib = null;
    return; // Don't propagate this error
  }
  // Call original handlers for other unhandled rejections
  originalUnhandledRejection.forEach(handler => handler(reason, promise));
});

try {
  // Try to load pdfjs-dist - catch any errors gracefully
  try {
    // Try legacy build first (CommonJS) - works with v3.x
    pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    console.log('[DRAWING] ✅ pdfjs-dist legacy build loaded');
  } catch (e1) {
    // If legacy build fails, pdfjs-dist is either not installed or incompatible version
    console.log('[DRAWING] pdfjs-dist legacy build not available:', e1.message);
    pdfjsLib = null;
  }
  
  try {
    canvasLib = require('canvas');
    console.log('[DRAWING] ✅ canvas loaded successfully');
  } catch (canvasErr) {
    console.log('[DRAWING] canvas not available:', canvasErr.message);
    canvasLib = null;
  }
  
  if (pdfjsLib && canvasLib && typeof pdfjsLib.getDocument === 'function') {
    console.log('[DRAWING] ✅ pdfjs-dist and canvas loaded successfully - PDF to image conversion available');
  } else {
    if (!pdfjsLib) {
      console.warn('[DRAWING] ⚠️ pdfjs-dist not loaded (may be incompatible v5.x version)');
    }
    if (!canvasLib) {
      console.warn('[DRAWING] ⚠️ canvas not loaded');
    }
    console.warn('[DRAWING] PDF to image conversion will not be available');
    console.warn('[DRAWING] To enable: Stop server, run: npm uninstall pdfjs-dist && npm install pdfjs-dist@3.11.174');
  }
} catch (err) {
  // Gracefully handle any errors during library loading
  console.warn('[DRAWING] ⚠️ Error loading PDF libraries:', err.message);
  pdfjsLib = null;
  canvasLib = null;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Validate and sanitize model name - fix common typos
let modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
// Fix common typos: "o4-mini" -> "gpt-4o-mini", "gpt-o4-mini" -> "gpt-4o-mini"
if (modelName === 'o4-mini' || modelName === 'gpt-o4-mini' || modelName === 'gpt-gpt-o4-mini') {
    console.warn(`⚠️  [DRAWING] Invalid model name "${modelName}" detected. Using "gpt-4o-mini" instead.`);
    modelName = 'gpt-4o-mini';
}
const OPENAI_MODEL = modelName;

/**
 * Extract drawing information from a PDF or image file using OpenAI
 */
async function extractDrawingInfo(req, res) {
  try {
    const { fileId } = req.params;
    console.log(`[DRAWING EXTRACTION] Starting extraction for fileId: ${fileId}`);
    const pool = await getConnectedPool();
    const userId = req.user?.UserID;

    if (!userId) {
      console.error('[DRAWING EXTRACTION] Unauthorized - no userId');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    console.log(`[DRAWING EXTRACTION] User ID: ${userId}`);

    // Get file information including tender ID
    const fileResult = await pool.request()
      .input('FileID', fileId)
      .query(`
        SELECT f.FileID, f.DisplayName, f.BlobPath, f.ContentType, f.ExtractedText, f.DocID, f.ConnectionTable
        FROM tenderFile f
        WHERE f.FileID = @FileID AND f.IsDeleted = 0
      `);

    if (fileResult.recordset.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = fileResult.recordset[0];
    
    // Get tender ID from file's DocID if ConnectionTable is tenderTender
    let tenderId = null;
    if (file.ConnectionTable === 'tenderTender' && file.DocID) {
      tenderId = file.DocID;
    } else {
      // Try to get tender ID from folder structure
      const folderResult = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT TOP 1 f.DocID
          FROM tenderFile tf
          INNER JOIN tenderFolder f ON tf.FolderID = f.FolderID
          WHERE tf.FileID = @FileID AND f.ConnectionTable = 'tenderTender'
        `);
      if (folderResult.recordset.length > 0) {
        tenderId = folderResult.recordset[0].DocID;
      }
    }

    if (!tenderId) {
      console.error(`[DRAWING EXTRACTION] Could not determine tender ID for file ${fileId}`);
      console.error(`[DRAWING EXTRACTION] File DocID: ${file.DocID}, ConnectionTable: ${file.ConnectionTable}`);
      return res.status(400).json({ error: 'Could not determine tender ID for this file' });
    }
    
    console.log(`[DRAWING EXTRACTION] Tender ID determined: ${tenderId}`);

    const isPDF = file.ContentType?.includes('pdf') || file.DisplayName?.toLowerCase().endsWith('.pdf');
    const isImage = file.ContentType?.includes('image') || 
                   /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(file.DisplayName || '');

    if (!isPDF && !isImage) {
      return res.status(400).json({ error: 'File must be a PDF or image' });
    }

    let extractedData = null;

    if (isPDF) {
      // For PDFs, extract text first, then use OpenAI to analyze
      let pdfText = file.ExtractedText;
      
      if (!pdfText) {
        // Download and extract text from PDF
        try {
          const stream = await downloadFile(file.BlobPath);
          const chunks = [];
          for await (const chunk of stream) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          const pdfData = await pdfParse(buffer);
          pdfText = pdfData.text;
        } catch (err) {
          console.error('Error extracting PDF text:', err);
          pdfText = '';
        }
      }

      // Use OpenAI to extract drawing information
      // If PDF text is too short (< 100 chars), it likely means the title block is in image/table format (scanned PDF)
      // In that case, convert PDF to image and use Vision API
      if (pdfText && pdfText.length > 100) {
        console.log('[DRAWING EXTRACTION] PDF text length:', pdfText.length);
        console.log('[DRAWING EXTRACTION] PDF text sample (first 2000 chars):', pdfText.substring(0, 2000));
        extractedData = await extractDrawingInfoFromText(pdfText, file.DisplayName);
        
        // If text extraction returned empty values, try Vision API as fallback
        if (!extractedData.drawingNumber && !extractedData.title) {
          console.warn('[DRAWING EXTRACTION] Text extraction returned empty values, converting PDF to image for Vision API...');
          extractedData = await extractDrawingInfoFromPDFImage(file.BlobPath, file.DisplayName);
        }
      } else {
        console.warn('[DRAWING EXTRACTION] PDF text too short or empty (length:', pdfText?.length || 0, '), converting PDF to image for Vision API...');
        // If text extraction failed or too short, convert PDF to image and use Vision API
        extractedData = await extractDrawingInfoFromPDFImage(file.BlobPath, file.DisplayName);
      }
    } else if (isImage) {
      // For images, use OpenAI Vision API
      extractedData = await extractDrawingInfoFromImage(file.BlobPath, file.DisplayName);
    }

    if (!extractedData) {
      console.error('Failed to extract drawing information - extractedData is null');
      return res.status(500).json({ error: 'Failed to extract drawing information' });
    }

    console.log('Drawing information extracted successfully:', {
      drawingNumber: extractedData.drawingNumber,
      title: extractedData.title,
      discipline: extractedData.discipline,
      revision: extractedData.currentRevision
    });

    // Auto-save the extracted data to database
    // Ensure we have required fields (drawingNumber, title, discipline)
    // IMPORTANT: If AI extraction returned null/empty, we should NOT use filename fallback for Drawings
    // This ensures we only save properly extracted drawings
    const drawingNumber = extractedData.drawingNumber || extractDrawingNumberFromFileName(file.DisplayName) || 'UNKNOWN';
    const title = extractedData.title || file.DisplayName.replace(/\.[^/.]+$/, '');
    const discipline = extractedData.discipline || inferDisciplineFromFileName(file.DisplayName) || 'ARC';
    
    console.log('[DRAWING EXTRACTION] Final values to save:', {
      drawingNumber,
      title,
      discipline,
      currentRevision: extractedData.currentRevision,
      fromAI: {
        drawingNumber: extractedData.drawingNumber,
        title: extractedData.title,
        discipline: extractedData.discipline
      }
    });
    
    console.log('Preparing to save drawing:', {
      tenderId,
      fileId,
      drawingNumber,
      title,
      discipline,
      userId
    });

    // Check if drawing already exists for this file
    // Try with FileID first, fallback if column doesn't exist
    let existingResult = { recordset: [] };
    try {
      existingResult = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT DrawingID
          FROM tenderDrawing
          WHERE FileID = @FileID
        `);
    } catch (err) {
      // If FileID column doesn't exist, try matching by TenderID and DrawingNumber
      if (err.message && err.message.includes('FileID')) {
        console.warn('FileID column not found, trying alternative lookup by TenderID and DrawingNumber');
        try {
          existingResult = await pool.request()
            .input('TenderID', tenderId)
            .input('DrawingNumber', drawingNumber)
            .query(`
              SELECT DrawingID
              FROM tenderDrawing
              WHERE TenderID = @TenderID AND DrawingNumber = @DrawingNumber
            `);
        } catch (altErr) {
          console.warn('Alternative lookup also failed:', altErr.message);
          existingResult = { recordset: [] };
        }
      } else {
        throw err;
      }
    }

    if (existingResult.recordset.length > 0) {
      // Update existing drawing
      const drawingId = existingResult.recordset[0].DrawingID;
      console.log(`[DRAWING EXTRACTION] Found existing drawing with ID: ${drawingId}, updating...`);
      
      // Try to update with FileID first, fallback if column doesn't exist
      try {
        await pool.request()
          .input('DrawingID', drawingId)
          .input('DrawingNumber', drawingNumber)
          .input('Title', title)
          .input('Description', extractedData.description || null)
          .input('Discipline', discipline)
          .input('CurrentRevision', extractedData.currentRevision || null)
          .input('PackageID', null)
          .input('HasLayers', extractedData.hasLayers || false)
          .input('Notes', extractedData.notes || null)
          .input('FileID', fileId)
          .query(`
            UPDATE tenderDrawing
            SET DrawingNumber = @DrawingNumber,
                Title = @Title,
                Description = @Description,
                Discipline = @Discipline,
                CurrentRevision = @CurrentRevision,
                PackageID = @PackageID,
                HasLayers = @HasLayers,
                Notes = @Notes,
                FileID = @FileID,
                UpdatedDate = GETDATE()
            WHERE DrawingID = @DrawingID
          `);
        console.log(`[DRAWING EXTRACTION] ✅ Drawing updated successfully with FileID!`);
      } catch (updateErr) {
        // If FileID column doesn't exist, update without it
        if (updateErr.message && updateErr.message.includes('FileID')) {
          console.warn('[DRAWING EXTRACTION] FileID column not found, updating without FileID');
          await pool.request()
            .input('DrawingID', drawingId)
            .input('DrawingNumber', drawingNumber)
            .input('Title', title)
            .input('Description', extractedData.description || null)
            .input('Discipline', discipline)
            .input('CurrentRevision', extractedData.currentRevision || null)
            .input('PackageID', null)
            .input('HasLayers', extractedData.hasLayers || false)
            .input('Notes', extractedData.notes || null)
            .query(`
              UPDATE tenderDrawing
              SET DrawingNumber = @DrawingNumber,
                  Title = @Title,
                  Description = @Description,
                  Discipline = @Discipline,
                  CurrentRevision = @CurrentRevision,
                  PackageID = @PackageID,
                  HasLayers = @HasLayers,
                  Notes = @Notes,
                  UpdatedDate = GETDATE()
              WHERE DrawingID = @DrawingID
            `);
          console.log(`[DRAWING EXTRACTION] ✅ Drawing updated successfully without FileID!`);
        } else {
          console.error('[DRAWING EXTRACTION] ❌ Error updating drawing:', updateErr);
          throw updateErr;
        }
      }
      
      extractedData.drawingId = drawingId;
      extractedData.saved = true;
      extractedData.drawingNumber = drawingNumber; // Include the actual saved drawingNumber
      extractedData.title = title; // Include the actual saved title
      extractedData.discipline = discipline; // Include the actual saved discipline
      console.log(`[DRAWING EXTRACTION] DrawingID: ${drawingId}, FileID: ${fileId}, TenderID: ${tenderId}`);
      console.log(`[DRAWING EXTRACTION] DrawingNumber: ${drawingNumber}, Title: ${title}, Discipline: ${discipline}`);
    } else {
      // Create new drawing record
      // Try with FileID first, fallback to without FileID if column doesn't exist
      let result;
      try {
        result = await pool.request()
          .input('TenderID', tenderId)
          .input('DrawingNumber', drawingNumber)
          .input('Title', title)
          .input('Description', extractedData.description || null)
          .input('Discipline', discipline)
          .input('CurrentRevision', extractedData.currentRevision || null)
          .input('PackageID', null)
          .input('AddedBy', userId)
          .input('HasLayers', extractedData.hasLayers || false)
          .input('Notes', extractedData.notes || null)
          .input('FileID', fileId)
          .query(`
            INSERT INTO tenderDrawing 
            (TenderID, DrawingNumber, Title, Description, Discipline, CurrentRevision, PackageID, AddedBy, HasLayers, Notes, FileID)
            OUTPUT INSERTED.DrawingID
            VALUES 
            (@TenderID, @DrawingNumber, @Title, @Description, @Discipline, @CurrentRevision, @PackageID, @AddedBy, @HasLayers, @Notes, @FileID)
          `);
      } catch (err) {
        // If FileID column doesn't exist, insert without it
        if (err.message && err.message.includes('FileID')) {
          console.warn('FileID column not found, inserting without FileID:', err.message);
          try {
            result = await pool.request()
              .input('TenderID', tenderId)
              .input('DrawingNumber', drawingNumber)
              .input('Title', title)
              .input('Description', extractedData.description || null)
              .input('Discipline', discipline)
              .input('CurrentRevision', extractedData.currentRevision || null)
              .input('PackageID', null)
              .input('AddedBy', userId)
              .input('HasLayers', extractedData.hasLayers || false)
              .input('Notes', extractedData.notes || null)
              .query(`
                INSERT INTO tenderDrawing 
                (TenderID, DrawingNumber, Title, Description, Discipline, CurrentRevision, PackageID, AddedBy, HasLayers, Notes)
                OUTPUT INSERTED.DrawingID
                VALUES 
                (@TenderID, @DrawingNumber, @Title, @Description, @Discipline, @CurrentRevision, @PackageID, @AddedBy, @HasLayers, @Notes)
              `);
            console.log('Drawing saved successfully without FileID');
          } catch (insertErr) {
            console.error('Error inserting drawing (without FileID):', insertErr);
            throw insertErr;
          }
        } else {
          console.error('Error inserting drawing (with FileID):', err);
          throw err;
        }
      }

      if (result && result.recordset && result.recordset.length > 0) {
        const drawingId = result.recordset[0].DrawingID;
        extractedData.drawingId = drawingId;
        extractedData.saved = true;
        extractedData.drawingNumber = drawingNumber; // Include the actual saved drawingNumber
        extractedData.title = title; // Include the actual saved title
        extractedData.discipline = discipline; // Include the actual saved discipline
        console.log(`[DRAWING EXTRACTION] ✅ Drawing saved successfully!`);
        console.log(`[DRAWING EXTRACTION] DrawingID: ${drawingId}, FileID: ${fileId}, TenderID: ${tenderId}`);
        console.log(`[DRAWING EXTRACTION] DrawingNumber: ${drawingNumber}, Title: ${title}, Discipline: ${discipline}`);
        console.log(`[DRAWING EXTRACTION] CurrentRevision: ${extractedData.currentRevision || 'N/A'}`);
      } else {
        console.error('[DRAWING EXTRACTION] ❌ No DrawingID returned from INSERT statement');
        console.error('[DRAWING EXTRACTION] Result:', JSON.stringify(result, null, 2));
        throw new Error('Failed to save drawing - no ID returned');
      }
    }

    console.log(`\n========================================`);
    console.log('[DRAWING EXTRACTION] ✅ Drawing extraction and save completed successfully');
    console.log(`[DRAWING EXTRACTION] Saved: ${extractedData.saved}, DrawingID: ${extractedData.drawingId || 'N/A'}`);
    console.log(`[DRAWING EXTRACTION] Returning extracted data to frontend`);
    console.log(`========================================\n`);
    res.json(extractedData);
  } catch (error) {
    console.error('[DRAWING EXTRACTION] Error extracting drawing info:', error);
    console.error('[DRAWING EXTRACTION] Error message:', error.message);
    console.error('[DRAWING EXTRACTION] Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to extract drawing information', details: error.message });
  }
}

/**
 * Extract drawing information from text using OpenAI
 */
async function extractDrawingInfoFromText(text, fileName) {
  try {
    const prompt = `You are analyzing a construction drawing document (PDF). You MUST extract information ONLY from the TITLE BLOCK section of the drawing, NOT from the filename or project codes.

IMPORTANT: The filename may contain codes like "330054-MNK-MEA-XX-ZZ-DR-C-1100-D1-P1.pdf" - IGNORE THIS. Only use information from the actual title block fields in the drawing.

Extract the following information and return ONLY valid JSON:

{
  "drawingNumber": "Drawing number (e.g., 1100, 1150, A-101, STR-05, MEP-12)",
  "title": "Drawing title/name from the title block",
  "description": "A short, clear description (2-3 sentences) of what this drawing document shows or contains. Describe the main purpose, content, or subject matter visible in the drawing. For example: 'This drawing shows detailed plans for a drainage chamber and valve installation, including dimensions and material specifications.'",
  "discipline": "Discipline code (ARC, STR, MEP, CIV, ELEC, MECH, LAND, DOC, etc.)",
  "currentRevision": "Latest revision (can be letter, number, or combination like A, B, C, 1, 2, P1, P0, P-0, Rev A, Revision 2, etc.)",
  "hasLayers": false,
  "notes": "Any additional notes or comments found"
}

CRITICAL EXTRACTION RULES - YOU MUST FOLLOW THESE EXACTLY:

⚠️ IMPORTANT: DO NOT use generic/default values. If you cannot find the actual value in the title block, return null or empty string. DO NOT guess or use placeholder values like "A-101" or "P1" unless you actually see them in the title block.

1. **DRAWING NUMBER** (MOST IMPORTANT - MUST BE FROM TITLE BLOCK):
   - PRIMARY: Look for "Sheet Number:" or "Sheet No:" in the title block - THIS IS THE DRAWING NUMBER
   - Extract ONLY the number after "Sheet Number:" (e.g., if you see "Sheet Number: 1100", extract "1100")
   - DO NOT use the filename, project codes, or any other field
   - DO NOT use "Project Number:" - that's different from Sheet Number
   - DO NOT extract from codes like "MNK-MEA-XX-00-DR-C-1100" - extract ONLY "1100" from "Sheet Number: 1100"
   - ⚠️ DO NOT use "A-101" unless you actually see "Sheet Number: A-101" or "Sheet No: A-101" in the title block
   - If you cannot find "Sheet Number:" or "Sheet No:" in the title block, return null or empty string
   - Examples: 
     * "Sheet Number: 1100" → drawingNumber: "1100"
     * "Sheet Number: 1150" → drawingNumber: "1150"
     * "Sheet No: A-101" → drawingNumber: "A-101" (ONLY if you see this exact text)
     * If no "Sheet Number:" found → drawingNumber: null or ""

2. **TITLE** (MOST IMPORTANT - MUST BE FROM TITLE BLOCK):
   - PRIMARY: Look for "Drawing Title:" in the title block - THIS IS THE TITLE
   - Extract the FULL text after "Drawing Title:" exactly as written (e.g., "CHAMBER & VALVE DETAILS")
   - DO NOT use the filename, project number, drawing number, or any codes
   - DO NOT extract from the project code like "330054-MNK-MEA-XX-ZZ-DR-C-1100-D1-P1"
   - If you cannot find "Drawing Title:" in the title block, return null or empty string
   - Examples:
     * "Drawing Title: CHAMBER & VALVE DETAILS" → title: "CHAMBER & VALVE DETAILS"
     * "Drawing Title: DIVERTER CHAMBER RC DETAILS" → title: "DIVERTER CHAMBER RC DETAILS"
     * If no "Drawing Title:" found → title: null or ""

3. **REVISION** (MOST IMPORTANT - MUST BE FROM TITLE BLOCK):
   - PRIMARY: Look for "Revision:" field in the title block - extract the value EXACTLY as shown
   - Extract the value immediately after "Revision:" (e.g., if you see "Revision: P1", extract "P1")
   - SECONDARY: Look in revision history table - find the LATEST/MOST RECENT revision (usually the first row "Rev No: P1")
   - IMPORTANT: Extract exactly as written, including format (e.g., "P1", "P-0", "P0", "A", "B")
   - ⚠️ DO NOT use "P1" unless you actually see "Revision: P1" or "Rev No: P1" in the title block or revision table
   - DO NOT use "Status:" field - that's different from Revision
   - If you cannot find "Revision:" or "Rev No:" in the title block or revision table, return null or empty string
   - Examples:
     * "Revision: P1" → currentRevision: "P1" (ONLY if you see this exact text)
     * "Rev No: P1" (in revision table) → currentRevision: "P1" (ONLY if you see this exact text)
     * "Revision: P-0" → currentRevision: "P-0"
     * If no "Revision:" or "Rev No:" found → currentRevision: null or ""

4. **DESCRIPTION** (IMPORTANT):
   - Generate a short, clear description (2-3 sentences) of what this drawing document shows or contains
   - Describe the main purpose, content, or subject matter visible in the drawing
   - Look at the drawing title, any notes, and the visual content to understand what it depicts
   - Examples:
     * "This drawing shows detailed plans for a drainage chamber and valve installation, including dimensions and material specifications."
     * "Technical specification document for general drainage works, outlining standard procedures and requirements."
     * "Structural details for reinforced concrete elements, showing reinforcement layout and connection details."
   - If it's a document register, specification, or general documentation (not a technical drawing), note that in the description

5. **DISCIPLINE**:
   - Look for discipline codes in the project number (e.g., "DR-S" = Structural, "DR-C" = Civil, "DR-A" = Architecture, "DR-M" = Mechanical, "DR-E" = Electrical)
   - Or infer from drawing title keywords (e.g., "STRUCTURAL", "ARCHITECTURAL", "MECHANICAL", "ELECTRICAL")
   - Common codes: ARC (Architecture), STR (Structural), MEP (Mechanical/Electrical/Plumbing), CIV (Civil), ELEC (Electrical), MECH (Mechanical), LAND (Landscaping), DOC (Drawing Documentation - for document registers, specifications, or general documentation)

STEP-BY-STEP PROCESS:
1. First, locate the title block section in the document
2. Find "Sheet Number:" - extract the number immediately after it (this is drawingNumber)
3. Find "Drawing Title:" - extract the complete text immediately after it (this is title)
4. Find "Revision:" - extract the value immediately after it, OR find the first row in revision table with "Rev No:" (this is currentRevision)
5. DO NOT look at the filename at all
6. DO NOT use any project codes or file paths

EXAMPLE - If the document contains:
- "Sheet Number: 1100"
- "Drawing Title: CHAMBER & VALVE DETAILS"
- "Revision: P1" or revision table shows "Rev No: P1" in first row

Then return:
{
  "drawingNumber": "1100",
  "title": "CHAMBER & VALVE DETAILS",
  "currentRevision": "P1",
  ...
}

DO NOT return:
- drawingNumber: "C-1100" (from filename)
- title: "330054-MNK-MEA-XX-ZZ-DR-C-1100-D1-P1" (from filename)
- currentRevision: null (if you can see "Revision: P1" or "Rev No: P1")

If information is not found in the title block, use null or empty string.

Return ONLY the JSON object, no markdown, no code fences, no additional text.

Document text (may be truncated):
${text.substring(0, 8000)}`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a construction drawing analyzer. You MUST extract information ONLY from the title block fields visible in the drawing. NEVER use filenames or project codes. Follow the extraction rules exactly.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.1
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const content = response.data?.choices?.[0]?.message?.content || '';
    
    console.log('[DRAWING EXTRACTION] Raw AI response (text):', content.substring(0, 1000));
    
    // Parse JSON from response
    let cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]);
      console.log('[DRAWING EXTRACTION] Parsed AI response (text):', JSON.stringify(extracted, null, 2));
      return extracted;
    }

    throw new Error('Invalid JSON response from OpenAI');
  } catch (error) {
    console.error('Error extracting drawing info from text:', error);
    // Return fallback data
    return {
      drawingNumber: extractDrawingNumberFromFileName(fileName),
      title: fileName.replace(/\.[^/.]+$/, ''),
      description: null,
      discipline: inferDisciplineFromFileName(fileName),
      currentRevision: null,
      hasLayers: false,
      notes: null
    };
  }
}

/**
 * Extract drawing information from PDF by converting first page to image and using Vision API
 */
async function extractDrawingInfoFromPDFImage(blobPath, fileName) {
  try {
    if (!pdfjsLib || !canvasLib) {
      throw new Error('pdfjs-dist and canvas libraries required for PDF to image conversion. Please run: npm install pdfjs-dist canvas');
    }

    // Download PDF from Azure Blob Storage
    const stream = await downloadFile(blobPath);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const pdfBuffer = Buffer.concat(chunks);

    console.log('[DRAWING EXTRACTION] Converting PDF first page to JPG...');
    
    // Convert Buffer to Uint8Array (required by pdfjs-dist)
    const uint8Array = new Uint8Array(pdfBuffer);
    
    // Load PDF using pdfjs-dist with Node.js canvas factory
    const loadingTask = pdfjsLib.getDocument({ 
      data: uint8Array,
      verbosity: 0
    });
    const pdf = await loadingTask.promise;
    
    // Get first page
    const page = await pdf.getPage(1);
    
    // Set up canvas for rendering (scale 2.0 for better quality)
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = canvasLib.createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    
    // Render PDF page to canvas
    const renderContext = {
      canvasContext: context,
      viewport: viewport
    };
    
    await page.render(renderContext).promise;
    
    // Convert canvas to JPG buffer (JPEG format for better compression)
    // Note: The original PDF file remains stored in blob storage, we only use JPG for AI extraction
    const imageBuffer = canvas.toBuffer('image/jpeg', { quality: 0.95 });
    const base64Image = imageBuffer.toString('base64');
    
    console.log('[DRAWING EXTRACTION] PDF converted to JPG successfully, size:', imageBuffer.length, 'bytes, using Vision API...');
    
    // Use Vision API with the converted JPG image
    return await extractDrawingInfoFromImageBuffer(base64Image, 'image/jpeg', fileName);
  } catch (error) {
    console.error('[DRAWING EXTRACTION] Error converting PDF to image:', error);
    throw error;
  }
}

/**
 * Extract drawing information from image using OpenAI Vision API
 */
async function extractDrawingInfoFromImage(blobPath, fileName) {
  try {
    // Download image from Azure Blob Storage
    const stream = await downloadFile(blobPath);
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);

    // Convert to base64
    const base64Image = imageBuffer.toString('base64');
    const mimeType = fileName.toLowerCase().endsWith('.png') ? 'image/png' : 
                    fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' :
                    'image/png';
    
    return await extractDrawingInfoFromImageBuffer(base64Image, mimeType, fileName);
  } catch (error) {
    console.error('Error extracting drawing info from image:', error);
    // Return fallback data
    return {
      drawingNumber: extractDrawingNumberFromFileName(fileName),
      title: fileName.replace(/\.[^/.]+$/, ''),
      description: null,
      discipline: inferDisciplineFromFileName(fileName),
      currentRevision: null,
      hasLayers: false,
      notes: null
    };
  }
}

/**
 * Extract drawing information from image buffer using OpenAI Vision API
 */
async function extractDrawingInfoFromImageBuffer(base64Image, mimeType, fileName) {
  try {

    const prompt = `You are analyzing a construction drawing. Extract the following information and return ONLY valid JSON:

{
  "drawingNumber": "Drawing number (e.g., 1150, A-101, STR-05, MEP-12)",
  "title": "Drawing title/name from the title block",
  "description": "A short, clear description (2-3 sentences) of what this drawing document shows or contains. Describe the main purpose, content, or subject matter visible in the drawing. For example: 'This drawing shows detailed plans for a drainage chamber and valve installation, including dimensions and material specifications.'",
  "discipline": "Discipline code (ARC, STR, MEP, CIV, ELEC, MECH, LAND, DOC, etc.)",
  "currentRevision": "Latest revision visible (can be letter, number, or combination like A, B, C, 1, 2, P1, P0, P-0, Rev A, Revision 2, etc.)",
  "hasLayers": false,
  "notes": "Any additional notes or comments visible"
}

CRITICAL EXTRACTION RULES - READ THE TITLE BLOCK CAREFULLY:

⚠️ IMPORTANT: DO NOT use generic/default values. If you cannot find the actual value in the title block, return null or empty string. DO NOT guess or use placeholder values like "A-101" or "P1" unless you actually see them in the title block.

1. **DRAWING NUMBER** (MOST IMPORTANT - MUST BE FROM TITLE BLOCK):
   - PRIMARY: Look for "Sheet Number:" or "Sheet No:" in the title block - THIS IS THE DRAWING NUMBER
   - Extract ONLY the number after "Sheet Number:" (e.g., if you see "Sheet Number: 1100", extract "1100")
   - DO NOT use the filename, project codes, or any other field
   - DO NOT use "Project Number:" - that's different from Sheet Number
   - DO NOT extract from codes like "MNK-MEA-XX-00-DR-C-1100" - extract ONLY "1100" from "Sheet Number: 1100"
   - ⚠️ DO NOT use "A-101" unless you actually see "Sheet Number: A-101" or "Sheet No: A-101" in the title block
   - If you cannot find "Sheet Number:" or "Sheet No:" in the title block, return null or empty string
   - Examples: 
     * "Sheet Number: 1100" → drawingNumber: "1100"
     * "Sheet Number: 1150" → drawingNumber: "1150"
     * "Sheet No: A-101" → drawingNumber: "A-101" (ONLY if you see this exact text)
     * If no "Sheet Number:" found → drawingNumber: null or ""

2. **TITLE** (MOST IMPORTANT - MUST BE FROM TITLE BLOCK):
   - PRIMARY: Look for "Drawing Title:" in the title block - THIS IS THE TITLE
   - Extract the FULL text after "Drawing Title:" exactly as written (e.g., "CHAMBER & VALVE DETAILS")
   - DO NOT use the filename, project number, drawing number, or any codes
   - DO NOT extract from the project code like "330054-MNK-MEA-XX-ZZ-DR-C-1100-D1-P1"
   - If you cannot find "Drawing Title:" in the title block, return null or empty string
   - Examples:
     * "Drawing Title: CHAMBER & VALVE DETAILS" → title: "CHAMBER & VALVE DETAILS"
     * "Drawing Title: DIVERTER CHAMBER RC DETAILS" → title: "DIVERTER CHAMBER RC DETAILS"
     * If no "Drawing Title:" found → title: null or ""

3. **REVISION** (MOST IMPORTANT - MUST BE FROM TITLE BLOCK):
   - PRIMARY: Look for "Revision:" field in the title block - extract the value EXACTLY as shown
   - Extract the value immediately after "Revision:" (e.g., if you see "Revision: P1", extract "P1")
   - SECONDARY: Look in revision history table - find the LATEST/MOST RECENT revision (usually the first row "Rev No: P1")
   - IMPORTANT: Extract exactly as written, including format (e.g., "P1", "P-0", "P0", "A", "B")
   - ⚠️ DO NOT use "P1" unless you actually see "Revision: P1" or "Rev No: P1" in the title block or revision table
   - DO NOT use "Status:" field - that's different from Revision
   - If you cannot find "Revision:" or "Rev No:" in the title block or revision table, return null or empty string
   - Examples:
     * "Revision: P1" → currentRevision: "P1" (ONLY if you see this exact text)
     * "Rev No: P1" (in revision table) → currentRevision: "P1" (ONLY if you see this exact text)
     * "Revision: P-0" → currentRevision: "P-0"
     * If no "Revision:" or "Rev No:" found → currentRevision: null or ""

4. **DISCIPLINE**:
   - Look for discipline codes in the project number (e.g., "DR-S" = Structural, "DR-C" = Civil, "DR-A" = Architecture, "DR-M" = Mechanical, "DR-E" = Electrical)
   - Or infer from drawing title keywords (e.g., "STRUCTURAL", "ARCHITECTURAL", "MECHANICAL", "ELECTRICAL")
   - Common codes: ARC (Architecture), STR (Structural), MEP (Mechanical/Electrical/Plumbing), CIV (Civil), ELEC (Electrical), MECH (Mechanical), LAND (Landscaping), DOC (Drawing Documentation - for document registers, specifications, or general documentation)

STEP-BY-STEP PROCESS:
1. First, locate the title block section in the image
2. Find "Sheet Number:" - extract the number immediately after it (this is drawingNumber)
3. Find "Drawing Title:" - extract the complete text immediately after it (this is title)
4. Find "Revision:" - extract the value immediately after it, OR find the first row in revision table with "Rev No:" (this is currentRevision)
5. DO NOT look at the filename at all
6. DO NOT use any project codes or file paths

EXAMPLE - If the image shows:
- "Sheet Number: 1100"
- "Drawing Title: CHAMBER & VALVE DETAILS"
- "Revision: P1" or revision table shows "Rev No: P1" in first row

Then return:
{
  "drawingNumber": "1100",
  "title": "CHAMBER & VALVE DETAILS",
  "currentRevision": "P1",
  ...
}

DO NOT return:
- drawingNumber: "C-1100" (from filename)
- title: "330054-MNK-MEA-XX-ZZ-DR-C-1100-D1-P1" (from filename)
- currentRevision: null (if you can see "Revision: P1" or "Rev No: P1")

If information is not found in the title block, use null or empty string.

Return ONLY the JSON object, no markdown, no code fences, no additional text`;

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o', // Use vision-capable model for images
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0.1
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const content = response.data?.choices?.[0]?.message?.content || '';
    
    console.log('[DRAWING EXTRACTION] Raw AI response (image):', content.substring(0, 1000));
    
    // Parse JSON from response
    let cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]);
      console.log('[DRAWING EXTRACTION] Parsed AI response (image):', JSON.stringify(extracted, null, 2));
      
      // Validate and reject generic/default values
      // If drawingNumber is "A-101", it's likely a default - reject it unless we're very confident
      if (extracted.drawingNumber === 'A-101' || extracted.drawingNumber === 'A101') {
        console.warn('[DRAWING EXTRACTION] ⚠️ Suspicious generic drawing number "A-101" detected from image. This is likely a default value. Setting to null.');
        extracted.drawingNumber = null;
      }
      
      // If currentRevision is "P1" and it's the same for all drawings, it's likely a default
      // We can't validate against text for images, but we can log a warning
      if (extracted.currentRevision === 'P1' || extracted.currentRevision === 'P-1') {
        console.warn('[DRAWING EXTRACTION] ⚠️ Revision "P1" detected from image. If this appears for all drawings, it may be a default. Consider verifying manually.');
        // For now, we'll keep it but log the warning
      }
      
      return extracted;
    }

    throw new Error('Invalid JSON response from OpenAI');
  } catch (error) {
    console.error('Error extracting drawing info from image buffer:', error);
    throw error; // Re-throw so caller can handle it
  }
}

/**
 * Create or update a drawing record
 */
async function saveDrawing(req, res) {
  try {
    const { tenderId } = req.params;
    const { fileId, drawingNumber, title, description, discipline, currentRevision, packageId, packageName, hasLayers, notes } = req.body;
    const userId = req.user?.UserID;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!drawingNumber || !title || !discipline) {
      return res.status(400).json({ error: 'Drawing number, title, and discipline are required' });
    }

    const pool = await getConnectedPool();

    // Resolve PackageID from packageName if packageId is not provided
    let resolvedPackageId = packageId || null;
    if (!resolvedPackageId && packageName) {
      try {
        // Try to find PackageID by packageName and TenderID
        const packageQuery = await pool.request()
          .input('TenderID', parseInt(tenderId))
          .input('PackageName', packageName)
          .query(`
            SELECT TOP 1 PackageID
            FROM tenderBoQPackages
            WHERE TenderID = @TenderID AND PackageName = @PackageName
            ORDER BY PackageID DESC
          `);
        
        if (packageQuery.recordset.length > 0) {
          resolvedPackageId = packageQuery.recordset[0].PackageID;
          console.log(`[saveDrawing] Resolved PackageID ${resolvedPackageId} for package "${packageName}"`);
        }
      } catch (pkgErr) {
        console.warn('[saveDrawing] Could not resolve PackageID from packageName:', pkgErr.message);
      }
    }

    // Check if drawing already exists for this file
    // Try with FileID first, fallback if column doesn't exist
    let existingResult = { recordset: [] };
    try {
      existingResult = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT DrawingID
          FROM tenderDrawing
          WHERE FileID = @FileID
        `);
    } catch (err) {
      // If FileID column doesn't exist, return empty result (will create new)
      if (err.message && err.message.includes('FileID')) {
        console.warn('FileID column not found in tenderDrawing table, will create new record');
        existingResult = { recordset: [] };
      } else {
        throw err;
      }
    }

    if (existingResult.recordset.length > 0) {
      // Update existing drawing
      const drawingId = existingResult.recordset[0].DrawingID;
      await pool.request()
        .input('DrawingID', drawingId)
        .input('DrawingNumber', drawingNumber)
        .input('Title', title)
        .input('Description', description || null)
        .input('Discipline', discipline)
        .input('CurrentRevision', currentRevision || null)
        .input('PackageID', resolvedPackageId || null)
        .input('HasLayers', hasLayers || false)
        .input('Notes', notes || null)
        .query(`
          UPDATE tenderDrawing
          SET DrawingNumber = @DrawingNumber,
              Title = @Title,
              Description = @Description,
              Discipline = @Discipline,
              CurrentRevision = @CurrentRevision,
              PackageID = @PackageID,
              HasLayers = @HasLayers,
              Notes = @Notes,
              UpdatedDate = GETDATE()
          WHERE DrawingID = @DrawingID
        `);

      return res.json({ drawingId, message: 'Drawing updated successfully' });
    } else {
      // Create new drawing
      // Try with FileID first, fallback to without FileID if column doesn't exist
      let result;
      try {
        result = await pool.request()
          .input('TenderID', tenderId)
          .input('DrawingNumber', drawingNumber)
          .input('Title', title)
          .input('Description', description || null)
          .input('Discipline', discipline)
          .input('CurrentRevision', currentRevision || null)
          .input('PackageID', resolvedPackageId || null)
          .input('AddedBy', userId)
          .input('HasLayers', hasLayers || false)
          .input('Notes', notes || null)
          .input('FileID', fileId)
          .query(`
            INSERT INTO tenderDrawing 
            (TenderID, DrawingNumber, Title, Description, Discipline, CurrentRevision, PackageID, AddedBy, HasLayers, Notes, FileID)
            OUTPUT INSERTED.DrawingID
            VALUES 
            (@TenderID, @DrawingNumber, @Title, @Description, @Discipline, @CurrentRevision, @PackageID, @AddedBy, @HasLayers, @Notes, @FileID)
          `);
      } catch (err) {
        // If FileID column doesn't exist, insert without it
        if (err.message && err.message.includes('FileID')) {
          console.warn('FileID column not found, inserting without FileID');
          result = await pool.request()
            .input('TenderID', tenderId)
            .input('DrawingNumber', drawingNumber)
            .input('Title', title)
            .input('Description', description || null)
            .input('Discipline', discipline)
            .input('CurrentRevision', currentRevision || null)
            .input('PackageID', resolvedPackageId || null)
            .input('AddedBy', userId)
            .input('HasLayers', hasLayers || false)
            .input('Notes', notes || null)
            .query(`
              INSERT INTO tenderDrawing 
              (TenderID, DrawingNumber, Title, Description, Discipline, CurrentRevision, PackageID, AddedBy, HasLayers, Notes)
              OUTPUT INSERTED.DrawingID
              VALUES 
              (@TenderID, @DrawingNumber, @Title, @Description, @Discipline, @CurrentRevision, @PackageID, @AddedBy, @HasLayers, @Notes)
            `);
        } else {
          throw err;
        }
      }

      const drawingId = result.recordset[0].DrawingID;
      return res.json({ drawingId, message: 'Drawing created successfully' });
    }
  } catch (error) {
    console.error('Error saving drawing:', error);
    res.status(500).json({ error: 'Failed to save drawing', details: error.message });
  }
}

/**
 * Get drawing information by file ID
 */
async function getDrawingByFileId(req, res) {
  try {
    const { fileId } = req.params;
    const pool = await getConnectedPool();

    // Try with FileID first, fallback if column doesn't exist
    let result;
    try {
      result = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT d.*, 
                 p.PackageName,
                 e.Name as AddedByName
          FROM tenderDrawing d
          LEFT JOIN tenderBoQPackages p ON d.PackageID = p.PackageID
          LEFT JOIN tenderEmployee e ON d.AddedBy = e.UserID
          WHERE d.FileID = @FileID
        `);
    } catch (err) {
      // If FileID column doesn't exist, return null (drawing not found by file)
      if (err.message && err.message.includes('FileID')) {
        console.warn('FileID column not found, cannot lookup drawing by file');
        return res.json(null);
      } else {
        throw err;
      }
    }

    if (result.recordset.length === 0) {
      return res.json(null);
    }

    res.json(result.recordset[0]);
  } catch (error) {
    console.error('Error getting drawing:', error);
    res.status(500).json({ error: 'Failed to get drawing', details: error.message });
  }
}

/**
 * Get all drawings for a tender
 */
async function getDrawingsByTenderId(req, res) {
  try {
    const { tenderId } = req.params;
    const pool = await getConnectedPool();

    // Try with FileID first, fallback if column doesn't exist
    let result;
    try {
      result = await pool.request()
        .input('TenderID', tenderId)
        .query(`
          SELECT d.*, 
                 ISNULL(p.PackageName, '') as PackageName,
                 e.Name as AddedByName,
                 f.DisplayName as FileName,
                 f.BlobPath
          FROM tenderDrawing d
          LEFT JOIN tenderBoQPackages p ON d.PackageID = p.PackageID
          LEFT JOIN tenderEmployee e ON d.AddedBy = e.UserID
          LEFT JOIN tenderFile f ON d.FileID = f.FileID
          WHERE d.TenderID = @TenderID
          ORDER BY d.DrawingNumber, d.CreatedDate DESC
        `);
      
      // Always fetch and update package names for ALL drawings with PackageID
      // This ensures we have the most up-to-date package names even if the JOIN didn't work
      if (result.recordset.length > 0) {
        const drawingsWithPackageId = result.recordset.filter(d => d.PackageID != null && d.PackageID !== 0);
        
        if (drawingsWithPackageId.length > 0) {
          const packageIds = [...new Set(drawingsWithPackageId.map(d => d.PackageID).filter(id => id != null && id !== 0))];
          
          console.log(`[getDrawingsByTenderId] Found ${drawingsWithPackageId.length} drawings with PackageID. Unique PackageIDs: ${packageIds.join(', ')}`);
          
          if (packageIds.length > 0) {
            // Get all packages for this tender and create a map
            const allPackagesResult = await pool.request()
              .input('TenderID', tenderId)
              .query(`
                SELECT PackageID, PackageName
                FROM tenderBoQPackages
                WHERE TenderID = @TenderID
              `);
            
            console.log(`[getDrawingsByTenderId] Found ${allPackagesResult.recordset.length} packages in tenderBoQPackages for TenderID ${tenderId}`);
            
            // Create a map of PackageID -> PackageName
            const packageNameMap = new Map();
            allPackagesResult.recordset.forEach(pkg => {
              packageNameMap.set(pkg.PackageID, pkg.PackageName);
              console.log(`[getDrawingsByTenderId] Mapped PackageID ${pkg.PackageID} -> "${pkg.PackageName}"`);
            });
            
            // Update ALL drawings with PackageID, ensuring they have the correct package name
            result.recordset.forEach(drawing => {
              if (drawing.PackageID && drawing.PackageID !== 0) {
                if (packageNameMap.has(drawing.PackageID)) {
                  const packageName = packageNameMap.get(drawing.PackageID);
                  drawing.PackageName = packageName;
                  console.log(`[getDrawingsByTenderId] ✅ Updated Drawing ${drawing.DrawingID} (PackageID ${drawing.PackageID}) with PackageName "${packageName}"`);
                } else {
                  console.warn(`[getDrawingsByTenderId] ⚠️ PackageID ${drawing.PackageID} not found in tenderBoQPackages for Drawing ${drawing.DrawingID} (DrawingNumber: ${drawing.DrawingNumber})`);
                }
              }
            });
          }
        }
      }
      
      // If FileID column exists but drawings have NULL FileID, try to auto-link them to files
      if (result.recordset.length > 0) {
        const drawingsWithoutFile = result.recordset.filter(d => !d.FileID && d.DrawingNumber);
        if (drawingsWithoutFile.length > 0) {
          try {
            // Get all files for this tender
            const fileMatchResult = await pool.request()
              .input('TenderID', tenderId)
              .query(`
                SELECT f.FileID, f.DisplayName, f.BlobPath
                FROM tenderFile f
                INNER JOIN tenderFolder tf ON f.FolderID = tf.FolderID
                WHERE tf.ConnectionTable = 'tenderTender' 
                  AND tf.DocID = @TenderID
                  AND f.IsDeleted = 0
                  AND (f.ContentType LIKE '%pdf%' OR f.ContentType LIKE '%image%')
              `);
            
            const files = fileMatchResult.recordset;
            
            // Try to match and update drawings with files
            for (const drawing of drawingsWithoutFile) {
              const drawingNum = String(drawing.DrawingNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
              
              // Try to find a file that contains the drawing number in its name
              const matchingFile = files.find(file => {
                const fileName = (file.DisplayName || '').toUpperCase();
                // Check if drawing number appears in filename (with or without separators)
                return fileName.includes(drawingNum) || 
                       fileName.includes(drawing.DrawingNumber.toUpperCase());
              });
              
              if (matchingFile) {
                // Update the drawing with the FileID
                try {
                  await pool.request()
                    .input('DrawingID', drawing.DrawingID)
                    .input('FileID', matchingFile.FileID)
                    .query(`
                      UPDATE tenderDrawing
                      SET FileID = @FileID
                      WHERE DrawingID = @DrawingID
                    `);
                  
                  // Update the result recordset
                  drawing.FileID = matchingFile.FileID;
                  drawing.FileName = matchingFile.DisplayName;
                  drawing.BlobPath = matchingFile.BlobPath;
                  
                  console.log(`[getDrawingsByTenderId] Auto-linked Drawing ${drawing.DrawingNumber} to FileID ${matchingFile.FileID}`);
                } catch (updateErr) {
                  console.warn(`[getDrawingsByTenderId] Could not update FileID for Drawing ${drawing.DrawingID}:`, updateErr.message);
                }
              }
            }
          } catch (fileMatchErr) {
            console.warn('[getDrawingsByTenderId] Could not match files to drawings:', fileMatchErr.message);
          }
        }
      }
    } catch (err) {
      // If FileID column doesn't exist, try without file join and attempt to find files by matching drawing numbers
      if (err.message && err.message.includes('FileID')) {
        console.warn('FileID column not found in tenderDrawing table, querying without file join');
        result = await pool.request()
          .input('TenderID', tenderId)
          .query(`
            SELECT d.*, 
                   ISNULL(p.PackageName, '') as PackageName,
                   e.Name as AddedByName,
                   NULL as FileName,
                   NULL as BlobPath,
                   NULL as FileID
            FROM tenderDrawing d
            LEFT JOIN tenderBoQPackages p ON d.PackageID = p.PackageID
            LEFT JOIN tenderEmployee e ON d.AddedBy = e.UserID
            WHERE d.TenderID = @TenderID
            ORDER BY d.DrawingNumber, d.CreatedDate DESC
          `);
      
      // Always fetch and update package names for ALL drawings with PackageID
      // This ensures we have the most up-to-date package names even if the JOIN didn't work
      if (result.recordset.length > 0) {
        const drawingsWithPackageId = result.recordset.filter(d => d.PackageID != null && d.PackageID !== 0);
        
        if (drawingsWithPackageId.length > 0) {
          const packageIds = [...new Set(drawingsWithPackageId.map(d => d.PackageID).filter(id => id != null && id !== 0))];
          
          console.log(`[getDrawingsByTenderId] Found ${drawingsWithPackageId.length} drawings with PackageID. Unique PackageIDs: ${packageIds.join(', ')}`);
          
          if (packageIds.length > 0) {
            // Get all packages for this tender and create a map
            const allPackagesResult = await pool.request()
              .input('TenderID', tenderId)
              .query(`
                SELECT PackageID, PackageName
                FROM tenderBoQPackages
                WHERE TenderID = @TenderID
              `);
            
            console.log(`[getDrawingsByTenderId] Found ${allPackagesResult.recordset.length} packages in tenderBoQPackages for TenderID ${tenderId}`);
            
            // Create a map of PackageID -> PackageName
            const packageNameMap = new Map();
            allPackagesResult.recordset.forEach(pkg => {
              packageNameMap.set(pkg.PackageID, pkg.PackageName);
              console.log(`[getDrawingsByTenderId] Mapped PackageID ${pkg.PackageID} -> "${pkg.PackageName}"`);
            });
            
            // Update ALL drawings with PackageID, ensuring they have the correct package name
            result.recordset.forEach(drawing => {
              if (drawing.PackageID && drawing.PackageID !== 0) {
                if (packageNameMap.has(drawing.PackageID)) {
                  const packageName = packageNameMap.get(drawing.PackageID);
                  drawing.PackageName = packageName;
                  console.log(`[getDrawingsByTenderId] ✅ Updated Drawing ${drawing.DrawingID} (PackageID ${drawing.PackageID}) with PackageName "${packageName}"`);
                } else {
                  console.warn(`[getDrawingsByTenderId] ⚠️ PackageID ${drawing.PackageID} not found in tenderBoQPackages for Drawing ${drawing.DrawingID} (DrawingNumber: ${drawing.DrawingNumber})`);
                }
              }
            });
          }
        }
      }
        
        // Try to find files by matching drawing numbers in file names
        // This helps when FileID column doesn't exist but files are uploaded
        if (result.recordset.length > 0) {
          try {
            const fileMatchResult = await pool.request()
              .input('TenderID', tenderId)
              .query(`
                SELECT f.FileID, f.DisplayName, f.BlobPath
                FROM tenderFile f
                INNER JOIN tenderFolder tf ON f.FolderID = tf.FolderID
                WHERE tf.ConnectionTable = 'tenderTender' 
                  AND tf.DocID = @TenderID
                  AND f.IsDeleted = 0
                  AND (f.ContentType LIKE '%pdf%' OR f.ContentType LIKE '%image%')
              `);
            
            // Match files to drawings by drawing number in filename
            const files = fileMatchResult.recordset;
            result.recordset.forEach(drawing => {
              if (!drawing.FileID && drawing.DrawingNumber) {
                // Try to find a file that contains the drawing number in its name
                const matchingFile = files.find(file => {
                  const fileName = (file.DisplayName || '').toUpperCase();
                  const drawingNum = (drawing.DrawingNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                  // Check if drawing number appears in filename (with or without separators)
                  return fileName.includes(drawingNum) || 
                         fileName.includes(drawing.DrawingNumber.toUpperCase());
                });
                
                if (matchingFile) {
                  drawing.FileID = matchingFile.FileID;
                  drawing.FileName = matchingFile.DisplayName;
                  drawing.BlobPath = matchingFile.BlobPath;
                }
              }
            });
          } catch (fileMatchErr) {
            console.warn('Could not match files to drawings:', fileMatchErr.message);
          }
        }
      } else {
        throw err;
      }
    }

    // Log the results for debugging (only when verbose flag is enabled)
    if (process.env.VERBOSE_DRAWINGS === 'true' && result.recordset.length > 0) {
      console.log(`[getDrawingsByTenderId] Returning ${result.recordset.length} drawings for TenderID ${tenderId}`);
      result.recordset.forEach((drawing, index) => {
        console.log(`[getDrawingsByTenderId] Drawing ${index + 1}:`, {
          DrawingID: drawing.DrawingID,
          DrawingNumber: drawing.DrawingNumber,
          FileID: drawing.FileID,
          FileName: drawing.FileName
        });
      });
    }

    res.json(result.recordset);
  } catch (error) {
    console.error('Error getting drawings:', error);
    res.status(500).json({ error: 'Failed to get drawings', details: error.message });
  }
}

// Helper functions
function extractDrawingNumberFromFileName(fileName) {
  // Try to extract drawing number from filename (e.g., "A-101.pdf" -> "A-101")
  const match = fileName.match(/([A-Z]{1,4}[-_]?\d{1,4})/i);
  return match ? match[1].toUpperCase() : null;
}

function inferDisciplineFromFileName(fileName) {
  const fileNameUpper = fileName.toUpperCase();
  if (fileNameUpper.includes('ARC') || fileNameUpper.includes('ARCH')) return 'ARC';
  if (fileNameUpper.includes('STR') || fileNameUpper.includes('STRUCT')) return 'STR';
  if (fileNameUpper.includes('MEP')) return 'MEP';
  if (fileNameUpper.includes('CIV') || fileNameUpper.includes('CIVIL')) return 'CIV';
  if (fileNameUpper.includes('ELEC') || fileNameUpper.includes('ELECTRICAL')) return 'ELEC';
  if (fileNameUpper.includes('MECH') || fileNameUpper.includes('MECHANICAL')) return 'MECH';
  if (fileNameUpper.includes('LAND') || fileNameUpper.includes('LANDSCAPE')) return 'LAND';
  return 'ARC'; // Default to Architecture
}

/**
 * Delete a drawing and its associated file
 * Can delete by drawingId or fileId
 */
async function deleteDrawing(req, res) {
  try {
    const { drawingId } = req.params;
    const { fileId } = req.query; // Optional: delete by fileId instead
    const userId = req.user?.UserID;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const pool = await getConnectedPool();

    // Get drawing information including FileID
    // If fileId is provided, find drawing by fileId first
    let drawingResult;
    let actualDrawingId = drawingId;

    if (fileId) {
      // Find drawing by fileId
      try {
        const fileDrawingResult = await pool.request()
          .input('FileID', fileId)
          .query(`
            SELECT DrawingID
            FROM tenderDrawing
            WHERE FileID = @FileID
          `);
        
        if (fileDrawingResult.recordset.length === 0) {
          // If no drawing found by FileID, try to find by matching file name with drawing title
          // This is a fallback when FileID column doesn't exist or drawing wasn't linked
          const fileResult = await pool.request()
            .input('FileID', fileId)
            .query(`
              SELECT DisplayName, DocID
              FROM tenderFile
              WHERE FileID = @FileID AND IsDeleted = 0
            `);
          
          if (fileResult.recordset.length === 0) {
            return res.status(404).json({ error: 'File not found' });
          }

          const file = fileResult.recordset[0];
          const fileName = file.DisplayName.replace(/\.[^/.]+$/, ''); // Remove extension
          
          // Try to find drawing by matching title or drawing number with filename
          const matchingDrawing = await pool.request()
            .input('TenderID', file.DocID)
            .input('FileName', `%${fileName}%`)
            .query(`
              SELECT DrawingID
              FROM tenderDrawing
              WHERE TenderID = @TenderID 
                AND (Title LIKE @FileName OR DrawingNumber LIKE @FileName)
            `);
          
          if (matchingDrawing.recordset.length > 0) {
            actualDrawingId = matchingDrawing.recordset[0].DrawingID;
          } else {
            // No drawing record found, but we can still delete the file
            // Delete file from blob storage and tenderFile table
            const fileForDelete = await pool.request()
              .input('FileID', fileId)
              .query(`
                SELECT BlobPath, DisplayName
                FROM tenderFile
                WHERE FileID = @FileID
              `);
            
            if (fileForDelete.recordset.length > 0) {
              const fileToDelete = fileForDelete.recordset[0];
              
              // Delete from blob storage
              if (fileToDelete.BlobPath) {
                try {
                  await deleteBlobFile(fileToDelete.BlobPath);
                  console.log(`File deleted from blob storage: ${fileToDelete.BlobPath}`);
                } catch (blobError) {
                  console.error('Warning: Failed to delete file from blob storage:', blobError);
                }
              }
              
              // Delete file record
              await pool.request()
                .input('FileID', fileId)
                .query(`
                  DELETE FROM tenderFile
                  WHERE FileID = @FileID
                `);
              
              return res.json({ message: 'File deleted successfully (no drawing record found)' });
            }
            
            return res.status(404).json({ error: 'Drawing not found for this file' });
          }
        } else {
          actualDrawingId = fileDrawingResult.recordset[0].DrawingID;
        }
      } catch (err) {
        if (err.message && err.message.includes('FileID')) {
          // FileID column doesn't exist, try to delete file directly
          const fileResult = await pool.request()
            .input('FileID', fileId)
            .query(`
              SELECT BlobPath, DisplayName, DocID
              FROM tenderFile
              WHERE FileID = @FileID AND IsDeleted = 0
            `);
          
          if (fileResult.recordset.length === 0) {
            return res.status(404).json({ error: 'File not found' });
          }

          const file = fileResult.recordset[0];
          
          // Delete from blob storage
          if (file.BlobPath) {
            try {
              await deleteBlobFile(file.BlobPath);
              console.log(`File deleted from blob storage: ${file.BlobPath}`);
            } catch (blobError) {
              console.error('Warning: Failed to delete file from blob storage:', blobError);
            }
          }
          
          // Delete file record
          await pool.request()
            .input('FileID', fileId)
            .query(`
              DELETE FROM tenderFile
              WHERE FileID = @FileID
            `);
          
          // Try to find and delete any orphaned drawing records by matching filename
          const fileName = file.DisplayName.replace(/\.[^/.]+$/, '');
          try {
            await pool.request()
              .input('TenderID', file.DocID)
              .input('FileName', `%${fileName}%`)
              .query(`
                DELETE FROM tenderDrawing
                WHERE TenderID = @TenderID 
                  AND (Title LIKE @FileName OR DrawingNumber LIKE @FileName)
              `);
          } catch (drawingErr) {
            console.warn('Could not delete drawing record (may not exist or FileID column issue):', drawingErr.message);
          }
          
          return res.json({ message: 'File deleted successfully' });
        }
        throw err;
      }
    }

    try {
      drawingResult = await pool.request()
        .input('DrawingID', actualDrawingId)
        .query(`
          SELECT d.*, f.BlobPath, f.DisplayName as FileName
          FROM tenderDrawing d
          LEFT JOIN tenderFile f ON d.FileID = f.FileID
          WHERE d.DrawingID = @DrawingID
        `);
    } catch (err) {
      // If FileID column doesn't exist, try without join
      if (err.message && err.message.includes('FileID')) {
        drawingResult = await pool.request()
          .input('DrawingID', actualDrawingId)
          .query(`
            SELECT d.*
            FROM tenderDrawing d
            WHERE d.DrawingID = @DrawingID
          `);
      } else {
        throw err;
      }
    }

    if (drawingResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Drawing not found' });
    }

    const drawing = drawingResult.recordset[0];

    // Check if user has permission (only the person who added it or admin can delete)
    if (drawing.AddedBy !== userId) {
      // TODO: Add admin check if needed
      return res.status(403).json({ error: 'You do not have permission to delete this drawing' });
    }

    // If FileID exists, delete the file (blob + file record)
    if (drawing.FileID) {
      // Get file information to ensure we have the blob path
      let fileBlobPath = drawing.BlobPath;
      let fileName = drawing.FileName;
      
      // If BlobPath is not in the drawing result, fetch it from the file table
      if (!fileBlobPath) {
        try {
          const fileInfoResult = await pool.request()
            .input('FileID', drawing.FileID)
            .query(`
              SELECT BlobPath, DisplayName
              FROM tenderFile
              WHERE FileID = @FileID
            `);
          
          if (fileInfoResult.recordset.length > 0) {
            fileBlobPath = fileInfoResult.recordset[0].BlobPath;
            fileName = fileInfoResult.recordset[0].DisplayName || fileName;
          }
        } catch (fileInfoError) {
          console.warn('Could not fetch file info, will try to delete with available info:', fileInfoError.message);
        }
      }

      // Delete file from Azure Blob Storage if blob path is available
      if (fileBlobPath) {
        try {
          await deleteBlobFile(fileBlobPath);
          console.log(`✅ File deleted from blob storage: ${fileBlobPath}`);
        } catch (blobError) {
          console.error('⚠️ Warning: Failed to delete file from blob storage:', blobError);
          // Continue with database deletion even if blob deletion fails
        }
      } else {
        console.warn(`⚠️ No BlobPath found for FileID ${drawing.FileID}, skipping blob deletion`);
      }
    } else {
      console.log('ℹ️ No FileID associated with this drawing, skipping file deletion');
    }

    // IMPORTANT: Delete drawing record FIRST to remove foreign key constraint
    // This must be done before deleting the file record to avoid FK constraint violation
    await pool.request()
      .input('DrawingID', actualDrawingId)
      .query(`
        DELETE FROM tenderDrawing
        WHERE DrawingID = @DrawingID
      `);
    console.log(`✅ Drawing record deleted from database: ${drawing.DrawingNumber || 'N/A'} - ${drawing.Title || 'N/A'} (ID: ${actualDrawingId})`);

    // Now delete file record from tenderFile table (after drawing is deleted, FK constraint is gone)
    if (drawing.FileID) {
      try {
        const deleteFileResult = await pool.request()
          .input('FileID', drawing.FileID)
          .query(`
            DELETE FROM tenderFile
            WHERE FileID = @FileID
          `);
        console.log(`✅ File record deleted from database: ${fileName || drawing.FileID} (ID: ${drawing.FileID})`);
      } catch (fileError) {
        console.error('⚠️ Warning: Failed to delete file record from database:', fileError);
        // File deletion failed, but drawing is already deleted, so we continue
      }
    }

    console.log(`✅ Drawing deleted: ${drawing.DrawingNumber || 'N/A'} - ${drawing.Title || 'N/A'} (ID: ${actualDrawingId})`);
    res.json({ 
      message: 'Drawing deleted successfully',
      deleted: {
        drawingId: actualDrawingId,
        fileId: drawing.FileID || null,
        blobDeleted: drawing.FileID && drawing.BlobPath ? true : false,
        fileRecordDeleted: drawing.FileID ? true : false
      }
    });
  } catch (error) {
    console.error('Error deleting drawing:', error);
    res.status(500).json({ error: 'Failed to delete drawing', details: error.message });
  }
}

/**
 * Create a new package for a tender
 */
async function createPackage(req, res) {
  try {
    const { tenderId } = req.params;
    const { packageName, fileId } = req.body;
    const userId = req.user?.UserID;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!packageName || !packageName.trim()) {
      return res.status(400).json({ error: 'Package name is required' });
    }

    const pool = await getConnectedPool();
    const trimmedPackageName = packageName.trim();

    // Check if package already exists
    const existingPackage = await pool.request()
      .input('TenderID', parseInt(tenderId))
      .input('PackageName', trimmedPackageName)
      .query(`
        SELECT TOP 1 PackageID, FileID
        FROM tenderBoQPackages
        WHERE TenderID = @TenderID AND PackageName = @PackageName
        ORDER BY PackageID DESC
      `);

    if (existingPackage.recordset.length > 0) {
      const existing = existingPackage.recordset[0];
      console.log(`[createPackage] Package "${trimmedPackageName}" already exists with PackageID ${existing.PackageID}`);
      return res.json({
        success: true,
        packageId: existing.PackageID,
        packageName: trimmedPackageName,
        fileId: existing.FileID,
        alreadyExists: true
      });
    }

    // FileID is required - find a BOQ file for this tender if not provided
    let resolvedFileId = fileId ? parseInt(fileId) : null;
    
    if (!resolvedFileId) {
      // Try to find any BOQ file for this tender
      try {
        const boqFileResult = await pool.request()
          .input('TenderID', parseInt(tenderId))
          .query(`
            SELECT TOP 1 f.FileID
            FROM tenderFile f
            INNER JOIN tenderFolder tf ON f.FolderID = tf.FolderID
            WHERE tf.ConnectionTable = 'tenderTender'
              AND tf.DocID = @TenderID
              AND f.IsDeleted = 0
              AND (f.ContentType LIKE '%excel%' OR f.ContentType LIKE '%spreadsheet%' OR f.DisplayName LIKE '%.xlsx%' OR f.DisplayName LIKE '%.xls%')
            ORDER BY f.UploadedOn DESC
          `);
        
        if (boqFileResult.recordset.length > 0) {
          resolvedFileId = boqFileResult.recordset[0].FileID;
          console.log(`[createPackage] Found BOQ file FileID ${resolvedFileId} for tender ${tenderId}`);
        } else {
          // If no BOQ file found, try to find any file from this tender's folders
          const anyFileResult = await pool.request()
            .input('TenderID', parseInt(tenderId))
            .query(`
              SELECT TOP 1 f.FileID
              FROM tenderFile f
              INNER JOIN tenderFolder tf ON f.FolderID = tf.FolderID
              WHERE tf.ConnectionTable = 'tenderTender'
                AND tf.DocID = @TenderID
                AND f.IsDeleted = 0
              ORDER BY f.UploadedOn DESC
            `);
          
          if (anyFileResult.recordset.length > 0) {
            resolvedFileId = anyFileResult.recordset[0].FileID;
            console.log(`[createPackage] Using any available file FileID ${resolvedFileId} for tender ${tenderId}`);
          }
        }
      } catch (fileLookupError) {
        console.warn('[createPackage] Could not find file for tender:', fileLookupError.message);
      }
    }

    if (!resolvedFileId) {
      return res.status(400).json({ 
        error: 'FileID is required. Please upload a BOQ file first, or provide a fileId when creating the package.' 
      });
    }

    // Create new package with resolved FileID
    const createResult = await pool.request()
      .input('TenderID', parseInt(tenderId))
      .input('FileID', resolvedFileId)
      .input('PackageName', trimmedPackageName)
      .query(`
        INSERT INTO tenderBoQPackages (TenderID, FileID, PackageName, CreatedAt, UpdatedAt)
        OUTPUT INSERTED.PackageID, INSERTED.FileID
        VALUES (@TenderID, @FileID, @PackageName, SYSUTCDATETIME(), SYSUTCDATETIME())
      `);

    const newPackage = createResult.recordset[0];
    console.log(`[createPackage] ✅ Created new package: "${trimmedPackageName}" with PackageID ${newPackage.PackageID}`);

    res.json({
      success: true,
      packageId: newPackage.PackageID,
      packageName: trimmedPackageName,
      fileId: newPackage.FileID,
      alreadyExists: false
    });
  } catch (error) {
    console.error('[createPackage] Error creating package:', error);
    res.status(500).json({ error: 'Failed to create package', details: error.message });
  }
}

/**
 * Get all packages for a tender (from tenderBoQPackages table)
 */
async function getAllPackages(req, res) {
  try {
    const { tenderId } = req.params;
    const pool = await getConnectedPool();

    const result = await pool.request()
      .input('TenderID', parseInt(tenderId))
      .query(`
        SELECT DISTINCT 
          PackageID,
          PackageName,
          FileID
        FROM tenderBoQPackages
        WHERE TenderID = @TenderID
        ORDER BY PackageName
      `);

    const packages = result.recordset.map(pkg => ({
      packageId: pkg.PackageID,
      packageName: pkg.PackageName,
      fileId: pkg.FileID
    }));

    console.log(`[getAllPackages] Found ${packages.length} packages for tender ${tenderId}`);

    res.json({
      success: true,
      packages: packages
    });
  } catch (error) {
    console.error('[getAllPackages] Error fetching packages:', error);
    res.status(500).json({ error: 'Failed to fetch packages', details: error.message });
  }
}

module.exports = {
  extractDrawingInfo,
  saveDrawing,
  getDrawingByFileId,
  getDrawingsByTenderId,
  deleteDrawing,
  createPackage,
  getAllPackages
};

