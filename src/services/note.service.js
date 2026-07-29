import db from "../pool.js";

export async function get(id) {
    return db.prepare(`
            SELECT *
            FROM notes n
            WHERE n.id = ?
    `).get(id);
}

export async function insert(message_id, length, start_from, note, content, reasoning_content, form = 'note') {
    const insert = db.prepare(`INSERT INTO notes (message_id,length,start_from,note,content,reasoning_content,form) VALUES (?,?,?,?,?,?,?)`)
        .run(
            message_id,
            length,
            start_from,
            note,
            content,
            reasoning_content || null,
            form
        );
    const noteId = Number(insert.lastInsertRowid);
    return get(noteId);
}

export async function update(id, content, reasoning_content) {
    db.prepare('UPDATE notes SET content = ?, reasoning_content = ? WHERE id = ?')
        .run(content, reasoning_content || null, id);
    return get(id);
}