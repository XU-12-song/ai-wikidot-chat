// ── Note card modal ──────────────────────────────────────────────────────────

/**
 * Create and show a note card for generating AI explanation via SSE.
 *
 * @param {object} msg       - the message row (must have .id, .content, .conversation_id)
 * @param {number} startFrom - character offset of selected text in msg.content
 * @param {number} length    - length of selected text
 * @param {string} noteText  - the selected text itself
 */
async function showNoteCard(msg, startFrom, length, noteText) {
    const overlay = document.createElement('div');
    overlay.className = 'note-card-overlay';

    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `
        <div class="note-card-head">
            <span class="note-card-title">笔记</span>
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

    // reasoning toggle
    card.querySelector('.note-reasoning-toggle').addEventListener('click', function () {
        this.classList.toggle('open');
        rb.classList.toggle('open');
    });

    // close handlers
    const abortController = new AbortController();
    const remove = () => {
        abortController.abort();
        overlay.classList.add('out');
        card.classList.add('out');
        card.addEventListener('animationend', () => overlay.remove(), { once: true });
    };
    close.addEventListener('click', remove);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) remove(); });
    document.addEventListener('keydown', function escClose(e) {
        if (e.key === 'Escape') { remove(); document.removeEventListener('keydown', escClose); }
    });

    // SSE stream
    try {
        const res = await fetch(BASE + '/notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message_id: msg.id,
                start_from: startFrom,
                length: length,
                note: noteText,
            }),
            signal: abortController.signal,
        });
        if (!res.ok) throw new Error((await res.json()).error);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '', aiContent = '', hasReasoning = false, hasTool = false;

        while (true) {
            const { done, value } = await reader.read();
            buf += decoder.decode(value, { stream: !done });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const d = JSON.parse(line.slice(6));
                    if (d.error) throw new Error(d.error);
                    if (d.tool_call) {
                        hasTool = true;
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
                } catch (e2) { /* skip malformed lines */ }
            }
            if (done) break;
        }
    } catch (e) {
        if (e.name !== 'AbortError') {
            body.innerHTML = `<p style="color:var(--muted)">生成失败: ${esc(e.message)}</p>`;
        }
    }
}

// ── Note annotation rendering ────────────────────────────────────────────────

/**
 * Find and wrap note-annotated text spans in rendered message DOM.
 * Call after renderMsgs() to highlight noted text selections.
 *
 * @param {Array<object>} msgs - the S.msgs array (each may have .notes)
 */
function renderNoteAnnotations(msgs) {
    msgs.forEach(m => {
        if (!m.notes || !m.notes.length) return;
        const wrap = document.getElementById('r-' + m.id);
        if (!wrap) return;
        const bubble = wrap.querySelector('.bubble-body');
        if (!bubble) return;

        m.notes.forEach(note => {
            if (note.start_from < 0 || !note.note) return;
            // search for note text in raw content and wrap in <span>
            const rawHtml = bubble.innerHTML;
            const idx = rawHtml.indexOf(note.note);
            if (idx === -1) return;
            const before = rawHtml.slice(0, idx);
            const match = rawHtml.slice(idx, idx + note.note.length);
            const after = rawHtml.slice(idx + note.note.length);
            bubble.innerHTML = before
                + `<span class="note-annotation" data-note-id="${note.id}">${match}</span>`
                + after;
        });
    });

    // bind click → open note card
    document.querySelectorAll('.note-annotation').forEach(el => {
        el.addEventListener('click', async (e) => {
            e.stopPropagation();
            const noteId = Number(el.dataset.noteId);
            try {
                const note = await api('/notes/' + noteId);
                if (!note || !note.content) return;
                // show existing note content in card
                _showExistingNote(note);
            } catch {}
        });
    });
}

function _showExistingNote(note) {
    const overlay = document.createElement('div');
    overlay.className = 'note-card-overlay';
    const card = document.createElement('div');
    card.className = 'note-card';
    let reasoningHtml = '';
    if (note.reasoning_content) {
        reasoningHtml = `<div class="note-reasoning-wrap" style="display:block">
            <button class="note-reasoning-toggle"><span class="arrow">&#9654;</span> Thinking...</button>
            <div class="note-reasoning-body">${esc(note.reasoning_content)}</div>
        </div>`;
    }
    card.innerHTML = `
        <div class="note-card-head">
            <span class="note-card-title">笔记</span>
            <button class="note-card-close">&times;</button>
        </div>
        <div class="note-card-selected">"${esc((note.note || '').slice(0, 80))}"</div>
        ${reasoningHtml}
        <div class="note-card-body">${md(note.content || '')}</div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // reasoning toggle
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

// ── Selection helpers ────────────────────────────────────────────────────────

/**
 * Check if the current selection is fully inside a .bubble-body element.
 * Returns the bubble DOM element if true, otherwise null.
 */
function getSelectionBubble() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const bubbles = document.querySelectorAll('.bubble-body');
    for (const b of bubbles) {
        if (b.contains(range.startContainer) && b.contains(range.endContainer)) return b;
    }
    return null;
}

/**
 * Get character offset and length of selection within the raw message content.
 * Uses text-node walker to count rendered characters, then indexOf on raw content.
 *
 * @param {HTMLElement} bubbleEl - the .bubble-body element
 * @param {string} rawContent    - the original message.content (plain text)
 * @returns {{start_from: number, length: number, note: string}|null}
 */
function getSelectionNote(bubbleEl, rawContent) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    const noteText = range.toString().trim();
    if (!noteText) return null;

    // count char offset by walking text nodes
    let startFrom = 0;
    const walker = document.createTreeWalker(bubbleEl, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
        if (node === range.startContainer) {
            startFrom += range.startOffset;
            break;
        }
        startFrom += node.textContent.length;
    }

    const length = noteText.length;
    return { start_from: startFrom, length, note: noteText };
}
