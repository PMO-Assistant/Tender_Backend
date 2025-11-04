const axios = require('axios');
const ExcelJS = require('exceljs');
const { getConnectedPool } = require('../../config/database');
const { downloadFile, uploadFile } = require('../../config/azureBlobService');
const openAIService = require('../../config/openAIService');
// Utility: expand compact range string like "1-3,5,9-10" to array of numbers
function expandRangeString(rangeStr) {
  const result = [];
  if (!rangeStr) return result;
  String(rangeStr).split(',').map(s => s.trim()).filter(Boolean).forEach(part => {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = parseInt(m[2], 10);
      if (!isNaN(start) && !isNaN(end) && end >= start) {
        for (let i = start; i <= end; i++) result.push(i);
      }
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) result.push(n);
    }
  });
  return result;
}

async function streamToBuffer(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data));
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    readableStream.on('error', reject);
  });
}

// Helper: upload buffer as a new file into tenderFile and Azure Blob
async function uploadBufferToFolder(buffer, folderId, displayName, tenderId, userId) {
  const pool = await getConnectedPool();
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const timestamp = Date.now();
  const safeName = String(displayName || 'BOQ.xlsx').replace(/\s+/g, ' ');
  const blobPath = `uploads/${timestamp}_${safeName}`;
  // Upload to Azure
  await uploadFile(blobPath, buffer, mimeType);
  // Insert DB record
  const result = await pool.request()
    .input('AddBy', userId ? parseInt(userId) : null)
    .input('FolderID', folderId || null)
    .input('BlobPath', blobPath)
    .input('DisplayName', safeName)
    .input('Size', buffer.length)
    .input('ContentType', mimeType)
    .input('Status', 1)
    .input('DocID', tenderId ? parseInt(tenderId) : null)
    .input('ConnectionTable', tenderId ? 'tenderTender' : null)
    .input('Metadata', JSON.stringify({ title: displayName }))
    .input('ExtractedText', null)
    .query(`
      INSERT INTO tenderFile (AddBy, FolderID, BlobPath, DisplayName, UploadedOn, Size, ContentType, Status, DocID, ConnectionTable, Metadata, ExtractedText)
      VALUES (@AddBy, @FolderID, @BlobPath, @DisplayName, GETDATE(), @Size, @ContentType, @Status, @DocID, @ConnectionTable, @Metadata, @ExtractedText);
      SELECT SCOPE_IDENTITY() as FileID;
    `);
  const newFileId = result.recordset[0]?.FileID;
  return { fileId: newFileId, blobPath, contentType: mimeType };
}


// Overwrite an existing tenderFile's blob and update its metadata (size, UploadedOn)
async function overwriteExistingFile(fileId, blobPath, buffer, contentType) {
  const pool = await getConnectedPool();
  const mimeType = contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  // Overwrite blob at same path
  await uploadFile(blobPath, buffer, mimeType);
  // Update DB row
  await pool.request()
    .input('FileID', parseInt(fileId))
    .input('Size', buffer.length)
    .query(`
      UPDATE tenderFile
      SET Size = @Size, UploadedOn = GETDATE()
      WHERE FileID = @FileID
    `);
  return { fileId, blobPath, contentType: mimeType };
}



async function getBoqTextForFile(fileRow) {
  // Prefer extracted text if present
  if (fileRow.ExtractedText && fileRow.ExtractedText.length > 0) {
    return fileRow.ExtractedText;
  }
  // Else download and extract from Excel/PDF/etc.
  if (!fileRow.BlobPath) return '';
  try {
    const stream = await downloadFile(fileRow.BlobPath);
    const buffer = await streamToBuffer(stream);
    const fileName = fileRow.DisplayName || 'BOQ.xlsx';
    const contentType = fileRow.ContentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    // Use existing text extractors
    return await openAIService.extractMetadata(buffer, fileName, contentType);
  } catch (e) {
    console.error('Failed to fetch or extract BOQ text:', e);
    return '';
  }
}

function simpleHeuristicPackages(text) {
  const candidates = [
    'Preliminaries', 'Civil Works', 'Structural Works', 'Concrete', 'Formwork', 'Reinforcement',
    'Masonry', 'Steelwork', 'Roofing', 'Cladding', 'Windows & Doors', 'Finishes', 'Flooring',
    'Ceilings', 'Joinery', 'Painting', 'Mechanical', 'Electrical', 'Plumbing', 'Fire Services',
    'External Works', 'Landscaping', 'Demolition', 'Earthworks'
  ];
  const lower = (text || '').toLowerCase();
  const found = new Set();
  
  // Try to find packages based on text content
  for (const c of candidates) {
    if (lower.includes(c.toLowerCase().split(' ')[0])) {
      found.add(c);
    }
  }
  
  // Additional detection based on common BOQ content
  if (lower.includes('structural') || lower.includes('joist') || lower.includes('stud') || lower.includes('beam')) {
    found.add('Structural Works');
  }
  if (lower.includes('electrical') || lower.includes('lighting') || lower.includes('power') || lower.includes('cable')) {
    found.add('Electrical');
  }
  if (lower.includes('mechanical') || lower.includes('hvac') || lower.includes('air') || lower.includes('duct')) {
    found.add('Mechanical');
  }
  if (lower.includes('plumbing') || lower.includes('water') || lower.includes('drain') || lower.includes('pipe')) {
    found.add('Plumbing');
  }
  if (lower.includes('finish') || lower.includes('paint') || lower.includes('floor') || lower.includes('wall')) {
    found.add('Finishes');
  }
  if (lower.includes('civil') || lower.includes('earthwork') || lower.includes('foundation') || lower.includes('excavation')) {
    found.add('Civil Works');
  }
  
  // If no packages found, provide comprehensive defaults
  if (found.size === 0) {
    console.log('No packages detected in text, using comprehensive defaults');
    const defaultPackages = [
      'Preliminaries',
      'Civil Works', 
      'Structural Works', 
      'Mechanical',
      'Electrical', 
      'Plumbing', 
      'Finishes',
      'External Works'
    ];
    defaultPackages.forEach(p => found.add(p));
  }
  
  const result = Array.from(found);
  // Only log fallback packages in debug mode (reduce console noise)
  if (process.env.DEBUG_BOQ === 'true') {
    console.log(`Generated ${result.length} fallback packages:`, result);
  }
  return result;
}

async function callOpenAIForPackages(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('No OpenAI API key found, using fallback packages');
    return { packages: simpleHeuristicPackages(text), source: 'fallback' };
  }
  
  const truncated = (text || '').slice(0, 12000);
  const prompt = `You are classifying a Bill of Quantities (BOQ) into high-level trade packages.
Return ONLY strict JSON with this shape: { "packages": ["string", ...] }.
Rules:
- Use short, conventional package names (e.g., "Civil Works", "Structural Works", "Flooring", "Electrical", "Mechanical", "Plumbing", "Finishes", "External Works").
- Base your list on the BOQ content. Do not invent irrelevant trades.
- Avoid duplicates; 5-15 items is typical. Do not include explanations.
- Do not list line items; only the package names.

BOQ text (may be truncated):\n${truncated}`;

  try {
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: `${prompt}\n\nReturn only JSON.` }],
      max_tokens: 400,
      temperature: 0.2
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const content = resp.data?.choices?.[0]?.message?.content || '';
    try {
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      const jsonStr = jsonStart >= 0 ? content.slice(jsonStart, jsonEnd + 1) : content;
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed.packages)) {
        // Normalize
        const uniq = Array.from(new Set(parsed.packages.map(p => String(p).trim()).filter(Boolean)));
        return { packages: uniq, source: 'openai' };
      }
    } catch (_) {}
    // Fallback if parsing fails
    return { packages: simpleHeuristicPackages(text), source: 'fallback' };
  } catch (e) {
    // Only log if it's not a simple missing API key (quietly use fallback)
    if (process.env.OPENAI_API_KEY) {
      console.log('OpenAI API error, using fallback packages:', e.response?.data?.message || e.message);
    }
    return { packages: simpleHeuristicPackages(text), source: 'fallback' };
  }
}

async function callOpenAIForBOQBlocks(text, packages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('No OpenAI API key found, using fallback for BOQ blocks');
    return { blocks: [], source: 'fallback' };
  }
  
  const truncated = (text || '').slice(0, 15000);
  const prompt = `You are parsing a Bill of Quantities (BOQ) Excel file into structured blocks/sections.

IMPORTANT: Extract the document as COMPLETE BLOCKS/SECTIONS, not individual lines. Each block contains all items within that section.

The available packages are: ${packages.join(', ')}

Return ONLY strict JSON with this shape: { "blocks": [{"blockName": "string", "blockOrder": "number", "package": "string", "items": [{"code": "string", "description": "string", "qty": "number", "uom": "string", "rate": "number", "itemOrder": "number"}, ...]}, ...] }

CRITICAL RULES:
1. **Block Detection**: Identify complete sections like "CIVIL WORKS", "FIRE SECURITY", "ELECTRICAL", "MECHANICAL"
2. **Preserve Everything**: Keep all content within each block - titles, subtitles, items, sub-items
3. **Maintain Order**: Keep the original order of blocks and items within blocks
4. **Package Assignment**: Assign each block to the most appropriate package from the list
5. **Code Inheritance**: Handle empty codes by inheriting from above within the same block
6. **Hierarchical Items**: Preserve sub-items with prefixes like "^^^^^" within their parent block

EXAMPLES:
- "CIVIL WORKS" block with items → {"blockName": "CIVIL WORKS", "blockOrder": 1, "package": "Civil Works", "items": [{"code": "100", "description": "100mm concrete slab", "qty": 500, "uom": "m2", "rate": 45.00, "itemOrder": 1}, {"code": "101", "description": "200mm foundation", "qty": 200, "uom": "m3", "rate": 120.00, "itemOrder": 2}]}
- "FIRE SECURITY" block with items → {"blockName": "FIRE SECURITY", "blockOrder": 2, "package": "Fire Security", "items": [{"code": "200", "description": "Fire alarm system", "qty": 1, "uom": "nr", "rate": 5000.00, "itemOrder": 1}]}

BOQ text (may be truncated):\n${truncated}`;

  try {
    const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: `${prompt}\n\nReturn only JSON.` }],
      max_tokens: 3000,
      temperature: 0.1
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const content = resp.data?.choices?.[0]?.message?.content || '';
    try {
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      const jsonStr = jsonStart >= 0 ? content.slice(jsonStart, jsonEnd + 1) : content;
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed.blocks)) {
        return { blocks: parsed.blocks, source: 'openai' };
      }
    } catch (_) {}
    console.log('OpenAI response parsing failed for BOQ blocks, using fallback');
    return { blocks: [], source: 'fallback' };
  } catch (e) {
    console.log('OpenAI API error for BOQ blocks, using fallback:', e.response?.data?.message || e.message);
    return { blocks: [], source: 'fallback' };
  }
}

async function callMistralForBOQBlocks(text, packages) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.log('No Mistral API key found, using fallback for BOQ blocks');
    return { blocks: [], source: 'fallback' };
  }
  
  const truncated = (text || '').slice(0, 15000);
  const prompt = `You are parsing a Bill of Quantities (BOQ) Excel file into structured blocks/sections.

IMPORTANT: Extract the document as COMPLETE BLOCKS/SECTIONS, not individual lines. Each block contains all items within that section.

The available packages are: ${packages.join(', ')}

Return ONLY strict JSON with this shape: { "blocks": [{"blockName": "string", "blockOrder": "number", "package": "string", "items": [{"code": "string", "description": "string", "qty": "number", "uom": "string", "rate": "number", "itemOrder": "number"}, ...]}, ...] }

CRITICAL RULES:
1. **Block Detection**: Identify complete sections like "CIVIL WORKS", "FIRE SECURITY", "ELECTRICAL", "MECHANICAL"
2. **Preserve Everything**: Keep all content within each block - titles, subtitles, items, sub-items
3. **Maintain Order**: Keep the original order of blocks and items within blocks
4. **Package Assignment**: Assign each block to the most appropriate package from the list
5. **Code Inheritance**: Handle empty codes by inheriting from above within the same block
6. **Hierarchical Items**: Preserve sub-items with prefixes like "^^^^^" within their parent block

EXAMPLES:
- "CIVIL WORKS" block with items → {"blockName": "CIVIL WORKS", "blockOrder": 1, "package": "Civil Works", "items": [{"code": "100", "description": "100mm concrete slab", "qty": 500, "uom": "m2", "rate": 45.00, "itemOrder": 1}, {"code": "101", "description": "200mm foundation", "qty": 200, "uom": "m3", "rate": 120.00, "itemOrder": 2}]}
- "FIRE SECURITY" block with items → {"blockName": "FIRE SECURITY", "blockOrder": 2, "package": "Fire Security", "items": [{"code": "200", "description": "Fire alarm system", "qty": 1, "uom": "nr", "rate": 5000.00, "itemOrder": 1}]}

BOQ text (may be truncated):\n${truncated}`;

  try {
    const resp = await axios.post('https://api.mistral.ai/v1/chat/completions', {
      model: 'mistral-large-latest',
      messages: [{ role: 'user', content: `${prompt}\n\nReturn only JSON.` }],
      max_tokens: 3000,
      temperature: 0.1
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const content = resp.data?.choices?.[0]?.message?.content || '';
    try {
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      const jsonStr = jsonStart >= 0 ? content.slice(jsonStart, jsonEnd + 1) : content;
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed.blocks)) {
        return { blocks: parsed.blocks, source: 'mistral' };
      }
    } catch (_) {}
    console.log('Mistral response parsing failed for BOQ blocks, using fallback');
    return { blocks: [], source: 'fallback' };
  } catch (e) {
    // Check if it's a capacity/service tier error
    const errorData = e.response?.data;
    if (errorData && (errorData.code === '3505' || errorData.type === 'service_tier_capacity_exceeded')) {
      console.log('Mistral service tier capacity exceeded for BOQ blocks, using fallback');
    } else {
      console.log('Mistral API error for BOQ blocks, using fallback:', e.response?.data?.message || e.message);
    }
    return { blocks: [], source: 'fallback' };
  }
}

// Helper function to convert rowPackageAssignments to row ranges per package per sheet
function convertRowAssignmentsToRanges(rowPackageAssignments, allPackages) {
  const packageRangesBySheet = {}; // packageName -> sheetName -> [rowIndices]
  const globalRows = []; // Rows assigned to "Global" package
  
  // Process all sheet assignments
  for (const [sheetName, rowAssignments] of Object.entries(rowPackageAssignments)) {
    for (const [rowIndexStr, packageName] of Object.entries(rowAssignments)) {
      const rowIndex = parseInt(rowIndexStr, 10);
      
      if (!packageName || packageName.trim() === '') continue;
      
      if (packageName === 'Global') {
        globalRows.push({ sheetName, rowIndex });
      } else {
        if (!packageRangesBySheet[packageName]) {
          packageRangesBySheet[packageName] = {};
        }
        if (!packageRangesBySheet[packageName][sheetName]) {
          packageRangesBySheet[packageName][sheetName] = [];
        }
        packageRangesBySheet[packageName][sheetName].push(rowIndex);
      }
    }
  }
  
  // Sort row indices for each package/sheet combination
  for (const packageName of Object.keys(packageRangesBySheet)) {
    for (const sheetName of Object.keys(packageRangesBySheet[packageName])) {
      packageRangesBySheet[packageName][sheetName].sort((a, b) => a - b);
    }
  }
  
  return { packageRangesBySheet, globalRows };
}

// ExcelJS-based BOQ splitting functions - User selects row ranges per package
async function splitBOQIntoPackages(fileBuffer, fileName, packages, packageRanges, headerRange, rowPackageAssignments = null) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    
    const splitFiles = [];
    let processedRanges = {};
    let globalRows = [];
    
    // If rowPackageAssignments is provided (v2), use that; otherwise use legacy packageRanges
    if (rowPackageAssignments && Object.keys(rowPackageAssignments).length > 0) {
      console.log('[splitBOQIntoPackages] Processing v2 row assignments:', JSON.stringify(rowPackageAssignments, null, 2));
      const converted = convertRowAssignmentsToRanges(rowPackageAssignments, packages);
      processedRanges = converted.packageRangesBySheet;
      globalRows = converted.globalRows;
      console.log('[splitBOQIntoPackages] Converted package ranges:', JSON.stringify(processedRanges, null, 2));
      console.log('[splitBOQIntoPackages] Global rows:', globalRows);
      
      // Validate that we have rows to process
      const totalRows = Object.values(processedRanges).reduce((sum, sheetRanges) => {
        return sum + Object.values(sheetRanges).reduce((sheetSum, rows) => sheetSum + rows.length, 0);
      }, 0);
      console.log(`[splitBOQIntoPackages] Total package-specific rows: ${totalRows}, Global rows: ${globalRows.length}`);
      
      if (totalRows === 0 && globalRows.length === 0) {
        console.warn('[splitBOQIntoPackages] WARNING: No rows found in rowPackageAssignments!');
      }
    } else {
      // Legacy format - convert to new format
      for (const packageName of packages) {
        const packageRange = packageRanges[packageName];
        if (packageRange) {
          const sheetName = packageRange.sheet || workbook.worksheets[0].name;
          if (!processedRanges[packageName]) {
            processedRanges[packageName] = {};
          }
          // Create array of row indices from startRow to endRow
          processedRanges[packageName][sheetName] = [];
          for (let row = packageRange.startRow; row <= packageRange.endRow; row++) {
            processedRanges[packageName][sheetName].push(row);
          }
        }
      }
      console.log('Processing legacy package ranges:', processedRanges);
    }
    
    // Get all unique packages (excluding "Global")
    const uniquePackages = [...new Set(packages.filter(p => p !== 'Global'))];
    
    // Create one file per package (excluding "Global")
    for (const packageName of uniquePackages) {
      const packageRowsBySheet = processedRanges[packageName];
      if (!packageRowsBySheet || Object.keys(packageRowsBySheet).length === 0) {
        // Still create file if there are Global rows
        if (globalRows.length === 0) {
          console.log(`No rows found for package: ${packageName}`);
          continue;
        }
      }
      
      // Create new workbook for this package
      const packageWorkbook = new ExcelJS.Workbook();
      // Copy original workbook properties
      packageWorkbook.creator = workbook.creator;
      packageWorkbook.lastModifiedBy = workbook.lastModifiedBy;
      packageWorkbook.created = workbook.created;
      packageWorkbook.modified = workbook.modified;

      // Build a per-sheet map of rows (include global rows)
      const rowsBySheet = {};
      for (const [sheetName, rowIndices] of Object.entries(packageRowsBySheet || {})) {
        rowsBySheet[sheetName] = Array.isArray(rowIndices) ? [...rowIndices] : [];
      }
      for (const { sheetName, rowIndex } of globalRows) {
        if (!rowsBySheet[sheetName]) rowsBySheet[sheetName] = [];
        rowsBySheet[sheetName].push(rowIndex);
      }

      // Prepare a flat list for metadata and sorting
      const allPackageRows = [];
      let totalRowsCopied = 0;

      // For each source sheet, create a corresponding worksheet and copy rows
      const sourceSheetNames = Object.keys(rowsBySheet).sort((a,b)=>a.localeCompare(b));
      for (const srcSheetName of sourceSheetNames) {
        const sourceSheet = workbook.getWorksheet(srcSheetName);
        if (!sourceSheet) {
          console.log(`Sheet ${srcSheetName} not found, skipping.`);
          continue;
        }

        const targetWorksheet = packageWorkbook.addWorksheet(srcSheetName);

        // Copy header range for this sheet, if provided
        let nextTargetRow = 1;
        if (headerRange && headerRange.start !== null && headerRange.end !== null) {
          // Copy header from this source sheet (if exists)
          const headerSourceSheet = workbook.getWorksheet(srcSheetName) || sourceSheet;
          const headerRowsCopied = await copyHeaderRange(headerSourceSheet, targetWorksheet, headerRange);
          nextTargetRow = headerRowsCopied + 1;
        }

        // Sort and unique the rows
        const uniqueRows = Array.from(new Set(rowsBySheet[srcSheetName].filter(r=>typeof r==='number' && !isNaN(r)))).sort((a,b)=>a-b);
        for (const rowIndex of uniqueRows) {
          const srcRowObj = sourceSheet.getRow(rowIndex);
          const tgtRowObj = targetWorksheet.getRow(nextTargetRow);

          // Copy row height
          if (srcRowObj.height) tgtRowObj.height = srcRowObj.height;

          // Copy all cells
          srcRowObj.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const targetCell = tgtRowObj.getCell(colNumber);
            targetCell.value = getSafeCellValue(cell);
            if (cell.font) targetCell.font = { ...cell.font };
            if (cell.fill) targetCell.fill = { ...cell.fill };
            if (cell.border) targetCell.border = { ...cell.border };
            if (cell.alignment) targetCell.alignment = { ...cell.alignment };
            if (cell.numFmt) targetCell.numFmt = cell.numFmt;
            if (cell.style) targetCell.style = cell.style;
            if (cell.protection) targetCell.protection = { ...cell.protection };
          });

          allPackageRows.push({ sheet: srcSheetName, row: rowIndex, isGlobal: (globalRows.find(g=>g.sheetName===srcSheetName && g.rowIndex===rowIndex) ? true : false) });
          nextTargetRow++;
          totalRowsCopied++;
        }

        // Copy column properties from source sheet
        sourceSheet.columns.forEach((column, index) => {
          const targetColumn = targetWorksheet.getColumn(index + 1);
          if (column.width) targetColumn.width = column.width;
          if (column.hidden) targetColumn.hidden = column.hidden;
          if (column.style) targetColumn.style = column.style;
          if (column.outlineLevel) targetColumn.outlineLevel = column.outlineLevel;
        });
      }

      // Generate buffer for this package
      console.log(`[splitBOQIntoPackages] Package "${packageName}": Copied ${totalRowsCopied} rows across ${sourceSheetNames.length} sheet(s)`);
      const packageBuffer = await packageWorkbook.xlsx.writeBuffer();
      
      // Calculate min/max row for metadata
      const allRowNumbers = allPackageRows.map(r => r.row).filter(r => !isNaN(r));
      const minRow = allRowNumbers.length > 0 ? Math.min(...allRowNumbers) : null;
      const maxRow = allRowNumbers.length > 0 ? Math.max(...allRowNumbers) : null;
      
      splitFiles.push({
        packageName: packageName,
        fileName: `${packageName.replace(/[^a-zA-Z0-9]/g, '_')}_BOQ.xlsx`,
        buffer: packageBuffer,
        startRow: minRow,
        endRow: maxRow,
        rowCount: allPackageRows.length,
        tableRange: JSON.stringify(allPackageRows) // Store as JSON for TableRange column
      });
    }
    
    return splitFiles;
  } catch (error) {
    console.error('Error splitting BOQ into packages:', error);
    throw error;
  }
}

// Helper function to copy rows by their indices
async function copyRowsByIndices(sourceSheet, targetSheet, rowIndices, targetStartRow) {
  if (!rowIndices || rowIndices.length === 0) return 0;
  
  let targetRow = targetStartRow;
  
  for (const rowIndex of rowIndices) {
    const sourceRowObj = sourceSheet.getRow(rowIndex);
    const targetRowObj = targetSheet.getRow(targetRow);
    
    // Copy row height
    if (sourceRowObj.height) {
      targetRowObj.height = sourceRowObj.height;
    }
    
    // Copy all cells in this row
    sourceRowObj.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const targetCell = targetRowObj.getCell(colNumber);
      targetCell.value = getSafeCellValue(cell);
      
      // Copy formatting
      if (cell.font) targetCell.font = { ...cell.font };
      if (cell.fill) targetCell.fill = { ...cell.fill };
      if (cell.border) targetCell.border = { ...cell.border };
      if (cell.alignment) targetCell.alignment = { ...cell.alignment };
      if (cell.numFmt) targetCell.numFmt = cell.numFmt;
      if (cell.style) targetCell.style = cell.style;
      if (cell.protection) targetCell.protection = { ...cell.protection };
    });
    
    targetRow++;
  }
  
  // Copy column properties
  sourceSheet.columns.forEach((column, index) => {
    const targetColumn = targetSheet.getColumn(index + 1);
    if (column.width) targetColumn.width = column.width;
    if (column.hidden) targetColumn.hidden = column.hidden;
    if (column.style) targetColumn.style = column.style;
    if (column.outlineLevel) targetColumn.outlineLevel = column.outlineLevel;
  });
  
  return rowIndices.length;
}

async function detectPackageRowRanges(fileBuffer, fileName, packages) {
  try {
    // Load the Excel file to get actual row count and structure
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const worksheet = workbook.worksheets[0];
    
    if (!worksheet) {
      throw new Error('No worksheet found in Excel file');
    }
    
    const totalRows = worksheet.rowCount;
    console.log(`Excel file has ${totalRows} rows`);
    
    // Extract structured BOQ data row by row
    const boqStructure = await extractBOQStructure(worksheet);
    if (!boqStructure || boqStructure.length === 0) {
      throw new Error('Could not extract BOQ structure');
    }
    
    console.log(`Extracted ${boqStructure.length} rows of BOQ data`);
    
    const prompt = `You are analyzing a Bill of Quantities (BOQ) Excel file to understand its structure and identify where each package begins and ends.

IMPORTANT: Your job is ONLY to analyze the content and identify row ranges. ExcelJS will handle the actual file creation.

The Excel file has ${totalRows} total rows.

Return ONLY strict JSON with this shape:
{
  "packages": [
    {
      "packageName": "Civil Works",
      "startRow": 12,
      "endRow": 59,
      "description": "All civil work items including excavation, concrete, etc."
    },
    {
      "packageName": "Electrical",
      "startRow": 60,
      "endRow": 95,
      "description": "All electrical installations and fittings"
    }
  ]
}

CRITICAL RULES:
1. **Contiguous Blocks**: Each package must have a continuous range of rows (no gaps)
2. **Logical Grouping**: Group all related items for each package together
3. **No Overlaps**: Package ranges should not overlap
4. **Complete Blocks**: Each package should include ALL its related items
5. **Header Awareness**: Include relevant headers for each package
6. **Total Rows**: The file has ${totalRows} rows, so endRow should not exceed ${totalRows}

BOQ Structure (first 50 rows):
${boqStructure.slice(0, 50).map((row, index) => `Row ${row.rowNumber}: ${row.content}`).join('\n')}

Available packages: ${packages.join(', ')}

IMPORTANT: Each package should have a CONTIGUOUS BLOCK of rows. For example:
- Civil Works: rows 12-59 (48 rows of civil work items)
- Electrical: rows 60-95 (36 rows of electrical items)
- NOT: Civil Works: row 12, Electrical: row 13, Civil Works: row 14

Analyze the BOQ structure and identify the row ranges for each package. Do NOT create Excel files - just provide the row ranges.`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not found');
    }
    
    console.log('Calling OpenAI API for BOQ block detection...');
    console.log('BOQ Structure sample:', boqStructure.slice(0, 10).map(row => `Row ${row.rowNumber}: ${row.content}`).join('\n'));
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: `${prompt}\n\nReturn only JSON.` }],
      max_tokens: 2000,
      temperature: 0.1
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const content = response.data?.choices?.[0]?.message?.content || '';
    console.log('OpenAI response:', content);
    
    try {
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      const jsonStr = jsonStart >= 0 ? content.slice(jsonStart, jsonEnd + 1) : content;
      console.log('Extracted JSON:', jsonStr);
      
      const parsed = JSON.parse(jsonStr);
      console.log('Parsed JSON:', parsed);
      
      if (Array.isArray(parsed.packages)) {
        // Convert array to object for easier lookup
        const packageRanges = {};
        for (const pkg of parsed.packages) {
          packageRanges[pkg.packageName] = {
            startRow: Math.max(1, pkg.startRow),
            endRow: Math.min(totalRows, pkg.endRow),
            description: pkg.description || '',
            sheetName: 'Sheet1'
          };
          console.log(`AI detected ${pkg.packageName}: rows ${pkg.startRow}-${pkg.endRow} (${pkg.endRow - pkg.startRow + 1} rows) - ${pkg.description}`);
        }
        console.log('AI successfully detected all package blocks');
        return packageRanges;
      } else {
        console.log('AI response does not contain packages array');
      }
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
    }
    
    throw new Error('Failed to parse AI response for package blocks');
    
  } catch (error) {
    console.error('Error detecting package blocks with AI:', error);
    
    // Fallback: Create simple ranges based on actual row count
    console.log('Falling back to simple range detection...');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const worksheet = workbook.worksheets[0];
    const totalRows = worksheet.rowCount;
    
    console.log(`Total rows in Excel: ${totalRows}, Packages: ${packages.length}`);
    
    const fallbackRanges = {};
    
    // For fallback, analyze the BOQ content and map each row to the correct package
    console.log('Analyzing BOQ content to map rows to packages...');
    
    // Extract BOQ structure for analysis
    const boqStructure = await extractBOQStructure(worksheet);
    if (!boqStructure || boqStructure.length === 0) {
      throw new Error('Could not extract BOQ structure for fallback');
    }
    
    // Map each row to a package based on content analysis
    for (const row of boqStructure) {
      const content = row.content.toLowerCase();
      let assignedPackage = null;
      
      // Map content to packages based on keywords
      if (content.includes('preliminar') || content.includes('insurance')) {
        assignedPackage = 'Preliminaries';
      } else if (content.includes('demolition') || content.includes('alteration')) {
        assignedPackage = 'Demolition';
      } else if (content.includes('substructure') || content.includes('foundation')) {
        assignedPackage = 'Civil Works';
      } else if (content.includes('external wall') || content.includes('internal wall')) {
        assignedPackage = 'Structural Works';
      } else if (content.includes('suspended floor') || content.includes('roof structure')) {
        assignedPackage = 'Structural Works';
      } else if (content.includes('frame')) {
        assignedPackage = 'Steelwork';
      } else if (content.includes('completion') || content.includes('finish')) {
        assignedPackage = 'Finishes';
      } else if (content.includes('drainage') || content.includes('refuse')) {
        assignedPackage = 'Plumbing';
      } else if (content.includes('mechanical')) {
        assignedPackage = 'Mechanical';
      } else if (content.includes('electrical')) {
        assignedPackage = 'Electrical';
      } else if (content.includes('firestopping') || content.includes('fire')) {
        assignedPackage = 'Fire Services';
      } else if (content.includes('sanitary') || content.includes('fitting')) {
        assignedPackage = 'Plumbing';
      } else if (content.includes('site') || content.includes('road') || content.includes('paving')) {
        assignedPackage = 'External Works';
      } else if (content.includes('enclosure')) {
        assignedPackage = 'External Works';
      } else if (content.includes('landscap')) {
        assignedPackage = 'Landscaping';
      } else if (content.includes('total')) {
        assignedPackage = 'Preliminaries'; // Total row goes with preliminaries
      }
      
      if (assignedPackage && packages.includes(assignedPackage)) {
        if (!fallbackRanges[assignedPackage]) {
          fallbackRanges[assignedPackage] = {
            startRow: row.rowNumber,
            endRow: row.rowNumber,
            description: `Content-based mapping for ${assignedPackage}`,
            sheetName: 'Sheet1'
          };
        } else {
          // Extend the range if this row belongs to the same package
          fallbackRanges[assignedPackage].endRow = row.rowNumber;
        }
      }
    }
    
    // For packages not found in content analysis, assign them to the total row
    for (const packageName of packages) {
      if (!fallbackRanges[packageName]) {
        fallbackRanges[packageName] = {
          startRow: totalRows, // Last row (Total)
          endRow: totalRows,
          description: `Assigned to total row for ${packageName}`,
          sheetName: 'Sheet1'
        };
      }
    }
    
    // Log the results
    for (const [packageName, range] of Object.entries(fallbackRanges)) {
      console.log(`${packageName}: rows ${range.startRow}-${range.endRow} (${range.endRow - range.startRow + 1} rows)`);
    }
    
    return fallbackRanges;
  }
}

function calculateSimpleFormula(formula, worksheet) {
  try {
    // Handle simple arithmetic formulas
    if (formula.startsWith('=')) {
      const cleanFormula = formula.substring(1); // Remove '='
      
      // Handle SUM formulas like =SUM(A1:A10)
      if (cleanFormula.startsWith('SUM(')) {
        const range = cleanFormula.match(/SUM\(([^)]+)\)/);
        if (range) {
          const rangeStr = range[1];
          const [startCell, endCell] = rangeStr.split(':');
          if (startCell && endCell) {
            return calculateSumRange(worksheet, startCell, endCell);
          }
        }
      }
      
      // Handle simple arithmetic like =A1+B1
      if (cleanFormula.includes('+') || cleanFormula.includes('-') || cleanFormula.includes('*') || cleanFormula.includes('/')) {
        return calculateArithmetic(cleanFormula, worksheet);
      }
      
      // Handle cell references like =A1
      if (/^[A-Z]+\d+$/.test(cleanFormula)) {
        const cell = worksheet.getCell(cleanFormula);
        return cell.result || cell.value || 0;
      }
    }
    
    return null;
  } catch (error) {
    console.log('Error calculating formula:', formula, error.message);
    return null;
  }
}

function calculateSumRange(worksheet, startCell, endCell) {
  try {
    const startCol = startCell.match(/[A-Z]+/)[0];
    const startRow = parseInt(startCell.match(/\d+/)[0]);
    const endCol = endCell.match(/[A-Z]+/)[0];
    const endRow = parseInt(endCell.match(/\d+/)[0]);
    
    let sum = 0;
    for (let row = startRow; row <= endRow; row++) {
      const cell = worksheet.getCell(`${startCol}${row}`);
      const value = cell.result || cell.value;
      if (value && typeof value === 'number') {
        sum += value;
      }
    }
    return sum;
  } catch (error) {
    return null;
  }
}

function calculateArithmetic(formula, worksheet) {
  try {
    // Simple arithmetic calculation
    // Replace cell references with their values
    let processedFormula = formula;
    const cellRefs = formula.match(/[A-Z]+\d+/g);
    
    if (cellRefs) {
      cellRefs.forEach(ref => {
        const cell = worksheet.getCell(ref);
        const value = cell.result || cell.value || 0;
        processedFormula = processedFormula.replace(ref, value);
      });
    }
    
    // Evaluate the arithmetic expression
    return eval(processedFormula);
  } catch (error) {
    return null;
  }
}

async function extractFullExcelData(fileBuffer) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    
    const sheets = [];
    const structure = [];
    
    // Process each sheet
    workbook.worksheets.forEach((worksheet, sheetIndex) => {
      const sheetData = {
        name: worksheet.name,
        index: sheetIndex,
        columns: [],
        rows: [],
        mergedCells: []
      };
      
      // Detect which columns have content
      const columnsWithContent = new Set();
      
      // First pass: identify columns with content
      for (let row = 1; row <= worksheet.rowCount; row++) {
        const rowObj = worksheet.getRow(row);
        rowObj.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          if (cell.value !== null && cell.value !== undefined) {
            columnsWithContent.add(colNumber);
          }
        });
      }
      
      // Get column information only for columns with content
      const maxColumn = Math.max(...columnsWithContent, 15); // At least 15 columns
      for (let col = 1; col <= maxColumn; col++) {
        const column = worksheet.getColumn(col);
        sheetData.columns.push({
          index: col,
          width: column.width || 20,
          hidden: column.hidden || false
        });
      }
      
      // Process rows
      for (let row = 1; row <= worksheet.rowCount; row++) {
        const rowObj = worksheet.getRow(row);
        const rowData = {
          index: row,
          height: rowObj.height || 20,
          cells: []
        };
        
        let hasContent = false;
        
        // Process cells in this row (only columns with content)
        for (let col = 1; col <= maxColumn; col++) {
          const cell = rowObj.getCell(col);
          const cellData = {
            value: null,
            formula: null,
            fill: null,
            font: null,
            alignment: null,
            border: null
          };
          
          // Get cell value
          // Prioritize calculated result first
          if (cell.result !== null && cell.result !== undefined) {
            cellData.value = cell.result;
            hasContent = true;
          } else if (cell.value !== null && cell.value !== undefined) {
            if (typeof cell.value === 'string') {
              cellData.value = cell.value;
            } else if (typeof cell.value === 'number') {
              cellData.value = cell.value;
            } else if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
              cellData.formula = cell.value.formula;
              // Try to get the calculated result
              if (cell.value.result !== null && cell.value.result !== undefined) {
                cellData.value = cell.value.result;
              } else {
                // If no result available, try to calculate a simple formula
                const calculatedValue = calculateSimpleFormula(cell.value.formula, worksheet);
                if (calculatedValue !== null && calculatedValue !== undefined) {
                  cellData.value = calculatedValue;
                }
              }
            } else {
              cellData.value = cell.value;
            }
            hasContent = true;
          }
          
          // Helper to extract color (ARGB format common in ExcelJS)
          // Defined outside if blocks so it can be used for both fill and font colors
          const extractColor = (colorObj) => {
            if (!colorObj) return null;
            // ExcelJS uses ARGB format (e.g., "FFFF0000" = red, "FF0000FF" = blue)
            // ARGB = Alpha, Red, Green, Blue (first 2 chars are alpha, next 6 are RGB)
            if (colorObj.argb) {
              // Return full ARGB string for frontend to handle
              return colorObj.argb;
            }
            if (colorObj.rgb) {
              return colorObj.rgb;
            }
            return null;
          };
          
          // Get formatting - handle multiple fill formats
          if (cell.fill) {
            const fillData = {};
            
            // Primary fill color (fgColor) - this is the cell background
            const fgColor = extractColor(cell.fill.fgColor);
            if (fgColor) {
              fillData.fgColor = { rgb: fgColor };
            }
            
            // Background color (bgColor) - usually for patterns
            const bgColor = extractColor(cell.fill.bgColor);
            if (bgColor) {
              fillData.bgColor = { rgb: bgColor };
            }
            
            // Pattern fill
            if (cell.fill.pattern) {
              const patternFillData = {
                pattern: cell.fill.pattern
              };
              
              const patternFgColor = extractColor(cell.fill.patternFill?.fgColor);
              if (patternFgColor) {
                patternFillData.fgColor = { rgb: patternFgColor };
              }
              
              const patternBgColor = extractColor(cell.fill.patternFill?.bgColor);
              if (patternBgColor) {
                patternFillData.bgColor = { rgb: patternBgColor };
              }
              
              if (patternFgColor || patternBgColor) {
                fillData.patternFill = patternFillData;
              }
            }
            
            // Only add fill if we have at least one color
            if (Object.keys(fillData).length > 0) {
              cellData.fill = fillData;
            }
          }
          
          if (cell.font) {
            // Extract font color (ARGB format)
            let fontColor = null;
            if (cell.font.color) {
              const color = extractColor(cell.font.color);
              if (color) {
                fontColor = { rgb: color };
              }
            }
            
            cellData.font = {
              bold: cell.font.bold || false,
              italic: cell.font.italic || false,
              underline: cell.font.underline || false,
              color: fontColor,
              size: cell.font.size || 11,
              name: cell.font.name || 'Arial'
            };
          }
          
          if (cell.alignment) {
            cellData.alignment = {
              horizontal: cell.alignment.horizontal || 'left',
              vertical: cell.alignment.vertical || 'top'
            };
          }
          
          rowData.cells.push(cellData);
        }
        
        if (hasContent) {
          sheetData.rows.push(rowData);
          
          // Add to structure for backward compatibility
          structure.push({
            rowNumber: row,
            content: rowData.cells.map(c => c.value || '').join(' | '),
            columns: rowData.cells.map(c => c.value || '')
          });
        }
      }
      
      // Get merged cells
      if (worksheet.model && worksheet.model.merges) {
        worksheet.model.merges.forEach(merge => {
          sheetData.mergedCells.push({
            top: merge.top,
            left: merge.left,
            bottom: merge.bottom,
            right: merge.right
          });
        });
      }
      
      sheets.push(sheetData);
    });
    
    return {
      sheets: sheets,
      structure: structure
    };
  } catch (error) {
    console.error('Error extracting full Excel data:', error);
    return { sheets: [], structure: [] };
  }
}

async function extractBOQStructureFromBuffer(fileBuffer) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    
    const sourceSheet = workbook.worksheets[0];
    if (!sourceSheet) return [];
    
    const structure = [];
    
    // Extract content from each row - show more detailed structure
    for (let row = 1; row <= sourceSheet.rowCount; row++) {
      const rowObj = sourceSheet.getRow(row);
      const rowContent = [];
      let hasContent = false;
      
      // Check first 10 columns for content
      for (let col = 1; col <= 10; col++) {
        const cell = rowObj.getCell(col);
        if (cell.value !== null && cell.value !== undefined) {
          hasContent = true;
          if (typeof cell.value === 'string') {
            rowContent.push(cell.value.trim());
          } else if (typeof cell.value === 'number') {
            rowContent.push(cell.value.toString());
          } else if (cell.value && typeof cell.value === 'object' && cell.value.formula) {
            // Use calculated result if available
            if (cell.result !== null && cell.result !== undefined) {
              rowContent.push(cell.result.toString());
            }
          }
        } else {
          rowContent.push(''); // Empty cell
        }
      }
      
      if (hasContent) {
        // Join with | separator and show row number
        structure.push({
          rowNumber: row,
          content: rowContent.join(' | '),
          columns: rowContent
        });
      }
    }
    
    return structure;
  } catch (error) {
    console.error('Error extracting BOQ structure:', error);
    return [];
  }
}

function columnLettersToNumber(letters) {
  let result = 0;
  const upper = String(letters || '').toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    result = result * 26 + (upper.charCodeAt(i) - 64);
  }
  return result;
}

function parseA1Range(range) {
  // e.g., "A1:F1" -> { startCol, startRow, endCol, endRow }
  if (!range || !range.start || !range.end) return null;
  const startMatch = range.start.match(/([A-Za-z]+)(\d+)/);
  const endMatch = range.end.match(/([A-Za-z]+)(\d+)/);
  if (!startMatch || !endMatch) return null;
  const startCol = columnLettersToNumber(startMatch[1]);
  const startRow = parseInt(startMatch[2], 10);
  const endCol = columnLettersToNumber(endMatch[1]);
  const endRow = parseInt(endMatch[2], 10);
  return { startCol, startRow, endCol, endRow };
}

async function copyHeaderRange(sourceSheet, targetSheet, headerRange) {
  // Handle both A1 notation and numeric row ranges
  let startRow, endRow, startCol, endCol;
  
  if (headerRange && typeof headerRange.start === 'number' && typeof headerRange.end === 'number') {
    // Numeric row format: { start: 1, end: 5 } means rows 1-5, all columns
    startRow = headerRange.start;
    endRow = headerRange.end;
    startCol = 1; // Start from column A
    endCol = sourceSheet.columnCount || 100; // Use all columns or default to 100
  } else {
    // A1 notation format: parse it
    const parsed = parseA1Range(headerRange);
    if (!parsed) return 0;
    ({ startCol, startRow, endCol, endRow } = parsed);
  }
  
  let targetRowIndex = 1;

  for (let r = startRow; r <= endRow; r++) {
    const sourceRowObj = sourceSheet.getRow(r);
    const targetRowObj = targetSheet.getRow(targetRowIndex);
    if (sourceRowObj.height) targetRowObj.height = sourceRowObj.height;

    for (let c = startCol; c <= endCol; c++) {
      const sourceCell = sourceRowObj.getCell(c);
      const targetCell = targetRowObj.getCell(c - startCol + 1);
      targetCell.value = getSafeCellValue(sourceCell);
      if (sourceCell.font) targetCell.font = { ...sourceCell.font };
      if (sourceCell.fill) targetCell.fill = { ...sourceCell.fill };
      if (sourceCell.border) targetCell.border = { ...sourceCell.border };
      if (sourceCell.alignment) targetCell.alignment = { ...sourceCell.alignment };
      if (sourceCell.numFmt) targetCell.numFmt = sourceCell.numFmt;
      if (sourceCell.style) targetCell.style = sourceCell.style;
      if (sourceCell.protection) targetCell.protection = { ...sourceCell.protection };
    }

    targetRowIndex++;
  }

  // Copy merged cells within header range
  if (sourceSheet.model && sourceSheet.model.merges) {
    for (const merge of sourceSheet.model.merges) {
      const mergeStartRow = merge.top;
      const mergeEndRow = merge.bottom;
      const mergeStartCol = merge.left;
      const mergeEndCol = merge.right;
      const inRowRange = mergeStartRow >= startRow && mergeEndRow <= endRow;
      const inColRange = mergeStartCol >= startCol && mergeEndCol <= endCol;
      if (inRowRange && inColRange) {
        const newTop = mergeStartRow - startRow + 1;
        const newBottom = mergeEndRow - startRow + 1;
        const newLeft = mergeStartCol - startCol + 1;
        const newRight = mergeEndCol - startCol + 1;
        targetSheet.mergeCells(newTop, newLeft, newBottom, newRight);
      }
    }
  }

  // Copy column properties for header width consistency
  sourceSheet.columns.forEach((column, index) => {
    const targetColumn = targetSheet.getColumn(index + 1);
    if (column.width) targetColumn.width = column.width;
    if (column.hidden) targetColumn.hidden = column.hidden;
    if (column.style) targetColumn.style = column.style;
    if (column.outlineLevel) targetColumn.outlineLevel = column.outlineLevel;
  });

  return endRow - startRow + 1;
}

function getSafeCellValue(cell) {
  const val = cell ? cell.value : undefined;
  if (!val) return val;
  if (typeof val === 'object') {
    // Avoid copying formulas/shared formulas; write calculated result or null
    if (val.formula || val.sharedFormula) {
      return typeof cell.result !== 'undefined' ? cell.result : null;
    }
    // Pass-through safe object types (e.g., hyperlinks, richText)
    if (val.hyperlink) {
      return { text: val.text, hyperlink: val.hyperlink };
    }
    if (val.richText) {
      return { richText: val.richText };
    }
  }
  return val;
}

async function copyPackageRows(sourceSheet, targetSheet, packageRange, targetStartRow = 1) {
  try {
    console.log(`Copying rows ${packageRange.startRow}-${packageRange.endRow} to target sheet at row ${targetStartRow}`);
    
    // Copy EXACT rows for this package with all formatting
    let targetRow = targetStartRow;
    for (let sourceRow = packageRange.startRow; sourceRow <= packageRange.endRow; sourceRow++) {
      const sourceRowObj = sourceSheet.getRow(sourceRow);
      const targetRowObj = targetSheet.getRow(targetRow);
      
      // Copy row height
      if (sourceRowObj.height) {
        targetRowObj.height = sourceRowObj.height;
      }
      
      // Copy all cells in this row (including empty cells)
      sourceRowObj.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const targetCell = targetRowObj.getCell(colNumber);
        
        // Copy value safely (avoid formula objects)
        targetCell.value = getSafeCellValue(cell);
        
        // Copy ALL formatting properties
        if (cell.font) targetCell.font = { ...cell.font };
        if (cell.fill) targetCell.fill = { ...cell.fill };
        if (cell.border) targetCell.border = { ...cell.border };
        if (cell.alignment) targetCell.alignment = { ...cell.alignment };
        if (cell.numFmt) targetCell.numFmt = cell.numFmt;
        if (cell.style) targetCell.style = cell.style;
        if (cell.protection) targetCell.protection = { ...cell.protection };
      });
      
      targetRow++;
    }
    
    // Copy ALL column properties from source sheet
    sourceSheet.columns.forEach((column, index) => {
      const targetColumn = targetSheet.getColumn(index + 1);
      if (column.width) targetColumn.width = column.width;
      if (column.hidden) targetColumn.hidden = column.hidden;
      if (column.style) targetColumn.style = column.style;
      if (column.outlineLevel) targetColumn.outlineLevel = column.outlineLevel;
    });
    
    // Copy merged cells within the package range
    if (sourceSheet.model && sourceSheet.model.merges) {
      for (const merge of sourceSheet.model.merges) {
        // Check if this merge is within our package range
        const mergeStartRow = merge.top;
        const mergeEndRow = merge.bottom;
        
        if (mergeStartRow >= packageRange.startRow && mergeEndRow <= packageRange.endRow) {
          // Calculate new row numbers for target sheet
          const newTop = mergeStartRow - packageRange.startRow + 1;
          const newBottom = mergeEndRow - packageRange.startRow + 1;
          
          targetSheet.mergeCells(newTop, merge.left, newBottom, merge.right);
        }
      }
    }
    
    // Copy sheet properties
    if (sourceSheet.properties) {
      targetSheet.properties = { ...sourceSheet.properties };
    }
    
    console.log(`Successfully copied ${packageRange.endRow - packageRange.startRow + 1} rows`);
    
  } catch (error) {
    console.error('Error copying package rows:', error);
  }
}

// This function is no longer needed as we copy exact structure

async function detectBlockBoundariesWithAI(fileBuffer, fileName) {
  try {
    // First extract text to understand structure
    const text = await extractTextFromExcelBuffer(fileBuffer);
    if (!text) {
      throw new Error('Could not extract text from Excel file');
    }
    
    const prompt = `You are analyzing a Bill of Quantities (BOQ) Excel file to detect block boundaries.

IMPORTANT: Identify COMPLETE BLOCKS with clear start and end points. Each block should contain all related items.

Return ONLY strict JSON with this shape: 
{
  "blocks": [
    {
      "blockName": "string",
      "startRow": number,
      "endRow": number,
      "sheetName": "string",
      "confidence": number
    }
  ]
}

CRITICAL RULES:
1. **Complete Blocks**: Only identify blocks that have clear start AND end boundaries
2. **No Partial Blocks**: Don't create blocks that end abruptly or are incomplete
3. **Logical Grouping**: Group related items together (e.g., all demolition items, all electrical items)
4. **Sheet Awareness**: Note which sheet each block is on
5. **Confidence Score**: Rate confidence 0-1 for each block detection

EXAMPLES:
- "DEMOLITION" block: starts at "DEMOLITION" header, ends before next major header
- "ELECTRICAL" block: starts at "ELECTRICAL WORKS" header, ends before "MECHANICAL" header
- "FOUNDATION" block: starts at "FOUNDATION" header, ends before "SUPERSTRUCTURE" header

BOQ text (may be truncated):\n${text.substring(0, 15000)}`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not found');
    }
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: `${prompt}\n\nReturn only JSON.` }],
      max_tokens: 2000,
      temperature: 0.1
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    const content = response.data?.choices?.[0]?.message?.content || '';
    try {
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}');
      const jsonStr = jsonStart >= 0 ? content.slice(jsonStart, jsonEnd + 1) : content;
      const parsed = JSON.parse(jsonStr);
      
      if (Array.isArray(parsed.blocks)) {
        return { blocks: parsed.blocks, source: 'openai' };
      }
    } catch (_) {}
    
    throw new Error('Failed to parse AI response for block boundaries');
    
  } catch (error) {
    console.error('Error detecting block boundaries with AI:', error);
    throw error;
  }
}

async function extractTextFromExcelBuffer(fileBuffer) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    
    let allText = '';
    
    workbook.worksheets.forEach(sheet => {
      allText += `\n=== SHEET: ${sheet.name} ===\n`;
      
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const rowText = row.values.slice(1).join(' | '); // Skip first empty cell
        allText += `Row ${rowNumber}: ${rowText}\n`;
      });
    });
    
    return allText;
  } catch (error) {
    console.error('Error extracting text from Excel buffer:', error);
    return null;
  }
}

async function extractCleanTextFromExcel(worksheet) {
  try {
    let text = '';
    
    for (let row = 1; row <= worksheet.rowCount; row++) {
      const rowData = worksheet.getRow(row);
      const rowText = rowData.values.slice(1).map(cell => {
        if (cell === null || cell === undefined) return '';
        
        // Handle different cell types
        if (typeof cell === 'object') {
          // Skip formula objects, only get text values
          if (cell.text) return cell.text;
          if (cell.value) return String(cell.value);
          return '';
        }
        
        // Skip formulas and errors
        if (typeof cell === 'string' && (cell.startsWith('=') || cell.startsWith('#REF') || cell.startsWith('#REEL'))) {
          return '';
        }
        
        return String(cell);
      }).filter(val => val.trim() !== '').join(' | ');
      
      if (rowText.trim()) {
        text += `Row ${row}: ${rowText}\n`;
      }
    }
    
    return text;
  } catch (error) {
    console.error('Error extracting clean text from Excel:', error);
    return null;
  }
}

async function extractBOQStructure(worksheet) {
  try {
    const boqStructure = [];
    
    for (let row = 1; row <= worksheet.rowCount; row++) {
      const rowData = worksheet.getRow(row);
      const rowContent = [];
      
      // Extract content from each cell in the row
      rowData.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        let cellValue = '';
        
        if (cell.value !== null && cell.value !== undefined) {
          // Handle different cell types
          if (typeof cell.value === 'object') {
            if (cell.value.formula) {
              // For formulas, get the calculated result
              cellValue = cell.result || cell.value.value || '';
            } else if (cell.value.text) {
              cellValue = cell.value.text;
            } else if (cell.value.value) {
              cellValue = String(cell.value.value);
            }
          } else {
            cellValue = String(cell.value);
          }
        }
        
        // Skip empty cells and error values
        if (cellValue && typeof cellValue === 'string' && !cellValue.startsWith('#REF') && !cellValue.startsWith('#REEL') && !cellValue.startsWith('=')) {
          rowContent.push(cellValue.trim());
        } else if (cellValue && typeof cellValue !== 'string') {
          // Handle non-string values (numbers, dates, etc.)
          rowContent.push(String(cellValue));
        }
      });
      
      // Only include rows that have content
      if (rowContent.length > 0) {
        boqStructure.push({
          rowNumber: row,
          content: rowContent.join(' | '),
          cells: rowContent
        });
      }
    }
    
    return boqStructure;
  } catch (error) {
    console.error('Error extracting BOQ structure:', error);
    return null;
  }
}

// Block-based fallback function to create BOQ blocks from text
function createFallbackBOQBlocks(text, packages) {
  if (!text || text.length === 0) {
    return [];
  }
  
  console.log('Creating fallback BOQ blocks from text content');
  
  // Split text into lines
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const blocks = [];
  let currentBlock = null;
  let currentCode = null;
  let blockOrder = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (line.length === 0) {
      continue;
    }
    
    // Detect block headers (all caps, no numbers, no special characters except spaces)
    if (line === line.toUpperCase() && !/\d/.test(line) && !/[^\w\s]/.test(line) && line.length > 5) {
      // This is a new block
      blockOrder++;
      currentBlock = {
        blockName: line,
        blockOrder: blockOrder,
        package: 'General',
        items: []
      };
      currentCode = null;
      
      // Assign package based on block name
      const lowerBlock = line.toLowerCase();
      if (lowerBlock.includes('civil') || lowerBlock.includes('foundation') || lowerBlock.includes('concrete')) {
        currentBlock.package = 'Civil Works';
      } else if (lowerBlock.includes('structural') || lowerBlock.includes('steel') || lowerBlock.includes('frame')) {
        currentBlock.package = 'Structural Works';
      } else if (lowerBlock.includes('electrical') || lowerBlock.includes('lighting') || lowerBlock.includes('power')) {
        currentBlock.package = 'Electrical';
      } else if (lowerBlock.includes('mechanical') || lowerBlock.includes('hvac') || lowerBlock.includes('air')) {
        currentBlock.package = 'Mechanical';
      } else if (lowerBlock.includes('plumbing') || lowerBlock.includes('water') || lowerBlock.includes('drain')) {
        currentBlock.package = 'Plumbing';
      } else if (lowerBlock.includes('fire') || lowerBlock.includes('security')) {
        currentBlock.package = 'Fire Security';
      } else if (lowerBlock.includes('finish') || lowerBlock.includes('paint') || lowerBlock.includes('floor')) {
        currentBlock.package = 'Finishes';
      }
      
      blocks.push(currentBlock);
      continue;
    }
    
    // If we don't have a current block, create a default one
    if (!currentBlock) {
      blockOrder++;
      currentBlock = {
        blockName: 'GENERAL WORKS',
        blockOrder: blockOrder,
        package: 'General',
        items: []
      };
      blocks.push(currentBlock);
    }
    
    // Try to extract item information
    const parts = line.split(/\s+/);
    let code = null;
    let description = line;
    let qty = null;
    let uom = null;
    let rate = null;
    let itemOrder = currentBlock.items.length + 1;
    
    // Look for patterns like "100 Description" or "100 m2 Description"
    if (parts.length > 1) {
      const firstPart = parts[0];
      
      // Check if it's a code (alphanumeric with possible dots)
      if (/^[A-Za-z0-9\.]+$/.test(firstPart) && firstPart.length <= 10) {
        code = firstPart;
        description = parts.slice(1).join(' ');
        currentCode = code;
      } else if (/^\d+\.?\d*$/.test(firstPart) && parts.length > 2) {
        // This might be quantity
        qty = parseFloat(firstPart);
        uom = parts[1];
        description = parts.slice(2).join(' ');
      }
    }
    
    // Handle hierarchical prefixes like "^^^^^"
    if (description.startsWith('^^^^^')) {
      description = description.replace(/^\^+/, '').trim();
      // Use the current code (inherited from above)
    }
    
    // Use current code if no code found in this line
    if (!code && currentCode) {
      code = currentCode;
    }
    
    // Look for quantity and unit in the description
    const qtyMatch = description.match(/(\d+\.?\d*)\s*(m|m2|m3|kg|ton|pcs|nr|ea|unit|l|ml|g|mm|cm|km|ft|yd|in|gal|lb|oz)/i);
    if (qtyMatch && !qty) {
      qty = parseFloat(qtyMatch[1]);
      uom = qtyMatch[2].toLowerCase();
      description = description.replace(qtyMatch[0], '').trim();
    }
    
    // Look for rate/price in the description
    const rateMatch = description.match(/€(\d+\.?\d*)/i);
    if (rateMatch && !rate) {
      rate = parseFloat(rateMatch[1]);
      description = description.replace(rateMatch[0], '').trim();
    }
    
    // Add the item if it has meaningful content
    if (description.length > 3) {
      // Truncate description if it's extremely long
      if (description.length > 4000) {
        description = description.substring(0, 4000);
      }
      
      currentBlock.items.push({
        code: code || `Item_${itemOrder}`,
        description: description,
        qty: qty,
        uom: uom,
        rate: rate,
        itemOrder: itemOrder
      });
    }
  }
  
  console.log(`Created ${blocks.length} BOQ blocks with ${blocks.reduce((sum, block) => sum + block.items.length, 0)} total items`);
  return blocks;
}

function compactRowsToRangeString(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const sorted = Array.from(new Set(rows.filter(n => typeof n === 'number' && !isNaN(n)))).sort((a,b)=>a-b);
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = cur;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(',');
}

const boqController = {
  // GET /api/boq/tender/:tenderId
  listTenderBoQ: async (req, res) => {
    try {
      const { tenderId } = req.params;
      const pool = await getConnectedPool();
      
      // Convert tenderId to integer
      const tenderIdInt = parseInt(tenderId, 10);
      if (isNaN(tenderIdInt)) {
        console.error(`[listTenderBoQ] Invalid TenderID provided: ${tenderId}`);
        return res.status(400).json({ error: 'Invalid tender ID', items: [] });
      }
      
      console.log(`[listTenderBoQ] Fetching BOQ files for TenderID: ${tenderIdInt} (original: ${tenderId})`);
      
      const result = await pool.request()
        .input('TenderID', tenderIdInt)
        .query(`
          SELECT 
            b.BoQID,
            b.TenderID,
            b.FileID,
            b.UploadedAt,
            b.Description,
            f.DisplayName,
            f.BlobPath,
            f.ContentType
          FROM tenderBoQ b
          LEFT JOIN tenderFile f ON f.FileID = b.FileID
          WHERE b.TenderID = @TenderID
          ORDER BY b.UploadedAt DESC, b.BoQID DESC
        `);
      
      console.log(`[listTenderBoQ] Found ${result.recordset.length} BOQ record(s) for TenderID ${tenderIdInt}`);
      
      // Log details if no records found - help debug
      if (result.recordset.length === 0) {
        // Check if tenderBoQ table has any records at all for this tender
        const checkResult = await pool.request()
          .input('TenderID', tenderIdInt)
          .query(`
            SELECT COUNT(*) as TotalCount 
            FROM tenderBoQ 
            WHERE TenderID = @TenderID
          `);
        console.log(`[listTenderBoQ] Database check: ${checkResult.recordset[0].TotalCount} total tenderBoQ records for TenderID ${tenderIdInt}`);
        
        // Also check if files exist for this tender
        const fileCheckResult = await pool.request()
          .input('TenderID', tenderIdInt)
          .query(`
            SELECT COUNT(*) as FileCount 
            FROM tenderFile 
            WHERE DocID = @TenderID AND ConnectionTable = 'tenderTender'
          `);
        console.log(`[listTenderBoQ] Database check: ${fileCheckResult.recordset[0].FileCount} total files for TenderID ${tenderIdInt}`);
      } else {
        // Log the records found for debugging
        result.recordset.forEach((record, idx) => {
          console.log(`[listTenderBoQ] Record ${idx + 1}: BoQID=${record.BoQID}, FileID=${record.FileID}, DisplayName=${record.DisplayName || 'N/A'}`);
        });
      }
      
      return res.json({ success: true, items: result.recordset });
    } catch (error) {
      console.error('[listTenderBoQ] Error listing tender BOQ:', error);
      console.error('[listTenderBoQ] Error stack:', error.stack);
      res.status(500).json({ error: 'Failed to list tender BOQ', message: error.message });
    }
  },
  // GET /api/boq/:tenderId/:fileId/packages/:packageName/rfq
  listPackageRFQ: async (req, res) => {
    try {
      const { tenderId, fileId, packageName } = req.params;
      const pool = await getConnectedPool();

      // Resolve PackageID from tenderBoQPackages by TenderID/FileID/PackageName
      let pkgRes = await pool.request()
        .input('TenderID', tenderId)
        .input('FileID', fileId)
        .input('PackageName', packageName)
        .query(`
          SELECT TOP 1 PackageID
          FROM tenderBoQPackages
          WHERE TenderID = @TenderID AND FileID = @FileID AND PackageName = @PackageName
          ORDER BY PackageID DESC
        `);
      let packageId = pkgRes.recordset[0]?.PackageID;
      if (!packageId) {
        // Fallback: ignore FileID
        pkgRes = await pool.request()
          .input('TenderID', tenderId)
          .input('PackageName', packageName)
          .query(`
            SELECT TOP 1 PackageID
            FROM tenderBoQPackages
            WHERE TenderID = @TenderID AND PackageName = @PackageName
            ORDER BY PackageID DESC
          `);
        packageId = pkgRes.recordset[0]?.PackageID;
      }
      if (!packageId) {
        return res.json({ success: true, items: [] });
      }

      const rfqRes = await pool.request()
        .input('PackageID', packageId)
        .query(`
          SELECT r.BOQRFQID, r.CompanyID, c.CompanyName AS CompanyName, r.PackageID, r.RFQDate, r.QuotationReturn, r.Value, r.AddBy, r.CreatedDate, r.UpdatedDate, r.SubbieRef, r.Notes
          FROM tenderPackageRFQ r
          LEFT JOIN tenderCompany c ON c.CompanyID = r.CompanyID
          WHERE r.PackageID = @PackageID
          ORDER BY r.CreatedDate DESC
        `);
      return res.json({ success: true, items: rfqRes.recordset });
    } catch (error) {
      console.error('Error listing package RFQ:', error);
      res.status(500).json({ error: 'Failed to list RFQs' });
    }
  },
  // POST /api/boq/:tenderId/:fileId/packages/:packageName/rfq
  createPackageRFQ: async (req, res) => {
    try {
      const { tenderId, fileId, packageName } = req.params;
      const { CompanyID, RFQDate, QuotationReturn, Value, SubbieRef, Notes } = req.body || {};
      const userId = req.user?.userId || req.user?.id || null;

      console.log(`📝 [createPackageRFQ] Request received:`, {
        tenderId,
        fileId,
        packageName,
        CompanyID,
        RFQDate,
        userId
      });

      if (!CompanyID && !req.body?.CompanyName) {
        console.error('❌ [createPackageRFQ] Missing CompanyID and CompanyName');
        return res.status(400).json({ error: 'CompanyID or CompanyName is required' });
      }

      const pool = await getConnectedPool();

      // Resolve or create company if CompanyName provided
      let companyId = CompanyID || null;
      if (!companyId && req.body?.CompanyName) {
        const exist = await pool.request()
          .input('Name', req.body.CompanyName)
          .query(`SELECT TOP 1 CompanyID FROM tenderCompany WHERE CompanyName = @Name`);
        companyId = exist.recordset[0]?.CompanyID || null;
        if (!companyId) {
          const ins = await pool.request()
            .input('CompanyName', req.body.CompanyName)
            .input('AddBy', userId)
            .query(`
              INSERT INTO tenderCompany (CompanyName, AddBy, CreatedAt)
              OUTPUT INSERTED.CompanyID
              VALUES (@CompanyName, @AddBy, GETDATE())
            `);
          companyId = ins.recordset[0].CompanyID;
        }
      }

      // Resolve PackageID
      console.log(`🔍 [createPackageRFQ] Looking up package: TenderID=${tenderId}, FileID=${fileId}, PackageName=${packageName}`);
      
      // First try with FileID
      let pkgRes = await pool.request()
        .input('TenderID', parseInt(tenderId))
        .input('FileID', parseInt(fileId))
        .input('PackageName', packageName)
        .query(`
          SELECT TOP 1 PackageID
          FROM tenderBoQPackages
          WHERE TenderID = @TenderID AND FileID = @FileID AND PackageName = @PackageName
          ORDER BY PackageID DESC
        `);
      let packageId = pkgRes.recordset[0]?.PackageID;
      
      // Log what packages exist for this file
      if (!packageId) {
        const allPackagesRes = await pool.request()
          .input('TenderID', parseInt(tenderId))
          .input('FileID', parseInt(fileId))
          .query(`
            SELECT PackageID, PackageName
            FROM tenderBoQPackages
            WHERE TenderID = @TenderID AND FileID = @FileID
            ORDER BY PackageID DESC
          `);
        console.log(`📦 [createPackageRFQ] Packages for FileID ${fileId}:`, allPackagesRes.recordset.map(p => p.PackageName));
      }
      
      if (!packageId) {
        // Fallback: ignore FileID (maybe package was created with different FileID)
        console.log(`🔍 [createPackageRFQ] Trying lookup without FileID constraint...`);
        pkgRes = await pool.request()
          .input('TenderID', parseInt(tenderId))
          .input('PackageName', packageName)
          .query(`
            SELECT TOP 1 PackageID, FileID
            FROM tenderBoQPackages
            WHERE TenderID = @TenderID AND PackageName = @PackageName
            ORDER BY PackageID DESC
          `);
        packageId = pkgRes.recordset[0]?.PackageID;
        if (packageId) {
          console.log(`⚠️ [createPackageRFQ] Found package with different FileID: ${pkgRes.recordset[0].FileID}`);
        }
      }
      
      // If still not found, try to auto-create the package
      if (!packageId) {
        console.log(`🆕 [createPackageRFQ] Package not found, attempting to auto-create...`);
        try {
          const createRes = await pool.request()
            .input('TenderID', parseInt(tenderId))
            .input('FileID', parseInt(fileId))
            .input('PackageName', packageName)
            .query(`
              INSERT INTO tenderBoQPackages (TenderID, FileID, PackageName, CreatedAt, UpdatedAt)
              OUTPUT INSERTED.PackageID
              VALUES (@TenderID, @FileID, @PackageName, SYSUTCDATETIME(), SYSUTCDATETIME())
            `);
          packageId = createRes.recordset[0]?.PackageID;
          console.log(`✅ [createPackageRFQ] Auto-created package: PackageID=${packageId}`);
        } catch (createError) {
          console.error(`❌ [createPackageRFQ] Failed to auto-create package:`, createError);
          console.error(`❌ [createPackageRFQ] Package not found and could not be created: TenderID=${tenderId}, FileID=${fileId}, PackageName=${packageName}`);
          return res.status(404).json({ 
            error: 'Package not found. Please save package ranges first via the range selector page.',
            details: `Package "${packageName}" does not exist for TenderID ${tenderId}, FileID ${fileId}`
          });
        }
      }

      console.log(`✅ [createPackageRFQ] Found PackageID: ${packageId} for package "${packageName}"`);

      // Ensure RFQDate is set to today if not provided
      const rfqDateValue = RFQDate ? new Date(RFQDate) : new Date();
      
      console.log(`📅 [createPackageRFQ] Using RFQDate:`, rfqDateValue);

      const rfqIns = await pool.request()
        .input('CompanyID', companyId)
        .input('PackageID', packageId)
        .input('RFQDate', rfqDateValue)
        .input('QuotationReturn', QuotationReturn ? new Date(QuotationReturn) : null)
        .input('Value', typeof Value === 'number' ? Value : (Value ? Number(Value) : null))
        .input('AddBy', userId)
        .input('SubbieRef', SubbieRef || null)
        .input('Notes', Notes || null)
        .query(`
          INSERT INTO tenderPackageRFQ (CompanyID, PackageID, RFQDate, QuotationReturn, Value, AddBy, CreatedDate, UpdatedDate, SubbieRef, Notes)
          OUTPUT INSERTED.BOQRFQID
          VALUES (@CompanyID, @PackageID, @RFQDate, @QuotationReturn, @Value, @AddBy, SYSUTCDATETIME(), SYSUTCDATETIME(), @SubbieRef, @Notes)
        `);

      const rfqId = rfqIns.recordset[0]?.BOQRFQID;
      console.log(`✅ [createPackageRFQ] RFQ created successfully: BOQRFQID=${rfqId}, CompanyID=${companyId}, PackageID=${packageId}`);

      return res.json({ success: true, rfqId });
    } catch (error) {
      console.error('❌ [createPackageRFQ] Error creating package RFQ:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack
      });
      res.status(500).json({ error: 'Failed to create RFQ', message: error.message });
    }
  },
  // PUT /api/boq/:tenderId/:fileId/packages/:packageName/rfq/:rfqId
  updatePackageRFQ: async (req, res) => {
    try {
      const { rfqId } = req.params;
      const { CompanyID, RFQDate, QuotationReturn, Value, SubbieRef, Notes } = req.body || {};
      const pool = await getConnectedPool();
      const request = pool.request()
        .input('BOQRFQID', rfqId)
        .input('CompanyID', CompanyID || null)
        .input('RFQDate', RFQDate ? new Date(RFQDate) : null)
        .input('QuotationReturn', QuotationReturn ? new Date(QuotationReturn) : null)
        .input('Value', typeof Value === 'number' ? Value : (Value ? Number(Value) : null))
        .input('SubbieRef', SubbieRef || null)
        .input('Notes', Notes || null);

      await request.query(`
        UPDATE tenderPackageRFQ
        SET CompanyID = COALESCE(@CompanyID, CompanyID),
            RFQDate = @RFQDate,
            QuotationReturn = @QuotationReturn,
            Value = @Value,
            SubbieRef = @SubbieRef,
            Notes = @Notes,
            UpdatedDate = SYSUTCDATETIME()
        WHERE BOQRFQID = @BOQRFQID
      `);

      return res.json({ success: true });
    } catch (error) {
      console.error('Error updating package RFQ:', error);
      res.status(500).json({ error: 'Failed to update RFQ' });
    }
  },
  // DELETE /api/boq/:tenderId/:fileId/packages/:packageName/rfq/:rfqId
  deletePackageRFQ: async (req, res) => {
    try {
      const { rfqId } = req.params;
      const pool = await getConnectedPool();
      const request = pool.request()
        .input('BOQRFQID', rfqId);

      await request.query(`
        DELETE FROM tenderPackageRFQ
        WHERE BOQRFQID = @BOQRFQID
      `);

      return res.json({ success: true });
    } catch (error) {
      console.error('Error deleting package RFQ:', error);
      res.status(500).json({ error: 'Failed to delete RFQ' });
    }
  },
  // GET /api/boq/:tenderId/:fileId/propose
  proposeBreakdown: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      const pool = await getConnectedPool();

      const fileRes = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT FileID, DocID, BlobPath, DisplayName, ContentType, ExtractedText, FolderID, ConnectionTable
          FROM tenderFile
          WHERE FileID = @FileID AND (IsDeleted = 0 OR IsDeleted IS NULL)
        `);

      if (fileRes.recordset.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fileRow = fileRes.recordset[0];
      if (tenderId && fileRow.DocID && String(fileRow.DocID) !== String(tenderId)) {
        console.warn('BOQ file DocID differs from requested tenderId');
      }

      // First check tenderBoQPackages for saved packages (with optional compact TableRange)
      const savedPkRes = await pool.request()
        .input('TenderID', tenderId)
        .input('FileID', fileId)
        .query(`
          SELECT PackageName, TableRange
          FROM tenderBoQPackages
          WHERE TenderID = @TenderID AND FileID = @FileID
          ORDER BY PackageID
        `);

      if (savedPkRes.recordset.length > 0) {
        const savedPackages = savedPkRes.recordset.map(r => r.PackageName).filter(Boolean);
        const packageRangesCompact = {};

        // Helper to expand a compact range string (e.g. "1-5,9,15-20") into array of ints
        const expandRangeString = (str) => {
          if (!str || typeof str !== 'string') return [];
          return str.split(',').map(s => s.trim()).filter(Boolean).flatMap(part => {
            if (/^\d+-\d+$/.test(part)) {
              const [a, b] = part.split('-').map(n => parseInt(n, 10));
              if (!isNaN(a) && !isNaN(b) && a <= b) {
                const arr = [];
                for (let i = a; i <= b; i++) arr.push(i);
                return arr;
              }
              return [];
            }
            const n = parseInt(part, 10);
            return isNaN(n) ? [] : [n];
          });
        };

        // Build rowPackageAssignments: sheetName -> { rowIndex: packageName | 'Global' }
        const rowPackageAssignments = {};
        for (const rec of savedPkRes.recordset) {
          const pkg = rec.PackageName;
          let compactJson = null;
          try { compactJson = rec.TableRange ? JSON.parse(rec.TableRange) : null; } catch(_) { compactJson = null; }
          if (compactJson && typeof compactJson === 'object') {
            for (const [key, value] of Object.entries(compactJson)) {
              if (key === 'Global' && value && typeof value === 'object') {
                // Global rows
                for (const [sheetName, compactStr] of Object.entries(value)) {
                  const rows = expandRangeString(compactStr);
                  if (!rowPackageAssignments[sheetName]) rowPackageAssignments[sheetName] = {};
                  rows.forEach(r => { rowPackageAssignments[sheetName][r] = 'Global'; });
                }
              } else {
                // Package-specific rows per sheet
                const sheetName = key;
                const compactStr = value;
                const rows = typeof compactStr === 'string' ? expandRangeString(compactStr) : [];
                if (!rowPackageAssignments[sheetName]) rowPackageAssignments[sheetName] = {};
                rows.forEach(r => { rowPackageAssignments[sheetName][r] = pkg; });
              }
            }
          }
          packageRangesCompact[pkg] = compactJson; // includes Global if present
        }

        return res.json({
          success: true,
          tenderId,
          fileId,
          packages: savedPackages,
          source: 'stored',
          packageRangesCompact,
          rowPackageAssignments
        });
      }

      // No stored packages: return empty
      return res.json({
        success: true,
        tenderId,
        fileId,
        packages: [],
        source: 'manual'
      });
    } catch (error) {
      console.error('Error proposing BOQ breakdown:', error);
      res.status(500).json({ error: 'Failed to propose BOQ breakdown' });
    }
  },

  // POST /api/boq/:tenderId/:fileId/process
  processBOQ: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      const { packages } = req.body;
      
      if (!packages || !Array.isArray(packages)) {
        return res.status(400).json({ error: 'Packages array is required' });
      }

      const pool = await getConnectedPool();
      

      // Get file details
      const fileRes = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT FileID, DocID, BlobPath, DisplayName, ContentType, ExtractedText, FolderID, ConnectionTable
          FROM tenderFile
          WHERE FileID = @FileID AND (IsDeleted = 0 OR IsDeleted IS NULL)
        `);

      if (fileRes.recordset.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fileRow = fileRes.recordset[0];
      const text = await getBoqTextForFile(fileRow);
      
      // Try OpenAI first, then fallback to Mistral
      let blocksResult = await callOpenAIForBOQBlocks(text, packages);
      if (blocksResult.blocks.length === 0) {
        console.log('OpenAI failed to parse BOQ blocks, trying Mistral');
        blocksResult = await callMistralForBOQBlocks(text, packages);
      }
      
      // If both AI services failed, use fallback
      if (blocksResult.blocks.length === 0) {
        console.log('Both AI services failed to parse BOQ blocks, using fallback parser');
        const fallbackBlocks = createFallbackBOQBlocks(text, packages);
        if (fallbackBlocks.length === 0) {
          return res.status(400).json({ error: 'Failed to parse BOQ blocks - no content found' });
        }
        blocksResult.blocks = fallbackBlocks;
        blocksResult.source = 'fallback';
      }

      // Clear existing BOQ items and blocks for this file
      await pool.request()
        .input('FileID', fileId)
        .query('DELETE FROM tenderBoQ WHERE FileID = @FileID');


      // Insert new BOQ blocks and items
      let totalItemsInserted = 0;
      for (const block of blocksResult.blocks) {
        try {
          // Insert the block
          const blockRes = await pool.request()
            .input('TenderID', tenderId)
            .input('FileID', fileId)
            .input('BlockName', block.blockName)
            .input('BlockOrder', block.blockOrder)
            .input('Package', block.package)
            .query(`
              -- Block insertion removed - using tenderPackageRFQ instead
              SELECT 1 as BlockID
            `);
          
          const blockId = blockRes.recordset[0].BlockID;
          console.log(`Inserted block: ${block.blockName} (ID: ${blockId})`);

          // Insert items for this block - disabled (legacy schema no longer supported)
          // We intentionally do not persist tenderBoQ items in the new schema.
          // Keeping as no-op to maintain flow without DB writes.
          for (const _item of (block.items || [])) {
            // no-op
          }
        } catch (blockError) {
          console.error('Failed to insert BOQ block:', block, blockError);
        }
      }

      return res.json({
        success: true,
        message: `Processed ${blocksResult.blocks.length} BOQ blocks with ${totalItemsInserted} items`,
        blocksCount: blocksResult.blocks.length,
        itemsCount: totalItemsInserted,
        source: blocksResult.source
      });

    } catch (error) {
      console.error('Error processing BOQ:', error);
      res.status(500).json({ error: 'Failed to process BOQ' });
    }
  },

  // GET /api/boq/:tenderId/:fileId/items
  getBOQItems: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      const pool = await getConnectedPool();

      // Get blocks first - using empty result since tenderBoQBlocks doesn't exist
      const blocksRes = { recordset: [] };

      const blocks = blocksRes.recordset;

      // Legacy items endpoint disabled; return empty blocks/items
      return res.json({ success: true, blocks: [], items: [] });

    } catch (error) {
      console.error('Error fetching BOQ items:', error);
      res.status(500).json({ error: 'Failed to fetch BOQ items' });
    }
  },

  // GET /api/boq/:tenderId/:fileId/excel-data
  getExcelData: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      
      const pool = await getConnectedPool();
      
      // Get file info from database
      const fileQuery = `
        SELECT * FROM tenderFile 
        WHERE FileID = @fileId AND DocID = @tenderId AND ConnectionTable = 'tenderTender'
      `;
      const request = pool.request();
      request.input('fileId', fileId);
      request.input('tenderId', tenderId);
      const result = await request.query(fileQuery);
      const fileRows = result.recordset;
      
      if (fileRows.length === 0) {
        return res.status(404).json({ error: 'BOQ file not found' });
      }
      
      const fileRow = fileRows[0];
      
      // Download file from blob storage
      const fileStream = await downloadFile(fileRow.BlobPath);
      
      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }
      const fileBuffer = Buffer.concat(chunks);
      
      // Extract full Excel data with formatting
      const excelData = await extractFullExcelData(fileBuffer);
      
      res.json({
        success: true,
        excelData: excelData,
        structure: excelData.structure
      });
    } catch (error) {
      console.error('Error getting Excel data:', error);
      res.status(500).json({ error: 'Failed to get Excel data' });
    }
  },

  // GET /api/boq/:tenderId/:fileId/structure
  getBoqStructure: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      
      const pool = await getConnectedPool();
      
      // Get file info from database
      const fileQuery = `
        SELECT * FROM tenderFile 
        WHERE FileID = @fileId AND DocID = @tenderId AND ConnectionTable = 'tenderTender'
      `;
      const request = pool.request();
      request.input('fileId', fileId);
      request.input('tenderId', tenderId);
      const result = await request.query(fileQuery);
      const fileRows = result.recordset;
      
      if (fileRows.length === 0) {
        return res.status(404).json({ error: 'BOQ file not found' });
      }
      
      const fileRow = fileRows[0];
      
      // Download file from blob storage
      const fileStream = await downloadFile(fileRow.BlobPath);
      
      // Convert stream to buffer
      const chunks = [];
      for await (const chunk of fileStream) {
        chunks.push(chunk);
      }
      const fileBuffer = Buffer.concat(chunks);
      
      // Extract BOQ structure directly from Excel
      const structure = await extractBOQStructureFromBuffer(fileBuffer);
      
      res.json({
        success: true,
        structure: structure,
        totalRows: structure.length
      });
    } catch (error) {
      console.error('Error getting BOQ structure:', error);
      res.status(500).json({ error: 'Failed to get BOQ structure' });
    }
  },

  // POST /api/boq/:tenderId/:fileId/split
  splitBOQ: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      const { packages } = req.body;
      
      if (!packages || !Array.isArray(packages)) {
        return res.status(400).json({ error: 'Packages array is required' });
      }

      const pool = await getConnectedPool();

      // Get file details
      const fileRes = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT FileID, DocID, BlobPath, DisplayName, ContentType, ExtractedText, FolderID, ConnectionTable
          FROM tenderFile
          WHERE FileID = @FileID AND (IsDeleted = 0 OR IsDeleted IS NULL)
        `);

      if (fileRes.recordset.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fileRow = fileRes.recordset[0];
      
      // Download the original file
      const stream = await downloadFile(fileRow.BlobPath);
      const fileBuffer = await streamToBuffer(stream);
      
      // Try AI parsing (fallbacks preserved)
      let blocksResult = await callOpenAIForBOQBlocks(await getBoqTextForFile(fileRow), packages);
      if (blocksResult.blocks.length === 0) {
        console.log('OpenAI failed to parse BOQ blocks, trying Mistral');
        blocksResult = await callMistralForBOQBlocks(await getBoqTextForFile(fileRow), packages);
      }
      if (blocksResult.blocks.length === 0) {
        console.log('Both AI services failed to parse BOQ blocks, using fallback parser');
        const fallbackBlocks = createFallbackBOQBlocks(await getBoqTextForFile(fileRow), packages);
        if (fallbackBlocks.length === 0) {
          return res.status(400).json({ error: 'Failed to parse BOQ blocks - no content found' });
        }
        blocksResult.blocks = fallbackBlocks;
        blocksResult.source = 'fallback';
      }
      
      // Split using v2/v1 ranges
      const splitFiles = await splitBOQIntoPackages(
        fileBuffer,
        fileRow.DisplayName,
        packages,
        req.body.packageRanges || {},
        req.body.headerRange,
        req.body.rowPackageAssignments || null
      );

      // Upload generated files (overwrite existing by name in same folder; avoid duplicate rows)
      const uploadedFiles = [];
      for (const splitFile of splitFiles) {
        try {
          const displayName = splitFile.fileName;
          const buffer = splitFile.buffer;

          // Determine folder to place the split file (same as original or tender root)
          let targetFolderId = fileRow.FolderID || null;
          if (!targetFolderId) {
            const rootRes = await pool.request()
              .input('DocID', tenderId)
              .query(`SELECT TOP 1 FolderID FROM tenderFolder WHERE DocID = @DocID ORDER BY FolderID ASC`);
            targetFolderId = rootRes.recordset[0]?.FolderID || null;
          }

          const userId = req.user?.UserID || null;

          // Check if a file with this name already exists in the same folder (not deleted)
          const existingRes = await pool.request()
            .input('FolderID', targetFolderId)
            .input('DisplayName', displayName)
            .query(`
              SELECT TOP 1 FileID, BlobPath, ContentType
              FROM tenderFile
              WHERE FolderID = @FolderID AND DisplayName = @DisplayName AND (IsDeleted = 0 OR IsDeleted IS NULL)
              ORDER BY UploadedOn DESC
            `);

          let newFileId, blobPath, contentType;
          if (existingRes.recordset.length > 0) {
            const existing = existingRes.recordset[0];
            // Overwrite existing file
            const overwriteResult = await overwriteExistingFile(existing.FileID, existing.BlobPath, buffer, existing.ContentType);
            newFileId = overwriteResult.fileId;
            blobPath = overwriteResult.blobPath;
            contentType = overwriteResult.contentType;
          } else {
            // Create new file
            const uploaded = await uploadBufferToFolder(buffer, targetFolderId, displayName, tenderId, userId);
            newFileId = uploaded.fileId;
            blobPath = uploaded.blobPath;
            contentType = uploaded.contentType;
          }

          uploadedFiles.push({
            packageName: splitFile.packageName,
            fileName: displayName,
            fileId: newFileId,
            blobPath,
            startRow: splitFile.startRow,
            endRow: splitFile.endRow,
            rowCount: splitFile.rowCount,
            mimeType: contentType
          });
        } catch (error) {
          console.error(`Error processing split file ${splitFile.fileName}:`, error);
        }
      }

      return res.json({
        success: true,
        message: `BOQ split into ${uploadedFiles.length} files successfully`,
        source: blocksResult.source,
        splitFiles: uploadedFiles
      });
    } catch (error) {
      console.error('Error splitting BOQ:', error);
      res.status(500).json({ error: 'Failed to split BOQ' });
    }
  },

  // PUT /api/boq/:tenderId/:fileId/packages
  updatePackages: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      const { packages, packageRanges, rowPackageAssignments } = req.body;
      
      if (!packages || !Array.isArray(packages)) {
        return res.status(400).json({ error: 'Packages array is required' });
      }

      const pool = await getConnectedPool();

      // Treat Global as frontend-only (do not persist as a separate package)
      const packagesToStore = packages.filter(p => p !== 'Global');

      // Get existing packages to preserve PackageIDs for RFQ relationships
      const existingPkgsRes = await pool.request()
        .input('TenderID', tenderId)
        .input('FileID', fileId)
        .query(`
          SELECT PackageID, PackageName
          FROM tenderBoQPackages
          WHERE TenderID = @TenderID AND FileID = @FileID
        `);
      
      const existingPkgs = {};
      existingPkgsRes.recordset.forEach(pkg => {
        existingPkgs[pkg.PackageName] = pkg.PackageID;
      });

      // Identify packages to remove (exist in DB but not in new list)
      const packagesToRemove = Object.keys(existingPkgs).filter(name => !packagesToStore.includes(name));
      
      // Remove packages that are no longer in the list (but only if they have no RFQs)
      for (const packageName of packagesToRemove) {
        const packageId = existingPkgs[packageName];
        // Check if package has RFQs
        const rfqCheck = await pool.request()
          .input('PackageID', packageId)
          .query(`SELECT COUNT(*) as RfqCount FROM tenderPackageRFQ WHERE PackageID = @PackageID`);
        
        if (rfqCheck.recordset[0].RfqCount === 0) {
          // No RFQs, safe to delete
          await pool.request()
            .input('PackageID', packageId)
            .query(`DELETE FROM tenderBoQPackages WHERE PackageID = @PackageID`);
        } else {
          // Has RFQs, keep the package but mark it as inactive or just leave it
          // For now, we'll keep it but update it to match current ranges
          console.log(`[updatePackages] Keeping package "${packageName}" (PackageID: ${packageId}) because it has ${rfqCheck.recordset[0].RfqCount} RFQ(s)`);
        }
      }

      // Collect Global rows (to be included in all packages)
      const globalRowsBySheet = {};
      if (rowPackageAssignments && Object.keys(rowPackageAssignments).length > 0) {
        for (const [sheetName, rowAssignments] of Object.entries(rowPackageAssignments)) {
          for (const [rowIndexStr, assignedPackage] of Object.entries(rowAssignments)) {
            if (assignedPackage === 'Global') {
              const rowIndex = parseInt(rowIndexStr, 10);
              if (!isNaN(rowIndex)) {
                if (!globalRowsBySheet[sheetName]) globalRowsBySheet[sheetName] = [];
                globalRowsBySheet[sheetName].push(rowIndex);
              }
            }
          }
        }
      }

      // Save each package with compact TableRange JSON in tenderBoQPackages.TableRange
      for (const packageName of packagesToStore) {
        const perSheetRows = {};

        if (rowPackageAssignments && Object.keys(rowPackageAssignments).length > 0) {
          // v2 model - gather package rows per sheet and merge Global
          for (const [sheetName, rowAssignments] of Object.entries(rowPackageAssignments)) {
            for (const [rowIndexStr, assignedPackage] of Object.entries(rowAssignments)) {
              if (assignedPackage === packageName) {
                const rowIndex = parseInt(rowIndexStr, 10);
                if (!isNaN(rowIndex)) {
                  if (!perSheetRows[sheetName]) perSheetRows[sheetName] = [];
                  perSheetRows[sheetName].push(rowIndex);
                }
              }
            }
          }
        } else if (packageRanges && packageRanges[packageName]) {
          // Legacy single range
          const range = packageRanges[packageName];
          if (range.sheet && typeof range.startRow === 'number' && typeof range.endRow === 'number') {
            perSheetRows[range.sheet] = [];
            for (let r = range.startRow; r <= range.endRow; r++) perSheetRows[range.sheet].push(r);
          }
        }

        // Merge Global rows
        for (const [sheet, rows] of Object.entries(globalRowsBySheet)) {
          if (!perSheetRows[sheet]) perSheetRows[sheet] = [];
          perSheetRows[sheet].push(...rows);
        }

        // Build compact JSON { sheet: "1-5,9,15-150", Global: { sheet: "..." } }
        const compact = {};
        for (const [sheet, rows] of Object.entries(perSheetRows)) {
          compact[sheet] = compactRowsToRangeString(rows);
        }
        const globalCompact = {};
        for (const [sheet, rows] of Object.entries(globalRowsBySheet)) {
          globalCompact[sheet] = compactRowsToRangeString(rows);
        }
        const combined = Object.keys(globalCompact).length > 0 ? { ...compact, Global: globalCompact } : compact;
        const compactJson = Object.keys(combined).length > 0 ? JSON.stringify(combined) : null;

        // Check if package already exists
        if (existingPkgs[packageName]) {
          // Update existing package to preserve PackageID and RFQ relationships
          await pool.request()
            .input('PackageID', existingPkgs[packageName])
            .input('TableRange', compactJson)
            .query(`
              UPDATE tenderBoQPackages
              SET TableRange = @TableRange, UpdatedAt = SYSDATETIME()
              WHERE PackageID = @PackageID
            `);
        } else {
          // Insert new package
          await pool.request()
            .input('TenderID', tenderId)
            .input('FileID', fileId)
            .input('PackageName', packageName)
            .input('TableRange', compactJson)
            .query(`
              INSERT INTO tenderBoQPackages (TenderID, FileID, PackageName, CreatedAt, UpdatedAt, TableRange)
              VALUES (@TenderID, @FileID, @PackageName, SYSDATETIME(), SYSDATETIME(), @TableRange)
            `);
        }
      }

      return res.json({
        success: true,
        message: `Updated ${packagesToStore.length} packages successfully`,
        packages: packagesToStore
      });
    } catch (error) {
      console.error('Error updating packages:', error);
      res.status(500).json({ error: 'Failed to update packages' });
    }
  },

  // GET /api/boq/:tenderId/:fileId/split-files
  getSplitFiles: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      const pool = await getConnectedPool();

      // Get the original BOQ file info
      const fileRes = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT FileID, FolderID, DisplayName, UploadedOn
          FROM tenderFile
          WHERE FileID = @FileID AND (IsDeleted = 0 OR IsDeleted IS NULL)
        `);

      if (fileRes.recordset.length === 0) {
        return res.status(404).json({ error: 'BOQ file not found', items: [] });
      }

      const originalFile = fileRes.recordset[0];
      const folderId = originalFile.FolderID;

      // Find split files by:
      // 1. Files in the same folder that match the pattern *_BOQ.xlsx
      // 2. AND were created after the original BOQ file
      // 3. OR files linked via tenderBoQPackages with BoQID matching this file's BOQ entries
      
      // First, get any BOQID(s) associated with this file
      // Simple folder-based discovery: all split files in same folder matching pattern
      const splitFilesQuery = await pool.request()
        .input('FolderID', folderId)
        .input('FileID', fileId)
        .query(`
          SELECT
            f.FileID,
            f.DisplayName,
            f.Size,
            f.ContentType,
            f.UploadedOn,
            f.BlobPath,
            NULL as PackageName,
            NULL as TableRange
          FROM tenderFile f
          WHERE f.FolderID = @FolderID
            AND f.DisplayName LIKE '%_BOQ.xlsx'
            AND f.FileID != @FileID
            AND (f.IsDeleted = 0 OR f.IsDeleted IS NULL)
          ORDER BY f.UploadedOn DESC
        `);

      const splitFiles = splitFilesQuery.recordset.map(file => ({
        fileId: file.FileID,
        fileName: file.DisplayName,
        size: file.Size,
        contentType: file.ContentType,
        uploadedAt: file.UploadedOn,
        blobPath: file.BlobPath,
        packageName: file.PackageName || null,
        tableRange: file.TableRange || null
      }));

      return res.json({
        success: true,
        items: splitFiles
      });
    } catch (error) {
      console.error('Error fetching split files:', error);
      res.status(500).json({ error: 'Failed to fetch split files', items: [] });
    }
  },

  // GET /api/boq/:tenderId/:fileId/packages/dashboard
  getPackageDashboardStats: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      const pool = await getConnectedPool();

      // Read packages from tenderBoQPackages for the original file
      const packagesQuery = await pool.request()
        .input('TenderID', parseInt(tenderId))
        .input('FileID', parseInt(fileId))
        .query(`
          SELECT DISTINCT PackageName, PackageID
          FROM tenderBoQPackages
          WHERE TenderID = @TenderID AND FileID = @FileID
          ORDER BY PackageName
        `);

      const packageRecords = packagesQuery.recordset;
      if (packageRecords.length === 0) {
        return res.json({ success: true, packages: [] });
      }

      // For each package, get RFQ stats using PackageID
      const statsPromises = packageRecords.map(async (pkgRecord) => {
        const packageName = pkgRecord.PackageName;
        const packageId = pkgRecord.PackageID;
        
        try {
          const rfqRes = await pool.request()
            .input('PackageID', packageId)
            .query(`
              SELECT r.BOQRFQID, r.CompanyID, c.CompanyName AS CompanyName, r.PackageID, r.RFQDate, r.QuotationReturn, r.Value, r.AddBy, r.CreatedDate, r.UpdatedDate, r.SubbieRef, r.Notes
              FROM tenderPackageRFQ r
              LEFT JOIN tenderCompany c ON c.CompanyID = r.CompanyID
              WHERE r.PackageID = @PackageID
              ORDER BY r.CreatedDate DESC
            `);

          const items = rfqRes.recordset || [];
          const sent = items.filter((item) => item.RFQDate).length;
          const returned = items.filter((item) => item.QuotationReturn).length;
          const returnedQuotes = items
            .filter((item) => item.QuotationReturn && item.Value)
            .map((item) => {
              const value = typeof item.Value === 'number' ? item.Value : Number(item.Value);
              return isNaN(value) || value <= 0 ? null : value;
            })
            .filter((v) => v !== null);
          const minValue = returnedQuotes.length > 0 ? Math.min(...returnedQuotes) : 0;
          const maxValue = returnedQuotes.length > 0 ? Math.max(...returnedQuotes) : 0;
          const quotations = items
            .filter((item) => item.QuotationReturn && item.Value)
            .map((item) => ({
              companyName: item.CompanyName || `Company ${item.CompanyID}`,
              value: typeof item.Value === 'number' ? item.Value : Number(item.Value),
              quotationReturn: item.QuotationReturn ? new Date(item.QuotationReturn).toISOString().split('T')[0] : null
            }))
            .sort((a, b) => a.value - b.value);

          // Include all sent quotations (those with RFQDate)
          const sentQuotations = items
            .filter((item) => item.RFQDate)
            .map((item) => ({
              companyName: item.CompanyName || `Company ${item.CompanyID}`,
              value: item.Value ? (typeof item.Value === 'number' ? item.Value : Number(item.Value)) : null,
              rfqDate: item.RFQDate ? new Date(item.RFQDate).toISOString().split('T')[0] : null,
              quotationReturn: item.QuotationReturn ? new Date(item.QuotationReturn).toISOString().split('T')[0] : null,
              companyId: item.CompanyID,
              rfqId: item.BOQRFQID,
              notes: item.Notes || null,
              subbieRef: item.SubbieRef || null
            }))
            .sort((a, b) => {
              const dateA = a.rfqDate ? new Date(a.rfqDate).getTime() : 0
              const dateB = b.rfqDate ? new Date(b.rfqDate).getTime() : 0
              return dateB - dateA // Most recent first
            });

          return { packageName, totalSent: sent, totalReturned: returned, minValue, maxValue, returnedQuotes, quotations, sentQuotations };
        } catch (error) {
          console.error(`Error fetching RFQs for package ${packageName}:`, error);
          return { packageName, totalSent: 0, totalReturned: 0, minValue: 0, maxValue: 0, returnedQuotes: [], quotations: [], sentQuotations: [] };
        }
      });

      const results = await Promise.all(statsPromises);
      return res.json({ success: true, packages: results });
    } catch (error) {
      console.error('Error fetching package dashboard stats:', error);
      res.status(500).json({ error: 'Failed to fetch package dashboard stats', packages: [] });
    }
  }
  ,
  // GET /api/boq/:tenderId/:fileId/breakdown-report
  breakdownReport: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      const pool = await getConnectedPool();

      // Load original file
      const fileRes = await pool.request()
        .input('FileID', parseInt(fileId))
        .query(`SELECT FileID, BlobPath, DisplayName FROM tenderFile WHERE FileID = @FileID AND (IsDeleted = 0 OR IsDeleted IS NULL)`);
      if (fileRes.recordset.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }
      const fileRow = fileRes.recordset[0];

      const stream = await downloadFile(fileRow.BlobPath);
      const buffer = await streamToBuffer(stream);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      const keywords = ['qty', 'quantity', 'price', 'value', 'total'];
      const sheetValueRows = {};

      workbook.worksheets.forEach((ws) => {
        const name = ws.name;
        const valueRows = new Set();
        const candidateCols = new Set();
        const headerRowsToCheck = [1, 2, 3].filter(r => r <= ws.rowCount);
        headerRowsToCheck.forEach(rIdx => {
          const r = ws.getRow(rIdx);
          r.eachCell((cell, col) => {
            const v = String(cell.value ?? '').toLowerCase();
            if (v && keywords.some(k => v.includes(k))) candidateCols.add(col);
          });
        });
        if (candidateCols.size === 0) {
          sheetValueRows[name] = valueRows; return;
        }
        for (let r = 1; r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          let hasPositive = false;
          candidateCols.forEach((col) => {
            const cell = row.getCell(col);
            let num = null;
            if (typeof cell.value === 'number') {
              num = cell.value;
            } else if (cell.value && typeof cell.value === 'object' && cell.value.richText) {
              const txt = cell.value.richText.map(t=>t.text).join('');
              const parsed = Number(String(txt).replace(/[^0-9.\-]/g, ''));
              if (!isNaN(parsed)) num = parsed;
            } else if (cell.value != null) {
              const parsed = Number(String(cell.value).replace(/[^0-9.\-]/g, ''));
              if (!isNaN(parsed)) num = parsed;
            }
            if (num != null && isFinite(num) && num > 0) hasPositive = true;
          });
          if (hasPositive) valueRows.add(r);
        }
        sheetValueRows[name] = valueRows;
      });

      // Assigned rows from tenderBoQPackages.TableRange
      const pkgRes = await pool.request()
        .input('TenderID', parseInt(tenderId))
        .input('FileID', parseInt(fileId))
        .query(`SELECT PackageName, TableRange FROM tenderBoQPackages WHERE TenderID = @TenderID AND FileID = @FileID`);

      const assignedRowsBySheet = {};
      for (const rec of pkgRes.recordset) {
        if (!rec.TableRange) continue;
        let parsed; try { parsed = JSON.parse(rec.TableRange); } catch (_) { continue; }
        const global = parsed.Global || {};
        for (const [sheet, rangeStr] of Object.entries(parsed)) {
          if (sheet === 'Global') continue;
          if (!assignedRowsBySheet[sheet]) assignedRowsBySheet[sheet] = new Set();
          expandRangeString(String(rangeStr)).forEach(r => assignedRowsBySheet[sheet].add(r));
        }
        for (const [sheet, rangeStr] of Object.entries(global)) {
          if (!assignedRowsBySheet[sheet]) assignedRowsBySheet[sheet] = new Set();
          expandRangeString(String(rangeStr)).forEach(r => assignedRowsBySheet[sheet].add(r));
        }
      }

      let totalCandidates = 0, totalAssigned = 0;
      const sheets = [];
      for (const [sheet, valueSet] of Object.entries(sheetValueRows)) {
        const assignedSet = assignedRowsBySheet[sheet] || new Set();
        const unassigned = [];
        valueSet.forEach((r) => {
          totalCandidates++;
          if (assignedSet.has(r)) totalAssigned++; else unassigned.push(r);
        });
        sheets.push({ sheet, candidates: valueSet.size, assigned: [...valueSet].filter(r=>assignedSet.has(r)).length, unassigned });
      }
      const percent = totalCandidates > 0 ? Math.round((totalAssigned / totalCandidates) * 100) : 0;

      return res.json({ success: true, percent, totalCandidates, totalAssigned, sheets });
    } catch (error) {
      console.error('Error creating breakdown report:', error);
      res.status(500).json({ error: 'Failed to create breakdown report' });
    }
  },
  // DELETE /api/boq/:tenderId/:fileId
  deleteBoQ: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      const pool = await getConnectedPool();

      // Soft-delete file and remove BOQ linkage and any saved package rows for this BOQ
      // Order: delete RFQs -> delete package rows -> delete tenderBoQ row -> soft-delete tenderFile
      try {
        // Delete RFQs linked via packages for this file (optional best-effort)
        await pool.request()
          .input('TenderID', parseInt(tenderId))
          .input('FileID', parseInt(fileId))
          .query(`
            DELETE r
            FROM tenderPackageRFQ r
            WHERE r.PackageID IN (
              SELECT p.PackageID FROM tenderBoQPackages p WHERE p.TenderID = @TenderID AND p.FileID = @FileID
            )
          `);
      } catch (_) {}

      try {
        // Delete saved package rows for this BOQ file
        await pool.request()
          .input('TenderID', parseInt(tenderId))
          .input('FileID', parseInt(fileId))
          .query(`DELETE FROM tenderBoQPackages WHERE TenderID = @TenderID AND FileID = @FileID`);
      } catch (_) {}

      // Fetch file to get blob path
      let fileRow = null;
      try {
        const fr = await pool.request()
          .input('FileID', parseInt(fileId))
          .query(`SELECT FileID, BlobPath FROM tenderFile WHERE FileID = @FileID`);
        fileRow = fr.recordset[0] || null;
      } catch (_) {}

      // Remove BOQ link
      await pool.request()
        .input('TenderID', parseInt(tenderId))
        .input('FileID', parseInt(fileId))
        .query(`DELETE FROM tenderBoQ WHERE TenderID = @TenderID AND FileID = @FileID`);

      // Delete blob from storage if exists
      try {
        if (fileRow && fileRow.BlobPath) {
          await require('../../config/azureBlobService').deleteFile(fileRow.BlobPath)
        }
      } catch (blobErr) {
        console.error('Error deleting blob:', blobErr.message)
      }

      // Hard delete file record
      await pool.request()
        .input('FileID', parseInt(fileId))
        .query(`DELETE FROM tenderFile WHERE FileID = @FileID`);

      return res.json({ success: true });
    } catch (error) {
      console.error('Error deleting BOQ:', error);
      res.status(500).json({ error: 'Failed to delete BOQ' });
    }
  }
};

module.exports = boqController;


