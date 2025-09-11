const axios = require('axios');
const { getConnectedPool } = require('../../config/database');
const { downloadFile } = require('../../config/azureBlobService');
const mistralService = require('../../services/mistralService');

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
    return await mistralService.extractTextContent(buffer, fileName, contentType);
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
  console.log(`Generated ${result.length} fallback packages:`, result);
  return result;
}

async function callMistralForPackages(text) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.log('No Mistral API key found, using fallback packages');
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
    const resp = await axios.post('https://api.mistral.ai/v1/chat/completions', {
      model: 'mistral-large-latest',
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
        return { packages: uniq, source: 'ai' };
      }
    } catch (_) {}
    // Fallback if parsing fails
    console.log('Mistral response parsing failed, using fallback packages');
    return { packages: simpleHeuristicPackages(text), source: 'fallback' };
  } catch (e) {
    // Check if it's a capacity/service tier error
    const errorData = e.response?.data;
    if (errorData && (errorData.code === '3505' || errorData.type === 'service_tier_capacity_exceeded')) {
      console.log('Mistral service tier capacity exceeded, using fallback packages');
    } else {
      console.log('Mistral API error, using fallback packages:', e.response?.data?.message || e.message);
    }
    return { packages: simpleHeuristicPackages(text), source: 'fallback' };
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
        return { blocks: parsed.blocks, source: 'ai' };
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

const boqController = {
  // GET /api/boq/:tenderId/:fileId/propose
  proposeBreakdown: async (req, res) => {
    try {
      const { tenderId, fileId } = req.params;
      const pool = await getConnectedPool();

      const fileRes = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT FileID, DocID, BlobPath, DisplayName, ContentType, ExtractedText
          FROM tenderFile
          WHERE FileID = @FileID AND (IsDeleted = 0 OR IsDeleted IS NULL)
        `);

      if (fileRes.recordset.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fileRow = fileRes.recordset[0];
      // Optional: ensure belongs to tender
      if (tenderId && fileRow.DocID && String(fileRow.DocID) !== String(tenderId)) {
        // Not blocking, but informatively continue
        console.warn('BOQ file DocID differs from requested tenderId');
      }

      const text = await getBoqTextForFile(fileRow);
      const result = await callMistralForPackages(text);

      return res.json({
        success: true,
        tenderId,
        fileId,
        packages: result.packages,
        source: result.source
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
          SELECT FileID, DocID, BlobPath, DisplayName, ContentType, ExtractedText
          FROM tenderFile
          WHERE FileID = @FileID AND (IsDeleted = 0 OR IsDeleted IS NULL)
        `);

      if (fileRes.recordset.length === 0) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fileRow = fileRes.recordset[0];
      const text = await getBoqTextForFile(fileRow);
      
      // Get AI to parse BOQ blocks
      const blocksResult = await callMistralForBOQBlocks(text, packages);
      
      // If Mistral failed, use fallback
      if (blocksResult.blocks.length === 0) {
        console.log('Mistral failed to parse BOQ blocks, using fallback parser');
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

      await pool.request()
        .input('FileID', fileId)
        .query('DELETE FROM tenderBoQBlocks WHERE FileID = @FileID');

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
              INSERT INTO tenderBoQBlocks (TenderID, FileID, BlockName, BlockOrder, Package)
              OUTPUT INSERTED.BlockID
              VALUES (@TenderID, @FileID, @BlockName, @BlockOrder, @Package)
            `);
          
          const blockId = blockRes.recordset[0].BlockID;
          console.log(`Inserted block: ${block.blockName} (ID: ${blockId})`);

          // Insert items for this block
          for (const item of block.items) {
            try {
              // Truncate description if it's extremely long (safety measure)
              let description = item.description || '';
              if (description.length > 4000) {
                console.log(`Truncating description for item ${item.code} from ${description.length} to 4000 characters`);
                description = description.substring(0, 4000);
              }
              
              await pool.request()
                .input('TenderID', tenderId)
                .input('FileID', fileId)
                .input('BlockID', blockId)
                .input('Code', item.code || null)
                .input('Description', description)
                .input('Qty', item.qty || null)
                .input('UoM', item.uom || null)
                .input('Rate', item.rate || null)
                .input('Package', block.package || 'General')
                .input('ItemOrder', item.itemOrder || 0)
                .query(`
                  INSERT INTO tenderBoQ (TenderID, FileID, BlockID, Code, Description, Qty, UoM, Rate, Package, ItemOrder)
                  VALUES (@TenderID, @FileID, @BlockID, @Code, @Description, @Qty, @UoM, @Rate, @Package, @ItemOrder)
                `);
              totalItemsInserted++;
            } catch (insertError) {
              console.error('Failed to insert BOQ item:', item, insertError);
            }
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

      // Get blocks first
      const blocksRes = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT BlockID, BlockName, BlockOrder, Package
          FROM tenderBoQBlocks
          WHERE FileID = @FileID AND (IsDeleted = 0 OR IsDeleted IS NULL)
          ORDER BY BlockOrder
        `);

      const blocks = blocksRes.recordset;

      // Get items for each block
      const itemsRes = await pool.request()
        .input('FileID', fileId)
        .query(`
          SELECT BoQID, BlockID, Code, Description, Qty, UoM, Rate, Package, ItemOrder
          FROM tenderBoQ
          WHERE FileID = @FileID AND (IsDeleted = 0 OR IsDeleted IS NULL)
          ORDER BY BlockID, ItemOrder
        `);

      const items = itemsRes.recordset;

      // Group items by block
      const blocksWithItems = blocks.map(block => ({
        ...block,
        items: items.filter(item => item.BlockID === block.BlockID)
      }));

      return res.json({
        success: true,
        blocks: blocksWithItems
      });

    } catch (error) {
      console.error('Error fetching BOQ items:', error);
      res.status(500).json({ error: 'Failed to fetch BOQ items' });
    }
  }
};

module.exports = boqController;


