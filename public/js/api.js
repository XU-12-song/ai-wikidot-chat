// API 请求封装，基础路径可根据后端调整
const BASE = '/api';

async function api(url, opts = {}) {
    const res = await fetch(BASE + url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}