// ── Shared constants ─────────────────────────────────────────────────────────

// marked.js wraps tables in <figure>, so include FIGURE for table detection
const BLOCK_TAGS = new Set(['P', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'FIGURE', 'H1', 'H2', 'H3', 'H4']);
console.log("SS");

function getBlockParent(node, bubbleEl) {
    while (node && node !== bubbleEl) {
        const parent = node.parentElement;
        // check if parent is bubbleEl OR a block-tag direct child of bubbleEl
        if (parent === bubbleEl && BLOCK_TAGS.has(node.tagName)) return node;
        // also climb up: a block element inside a figure (marked.js wraps tables)
        if (parent && parent.parentElement === bubbleEl && BLOCK_TAGS.has(parent.tagName)) return parent;
        node = node.parentElement;
    }
    return null;
}

// ── Cross-element detection (exported for app.js) ────────────────────────────

function isCrossElementSelection(bubbleEl) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    return getBlockParent(range.startContainer, bubbleEl) !== getBlockParent(range.endContainer, bubbleEl);
}

// ── Show analysis card (returns Promise for sequential chaining) ─────────────

function showAnalysisCard(msg, startFrom, length, noteText) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'note-card-overlay';

        const card = document.createElement('div');
        card.className = 'note-card analysis-card';
        card.innerHTML = `
            <div class="note-card-head">
                <span class="note-card-title">解析</span>
                <button class="note-card-close">&times;</button>
            </div>
            <div class="note-card-selected">"${esc(noteText.slice(0, 80))}${noteText.length > 80 ? '...' : ''}"</div>
            <div id="note-tc" class="note-tool-calls" style="display:none"></div>
            <div id="note-reasoning-wrap" class="note-reasoning-wrap" style="display:none">
                <button class="note-reasoning-toggle open"><span class="arrow">&#9654;</span> Thinking...</button>
                <div class="note-reasoning-body open" id="note-reasoning"></div>
            </div>
            <div class="note-card-body"><span class="streaming-cursor"></span></div>
        `;
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const body = card.querySelector('.note-card-body');
        const close = card.querySelector('.note-card-close');
        const tc = card.querySelector('#note-tc');
        const rw = card.querySelector('#note-reasoning-wrap');
        const rb = card.querySelector('#note-reasoning');

        card.querySelector('.note-reasoning-toggle').addEventListener('click', function () {
            this.classList.toggle('open');
            rb.classList.toggle('open');
        });

        let closed = false;
        const remove = () => {
            if (closed) return;
            closed = true;
            overlay.classList.add('out');
            card.classList.add('out');
            card.addEventListener('animationend', () => { overlay.remove(); resolve(); }, { once: true });
        };
        close.addEventListener('click', remove);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) remove(); });
        const escHandler = (e) => { if (e.key === 'Escape') { remove(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);

        (async () => {
            try {
                const res = await fetch(BASE + '/notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message_id: msg.id,
                        start_from: startFrom,
                        length: length,
                        note: noteText,
                        form: 'analysis',
                    }),
                });
                if (!res.ok) throw new Error((await res.json()).error);

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = '', aiContent = '', hasReasoning = false;

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
                                tc.style.display = 'flex';
                                const chip = document.createElement('span');
                                chip.className = 'note-tool-chip';
                                chip.innerHTML = `<span class="ntc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span><span class="ntc-name">${esc(d.tool_call.name)}</span>`;
                                tc.appendChild(chip);
                            }
                            if (d.reasoning_delta) {
                                hasReasoning = true;
                                rw.style.display = 'block';
                                rb.textContent += d.reasoning_delta;
                            }
                            if (d.delta) {
                                aiContent += d.delta;
                                body.innerHTML = md(aiContent) + '<span class="streaming-cursor"></span>';
                            }
                            if (d.done) {
                                body.innerHTML = md(aiContent);
                                if (!hasReasoning) rw.style.display = 'none';
                            }
                        } catch (e) { throw e; }
                    }
                }
            } catch (e) {
                body.innerHTML = `<p style="color:var(--muted)">生成失败: ${esc(e.message)}</p>`;
            }
        })();
    });
}

// ── Mode A: text selected → one analysis card, mark all involved blocks ──────

function _getSelectionBlockElements(bubbleEl, range) {
    const startBlock = getBlockParent(range.startContainer, bubbleEl);
    const endBlock = getBlockParent(range.endContainer, bubbleEl);
    if (!startBlock || !endBlock) return [];
    if (startBlock === endBlock) return [startBlock];

    // collect all block children between start and end (inclusive, DOM order)
    const all = [];
    const walker = document.createTreeWalker(bubbleEl, NodeFilter.SHOW_ELEMENT);
    let collecting = false;
    let node;
    while ((node = walker.nextNode())) {
        if (node === startBlock) collecting = true;
        if (collecting && BLOCK_TAGS.has(node.tagName) && node.parentElement === bubbleEl) {
            all.push(node);
        }
        if (node === endBlock) break;
    }
    return all;
}

async function addAnalysisFromSelection(data) {
    const { msg, note } = data;
    if (document.querySelector('.note-card-overlay')) { toast('请先关闭当前卡片'); return; }
    if ((msg.notes || []).some(n => n.form === 'analysis' && n.note === note.note)) {
        toast('此文本已有解析'); return;
    }
    const bubble = getSelectionBubble();
    if (!bubble) return;
    const range = window.getSelection().getRangeAt(0);
    const blocks = _getSelectionBlockElements(bubble, range);
    if (!blocks.length) return;

    // ONE card with the selected text (not per-block)
    await showAnalysisCard(msg, note.start_from, note.length, note.note);

    await reloadMsgs();
    renderMsgs();
}

// ── Mode B: element selection ────────────────────────────────────────────────

function _getDirectBlocks(bubbleEl) {
    const result = [];
    for (const child of bubbleEl.children) {
        if (BLOCK_TAGS.has(child.tagName)) {
            result.push(child);
        }
    }
    return result;
}

function enterAnalysisMode(data) {
    const { msg, msgWrap } = data;
    if (!msg || !msgWrap) return;
    const bubble = msgWrap.querySelector('.bubble-body');
    if (!bubble) return;

    const blocks = _getDirectBlocks(bubble);
    if (!blocks.length) { toast('No block elements found'); return; }

    blocks.forEach((b, i) => { b.dataset.blockIdx = i; });
    msgWrap.classList.add('element-select-mode');

    const selected = new Set();

    const onBlockClick = (e) => {
        e.stopPropagation();
        const el = e.currentTarget;
        const idx = Number(el.dataset.blockIdx);

        if (selected.has(idx)) {
            const arr = [...selected].sort((a, b) => a - b);
            if (arr.length === 1 || idx === arr[0] || idx === arr[arr.length - 1]) {
                selected.delete(idx);
                el.classList.remove('analysis-selected');
            }
            return;
        }

        if (selected.size === 0) {
            selected.add(idx);
            el.classList.add('analysis-selected');
            return;
        }

        const arr = [...selected].sort((a, b) => a - b);
        const min = arr[0], max = arr[arr.length - 1];

        if (idx === min - 1 || idx === max + 1) {
            selected.add(idx);
            el.classList.add('analysis-selected');
            return;
        }

        // non-adjacent: auto-fill gap
        const lo = Math.min(min, idx), hi = Math.max(max, idx);
        for (let i = lo; i <= hi; i++) {
            selected.add(i);
            blocks[i].classList.add('analysis-selected');
        }
    };

    blocks.forEach(b => b.addEventListener('click', onBlockClick));

    // floating action bar
    const bar = document.createElement('div');
    bar.className = 'analysis-action-bar';
    bar.innerHTML = `
        <span class="hint">Click block elements to select (adjacent only)</span>
        <button class="btn-cancel">取消</button>
        <button class="btn-confirm">确认</button>
    `;
    document.body.appendChild(bar);

    const cleanup = () => {
        msgWrap.classList.remove('element-select-mode');
        blocks.forEach(b => {
            b.classList.remove('analysis-selected');
            delete b.dataset.blockIdx;
            b.removeEventListener('click', onBlockClick);
        });
        bar.remove();
    };

    bar.querySelector('.btn-cancel').addEventListener('click', cleanup);

    bar.querySelector('.btn-confirm').addEventListener('click', async () => {
        const indices = [...selected].sort((a, b) => a - b);
        cleanup();
        if (!indices.length) return;
        if (document.querySelector('.note-card-overlay')) { toast('请先关闭当前卡片'); return; }

        // combine all selected text into one analysis
        const combined = indices.map(i => blocks[i].textContent.trim()).filter(Boolean).join('\n\n');
        if (!combined) return;

        // check for existing analysis on same msg
        const existing = await api('/conversations/' + S.cid);
        const freshMsg = (existing.messages || []).find(m => m.id === msg.id);
        if (freshMsg && (freshMsg.notes || []).some(n => n.form === 'analysis' && n.note === combined)) {
            toast('此文本已有解析'); return;
        }

        const startFrom = msg.content.indexOf(combined);
        const length = combined.length;
        await showAnalysisCard(msg, startFrom >= 0 ? startFrom : 0, length, combined);

        await reloadMsgs();
        renderMsgs();
    });
}

// ── Render analysis markers ──────────────────────────────────────────────────

function _getOffsetTop(child, ancestor) {
    let top = 0;
    let el = child;
    while (el && el !== ancestor) {
        top += el.offsetTop;
        el = el.offsetParent;
    }
    return top;
}

function renderAnalysisMarkers(msgs) {
    // clean up old bars
    document.querySelectorAll('.analysis-bar').forEach(b => b.remove());

    msgs.forEach(m => {
        const analysisNotes = (m.notes || []).filter(n => n.form === 'analysis');
        if (!analysisNotes.length) return;
        const wrap = document.getElementById('r-' + m.id);
        if (!wrap) return;
        const msgBubble = wrap.querySelector('.msg-bubble');
        if (!msgBubble) return;
        const bubble = wrap.querySelector('.bubble-body');
        if (!bubble) return;

        const blocks = _getDirectBlocks(bubble);
        const targets = blocks.length ? blocks : [bubble];

        analysisNotes.forEach(note => {
            if (!note.note) return;
            const noteText = note.note.replace(/\s+/g, ' ').trim();

            const matched = [];
            for (const block of targets) {
                const text = (block.textContent || '').replace(/\s+/g, ' ').trim();
                if (!text) continue;
                if (text.includes(noteText) || noteText.includes(text)) {
                    matched.push(block);
                } else if (noteText.length > 20) {
                    const chunks = noteText.split('\n\n');
                    for (const chunk of chunks) {
                        const c = chunk.trim();
                        if (c.length > 3 && text.includes(c)) {
                            matched.push(block);
                            break;
                        }
                    }
                }
            }
            if (!matched.length) return;

            // position bar relative to msg-bubble (which has position: relative)
            const firstTop = _getOffsetTop(matched[0], msgBubble);
            const last = matched[matched.length - 1];
            const lastBottom = _getOffsetTop(last, msgBubble) + last.offsetHeight;

            const bar = document.createElement('div');
            bar.className = 'analysis-bar';
            bar.style.top = firstTop + 'px';
            bar.style.height = (lastBottom - firstTop) + 'px';
            bar.dataset.analysisId = note.id;

            // append to msg-bubble so it sits above content in z-order
            msgBubble.appendChild(bar);

            matched.forEach(block => {
                block.querySelectorAll('.note-annotation').forEach(el => {
                    el.replaceWith(document.createTextNode(el.textContent));
                });
            });
        });
    });

    // bind click
    document.querySelectorAll('.analysis-bar').forEach(bar => {
        if (bar._analysisBound) return;
        bar._analysisBound = true;
        bar.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            const noteId = Number(bar.dataset.analysisId);
            if (!noteId) { console.warn('analysis-bar: no noteId'); return; }
            try {
                const note = await api('/notes/' + noteId);
                if (!note) { console.warn('analysis-bar: note not found', noteId); return; }
                _showExistingAnalysis(note);
            } catch (e) { console.error('analysis-bar click error:', e); }
        });
    });
}

// ── Show existing analysis card ──────────────────────────────────────────────

function _showExistingAnalysis(note) {
    const overlay = document.createElement('div');
    overlay.className = 'note-card-overlay';
    const card = document.createElement('div');
    card.className = 'note-card analysis-card';
    let reasoningHtml = '';
    if (note.reasoning_content) {
        reasoningHtml = `<div class="note-reasoning-wrap" style="display:block">
            <button class="note-reasoning-toggle"><span class="arrow">&#9654;</span> Thinking...</button>
            <div class="note-reasoning-body">${esc(note.reasoning_content)}</div>
        </div>`;
    }
    card.innerHTML = `
        <div class="note-card-head">
            <span class="note-card-title">解析</span>
            <button class="note-card-close">&times;</button>
        </div>
        <div class="note-card-selected">"${esc((note.note || '').slice(0, 80))}"</div>
        ${reasoningHtml}
        <div class="note-card-body">${md(note.content || '')}</div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const toggle = card.querySelector('.note-reasoning-toggle');
    const body = card.querySelector('.note-reasoning-body');
    if (toggle && body) {
        toggle.addEventListener('click', () => {
            toggle.classList.toggle('open');
            body.classList.toggle('open');
        });
    }

    const remove = () => {
        overlay.classList.add('out');
        card.classList.add('out');
        card.addEventListener('animationend', () => overlay.remove(), { once: true });
    };
    card.querySelector('.note-card-close').addEventListener('click', remove);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) remove(); });
    document.addEventListener('keydown', function escClose(e) {
        if (e.key === 'Escape') { remove(); document.removeEventListener('keydown', escClose); }
    });
}
