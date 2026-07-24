import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wikidotDb = new DatabaseSync(path.join(__dirname, '..', '..', 'wikidot.db'));
wikidotDb.exec('PRAGMA journal_mode = WAL');

const SCP_WIKI_BASE = 'https://scp-wiki-cn.wikidot.com';
// Matches iframe tags with class="html-block-iframe" (any attribute order)
const IFRAME_RE = /<iframe\s(?=[^>]*class="html-block-iframe")[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/iframe>/gi;

// Simple in-memory cache for fetched iframe content (keyed by src URL)
const iframeCache = new Map();

/**
 * Extract html-block-iframe src attributes from HTML source.
 */
function extractHtmlBlockIframes(html) {
  const matches = [];
  const re = /<iframe\s(?=[^>]*class="html-block-iframe")[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/iframe>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

/**
 * Fetch a single iframe's content from the SCP wiki.
 * Uses cache to avoid repeated requests.
 */
async function fetchIframeContent(src) {
  if (iframeCache.has(src)) return iframeCache.get(src);

  const url = src.startsWith('http') ? src : `${SCP_WIKI_BASE}${src}`;
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SCPBot/1.0)' },
    });
    iframeCache.set(src, data);
    return data;
  } catch (err) {
    console.error(`Failed to fetch iframe content: ${url} – ${err.message}`);
    return null;
  }
}

/**
 * Replace all html-block-iframe tags in the HTML source with their fetched content.
 * Unreachable iframes are replaced with a placeholder comment.
 */
async function resolveHtmlBlockIframes(html) {
  const srcs = extractHtmlBlockIframes(html);
  if (srcs.length === 0) return html;

  const fetches = srcs.map(src => fetchIframeContent(src).then(content => ({ src, content })));
  const results = await Promise.all(fetches);

  let resolved = html;
  for (const { src, content } of results) {
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `<iframe\\s(?=[^>]*class="html-block-iframe")[^>]*\\bsrc="${escaped}"[^>]*>\\s*<\\/iframe>`,
      'gi'
    );
    if (content) {
      resolved = resolved.replace(re, () => `<div class="html-block-content">${content}</div>`);
    } else {
      resolved = resolved.replace(re, '<!-- html-block-iframe: content unavailable -->');
    }
  }
  return resolved;
}

/**
 * getPageContent – return the full source of a page.
 * For HTML pages with html-block-iframe tags, fetch and inline the iframe content.
 * For wikitext pages, returns source as-is ([[html]] blocks are inline).
 */
export async function getPageContent(name) {
  const row = wikidotDb.prepare(
    'SELECT name, source, source_form FROM pages WHERE name = ?'
  ).get(name);

  if (!row) return null;

  if (row.source_form === 'html' && row.source.includes('html-block-iframe')) {
    const resolved = await resolveHtmlBlockIframes(row.source);
    return {
      name: row.name,
      source_form: row.source_form,
      source: resolved,
    };
  }

  return {
    name: row.name,
    source_form: row.source_form,
    source: row.source,
  };
}
