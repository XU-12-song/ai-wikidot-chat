import pLimit from 'p-limit';

import { getWikidotSite, getPageSource, selectPageData, getPageList } from "./wikidot.service.js";
import { insertSelectedPageData, findPageDataByName, closeDatabase } from "./db-operator.db.js";
import { initDb } from "./tables.db.js";
import { waitIfPaused } from './utils.js';
import pino from "pino";

const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: { colorize: true }
    },
    level: 'debug'
});


export async function scheduler(options) {
    const limit = pLimit(8); // 最多同时运行 8 个异步任务
    const { SITE_NAME } = options;
    initDb();
    let site = null;

    site = await getWikidotSite(SITE_NAME);

    const pages = await getPageList(site);
    const total = pages.length;
    let savedCount = 0;


    const filtedPages = pages.filter((page, index) => {
        const isExisted = findPageDataByName(page.fullname);
        const percentage = ((index / total) * 100).toFixed(1);
        logger.info(`Filter page never saved,it's ${page.fullname},(${index}/${total}) ${percentage}%`);
        return !isExisted;
    })

    const filtedPagesLength = filtedPages.length;

    const mission = async (page) => {
        await waitIfPaused();
        let success = false;
        for (let attempt = 0; attempt < 2 && !success; attempt++) {
            try {
                const selectedPageData = await selectPageData(page);
                const inserted = insertSelectedPageData(selectedPageData);
                if (inserted) {
                    savedCount++;
                    const percentage = ((savedCount / filtedPagesLength) * 100).toFixed(1);
                    logger.info(`Saved ${selectedPageData.name} (${savedCount}/${filtedPagesLength}) ${percentage}%`);
                }
                success = true;
            } catch (e) {
                console.log(`Attempt ${attempt + 1} for page ${page.fullname} failed`, e);
            }
        }
    }

    const tasks = filtedPages.map(page =>
        limit(() => mission(page))
    );
    try {
        await Promise.all(tasks);
    }
    finally {
        closeDatabase();
    }

}