import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './pool.js';


export function init() {

  db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT DEFAULT 'New Chat',
    model TEXT DEFAULT 'deepseek-v4-pro',
    temperature REAL DEFAULT 0.7,
    max_tokens INTEGER DEFAULT 4096,
    top_p REAL DEFAULT 1.0,
    system_prompt TEXT DEFAULT 'You are a helpful assistant.',
    reasoning_effort TEXT DEFAULT 'high',
    active_branch_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);
  try { db.exec(`ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT DEFAULT 'high'`); } catch { }

  db.exec(`
  CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    parent_branch_id INTEGER,
    name TEXT DEFAULT 'main',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_branch_id) REFERENCES branches(id) ON DELETE SET NULL
  )
`);

  db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
  )
`);

  db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    start_from INTEGER NOT NULL,
    length INTEGER NOT NULL,
    note TEXT NOT NULL,
    content TEXT,
    reasoning_content TEXT DEFAULT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
  )
`)

  try { db.exec(`ALTER TABLE messages ADD COLUMN reasoning_content TEXT DEFAULT NULL`); } catch { }
  try { db.exec(`ALTER TABLE messages ADD COLUMN tool_calls TEXT DEFAULT NULL`); } catch { }
}