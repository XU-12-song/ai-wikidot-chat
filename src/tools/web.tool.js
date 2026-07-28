import axios from 'axios';
import * as cheerio from 'cheerio';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * fetchBingSearchResults – internal helper for Bing search.
 */
async function fetchBingSearchResults(query) {
  const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}`;
  const { data } = await axios.get(url, {
    timeout: 8000,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  });
  const $ = cheerio.load(data);
  const results = [];

  // Bing results are in .b_algo elements
  $('.b_algo').each((i, el) => {
    const h2a = $(el).find('h2 a');
    const title = h2a.text().trim();
    const link = h2a.attr('href');
    // snippet is usually in .b_caption p or the element following h2
    const snippet = $(el).find('.b_caption p').first().text().trim()
      || $(el).find('.b_lineclamp2').first().text().trim();
    if (title && link) {
      results.push({ title, url: link, snippet });
    }
  });

  // Fallback: try .b_title + adjacent caption
  if (results.length === 0) {
    $('.b_title a').each((i, el) => {
      const title = $(el).text().trim();
      const link = $(el).attr('href');
      const snippet = $(el).closest('li').find('.b_snippet, .b_caption p').first().text().trim();
      if (title && link) {
        results.push({ title, url: link, snippet });
      }
    });
  }

  return results.slice(0, 10);
}

/**
 * webSearch – search the web via Bing. Returns up to 10 results.
 */
export async function webSearch(query) {
  try {
    return await fetchBingSearchResults(query);
  } catch (error) {
    console.error('webSearch failed:', error.message);
    return [];
  }
}

/**
 * extractText – strip HTML down to plain text using cheerio.
 */
function extractText(html) {
  const $ = cheerio.load(html);
  // Remove non-content elements
  $('script, style, noscript, nav, footer, header, iframe, svg, img, button, input').remove();
  const text = $('body').text() || $.text();
  // Collapse whitespace
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * webFetch – fetch an arbitrary URL and return extracted text content.
 */
export async function webFetch(url) {
  try {
    const { data, headers } = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 5,
      headers: { 'User-Agent': USER_AGENT },
      responseType: 'text',
    });
    const contentType = headers['content-type'] || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      // Not HTML – return raw text if short, otherwise truncate
      const text = typeof data === 'string' ? data : JSON.stringify(data);
      return {
        url,
        content_type: contentType,
        text: text.slice(0, 10000),
      };
    }
    return {
      url,
      content_type: contentType,
      text: extractText(data),
    };
  } catch (error) {
    console.error('webFetch failed:', error.message);
    return { url, error: error.message };
  }
}


export const WEB_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'webSearch',
      description: '使用搜索引擎搜索外部网络信息（SCP 相关的讨论帖、解读文章、二创等）。仅在维基数据库信息不足时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索查询词' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'webFetch',
      description: '抓取指定 URL 的网页内容，提取纯文本。用于获取 webSearch 结果中某个链接的详细内容。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的网页 URL' },
        },
        required: ['url'],
      },
    },
  },
];