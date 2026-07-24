import { error, log, warn } from "node:console";
import db from "./pool.db.js";
import pino from "pino";

const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: { colorize: true }
    },
    level: 'debug'
});

export function findPageDataByName(name) {
    const rows = db.prepare('select * from pages where name = ?').all(name);
    return rows[0];
}

export function insertSelectedPageData(selectedPageData) {
    const { name, title, downvote, upvote, author, source, tags, createdAt, parentName } = selectedPageData;

    const stmt = db.prepare(`
        INSERT INTO pages ( name, title, downvote, upvote, author, source, tags, source_form, created_at,parent_name ) VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    stmt.run(
        name,
        title,
        downvote,
        upvote,
        JSON.stringify(author),
        source.data,
        JSON.stringify(tags),
        source.form,
        createdAt.toISOString(),
        parentName
    );
    return true;
}

export function searchPageData(pattern) {
    const term = `%${pattern}%`;
    const sql = `
        SELECT
         *
        FROM pages
        WHERE 
            name LIKE ? 
            OR source LIKE ? 
            OR tags LIKE ?
            OR title LIKE ?
            OR JSON_UNQUOTE(JSON_EXTRACT(author, '$.name')) LIKE ?
        ORDER BY 
            CASE 
                WHEN title LIKE ? THEN 0
                WHEN source LIKE ? THEN 1
                WHEN tags LIKE ? THEN 2
                WHEN name LIKE ? THEN 3
                ELSE 4
            END,
            created_at DESC
        LIMIT 20`;
    const stmt = db.prepare(sql)
    const rows = stmt.all(term, term, term, term, term, term, term, term, term);
    return rows;
}

export function updateParentNameToDb(page) {
    const { fullname: name, parentFullname: parentName } = page;
    if (findPageDataByName(name)) {
        db.prepare('UPDATE pages set parent_name = ? where name = ?').run(parentName, name);
        logger.info(`Updated parent name of page ${name} into ${parentName}`);
        return true;
    }
    else {
        logger.info(`Can not find existed page ${name}`);
        return false;
    }
}

export function closeDatabase() {
    db.close();
    return;
}