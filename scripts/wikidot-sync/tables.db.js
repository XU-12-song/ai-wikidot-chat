import db from "./pool.db.js";

export async function initDb() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    name TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    upvote INT,
    downvote INT,
    author TEXT NOT NULL,
    source TEXT NOT NULL,
    tags TEXT,
    source_form TEXT,
    created_at TEXT,
    parent_name TEXT
  )
`);
}