/**
 * LinkedIn Finder via OpenAI + web_search (NO FABRICATION)
 * Endpoints:
 *   POST /contacts/:contactId/linkedin/playground  -> real web_search, verified-only
 *   GET  /contacts/:contactId/linkedin/history     -> history
 *   GET  /contacts/linkedin/test-table             -> create/check table
 */

'use strict';

const https = require('https');
const { getConnectedPool } = require('../../config/database');

// ---------------- CONFIG ----------------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CONVERSATIONS_URL = 'https://api.openai.com/v1/chat/completions';
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const GOOGLE_CSE_API_KEY = process.env.GOOGLE_CSE_API_KEY;
const GOOGLE_CSE_CX = process.env.GOOGLE_CSE_CX;

// Model per OpenAI docs
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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

function normalizeWebsiteUrl(url = '') {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function extractPhone(text = '') {
  const m = String(text).match(/(\+?\d[\d\s().-]{7,}\d)/);
  return m ? m[1].trim() : '';
}

function getRootDomain(url = '') {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function isLinkedInCompanyUrl(url = '') {
  return /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/company\/[A-Za-z0-9\-_%]+/i.test(url);
}

function extractCompanyNameFromLinkedIn(url = '') {
  const m = String(url).match(/linkedin\.com\/company\/([^/?#]+)/i);
  if (!m) return '';
  return decodeURIComponent(m[1]).replace(/[-_]+/g, ' ').trim();
}

function normalizeCompanyNameKey(name = '') {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(limited|ltd|llc|inc|plc|co\.?|company)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mergeCompaniesByName(items = []) {
  const map = new Map();

  for (const raw of items) {
    const item = {
      name: String(raw?.name || '').trim(),
      linkedInUrl: String(raw?.linkedInUrl || '').trim(),
      location: String(raw?.location || '').trim(),
      phoneNumber: String(raw?.phoneNumber || '').trim(),
      website: String(raw?.website || '').trim(),
      sourceSnippet: String(raw?.sourceSnippet || '').trim(),
      sourceUrl: String(raw?.sourceUrl || '').trim()
    };
    if (!item.name) continue;

    const key = normalizeCompanyNameKey(item.name) || item.name.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }

    if (!existing.linkedInUrl && item.linkedInUrl) existing.linkedInUrl = item.linkedInUrl;
    if (!existing.website && item.website) existing.website = item.website;
    if (!existing.phoneNumber && item.phoneNumber) existing.phoneNumber = item.phoneNumber;
    if (!existing.location && item.location) existing.location = item.location;
    if ((!existing.sourceSnippet || existing.sourceSnippet.length < item.sourceSnippet.length) && item.sourceSnippet) {
      existing.sourceSnippet = item.sourceSnippet;
    }
    if (!existing.sourceUrl && item.sourceUrl) existing.sourceUrl = item.sourceUrl;
  }

  return Array.from(map.values());
}

function rankPeopleByPriority(items = []) {
  const managerKeywords = [
    'manager', 'managing', 'director', 'head of', 'lead', 'supervisor',
    'project manager', 'construction manager', 'site manager', 'operations manager'
  ];
  const constructionKeywords = [
    'engineer', 'engineering', 'construction', 'site', 'civil', 'mechanical', 'electrical',
    'architect', 'estimator', 'qs', 'quantity surveyor', 'foreman', 'project engineer'
  ];

  const scored = items.map((item) => {
    const text = `${item?.name || ''} ${item?.sourceSnippet || ''}`.toLowerCase();
    let priorityBucket = 3;
    let priorityScore = 0;

    if (managerKeywords.some(k => text.includes(k))) {
      priorityBucket = 1;
      priorityScore += 100;
    } else if (constructionKeywords.some(k => text.includes(k))) {
      priorityBucket = 2;
      priorityScore += 60;
    }

    if (item?.linkedInUrl) priorityScore += 20;
    if (/dublin/i.test(item?.location || '')) priorityScore += 10;
    else if (/ireland/i.test(item?.location || '')) priorityScore += 6;

    return { ...item, _priorityBucket: priorityBucket, _priorityScore: priorityScore };
  });

  scored.sort((a, b) => {
    if (a._priorityBucket !== b._priorityBucket) return a._priorityBucket - b._priorityBucket;
    return b._priorityScore - a._priorityScore;
  });

  return scored.map(({ _priorityBucket, _priorityScore, ...rest }) => rest);
}

function getPeoplePriorityBoost(item) {
  const text = `${item?.name || ''} ${item?.sourceSnippet || ''}`.toLowerCase();
  const managerKeywords = [
    'manager', 'managing', 'director', 'head of', 'lead', 'supervisor',
    'project manager', 'construction manager', 'site manager', 'operations manager'
  ];
  const constructionKeywords = [
    'engineer', 'engineering', 'construction', 'site', 'civil', 'mechanical', 'electrical',
    'architect', 'estimator', 'qs', 'quantity surveyor', 'foreman', 'project engineer'
  ];
  if (managerKeywords.some(k => text.includes(k))) return 120;
  if (constructionKeywords.some(k => text.includes(k))) return 70;
  return 0;
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
  console.log(`[OPENAI] Starting web_search for: ${name} at ${company}`);
  console.log(`[OPENAI] Using model: ${MODEL}`);
  console.log(`[OPENAI] API Key present: ${!!OPENAI_API_KEY}`);
  
  const body = {
    model: MODEL,
    messages: [
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
    ],
    temperature: 0.0,
    max_tokens: 800,
    stream: true
  };

  // Retry/backoff on 429/5xx
  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[OPENAI] Attempt ${attempt}/3: Calling OpenAI API...`);
    try {
      res = await fetch(CONVERSATIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify(body),
        agent: httpsAgent
      });
      console.log(`[OPENAI] Response status: ${res.status} ${res.statusText}`);
      
      if (res.ok) {
        console.log(`[OPENAI] API call successful, starting stream processing...`);
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

async function runDiscoveryWebSearch({ keyword, location = 'Ireland', mode = 'companies' }) {
  const queryA = `${keyword} ${location} inurl:linkedin`;
  const queryB = `${keyword} ${location}`;
  const queryC = mode === 'people'
    ? `${keyword} ${location} site:linkedin.com/in`
    : `${keyword} ${location} site:linkedin.com/company`;

  const decodeHtml = (s = '') => String(s)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const extractActualUrl = (href = '') => {
    try {
      const u = new URL(href);
      const uddg = u.searchParams.get('uddg');
      return uddg ? decodeURIComponent(uddg) : href;
    } catch {
      return href;
    }
  };

  const searchDuckDuckGo = async (query) => {
    const endpoint = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(endpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!resp.ok) throw new Error(`[Discovery] Search request failed (${resp.status})`);
    const html = await resp.text();

    const blocks = html.match(/<div class="result__body">[\s\S]*?<\/div>\s*<\/div>/g) || [];
    const out = [];
    for (const block of blocks) {
      const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!titleMatch) continue;
      const rawHref = titleMatch[1];
      const title = decodeHtml(titleMatch[2]);
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
      const snippet = decodeHtml((snippetMatch?.[1] || snippetMatch?.[2] || '').trim());
      const url = extractActualUrl(rawHref);
      if (!url || !title) continue;
      out.push({ url, title, snippet });
    }
    return out;
  };

  const queries = [queryA, queryB, queryC];
  const aggregated = [];
  for (const q of queries) {
    try {
      const results = await searchDuckDuckGo(q);
      aggregated.push(...results);
    } catch (error) {
      console.error(`[Discovery] query failed "${q}":`, error?.message || error);
    }
  }

  const seen = new Set();
  const uniq = aggregated.filter(r => {
    const k = String(r.url || '').toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return uniq.slice(0, 100);
}

function parseJsonFromText(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const out = Array.isArray(data?.output) ? data.output : [];
  for (const block of out) {
    const content = Array.isArray(block?.content) ? block.content : [];
    for (const c of content) {
      if (typeof c?.text === 'string' && c.text.trim()) return c.text;
    }
  }
  const msg = data?.choices?.[0]?.message?.content;
  if (typeof msg === 'string' && msg.trim()) return msg;
  return '';
}

async function runDiscoveryWithGptWeb({ keyword, location = 'Ireland', mode = 'companies' }) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');

  const systemPrompt = [
    'You are a web research analyst.',
    'Use web search tool results only.',
    'Return strict JSON only.',
    'JSON schema:',
    '{',
    '  "items": [',
    '    {',
    '      "name": "string",',
    '      "linkedInUrl": "string",',
    '      "location": "string",',
    '      "phoneNumber": "string",',
    '      "website": "string",',
    '      "sourceSnippet": "string",',
    '      "sourceUrl": "string"',
    '    }',
    '  ],',
    '  "summary": {',
    '    "overview": "string",',
    '    "recommendedNextSearches": ["string"],',
    '    "notes": "string"',
    '  }',
    '}',
    'Return max 10 items.'
  ].join('\n');

  const userPrompt = [
    `Research mode: ${mode}`,
    `Keyword: ${keyword}`,
    `Location: ${location}`,
    mode === 'people'
      ? 'Priority order for returned people: (1) managers/directors/leads, (2) construction/engineering roles, (3) any other roles if insufficient results.'
      : 'Return distinct company entities only (merge duplicates by company naming variants).',
    `Use search strategies like:`,
    `- ${keyword} ${location} inurl:linkedin`,
    `- ${keyword} ${location}`,
    `- ${mode === 'people' ? `${keyword} ${location} site:linkedin.com/in` : `${keyword} ${location} site:linkedin.com/company`}`
  ].join('\n');

  const response = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_DISCOVERY_MODEL || 'gpt-4.1-mini',
      tools: [{ type: 'web_search_preview' }],
      input: [
        { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: userPrompt }] }
      ],
      temperature: 0.1
    }),
    agent: httpsAgent
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`[GPT_WEB] HTTP ${response.status} ${response.statusText} ${text}`);
  }

  const data = await response.json();
  const text = extractResponseText(data);
  const parsed = parseJsonFromText(text);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error('GPT web response did not return valid JSON items');
  }

  return {
    items: parsed.items,
    summary: parsed.summary || null,
    rawText: text
  };
}

async function summarizeDiscoveryWithAI({ keyword, location, mode, items }) {
  if (!items || items.length === 0) {
    return {
      overview: 'No strong matches were found in this run.',
      recommendedNextSearches: [
        `${keyword} ${location} site:linkedin.com`,
        `${keyword} ${location} directory`,
        `${keyword} Dublin suppliers`
      ],
      notes: 'Try broader keywords or a different location.'
    };
  }

  if (!OPENAI_API_KEY) {
    return {
      overview: `Found ${items.length} candidate ${mode} for "${keyword}" in ${location}.`,
      recommendedNextSearches: [
        `${keyword} ${location} site:linkedin.com`,
        `${keyword} ${location} phone`,
        `${keyword} ${location} contact`
      ],
      notes: 'OpenAI key not configured, returning heuristic summary.'
    };
  }

  const body = {
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are a business research analyst. Return strict JSON with keys: overview, recommendedNextSearches (string[]), notes.'
      },
      {
        role: 'user',
        content: JSON.stringify({
          task: 'Summarize discovery results for sales researcher',
          keyword, location, mode,
          topItems: items.slice(0, 10)
        })
      }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  };

  const res = await fetch(CONVERSATIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(body),
    agent: httpsAgent
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI summary failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    return {
      overview: String(raw).slice(0, 400),
      recommendedNextSearches: [],
      notes: 'Model did not return valid JSON; raw text was preserved.'
    };
  }
}

function buildDiscoveryResults({ keyword, location = 'Ireland', mode = 'companies' }, results) {
  const normalizedLocation = String(location || '').trim().toLowerCase();
  const byDomain = new Map();
  const output = [];

  for (const r of results) {
    const url = String(r.url || '').trim();
    const title = String(r.title || '').trim();
    const snippet = String(r.snippet || '').trim();
    if (!url || !title) continue;

    const lc = `${title} ${snippet}`.toLowerCase();
    if (normalizedLocation && !lc.includes(normalizedLocation) && normalizedLocation !== 'ireland') {
      continue;
    }

    if (mode === 'companies') {
      const isLinkedCompany = isLinkedInCompanyUrl(url);
      const domain = getRootDomain(url);
      if (!isLinkedCompany && !domain) continue;

      const key = isLinkedCompany ? url.toLowerCase() : domain;
      let item = byDomain.get(key);
      if (!item) {
        const nameFromUrl = isLinkedCompany ? extractCompanyNameFromLinkedIn(url) : '';
        item = {
          name: nameFromUrl || title.replace(/\s*\|\s*LinkedIn\s*$/i, '').split(' - ')[0].trim() || 'Unknown',
          linkedInUrl: isLinkedCompany ? url : '',
          location: /dublin/i.test(lc) ? 'Dublin, Ireland' : (/ireland/i.test(lc) ? 'Ireland' : ''),
          phoneNumber: extractPhone(snippet),
          website: isLinkedCompany ? '' : normalizeWebsiteUrl(`https://${domain}`),
          sourceSnippet: snippet || title,
          sourceUrl: url
        };
        byDomain.set(key, item);
      } else {
        if (!item.linkedInUrl && isLinkedCompany) item.linkedInUrl = url;
        if (!item.website && !isLinkedCompany && domain) item.website = normalizeWebsiteUrl(`https://${domain}`);
        if (!item.phoneNumber) item.phoneNumber = extractPhone(snippet);
        if (!item.location) item.location = /dublin/i.test(lc) ? 'Dublin, Ireland' : (/ireland/i.test(lc) ? 'Ireland' : '');
      }
      continue;
    }

    const isLinkedPerson = /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\//i.test(url);
    if (!isLinkedPerson) continue;
    const name = title.replace(/\s*\|\s*LinkedIn\s*$/i, '').split(' - ')[0].trim();
    output.push({
      name: name || 'Unknown',
      linkedInUrl: url,
      location: /dublin/i.test(lc) ? 'Dublin, Ireland' : (/ireland/i.test(lc) ? 'Ireland' : ''),
      phoneNumber: extractPhone(snippet),
      website: '',
      sourceSnippet: snippet || title,
      sourceUrl: url
    });
  }

  const base = mode === 'companies' ? Array.from(byDomain.values()) : rankPeopleByPriority(output);
  const keywordLc = String(keyword || '').toLowerCase();
  const scored = base.map((item) => {
    let score = 0;
    const blob = `${item.name} ${item.sourceSnippet}`.toLowerCase();
    if (mode === 'people') score += getPeoplePriorityBoost(item);
    if (item.linkedInUrl) score += 30;
    if (item.website) score += 20;
    if (item.phoneNumber) score += 15;
    if (/dublin/i.test(item.location || '')) score += 25;
    else if (/ireland/i.test(item.location || '')) score += 15;
    if (keywordLc && blob.includes(keywordLc)) score += 20;
    return { ...item, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ score, ...rest }) => rest);
}

function extractNameFromLinkedInTitle(title = '') {
  return String(title || '').replace(/\s*\|\s*LinkedIn\s*$/i, '').split(' - ')[0].trim();
}

function isPersonMatchingLocation(person = {}, location = '') {
  const target = String(location || '').trim().toLowerCase();
  if (!target) return true;

  const text = `${person?.location || ''} ${person?.sourceSnippet || ''} ${person?.name || ''}`.toLowerCase();
  if (!text) return false;

  if (target === 'ireland') {
    const irelandHints = [
      'ireland', 'dublin', 'cork', 'galway', 'limerick', 'waterford', 'athlone',
      'kildare', 'wicklow', 'meath', 'kilkenny', 'wexford', 'mayo', 'sligo', 'clare',
      'tipperary', 'donegal', 'laois', 'offaly', 'longford', 'cavan', 'monaghan',
      'leitrim', 'roscommon', 'louth', 'westmeath', 'carlow', 'kerry'
    ];
    return irelandHints.some(h => text.includes(h));
  }

  return text.includes(target);
}

async function verifyPeopleLinkedInUrls(items = [], { companyHint = '', location = 'Ireland' } = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const searchLinkedInViaGptWeb = async (personName, company, personLocation) => {
    if (!OPENAI_API_KEY) return null;

    const prompt = [
      'Find a real LinkedIn profile URL for this person using web search.',
      `Person name: ${personName}`,
      `Company: ${company || ''}`,
      `Location hint: ${personLocation || location || ''}`,
      'Use query style: "Person Name" "Company" site:linkedin.com/in',
      'Return strict JSON only with keys: linkedInUrl, sourceUrl, sourceSnippet.',
      'If not found, return empty strings.'
    ].join('\n');

    const res = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_DISCOVERY_MODEL || 'gpt-4.1-mini',
        tools: [{ type: 'web_search_preview' }],
        input: [
          { role: 'user', content: [{ type: 'input_text', text: prompt }] }
        ],
        temperature: 0.0
      }),
      agent: httpsAgent
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = extractResponseText(data);
    const parsed = parseJsonFromText(text);
    if (!parsed || typeof parsed !== 'object') return null;

    const linkedInUrl = String(parsed.linkedInUrl || '').trim();
    const sourceUrl = String(parsed.sourceUrl || '').trim();
    const sourceSnippet = String(parsed.sourceSnippet || '').trim();
    if (!isLinkedInProfileUrl(linkedInUrl)) return null;
    return { linkedInUrl, sourceUrl: sourceUrl || linkedInUrl, sourceSnippet };
  };

  const searchGoogleCustom = async (query) => {
    if (!GOOGLE_CSE_API_KEY || !GOOGLE_CSE_CX) return [];
    const endpoint = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(GOOGLE_CSE_API_KEY)}&cx=${encodeURIComponent(GOOGLE_CSE_CX)}&q=${encodeURIComponent(query)}&num=10`;
    const resp = await fetch(endpoint);
    if (!resp.ok) return [];
    const data = await resp.json();
    const list = Array.isArray(data?.items) ? data.items : [];
    return list.map((it) => ({
      url: String(it?.link || ''),
      title: String(it?.title || ''),
      snippet: String(it?.snippet || '')
    }));
  };

  const useGoogle = Boolean(GOOGLE_CSE_API_KEY && GOOGLE_CSE_CX);
  if (!useGoogle && !OPENAI_API_KEY) {
    return rankPeopleByPriority(items.map((p) => ({ ...p, linkedInUrl: '' })));
  }

  const findMatchForPerson = async (person) => {
    const personName = String(person?.name || '').trim();
    if (!personName) return { ...person, linkedInUrl: '' };

    if (useGoogle) {
      const googleQuery = `"${personName}" "${companyHint}" site:linkedin.com/in`;
      const googleResults = await searchGoogleCustom(googleQuery);
      const fromGoogle = googleResults.find((r) => {
        const url = String(r?.url || '');
        if (!isLinkedInProfileUrl(url)) return false;
        const titleName = extractNameFromLinkedInTitle(r?.title || '');
        return nameLikelyMatches(titleName || personName, personName);
      });
      if (fromGoogle) {
        return {
          ...person,
          linkedInUrl: fromGoogle.url,
          sourceUrl: fromGoogle.url,
          sourceSnippet: fromGoogle.snippet || fromGoogle.title || person.sourceSnippet
        };
      }
    }

    const fromGptWeb = await searchLinkedInViaGptWeb(personName, companyHint, person?.location || location);
    if (fromGptWeb?.linkedInUrl) {
      return {
        ...person,
        linkedInUrl: fromGptWeb.linkedInUrl,
        sourceUrl: fromGptWeb.sourceUrl || fromGptWeb.linkedInUrl,
        sourceSnippet: fromGptWeb.sourceSnippet || person.sourceSnippet
      };
    }
    return { ...person, linkedInUrl: '' };
  };

  const verified = [];
  for (const person of items.slice(0, 12)) {
    // sequential to avoid hammering search providers
    // eslint-disable-next-line no-await-in-loop
    const resolved = await findMatchForPerson(person);
    verified.push(resolved);
  }

  const dedupe = new Map();
  for (const p of verified) {
    const key = `${normalize(p.name || '')}|${(p.linkedInUrl || '').toLowerCase()}`;
    if (!dedupe.has(key)) dedupe.set(key, p);
  }

  return rankPeopleByPriority(Array.from(dedupe.values()));
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
    
    if (!OPENAI_API_KEY) {
      console.log(`[OPENAI] ERROR: No OpenAI API key configured`);
      return res.status(500).json({ success: false, message: 'OpenAI API key not configured' });
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

async function discoverySearch(req, res) {
  try {
    const keyword = String(req.body?.keyword || '').trim();
    const location = String(req.body?.location || 'Ireland').trim();
    const mode = req.body?.mode === 'people' ? 'people' : 'companies';
    const companyName = String(req.body?.companyName || '').trim();
    const strictLinkedIn = req.body?.strictLinkedIn === true;

    if (!keyword) {
      return res.status(400).json({ success: false, message: 'keyword is required' });
    }

    let items = [];
    let summary = null;
    let webResults = [];
    let engine = 'gpt-web';

    try {
      const gptWeb = await runDiscoveryWithGptWeb({ keyword, location, mode });
      items = (gptWeb.items || []).map((item) => ({
        name: String(item?.name || '').trim(),
        linkedInUrl: String(item?.linkedInUrl || '').trim(),
        location: String(item?.location || '').trim(),
        phoneNumber: String(item?.phoneNumber || '').trim(),
        website: String(item?.website || '').trim(),
        sourceSnippet: String(item?.sourceSnippet || '').trim(),
        sourceUrl: String(item?.sourceUrl || '').trim()
      }));
      if (mode === 'companies') {
        items = mergeCompaniesByName(items);
      } else {
        items = await verifyPeopleLinkedInUrls(items, {
          companyHint: companyName || keyword,
          location
        });
        items = items.filter((p) => isPersonMatchingLocation(p, location));
        if (strictLinkedIn) {
          items = items.filter((p) => isLinkedInProfileUrl(p?.linkedInUrl || ''));
        }
      }
      items = items.slice(0, 10);
      summary = gptWeb.summary || null;
      webResults = items;
    } catch (gptError) {
      console.error('[DISCOVERY] GPT web failed, using fallback scraper:', gptError?.message || gptError);
      engine = 'fallback-scraper';
      webResults = await runDiscoveryWebSearch({ keyword, location, mode });
      items = buildDiscoveryResults({ keyword, location, mode }, webResults);
      if (mode === 'companies') {
        items = mergeCompaniesByName(items);
      } else {
        items = await verifyPeopleLinkedInUrls(items, {
          companyHint: companyName || keyword,
          location
        });
        items = items.filter((p) => isPersonMatchingLocation(p, location));
        if (strictLinkedIn) {
          items = items.filter((p) => isLinkedInProfileUrl(p?.linkedInUrl || ''));
        }
      }
      items = items.slice(0, 10);
      summary = await summarizeDiscoveryWithAI({ keyword, location, mode, items });
    }

    return res.json({
      success: true,
      message: items.length ? 'Discovery results ready.' : 'No matching discovery results found.',
      items,
      searchMeta: {
        keyword,
        location,
        mode,
        engine,
        rawResultsCount: webResults.length
      },
      research: {
        summary
      }
    });
  } catch (error) {
    console.error('[LINKEDIN] discoverySearch error:', error?.message || error);
    return res.status(500).json({ success: false, message: 'Failed to run discovery search', error: error?.message || 'Unknown error' });
  }
}

module.exports = {
  findLinkedInProfilesPlayground,
  getSearchHistory,
  testTableCreation,
  discoverySearch
};

