// Shared utility functions for SCP-CN wiki tools

/**
 * Safely parse author JSON. Returns a normalized object with default fields.
 * Handles NULL, invalid JSON, and missing fields gracefully.
 */
export function parseAuthor(raw) {
  try {
    if (!raw) return { name: 'Unknown', id: null, unix_name: null };
    const obj = JSON.parse(raw);
    return {
      name: obj.name || 'Unknown',
      id: obj.id || null,
      unix_name: obj.unix_name || null,
    };
  } catch {
    return { name: String(raw), id: null, unix_name: null };
  }
}

/**
 * Safely parse tags JSON. Returns a plain array.
 */
export function parseTags(raw) {
  try {
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Return a succinct summary of a page (no full source).
 */
export function pageSummary(row) {
  return {
    name: row.name,
    title: row.title,
    upvote: row.upvote,
    downvote: row.downvote,
    rating: row.rating ?? (row.upvote - row.downvote),
    author: parseAuthor(row.author),
    tags: parseTags(row.tags),
    source_form: row.source_form,
    created_at: row.created_at,
    parent_name: row.parent_name,
  };
}

/**
 * Build ORDER BY clause from a safe column name. Only allows known columns.
 * Returns 'name ASC' by default.
 */
export function buildOrderClause(order, asc) {
  const allowed = new Set(['name', 'title', 'created_at', 'upvote', 'downvote', 'rating', 'parent_name']);
  const col = allowed.has(order) ? order : 'name';
  const dir = asc ? 'ASC' : 'DESC';
  return `${col} ${dir}`;
}
