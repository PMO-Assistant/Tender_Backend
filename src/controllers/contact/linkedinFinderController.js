/**
 * LinkedIn Finder via Mistral Conversations + web_search (NO FABRICATION)
 * Endpoints:
 *   POST /contacts/:contactId/linkedin/playground  -> real web_search, verified-only
 *   GET  /contacts/:contactId/linkedin/history     -> history
 *   GET  /contacts/linkedin/test-table             -> create/check table
 */

'use strict';

const https = require('https');
const { getConnectedPool } = require('../../config/database');

// ---------------- CONFIG ----------------
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const CONVERSATIONS_URL = 'https://api.mistral.ai/v1/conversations';

// Model per Mistral docs (use a valid model id)
const MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
const RATE_LIMIT_MS = 60 * 1000;     // 60 sec per contact
const STREAM_HARD_TIMEOUT_MS = 20_000;

const httpsAgent = new https.Agent({ keepAlive: true });

// in-memory guards
const cache = new Map();            // key -> { profiles, timestamp }
const rateLimit = new Map();        // contactId -> lastTs

// ---------------- SMALL UTILS ----------------
function logDev(...args) {
  if (process.env.NODE_ENV !== 'production') console.log(...args);
}

function normalize(s = '') {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}
function tokens(name = '') { return normalize(name).split(/\s+/).filter(Boolean); }
function nameLikelyMatches(full, target) {
  const A = tokens(full);
  const B = tokens(target);
  if (B.length === 0) return false;
  const last = B[B.length - 1];
  const setA = new Set(A);
  let overlap = 0; B.forEach(t => { if (setA.has(t)) overlap++; });
  const lastMatch = setA.has(last);
  return lastMatch && (overlap >= Math.min(2, B.length));
}
function isLinkedInProfileUrl(url = '') {
  return /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+/i.test(url);
}
function includesCompany(text, company) {
  return new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text || '');
}
function includesIreland(text) { return /(dublin|ireland)/i.test(text || ''); }
function deriveLocation(text) {
  if (/dublin/i.test(text)) return 'Dublin, Ireland';
  if (/ireland/i.test(text)) return 'Ireland';
  return '';
}
function generateProfileId() { return Date.now() + Math.random().toString(36).slice(2, 10); }
function generateProfilePhoto(name) {
  const initials = (name || '').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const colors = ['bg-blue-500','bg-green-500','bg-purple-500','bg-red-500','bg-yellow-500'];
  return { type: 'initials', initials, color: colors[Math.floor(Math.random()*colors.length)] };
}
function calculateConfidence({ name, location }, targetName) {
  let score = 0;
  if (nameLikelyMatches(name, targetName)) score += 60;
  const loc = (location || '').toLowerCase();
  if (loc.includes('dublin')) score += 25; else if (loc.includes('ireland')) score += 15;
  return Math.min(score, 100);
}
function removeDupes(arr) {
  const seen = new Set();
  return arr.filter(p => {
    const key = `${normalize(p.name)}|${(p.linkedInUrl||'').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function prioritize(profiles) {
  return profiles.sort((a,b) => {
    const ad = (a.location||'').toLowerCase().includes('dublin');
    const bd = (b.location||'').toLowerCase().includes('dublin');
    if (ad && !bd) return -1; if (bd && !ad) return 1;
    const ai = (a.location||'').toLowerCase().includes('ireland');
    const bi = (b.location||'').toLowerCase().includes('ireland');
    if (ai && !bi) return -1; if (bi && !ai) return 1;
    return (b.confidence||0) - (a.confidence||0);
  });
}

// ---------------- CORE: CALL CONVERSATIONS + STREAM TOOL RESULTS ----------------
/**
 * We ask Mistral to ONLY use web_search, then we:
 *  - stream events
 *  - collect outputs from the web_search tool (urls/titles/snippets)
 *  - ignore any model-only text (prevents fabrication)
 */
async function runWebSearchViaConversations({ name, company }) {
  console.log(`[MISTRAL] Starting web_search for: ${name} at ${company}`);
  console.log(`[MISTRAL] Using model: ${MODEL}`);
  console.log(`[MISTRAL] API Key present: ${!!MISTRAL_API_KEY}`);
  
  const body = {
    model: MODEL,
    // Keep the prompt tiny; we’ll build profiles from tool outputs only.
    inputs: [
      {
        role: 'user',
        content: [
          `Find LinkedIn profile URLs for: "${name}" who works/worked at "${company}" in Ireland.`,
          `Use ONLY web_search. Do not invent anything.`,
          `Queries:`,
          `1) "${name}" "${company}" site:linkedin.com/in (Dublin OR Ireland)`,
          `2) "${name}" site:linkedin.com/in "${company}" Ireland`,
          `3) "${name}" "${company}" site:linkedin.com/in`
        ].join('\n')
      }
    ],
    tools: [
      { type: 'web_search' }
      // Optional: you can add a function tool, but we won't rely on it to avoid fabrication.
    ],
    completion_args: { temperature: 0.0, max_tokens: 800 },
    stream: true,
    instructions: ''
  };

  // Retry/backoff on 429/5xx
  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[MISTRAL] Attempt ${attempt}/3: Calling Mistral API...`);
    try {
      res = await fetch(CONVERSATIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': MISTRAL_API_KEY
        },
        body: JSON.stringify(body),
        agent: httpsAgent
      });
      console.log(`[MISTRAL] Response status: ${res.status} ${res.statusText}`);
      
      if (res.ok) {
        console.log(`[MISTRAL] API call successful, starting stream processing...`);
        break;
      }
      
      const status = res.status;
      if (status === 429 || (status >= 500 && status < 600)) {
        const wait = 400 * attempt;
        console.log(`[MISTRAL] Backoff attempt ${attempt}, waiting ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      const text = await res.text().catch(() => '');
      console.log(`[MISTRAL] Non-retryable error: ${status} ${res.statusText} - ${text}`);
      throw new Error(`[Mistral] HTTP ${status} ${res.statusText} ${text}`);
    } catch (fetchError) {
      console.log(`[MISTRAL] Fetch error on attempt ${attempt}:`, fetchError.message);
      if (attempt === 3) throw fetchError;
      const wait = 400 * attempt;
      await new Promise(r => setTimeout(r, wait));
    }
  }
  if (!res || !res.ok) {
    const text = res ? (await res.text().catch(() => '')) : '';
    console.log(`[MISTRAL] Failed after all retries: ${res?.status || 'NO_RESPONSE'} - ${text}`);
    throw new Error(`[Mistral] Failed after retries ${res?.status || ''} ${text}`);
  }

  console.log(`[MISTRAL] Starting SSE stream processing...`);
  
  // Parse Server-Sent Events (SSE). We look for tool_result events for "web_search".
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const collected = [];
  const started = Date.now();
  let eventCount = 0;
  let webSearchEvents = 0;

  while (true) {
    if (Date.now() - started > STREAM_HARD_TIMEOUT_MS) {
      console.log(`[MISTRAL] Stream timeout after ${STREAM_HARD_TIMEOUT_MS}ms`);
      break;
    }
    
    const { value, done } = await reader.read();
    if (done) {
      console.log(`[MISTRAL] Stream ended naturally`);
      break;
    }
    
    buffer += decoder.decode(value, { stream: true });
    eventCount++;

    // SSE frames are separated by double newlines
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      
      // Each frame may have lines like "event: ..." and "data: {...}"
      const lines = frame.split('\n');
      let dataLine = lines.find(l => l.startsWith('data:'));
      if (!dataLine) continue;

      const jsonStr = dataLine.replace(/^data:\s?/, '');
      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const evt = JSON.parse(jsonStr);
        
        // Log every event for debugging
        if (eventCount % 10 === 0) {
          console.log(`[MISTRAL] Event ${eventCount}:`, JSON.stringify(evt, null, 2));
        }

        // We don't rely on exact event schema; we look for web_search payloads
        // Typical shapes we accept:
        //   { type: "tool_result", name: "web_search", output: { results: [...] } }
        //   { type: "tool_result", tool: "web_search", output: [...] }
        //   { tool: { type: "web_search", results: [...] } }  // being tolerant
        const toolName = evt?.name || evt?.tool || evt?.tool_name || evt?.tool?.type;
        const isWebSearch = /web_search/i.test(String(toolName || ''));

        if (evt?.type === 'tool_result' && isWebSearch) {
          webSearchEvents++;
          console.log(`[MISTRAL] Web search event ${webSearchEvents}:`, JSON.stringify(evt, null, 2));
          
          const out = evt.output ?? evt.result ?? evt.results ?? evt.tool?.results ?? [];
          const arr = Array.isArray(out?.results) ? out.results : Array.isArray(out) ? out : [];
          console.log(`[MISTRAL] Extracted ${arr.length} results from web_search event`);
          
          for (const r of arr) {
            const url = r.url || r.link;
            const title = r.title || '';
            const snippet = r.snippet || r.summary || '';
            if (url && title) {
              collected.push({ url, title, snippet });
              console.log(`[MISTRAL] Collected result: ${title} - ${url}`);
            }
          }
        }
      } catch (parseError) {
        console.log(`[MISTRAL] Parse error on event ${eventCount}:`, parseError.message);
        // ignore malformed frames
      }
    }
  }

  console.log(`[MISTRAL] Stream processing complete. Total events: ${eventCount}, Web search events: ${webSearchEvents}, Collected results: ${collected.length}`);

  // De-duplicate collected results by URL
  const seen = new Set();
  const uniq = collected.filter(r => {
    const k = (r.url || '').toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  
  console.log(`[MISTRAL] Final unique results: ${uniq.length}`);
  return uniq.slice(0, 40);
}

// ---------------- BUILD VERIFIED PROFILES (STRICT) ----------------
function buildVerifiedProfiles({ name, company }, results) {
  const candidates = [];

  for (const { url, title, snippet } of results) {
    if (!isLinkedInProfileUrl(url)) continue;

    const text = `${title} ${snippet}`.trim();
    if (!includesCompany(text, company)) continue;
    if (!includesIreland(text)) continue;

    let foundName = title.replace(/\s*\|\s*LinkedIn\s*$/i, '').split(' - ')[0].trim() || name;
    if (!nameLikelyMatches(foundName, name)) continue;

    const location = deriveLocation(text);
    const profile = {
      id: generateProfileId(),
      name: foundName,
      company,
      position: 'Unknown Position',
      linkedInUrl: url,
      photo: generateProfilePhoto(foundName),
      analysis: 'Verified via web_search tool (title/snippet).',
      location,
      currentRole: false,          // not inferring current role
      companyVerified: true,       // verified by snippet/title mentioning company
      confidence: calculateConfidence({ name: foundName, location }, name),
      evidence: [{ url, title, snippet }]
    };
    candidates.push(profile);
  }

  return prioritize(removeDupes(candidates)).slice(0, 10);
}

// ---------------- PERSISTENCE ----------------
async function ensureTableExists(pool) {
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='contactLinkedInSearch' AND xtype='U')
    CREATE TABLE contactLinkedInSearch (
      SearchID INT IDENTITY(1,1) PRIMARY KEY,
      ContactID INT NOT NULL,
      ContactName NVARCHAR(255) NOT NULL,
      Company NVARCHAR(255) NOT NULL,
      SearchResults NVARCHAR(MAX) NOT NULL,
      ConfidenceScore INT NOT NULL,
      Location NVARCHAR(255),
      CompanyVerified BIT DEFAULT 0,
      CreatedAt DATETIME2 DEFAULT GETDATE()
    )
  `);
}

async function storeSearchResults(contactId, contactName, company, profiles) {
  try {
    const pool = await getConnectedPool();
    await ensureTableExists(pool);
    for (const p of profiles) {
      await pool.request()
        .input('ContactID', contactId)
        .input('ContactName', contactName)
        .input('Company', company)
        .input('SearchResults', JSON.stringify(p))
        .input('ConfidenceScore', p.confidence)
        .input('Location', p.location)
        .input('CompanyVerified', p.companyVerified)
        .query(`
          INSERT INTO contactLinkedInSearch
          (ContactID, ContactName, Company, SearchResults, ConfidenceScore, Location, CompanyVerified, CreatedAt)
          VALUES (@ContactID, @ContactName, @Company, @SearchResults, @ConfidenceScore, @Location, @CompanyVerified, GETDATE())
        `);
    }
    logDev(`[LINKEDIN] Stored ${profiles.length} search results`);
  } catch (e) {
    console.error('[LINKEDIN] storeSearchResults error:', e?.message || e);
  }
}

// ---------------- PUBLIC ENDPOINTS ----------------
async function findLinkedInProfilesPlayground(req, res) {
  try {
    console.log(`[LINKEDIN] === Starting LinkedIn search ===`);
    console.log(`[LINKEDIN] Request body:`, req.body);
    console.log(`[LINKEDIN] Contact ID:`, req.params.contactId);
    
    if (!MISTRAL_API_KEY) {
      console.log(`[LINKEDIN] ERROR: No Mistral API key configured`);
      return res.status(500).json({ success: false, message: 'Mistral API key not configured' });
    }

    const { name, company } = req.body;
    const contactId = req.params.contactId;
    console.log(`[LINKEDIN] Searching for: ${name} at ${company}`);

    // Per-contact rate limit
    const now = Date.now();
    const last = rateLimit.get(contactId);
    if (last && now - last < RATE_LIMIT_MS) {
      const wait = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000);
      console.log(`[LINKEDIN] Rate limited, wait ${wait}s`);
      return res.status(429).json({ success: false, message: `Please wait ${wait}s and try again.` });
    }
    rateLimit.set(contactId, now);

    // Cache
    const cacheKey = `${contactId}|${normalize(name)}|${normalize(company)}|PLAY`;
    const cached = cache.get(cacheKey);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      console.log(`[LINKEDIN] Returning cached results: ${cached.profiles.length} profiles`);
      return res.json({
        success: true,
        message: cached.profiles.length ? 'LinkedIn profiles (cached)' : 'No verified profiles (cached)',
        profiles: cached.profiles,
        cached: true
      });
    }

    console.log(`[LINKEDIN] No cache hit, calling Mistral API...`);

    // 1) Run conversations + collect web_search results
    console.log(`[LINKEDIN] Step 1: Calling runWebSearchViaConversations...`);
    const webResults = await runWebSearchViaConversations({ name, company });
    console.log(`[LINKEDIN] Web search returned ${webResults.length} results:`, webResults);

    // 2) Build STRICT verified profiles only from tool results
    console.log(`[LINKEDIN] Step 2: Building verified profiles...`);
    const profiles = buildVerifiedProfiles({ name, company }, webResults);
    console.log(`[LINKEDIN] Built ${profiles.length} verified profiles:`, profiles);

    // 3) Persist + cache
    console.log(`[LINKEDIN] Step 3: Storing results and caching...`);
    await storeSearchResults(contactId, name, company, profiles);
    cache.set(cacheKey, { profiles, timestamp: Date.now() });

    // 4) Respond
    console.log(`[LINKEDIN] Step 4: Sending response with ${profiles.length} profiles`);
    return res.json({
      success: true,
      message: profiles.length
        ? 'LinkedIn profiles found via Mistral web_search.'
        : 'No verified LinkedIn profiles found with Ireland evidence.',
      profiles,
      searchCriteria: {
        name, company, contactId,
        verification: 'Must be in web_search results; title/snippet must include company + (Dublin|Ireland).',
        fabricationGuard: 'Results are built only from tool outputs, never model-only text.'
      }
    });
  } catch (error) {
    console.error('[LINKEDIN] playground error:', error?.message || error);
    console.error('[LINKEDIN] Full error stack:', error);
    return res.status(500).json({ success: false, message: 'Failed to search via web_search', error: error.message });
  }
}

async function getSearchHistory(req, res) {
  try {
    const contactId = req.params.contactId;
    const pool = await getConnectedPool();
    await ensureTableExists(pool);

    const result = await pool.request()
      .input('ContactID', contactId)
      .query(`
        SELECT TOP 10 SearchID, ContactName, Company, SearchResults, ConfidenceScore, Location, CompanyVerified, CreatedAt
        FROM contactLinkedInSearch
        WHERE ContactID = @ContactID
        ORDER BY CreatedAt DESC
      `);

    const searchHistory = result.recordset.map(r => ({
      SearchID: r.SearchID,
      ContactName: r.ContactName,
      Company: r.Company,
      SearchResults: r.SearchResults,
      ConfidenceScore: r.ConfidenceScore,
      Location: r.Location,
      CompanyVerified: r.CompanyVerified,
      CreatedAt: r.CreatedAt
    }));

    res.json({ success: true, searchHistory });
  } catch (e) {
    console.error('[LINKEDIN] history error:', e?.message || e);
    res.status(500).json({ success: false, message: 'Failed to get search history', error: e.message });
  }
}

async function testTableCreation(req, res) {
  try {
    const pool = await getConnectedPool();
    await ensureTableExists(pool);
    res.json({ success: true, message: 'Table contactLinkedInSearch is ready' });
  } catch (e) {
    console.error('[LINKEDIN] testTableCreation error:', e?.message || e);
    res.status(500).json({ error: 'Failed to create table', message: e.message });
  }
}

module.exports = {
  findLinkedInProfilesPlayground,
  getSearchHistory,
  testTableCreation
};

