const axios = require('axios');

const DCC_NEWS_URL = 'https://www.dublincity.ie/planning-and-land-use/find-planning-application/weeks-planning-applications-and-decisions';

/**
 * GET /api/planning-news/latest
 * Fetches the latest Area 1 planning list from Dublin City Council website
 */
const getLatestPlanningNews = async (req, res) => {
  try {
    console.log('📰 Fetching latest planning news from Dublin City Council...');
    
    // Fetch the HTML page
    const response = await axios.get(DCC_NEWS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000 // 10 second timeout
    });

    const html = response.data;
    
    let week = null;
    let href = null;
    let size = undefined;

    // Strategy 1: Match the download block structure with Area 1 title
    // Look for: "Area 1 - Planning lists - Week XX" followed by download button
    const downloadBlockMatch = html.match(/Area\s*1\s*-\s*Planning lists\s*-\s*Week\s*(\d+)[\s\S]*?<a[^>]*href="([^"]+)"[^>]*class=["'][^"']*button[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*button__content[^"']*["'][^>]*>\s*Download\s+[^(]*\(([^)]+)\)/i);
    if (downloadBlockMatch) {
      week = downloadBlockMatch[1];
      href = downloadBlockMatch[2];
      size = downloadBlockMatch[3] ? downloadBlockMatch[3].trim() : undefined;
      console.log(`✅ Found Area 1 Week ${week} via Strategy 1`);
    }

    // Strategy 2: Match button link with a1-wpl filename pattern (Area 1 weekly planning lists)
    if (!href) {
      const a1LinkMatch = html.match(/<a[^>]*href="([^"]*\/(?:a1-wpl|area-1)[^"]*\.(?:docx|pdf))"[^>]*class=["'][^"']*button[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*button__content[^"']*["'][^>]*>\s*Download[^(]*\(([^)]+)\)/i);
      if (a1LinkMatch) {
        href = a1LinkMatch[1];
        size = a1LinkMatch[2] ? a1LinkMatch[2].trim() : undefined;
        // Try to extract week number from filename like "a1-wpl-43-25.docx"
        const weekMatch = href.match(/a1-wpl-(\d+)/i);
        if (weekMatch) {
          week = weekMatch[1];
        }
        console.log(`✅ Found Area 1 link via Strategy 2 (Week ${week || 'unknown'})`);
      }
    }

    // Strategy 3: Find any button with "Area 1" in nearby text (within 500 chars)
    if (!href) {
      const area1ButtonMatch = html.match(/Area\s*1[\s\S]{0,500}?<a[^>]*href="([^"]+\.(?:docx|pdf))"[^>]*class=["'][^"']*button[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*button__content[^"']*["'][^>]*>\s*Download[^(]*\(([^)]+)\)/i);
      if (area1ButtonMatch) {
        href = area1ButtonMatch[1];
        size = area1ButtonMatch[2] ? area1ButtonMatch[2].trim() : undefined;
        console.log(`✅ Found Area 1 link via Strategy 3`);
      }
    }

    // Strategy 4: Fallback - find first button link with docx/pdf
    if (!href) {
      const anyButtonMatch = html.match(/<a[^>]*href="([^"]+\.(?:docx|pdf))"[^>]*class=["'][^"']*button[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["'][^"']*button__content[^"']*["'][^>]*>\s*Download[^(]*\(([^)]+)\)/i);
      if (anyButtonMatch) {
        href = anyButtonMatch[1];
        size = anyButtonMatch[2] ? anyButtonMatch[2].trim() : undefined;
        console.log(`⚠️ Found link via Strategy 4 (fallback)`);
      }
    }

    if (href) {
      // Normalize relative URLs to absolute
      if (href.startsWith('/')) {
        href = `https://www.dublincity.ie${href}`;
      }
      
      const title = week ? `Area 1 - Planning lists - Week ${week}` : 'Latest Planning List (Area 1)';
      
      console.log(`✅ Successfully found: ${title}`);
      console.log(`   Link: ${href}`);
      console.log(`   Size: ${size || 'unknown'}`);
      
      return res.json({
        success: true,
        title,
        href,
        size
      });
    } else {
      console.log('❌ No Area 1 planning list found');
      return res.json({
        success: false,
        message: 'No Area 1 planning list found on the website'
      });
    }
  } catch (error) {
    console.error('❌ Error fetching planning news:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch planning news',
      message: error.message
    });
  }
};

module.exports = {
  getLatestPlanningNews
};

