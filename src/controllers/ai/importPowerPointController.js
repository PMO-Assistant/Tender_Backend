const JSZip = require('jszip');
const { getConnectedPool } = require('../../config/database');
const multer = require('multer');
const xml2js = require('xml2js');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || 
        file.originalname.endsWith('.pptx')) {
      cb(null, true);
    } else {
      cb(new Error('Only .pptx files are allowed'));
    }
  }
});

/**
 * Extract text from PowerPoint XML structure recursively
 */
function extractTextFromXml(obj) {
  if (!obj) return '';
  
  if (typeof obj === 'string') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => extractTextFromXml(item)).filter(Boolean).join('');
  }
  
  if (typeof obj === 'object') {
    let text = '';
    
    // PowerPoint text is typically in 'a:t' elements
    if (obj['a:t']) {
      const textParts = Array.isArray(obj['a:t']) ? obj['a:t'] : [obj['a:t']];
      text += textParts.map(t => extractTextFromXml(t)).join('');
    }
    
    // Also check for direct text content in '_' property
    if (obj['_']) {
      text += obj['_'];
    }
    
    // Recursively search all properties
    for (const key in obj) {
      if (key !== '_' && key !== 'a:t') {
        text += extractTextFromXml(obj[key]);
      }
    }
    
    return text;
  }
  
  return '';
}

/**
 * Get PowerPoint slide dimensions from presentation.xml
 */
async function getSlideDimensions(zipData) {
  try {
    const presentationXml = await zipData.file('ppt/presentation.xml')?.async('string');
    if (!presentationXml) {
      // Default to 16:9 (modern PowerPoint)
      return { widthEmu: 9600000, heightEmu: 5400000 };
    }
    
    const parser = new xml2js.Parser({ explicitArray: true, mergeAttrs: false });
    const presData = await parser.parseStringPromise(presentationXml);
    
    // PowerPoint slide size is in p:sldSz element
    // Standard dimensions:
    // - 16:9: 10" x 5.625" = 9600000 x 5400000 EMU
    // - 4:3: 10" x 7.5" = 9600000 x 7200000 EMU
    
    let widthEmu = 9600000;  // Default 10 inches
    let heightEmu = 5400000; // Default 5.625 inches (16:9)
    
    if (presData['p:presentation'] && Array.isArray(presData['p:presentation'])) {
      const presentation = presData['p:presentation'][0];
      if (presentation['p:sldSz']) {
        const sldSz = Array.isArray(presentation['p:sldSz']) ? presentation['p:sldSz'][0] : presentation['p:sldSz'];
        if (sldSz['$']) {
          widthEmu = parseInt(sldSz['$']['cx'] || widthEmu);
          heightEmu = parseInt(sldSz['$']['cy'] || heightEmu);
        }
      }
    }
    
    return { widthEmu, heightEmu };
  } catch (error) {
    console.warn('Failed to get slide dimensions, using defaults:', error);
    return { widthEmu: 9600000, heightEmu: 5400000 }; // Default 16:9
  }
}

/**
 * Convert PowerPoint slide to presentation slide format
 */
async function convertPptxSlide(slideZip, slideIndex, relsZip, pptDimensions) {
  try {
    const slidePath = `ppt/slides/slide${slideIndex + 1}.xml`;
    const slideXml = await slideZip.file(slidePath)?.async('string');
    
    if (!slideXml) {
      return null;
    }
    
    // Parse slide XML
    const parser = new xml2js.Parser({
      explicitArray: true,
      mergeAttrs: false,
      explicitCharkey: false,
      trim: true,
      ignoreAttrs: false
    });
    const slideData = await parser.parseStringPromise(slideXml);
    
    const elements = [];
    let currentZIndex = 0;
    
    // Our canvas dimensions (16:9 aspect ratio)
    const CANVAS_WIDTH = 1920;
    const CANVAS_HEIGHT = 1080;
    
    // PowerPoint slide dimensions in EMU
    const PPT_WIDTH_EMU = pptDimensions.widthEmu;
    const PPT_HEIGHT_EMU = pptDimensions.heightEmu;
    
    // Extract shapes and text boxes
    if (slideData['p:sld'] && slideData['p:sld']['p:cSld']) {
      const cSld = slideData['p:sld']['p:cSld'][0];
      if (cSld['p:spTree'] && cSld['p:spTree'][0]['p:sp']) {
        const shapes = cSld['p:spTree'][0]['p:sp'];
        
        for (const shape of shapes) {
          // Get shape position and size
          let x = 0, y = 0, width = 200, height = 150;
          let rotation = 0; // Declare rotation at the top level
          
          if (shape['p:spPr'] && shape['p:spPr'][0]['a:xfrm']) {
            const xfrm = shape['p:spPr'][0]['a:xfrm'][0];
            
            // PowerPoint uses EMU (English Metric Units): 1 inch = 914400 EMU
            // Convert EMU coordinates to our canvas pixels (1920x1080)
            if (xfrm['a:off']) {
              const emuX = parseInt(xfrm['a:off'][0]['$']['x'] || 0);
              const emuY = parseInt(xfrm['a:off'][0]['$']['y'] || 0);
              
              // Convert EMU to canvas pixels using actual PowerPoint slide dimensions
              x = Math.round((emuX / PPT_WIDTH_EMU) * CANVAS_WIDTH);
              y = Math.round((emuY / PPT_HEIGHT_EMU) * CANVAS_HEIGHT);
            }
            
            if (xfrm['a:ext']) {
              const emuW = parseInt(xfrm['a:ext'][0]['$']['cx'] || 200);
              const emuH = parseInt(xfrm['a:ext'][0]['$']['cy'] || 150);
              
              // Convert EMU dimensions to canvas pixels
              width = Math.round((emuW / PPT_WIDTH_EMU) * CANVAS_WIDTH);
              height = Math.round((emuH / PPT_HEIGHT_EMU) * CANVAS_HEIGHT);
            }
            
            // Handle rotation if present
            if (xfrm['$'] && xfrm['$']['rot']) {
              // PowerPoint rotation is in 60000ths of a degree
              rotation = parseInt(xfrm['$']['rot']) / 60000;
            }
          }
          
          // Check if it's a text box
          if (shape['p:txBody']) {
            // Extract text content
            const textBody = shape['p:txBody'][0];
            let textContent = '';
            
            if (textBody['a:p']) {
              const paragraphs = Array.isArray(textBody['a:p']) ? textBody['a:p'] : [textBody['a:p']];
              for (const paragraph of paragraphs) {
                if (paragraph['a:r']) {
                  const runs = Array.isArray(paragraph['a:r']) ? paragraph['a:r'] : [paragraph['a:r']];
                  for (const run of runs) {
                    if (run['a:t']) {
                      const textParts = Array.isArray(run['a:t']) ? run['a:t'] : [run['a:t']];
                      for (const text of textParts) {
                        if (typeof text === 'string') {
                          textContent += text;
                        } else if (text && typeof text === 'object') {
                          if (text['_']) {
                            textContent += text['_'];
                          } else if (Array.isArray(text)) {
                            textContent += text.join('');
                          }
                        }
                      }
                    }
                  }
                } else if (paragraph['a:br']) {
                  // Line break
                  textContent += '\n';
                }
                textContent += '\n';
              }
            }
            
            textContent = textContent.trim();
            
            if (textContent) {
              // Determine if it's a title (usually first text box, larger, or positioned at top)
              const isTitle = (y < 200 || (elements.length === 0 && y < 300)) && 
                             (textContent.length < 100) &&
                             (elements.filter(e => e.type === 'text').length === 0);
              
              // Extract font properties if available
              let fontSize = isTitle ? 48 : 32;
              let fontFamily = 'Arial';
              let color = '#2b2b2b';
              let fontWeight = isTitle ? 'bold' : 'normal';
              
              // Try to extract font properties from the first text run
              if (textBody['a:p'] && textBody['a:p'][0] && textBody['a:p'][0]['a:r']) {
                const firstRun = Array.isArray(textBody['a:p'][0]['a:r']) 
                  ? textBody['a:p'][0]['a:r'][0] 
                  : textBody['a:p'][0]['a:r'];
                
                if (firstRun['a:rPr']) {
                  const rPr = Array.isArray(firstRun['a:rPr']) ? firstRun['a:rPr'][0] : firstRun['a:rPr'];
                  if (rPr['$']) {
                    if (rPr['$']['sz']) {
                      // PowerPoint font size is in 100ths of a point
                      fontSize = Math.round(parseInt(rPr['$']['sz']) / 100);
                    }
                    if (rPr['$']['b']) {
                      fontWeight = 'bold';
                    }
                  }
                  if (rPr['a:solidFill'] && rPr['a:solidFill'][0] && rPr['a:solidFill'][0]['a:srgbCl']) {
                    const srgb = rPr['a:solidFill'][0]['a:srgbCl'][0]['$']['val'];
                    const hexColor = `#${srgb}`;
                    // Only use if it's an ADCO color, otherwise use default
                    if (hexColor.toUpperCase() === '#FDCC09' || hexColor.toUpperCase() === '#FFFFFF' || hexColor.toUpperCase() === '#2B2B2B') {
                      color = hexColor.toUpperCase();
                    }
                  }
                }
              }
              
              const textElement = {
                id: `text-${Date.now()}-${Math.random()}-${currentZIndex}`,
                type: 'text',
                x: Math.max(0, x),
                y: Math.max(0, y),
                width: Math.max(50, width),
                height: Math.max(30, height),
                rotation: rotation || 0,
                zIndex: currentZIndex++,
                content: textContent,
                fontSize: fontSize,
                fontFamily: fontFamily,
                color: color,
                fontWeight: fontWeight,
                fontStyle: 'normal',
                textDecoration: 'none',
                textTransform: 'none',
                textAlign: 'left',
                letterSpacing: 0,
                lineHeight: 1.5,
                opacity: 1,
              };
              
              elements.push(textElement);
            }
          } else {
            // It's a shape
            let fillColor = '#FDCC09';
            let strokeColor = '#2b2b2b';
            let shapeType = 'rectangle';
            
            if (shape['p:spPr'] && shape['p:spPr'][0]['a:prstGeom']) {
              const prst = shape['p:spPr'][0]['a:prstGeom'][0]['$']['prst'];
              if (prst === 'ellipse' || prst === 'circle') {
                shapeType = 'circle';
              }
            }
            
            if (shape['p:spPr'] && shape['p:spPr'][0]['a:solidFill']) {
              const solidFill = shape['p:spPr'][0]['a:solidFill'][0];
              if (solidFill['a:srgbCl']) {
                const srgb = solidFill['a:srgbCl'][0]['$']['val'];
                const color = `#${srgb}`;
                // Only use if it's an ADCO color
                if (color.toUpperCase() === '#FDCC09' || color.toUpperCase() === '#FFFFFF' || color.toUpperCase() === '#2B2B2B') {
                  fillColor = color;
                }
              }
            }
            
            // Rotation is already extracted above, no need to get it again
            
            const shapeElement = {
              id: `shape-${Date.now()}-${Math.random()}-${currentZIndex}`,
              type: 'shape',
              x: Math.max(0, x),
              y: Math.max(0, y),
              width: Math.max(10, width),
              height: Math.max(10, height),
              rotation: rotation || 0,
              zIndex: currentZIndex++,
              shapeType: shapeType,
              fillColor: fillColor,
              strokeColor: strokeColor,
              strokeWidth: 2,
              opacity: 1,
            };
            
            elements.push(shapeElement);
          }
        }
      }
    }
    
    // Ensure we have at least a title element
    const hasTitle = elements.some(el => el.type === 'text' && (el.y < 200 || el.fontSize >= 40));
    if (!hasTitle && elements.length > 0) {
      // Mark the first text element as title
      const firstText = elements.find(el => el.type === 'text');
      if (firstText) {
        firstText.fontSize = 48;
        firstText.fontWeight = 'bold';
        firstText.y = 100;
      }
    } else if (elements.length === 0) {
      // Add a default title if no elements found
      elements.push({
        id: `text-${Date.now()}-${Math.random()}-title`,
        type: 'text',
        x: 100,
        y: 100,
        width: 800,
        height: 80,
        rotation: 0,
        zIndex: 0,
        content: `Slide ${slideIndex + 1}`,
        fontSize: 48,
        fontFamily: 'Arial',
        color: '#2b2b2b',
        fontWeight: 'bold',
        fontStyle: 'normal',
        textDecoration: 'none',
        textTransform: 'none',
        textAlign: 'left',
        letterSpacing: 0,
        lineHeight: 1.2,
        opacity: 1,
      });
    }
    
    return {
      id: `slide-${Date.now()}-${Math.random()}`,
      elements: elements,
      background: '#FFFFFF', // Always use white for ADCO branding
    };
  } catch (error) {
    console.error(`Error converting slide ${slideIndex + 1}:`, error);
    return null;
  }
}

/**
 * Import PowerPoint presentation
 */
async function importPowerPoint(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const fileBuffer = req.file.buffer;
    const fileName = req.file.originalname;

    console.log(`📄 Importing PowerPoint: ${fileName} (${fileBuffer.length} bytes)`);

    // Parse PPTX file (it's a ZIP archive)
    const zip = new JSZip();
    const zipData = await zip.loadAsync(fileBuffer);

    // Get slide count from presentation.xml
    const presentationXml = await zipData.file('ppt/presentation.xml')?.async('string');
    if (!presentationXml) {
      throw new Error('Invalid PowerPoint file format');
    }

    const parser = new xml2js.Parser({
      explicitArray: true,
      mergeAttrs: false,
      explicitCharkey: false,
      trim: true,
      ignoreAttrs: false
    });
    const presData = await parser.parseStringPromise(presentationXml);
    
    console.log('Presentation XML structure:', JSON.stringify(Object.keys(presData), null, 2));
    console.log('First level keys:', Object.keys(presData));
    
    let slideCount = 0;
    
    // Try different possible XML structures
    // Structure 1: p:presentation -> p:sldIdLst
    if (presData['p:presentation'] && Array.isArray(presData['p:presentation']) && presData['p:presentation'][0]) {
      const presentation = presData['p:presentation'][0];
      if (presentation['p:sldIdLst'] && Array.isArray(presentation['p:sldIdLst']) && presentation['p:sldIdLst'][0]) {
        const sldIdLst = presentation['p:sldIdLst'][0];
        if (sldIdLst['p:sldId'] && Array.isArray(sldIdLst['p:sldId'])) {
          slideCount = sldIdLst['p:sldId'].length;
        }
      }
    }
    
    // Structure 2: presentation (without namespace prefix)
    if (slideCount === 0 && presData.presentation) {
      const presentation = Array.isArray(presData.presentation) ? presData.presentation[0] : presData.presentation;
      if (presentation.sldIdLst) {
        const sldIdLst = Array.isArray(presentation.sldIdLst) ? presentation.sldIdLst[0] : presentation.sldIdLst;
        if (sldIdLst.sldId && Array.isArray(sldIdLst.sldId)) {
          slideCount = sldIdLst.sldId.length;
        } else if (sldIdLst.sldId) {
          slideCount = 1;
        }
      }
    }
    
    // Structure 3: Check if there are slide files directly
    if (slideCount === 0) {
      // Count slide XML files in the ZIP
      const slideFiles = Object.keys(zipData.files).filter(file => 
        file.startsWith('ppt/slides/slide') && file.endsWith('.xml')
      );
      slideCount = slideFiles.length;
      console.log(`Found ${slideCount} slide files by counting files in ZIP`);
    }

    if (slideCount === 0) {
      throw new Error('No slides found in PowerPoint file');
    }

    console.log(`Found ${slideCount} slides in PowerPoint`);

    // Get actual PowerPoint slide dimensions
    const pptDimensions = await getSlideDimensions(zipData);
    console.log(`📐 PowerPoint slide dimensions: ${pptDimensions.widthEmu} x ${pptDimensions.heightEmu} EMU`);
    
    // Convert each slide
    const slides = [];
    for (let i = 0; i < slideCount; i++) {
      const slide = await convertPptxSlide(zipData, i, zipData, pptDimensions);
      if (slide && slide.elements.length > 0) {
        slides.push(slide);
      }
    }

    if (slides.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No slides could be extracted from the PowerPoint file'
      });
    }

    console.log(`✅ Successfully imported ${slides.length} slides`);

    return res.json({
      success: true,
      slides: slides,
      count: slides.length,
      fileName: fileName
    });

  } catch (error) {
    console.error('❌ Error importing PowerPoint:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to import PowerPoint file'
    });
  }
}

// Multer middleware for file upload
const uploadMiddleware = upload.single('file');

module.exports = {
  importPowerPoint,
  uploadMiddleware
};

