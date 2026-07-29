// 应用主逻辑：状态管理、UI渲染、事件绑定、流式对话处理

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// 全局状态
let S = {
    convs: [],
    cid: null,
    bid: null,
    branches: [],
    msgs: [],
    streaming: false,
    editing: null,
    streamAbort: null
};

// ── 初始化 ──
(async function init() {
    try {
        S.convs = await api('/conversations');
        renderConvs();
        if (S.convs.length === 0) await newConv();
        else await openConv(S.convs[0].id);
    } catch (e) {
        console.error('Init error:', e);
        toast('Failed to load conversations');
    }
    bindEvents();
})();
const ranges = document.querySelectorAll('input[type=range]');
function updateProgress() {
    const percent = (this.value - this.min) / (this.max - this.min) * 100;
    this.style.setProperty('--range-progress', percent + '%');
}
ranges.forEach(function (item) {
    item.addEventListener('input', updateProgress);
    updateProgress.call(item);
});
// 初始化一次

function bindEvents() {
    $('#newChatBtn').addEventListener('click', newConv);
    $('#forkBtn').addEventListener('click', forkBranch);
    $('#sendBtn').addEventListener('click', send);
    $('#applySettingsBtn').addEventListener('click', applySettings);
    $('#regenBtn').addEventListener('click', regenerate);
    $('#userInput').addEventListener('keydown', onKey);
    $('#userInput').addEventListener('input', autoResize);
    $('#sTemp').addEventListener('input', (e) => $('#tLabel').textContent = e.target.value);
    $('#sTopP').addEventListener('input', (e) => $('#pLabel').textContent = e.target.value);
    $('#themeBox').addEventListener('click', turnTheme);
    $('#msgContainer').addEventListener('contextmenu', onContextMenu);

    // context menu registration
    ctxMenu.register('selection', [
        { label: '添加笔记', action: addNoteFromSelection }
    ]);
    ctxMenu.register('default', [
        { label: 'Copy', action: () => document.execCommand('copy') }
    ]);
}

function autoResize(e) {
    const t = e.target;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 180) + 'px';
}

// ── Context menu + notes ──

function onContextMenu(e) {
    e.preventDefault();
    const bubble = getSelectionBubble();
    if (bubble) {
        const msgWrap = bubble.closest('.msg-wrap');
        const msgId = msgWrap ? Number(msgWrap.id.replace('r-', '')) : null;
        const msg = S.msgs.find(m => m.id === msgId);
        if (msg && msg.role !== 'system') {
            const note = getSelectionNote(bubble, msg.content);
            if (note) {
                ctxMenu.show(e.clientX, e.clientY, 'selection', { msg, note });
                return;
            }
        }
    }
    ctxMenu.show(e.clientX, e.clientY, 'default', {});
}

async function addNoteFromSelection(data) {
    const { msg, note } = data;
    await showNoteCard(msg, note.start_from, note.length, note.note);
    await reloadMsgs();
    renderMsgs();
}

function setEditTriggersDisabled(disabled) {
    document.body.classList.toggle('streaming', disabled);
}

// ── 对话列表渲染 ──
function renderConvs() {
    const l = $('#convList');
    if (S.convs.length === 0) {
        l.innerHTML = '<div class="list-empty">No conversations</div>';
        return;
    }
    l.innerHTML = S.convs.map(c => `
        <div class="conv-card${c.id === S.cid ? ' active' : ''}" data-id="${c.id}">
            <span class="title">${esc(c.title)}</span>
            <button class="close" data-action="delete">&times;</button>
        </div>
    `).join('');
    // 事件代理
    l.querySelectorAll('.conv-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('close')) return;
            openConv(Number(card.dataset.id));
        });
        card.querySelector('.close').addEventListener('click', (e) => {
            e.stopPropagation();
            delConv(Number(card.dataset.id));
        });
    });
}

async function newConv() {
    const c = await api('/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    S.convs = await api('/conversations');
    renderConvs();
    await openConv(c.id);
    toast('Created new conversation');
}

async function delConv(id) {
    if (!await showConfirm("Delete this conversation?")) return;
    await api('/conversations/' + id, { method: 'DELETE' });
    if (S.cid === id) {
        S.cid = null;
        S.msgs = [];
        S.branches = [];
        updateUI();
        renderMsgs();
    }
    S.convs = await api('/conversations');
    renderConvs();
    toast('Deleted conversation');
    if (S.convs.length > 0 && !S.cid) await openConv(S.convs[0].id);
}

async function openConv(id) {
    if (id === S.cid) return;
    S.cid = id;
    S.editing = null;
    cancelStream();
    const c = await api('/conversations/' + id);
    S.msgs = c.messages || [];
    S.bid = c.active_branch_id;
    S.msgs.forEach(m => { if (m.shared_branches) m.shared_branches.sort((a, b) => a.branch_id - b.branch_id); });
    await loadBranches();
    syncSettings(c);
    updateUI();
    renderConvs();
    renderMsgs();
}

async function reloadMsgs() {
    if (!S.cid) return;
    const c = await api('/conversations/' + S.cid);
    S.msgs = c.messages || [];
    S.msgs.forEach(m => { if (m.shared_branches) m.shared_branches.sort((a, b) => a.branch_id - b.branch_id); });
    S.bid = c.active_branch_id;
}

// ── 分支管理 ──
async function loadBranches() {
    S.branches = await api(`/conversations/${S.cid}/branches`);
    const sel = $('#branchSelect');
    sel.innerHTML = S.branches.map(b =>
        `<option value="${b.id}"${b.id === S.bid ? ' selected' : ''}>${esc(b.name)} (${b.msg_count})</option>`
    ).join('');
    const b = S.branches.find(b => b.id === S.bid);
    if (b) $('#branchBadge').textContent = b.name;
}

async function switchBranch() {
    const newBid = Number($('#branchSelect').value);
    if (newBid === S.bid) return;
    S.editing = null;
    cancelStream();
    await api(`/conversations/${S.cid}/branches/switch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: newBid })
    });
    await reloadMsgs();
    await loadBranches();
    renderMsgs();
    updateMeta();
}

async function forkBranch() {
    const name = await showPrompt('Branch name:', `fork-${Date.now()}`, { placeholder: 'Enter branch name' });
    if (!name || !name.trim()) return;
    try {
        await api(`/conversations/${S.cid}/branches`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
        });
        await reloadMsgs();
        await loadBranches();
        renderMsgs();
        updateMeta();
        toast('Forked: ' + name.trim());
    } catch (e) {
        toast('Fork failed: ' + e.message);
    }
}

// ── 消息渲染 ──
function renderMsgs() {
    const c = $('#msgContainer');
    if (!S.msgs.length) {
        c.innerHTML = '<div class="empty"><h2>DeepSeek-V4 Chat</h2><p>Send a message to start</p></div>';
        return;
    }

    c.innerHTML = S.msgs.map((m, i) => {
        const e = S.editing === m.id;
        const body = m.role === 'system' ? esc(m.content) : md(m.content);
        let branchNav = '';
        if (m.shared_branches && m.shared_branches.length >= 1) {
            const idx = m.shared_branches.findIndex(b => b.branch_id == S.bid);
            const total = m.shared_branches.length;
            const cur = idx >= 0 ? idx + 1 : 1;
            const prev = idx > 0 ? m.shared_branches[idx - 1].branch_id : null;
            const next = idx < total - 1 ? m.shared_branches[idx + 1].branch_id : null;
            branchNav = `<div class="branch-nav">
                <button class="nav-arrow" ${prev !== null ? `data-branch="${prev}"` : 'disabled'}>&lt;</button>
                <span class="nav-label">${cur}/${total}</span>
                <button class="nav-arrow" ${next !== null ? `data-branch="${next}"` : 'disabled'}>&gt;</button>
            </div>`;
        }

        let reasoningHtml = '';
        if (m.role === 'assistant' && m.reasoning_content) {
            const rId = 'reasoning-' + m.id;
            reasoningHtml = `<div class="reasoning-wrap">
                <button class="reasoning-toggle" data-reasoning="${rId}"><span class="arrow">&#9654;</span> Thinking...</button>
                <div class="reasoning-body" id="${rId}">${esc(m.reasoning_content)}</div>
            </div>`;
        }

        let toolChipsHtml = '';
        if (m.role === 'assistant' && m.tool_calls) {
            let tcNames = [];
            try { tcNames = JSON.parse(m.tool_calls); } catch { }
            if (tcNames.length > 0) {
                toolChipsHtml = '<div class="tool-calls">' + tcNames.map(n =>
                    `<span class="tool-chip"><span class="tc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span><span class="tc-name">${esc(n)}</span></span>`
                ).join('') + '</div>';
            }
        }

        if (m.role === 'system') {
            return `<div class="msg-wrap system"><div class="msg-bubble"><div class="role-tag">System</div><div class="bubble-body">${body}</div></div>${branchNav}</div>`;
        }

        return `<div class="msg-wrap ${m.role}" id="r-${m.id}">
            <div class="msg-bubble${e ? ' editing' : ''}">
                <div class="role-tag">${m.role === 'user' ? 'You' : 'Assistant'}</div>
                ${toolChipsHtml}
                ${reasoningHtml}
                <button class="edit-trigger" data-edit="${m.id}">Edit</button>
                <div class="bubble-body">${body}</div>
                <div class="edit-form">
                    <textarea id="et-${m.id}">${esc(m.content)}</textarea>
                    <div class="edit-row">
                        <button class="btn-save" id="es-${m.id}" data-save="${m.id}" data-role="${m.role}">Save</button>
                        <button class="btn-cancel" data-cancel>Cancel</button>
                        <span class="hint">${m.role === 'user' ? 'New branch + auto reply' : 'New branch'}</span>
                    </div>
                </div>
            </div>
            ${branchNav}
        </div>`;
    }).join('');

    // 事件代理
    c.querySelectorAll('.edit-trigger').forEach(btn => btn.addEventListener('click', () => startEdit(Number(btn.dataset.edit))));
    c.querySelectorAll('.btn-cancel').forEach(btn => btn.addEventListener('click', cancelEdit));
    c.querySelectorAll('.btn-save').forEach(btn => btn.addEventListener('click', () => saveEdit(Number(btn.dataset.save), btn.dataset.role)));
    c.querySelectorAll('.nav-arrow[data-branch]').forEach(btn => btn.addEventListener('click', () => navToBranch(Number(btn.dataset.branch))));
    c.querySelectorAll('.reasoning-toggle').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            this.classList.toggle('open');
            document.getElementById(this.dataset.reasoning).classList.toggle('open');
        });
    });

    renderNoteAnnotations(S.msgs);
    c.scrollTop = c.scrollHeight;
}

function navToBranch(branchId) {
    S.editing = null;
    cancelStream();
    api(`/conversations/${S.cid}/branches/switch`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId })
    }).then(async () => {
        await reloadMsgs();
        await loadBranches();
        renderMsgs();
        updateMeta();
    });
}

function startEdit(id) {
    S.editing = id;
    renderMsgs();
    const ta = $(`#et-${id}`);
    if (ta) ta.focus();
}

function cancelEdit() {
    S.editing = null;
    renderMsgs();
}

async function saveEdit(msgId, role) {
    const content = $('#et-' + msgId).value.trim();
    if (!content) return;
    const btn = $('#es-' + msgId);
    btn.disabled = true;
    if (role === 'user') btn.textContent = 'Regenerating...';

    if (role !== 'user') {
        try {
            await api(`/conversations/${S.cid}/messages/${msgId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            S.editing = null;
            await reloadMsgs();
            await loadBranches();
            renderMsgs();
            updateMeta();
            toast('Edited AI reply → new branch');
        } catch (e) { alert(e.message); }
        btn.disabled = false;
        return;
    }

    // 编辑用户消息 → 流式重新生成
    S.editing = null;
    S.streaming = true;
    $('#sendBtn').disabled = true;
    setEditTriggersDisabled(true);   // 🔒 禁用编辑按钮

    const idx = S.msgs.findIndex(m => m.id === msgId);
    if (idx >= 0) {
        S.msgs = S.msgs.slice(0, idx);
        S.msgs.push({ id: -Date.now(), role: 'user', content });
    }
    renderMsgs();
    appendStreamPlaceholder();
    try {
        const res = await fetch(`${BASE}/conversations/${S.cid}/messages/${msgId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        await processStream(res);
        await reloadMsgs();
        renderMsgs();
        S.convs = await api('/conversations');
        renderConvs();
        await loadBranches();
        updateMeta();
    } catch (e) {
        alert('Error: ' + e.message);
        await reloadMsgs();
        renderMsgs();
    } finally {
        S.streaming = false;
        $('#sendBtn').disabled = false;
        setEditTriggersDisabled(false);   // 🔓 恢复编辑按钮
    }
}

// ── 发送消息 ──
async function send() {
    const inp = $('#userInput');
    const msg = inp.value.trim();
    if (!msg || S.streaming) return;
    if (!S.cid) await newConv();
    inp.value = '';
    inp.style.height = 'auto';
    S.streaming = true;
    $('#sendBtn').disabled = true;
    setEditTriggersDisabled(true);   // 🔒 禁用编辑

    S.msgs.push({ id: -Date.now(), role: 'user', content: msg });
    renderMsgs();
    appendStreamPlaceholder();
    try {
        const res = await fetch(`${BASE}/conversations/${S.cid}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg })
        });
        if (!res.ok) throw new Error((await res.json()).error);
        await processStream(res);
        await reloadMsgs();
        renderMsgs();
        S.convs = await api('/conversations');
        renderConvs();
        await loadBranches();
        updateMeta();
    } catch (e) {
        alert('Error: ' + e.message);
        await reloadMsgs();
        renderMsgs();
    } finally {
        S.streaming = false;
        $('#sendBtn').disabled = false;
        setEditTriggersDisabled(false);   // 🔓 恢复编辑
    }
}

function appendStreamPlaceholder() {
    const p = document.createElement('div');
    p.className = 'msg-wrap assistant';
    p.id = 'ai-stream';
    p.innerHTML = `<div class="msg-bubble">
        <div class="role-tag">Assistant</div>
        <div id="ai-tool-calls" class="tool-calls" style="display:none"></div>
        <div id="ai-reasoning-wrap" class="reasoning-wrap" style="display:none">
            <button class="reasoning-toggle open"><span class="arrow">&#9654;</span> Thinking...</button>
            <div class="reasoning-body open" id="ai-reasoning"></div>
        </div>
        <div class="bubble-body" id="ai-body"><span class="streaming-cursor"></span></div>
    </div>`;
    $('#msgContainer').appendChild(p);
}

async function processStream(res) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', aiContent = '', aiReasoning = '', hasReasoning = false;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
                const d = JSON.parse(line.slice(6));
                if (d.error) throw new Error(d.error);
                if (d.tool_call) {
                    const tc = document.getElementById('ai-tool-calls');
                    if (tc) {
                        tc.style.display = 'flex';
                        const chip = document.createElement('span');
                        chip.className = 'tool-chip';
                        chip.innerHTML = `<span class="tc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span><span class="tc-name">${esc(d.tool_call.name)}</span>`;
                        tc.appendChild(chip);
                    }
                }
                if (d.reasoning_delta) {
                    hasReasoning = true;
                    aiReasoning += d.reasoning_delta;
                    const rw = document.getElementById('ai-reasoning-wrap');
                    const rb = document.getElementById('ai-reasoning');
                    if (rw) rw.style.display = 'block';
                    if (rb) rb.textContent = aiReasoning;
                }
                if (d.delta) {
                    aiContent += d.delta;
                    const body = document.getElementById('ai-body');
                    if (body) body.innerHTML = md(aiContent) + '<span class="streaming-cursor"></span>';
                }
                if (d.done) {
                    const body = document.getElementById('ai-body');
                    if (body) body.innerHTML = md(aiContent);
                    if (!hasReasoning) {
                        const rw = document.getElementById('ai-reasoning-wrap');
                        if (rw) rw.style.display = 'none';
                    }
                }
            } catch (e) { throw e; }
        }
        const container = $('#msgContainer');
        container.scrollTop = container.scrollHeight;
    }
}

function cancelStream() {
    if (S.streamAbort) S.streamAbort();
    S.streaming = false;
    $('#sendBtn').disabled = false;
    $('#regenBtn').disabled = false;
}

// ── 设置相关 ──
function syncSettings(c) {
    $('#sModel').value = c.model || 'deepseek-v4-pro';
    $('#sTemp').value = c.temperature ?? 0.7;
    $('#tLabel').textContent = c.temperature ?? 0.7;
    $('#sMax').value = c.max_tokens ?? 4096;
    $('#sTopP').value = c.top_p ?? 1.0;
    $('#pLabel').textContent = c.top_p ?? 1.0;
    $('#sSys').value = c.system_prompt || 'You are a helpful assistant.';
    $('#sReason').value = c.reasoning_effort || 'high';
}

async function applySettings() {
    if (!S.cid) return;
    await api(`/conversations/${S.cid}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: $('#sModel').value,
            temperature: parseFloat($('#sTemp').value),
            max_tokens: parseInt($('#sMax').value),
            top_p: parseFloat($('#sTopP').value),
            system_prompt: $('#sSys').value,
            reasoning_effort: $('#sReason').value
        })
    });
    await reloadMsgs();
    renderMsgs();
    toast('Settings applied');
}

async function regenerate() {
    if (!S.cid || S.streaming) return;
    S.streaming = true;
    S.editing = null;
    cancelStream();
    $('#regenBtn').disabled = true;
    setEditTriggersDisabled(true);   // 🔒 禁用编辑

    const oldAi = $('#msgContainer').querySelector('.msg-wrap.assistant:last-child');
    if (oldAi) oldAi.remove();
    appendStreamPlaceholder();
    try {
        const res = await fetch(`${BASE}/conversations/${S.cid}/regenerate`, { method: 'POST' });
        if (!res.ok) throw new Error((await res.json()).error);
        await processStream(res);
        await reloadMsgs();
        renderMsgs();
        S.convs = await api('/conversations');
        renderConvs();
        await loadBranches();
        updateMeta();
    } catch (e) {
        alert('Error: ' + e.message);
        await reloadMsgs();
        renderMsgs();
    } finally {
        S.streaming = false;
        $('#regenBtn').disabled = false;
        setEditTriggersDisabled(false);   // 🔓 恢复编辑
    }
}

// ── UI辅助 ──
function updateUI() {
    const v = !!S.cid;
    $('#mainHead').style.display = v ? 'flex' : 'none';
    $('#inputBar').style.display = v ? 'flex' : 'none';
    $('#settings').style.display = v ? 'flex' : 'none';
    if (v) updateMeta();
}

function updateMeta() {
    $('#branchMeta').textContent = S.branches.length + ' branch(es)';
    $('#msgMeta').textContent = S.msgs.length + ' messages';
}

function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
    }
}

// 主题切换
function turnTheme() {
    $("html").classList.toggle('dark-mode');
    $('#themeBox').classList.toggle('dark-mode');
}