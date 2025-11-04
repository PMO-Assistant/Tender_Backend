const openAIService = require('../../config/openAIService');
const { getConnectedPool } = require('../../config/database');

/**
 * Search for employee information in CV files
 * @param {string} searchTerm - Term to search for (e.g., "CEO", "Manager", person name)
 * @returns {Promise<Array>} Array of employee information
 */
async function searchEmployeeInfo(searchTerm) {
  try {
    const pool = await getConnectedPool();
    
    // Search for files in Employee CV folder
    // Look for folder path containing "Employee CV" or "CV"
    const result = await pool.request()
      .query(`
        SELECT 
          f.FileID,
          f.DisplayName as FileName,
          f.Metadata,
          tf.FolderPath,
          tf.FolderName
        FROM tenderFile f
        INNER JOIN tenderFolder tf ON f.FolderID = tf.FolderID
        WHERE (tf.FolderPath LIKE '%Employee CV%' 
          OR tf.FolderPath LIKE '%/General/Employee%'
          OR tf.FolderName LIKE '%CV%'
          OR tf.FolderName LIKE '%Employee%')
        AND f.Metadata IS NOT NULL
        AND f.IsDeleted = 0
        ORDER BY f.CreatedAt DESC
      `);

    const employees = [];
    
    for (const file of result.recordset) {
      try {
        const metadata = JSON.parse(file.Metadata || '{}');
        const extractedText = metadata.extractedText || '';
        const title = metadata.title || file.FileName || '';
        
        // Check if this file is relevant to the search term
        const searchLower = searchTerm.toLowerCase();
        const textLower = extractedText.toLowerCase();
        const titleLower = title.toLowerCase();
        
        // Extract role from search term (e.g., "CEO", "Manager", "Director")
        const roleKeywords = ['ceo', 'chief executive', 'manager', 'director', 'head of', 'president', 'founder', 'team lead', 'supervisor'];
        let foundRole = null;
        for (const role of roleKeywords) {
          if (searchLower.includes(role)) {
            foundRole = role;
            break;
          }
        }
        
        // Check for role matches - if searching for a role, check if CV contains that role
        let isRoleMatch = false;
        if (foundRole) {
          // Check if the CV text contains the role title
          isRoleMatch = textLower.includes(foundRole) || 
                       textLower.includes(`${foundRole} -`) ||
                       textLower.includes(`- ${foundRole}`);
        }
        
        // Check if searching for person introduction/presentation
        const isPersonRequest = searchLower.includes('present') || 
                               searchLower.includes('introduce') ||
                               searchLower.includes('about') ||
                               searchLower.includes('who');
        
        // If searching for a specific role and this CV matches that role
        // OR if it's a general person request and we found any role in the CV
        if (isRoleMatch || (isPersonRequest && foundRole && textLower.includes(foundRole))) {
          // Extract key information
          const employeeInfo = {
            fileName: file.FileName,
            title: title,
            summary: metadata.summary || '',
            extractedText: extractedText.substring(0, 2000), // Limit to 2000 chars
            folderPath: file.FolderPath,
            metadata: {
              documentType: metadata.documentType,
              keywords: metadata.keywords || []
            }
          };
          
          employees.push(employeeInfo);
          
          // Limit to 3 most relevant matches
          if (employees.length >= 3) break;
        }
      } catch (parseError) {
        console.log(`Error parsing metadata for file ${file.FileID}:`, parseError.message);
        continue;
      }
    }
    
    return employees;
  } catch (error) {
    console.error('Error searching employee info:', error);
    return [];
  }
}

/**
 * Generate presentation slides using AI
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function generatePresentationSlides(req, res) {
  try {
    const { prompt, brandGuidelines, presentationTitle } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    // Check if prompt mentions a person/role - search for employee information
    let employeeContext = '';
    const personKeywords = ['ceo', 'chief executive', 'manager', 'director', 'present', 'introduce', 'about', 'team member', 'employee', 'staff'];
    const promptLower = prompt.toLowerCase();
    const mentionsPerson = personKeywords.some(keyword => promptLower.includes(keyword));
    
    if (mentionsPerson) {
      console.log('🔍 Detected person/role mention, searching employee CVs...');
      const employees = await searchEmployeeInfo(prompt);
      
      if (employees.length > 0) {
        employeeContext = '\n\nEMPLOYEE/CV INFORMATION FOUND:\n';
        employees.forEach((emp, index) => {
          employeeContext += `\n--- Employee ${index + 1} ---\n`;
          employeeContext += `File: ${emp.fileName}\n`;
          employeeContext += `Title: ${emp.title}\n`;
          if (emp.summary) employeeContext += `Summary: ${emp.summary}\n`;
          employeeContext += `CV Content:\n${emp.extractedText}\n`;
        });
        employeeContext += '\nUse this information to create personalized, accurate slides about the person mentioned. Include specific details from their CV like experience, qualifications, achievements, and projects.\n';
        console.log(`✅ Found ${employees.length} relevant employee CV(s)`);
      }
    }

    // Build comprehensive prompt for presentation generation
    const fullPrompt = `You are an expert visual presentation designer and creative director. Generate visually stunning, professional presentation slides with rich visual elements for a tender/proposal document.

${brandGuidelines ? `Brand Guidelines:\n${brandGuidelines}\n` : `Brand Guidelines - STRICT ADCO COLOR PALETTE (USE THESE COLORS ONLY):
- Primary/Accent: #FDCC09 (yellow/gold) - for highlights, shapes, accents
- Text/Secondary: #2b2b2b (dark gray/black) - for all text and borders
- Background: #FFFFFF (white) - for slide backgrounds
- NO OTHER COLORS ALLOWED - Do NOT use pink (#FF006E), purple, blue, or any other colors
- Professional, modern, and clean design aesthetic
- ADCO branding (construction/engineering company)
`}

CRITICAL DESIGN RULES:
1. USE ONLY ADCO COLORS: #FDCC09 (yellow), #2b2b2b (dark), #FFFFFF (white)
2. NEVER use same color for text and background - always ensure contrast
3. ALWAYS include a title on every slide - it's mandatory
4. Create VISUALLY RICH slides with shapes, image placeholders, and creative layouts
5. Be creative but professional - maintain brand consistency

User Request: ${prompt}

${employeeContext}

${presentationTitle ? `Presentation Title: ${presentationTitle}\n` : ''}

IMPORTANT: You must return ONLY a valid JSON array. No markdown, no explanations, no code fences. Just pure JSON.

Return an array of slide objects in this exact format:
[
  {
    "background": "#ffffff" or hex color (can use brand colors),
    "title": "Slide title (clear, SEO-friendly heading)",
    "content": "Main content/text (use \\n for line breaks)",
    "layout": "title-content" or "centered" or "visual" or "split",
    "keywords": ["keyword1", "keyword2"],
    "shapes": [
      {
        "type": "rectangle" or "circle" or "triangle",
        "x": 100,
        "y": 100,
        "width": 200,
        "height": 150,
        "fillColor": "#FDCC09",
        "strokeColor": "#2b2b2b",
        "strokeWidth": 2,
        "zIndex": 0
      }
    ],
    "imagePlaceholders": [
      {
        "x": 1200,
        "y": 200,
        "width": 600,
        "height": 400,
        "instruction": "Insert here the image of your CEO",
        "zIndex": 1
      }
    ],
    "titleStyle": {
      "fontSize": 48,
      "color": "#2b2b2b",
      "x": 100,
      "y": 100
    },
    "contentStyle": {
      "fontSize": 32,
      "color": "#2b2b2b",
      "x": 100,
      "y": 220
    }
  }
]

VISUAL DESIGN RULES - STRICT ADCO BRANDING:
1. ALWAYS add visual elements - shapes, boxes, decorative elements
2. Use shapes as backgrounds, accents, or framing elements
3. Add image placeholders with SPECIFIC, HELPFUL instructions like:
   - "Insert here the image of your CEO"
   - "Add project location map here"
   - "Insert company headquarters photo"
   - "Add team photo here"
   - "Insert project timeline diagram"
   - Be specific and creative!
4. USE ONLY ADCO COLORS: #FDCC09 (yellow) for shapes/accents, #2b2b2b (dark) for text/borders, #FFFFFF (white) for backgrounds
5. NEVER use pink, purple, blue, or any other colors - ONLY the 3 ADCO colors above
6. Create visual hierarchy with overlapping elements and z-index
7. Use shapes to create sections, frames, or highlight areas
8. Make layouts dynamic - don't just put everything in a line
9. ALWAYS ensure text contrast - dark text (#2b2b2b) on light backgrounds (#FFFFFF or #FDCC09), light text on dark backgrounds
10. EVERY slide MUST have a title element - no exceptions

SHAPE GUIDELINES:
- Rectangles: For boxes, sections, backgrounds, frames
- Circles: For emphasis, decorative elements, badges
- Triangles: For arrows, accents, dynamic elements
- fillColor: Use ONLY #FDCC09 (yellow) or #FFFFFF (white) - NEVER pink or other colors
- strokeColor: Use ONLY #2b2b2b (dark) for borders and definition
- Position strategically to frame or highlight content

IMAGE PLACEHOLDER GUIDELINES:
- Large enough to be visible (minimum 400x300)
- Position them creatively (not always centered)
- Give SPECIFIC instructions that help the user
- Use descriptive instructions like "CEO photo", "project site", "team photo", etc.
- Think about what images would make the slide more compelling
- Use #FDCC09 (yellow) for placeholder border accents to match brand

CONTENT GUIDELINES - MANDATORY:
- EVERY slide MUST have a title - this is mandatory, no exceptions
- Titles must use color #2b2b2b (dark) for visibility and contrast
- Keep titles concise (max 8 words) but descriptive
- Content should be informative but concise (max 150 words per slide)
- Use professional construction/engineering terminology
- Include relevant keywords for SEO
- Structure with clear points (use \\n for line breaks)
- Ensure all text uses #2b2b2b (dark) color for readability
- Backgrounds should be #FFFFFF (white) or use #FDCC09 (yellow) shapes strategically

EXAMPLES OF CREATIVE LAYOUTS (using ONLY ADCO colors):
- Title slide: Large dark title (#2b2b2b) on white background, yellow (#FDCC09) decorative shapes behind, CEO photo placeholder on right with yellow border accent
- About Us: Dark text on white background, yellow rectangular accent shapes, team photo placeholder on right with yellow border
- Services: Dark text centered, yellow circular shape accents (#FDCC09), image placeholders with yellow borders
- Project Timeline: Dark text with yellow geometric shapes as visual elements, project photo placeholder with yellow border accent

COLOR USAGE EXAMPLES:
- Yellow (#FDCC09): Shape fills, border accents, highlights, decorative elements
- Dark (#2b2b2b): All text (titles, content, labels), shape borders/strokes
- White (#FFFFFF): Slide backgrounds, text backgrounds for contrast
- NEVER mix these colors inappropriately - ensure proper contrast always

Generate ${prompt.toLowerCase().includes('slide') ? 'the requested number of slides' : '3-5 visually rich slides'} with bold, creative visual designs!`;

    console.log('🎨 Generating presentation slides with AI...');

    // Call OpenAI service
    const aiResponse = await openAIService.query(fullPrompt);
    
    if (!aiResponse || !aiResponse.generated_query) {
      throw new Error('No response from AI service');
    }

    let slides = [];
    
    try {
      // Try to parse JSON from response
      let jsonStr = aiResponse.generated_query.trim();
      
      // Remove markdown code blocks if present
      jsonStr = jsonStr.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
      
      // Extract JSON array if it's embedded in text
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
      
      slides = JSON.parse(jsonStr);
      
      // Validate slides structure
      if (!Array.isArray(slides)) {
        throw new Error('Response is not an array');
      }
      
      // Validate and preserve all slide fields including visual elements
      slides = slides.map((slide, index) => ({
        title: slide.title || `Slide ${index + 1}`,
        content: slide.content || '',
        layout: slide.layout || 'title-content',
        keywords: Array.isArray(slide.keywords) ? slide.keywords : [],
        background: slide.background || '#ffffff',
        shapes: Array.isArray(slide.shapes) ? slide.shapes : [],
        imagePlaceholders: Array.isArray(slide.imagePlaceholders) ? slide.imagePlaceholders : [],
        titleStyle: slide.titleStyle || {},
        contentStyle: slide.contentStyle || {}
      }));
      
      console.log(`✅ Generated ${slides.length} slides successfully`);
      
      return res.json({
        success: true,
        slides,
        count: slides.length,
        rawResponse: aiResponse.generated_query
      });
      
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError);
      console.log('Raw response:', aiResponse.generated_query);
      
      // Try to extract slides from natural language response
      // This is a fallback if the AI doesn't return pure JSON
      return res.json({
        success: false,
        error: 'Failed to parse AI response as JSON',
        rawResponse: aiResponse.generated_query,
        suggestion: 'Please try rephrasing your request or ask for a specific number of slides'
      });
    }

  } catch (error) {
    console.error('❌ Error generating presentation slides:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate presentation slides'
    });
  }
}

module.exports = {
  generatePresentationSlides
};

