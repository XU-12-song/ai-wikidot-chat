import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wikidotDb = new DatabaseSync(path.join(__dirname, '..', 'wikidot.db'));

wikidotDb.exec('PRAGMA journal_mode = WAL');
wikidotDb.exec('PRAGMA foreign_keys = ON');

export default wikidotDb;
