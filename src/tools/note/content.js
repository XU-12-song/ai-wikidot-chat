import db from "../../pool.js";

export function getContent(id) {

    const row = db.prepare(`
        SELECT m.content,m.role
        FROM messages m
        WHERE m.id = ?
    `).get(id);

    if (!row) {
        return null;
    }

    return {
        content: row.content,
        role: row.role
    };
}