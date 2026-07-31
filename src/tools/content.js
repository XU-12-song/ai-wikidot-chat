import db from "../pool.js";

export function getSnippets(id, options = { pageSize: 10, pageIndex: 1 }) {
    // 解构参数，设置默认值
    const { pageSize = 10, pageIndex = 1 } = options;
    // 计算 OFFSET（pageIndex 从 1 开始）
    const offset = (pageIndex - 1) * pageSize;

    const rows = db.prepare(`
        SELECT id, role, content
        FROM messages
        WHERE conversation_id = ?
        ORDER BY id ASC   -- 确保分页稳定
        LIMIT ? OFFSET ?
    `).all(id, pageSize, offset);

    // 生成 snippet（截取前30字符）
    const msgs = rows.map((item) => {
        const snippet = item.content.length > 30
            ? item.content.slice(0, 30)
            : item.content;
        return {
            id: item.id,
            role: item.role,
            snippet: snippet
        };
    });

    const totalRow = db.prepare(`
        SELECT COUNT(*) as total
        FROM messages
        WHERE conversation_id = ?
    `).get(id);
    const total = totalRow ? totalRow.total : 0;

    return {
        data: msgs,
        pagination: {
            pageIndex,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize)
        }
    };
}

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

// getSnippets 的函数定义
export const GET_SNIPPETS_DEFINITION = {
    type: 'function',
    function: {
        name: 'getSnippets',
        description: '获取指定对话（conversation）的消息片段列表，支持分页。每条消息仅返回前 30 个字符的摘要，不包含完整内容。',
        parameters: {
            type: 'object',
            properties: {
                id: {
                    type: 'integer',
                    description: '对话（conversation）的唯一标识 ID。'
                },
                pageSize: {
                    type: 'integer',
                    description: '每页返回的记录数，默认值为 10。',
                    default: 10
                },
                pageIndex: {
                    type: 'integer',
                    description: '页码，从 1 开始，默认值为 1。',
                    default: 1
                }
            },
            required: ['id']
        }
    }
};

// getContent 的函数定义
export const GET_CONTENT_DEFINITION = {
    type: 'function',
    function: {
        name: 'getContent',
        description: '根据消息 ID 获取单条消息的完整内容及其角色（role）。',
        parameters: {
            type: 'object',
            properties: {
                id: {
                    type: 'integer',
                    description: '消息的唯一标识 ID。'
                }
            },
            required: ['id']
        }
    }
};