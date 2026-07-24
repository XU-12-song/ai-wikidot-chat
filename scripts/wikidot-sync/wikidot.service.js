import { Client } from "@ukwhatn/wikidot";
import axios from "axios";
import * as cheerio from 'cheerio';
import pino from "pino"; import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../..', '.env') });

const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: { colorize: true }
    },
    level: 'debug'
});

let cachedSite = null;
let cachedSiteName = null;
let lockCount = 0;

export async function getWikidotSite(siteName, options) {
    if ((!cachedSite) && siteName != cachedSiteName) {
        if (lockCount == 1) throw new Error("Error: unable to get the wikidot site beacause the site getting is going and no cached site can be reused");
        lockCount = 1;
        // init client
        const clientResult = await Client.create(options);
        if (!clientResult.isOk()) {
            const err = clientResult.unwrapErr();
            logger.error('Failed to create the client', err);
            throw err;
        }
        const client = clientResult.value;

        // init site
        const siteResult = await client.site.get(siteName || 'pin-wiki');
        if (!siteResult.isOk()) {
            logger.error('Failed to connect to the site');
            throw new Error('Failed to connerct to the site');
        }
        const site = siteResult.value
        cachedSite = site;
        cachedSiteName = siteName;
        lockCount = 0;
        return site;
    }
    else { return cachedSite; }

}

export async function getPageList(site) {
    if (!site && !cachedSite) throw new Error("No site can be used");
    const pagesAccessor = site?.pages || cachedSite.pages;
    const pageResults = await pagesAccessor.all();
    if (!pageResults.isOk()) {
        const err = pageResults.unwrapErr();
        logger.error('Failed to fetch page list', err);
        throw err;
    }
    return pageResults.value;
}

class pageSource {
    constructor(form, source) {
        this.form = form;
        this.data = source;
    }
}

async function getPageSourceByFetch(name) {
    try {
        const { data: rawSource } = await axios.get(`https://${process.env.SITE_NAME || 'scp-wiki-cn'}.wikidot.com/${name}`);
        const $ = cheerio.load(rawSource);
        return $('#page-content').html();
    } catch (e) {
        throw e;
    }
}

export async function getPageSource(page) {
    const { fullname: name } = page;
    if (name.startsWith('scp-cn-')) {
        const source = await getPageSourceByFetch(name);
        return new pageSource('html', source);
    }
    else {
        const sourceResult = await page.getSource();
        if (!sourceResult.isOk()) {
            logger.error('Can not get page source,try to get page source by axios');
            const source = await getPageSourceByFetch(page.name);
            return new pageSource('html', source);
        }
        const source = sourceResult.value.wikiText;
        return new pageSource('wikitext', source);
    }
}

export async function sendMessage(username, value, client) {
    if (!client && !cachedSite) throw new Error("No client can be used");
    client = client || cachedSite.client;
    const msgSender = client.privateMessage;
    const userResult = await client.user.get(username, { raiseWhenNotFound: true })
    if (!userResult.isOk()) {
        logger.error('Failed to fetch user\'s data,check weather user name exists please.')
        throw new Error("获取用户失败，请检查是否为存在用户名");
    };
    const user = userResult.value;
    logger.debug(user);
    msgSender.send(user, 'Robot\'s Message', value || 'no content');
}

export async function getMessageInbox(client) {
    if (!client && !cachedSite) throw new Error("No client can be used");
    client = client || cachedSite.client;
    const messageListResult = await client.privateMessage.inbox()
    if (!messageListResult.isOk()) {
        logger.error('Failed to get message in box')
        throw new Error("获取收件箱失败");
    }
    return messageListResult.value;
}

export async function getMessageSent(client) {
    if (!client && !cachedSite) throw new Error("No client can be used");
    client = client || cachedSite.client;
    const messageListResult = await client.privateMessage.sentBox()
    if (!messageListResult.isOk()) {
        logger.error('Failed to get message sent');
        throw new Error("获取发送消息失败");
    }
    return messageListResult.value;
}

export class SelectedPage {
    constructor(page, source) {
        this.name = page.fullname;
        this.title = page.title;
        this.upvote = (page.votesCount + page.rating) / 2;
        this.downvote = page.votesCount - this.upvote;
        // votesCount == upvote + downvote
        // rating == upvote - downvote
        // so it is so.
        this.author = page.createdBy
            ? { name: page.createdBy.name, id: page.createdBy.id, unix_name: page.createdBy.unixName }
            : { name: 'Unknown', id: null, unix_name: null };
        this.source = source;
        this.tags = page.tags;
        this.createdAt = page.createdAt;
        this.parentName = page.parentFullname;
        this.rating = page.rating;
    }
}

export async function selectPageData(page) {
    const source = await getPageSource(page);
    return new SelectedPage(page, source);
}

