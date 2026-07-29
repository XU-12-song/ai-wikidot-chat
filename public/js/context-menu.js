/**
 * Extensible right-click context menu.
 *
 * Register items per context ('selection' | 'default'), then call .show(x, y, context, data).
 */
class ContextMenu {
    constructor() {
        this.menu = document.createElement('div');
        this.menu.className = 'context-menu';
        document.body.appendChild(this.menu);

        /** @type {{ selection: Array<{label:string, action:Function}>, default: Array<{label:string, action:Function}> }} */
        this._items = { selection: [], default: [] };

        this._onDocClick = (e) => {
            if (!this.menu.contains(e.target)) this.hide();
        };
        this._onEsc = (e) => {
            if (e.key === 'Escape') this.hide();
        };
        this._onContext = (e) => e.preventDefault();
        document.addEventListener('click', this._onDocClick, true);
        document.addEventListener('keydown', this._onEsc);
        document.addEventListener('contextmenu', this._onContext);
    }

    /**
     * Register menu items for a context.
     * @param {'selection'|'default'} context
     * @param {Array<{label:string, action:(data:object)=>void}>} items
     */
    register(context, items) {
        if (!this._items[context]) this._items[context] = [];
        this._items[context].push(...items);
    }

    /**
     * Build and show the menu at (x, y).
     * @param {number} x           clientX
     * @param {number} y           clientY
     * @param {'selection'|'default'} context
     * @param {object} [data={}]   arbitrary data passed to action callbacks
     */
    show(x, y, context = 'default', data = {}) {
        const items = this._items[context] || [];
        if (!items.length) return;

        this.menu.innerHTML = items.map((item, i) => {
            if (item.separator) return '<div class="ctx-sep"></div>';
            return `<button class="ctx-item" data-idx="${i}">${item.label}</button>`;
        }).join('');

        this.menu.querySelectorAll('.ctx-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.idx);
                items[idx].action(data);
                this.hide();
            });
        });

        this.menu.style.display = 'block';
        this.menu.classList.add('show');

        // position with boundary check
        const rect = this.menu.getBoundingClientRect();
        let left = x, top = y;
        if (x + rect.width > window.innerWidth - 8) left = x - rect.width;
        if (y + rect.height > window.innerHeight - 8) top = y - rect.height;
        this.menu.style.left = Math.max(4, left) + 'px';
        this.menu.style.top = Math.max(4, top) + 'px';
    }

    hide() {
        this.menu.style.display = 'none';
        this.menu.classList.remove('show');
    }
}

// singleton
const ctxMenu = new ContextMenu();
