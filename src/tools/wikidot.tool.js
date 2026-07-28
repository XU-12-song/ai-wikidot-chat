import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageSummary, buildOrderClause } from './utils.js';
import db from '../pool.js';

/**
 * searchPages – structured column-level search for SCP-CN wiki pages.
 *
 * All parameters are optional. At least one filter should be provided.
 *
 * @param {Object} options
 * @param {string}  [options.name]       – LIKE match on page fullname
 * @param {string}  [options.title]      – LIKE match on title
 * @param {string}  [options.content]    – LIKE match on source (body text / wikitext / HTML)
 * @param {string}  [options.author]     – LIKE match on author JSON (e.g. author.name)
 * @param {string[]}[options.tags]       – ALL tags must be present (AND logic, each as LIKE match)
 * @param {string}  [options.parent]     – exact match on parent_name
 * @param {string}  [options.sourceForm] – exact match on source_form ('wikitext' or 'html')
 * @param {string}  [options.pattern]    – legacy broad search across name/title/tags/source/author
 * @param {string}  [options.sort]       – sort column: name, title, created_at, upvote, downvote
 * @param {string}  [options.order]      – sort direction: 'asc' or 'desc' (default 'desc')
 * @param {number}  [options.limit]      – max results (default 20)
 * @returns {Object[]} page summary objects (no full source)
 */
export function searchPages(options = {}) {
  const conditions = [];
  const params = [];

  // name filter
  if (options.name) {
    conditions.push('name LIKE ?' + (params.length + 1));
    params.push('%' + options.name + '%');
  }

  // title filter
  if (options.title) {
    conditions.push('title LIKE ?' + (params.length + 1));
    params.push('%' + options.title + '%');
  }

  // content (source body) filter
  if (options.content) {
    conditions.push('source LIKE ?' + (params.length + 1));
    params.push('%' + options.content + '%');
  }

  // author filter
  if (options.author) {
    conditions.push('author LIKE ?' + (params.length + 1));
    params.push('%' + options.author + '%');
  }

  // tags filter: ALL specified tags must be present
  if (options.tags && options.tags.length > 0) {
    for (const tag of options.tags) {
      conditions.push('tags LIKE ?' + (params.length + 1));
      params.push('%' + tag + '%');
    }
  }

  // parent_name exact match
  if (options.parent) {
    conditions.push('parent_name = ?' + (params.length + 1));
    params.push(options.parent);
  }

  // source_form exact match
  if (options.sourceForm) {
    conditions.push('source_form = ?' + (params.length + 1));
    params.push(options.sourceForm);
  }

  // legacy broad pattern search (OR across multiple columns)
  if (options.pattern) {
    const term = '%' + options.pattern + '%';
    const n = params.length;
    conditions.push(
      '(name LIKE ?' + (n + 1) +
      ' OR title LIKE ?' + (n + 2) +
      ' OR tags LIKE ?' + (n + 3) +
      ' OR source LIKE ?' + (n + 4) +
      ' OR author LIKE ?' + (n + 5) + ')'
    );
    params.push(term, term, term, term, term);
  }

  // safety: no filters = match nothing (still safe, but unlikely to be useful)
  if (conditions.length === 0) {
    conditions.push('1=1');
  }

  const whereClause = conditions.join(' AND ');

  // sort
  let orderClause;
  if (options.sort) {
    orderClause = buildOrderClause(options.sort, options.order === 'asc');
  } else {
    orderClause = 'created_at DESC';
  }

  const limit = parseInt(options.limit) || 20;

  const sql = `
    SELECT name, title, upvote, downvote, rating, author, tags, source_form, created_at, parent_name
    FROM pages
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ${limit}
  `;

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);
  return rows.map(pageSummary);
}

/**
 * getChildPages – return child pages for a given parent, with optional ordering.
 * order: 'name' (default), 'created_at', 'upvote', etc.
 * limit: max results (default no limit).
 */
export function getChildPages(parentName, order = 'name', limit = -1) {
  const orderClause = buildOrderClause(order, order === 'name');
  let sql = `
    SELECT name, title, upvote, downvote, rating, author, tags, source_form, created_at, parent_name
    FROM pages
    WHERE parent_name = ?1
    ORDER BY ${orderClause}
  `;
  if (limit > 0) sql += ' LIMIT ?2';
  const stmt = db.prepare(sql);
  const rows = limit > 0 ? stmt.all(parentName, limit) : stmt.all(parentName);
  return rows.map(pageSummary);
}

/**
 * getPageContent – 返回页面的原始 source。
 */
export async function getPageContent(name, MAX_SOURCE_LEN) {
  const row = db.prepare(
    'SELECT name, source, source_form FROM pages WHERE name = ?'
  ).get(name);

  if (!row) return null;


  if (row.source && row.source.length > MAX_SOURCE_LEN) {
    row.source = row.source.slice(0, MAX_SOURCE_LEN)
      + `\n\n[... 内容已截断，原长度 ${row.source.length} 字符。如需完整内容请使用 getChildPages 获取子页面 ...]`;
  }
  return {
    name: row.name,
    source_form: row.source_form,
    source: row.source,
  };
}

export const WIKIDOT_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'searchPages',
      description:
        'Structured search of SCP-CN wiki pages. ' +
        'All column filters are optional AND combined. ' +
        'At least one filter should be provided. ' +
        'Returns up to N page summaries (name, title, upvote, downvote, rating, author, tags, source_form, created_at, parent_name) without full source.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'LIKE match on page fullname, e.g. "4725"' },
          title: { type: 'string', description: 'LIKE match on page title, e.g. "SCP-CN"' },
          content: { type: 'string', description: 'LIKE match on page source body (wikitext / HTML)' },
          author: { type: 'string', description: 'LIKE match on author JSON, e.g. "Dr. Gears"' },
          tags: { type: 'array', items: { type: 'string' }, description: 'ALL these tags must be present (AND logic), e.g. ["scp","keter"]' },
          parent: { type: 'string', description: 'Exact match on parent_name, e.g. "scp-cn-4725"' },
          sourceForm: { type: 'string', enum: ['wikitext', 'html'], description: 'Exact match on source format (wikitext or html)' },
          pattern: { type: 'string', description: 'Legacy broad search across name, title, tags, source, author (OR logic). Use when you have a general keyword. Can be combined with other filters.' },
          sort: { type: 'string', enum: ['name', 'title', 'created_at', 'upvote', 'downvote', 'rating'], description: 'Sort column. Default: created_at' },
          order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction. Default: desc' },
          limit: { type: 'integer', description: 'Max results. Default: 20. Max: 50' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPageContent',
      description: '获取 SCP-CN 维基指定页面的完整源内容（HTML 或 wikitext）。html-block-iframe 会被自动处理。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '页面 fullname，如 "scp-cn-4725"、"experiment-log-914-cn"、"fragment:scp-cn-4345-1"' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getChildPages',
      description: '获取某个页面的所有子页面列表。用于迭代页（实验记录）、故事系列等多页内容场景。',
      parameters: {
        type: 'object',
        properties: {
          parentName: { type: 'string', description: '父页面 fullname' },
          order: { type: 'string', enum: ['name', 'created_at', 'upvote', 'rating'], description: '排序字段：name=名称字典序（默认）、created_at=创建时间、upvote=好评数、rating=总评分（upvote-downvote）' },
          limit: { type: 'integer', description: '返回数量上限，不设则返回全部' },
        },
        required: ['parentName'],
      },
    },
  },
];