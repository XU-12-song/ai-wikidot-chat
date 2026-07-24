/**
 * resolve-iframes.js
 *
 * Batch-fetch and inline html-block-iframe content for all HTML pages in wikidot.db.
 *
 * Usage:
 *   node scripts/resolve-iframes.js [--concurrency 3] [--delay 1000] [--timeout 30000] [--retry 2] [--dry-run]
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import pLimit from 'p-limit';
import pino from 'pino';

// ── Logger ────────────────────────────────────────────────────────────────────────

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: { colorize: true }
  },
  level: 'debug'
});

// ── Config ────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../..', 'wikidot.db');
const SCP_BASE = 'https://scp-wiki-cn.wikidot.com';
const IFRAME_RE = /<iframe\s(?=[^>]*class="html-block-iframe")[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/iframe>/gi;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── CLI Args ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { concurrency: 30, delay: 1000, timeout: 60000, retry: 1, dryRun: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--concurrency': opts.concurrency = parseInt(args[++i], 10); break;
      case '--delay': opts.delay = parseInt(args[++i], 10); break;
      case '--timeout': opts.timeout = parseInt(args[++i], 10); break;
      case '--retry': opts.retry = parseInt(args[++i], 10); break;
      case '--dry-run': opts.dryRun = true; break;
    }
  }
  return opts;
}

// ── Helpers ───────────────────────────────────────────────────────────────────────

function percent(n, total) {
  return ((n / total) * 100).toFixed(1) + '%';
}

function bar(n, total) {
  const w = 20;
  const filled = Math.round((n / total) * w);
  return '[' + '#'.repeat(filled) + '.'.repeat(w - filled) + ']';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractIframeSrcs(html) {
  const srcs = [];
  const re = new RegExp(IFRAME_RE.source, 'gi');
  let m;
  while ((m = re.exec(html)) !== null) srcs.push(m[1]);
  return srcs;
}

/** Detect if a page fullname has a non-default category (contains ':') */
function hasCategory(name) {
  return name && name.includes(':');
}

/**
 * Build a list of candidate URLs for an iframe src.
 *
 * SCP wikidot iframe src format: /<page-fullname>/html/<hash>
 *
 * If the current page has a non-default category (e.g. "fragment:scp-cn-4725-1"),
 * the actual HTML content may be served under the parent page instead.
 * So we produce candidates in priority order:
 *   1. Original src as-is
 *   2. (if non-default + has parent) parent_name as the page prefix
 */
function buildCandidateUrls(src, pageName, parentName) {
  const candidates = [];

  // Candidate 1: src as-is
  candidates.push(src.startsWith('http') ? src : `${SCP_BASE}${src}`);

  // Candidate 2: swap page prefix to parent_name (for non-default categories)
  if (hasCategory(pageName) && parentName) {
    // Parse /pageName/html/hash -> replace pageName with parentName
    const parts = src.match(/^\/(.+?)\/html\/(.+)$/);
    if (parts) {
      const altSrc = `/${parentName}/html/${parts[2]}`;
      const altUrl = `${SCP_BASE}${altSrc}`;
      if (altUrl !== candidates[0]) {
        candidates.push(altUrl);
      }
    }
  }

  return candidates;
}

// ── Fetch with retry (supports fallback URL list) ─────────────────────────────────

async function fetchOne(url, timeout) {
  const { data } = await axios.get(url, {
    timeout,
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    maxRedirects: 5,
    validateStatus: s => s < 400,
  });
  return data;
}

async function fetchWithFallbacks(candidates, timeout, retries) {
  for (const url of candidates) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const data = await fetchOne(url, timeout);
        return { url, data };
      } catch (err) {
        const code = err.code || 'UNKNOWN';
        const status = err.response?.status;
        const msg = `${code}${status ? ' HTTP ' + status : ''}`;
        if (attempt < retries) {
          logger.warn(`  retry ${attempt}/${retries}: ${msg} -- ${url}`);
          await sleep(Math.min(2000 * attempt, 8000));
        } else {
          logger.warn(`  failed after ${retries} retries: ${msg} -- ${url}`);
        }
      }
    }
  }
  return null;
}

// ── Resolve a single page ─────────────────────────────────────────────────────────

async function resolvePage(row, db, opts) {
  const srcs = extractIframeSrcs(row.source);
  if (srcs.length === 0) return { name: row.name, replaced: 0, failed: 0 };

  let resolved = row.source;
  let replaced = 0;
  let failed = 0;

  for (const src of srcs) {
    const candidates = buildCandidateUrls(src, row.name, row.parent_name);
    const result = await fetchWithFallbacks(candidates, opts.timeout, opts.retry);

    // Replace the iframe tag in HTML source
    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `<iframe\\s(?=[^>]*class="html-block-iframe")[^>]*\\bsrc="${escaped}"[^>]*>\\s*<\\/iframe>`,
      'gi'
    );

    if (result) {
      resolved = resolved.replace(re, () => `<div class="html-block-content">${result.data}</div>`);
      replaced++;
    } else {
      const urlsTried = candidates.join(', ');
      resolved = resolved.replace(re, `<!-- html-block-iframe: fetch failed (tried: ${urlsTried}) -->`);
      failed++;
    }

    if (opts.delay > 0) await sleep(opts.delay);
  }

  db.prepare('UPDATE pages SET source = ? WHERE name = ?').run(resolved, row.name);
  return { name: row.name, replaced, failed };
}

// ── Main ──────────────────────────────────────────────────────────────────────────

export async function main() {
  const opts = parseArgs();

  logger.info('--- iframe resolver ---');
  logger.info(`  DB:          ${DB_PATH}`);
  logger.info(`  Concurrency: ${opts.concurrency}  Delay: ${opts.delay}ms  Timeout: ${opts.timeout}ms  Retry: ${opts.retry}`);
  if (opts.dryRun) logger.info('  *** DRY RUN -- will not modify database ***');

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');

  const rows = db.prepare(`
    SELECT name, parent_name, source, source_form FROM pages
    WHERE source_form = 'html'
      AND source LIKE '%html-block-iframe%'
      AND source NOT LIKE '%html-block-content%'
    ORDER BY name ASC
  `).all();

  const total = rows.length;
  const totalIframes = rows.reduce((sum, r) => sum + extractIframeSrcs(r.source).length, 0);

  logger.info({ rows: total, iframes: totalIframes }, `pages to process: ${total}, total iframes: ${totalIframes}`);

  if (total === 0) {
    logger.info('nothing to do -- all pages already resolved');
    db.close();
    return;
  }

  if (opts.dryRun) {
    for (const r of rows) {
      const srcs = extractIframeSrcs(r.source);
      logger.info(`${r.name} -- ${srcs.length} iframe(s)${hasCategory(r.name) ? ' [category: ' + r.name.split(':')[0] + ']' : ''}${r.parent_name ? ' [parent: ' + r.parent_name + ']' : ''}`);
      for (const s of srcs) {
        const candidates = buildCandidateUrls(s, r.name, r.parent_name);
        logger.info(`  -> ${candidates.length > 1 ? candidates.join('\n     => ') : candidates[0]}`);
      }
    }
    logger.info(`${total} pages would be processed (dry-run)`);
    db.close();
    return;
  }

  // ── Process with p-limit ────────────────────────────────────────────────────────

  const limit = pLimit(opts.concurrency);
  let done = 0;
  let totalReplaced = 0;
  let totalFailed = 0;
  const start = Date.now();

  const tasks = rows.map(row =>
    limit(async () => {
      const result = await resolvePage(row, db, opts);
      done++;
      totalReplaced += result.replaced;
      totalFailed += result.failed;
      const pct = percent(done, total);
      const pb = bar(done, total);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1) + 's';
      const status = result.failed > 0 ? 'FAIL' : 'OK';
      logger.info(`${status} ${pb} ${done}/${total} ${pct} | ${result.name} | +${result.replaced} -${result.failed} | ${elapsed}`);
    })
  );

  await Promise.all(tasks);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  logger.info({ pages: done, replaced: totalReplaced, failed: totalFailed, elapsed: elapsed + 's' },
    `done -- ${done} pages, ${totalReplaced} iframes replaced, ${totalFailed} failed in ${elapsed}s`);

  db.close();
}