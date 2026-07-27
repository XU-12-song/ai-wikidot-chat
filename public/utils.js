// 工具函数：HTML转义、Toast提示、Markdown渲染、确认弹窗

function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toast(text) {
    const d = document.createElement('div');
    d.className = 'fork-toast';
    d.textContent = text;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3100);
}

// Markdown 渲染（优先使用 marked 库，否则使用内置 fallback）
function md(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined' && marked.parse) {
        marked.setOptions({ breaks: true, gfm: true });
        return marked.parse(text);
    }
    return fallbackMd(text);
}

function fallbackMd(text) {
    const blocks = [];
    let t = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        blocks.push('<pre><code>' + esc(code.trimEnd()) + '</code></pre>');
        return '\x00B' + (blocks.length - 1) + '\x00';
    });

    const inlines = [];
    t = t.replace(/`([^`]+)`/g, (_, code) => {
        inlines.push('<code>' + esc(code) + '</code>');
        return '\x00I' + (inlines.length - 1) + '\x00';
    });

    const tables = [];
    t = t.replace(/^\|.+\|[\s\S]*?\n\n/gm, (table) => {
        const rows = table.trim().split('\n').filter(r => r.includes('|'));
        if (rows.length < 2) return table;
        const html = ['<table>'];
        rows.forEach((row, ri) => {
            const cells = row.split('|').filter(c => c.trim() !== '');
            const tag = ri === 0 ? 'th' : 'td';
            const isSep = cells.every(c => /^[\s:-]+$/.test(c));
            html.push('<tr>');
            if (ri === 1 && isSep) return;
            cells.forEach(c => { html.push('<' + tag + '>' + c.trim() + '</' + tag + '>'); });
            html.push('</tr>');
        });
        html.push('</table>');
        tables.push(html.join(''));
        return '\x00T' + (tables.length - 1) + '\x00';
    });

    t = esc(t);
    t = t.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*(.+?)\*/g, '<em>$1</em>');
    t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px">');
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    t = t.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    t = t.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    t = t.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    t = t.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    t = t.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    t = t.replace(/^---$/gm, '<hr>');
    t = t.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
    t = t.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    t = t.replace(/(<li>.*?<\/li>(\n|$))+/g, '<ul>$&</ul>');
    t = t.replace(/\n\n+/g, '</p><p>');
    t = t.replace(/\n/g, '<br>');
    t = t.replace(/\x00T(\d+)\x00/g, (_, i) => tables[+i]);
    t = t.replace(/\x00I(\d+)\x00/g, (_, i) => inlines[+i]);
    t = t.replace(/\x00B(\d+)\x00/g, (_, i) => blocks[+i]);
    return '<p>' + t + '</p>';
}

function showConfirm(message, { confirmText = '确定', cancelText = '取消' } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.innerHTML = `
            <div class="confirm-message">${message}</div>
            <div class="confirm-buttons">
                <button class="confirm-btn cancel">${cancelText}</button>
                <button class="confirm-btn confirm">${confirmText}</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        const close = (result) => {
            overlay.classList.add('out');
            dialog.classList.add('out');
            const onAnimEnd = (e) => {
                if (e.animationName === 'float-up-out') {
                    overlay.remove();
                    dialog.removeEventListener('animationend', onAnimEnd);
                    resolve(result);
                }
            };
            dialog.addEventListener('animationend', onAnimEnd);
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
        dialog.addEventListener('click', (e) => e.stopPropagation());
        dialog.querySelector('.confirm-btn.cancel').addEventListener('click', () => close(false));
        dialog.querySelector('.confirm-btn.confirm').addEventListener('click', () => close(true));
        dialog.querySelector('.confirm-btn.confirm').focus();
    });
}

function showPrompt(message, defaultValue = '', { confirmText = '确定', cancelText = '取消', placeholder = '' } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.innerHTML = `
            <div class="confirm-message">${message}</div>
            <input type="text" class="prompt-input" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" autofocus>
            <div class="confirm-buttons">
                <button class="confirm-btn cancel">${cancelText}</button>
                <button class="confirm-btn confirm">${confirmText}</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const input = dialog.querySelector('.prompt-input');
        input.focus();
        // 回车键确认
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                close(input.value.trim() || null);
            }
        });

        const close = (result) => {
            dialog.classList.add('out');
            const onAnimEnd = (e) => {
                if (e.animationName === 'float-up-out') {
                    overlay.remove();
                    dialog.removeEventListener('animationend', onAnimEnd);
                    resolve(result);
                }
            };
            dialog.addEventListener('animationend', onAnimEnd);
        };

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });
        dialog.addEventListener('click', (e) => e.stopPropagation());
        dialog.querySelector('.confirm-btn.cancel').addEventListener('click', () => close(null));
        dialog.querySelector('.confirm-btn.confirm').addEventListener('click', () => close(input.value.trim() || null));
    });
}