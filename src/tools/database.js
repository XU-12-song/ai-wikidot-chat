import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageSummary, buildOrderClause } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wikidotDb = new DatabaseSync(path.join(__dirname, '..', '..', 'wikidot.db'));
wikidotDb.exec('PRAGMA journal_mode = WAL');

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

  const stmt = wikidotDb.prepare(sql);
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
  const stmt = wikidotDb.prepare(sql);
  const rows = limit > 0 ? stmt.all(parentName, limit) : stmt.all(parentName);
  return rows.map(pageSummary);
}
