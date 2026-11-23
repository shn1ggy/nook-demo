import { pdfCard } from './pdf.js';
import { prettyKey } from './commands.js';
import { confirmReminder } from './confirm.js';
import { mountWidget, newWidgetBlock } from '../widgets/runtime.js';
import { allWidgets, widgetDef } from '../widgets/api.js';
import { setPreviewRenderer } from '../widgets/builtins.js';
import { resolveRowTarget, targetFromHref } from '../links.js';
import { SAFE_TO_VIEW, tintVars, openOrDownload, haptic, h, svgIcon, ICONS, ulid, blockColorStyle, debounce, COLORS, BLOCK_BG, checkbox, colorLabel, isLarge, todayISO, fmtDay } from '../util.js';
import { quickTimes } from './reminders.js';
import { parseWhen, localIso, shortWhen } from '../when.js';
import { UNUSED } from '../layout.js';
import { htmlToInline, inlineToHtml, plainText } from '../format/inline.js';
import { menu, prompt, toast, confirmDialog, menuIcon } from './pop.js';
import { compressStored, prepareUpload, mb } from './compress.js';
import { iconSvg, renderIcon } from './icons.js';
import { embedUrl, siteName } from '../format/embed.js';
import { pickIcon } from './iconpicker.js';
import { formatKey, installFormatBar, registerFormatHost } from './formatbar.js';
import { newTextComment, openTextComment } from './comments.js';
import { renderViewBlock, newView } from '../views/view.js';
import { VIEW_TYPES } from '../views/viewpanel.js';
import { dbItems, linkItems, pickEntries } from './pickers.js';
import { serializePage } from '../format/page.js';
import { tintStyle, tintMenuEntries, buttonEl, buttonSettings, runButton, stepsOf, captureCfg, captureStart, captureSettings, runCapture } from './buttons.js';
const TEXT_TYPES = new Set(['paragraph', 'heading', 'todo', 'bullet', 'numbered', 'quote', 'toggle', 'code']);
const LIST_TYPES = new Set(['bullet', 'numbered', 'todo']);
const TURN_INTO = [
    { type: 'paragraph', label: 'Text', icon: 'type' },
    { type: 'heading', level: 1, label: 'Heading 1', icon: 'heading', key: '#' },
    { type: 'heading', level: 2, label: 'Heading 2', icon: 'heading', key: '##' },
    { type: 'heading', level: 3, label: 'Heading 3', icon: 'heading', key: '###' },
    { type: 'todo', label: 'To-do', icon: 'check-square', key: '[]' },
    { type: 'bullet', label: 'Bulleted list', icon: 'list', key: '-' },
    { type: 'numbered', label: 'Numbered list', icon: 'list-ordered', key: '1.' },
    { type: 'toggle', level: 0, label: 'Toggle', icon: 'toggle', key: '>' },
    { type: 'toggle', level: 1, label: 'Toggle heading 1', icon: 'toggle' },
    { type: 'toggle', level: 2, label: 'Toggle heading 2', icon: 'toggle' },
    { type: 'toggle', level: 3, label: 'Toggle heading 3', icon: 'toggle' },
    { type: 'quote', label: 'Quote', icon: 'quote', key: '"' },
    { type: 'callout', label: 'Callout', icon: 'message' },
    { type: 'code', label: 'Code', icon: 'code', key: '```' },
];
const turnIcon = (t) => menuIcon(t.icon, t.level || undefined);
/** a dragged line at x (in a box from `left`, `width` wide) snaps to ¼, ⅓, ½, ⅔, ¾ when close */
function snapAt(x, left, width) {
    for (const f of [0.25, 1 / 3, 0.5, 2 / 3, 0.75]) {
        const sx = left + f * width;
        if (Math.abs(x - sx) < 10)
            return sx;
    }
    return x;
}
/** put `desired` block elements into `container` in this order, moving as little as possible
 *  (an element that is moved or taken out reloads – e.g. a YouTube video starts over) */
function patchBlocks(container, desired) {
    const want = new Set(desired);
    const isBlock = (n) => !!n && n.classList.contains('block');
    const nextBlock = (n) => { let x = n?.nextElementSibling ?? null; while (x && !isBlock(x))
        x = x.nextElementSibling; return x; };
    let cur = [...container.children].find(isBlock) ?? null;
    // things after the blocks (+ area, column resizer …) stay at the end
    const tail = () => container.querySelector(':scope > .add-block, :scope > .col-resize');
    for (const d of desired) {
        while (cur && !want.has(cur)) {
            const n = nextBlock(cur);
            cur.remove();
            cur = n;
        }
        if (cur === d) {
            cur = nextBlock(cur);
            continue;
        }
        container.insertBefore(d, cur ?? tail());
    }
    while (cur) {
        const n = nextBlock(cur);
        if (!want.has(cur))
            cur.remove();
        cur = n;
    }
}
const isTileType = (b) => !!b && (b.type === 'button' || b.type === 'pagelink');
export class Editor {
    blocks;
    ctx;
    readonly;
    el;
    index = new Map();
    dragIds = [];
    /** the page these blocks belong to (new subpages go under it) */
    owner;
    get ownerPage() { return this.owner; }
    set ownerPage(id) {
        const changed = id !== this.owner;
        this.owner = id;
        this.linked = this.linkedNow();
        // page links show as subpage or link depending on the owner
        if (changed && this.el) {
            this.built = new WeakMap();
            this.render();
        }
    }
    /** blocks selected as a whole (Esc, ⇧/⌘-click on the handle, or dragging a text selection across blocks) */
    selected = new Set();
    anchor = null;
    save;
    /** file whose comments/<…>.json holds the comments on this text (pages and entries) */
    commentPath;
    /** the page's or entry's file now (files added here go next to it) */
    fileOf;
    /** `owner`: the page these blocks belong to (set here, the blocks are drawn once instead of twice) */
    constructor(blocks, ctx, onSave, readonly = false, owner) {
        this.blocks = blocks;
        this.ctx = ctx;
        this.readonly = readonly;
        this.save = debounce(onSave, 400);
        this.el = h('div', { class: 'blocks root-blocks' });
        if (!readonly) {
            this.fileDrop();
            this.blockDnd();
            this.blockSelection();
            this.marquee();
            this.touchTools();
            this.listenUnlink();
        }
        // links in text open on click (as in Notion); select the text to edit the link instead
        // click on commented text: show the comment
        this.el.addEventListener('click', (e) => {
            const m = e.target.closest('mark[data-comment]');
            if (!m || !this.commentPath || e.button !== 0)
                return;
            const sel = getSelection();
            if (sel && !sel.isCollapsed)
                return;
            const el = m.closest('.txt');
            const b = this.index.get(m.closest('.block')?.dataset.id ?? '')?.block;
            openTextComment(this.ctx.ws, this.commentPath, m, () => { if (b && el) {
                b.text = htmlToInline(el);
                this.save();
            } }, this.readonly);
        });
        this.el.addEventListener('click', (e) => {
            const a = e.target.closest('.txt a[href]');
            if (!a || !this.el.contains(a) || e.button !== 0)
                return;
            const sel = getSelection();
            if (sel && !sel.isCollapsed)
                return;
            e.preventDefault();
            const href = a.getAttribute('href') ?? '';
            // a reminder chip in the text: change its time or remove it
            if (href.startsWith('nook:remind:')) {
                this.inlineRemindMenu(a);
                return;
            }
            const target = targetFromHref(href);
            if (target) {
                if (e.metaKey || e.ctrlKey) {
                    const u = this.ctx.pageUrl?.(target);
                    if (u)
                        window.open(u, "_blank");
                }
                else
                    this.ctx.openPage(target);
                return;
            }
            if (/^(https?:|mailto:|tel:)/i.test(href))
                window.open(href, '_blank', 'noopener');
        });
        // middle-click on a link to a page or entry in the text: a new tab (the browser can't open nook: itself)
        this.el.addEventListener('mousedown', (e) => { if (e.button === 1 && e.target.closest('.txt a[href]'))
            e.preventDefault(); });
        this.el.addEventListener('auxclick', (e) => {
            if (e.button !== 1)
                return;
            const a = e.target.closest('.txt a[href]');
            if (!a || !this.el.contains(a))
                return;
            const target = targetFromHref(a.getAttribute('href') ?? '');
            if (target) {
                e.preventDefault();
                {
                    const u = this.ctx.pageUrl?.(target);
                    if (u)
                        window.open(u, "_blank");
                }
                ;
            }
        });
        if (!readonly) {
            installFormatBar();
            registerFormatHost(this.el, {
                blockOf: (el) => this.index.get(el.closest('.block')?.dataset.id ?? '')?.block,
                sync: (b, el) => { b.text = htmlToInline(el); this.save(); },
                turnInto: (b, t) => this.turnInto(b, t),
                setAlign: (b, a) => { if (a)
                    b.align = a;
                else
                    delete b.align; this.changed(); },
                turnOptions: TURN_INTO.filter((t) => t.type !== 'callout'),
                comment: (mark, b, el) => { if (this.commentPath)
                    newTextComment(this.ctx.ws, this.commentPath, mark, () => { b.text = htmlToInline(el); this.save(); }); },
            });
        }
        if (owner) {
            this.owner = owner;
            this.linked = this.linkedNow();
        }
        this.render();
    }
    // ---------- rendering ----------
    render(focus) {
        this.index.clear();
        // patched in place: blocks that didn't change are never taken out of the page, so a playing
        // video or a loaded embed keeps running while you add or change other blocks
        patchBlocks(this.el, this.renderEls(this.blocks, null));
        if (!this.readonly && !this.el.querySelector(':scope > .add-block')) {
            this.el.appendChild(h('div', {
                class: 'add-block',
                onclick: () => {
                    const last = this.blocks[this.blocks.length - 1];
                    if (last && last.type === 'paragraph' && !last.text) {
                        this.focus(last.id, 'end');
                        return;
                    }
                    const b = { id: ulid(), type: 'paragraph', text: '' };
                    this.blocks.push(b);
                    this.changed({ id: b.id, at: 'start' });
                },
            }));
        }
        if (focus)
            this.focus(focus.id, focus.at);
        this.markSelection();
        if (this.el.isConnected)
            alignCallouts(this.el);
        requestAnimationFrame(() => alignCallouts(this.el));
        if (!fontsSettled)
            document.fonts?.ready.then(() => { fontsSettled = true; alignCallouts(this.el); });
    }
    /** Blocks that did not change keep their element: structural edits stay fast on long pages,
     *  and embeds, videos and database views are not rebuilt (or reloaded) on every Enter. */
    built = new WeakMap();
    renderList(arr, parent) {
        const frag = document.createDocumentFragment();
        for (const el of this.renderEls(arr, parent))
            frag.appendChild(el);
        return frag;
    }
    /** the elements for a list of blocks: unchanged ones are reused; a container whose own settings
     *  didn't change (callout, toggle, list item, columns) keeps its element and only its inside is patched */
    renderEls(arr, parent) {
        const out = [];
        let num = 0;
        for (const b of arr) {
            this.index.set(b.id, { block: b, arr, parent });
            num = b.type === 'numbered' ? num + 1 : 0;
            const head = `${num}|${this.listDepth(b)}|`;
            const sig = head + JSON.stringify(b);
            // a widget keeps itself up to date: its state changing doesn't rebuild it
            const own = head + JSON.stringify({ ...b, data: b.type === 'widget' ? undefined : b.data, children: b.children?.map((c) => (b.type === 'columns' || b.type === 'tabs' ? { ...c, children: undefined } : c.id)) });
            const old = this.built.get(b);
            if (old && old.sig === sig) {
                this.indexTree(b);
                old.el.classList.remove('dragging', 'drop-before', 'drop-after');
                out.push(old.el);
                continue;
            }
            if (old && old.own === own && this.patchInside(b, old.el)) {
                this.built.set(b, { sig, own, el: old.el });
                out.push(old.el);
                continue;
            }
            const el = this.renderBlock(b, num);
            this.built.set(b, { sig, own, el });
            out.push(el);
        }
        this.rowLargeButtons(arr);
        return out;
    }
    /** update the blocks inside a container element in place; false = it has to be built again */
    patchInside(b, el) {
        const kids = b.children ?? [];
        if (!kids.length)
            return false;
        if (b.type === 'columns') {
            const cols = [...el.querySelectorAll(':scope > .columns > .column')];
            if (cols.length !== kids.length || kids.some((c, i) => cols[i].dataset.id !== c.id))
                return false;
            kids.forEach((col, i) => { this.index.set(col.id, { block: col, arr: kids, parent: b }); patchBlocks(cols[i], this.renderEls(col.children ?? [], col)); });
            return true;
        }
        if (b.type === 'tabs') {
            const body = el.querySelector(':scope > .tabs-block > .tabs-body');
            const tab = kids[Math.min(b.active ?? 0, kids.length - 1)];
            if (!body || !tab || body.dataset.id !== tab.id)
                return false;
            kids.forEach((t) => this.index.set(t.id, { block: t, arr: kids, parent: b }));
            patchBlocks(body, this.renderEls(tab.children ?? [], tab));
            return true;
        }
        const box = b.type === 'callout' ? el.querySelector(':scope > .callout') : b.type === 'capture' ? el.querySelector(':scope > .capture') : null;
        const inner = b.type === 'callout' || b.type === 'capture' ? box?.querySelector(':scope > .blocks')
            : b.type === 'toggle' ? el.querySelector('.toggle-body')
                : el.querySelector(':scope > .li-children');
        if (!inner || inner.querySelector(':scope > .toggle-empty'))
            return false;
        patchBlocks(inner, this.renderEls(kids, b));
        return true;
    }
    /** buttons and page links that follow each other form a group (they can share rows) */
    largeGroup(b) {
        const loc = this.index.get(b.id);
        if (!loc || !isTileType(b))
            return [b];
        const arr = loc.arr, i = arr.indexOf(b);
        let a = i;
        while (a > 0 && isTileType(arr[a - 1]))
            a--;
        let z = i;
        while (z < arr.length - 1 && isTileType(arr[z + 1]))
            z++;
        return arr.slice(a, z + 1);
    }
    /** a group of buttons / page links shares rows when "Per row" is set (1–4) or when it has large
     *  tiles (then Auto = 2 per row, 3 when there are exactly 3) */
    rowLargeButtons(arr) {
        for (let i = 0; i < arr.length; i++) {
            const el = this.built.get(arr[i])?.el;
            if (!el)
                continue;
            el.classList.remove('tile', 'lg', 'row-start', 'row-end');
            el.style.removeProperty('--cols');
            el.style.removeProperty('--tile-span');
            if (!isTileType(arr[i]))
                continue;
            let start = i;
            while (start > 0 && isTileType(arr[start - 1]))
                start--;
            let end = i;
            while (end < arr.length - 1 && isTileType(arr[end + 1]))
                end++;
            const group = arr.slice(start, end + 1);
            const set = group.find((x) => x.perRow)?.perRow;
            const anyLarge = group.some((x) => isLarge(x));
            if (isLarge(arr[i]))
                el.classList.add('lg');
            if (!set && !anyLarge)
                continue;
            const n = group.length;
            // large ones set by hand sit side by side (2 or 3 per row); large by default they stay one per row
            const chosen = group.some((x) => x.size === 'large');
            const cols = Math.min(n, set ?? (chosen ? (n === 3 ? 3 : 2) : 1));
            const k = (i - start) % cols;
            el.classList.add('tile');
            if (k === 0)
                el.classList.add('row-start');
            if (k === cols - 1 || i === end)
                el.classList.add('row-end');
            el.style.setProperty('--cols', String(cols));
            el.style.setProperty('--tile-span', String(12 / cols));
        }
    }
    /** "Size" and "Per row" for buttons and page links */
    sizeEntries(b) {
        const group = () => this.largeGroup(b);
        const cur = group().find((x) => x.perRow)?.perRow;
        return [
            { label: 'Size', icon: menuIcon('maximize'), hint: isLarge(b) ? 'Large' : 'Normal', sub: () => [
                    { label: `${!isLarge(b) ? '✓' : '   '} Normal`, run: () => { b.size = 'normal'; this.changed(); } },
                    { label: `${isLarge(b) ? '✓' : '   '} Large`, run: () => { b.size = 'large'; this.changed(); } },
                ] },
            { label: 'Per row', icon: menuIcon('columns'), hint: cur ? String(cur) : 'Auto', sub: () => [undefined, 1, 2, 3, 4].map((n) => ({
                    label: `${cur === n ? '✓' : '   '} ${n ?? 'Auto'}`, run: () => { for (const x of group()) {
                        if (n)
                            x.perRow = n;
                        else
                            delete x.perRow;
                    } this.changed(); }
                })) },
        ];
    }
    /** index entries for the blocks inside a reused element */
    indexTree(b) {
        for (const c of b.children ?? []) {
            this.index.set(c.id, { block: c, arr: b.children, parent: b });
            this.indexTree(c);
        }
    }
    renderBlock(b, num) {
        const lvl = b.level ? ` l${b.level}` : '';
        const wrap = h('div', { class: `block b-${b.type}${lvl}`, 'data-id': b.id });
        // a quote's background colour colours only its line on the left
        const quoteLine = b.type === 'quote' && b.color?.endsWith('_bg') ? COLORS[b.color.slice(0, -3)]?.text : undefined;
        if (quoteLine)
            wrap.style.setProperty('--quote-line', quoteLine);
        const bg = b.color?.endsWith('_bg') && b.type !== 'callout' && b.type !== 'quote' && b.type !== 'widget' && !isTileType(b) ? blockColorStyle(b.color) : {};
        Object.assign(wrap.style, bg, bg.background ? { borderRadius: '4px', padding: '2px 4px' } : {});
        if (!this.readonly && b.type !== 'column') {
            const handle = this.handle(b, wrap);
            wrap.appendChild(handle);
            // centre the + and ⋮⋮ on the block's first visible row (text line, toolbar, button …)
            wrap.addEventListener('pointerenter', () => placeHandle(wrap, handle, b.type));
            // right-click a block → block menu (database views have their own menus)
            wrap.addEventListener('contextmenu', (e) => {
                if (e.defaultPrevented || e.target.closest('.dbview'))
                    return;
                const sel = getSelection();
                if (sel && !sel.isCollapsed && wrap.contains(sel.anchorNode))
                    return; // keep the native menu for selected text
                e.preventDefault();
                wrap.classList.add('menu-open');
                this.blockMenu(b, { x: e.clientX, y: e.clientY }, () => { wrap.classList.remove('menu-open'); this.refocusSelection(); });
            });
        }
        switch (b.type) {
            case 'paragraph':
            case 'heading':
            case 'quote':
                wrap.appendChild(this.text(b, b.type === 'paragraph' ? "Type '/' for commands" : b.type === 'heading' ? `Heading ${b.level ?? 1}` : 'Quote'));
                break;
            case 'code': {
                const pre = h('pre', null, this.text(b, 'Code', true));
                wrap.appendChild(pre);
                break;
            }
            case 'bullet':
            case 'numbered':
            case 'todo': {
                if (b.type === 'todo' && b.checked)
                    wrap.classList.add('done');
                const mark = b.type === 'todo'
                    ? h('span', { class: 'todo-box' }, checkbox(!!b.checked, this.readonly ? undefined : (v) => { b.checked = v; wrap.classList.toggle('done', v); this.save(); }, 'Done'))
                    : b.type === 'bullet' ? h('span', { class: 'mark' }, h('span', { class: `bullet d${this.listDepth(b) % 3}` }))
                        : h('span', { class: 'mark num' }, `${numLabel(num, this.listDepth(b))}.`);
                wrap.appendChild(h('div', { class: 'li' }, mark, this.text(b, 'List')));
                if (b.children?.length) {
                    const kids = h('div', { class: 'li-children blocks' });
                    kids.appendChild(this.renderList(b.children, b));
                    wrap.appendChild(kids);
                }
                break;
            }
            case 'divider':
                wrap.appendChild(h('hr'));
                break;
            case 'toc': {
                const box = h('nav', { class: 'toc', 'aria-label': 'Table of contents' });
                this.fillToc(box);
                wrap.appendChild(box);
                break;
            }
            case 'table':
                wrap.appendChild(this.tableBlock(b));
                break;
            case 'toggle': {
                if (!b.open)
                    wrap.classList.add('closed');
                const arrow = h('button', { class: 'toggle-arrow', 'aria-label': 'Expand or collapse', 'aria-expanded': String(!!b.open) }, svgIcon(ICONS.triangle, 12, { fill: true }));
                arrow.addEventListener('click', () => { b.open = !b.open; wrap.classList.toggle('closed', !b.open); arrow.setAttribute('aria-expanded', String(!!b.open)); this.save(); });
                wrap.appendChild(h('div', { class: 'toggle-row' }, arrow, this.text(b, b.level ? 'Toggle heading' : 'Toggle')));
                const body = h('div', { class: 'toggle-body blocks' });
                b.children ??= [];
                if (b.children.length)
                    body.appendChild(this.renderList(b.children, b));
                else if (!this.readonly)
                    body.appendChild(h('div', { class: 'toggle-empty', onclick: () => this.insertInto(b) }, 'Empty toggle. Click to add content.'));
                wrap.appendChild(body);
                break;
            }
            case 'callout': {
                const c = (b.color?.endsWith('_bg') ? b.color.slice(0, -3) : 'default');
                const box = h('div', { class: 'callout', 'data-tint': c, style: { background: BLOCK_BG[c] ?? BLOCK_BG.gray } });
                // the modern look draws callouts as cards tinted with this colour
                tintVars(box, c);
                // a text colour (instead of a background): the callout's text takes it
                {
                    const tc = b.tcolor ?? (b.color && !b.color.endsWith('_bg') ? b.color : undefined);
                    if (tc && tc !== 'default') {
                        box.style.color = COLORS[tc]?.text ?? '';
                        box.classList.add('text-colored');
                    }
                }
                const icon = h('button', { class: 'callout-icon', 'aria-label': 'Change icon', onclick: (e) => !this.readonly && pickIcon(e.currentTarget, b.icon, (v) => { b.icon = v ?? 'i:lightbulb'; this.changed(); }) }, renderIcon(b.icon ?? 'i:lightbulb', 18));
                const inner = h('div', { class: 'blocks' });
                b.children ??= [];
                if (b.children.length)
                    inner.appendChild(this.renderList(b.children, b));
                else if (!this.readonly)
                    inner.appendChild(h('div', { class: 'toggle-empty', onclick: () => this.insertInto(b) }, 'Empty. Click to write.'));
                box.append(icon, inner);
                // content below the first line uses the full width (unless "side" layout)
                if (b.layout !== 'side')
                    box.classList.add('full');
                if (b.collapsible) {
                    box.classList.add('collapsible');
                    if (b.collapsed)
                        box.classList.add('collapsed');
                    const more = (b.children?.length ?? 0) - 1;
                    box.appendChild(h('button', { class: 'callout-fold', 'aria-label': b.collapsed ? 'Expand' : 'Collapse', 'aria-expanded': String(!b.collapsed), title: b.collapsed ? `Expand${more > 0 ? ` (${more} more block${more > 1 ? 's' : ''})` : ''}` : 'Collapse',
                        onclick: (e) => {
                            e.stopPropagation();
                            // fold in place (no redraw, so nothing flickers)
                            if (b.collapsed)
                                delete b.collapsed;
                            else
                                b.collapsed = true;
                            const btn = e.currentTarget;
                            box.classList.toggle('collapsed', !!b.collapsed);
                            btn.setAttribute('aria-expanded', String(!b.collapsed));
                            btn.setAttribute('aria-label', b.collapsed ? 'Expand' : 'Collapse');
                            btn.title = b.collapsed ? 'Expand' : 'Collapse';
                            this.save();
                        } }, svgIcon(ICONS.chevron, 14)));
                }
                wrap.appendChild(box);
                break;
            }
            case 'capture': {
                // a card to write in; "Add" puts what's inside into a database entry (see Capture settings)
                const cfg = captureCfg(b);
                b.children ??= captureStart(b, this.pageTitle());
                if (!b.children.length)
                    b.children = captureStart(b, this.pageTitle());
                const box = h('div', { class: 'capture' + (cfg.name === 'first' ? ' first-name' : '') });
                const inner = h('div', { class: 'blocks' });
                inner.appendChild(this.renderList(b.children, b));
                const db = cfg.db ? this.ctx.ws.dbs.get(cfg.db) : undefined;
                const foot = h('div', { class: 'capture-foot' }, h('span', { class: 'capture-to' + (db ? ' link' : ''), title: db ? `Open ${db.schema.name}` : undefined, onclick: db ? (e) => { e.stopPropagation(); this.ctx.openDb(db.key); } : undefined }, db ? [renderIcon(db.schema.icon, 13, 'database'), h('span', null, db.schema.name)] : 'No database yet'), this.readonly ? null : h('button', { class: 'set-btn primary capture-add', onclick: (e) => { e.stopPropagation(); void runCapture(this.ctx, b, this.pageTitle(), serializePage, () => this.changed()); } }, cfg.label?.trim() || 'Add'));
                if (!this.readonly)
                    box.append(h('button', { class: 'icon-btn capture-more', 'aria-label': 'Capture settings', title: 'Capture settings', onclick: (e) => { e.stopPropagation(); this.openCaptureSettings(b); } }, svgIcon(ICONS.more, 16, { fill: true })));
                box.append(inner, foot);
                wrap.appendChild(box);
                break;
            }
            case 'columns': {
                const row = h('div', { class: 'columns' });
                const cols = b.children ?? [];
                // flexible columns share what's left (grow factors that add up to more than 1, so they always fill the row)
                const total = cols.filter((c) => !c.fixed).reduce((s, c) => s + (c.width ?? 1), 0) || 1;
                cols.forEach((col, i) => {
                    this.index.set(col.id, { block: col, arr: cols, parent: b });
                    const ce = h('div', { class: 'column blocks' + (col.fixed ? ' fixed' : ''), 'data-id': col.id, 'data-phone-first': col.phonefirst ? '1' : undefined, style: { flex: col.fixed ? `0 0 ${col.fixed}px` : `${((col.width ?? 1) / total) * 100} 1 0` } });
                    col.children ??= [];
                    ce.appendChild(this.renderList(col.children, col));
                    if (!this.readonly) {
                        ce.appendChild(h('div', { class: 'add-block', style: { minHeight: '24px' }, onclick: () => this.insertInto(col, true) }));
                        if (i < cols.length - 1)
                            ce.appendChild(this.colResizer(cols, i, row));
                    }
                    row.appendChild(ce);
                });
                wrap.appendChild(row);
                break;
            }
            case 'tabs':
                wrap.appendChild(this.tabsBlock(b));
                break;
            case 'widget':
                wrap.appendChild(mountWidget(b, this.ctx, () => { this.save(); this.syncSubpages(); }, this.readonly));
                break;
            case 'column':
            case 'tab': break;
            case 'image':
                this.media(b, wrap, 'img');
                break;
            case 'pdf':
                this.media(b, wrap, 'pdf');
                break;
            case 'audio':
                this.media(b, wrap, 'audio');
                break;
            case 'video':
                this.media(b, wrap, 'video');
                break;
            case 'file': {
                const name = b.text || (b.src ?? '').split('/').pop() || 'File';
                const card = h('a', { class: 'file-card', href: '#', title: 'Open file', onclick: (e) => { e.preventDefault(); this.openFile(b); } }, h('span', { class: 'fc-chip' }, iconSvg(fileIcon(name), 14)), h('span', { class: 't' }, name), h('span', { class: 'fc-ext' }, (name.split('.').pop() ?? '').toUpperCase()));
                wrap.appendChild(card);
                break;
            }
            case 'embed': {
                const url = b.src ?? '';
                const frame = b.display === 'frame' ? embedUrl(url) : null;
                if (frame) {
                    // shown embedded; the bar above opens the original
                    wrap.appendChild(h('div', { class: 'embed-frame' }, h('a', { class: 'embed-bar', href: url, target: '_blank', rel: 'noopener' }, iconSvg('globe', 13), h('span', null, b.text && b.text !== url ? b.text : siteName(url)), iconSvg('external', 12)), h('iframe', { src: frame, loading: 'lazy', allow: 'autoplay; fullscreen; picture-in-picture; clipboard-write', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms allow-presentation' })));
                }
                else {
                    // bookmark card: title, address, site
                    const title = b.text && b.text !== url ? b.text : url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
                    wrap.appendChild(h('a', { class: 'embed-card bookmark', href: /^https?:/.test(url) ? url : '#', target: '_blank', rel: 'noopener' }, h('span', { class: 'bm-ico' }, iconSvg('globe', 16)), h('span', { class: 'bm-text' }, h('span', { class: 'bm-title' }, title), h('span', { class: 'bm-url' }, siteName(url)))));
                }
                break;
            }
            case 'view':
                wrap.appendChild(renderViewBlock(this.ctx, b, () => this.save()));
                break;
            case 'button': {
                const btn = buttonEl(b, (e) => runButton(b, this.buttonHost(b), e.currentTarget));
                const first = stepsOf(b)[0];
                if (first?.type === 'open' && stepsOf(b).length === 1)
                    this.ctx.linkTo(btn, first.target);
                wrap.appendChild(btn);
                // phone: press and hold the button for its settings (block menu)
                if (!this.readonly && !document.documentElement.classList.contains('phone'))
                    wrap.appendChild(h('button', { class: 'icon-btn nbutton-gear', title: 'Button settings', 'aria-label': 'Button settings', onclick: () => this.openButtonSettings(b) }, iconSvg('settings', 14)));
                break;
            }
            case 'pagelink': {
                const p = b.target ? this.ctx.ws.pages.get(b.target) : undefined;
                const entry = b.target ? resolveRowTarget(this.ctx.ws, b.target) : null;
                const title = entry ? entry.db.rowLabel(entry.row) : p?.title ?? b.text ?? (b.target?.startsWith('row:') ? 'Entry not found' : 'Page');
                const icon = entry?.row.icon ?? p?.icon;
                // a page that lives somewhere else is a link (chip, chevron); a page inside this one is a subpage
                const isLink = !!entry || (!!p && (!this.owner || p.parent !== this.owner));
                const large = isLarge(b);
                const link = h('a', { class: 'pagelink' + (isLink ? ' is-link' : '') + (large ? ' large' : ''), href: b.target ? `nook:${b.target}` : '#', title: isLink ? `Go to “${title}”` : '', onclick: (e) => { e.preventDefault(); if (b.target)
                        this.ctx.openPage(b.target); } }, isLink || large ? h('span', { class: 'pl-chip' }, renderIcon(icon, 14)) : renderIcon(icon, 17), h('span', { class: 't', 'data-name': entry ? `row:${entry.db.key}:${entry.row.id}` : p ? `page:${p.id}` : undefined }, title), isLink ? h('span', { class: 'pl-go' }, svgIcon(ICONS.chevronR, 12)) : null);
                // dragging the page itself (not only its handle) can drop it onto a database view
                if (p)
                    link.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('text/x-nook-page', p.id); if (this.ownerPage)
                        e.dataTransfer?.setData('text/x-nook-from', this.ownerPage); });
                tintStyle(link, b);
                if (b.target)
                    this.ctx.linkTo(link, b.target);
                wrap.appendChild(link);
                break;
            }
        }
        return wrap;
    }
    /** how deep a list item is nested in other list items (0 = top level) */
    listDepth(b) {
        let d = 0;
        for (let loc = this.index.get(b.id); loc?.parent && LIST_TYPES.has(loc.parent.type); loc = this.index.get(loc.parent.id))
            d++;
        return d;
    }
    /** Simple table (as in Notion): editable cells, header row, add / remove rows and columns. */
    tableBlock(b) {
        b.rows ??= [['', ''], ['', '']];
        const rows = b.rows;
        const width = () => Math.max(1, ...rows.map((r) => r.length));
        const box = h('div', { class: 'stable-wrap' });
        const redraw = (focus) => { const nb = this.tableBlock(b); box.replaceWith(nb); this.save(); if (focus)
            nb.querySelector(`[data-rc="${focus[0]},${focus[1]}"]`)?.focus(); };
        const table = h('table', { class: 'stable' + (b.header ? ' has-header' : '') });
        rows.forEach((r, ri) => {
            const tr = h('tr');
            for (let ci = 0; ci < width(); ci++) {
                const cell = h(ri === 0 && b.header ? 'th' : 'td', { class: 'stable-cell', contenteditable: this.readonly ? 'false' : 'true', 'data-rc': `${ri},${ci}`, spellcheck: 'true', html: inlineToHtml(r[ci] ?? '') });
                if (!this.readonly) {
                    cell.addEventListener('input', () => { (rows[ri] ??= [])[ci] = htmlToInline(cell).replace(/\n/g, ' '); this.save(); });
                    cell.addEventListener('keydown', (e) => {
                        // like a spreadsheet: the caret lands at the end of the cell's text
                        const go = (r2, c2, atStart = false) => { e.preventDefault(); const t = box.querySelector(`[data-rc="${r2},${c2}"]`); if (!t)
                            return; t.focus(); const r = document.createRange(); r.selectNodeContents(t); r.collapse(atStart); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); };
                        if (e.key === 'Tab') {
                            if (e.shiftKey) {
                                if (ci > 0)
                                    go(ri, ci - 1);
                                else if (ri > 0)
                                    go(ri - 1, width() - 1);
                                else
                                    e.preventDefault();
                            }
                            else if (ci < width() - 1)
                                go(ri, ci + 1);
                            else if (ri < rows.length - 1)
                                go(ri + 1, 0);
                            else {
                                e.preventDefault();
                                rows.push(Array(width()).fill(''));
                                redraw([rows.length - 1, 0]);
                            }
                        }
                        else if (e.key === 'Enter' && !e.shiftKey) {
                            if (ri < rows.length - 1)
                                go(ri + 1, ci);
                            else {
                                e.preventDefault();
                                rows.push(Array(width()).fill(''));
                                redraw([rows.length - 1, ci]);
                            }
                        }
                        else if (e.key === 'Enter') {
                            if (ri > 0)
                                go(ri - 1, ci);
                            else
                                e.preventDefault();
                        } // ⇧↵: the row above
                        else if (e.key === 'ArrowUp' && ri > 0)
                            go(ri - 1, ci);
                        else if (e.key === 'ArrowDown' && ri < rows.length - 1)
                            go(ri + 1, ci);
                        // ← at the start / → at the end of the text: the cell beside
                        else if (e.key === 'ArrowLeft' && !e.shiftKey && caretAtStart(cell) && !hasSelection()) {
                            if (ci > 0)
                                go(ri, ci - 1);
                            else if (ri > 0)
                                go(ri - 1, width() - 1);
                        }
                        else if (e.key === 'ArrowRight' && !e.shiftKey && caretAtEnd(cell) && !hasSelection()) {
                            if (ci < width() - 1)
                                go(ri, ci + 1, true);
                            else if (ri < rows.length - 1)
                                go(ri + 1, 0, true);
                        }
                    });
                    cell.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const ins = (arr, at, v) => arr.splice(at, 0, v);
                        menu({ x: e.clientX, y: e.clientY }, [
                            { label: 'Insert row above', icon: menuIcon('arrow-up'), run: () => { ins(rows, ri, Array(width()).fill('')); redraw([ri, ci]); } },
                            { label: 'Insert row below', icon: menuIcon('arrow-down'), run: () => { ins(rows, ri + 1, Array(width()).fill('')); redraw([ri + 1, ci]); } },
                            { label: 'Insert column left', icon: menuIcon('arrow-left'), run: () => { rows.forEach((r) => ins(r, ci, '')); delete b.colw; redraw([ri, ci]); } },
                            { label: 'Insert column right', icon: menuIcon('arrow-right'), run: () => { rows.forEach((r) => ins(r, ci + 1, '')); delete b.colw; redraw([ri, ci + 1]); } },
                            'sep',
                            { label: b.header ? 'Normal first row' : 'Header row', icon: menuIcon('heading'), run: () => { b.header = !b.header; redraw([ri, ci]); } },
                            'sep',
                            { label: 'Delete row', icon: menuIcon('trash'), danger: true, run: () => { if (rows.length > 1) {
                                    rows.splice(ri, 1);
                                    redraw([Math.min(ri, rows.length - 1), ci]);
                                } } },
                            { label: 'Delete column', icon: menuIcon('trash'), danger: true, run: () => { if (width() > 1) {
                                    rows.forEach((r) => r.splice(ci, 1));
                                    delete b.colw;
                                    redraw([ri, Math.min(ci, width() - 1)]);
                                } } },
                        ]);
                    });
                }
                tr.appendChild(cell);
            }
            table.appendChild(tr);
        });
        // full width; column widths in percent (drag the line between two header cells)
        const n = width();
        const cw = b.colw?.length === n ? b.colw : Array(n).fill(100 / n);
        const cg = h('colgroup', null, ...cw.map((w) => h('col', { style: { width: `${w}%` } })));
        table.prepend(cg);
        if (!this.readonly) {
            const first = table.querySelector('tr');
            [...(first?.children ?? [])].slice(0, -1).forEach((cell, ci) => {
                const grab = h('span', { class: 'stable-colgrab', title: 'Drag to resize · double-click: equal widths', contenteditable: 'false' });
                grab.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const W = table.getBoundingClientRect().width, x0 = e.clientX;
                    const start = [...cw];
                    const cols = [...cg.children];
                    document.body.classList.add('resizing-cols');
                    const tl = table.getBoundingClientRect().left;
                    const edge0 = tl + (start.slice(0, ci + 1).reduce((x, y) => x + y, 0) / 100) * W;
                    const move = (ev) => {
                        // column lines snap to ¼, ⅓, ½, ⅔ and ¾ of the table
                        const d = ((snapAt(edge0 + ev.clientX - x0, tl, W) - edge0) / W) * 100;
                        const a = Math.max(5, start[ci] + d), bw = Math.max(5, start[ci] + start[ci + 1] - a);
                        cw[ci] = start[ci] + start[ci + 1] - bw;
                        cw[ci + 1] = bw;
                        cols[ci].style.width = `${cw[ci]}%`;
                        cols[ci + 1].style.width = `${cw[ci + 1]}%`;
                    };
                    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('resizing-cols'); b.colw = cw.map((x) => +x.toFixed(1)); this.save(); };
                    document.addEventListener('mousemove', move);
                    document.addEventListener('mouseup', up);
                });
                grab.addEventListener('dblclick', (e) => { e.stopPropagation(); delete b.colw; redraw(); });
                cell.appendChild(grab);
            });
        }
        box.appendChild(h('div', { class: 'stable-scroll' }, table));
        if (!this.readonly) {
            box.appendChild(h('button', { class: 'stable-add-col', title: 'Add a column', 'aria-label': 'Add a column', onclick: () => { rows.forEach((r) => r.push('')); delete b.colw; redraw([0, width() - 1]); } }, svgIcon(ICONS.plus, 13)));
            box.appendChild(h('button', { class: 'stable-add-row', title: 'Add a row', 'aria-label': 'Add a row', onclick: () => { rows.push(Array(width()).fill('')); redraw([rows.length - 1, 0]); } }, svgIcon(ICONS.plus, 13)));
        }
        return box;
    }
    media(b, wrap, kind) {
        const src = b.src ?? '';
        const holder = h('div', { class: `media media-${kind}` });
        wrap.appendChild(holder);
        const show = (url) => {
            holder.appendChild(kind === 'img'
                ? h('img', { src: url, alt: b.text ?? '', loading: 'lazy' })
                : kind === 'audio' ? h('div', { class: 'audio-card' }, h('div', { class: 'audio-name' }, iconSvg('music', 15), b.text || src.split('/').pop() || 'Audio'), h('audio', { src: url, controls: true, preload: 'metadata' }))
                    : kind === 'video' ? h('video', { src: url, controls: true, preload: 'metadata' })
                        : h('iframe', { src: url, class: 'pdf-frame', title: b.text || 'PDF' }));
        };
        // a PDF only shows inline as a PDF: Dropbox's links (and files kept in the browser) come as plain downloads,
        // so it is fetched and handed to the viewer marked as a PDF
        const asPdf = async (url) => {
            try {
                const r = await fetch(url);
                if (!r.ok)
                    throw new Error();
                return URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: 'application/pdf' }));
            }
            catch {
                return url;
            }
        };
        // on the phone a PDF is a card: Open (full screen in the system's viewer) and Save
        if (kind === 'pdf' && document.documentElement.classList.contains('phone') && src) {
            const name = b.text || src.split('/').pop().replace(/\.pdf$/i, '').replace(/^[a-z0-9]{6}-/, '');
            holder.appendChild(pdfCard(name, () => (/^(https?:|data:|blob:)/.test(src) ? Promise.resolve(src) : this.ctx.assetUrl(src))));
            return;
        }
        const go = (url) => (kind === 'pdf' ? asPdf(url).then(show) : show(url));
        if (/^(https?:|data:|blob:)/.test(src))
            void go(src);
        else if (src)
            this.ctx.assetUrl(src).then(go).catch(() => holder.appendChild(h('div', { class: 'muted small' }, `File missing: ${src}`)));
    }
    buttonHost(b) {
        return {
            ctx: this.ctx, pageId: this.ownerPage,
            insert: (blocks, where) => {
                const loc = this.index.get(b.id);
                if (!loc) {
                    this.blocks.push(...blocks);
                    this.changed();
                    return;
                }
                const i = loc.arr.indexOf(b);
                loc.arr.splice(where === 'above' ? i : i + 1, 0, ...blocks);
                this.changed();
            },
        };
    }
    openCaptureSettings(b) { captureSettings(this.ctx, b, () => this.changed()); }
    /** the title of the page this editor shows (for {{page}}) */
    pageTitle() { return this.ownerPage ? this.ctx.ws.pages.get(this.ownerPage)?.title ?? '' : ''; }
    openButtonSettings(b) {
        buttonSettings(this.ctx, b, () => {
            // "Per row" is the same for the whole group of large tiles
            for (const x of this.largeGroup(b)) {
                if (b.perRow)
                    x.perRow = b.perRow;
                else
                    delete x.perRow;
            }
            this.changed();
        }, this.ownerPage, () => this.largeGroup(b).find((x) => x.perRow)?.perRow);
    }
    // ---------- text ----------
    text(b, ph, plain = false) {
        const el = h('div', { class: 'txt', 'data-ph': ph, contenteditable: this.readonly ? 'false' : 'true', spellcheck: 'true' });
        if (plain)
            el.textContent = b.text ?? '';
        else
            el.innerHTML = inlineToHtml(b.text ?? '');
        if (b.color && !b.color.endsWith('_bg'))
            Object.assign(el.style, blockColorStyle(b.color));
        if (b.align)
            el.style.textAlign = b.align;
        if (this.readonly)
            return el;
        el.addEventListener('input', (e) => {
            if (!plain && e.inputType === 'insertText')
                this.autoReplace(el);
            b.text = plain ? el.innerText.replace(/\n$/, '') : htmlToInline(el);
            if (!plain && (b.type === 'paragraph' || LIST_TYPES.has(b.type)) && this.markdownShortcut(b, el))
                return;
            if (!plain && (b.text === '/'))
                this.slashMenu(b, el);
            if (!plain && e.data === '@')
                this.mention(b, el);
            if (b.type === 'heading' || (b.type === 'toggle' && b.level))
                this.refreshTocs();
            this.save();
        });
        el.addEventListener('keydown', (e) => this.onKey(e, b, el, plain));
        el.addEventListener('paste', (e) => {
            const t = e.clipboardData?.getData('text/plain');
            if (t == null)
                return;
            e.preventDefault();
            if (!plain && blockClip && blockClip.text === normClip(t)) {
                void this.insertPasted(t, b.id, b.type === 'paragraph' && !(b.text ?? '').trim());
                return;
            }
            if (t.includes('\n\n') && !plain) {
                this.pasteBlocks(b, el, t);
                return;
            }
            document.execCommand('insertText', false, t);
        });
        return el;
    }
    /** the last typographic replacement, so Backspace right after it brings the typed text back */
    lastReplace = null;
    /** As in Notion: -> becomes →, -- becomes —, (c) becomes © … while typing (not in code). */
    autoReplace(el) {
        const sel = getSelection();
        const node = sel?.anchorNode;
        if (!sel || !sel.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !el.contains(node))
            return;
        if (node.parentElement?.closest('code'))
            return;
        const text = node;
        const off = sel.anchorOffset;
        const before = text.data.slice(0, off);
        for (const [from, to] of autoReplacements(before)) {
            if (!before.endsWith(from))
                continue;
            // "--" at the start of a line may still become a divider (---)
            if (from === '--' && /^-{2,}$/.test(before) && !text.previousSibling)
                return; // "---" becomes a divider
            text.data = before.slice(0, -from.length) + to + text.data.slice(off);
            const at = off - from.length + to.length;
            const r = document.createRange();
            r.setStart(text, at);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            this.lastReplace = { node: text, at, from, to };
            return;
        }
        this.lastReplace = null;
    }
    markdownShortcut(b, el) {
        const t = b.text ?? '';
        const rules = [
            [/^#\s/, { type: 'heading', level: 1 }], [/^##\s/, { type: 'heading', level: 2 }], [/^###\s/, { type: 'heading', level: 3 }],
            [/^[-*]\s/, { type: 'bullet' }], [/^1[.)]\s/, { type: 'numbered' }], [/^\[\]\s|^\[ \]\s/, { type: 'todo', checked: false }],
            [/^>\s/, { type: 'toggle', level: 0, open: true }], [/^"\s/, { type: 'quote' }], [/^```$/, { type: 'code' }],
        ];
        for (const [re, patch] of rules) {
            if (re.test(t)) {
                Object.assign(b, patch);
                b.text = t.replace(re, '');
                if (b.type === 'toggle')
                    b.children = [];
                this.changed({ id: b.id, at: 'start' });
                return true;
            }
        }
        if (t === '---') {
            b.type = 'divider';
            b.text = undefined;
            const n = this.insertAfter(b);
            this.changed({ id: n.id, at: 'start' });
            return true;
        }
        void el;
        return false;
    }
    onKey(e, b, el, plain) {
        const mod = e.metaKey || e.ctrlKey;
        if (e.key === 'Escape' && !document.querySelector('.pop:not(.pop-closing)')) {
            e.preventDefault();
            e.stopPropagation();
            this.select([b.id]);
            return;
        }
        // Backspace right after → / — … gives back what was typed
        const lr = this.lastReplace;
        this.lastReplace = null;
        if (e.key === 'Backspace' && lr && el.contains(lr.node)) {
            const sel = getSelection();
            if (sel?.isCollapsed && sel.anchorNode === lr.node && sel.anchorOffset === lr.at && lr.node.data.slice(lr.at - lr.to.length, lr.at) === lr.to) {
                e.preventDefault();
                lr.node.data = lr.node.data.slice(0, lr.at - lr.to.length) + lr.from + lr.node.data.slice(lr.at);
                const r = document.createRange();
                r.setStart(lr.node, lr.at - lr.to.length + lr.from.length);
                r.collapse(true);
                sel.removeAllRanges();
                sel.addRange(r);
                b.text = htmlToInline(el);
                this.save();
                return;
            }
        }
        // Ctrl/⌘+A: first the text of this block, then (pressed again) every block of the page
        if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
            const sel = getSelection();
            const all = (el.textContent ?? '').length;
            const covered = !all || (sel && !sel.isCollapsed && sel.toString().length >= all);
            if (covered) {
                e.preventDefault();
                this.select(this.topLevel(this.docOrder()));
                return;
            }
            e.preventDefault();
            const r = document.createRange();
            r.selectNodeContents(el);
            sel?.removeAllRanges();
            sel?.addRange(r);
            return;
        }
        if (mod && !plain && formatKey(e))
            return;
        if (e.key === 'Enter' && !e.shiftKey && !(plain && !mod)) {
            e.preventDefault();
            // a web address typed or pasted as plain text becomes a link when the line is done
            if (b.type !== 'code') {
                const sel = getSelection();
                let at = -1;
                if (sel?.rangeCount && el.contains(sel.anchorNode)) {
                    const r = document.createRange();
                    r.selectNodeContents(el);
                    r.setEnd(sel.anchorNode, sel.anchorOffset);
                    at = r.toString().length;
                }
                if (linkifyIn(el)) {
                    b.text = htmlToInline(el);
                    this.save();
                    // the cursor back where it was (the text it sat in was replaced)
                    if (at >= 0 && sel) {
                        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                        let left = at;
                        for (let n = w.nextNode(); n; n = w.nextNode()) {
                            if (left <= n.data.length) {
                                const r = document.createRange();
                                r.setStart(n, left);
                                r.collapse(true);
                                sel.removeAllRanges();
                                sel.addRange(r);
                                break;
                            }
                            left -= n.data.length;
                        }
                    }
                }
            }
            this.split(b, el);
            return;
        }
        if (e.key === 'Backspace' && caretAtStart(el) && !hasSelection()) {
            if (b.type !== 'paragraph' && b.type !== 'code') {
                e.preventDefault();
                const wasList = LIST_TYPES.has(b.type);
                b.type = 'paragraph';
                delete b.level;
                delete b.checked;
                if (!wasList && b.children?.length) {
                    const loc = this.index.get(b.id);
                    loc.arr.splice(loc.arr.indexOf(b) + 1, 0, ...b.children);
                    delete b.children;
                }
                this.changed({ id: b.id, at: 'start' });
                return;
            }
            e.preventDefault();
            this.mergeUp(b);
            return;
        }
        if (e.key === 'Tab' && LIST_TYPES.has(b.type) || (e.key === 'Tab' && b.type === 'paragraph')) {
            e.preventDefault();
            if (e.shiftKey)
                this.outdent(b);
            else
                this.indent(b);
            return;
        }
        if (e.key === 'ArrowUp' && caretOnFirstLine(el)) {
            const p = this.neighbourText(b, -1);
            if (p) {
                e.preventDefault();
                this.focus(p.id, 'end');
            }
            else if (this.onTitle && this.isFirstLine(b)) {
                e.preventDefault();
                this.onTitle();
            }
        }
        if (e.key === 'ArrowDown' && caretOnLastLine(el)) {
            const n = this.neighbourText(b, 1);
            if (n) {
                e.preventDefault();
                this.focus(n.id, 'start');
            }
        }
        if (e.key === 'Escape')
            el.blur();
    }
    split(b, el) {
        const loc = this.index.get(b.id);
        if (!loc)
            return;
        // empty list item → leave the list
        if (LIST_TYPES.has(b.type) && !(b.text ?? '').trim()) {
            if (loc.parent && LIST_TYPES.has(loc.parent.type)) {
                this.outdent(b);
                return;
            }
            b.type = 'paragraph';
            delete b.checked;
            this.changed({ id: b.id, at: 'start' });
            return;
        }
        // toggle title: new first child
        if (b.type === 'toggle' && caretAtEnd(el)) {
            b.open = true;
            b.children ??= [];
            const nb = { id: ulid(), type: 'paragraph', text: '' };
            b.children.unshift(nb);
            this.changed({ id: nb.id, at: 'start' });
            return;
        }
        let after = '';
        const sel = getSelection();
        if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
            const r = sel.getRangeAt(0).cloneRange();
            r.deleteContents();
            const tail = document.createRange();
            tail.setStart(r.endContainer, r.endOffset);
            tail.setEnd(el, el.childNodes.length);
            const frag = tail.extractContents();
            const tmp = h('div');
            tmp.appendChild(frag);
            after = b.type === 'code' ? tmp.innerText : htmlToInline(tmp);
            b.text = b.type === 'code' ? el.innerText : htmlToInline(el);
        }
        const keepType = LIST_TYPES.has(b.type) ? b.type : 'paragraph';
        const nb = { id: ulid(), type: keepType, text: after };
        if (keepType === 'todo')
            nb.checked = false;
        if (LIST_TYPES.has(b.type) && b.children?.length) {
            nb.children = b.children;
            delete b.children;
        }
        loc.arr.splice(loc.arr.indexOf(b) + 1, 0, nb);
        this.changed({ id: nb.id, at: 'start' });
    }
    /** set by the page: puts the caret at the end of the page title (Backspace / ↑ on the first line) */
    onTitle;
    isFirstLine(b) { const loc = this.index.get(b.id); return !!loc && !loc.parent && this.blocks[0] === b; }
    mergeUp(b) {
        const prev = this.neighbourText(b, -1);
        const loc = this.index.get(b.id);
        if (!prev && this.onTitle && this.isFirstLine(b)) {
            // the first line of a page: an empty one goes away (unless it is the only one), the caret goes to the title
            if (!plainText(b.text ?? '').trim() && !b.children?.length && this.blocks.length > 1) {
                loc.arr.splice(loc.arr.indexOf(b), 1);
                this.changed();
            }
            this.onTitle();
            return;
        }
        if (!prev) {
            if (!(b.text ?? '') && this.blocks.length > 1) {
                loc.arr.splice(loc.arr.indexOf(b), 1);
                this.changed();
            }
            return;
        }
        const pos = plainText(prev.text ?? '').length;
        if (prev.type !== 'divider')
            prev.text = (prev.text ?? '') + (b.text ?? '');
        loc.arr.splice(loc.arr.indexOf(b), 1);
        if (b.children?.length)
            (prev.children ??= []).push(...b.children);
        this.changed({ id: prev.id, at: pos });
    }
    indent(b) {
        const loc = this.index.get(b.id);
        const i = loc.arr.indexOf(b);
        const prev = loc.arr[i - 1];
        if (!prev || !(LIST_TYPES.has(prev.type) || prev.type === 'toggle'))
            return;
        loc.arr.splice(i, 1);
        (prev.children ??= []).push(b);
        if (prev.type === 'toggle')
            prev.open = true;
        this.changed({ id: b.id, at: 'end' });
    }
    outdent(b) {
        const loc = this.index.get(b.id);
        const parent = loc.parent;
        if (!parent || !(LIST_TYPES.has(parent.type) || parent.type === 'toggle'))
            return;
        const ploc = this.index.get(parent.id);
        const i = loc.arr.indexOf(b);
        const tail = loc.arr.splice(i);
        tail.shift();
        if (tail.length)
            (b.children ??= []).push(...tail);
        ploc.arr.splice(ploc.arr.indexOf(parent) + 1, 0, b);
        this.changed({ id: b.id, at: 'end' });
    }
    pasteBlocks(b, _el, text) {
        import('../format/page.js').then(({ parsePage }) => {
            const parsed = parsePage(text);
            const loc = this.index.get(b.id);
            const i = loc.arr.indexOf(b);
            if (!(b.text ?? '').trim())
                loc.arr.splice(i, 1, ...parsed);
            else
                loc.arr.splice(i + 1, 0, ...parsed);
            const last = parsed[parsed.length - 1];
            this.changed(last ? { id: last.id, at: 'end' } : undefined);
        });
    }
    /** Previous/next block that has editable text, in reading order. */
    neighbourText(b, dir) {
        const ids = [...this.el.querySelectorAll('.block')].filter((x) => x.querySelector(':scope > .txt, :scope > .li > .txt, :scope > .toggle-row > .txt, :scope > pre > .txt'));
        const i = ids.findIndex((x) => x.dataset.id === b.id);
        const n = ids[i + dir];
        return n ? this.index.get(n.dataset.id)?.block ?? null : null;
    }
    focus(id, at) {
        const wrap = this.el.querySelector(`.block[data-id="${id}"]`);
        const el = wrap?.querySelector('.txt');
        if (!el)
            return;
        el.focus();
        placeCaret(el, at);
    }
    // ---------- structure helpers ----------
    changed(focus) {
        this.render(focus);
        this.save();
        this.syncSubpages();
    }
    /** pages linked from these blocks (to notice when a subpage's link block is deleted) */
    linked = null;
    /** pages listed in page preview blocks (a subpage can live there instead of in its own block) */
    inPreview = new Set();
    linkedNow(pv) {
        const out = new Set();
        if (!pv) {
            pv = new Set();
            this.inPreview = pv;
        }
        const walk = (arr) => {
            for (const b of arr) {
                if (b.type === 'pagelink' && b.target)
                    out.add(b.target);
                if (b.type === 'widget' && b.kind === 'preview')
                    for (const id of (Array.isArray(b.data?.pages) ? b.data.pages : [])) {
                        out.add(id);
                        pv?.add(id);
                    }
                if (b.children)
                    walk(b.children);
            }
        };
        walk(this.blocks);
        return out;
    }
    /** As in Notion: deleting the block of a subpage deletes the subpage (undo brings both back). */
    syncSubpages() {
        if (!this.ownerPage || this.readonly)
            return;
        const pv = new Set();
        const now = this.linkedNow(pv);
        const before = this.linked, pvBefore = this.inPreview;
        this.linked = now;
        this.inPreview = pv;
        if (!before)
            return;
        const ws = this.ctx.ws;
        const all = [...before].filter((id) => !now.has(id) && ws.pages.get(id)?.parent === this.ownerPage && !ws.holdSubpages.has(id));
        // subpages that only lived in a page preview: ask whether to keep them (as subpage blocks at the end) or delete them
        const asked = all.filter((id) => pvBefore.has(id));
        const gone = all.filter((id) => !pvBefore.has(id));
        if (asked.length) {
            const names = asked.map((id) => `“${ws.pages.get(id).title || 'Untitled'}”`);
            let decided = false;
            const keep = () => { if (decided)
                return; decided = true; for (const id of asked)
                this.blocks.push({ id: ulid(), type: 'pagelink', text: '', target: id }); this.changed(); };
            confirmDialog({ title: asked.length === 1 ? `Delete the subpage ${names[0]} too?` : `Delete ${asked.length} subpages too?`,
                lines: [asked.length === 1 ? 'It was shown in the preview. Keep it and it goes to the end of this page.' : `${names.join(', ')} were shown in the page preview. Keep them and they go to the end of this page.`],
                ok: asked.length === 1 ? 'Delete page' : 'Delete pages', cancel: asked.length === 1 ? 'Keep page' : 'Keep pages', danger: true,
                onCancel: keep,
                onOk: async () => { if (decided)
                    return; decided = true; for (const id of asked) {
                    const p = ws.pages.get(id);
                    if (p)
                        await ws.deletePage(p);
                } this.ctx.refreshSidebar?.(); toast(`Deleted ${asked.length === 1 ? names[0] : asked.length + ' subpages'} · ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Z to undo`); } });
        }
        if (!gone.length)
            return;
        const what = gone.length === 1 ? `subpage “${ws.pages.get(gone[0]).title}”` : `${gone.length} subpages`;
        (async () => {
            for (const id of gone) {
                const p = ws.pages.get(id);
                if (p)
                    await ws.deletePage(p);
            }
            this.ctx.refreshSidebar?.();
            toast(`Deleted ${what} · ${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}Z to undo`);
        })();
    }
    insertAfter(b, nb = { id: ulid(), type: 'paragraph', text: '' }) {
        const loc = this.index.get(b.id);
        loc.arr.splice(loc.arr.indexOf(b) + 1, 0, nb);
        return nb;
    }
    insertInto(container, end = false) {
        container.children ??= [];
        // clicking below the last line again doesn't stack up empty lines: an empty last line is reused
        const edge = end ? container.children[container.children.length - 1] : container.children[0];
        if (edge && edge.type === 'paragraph' && !edge.text) {
            this.focus(edge.id, end ? 'end' : 'start');
            return;
        }
        const nb = { id: ulid(), type: 'paragraph', text: '' };
        if (end)
            container.children.push(nb);
        else
            container.children.unshift(nb);
        this.changed({ id: nb.id, at: 'start' });
    }
    remove(b) {
        const loc = this.index.get(b.id);
        if (!loc)
            return;
        loc.arr.splice(loc.arr.indexOf(b), 1);
        // a column without blocks disappears; columns with one column left unwrap
        if (loc.parent?.type === 'column' && !loc.arr.length)
            this.removeColumn(loc.parent);
        if (loc.parent?.type === 'tab' && !loc.arr.length)
            loc.arr.push({ id: ulid(), type: 'paragraph', text: '' });
        this.changed();
    }
    removeColumn(col) {
        const loc = this.index.get(col.id);
        if (!loc || !loc.parent)
            return;
        loc.arr.splice(loc.arr.indexOf(col), 1);
        if (loc.arr.length === 1) {
            const cols = loc.parent;
            const cloc = this.index.get(cols.id);
            cloc.arr.splice(cloc.arr.indexOf(cols), 1, ...(loc.arr[0].children ?? []));
        }
    }
    turnInto(b, t) {
        const fromContainer = b.type === 'callout' || b.type === 'toggle';
        if (t.type === 'callout' && b.type !== 'callout') {
            const inner = { id: ulid(), type: 'paragraph', text: b.text ?? '' };
            b.children = [inner, ...(b.children ?? [])];
            b.text = undefined;
            b.icon ??= 'i:lightbulb';
            b.color = 'gray_bg';
        }
        else if (fromContainer && t.type !== 'toggle' && t.type !== 'callout') {
            const first = b.type === 'callout' ? b.children?.shift() : null;
            if (first)
                b.text = first.text;
            const kids = b.children ?? [];
            delete b.children;
            const loc = this.index.get(b.id);
            loc.arr.splice(loc.arr.indexOf(b) + 1, 0, ...kids);
        }
        b.type = t.type;
        if (t.level !== undefined)
            b.level = t.level;
        else
            delete b.level;
        if (b.type === 'toggle') {
            b.children ??= [];
            b.open ??= true;
        }
        if (b.type === 'todo')
            b.checked ??= false;
        const inner = b.type === 'callout' ? b.children?.[0] : undefined;
        this.changed(TEXT_TYPES.has(b.type) ? { id: b.id, at: 'end' } : inner ? { id: inner.id, at: 'end' } : undefined);
    }
    // ---------- menus ----------
    handle(b, wrap) {
        const plus = h('button', { 'aria-label': 'Add block below', title: 'Add block below' }, svgIcon(ICONS.plus, 16));
        plus.addEventListener('click', () => {
            const nb = this.insertAfter(b);
            this.changed({ id: nb.id, at: 'start' });
            const el = this.el.querySelector(`.block[data-id="${nb.id}"] .txt`);
            if (el)
                this.slashMenu(nb, el, true);
        });
        const grip = h('button', { class: 'grip', draggable: true, 'aria-label': 'Drag to move, click for menu', title: 'Drag to move\nClick or right-click for menu' }, svgIcon(ICONS.grip, 16, { fill: true }));
        grip.addEventListener('click', (e) => {
            // ⇧-click: select a range of blocks · ⌘/Ctrl-click: add or remove this block
            if (e.shiftKey && this.anchor) {
                this.select(this.range(this.anchor, b.id), false);
                return;
            }
            if (e.metaKey || e.ctrlKey) {
                const next = new Set(this.selected);
                if (next.has(b.id))
                    next.delete(b.id);
                else
                    next.add(b.id);
                this.select([...next], false);
                if (!this.anchor)
                    this.anchor = b.id;
                return;
            }
            if (!this.selected.has(b.id))
                this.select([b.id]);
            wrap.classList.add('menu-open');
            this.blockMenu(b, grip, () => { wrap.classList.remove('menu-open'); this.refocusSelection(); });
        });
        grip.addEventListener('dragstart', (e) => {
            const ids = this.selected.has(b.id) && this.selected.size > 1 ? this.topLevel([...this.selected]) : [b.id];
            if (!this.selected.has(b.id))
                this.select([]);
            this.dragIds = ids;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/x-nook-block', ids.join(','));
            // a page link / subpage block can also be dropped onto a database view (it becomes an entry)
            if (ids.length === 1 && b.type === 'pagelink' && b.target && this.ctx.ws.pages.has(b.target)) {
                e.dataTransfer.setData('text/x-nook-page', b.target);
                if (this.ownerPage)
                    e.dataTransfer.setData('text/x-nook-from', this.ownerPage);
            }
            if (ids.length > 1) {
                const ghost = h('div', { class: 'drag-ghost' }, `${ids.length} blocks`);
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 10, 10);
                setTimeout(() => ghost.remove());
            }
            else
                e.dataTransfer.setDragImage(wrap, 10, 10);
            requestAnimationFrame(() => ids.forEach((id) => this.el.querySelector(`.block[data-id="${id}"]`)?.classList.add('dragging')));
        });
        grip.addEventListener('dragend', () => { this.el.querySelectorAll('.block.dragging').forEach((x) => x.classList.remove('dragging')); this.dragIds = []; this.clearDrop(); });
        return h('div', { class: 'handle' }, plus, grip);
    }
    blockMenu(b, anchor, onClose) {
        // several blocks selected: the menu acts on all of them
        const many = this.selected.size > 1 && this.selected.has(b.id) ? this.topLevel([...this.selected]) : null;
        if (many) {
            const all = many.map((id) => this.index.get(id).block);
            const k = many.length;
            menu(anchor, [
                { section: 'Edit' },
                { label: 'Turn into', icon: menuIcon('refresh'), sub: () => TURN_INTO.filter((t) => t.type !== 'callout').map((t) => ({ label: t.label, icon: turnIcon(t), run: () => { for (const x of all)
                            if (TEXT_TYPES.has(x.type)) {
                                x.type = t.type;
                                if (t.level !== undefined)
                                    x.level = t.level;
                                else
                                    delete x.level;
                                if (x.type === 'toggle') {
                                    x.children ??= [];
                                    x.open ??= true;
                                }
                                if (x.type === 'todo')
                                    x.checked ??= false;
                            } this.changed(); } })) },
                { label: 'Color', icon: menuIcon('palette'), sub: () => [
                        ...Object.keys(COLORS).map((c) => ({ label: c === 'default' ? 'Default text' : `${colorLabel(c)} text`, run: () => { for (const x of all)
                                x.color = c === 'default' ? undefined : c; this.changed(); } })),
                        'sep',
                        ...Object.keys(BLOCK_BG).map((c) => ({ label: c === 'default' ? 'Default background' : `${colorLabel(c)} background`, run: () => { for (const x of all)
                                x.color = c === 'default' ? undefined : `${c}_bg`; this.changed(); } })),
                    ] },
                { label: 'Put in columns', icon: menuIcon('columns'), sub: () => [
                        ...(k <= 5 ? [{ label: `${k} columns`, run: () => this.putInColumns(many, k) }] : []),
                        ...[2, 3].filter((n) => n !== k && n < k).map((n) => ({ label: `${n} columns`, run: () => this.putInColumns(many, n) })),
                    ] },
                { section: 'Arrange' },
                { label: 'Duplicate', icon: menuIcon('layers'), hint: '⌘D', run: () => this.duplicateMany(many) },
                'sep',
                { label: `Delete ${k} blocks`, icon: menuIcon('trash'), danger: true, hint: 'Del', run: () => this.confirmFiles(many, () => this.removeMany(many)) },
            ], { title: `${k} blocks`, onDelete: () => this.confirmFiles(many, () => this.removeMany(many)), onDuplicate: () => this.duplicateMany(many), onCopy: () => this.copySelection(many, false), onCut: this.readonly ? undefined : () => this.copySelection(many, true) });
            if (onClose)
                setTimeout(() => { const pop = document.querySelector('.pop:not(.pop-closing)'); if (!pop)
                    onClose();
                else
                    new MutationObserver((_, o) => { if (!document.body.contains(pop)) {
                        o.disconnect();
                        onClose();
                    } }).observe(document.body, { childList: true }); });
            return;
        }
        // the colour in use is ticked; a callout has one tint (grey unless chosen), set from either list
        const tick = (on) => on ? '✓' : undefined;
        // callouts: a text colour and a background, each on its own (Default background = no tint)
        const isCallout = b.type === 'callout';
        const textOf = () => b.tcolor ?? (b.color && !b.color.endsWith('_bg') ? b.color : undefined);
        const colors = [{ section: 'Text color' },
            ...Object.keys(COLORS).map((c) => ({ label: c === 'default' ? 'Default text' : colorLabel(c), icon: h('span', { class: 'swatch', style: { background: 'transparent', color: COLORS[c].text, textAlign: 'center', lineHeight: '18px' } }, 'A'), hint: tick(isCallout ? (c === 'default' ? !textOf() : textOf() === c) : c === 'default' ? !b.color || b.color.endsWith('_bg') : b.color === c), run: () => {
                    // a callout keeps its background and its text colour apart; other blocks have one or the other
                    if (isCallout) {
                        if (b.color && !b.color.endsWith('_bg'))
                            delete b.color;
                        if (c === 'default')
                            delete b.tcolor;
                        else
                            b.tcolor = c;
                    }
                    else
                        b.color = c === 'default' ? undefined : c;
                    this.changed();
                } })),
            { section: 'Background' },
            ...Object.keys(BLOCK_BG).map((c) => ({ label: c === 'default' ? 'Default background' : `${colorLabel(c)} background`, icon: h('span', { class: 'swatch', style: { background: BLOCK_BG[c] } }), hint: tick(c === 'default' ? !b.color?.endsWith('_bg') : b.color === `${c}_bg`), run: () => {
                    if (isCallout && b.color && !b.color.endsWith('_bg')) {
                        b.tcolor ??= b.color;
                    }
                    b.color = c === 'default' ? undefined : `${c}_bg`;
                    this.changed();
                } })),
        ];
        const entries = [
            // page links and buttons can't become text (a subpage would be lost)
            ...(isTileType(b) ? [] : [{ label: 'Turn into', icon: menuIcon('refresh'), sub: () => TURN_INTO.map((t) => ({ label: t.label, icon: turnIcon(t), run: () => this.turnInto(b, t) })) }]),
            // buttons and page links are coloured like in Button settings (fill or outline), not given a background
            { label: 'Color', icon: menuIcon('palette'), sub: () => isTileType(b) ? tintMenuEntries(b, (c, st) => { if (c)
                    b.color = c.replace(/_bg$/, '');
                else
                    delete b.color; if (st)
                    b.colorStyle = st;
                else
                    delete b.colorStyle; this.changed(); }) : colors },
            'sep',
            { label: 'Add above', icon: menuIcon('arrow-up-bold'), run: () => {
                    const loc = this.index.get(b.id);
                    if (!loc)
                        return;
                    const nb = { id: ulid(), type: 'paragraph', text: '' };
                    loc.arr.splice(loc.arr.indexOf(b), 0, nb);
                    this.changed({ id: nb.id, at: 'start' });
                } },
            { label: 'Add below', icon: menuIcon('arrow-down-bold'), run: () => { const nb = this.insertAfter(b); this.changed({ id: nb.id, at: 'start' }); } },
            'sep',
            { label: 'Duplicate', icon: menuIcon('layers'), run: () => { const copy = cloneBlock(b); this.insertAfter(b, copy); this.changed(); } },
            { label: 'Move up', icon: menuIcon('arrow-up'), run: () => this.move(b, -1) },
            { label: 'Move down', icon: menuIcon('arrow-down'), run: () => this.move(b, 1) },
        ];
        const baseLen = entries.length;
        // side by side with the blocks that follow it
        const loc = this.index.get(b.id);
        // buttons and page links use "Per row" instead of columns
        if (loc && b.type !== 'columns' && loc.parent?.type !== 'column' && !isTileType(b)) {
            const after = loc.arr.slice(loc.arr.indexOf(b) + 1);
            entries.push({ label: 'Put in columns', icon: menuIcon('columns'), sub: () => [2, 3].map((n) => ({
                    label: `${n} columns`,
                    run: () => { const ids = [b.id, ...after.slice(0, n - 1).map((x) => x.id)]; if (ids.length >= n)
                        this.putInColumns(ids, n);
                    else
                        this.addEmptyColumns(b.id, n - 1); },
                })) });
        }
        if (b.type === 'columns')
            entries.push({ label: 'Remove columns', icon: menuIcon('align-left'), run: () => this.unwrapColumns(b) });
        if (b.type === 'columns')
            entries.push({ label: 'Add column', run: () => { (b.children ??= []).push({ id: ulid(), type: 'column', children: [{ id: ulid(), type: 'paragraph', text: '' }] }); this.changed(); } });
        if (b.type === 'view')
            entries.push({ label: 'Choose view', hint: '›', subFilter: true, sub: () => this.viewChoices(b) });
        if (b.type === 'button')
            entries.push({ label: 'Button settings…', icon: menuIcon('settings'), run: () => this.openButtonSettings(b) });
        // quick buttons: the phone's ＋ in the tab bar lists them (and the desktop sidebar)
        if (b.type === 'button' && this.owner) {
            const st = this.ctx.ws.settings, owner = this.owner;
            const on = (st.quickButtons ?? []).some((q) => q.block === b.id);
            entries.push({ label: on ? 'Remove from quick buttons' : 'Add to quick buttons', icon: menuIcon('zap'), run: () => {
                    st.quickButtons = on ? (st.quickButtons ?? []).filter((q) => q.block !== b.id) : [...(st.quickButtons ?? []), { page: owner, block: b.id, label: b.text ?? '' }];
                    void this.ctx.ws.saveSettings();
                    this.ctx.refresh?.();
                    toast(on ? 'Removed from quick buttons' : 'Added to quick buttons – tap ＋ in the bottom bar');
                } });
        }
        if (b.type === 'capture')
            entries.push({ label: 'Capture settings…', icon: menuIcon('settings'), run: () => this.openCaptureSettings(b) });
        // a widget: its settings window
        if (b.type === 'widget') {
            const def = widgetDef(b.kind ?? '');
            const el = this.el.querySelector(`.block[data-id="${b.id}"] .widget-more`);
            if (def && el)
                entries.push({ label: `${def.name} settings`, icon: menuIcon('sliders'), run: () => el.click() });
        }
        // a subpage: its content takes the place of its block (the page itself goes to the trash)
        if (b.type === 'pagelink' && b.target && this.ownerPage) {
            const ws = this.ctx.ws, p = ws.pages.get(b.target), here = this.ownerPage;
            if (p && p.parent === here)
                entries.push({ label: 'Decompose', icon: menuIcon('layers'), run: async () => {
                        const loc = this.index.get(b.id);
                        if (!loc)
                            return;
                        ws.boundary();
                        const content = p.blocks.filter((x) => !(x.type === 'paragraph' && !x.text && !x.children?.length && p.blocks.length === 1));
                        loc.arr.splice(loc.arr.indexOf(b), 1, ...content);
                        // its own subpages now live here
                        for (const c of [...ws.pages.values()])
                            if (c.parent === p.id) {
                                c.parent = here;
                                await ws.savePage(c);
                            }
                        ws.holdSubpages.add(p.id);
                        await ws.deletePage(p);
                        ws.holdSubpages.delete(p.id);
                        this.linked = this.linkedNow();
                        this.changed(content[0] ? { id: content[0].id, at: 'start' } : undefined);
                        this.ctx.refresh();
                        toast(`“${p.title || 'Untitled'}” decomposed · ${prettyKey('Mod+Z')} to undo`);
                    } });
        }
        // a link to a page from elsewhere: make it a subpage of this page; where it was, a link to it stays
        if (b.type === 'pagelink' && b.target && this.ownerPage) {
            const ws = this.ctx.ws, p = ws.pages.get(b.target), here = this.ownerPage;
            if (p && p.parent !== here && p.id !== here && !isDescendantPage(ws, here, p.id))
                entries.push({ label: 'Turn into subpage', icon: menuIcon('file-plus'), run: async () => {
                        ws.boundary();
                        const old = p.parent;
                        await ws.linkSubpage(old, p.id);
                        p.parent = here;
                        p.order = [...ws.pages.values()].filter((x) => x.parent === here && x !== p).length;
                        await ws.savePage(p);
                        this.linked = this.linkedNow();
                        this.built = new WeakMap();
                        this.render();
                        this.changed();
                        this.ctx.refresh();
                        toast(`“${p.title || 'Untitled'}” is now a subpage here${old ? ' – a link stays where it was' : ''}`);
                    } });
        }
        if (b.type === 'button' || b.type === 'pagelink')
            entries.push(...this.sizeEntries(b));
        if (b.type === 'callout')
            entries.push({ label: 'Foldable', icon: menuIcon('chevrons-right'), toggle: !!b.collapsible, onToggle: (on) => { if (on)
                    b.collapsible = true;
                else {
                    delete b.collapsible;
                    delete b.collapsed;
                } this.changed(); } }, { label: 'Text', icon: menuIcon('align-left'), seg: { options: [['full', 'Full width'], ['side', 'Beside icon']], value: b.layout === 'side' ? 'side' : 'full', pick: (v) => { if (v === 'side')
                        b.layout = 'side';
                    else
                        delete b.layout; this.changed(); } } });
        if (b.type === 'embed' && embedUrl(b.src ?? ''))
            entries.push(b.display === 'frame'
                ? { label: 'Show as bookmark', icon: menuIcon('bookmark'), run: () => { delete b.display; this.changed(); } }
                : { label: 'Show embedded', icon: menuIcon('monitor'), run: () => { b.display = 'frame'; this.changed(); } });
        if (['image', 'pdf', 'embed', 'audio', 'video', 'file'].includes(b.type))
            entries.push(...(['image', 'pdf', 'audio', 'video'].includes(b.type) ? [{ label: 'Show as file', icon: menuIcon('paperclip'), run: () => { b.type = 'file'; this.changed(); } }] : b.type === 'file' && /\.(png|jpe?g|gif|webp|svg|pdf|mp3|m4a|wav|aac|ogg|mp4|mov|webm)$/i.test(b.src ?? '') ? [{ label: 'Show inline', icon: menuIcon('image'), run: () => { const n = (b.src ?? '').toLowerCase(); b.type = /\.pdf$/.test(n) ? 'pdf' : /\.(mp3|m4a|wav|aac|ogg)$/.test(n) ? 'audio' : /\.(mp4|mov|webm)$/.test(n) ? 'video' : 'image'; this.changed(); } }] : []), ...(assetOf(b) ? [
                { label: 'Download', icon: menuIcon('download'), run: () => this.openFile(b, true) },
                ...((b.type === 'image' || b.type === 'video' || (b.type === 'file' && /\.(jpe?g|png|heic|heif|webp|mov|mp4|m4v)$/i.test(b.src ?? ''))) && !/\.gif$/i.test(b.src ?? '') ? [{ label: 'Compress', icon: menuIcon('minimize'), run: () => void this.compressBlock(b) }] : []),
                ...(this.ctx.ws.storage.reveal ? [{ label: /Mac/i.test(navigator.platform) ? 'Show in Finder' : 'Show in folder', icon: menuIcon('folder'), run: () => {
                            this.ctx.ws.storage.reveal(assetOf(b)).catch((e) => toast(e.message.startsWith('Restart') ? e.message : `Could not show the file: ${e.message}`, 5000));
                        } }] : []),
            ] : [{ label: 'Change link', run: () => prompt(anchor, 'URL', b.src ?? '', (v) => { b.src = v; this.changed(); }) }]));
        // one order in every menu: edit · this block's own settings · arrange · delete
        const named = (l) => entries.find((e) => typeof e === 'object' && 'label' in e && e.label === l);
        const extras = entries.slice(baseLen);
        const arrangeL = new Set(['Put in columns', 'Remove columns', 'Add column']);
        const blockOwn = extras.filter((e) => !arrangeL.has(e.label));
        const dup = named('Duplicate');
        dup.hint = '⌘D';
        const ordered = [
            { section: 'Edit' }, ...[named('Turn into'), named('Color')].filter((x) => !!x),
            ...(blockOwn.length ? [{ section: 'Block' }, ...blockOwn] : []),
            { section: 'Arrange' }, named('Move up'), named('Move down'), named('Add above'), named('Add below'), ...extras.filter((e) => arrangeL.has(e.label)), dup,
            'sep', { label: 'Delete', icon: menuIcon('trash'), hint: 'Del', danger: true, run: () => this.confirmFiles([b.id], () => this.remove(b)) },
        ];
        menu(anchor, ordered, { onDelete: () => this.confirmFiles([b.id], () => this.remove(b)), onDuplicate: () => this.duplicateMany([b.id]), onCopy: () => this.copySelection([b.id], false), onCut: this.readonly ? undefined : () => this.copySelection([b.id], true) });
        if (onClose)
            setTimeout(() => { const pop = document.querySelector('.pop:not(.pop-closing)'); if (!pop)
                onClose();
            else
                new MutationObserver((_, o) => { if (!document.body.contains(pop)) {
                    o.disconnect();
                    onClose();
                } }).observe(document.body, { childList: true }); });
    }
    /** "Choose view": every view of every database, searchable by database and view name */
    viewChoices(b) {
        const dbs = [...this.ctx.ws.dbs.values()].sort((x, y) => x.schema.name.localeCompare(y.schema.name));
        return dbs.flatMap((db) => db.views.map((v) => ({
            label: db.views.length > 1 ? `${db.schema.name} · ${v.name}` : db.schema.name, icon: renderIcon(db.schema.icon, 16, 'database'),
            hint: b.db === db.key && (b.view ?? db.views[0]?.id) === v.id ? '✓' : undefined,
            run: () => { b.db = db.key; b.view = v.id; this.changed(); },
        })));
    }
    /** "/" → Database view: the databases (always the current list), searchable; or a new one */
    dbChoices(b, anchor, done, type) {
        const ws = this.ctx.ws;
        /** the database's view of that type (made when it has none) */
        const viewOf = (key) => {
            const d = ws.dbs.get(key);
            if (!d)
                return undefined;
            if (!type)
                return d.views[0]?.id;
            let v = d.views.find((x) => x.type === type);
            if (!v) {
                v = newView(d, type);
                d.views.push(v);
                void ws.saveViews(d);
            }
            return v.id;
        };
        const dbs = [...ws.dbs.values()].sort((x, y) => x.schema.name.localeCompare(y.schema.name));
        return [
            { label: 'Create new database…', icon: menuIcon('plus'), create: async (name) => {
                    // typed in the search: a database with that name, no second question
                    const db = await ws.createDatabase(name || 'Untitled', this.owner ? ws.pages.get(this.owner) : undefined);
                    done();
                    Object.assign(b, { type: 'view', text: undefined, db: db.key, view: viewOf(db.key) });
                    this.changed();
                    this.ctx.refreshSidebar?.();
                }, run: () => prompt(anchor, 'Name of the new database', '', async (name) => {
                    const db = await ws.createDatabase(name.trim() || 'Untitled', this.owner ? ws.pages.get(this.owner) : undefined);
                    done();
                    Object.assign(b, { type: 'view', text: undefined, db: db.key, view: viewOf(db.key) });
                    this.changed();
                    this.ctx.refreshSidebar?.();
                }) },
            ...(dbs.length ? ['sep'] : []),
            ...pickEntries(dbItems(ws), (k) => { done(); Object.assign(b, { type: 'view', text: undefined, db: k, view: viewOf(k) }); this.changed(); }),
        ];
    }
    // ---------- phone: long press for the menu and to drag ----------
    touchTools() {
        const blockOf = (t) => {
            const el = t?.closest?.('.block');
            const id = el?.dataset.id;
            return id && this.el.contains(el) ? { el, b: this.index.get(id)?.block } : null;
        };
        // B: hold a block → it lifts and its menu opens; moving the finger instead drags it
        let timer;
        let start = null;
        let dragging = false;
        let target = null;
        const end = () => { clearTimeout(timer); document.documentElement.classList.remove('touch-dragging'); start?.el.classList.remove('lifted'); this.clearDrop(); start = null; dragging = false; target = null; };
        this.el.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1)
                return;
            // an entry inside a view is held to move that entry (touchdrag.ts), not the block around it
            if (e.target.closest?.('.list-row, .t-card, .card, .g-card, .ev, [draggable="true"]'))
                return;
            const hit = blockOf(e.target);
            if (!hit?.b)
                return;
            // text that is being typed in: holding selects a word, as everywhere on the phone (the styling bar comes with the selection)
            if (document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable && hit.el.contains(document.activeElement))
                return;
            const t = e.touches[0];
            start = { x: t.clientX, y: t.clientY, el: hit.el, id: hit.b.id };
            timer = setTimeout(() => {
                if (!start)
                    return;
                dragging = true;
                // holding must not start a text selection (it would take over the drag)
                document.documentElement.classList.add('touch-dragging');
                getSelection()?.removeAllRanges();
                start.el.classList.add('lifted');
                haptic();
            }, 380);
        }, { passive: true });
        this.el.addEventListener('touchmove', (e) => {
            if (!start)
                return;
            const t = e.touches[0];
            if (!dragging) {
                if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8)
                    end();
                return;
            }
            e.preventDefault();
            this.clearDrop();
            const over = document.elementFromPoint(t.clientX, t.clientY)?.closest('.block');
            if (!over || over === start.el || start.el.contains(over) || !this.el.contains(over)) {
                target = null;
                return;
            }
            const r = over.getBoundingClientRect();
            const before = t.clientY < r.top + r.height / 2;
            over.classList.add(before ? 'drop-before' : 'drop-after');
            target = { id: over.dataset.id, before };
            start.moved = true;
        }, { passive: false });
        this.el.addEventListener('touchend', (e) => {
            if (!start)
                return;
            const s = start;
            if (dragging) {
                e.preventDefault();
                if (target && s.moved)
                    this.moveBlocks([s.id], { id: target.id, where: target.before ? 'before' : 'after' });
                else {
                    const b = this.index.get(s.id)?.block;
                    const r = s.el.getBoundingClientRect();
                    if (b)
                        this.blockMenu(b, { x: r.left + 20, y: r.bottom });
                }
            }
            end();
        });
        this.el.addEventListener('touchcancel', end);
    }
    move(b, dir) {
        const loc = this.index.get(b.id);
        const i = loc.arr.indexOf(b), j = i + dir;
        if (j < 0 || j >= loc.arr.length)
            return;
        [loc.arr[i], loc.arr[j]] = [loc.arr[j], loc.arr[i]];
        this.changed();
    }
    // ---------- table of contents ----------
    /** the headings of this page, in order (also toggle headings and headings inside callouts, columns, toggles) */
    headings() {
        const out = [];
        const walk = (bs) => {
            for (const b of bs) {
                if (b.type === 'heading' || (b.type === 'toggle' && b.level)) {
                    const t = plainText(b.text ?? '').trim();
                    if (t)
                        out.push({ id: b.id, level: Math.min(3, Math.max(1, b.level ?? 1)), text: t });
                }
                if (b.children)
                    walk(b.children);
            }
        };
        walk(this.blocks);
        return out;
    }
    fillToc(box) {
        box.textContent = '';
        const hs = this.headings();
        if (!hs.length) {
            box.appendChild(h('div', { class: 'toc-empty' }, 'Headings on this page are listed here.'));
            return;
        }
        const top = Math.min(...hs.map((x) => x.level));
        for (const x of hs)
            box.appendChild(h('a', { class: 'toc-item', href: '#', style: { paddingLeft: `${(x.level - top) * 16}px` }, onclick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const el = this.el.querySelector(`.block[data-id="${x.id}"]`);
                    if (!el)
                        return;
                    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
                    el.classList.add('toc-flash');
                    setTimeout(() => el.classList.remove('toc-flash'), 1200);
                } }, x.text));
    }
    refreshTocs() { for (const box of this.el.querySelectorAll('.toc'))
        this.fillToc(box); }
    // ---------- "@": a link to a page or entry inside the text ----------
    /** the reminder chip in a line: another time, or just the date */
    inlineRemindMenu(a) {
        const blockEl = a.closest('.block'), el = a.closest('.txt');
        const b = this.index.get(blockEl?.dataset.id ?? '')?.block;
        if (!b || !el || this.readonly)
            return;
        const set = (d) => {
            if (d) {
                a.setAttribute('href', `nook:remind:${localIso(d)}`);
                a.textContent = shortWhen(d);
            }
            else {
                const n = a.nextSibling;
                if (n && n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').startsWith('\u00a0'))
                    n.textContent = (n.textContent ?? '').slice(1);
                a.remove();
            }
            b.text = htmlToInline(el);
            this.save();
        };
        menu(a, [
            { section: 'Remind me' },
            ...quickTimes().map(([l, d]) => ({ label: l, run: () => set(d) })),
            { label: 'Other time…', icon: menuIcon('clock'), run: () => prompt(a, 'e.g. sat 10 · tomorrow 18:00 · 23.11. 9:00', '', (v) => { const d = parseWhen(v); if (d)
                    set(d);
                else
                    toast('Didn’t understand that time'); }) },
            'sep',
            { label: 'Remove reminder', run: () => set(null) },
        ]);
    }
    mention(b, el) {
        const sel = getSelection();
        if (!sel?.rangeCount || !sel.isCollapsed)
            return;
        const r = sel.getRangeAt(0);
        const node = r.startContainer;
        if (node.nodeType !== Node.TEXT_NODE || !/(^|[\s\u00a0(])@$/.test((node.textContent ?? '').slice(0, r.startOffset)))
            return;
        const at = r.cloneRange();
        at.setStart(node, r.startOffset - 1); // the "@" itself
        const rect = at.getBoundingClientRect();
        const ws = this.ctx.ws;
        // a reminder at a time: "@mon", "@tomorrow" … – the next seven days at 9:00, this evening, other time
        const remindAt = (d) => {
            el.focus();
            const s2 = getSelection();
            if (!s2)
                return;
            s2.removeAllRanges();
            s2.addRange(at);
            const a = document.createElement('a');
            a.setAttribute('href', `nook:remind:${localIso(d)}`);
            a.textContent = shortWhen(d);
            at.deleteContents();
            at.insertNode(a);
            const space = document.createTextNode('\u00a0');
            a.after(space);
            confirmReminder('', d);
            b.text = htmlToInline(el);
            this.save();
            el.innerHTML = inlineToHtml(b.text);
            const last = document.createRange();
            last.selectNodeContents(el);
            last.collapse(false);
            s2.removeAllRanges();
            s2.addRange(last);
        };
        const days = [];
        const base = new Date();
        if (base.getHours() < 18) {
            const e = new Date(base);
            e.setHours(19, 0, 0, 0);
            days.push({ label: `Remind · this evening, 19:00`, icon: menuIcon('bell'), run: () => remindAt(e) });
        }
        for (let i = 1; i <= 7; i++) {
            const d = new Date(base);
            d.setDate(d.getDate() + i);
            d.setHours(9, 0, 0, 0);
            days.push({ label: `Remind · ${i === 1 ? 'tomorrow' : d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${fmtDay(localIso(d).slice(0, 10))} · 9:00`, icon: menuIcon('bell'), run: () => remindAt(d) });
        }
        days.push({ label: 'Remind · other time…', icon: menuIcon('clock'), run: () => prompt(el, 'e.g. sat 10 · tomorrow 18:00 · 23.11. 9:00 · in 2 hours', '', (v) => { const d = parseWhen(v); if (d)
                remindAt(d);
            else
                toast('Didn’t understand that time'); }) });
        menu({ x: rect.left, y: rect.bottom + 4 }, [...days, 'sep', ...pickEntries(linkItems(ws, (p) => p.id === this.ownerPage), (id) => {
                const page = ws.pages.get(id);
                const row = id.startsWith('row:') ? (() => { const [k, rid] = id.slice(4).split('/'); const db = ws.dbs.get(k); const x = db?.rows.find((y) => y.id === rid); return db && x ? db.rowLabel(x) : ''; })() : '';
                const title = (page?.title ?? row) || 'Untitled';
                el.focus();
                const s2 = getSelection();
                if (!s2)
                    return;
                s2.removeAllRanges();
                s2.addRange(at);
                const a = document.createElement('a');
                a.setAttribute('href', `nook:${id}`);
                a.textContent = title;
                at.deleteContents();
                at.insertNode(a);
                const space = document.createTextNode('\u00a0');
                a.after(space);
                const end = document.createRange();
                end.setStartAfter(space);
                end.collapse(true);
                s2.removeAllRanges();
                s2.addRange(end);
                b.text = htmlToInline(el);
                this.save();
                // drawn again the way saved text is drawn (the link gets its click handling)
                el.innerHTML = inlineToHtml(b.text);
                const last = document.createRange();
                last.selectNodeContents(el);
                last.collapse(false);
                s2.removeAllRanges();
                s2.addRange(last);
            })], { filter: true });
    }
    slashMenu(b, el, keepText = false) {
        const clear = () => { if (!keepText) {
            b.text = '';
            el.textContent = '';
        } };
        const entries = [
            { section: 'Basic blocks' },
            ...TURN_INTO.map((t) => ({ label: t.label, icon: turnIcon(t), hint: t.key, run: () => { clear(); this.turnInto(b, t); } })),
            { label: 'Table', icon: menuIcon('table'), run: () => { clear(); Object.assign(b, { type: 'table', text: undefined, header: true, rows: [['', '', ''], ['', '', ''], ['', '', '']] }); this.changed(); requestAnimationFrame(() => this.el.querySelector(`.block[data-id="${b.id}"] .stable-cell`)?.focus()); } },
            { label: 'Table of contents', icon: menuIcon('list'), run: () => { clear(); b.type = 'toc'; b.text = undefined; const n = this.insertAfter(b); this.changed({ id: n.id, at: 'start' }); } },
            { label: 'Divider', icon: menuIcon('minus'), hint: '---', run: () => { clear(); b.type = 'divider'; b.text = undefined; const n = this.insertAfter(b); this.changed({ id: n.id, at: 'start' }); } },
            { section: 'Layout' },
            { label: '2 columns', icon: menuIcon('columns'), run: () => { clear(); this.toColumns(b, 2); } },
            { label: '3 columns', icon: menuIcon('kanban'), run: () => { clear(); this.toColumns(b, 3); } },
            { label: 'Widgets', icon: menuIcon('puzzle'), subFilter: true, sub: () => allWidgets().filter((w) => !w.block).map((w) => ({ label: w.name, icon: menuIcon(w.icon), hint: w.custom ? 'own' : undefined, run: () => { clear(); newWidgetBlock(b, w.id); const n = this.insertAfter(b); this.changed({ id: n.id, at: 'start' }); } })) },
            { label: 'Tabs', icon: menuIcon('folder'), run: () => {
                    clear();
                    const first = { id: ulid(), type: 'paragraph', text: '' };
                    Object.assign(b, { type: 'tabs', text: undefined, active: 0, children: [
                            { id: ulid(), type: 'tab', text: 'Tab 1', children: [first] },
                            { id: ulid(), type: 'tab', text: 'Tab 2', children: [{ id: ulid(), type: 'paragraph', text: '' }] }
                        ] });
                    this.changed({ id: first.id, at: 'start' });
                } },
            { section: 'Media & links' },
            { label: 'Image', icon: menuIcon('image'), run: () => { clear(); prompt(el, 'Image URL or path (assets/…)', '', (v) => { Object.assign(b, { type: 'image', src: v, text: '' }); this.changed(); }); } },
            { label: 'PDF', icon: menuIcon('file-text'), run: () => { clear(); prompt(el, 'PDF path (assets/…) or URL', '', (v) => { Object.assign(b, { type: 'pdf', src: v, text: '' }); this.changed(); }); } },
            { label: 'Upload file…', icon: menuIcon('paperclip'), run: () => {
                    clear();
                    const input = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
                    input.addEventListener('change', () => { const r = el.getBoundingClientRect(); this.insertFiles([...(input.files ?? [])], { id: b.id, before: false, replace: !(b.text ?? '').trim() }, { x: r.left, y: r.bottom }); input.remove(); });
                    document.body.appendChild(input);
                    input.click();
                } },
            { label: 'Bookmark / Embed', icon: menuIcon('external'), run: () => { clear(); prompt(el, 'Link (YouTube, Vimeo, Miro, Figma, Spotify … are shown embedded)', 'https://', (v) => { Object.assign(b, { type: 'embed', src: v.trim(), text: '' }); if (embedUrl(v.trim()))
                    b.display = 'frame'; this.changed(); }); } },
            { label: 'New page', icon: menuIcon('file-plus'), run: async () => { clear(); Object.assign(b, { type: 'pagelink', text: undefined }); const p = await this.ctx.ws.createPage('Untitled', this.ownerPage, true); b.target = p.id; this.changed(); this.ctx.openPage(p.id); requestAnimationFrame(() => document.querySelector('.page-title[contenteditable="true"]')?.focus()); } },
            { label: 'Link to page', icon: menuIcon('file'), subFilter: true, sub: () => pickEntries(linkItems(this.ctx.ws, (p) => p.id === this.ownerPage), (id) => { clear(); Object.assign(b, { type: 'pagelink', target: id, text: undefined }); this.changed(); }) },
            ...allWidgets().filter((w) => w.block).map((w) => ({ label: w.name, icon: menuIcon(w.icon), run: () => { clear(); newWidgetBlock(b, w.id); this.changed(); } })),
            { label: 'Button', icon: menuIcon('mouse-pointer'), run: () => { clear(); Object.assign(b, { type: 'button', text: 'New button', steps: [] }); this.changed(); this.openButtonSettings(b); } },
            { label: 'Capture', icon: menuIcon('inbox'), run: () => { clear(); Object.assign(b, { type: 'capture', text: undefined, data: undefined }); captureCfg(b); b.children = captureStart(b, this.pageTitle()); this.changed(); this.openCaptureSettings(b); } },
            { section: 'Databases' },
            { label: 'Database view', icon: menuIcon('table'), subFilter: true, sub: () => this.dbChoices(b, el, clear) },
            // every kind of view by name: "/board" → which database (or a new one), shown as a board
            ...VIEW_TYPES.filter((t) => t.type !== 'day').map((t) => ({ label: `${t.label} view`, icon: menuIcon(t.icon), subFilter: true, sub: () => this.dbChoices(b, el, clear, t.type) })),
        ];
        const r = el.getBoundingClientRect();
        menu({ x: r.left, y: r.bottom }, entries, { filter: true });
    }
    toColumns(b, n) {
        const loc = this.index.get(b.id);
        const cols = { id: ulid(), type: 'columns', children: [] };
        for (let i = 0; i < n; i++)
            cols.children.push({ id: ulid(), type: 'column', width: 1, children: [{ id: ulid(), type: 'paragraph', text: '' }] });
        loc.arr.splice(loc.arr.indexOf(b), 1, cols);
        this.changed({ id: cols.children[0].children[0].id, at: 'start' });
    }
    /** tabs block: a row of tabs, the blocks of the chosen one below. Double-click a tab to rename it,
     *  right-click for more; drag tabs to reorder; ＋ adds one. */
    tabsBlock(b) {
        const tabs = (b.children ??= []);
        if (!tabs.length)
            tabs.push({ id: ulid(), type: 'tab', text: 'Tab 1', children: [] });
        const cur = Math.min(Math.max(0, b.active ?? 0), tabs.length - 1);
        tabs.forEach((t) => { this.index.set(t.id, { block: t, arr: tabs, parent: b }); t.children ??= []; if (!t.children.length)
            t.children.push({ id: ulid(), type: 'paragraph', text: '' }); });
        const pick = (i) => { if (i === (b.active ?? 0))
            return; b.active = i; this.changed(); };
        const rename = (t, at) => prompt(at, 'Tab name', t.text ?? '', (v) => { t.text = v.trim() || 'Tab'; this.changed(); });
        const remove = (i) => {
            if (tabs.length === 1) {
                this.remove(b);
                return;
            }
            tabs.splice(i, 1);
            b.active = Math.min(cur >= i && cur > 0 ? cur - 1 : cur, tabs.length - 1);
            this.changed();
        };
        let dragFrom = -1;
        const head = h('div', { class: 'tabs-head', role: 'tablist' }, tabs.map((t, i) => {
            const el = h('button', { class: 'tabs-tab' + (i === cur ? ' on' : ''), role: 'tab', 'aria-selected': String(i === cur), draggable: this.readonly ? undefined : 'true',
                onclick: () => pick(i),
                ondblclick: (e) => { if (!this.readonly)
                    rename(t, e.currentTarget); } }, t.icon ? renderIcon(t.icon, 14) : null, h('span', null, t.text || 'Tab'));
            if (!this.readonly) {
                el.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    menu({ x: e.clientX, y: e.clientY }, [
                        { label: 'Rename', icon: menuIcon('pencil'), run: () => rename(t, el) },
                        { label: 'Change icon…', icon: menuIcon('smile'), run: () => pickIcon(el, t.icon, (v) => { t.icon = v || undefined; this.changed(); }) },
                        { label: 'Move left', icon: menuIcon('arrow-left'), run: () => { if (i < 1)
                                return; tabs.splice(i - 1, 0, tabs.splice(i, 1)[0]); b.active = i - 1; this.changed(); } },
                        { label: 'Move right', icon: menuIcon('arrow-right'), run: () => { if (i >= tabs.length - 1)
                                return; tabs.splice(i + 1, 0, tabs.splice(i, 1)[0]); b.active = i + 1; this.changed(); } },
                        'sep',
                        { label: tabs.length === 1 ? 'Delete tabs block' : 'Delete tab', icon: menuIcon('trash'), danger: true, run: () => remove(i) },
                    ]);
                });
                el.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer?.setData('text/x-nook-tab', String(i)); e.stopPropagation(); });
                el.addEventListener('dragover', (e) => { if (dragFrom < 0)
                    return; e.preventDefault(); e.stopPropagation(); el.classList.add('tab-drop'); });
                el.addEventListener('dragleave', () => el.classList.remove('tab-drop'));
                el.addEventListener('drop', (e) => {
                    el.classList.remove('tab-drop');
                    if (dragFrom < 0 || dragFrom === i)
                        return;
                    e.preventDefault();
                    e.stopPropagation();
                    const [m] = tabs.splice(dragFrom, 1);
                    tabs.splice(i, 0, m);
                    b.active = i;
                    dragFrom = -1;
                    this.changed();
                });
                el.addEventListener('dragend', () => { dragFrom = -1; });
            }
            return el;
        }), this.readonly ? null : h('button', { class: 'tabs-add', 'aria-label': 'Add tab', title: 'Add tab', onclick: () => {
                tabs.push({ id: ulid(), type: 'tab', text: `Tab ${tabs.length + 1}`, children: [{ id: ulid(), type: 'paragraph', text: '' }] });
                b.active = tabs.length - 1;
                this.changed();
            } }, svgIcon(ICONS.plus, 13)));
        const tab = tabs[cur];
        const body = h('div', { class: 'tabs-body blocks', 'data-id': tab.id, role: 'tabpanel' }, this.renderList(tab.children, tab));
        if (!this.readonly)
            body.appendChild(h('div', { class: 'add-block', style: { minHeight: '24px' }, onclick: () => this.insertInto(tab, true) }));
        return h('div', { class: 'tabs-block' }, head, body);
    }
    colResizer(cols, i, row) {
        const a = cols[i], b2 = cols[i + 1];
        const bar = h('div', { class: 'col-resize', title: a.fixed || b2.fixed ? 'Drag to change the fixed width · right-click for options' : 'Drag to resize columns · right-click for a fixed width and the order on a phone' });
        const els = () => row.querySelectorAll(':scope > .column');
        const flexOf = (c, total) => (c.fixed ? `0 0 ${c.fixed}px` : `${((c.width ?? 1) / total) * 100} 1 0`);
        bar.addEventListener('mousedown', (e) => {
            if (e.button !== 0)
                return;
            e.preventDefault();
            bar.classList.add('on');
            document.body.classList.add('resizing-cols');
            const total = cols.filter((c) => !c.fixed).reduce((s, c) => s + (c.width ?? 1), 0) || 1;
            const W = row.getBoundingClientRect().width;
            const startA = a.width ?? 1, startB = b2.width ?? 1, x0 = e.clientX;
            const fa = a.fixed, fb = b2.fixed;
            const rl = row.getBoundingClientRect().left, bc = bar.getBoundingClientRect(), sep0 = bc.left + bc.width / 2;
            const e0 = els(), ra = e0[i].getBoundingClientRect(), rb = e0[i + 1].getBoundingClientRect();
            const la = ra.left, pairW = ra.width + rb.width, gap = rb.left - ra.right;
            const move = (ev) => {
                // the line snaps to ¼, ⅓, ½, ⅔ and ¾ of the row
                const dx = snapAt(sep0 + ev.clientX - x0, rl, W) - sep0;
                // a fixed column changes its pixel width; otherwise the two share their space
                if (fa)
                    a.fixed = Math.round(Math.max(80, Math.min(W - 80, fa + dx)));
                else if (fb)
                    b2.fixed = Math.round(Math.max(80, Math.min(W - 80, fb - dx)));
                else {
                    // the two columns share their space so that the line ends up exactly where it was dragged
                    const apx = Math.max(80, Math.min(pairW - 80, sep0 + dx - la - gap / 2));
                    a.width = +((startA + startB) * apx / pairW).toFixed(3);
                    b2.width = +((startA + startB) - a.width).toFixed(3);
                }
                const e2 = els();
                e2[i].style.flex = flexOf(a, total);
                e2[i + 1].style.flex = flexOf(b2, total);
            };
            const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); bar.classList.remove('on'); document.body.classList.remove('resizing-cols'); this.save(); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
        // right-click: fix the width of the left or right column (in px), or go back to shared widths
        bar.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const w = (k) => Math.round(els()[k]?.getBoundingClientRect().width ?? 240);
            const colName = (k) => cols.length === 2 ? ['Left column', 'Right column'][k] : cols.length === 3 ? ['Left column', 'Middle column', 'Right column'][k] : `Column ${k + 1}`;
            const pos = (k) => (cols.length === 3 ? ['align-left', 'align-center', 'align-right'][k] : k === 0 ? 'align-left' : k === cols.length - 1 ? 'align-right' : 'align-center') ?? 'columns';
            const first = Math.max(0, cols.findIndex((x) => x.phonefirst));
            // each column: flexible (shares the rest) or fixed at its width now; then which one comes first on a phone
            menu({ x: e.clientX, y: e.clientY }, [
                { section: 'Width' },
                ...cols.map((c, k) => ({ label: colName(k), icon: menuIcon(pos(k)), seg: { options: [['flex', 'Flexible'], ['fixed', `${c.fixed ?? w(k)} px`]], value: c.fixed ? 'fixed' : 'flex', pick: (v) => { if (v === 'fixed')
                            c.fixed = w(k);
                        else
                            delete c.fixed; this.changed(); } } })),
                ...(cols.some((c) => c.fixed) ? [{ label: 'Make all flexible', icon: menuIcon('columns'), run: () => { for (const c of cols)
                            delete c.fixed; this.changed(); } }] : []),
                { section: 'On a phone' },
                { label: 'First', icon: menuIcon('smartphone'), seg: { options: cols.map((_, k) => [String(k), cols.length <= 3 ? colName(k).replace(' column', '') : String(k + 1)]), value: String(first), pick: (v) => { for (const x of cols)
                            delete x.phonefirst; if (Number(v) > 0)
                            cols[Number(v)].phonefirst = 1; this.changed(); } } },
            ], { title: 'Columns' });
        });
        return bar;
    }
    // ---------- dropping files from the computer ----------
    /** Files dropped on a page are copied into the workspace's assets/ folder and shown as blocks. */
    fileDrop() {
        const isFiles = (e) => !!e.dataTransfer?.types.includes('Files');
        let target = null;
        this.el.addEventListener('dragover', (e) => {
            if (!isFiles(e))
                return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
            const blocks = [...this.el.querySelectorAll('.block')].filter((x) => x.getBoundingClientRect().height > 0 && !x.querySelector('.block'));
            let best = null, dist = Infinity, before = false;
            for (const x of blocks) {
                const r = x.getBoundingClientRect();
                if (e.clientX < r.left - 60 || e.clientX > r.right + 20)
                    continue;
                const d = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
                if (d < dist) {
                    dist = d;
                    best = x;
                    before = e.clientY < r.top + r.height / 2;
                }
            }
            this.clearDrop();
            if (best) {
                best.classList.add(before ? 'drop-before' : 'drop-after');
                target = { id: best.dataset.id, before };
            }
            else
                target = null;
        });
        this.el.addEventListener('dragleave', (e) => { if (!this.el.contains(e.relatedTarget)) {
            this.clearDrop();
            target = null;
        } });
        this.el.addEventListener('drop', async (e) => {
            if (!isFiles(e))
                return;
            e.preventDefault();
            e.stopPropagation();
            this.clearDrop();
            await this.insertFiles([...(e.dataTransfer?.files ?? [])], target, { x: e.clientX, y: e.clientY });
        });
    }
    /** ⋯ → Compress: the stored picture or video is replaced by a smaller one; the original goes to Unused files */
    async compressBlock(b) {
        const ws = this.ctx.ws, src = assetOf(b);
        if (!src || !ws.storage.writeBinary)
            return;
        let blob;
        try {
            const u = await ws.storage.assetUrl?.(src);
            if (!u)
                throw new Error('not found');
            blob = await (await fetch(u)).blob();
        }
        catch (e) {
            toast(`Could not load the file: ${e.message}`);
            return;
        }
        const name = src.split('/').pop() ?? 'file';
        const small = await compressStored(blob, name);
        if (!small) {
            toast('Already as small as it gets');
            return;
        }
        const dir = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : '';
        let path = (dir ? dir + '/' : '') + small.name;
        if (path !== src && (await ws.storage.read(path).then(() => true, () => false)))
            path = ws.newFilePath(this.fileOf?.() ?? this.commentPath, small.name);
        try {
            if (path === src) {
                // same name (a .jpg stays .jpg): the original moves aside first
                if (ws.storage.move)
                    await ws.storage.move(src, `${UNUSED}/${todayISO()}/${name}`);
                await ws.writeFile(path, new Uint8Array(await small.arrayBuffer()));
            }
            else {
                await ws.writeFile(path, new Uint8Array(await small.arrayBuffer()));
                if (ws.storage.move)
                    await ws.storage.move(src, `${UNUSED}/${todayISO()}/${name}`).catch(() => { });
            }
        }
        catch (e) {
            toast(`Could not compress: ${e.message}`);
            return;
        }
        ws.boundary();
        b.src = path;
        if (b.text === name)
            b.text = small.name;
        this.built = new WeakMap();
        this.render();
        this.changed();
        toast(`${mb(blob.size)} → ${mb(small.size)} · the original is in Unused files`, 4000);
    }
    /** Store files in assets/ and add them after (or before) a block; viewable ones ask embed vs file. */
    async insertFiles(files, where, at, direct = false, compress) {
        if (!files.length)
            return;
        const st = this.ctx.ws.storage;
        if (!st.writeBinary) {
            toast('This workspace cannot store files');
            return;
        }
        // images and videos: as they are or smaller (Settings → Files, or the upload slot's own choice)
        const ready = await prepareUpload(files, compress ?? this.ctx.ws.settings.compress);
        if (!ready)
            return;
        files = ready;
        const made = [];
        for (const f of files) {
            const path = this.ctx.ws.newFilePath(this.fileOf?.() ?? this.commentPath, f.name || 'file');
            try {
                await this.ctx.ws.writeFile(path, new Uint8Array(await f.arrayBuffer()));
            }
            catch (err) {
                toast(`Could not save ${f.name}: ${err.message}`);
                continue;
            }
            const kind = mediaKind(f);
            made.push({ id: ulid(), type: kind ?? 'file', src: path, text: f.name });
        }
        if (!made.length)
            return;
        const insert = () => {
            const loc = where ? this.index.get(where.id) : undefined;
            if (loc) {
                const i = loc.arr.indexOf(loc.block);
                if (where.replace)
                    loc.arr.splice(i, 1, ...made);
                else
                    loc.arr.splice(where.before ? i : i + 1, 0, ...made);
            }
            else
                this.blocks.push(...made);
            this.changed();
        };
        const viewable = made.filter((b) => b.type !== 'file');
        if (!viewable.length || direct || document.documentElement.classList.contains('phone')) {
            insert();
            return;
        }
        // as in Notion: show it (image, PDF viewer, player) or keep it as a file attachment
        const label = viewable.length === 1 ? { image: 'image', pdf: 'PDF viewer', audio: 'audio player', video: 'video player' }[viewable[0].type] ?? 'preview' : 'previews';
        menu(at, [
            { section: files.length === 1 ? files[0].name : `${files.length} files` },
            { label: `Embed as ${label}`, icon: menuIcon(viewable[0].type === 'image' ? 'image' : viewable[0].type === 'audio' ? 'music' : viewable[0].type === 'video' ? 'video' : 'file-text'), run: insert },
            { label: files.length === 1 ? 'Attach as file' : 'Attach as files', icon: menuIcon('paperclip'), run: () => { for (const b of made)
                    b.type = 'file'; insert(); } },
        ]);
    }
    // ---------- drag & drop ----------
    clearDrop() { this.el.querySelectorAll('.drop-before,.drop-after,.drop-inside,.drop-right,.drop-into,.drop-page').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-right', 'drop-into', 'drop-page')); }
    isInside(targetId, dragId) {
        let loc = this.index.get(targetId);
        while (loc?.parent) {
            if (loc.parent.id === dragId)
                return true;
            loc = this.index.get(loc.parent.id);
        }
        return false;
    }
    // ---------- selecting whole blocks ----------
    /** every block id in reading order */
    docOrder() {
        const out = [];
        const walk = (arr) => { for (const b of arr) {
            if (b.type !== 'column')
                out.push(b.id);
            if (b.children)
                walk(b.children);
        } };
        walk(this.blocks);
        return out;
    }
    /** blocks from a to b (in reading order), without blocks inside other selected ones */
    range(a, b) {
        const order = this.docOrder();
        const i = order.indexOf(a), j = order.indexOf(b);
        if (i < 0 || j < 0)
            return [b];
        return this.topLevel(order.slice(Math.min(i, j), Math.max(i, j) + 1));
    }
    topLevel(ids) {
        const set = new Set(ids);
        const order = this.docOrder();
        return ids.filter((id) => { for (let l = this.index.get(id); l?.parent; l = this.index.get(l.parent.id))
            if (set.has(l.parent.id))
                return false; return true; })
            .sort((x, y) => order.indexOf(x) - order.indexOf(y));
    }
    /** after a block menu closes, the selected block keeps the keys (Backspace / Delete removes it) */
    refocusSelection() { if (this.selected.size && this.el.isConnected && !document.querySelector('.overlay'))
        requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body || this.el.contains(document.activeElement))
            this.el.focus({ preventScroll: true }); }); }
    select(ids, resetAnchor = true) {
        this.selected = new Set(ids);
        if (resetAnchor)
            this.anchor = ids[0] ?? null;
        if (ids.length) {
            getSelection()?.removeAllRanges();
            if (document.activeElement instanceof HTMLElement && this.el.contains(document.activeElement))
                document.activeElement.blur();
            this.el.focus({ preventScroll: true });
        }
        this.markSelection();
    }
    markSelection() {
        this.el.querySelectorAll('.block.selected').forEach((x) => x.classList.remove('selected'));
        for (const id of this.selected)
            this.el.querySelector(`.block[data-id="${CSS.escape(id)}"]`)?.classList.add('selected');
    }
    blockSelection() {
        this.el.tabIndex = -1;
        // a text selection dragged from one block into another selects the blocks (as in Notion)
        let start = null;
        this.el.addEventListener('mousedown', (e) => {
            const blockEl = e.target.closest('.block');
            if (e.button !== 0 || e.target.closest('.handle, .pop, .dbview'))
                return;
            if (e.shiftKey && this.selected.size && blockEl) {
                e.preventDefault();
                this.select(this.range(this.anchor ?? blockEl.dataset.id, blockEl.dataset.id), false);
                return;
            }
            // the caret is in one block, shift-click in another: select both and everything between (as in Notion)
            if (e.shiftKey && blockEl && !this.selected.size) {
                const sel = getSelection();
                const at = (sel?.anchorNode ? (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement) : null) ?? document.activeElement;
                const fromEl = at && this.el.contains(at) ? at.closest('.block') : null;
                const from = fromEl?.dataset.id, to = blockEl.dataset.id;
                if (from && from !== to && !this.isInside(from, to) && !this.isInside(to, from)) {
                    e.preventDefault();
                    this.anchor = from;
                    this.select(this.range(from, to), false);
                    this.anchor = from;
                    return;
                }
            }
            if (this.selected.size)
                this.select([]);
            start = e.target.closest('.txt') ? blockEl?.dataset.id ?? null : null;
        });
        this.el.addEventListener('mousemove', (e) => {
            if (!start || e.buttons !== 1) {
                start = null;
                return;
            }
            const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.block');
            const id = over && this.el.contains(over) ? over.dataset.id : null;
            if (!id || id === start || this.isInside(start, id) || this.isInside(id, start)) {
                if (this.selected.size && id === start)
                    this.select([]);
                return;
            }
            this.anchor = start;
            this.select(this.range(start, id), false);
        });
        // (the mouseup that ends a drag is caught once per press, so closed pages leave no listener behind)
        this.el.addEventListener('mousedown', () => document.addEventListener('mouseup', () => { start = null; }, { once: true }));
        // keys for selected blocks
        const onSelKey = (e) => {
            if (!this.el.isConnected) {
                document.removeEventListener('keydown', onSelKey);
                return;
            }
            const t = e.target;
            // focus on the editor, a handle, or nowhere in particular (the page): the selection gets the keys
            const free = t === document.body || t === document.documentElement;
            if (!this.selected.size || document.querySelector('.pop:not(.pop-closing)') || (t !== this.el && !t.closest?.('.handle') && !free))
                return;
            // a page behind an open window (entry, settings) doesn't take keys meant for that window
            if (free && document.querySelector('.overlay') && !this.el.closest('.overlay'))
                return;
            const mod = e.metaKey || e.ctrlKey;
            const ids = this.topLevel([...this.selected]);
            const order = this.docOrder();
            let handled = true;
            if (e.key === 'Escape')
                this.select([]);
            else if (e.key === 'Backspace' || e.key === 'Delete')
                this.confirmFiles(ids, () => this.removeMany(ids));
            else if (mod && e.key.toLowerCase() === 'd')
                this.duplicateMany(ids);
            else if (mod && e.key.toLowerCase() === 'a')
                this.select(this.topLevel(order));
            else if (e.key === 'Enter') {
                const id = ids[ids.length - 1];
                this.select([]);
                this.focus(id, 'end');
            }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const edge = e.key === 'ArrowDown' ? ids[ids.length - 1] : ids[0];
                const top = this.topLevel(order);
                const next = top[top.indexOf(edge) + (e.key === 'ArrowDown' ? 1 : -1)] ?? order[order.indexOf(edge) + (e.key === 'ArrowDown' ? 1 : -1)];
                if (next) {
                    if (e.shiftKey)
                        this.select(this.range(this.anchor ?? edge, next), false);
                    else
                        this.select([next]);
                    this.el.querySelector(`.block[data-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
                }
            }
            else if (mod && e.key.toLowerCase() === 'c')
                this.copySelection(ids, false);
            else if (mod && e.key.toLowerCase() === 'x' && !this.readonly)
                this.copySelection(ids, true);
            else
                handled = false;
            if (handled) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener('keydown', onSelKey);
        // Ctrl+V while blocks are selected (no caret): the blocks go in after the selection
        const onSelPaste = (e) => {
            if (!this.el.isConnected) {
                document.removeEventListener('paste', onSelPaste);
                return;
            }
            if (!this.selected.size || this.readonly)
                return;
            const t = e.target;
            if (t.closest?.('input, textarea, [contenteditable="true"]') || (document.querySelector('.overlay') && !this.el.closest('.overlay')))
                return;
            const text = e.clipboardData?.getData('text/plain');
            if (!text)
                return;
            e.preventDefault();
            const ids = this.topLevel([...this.selected]);
            void this.insertPasted(text, ids[ids.length - 1], false);
        };
        document.addEventListener('paste', onSelPaste);
    }
    /** Ctrl+C / Ctrl+X on selected blocks: as page text on the clipboard (works in any app) and, for pasting
     *  in Nook, the blocks themselves. Cut subpages stay alive until they are pasted (then they move there). */
    copySelection(ids, cut) {
        const blocks = ids.map((id) => this.index.get(id)?.block).filter(Boolean);
        if (!blocks.length)
            return;
        const ws = this.ctx.ws;
        const text = serializePage(blocks);
        const cutPages = new Set();
        if (cut && this.ownerPage)
            walkTree(blocks, (x) => { if (x.type === 'pagelink' && x.target && ws.pages.get(x.target)?.parent === this.ownerPage)
                cutPages.add(x.target); });
        blockClip = { text: normClip(text), blocks: blocks.map((b) => JSON.parse(JSON.stringify(b))), cutFrom: cut ? this.ownerPage : undefined, cutPages };
        ws.holdSubpages = cutPages;
        navigator.clipboard?.writeText(text).catch(() => { });
        if (cut) {
            this.removeMany(ids);
            toast(`Cut ${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}`);
        }
        else
            toast(`Copied ${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}`, 1400);
    }
    /** pasted text that came from Nook blocks becomes those blocks again (else it is read as page text);
     *  `replace`: the block at `at` is an empty line and is replaced */
    async insertPasted(text, at, replace) {
        const ws = this.ctx.ws;
        const clip = blockClip && blockClip.text === normClip(text) ? blockClip : null;
        let blocks;
        if (clip)
            blocks = clip.blocks.map(cloneBlock);
        else {
            const { parsePage } = await import('../format/page.js');
            blocks = parsePage(text.replace(/\r\n/g, '\n'));
        }
        if (!blocks.length)
            return;
        const loc = this.index.get(at);
        if (!loc)
            return;
        const i = loc.arr.indexOf(loc.block);
        loc.arr.splice(replace ? i : i + 1, replace ? 1 : 0, ...blocks);
        // cut subpages move to the page they are pasted into
        if (clip?.cutPages.size) {
            if (this.ownerPage && clip.cutFrom !== this.ownerPage) {
                for (const id of clip.cutPages) {
                    const p = ws.pages.get(id);
                    if (p && id !== this.ownerPage && !isDescendantPage(ws, this.ownerPage, id)) {
                        p.parent = this.ownerPage;
                        await ws.savePage(p);
                    }
                }
            }
            clip.cutPages = new Set();
            clip.cutFrom = undefined;
            ws.holdSubpages = new Set();
        }
        this.selected = new Set(blocks.map((b) => b.id));
        this.changed();
        this.select(blocks.map((b) => b.id));
        this.ctx.refreshSidebar?.();
    }
    /**
     * Marquee selection (as in Notion): press on an empty spot of the page – the margins, the space
     * around or between blocks – and drag: a rectangle selects every block it touches (⇧ adds to the
     * selection). A plain click there still does what it did before.
     */
    marquee() {
        const NOT_HERE = '.props, .txt, input, textarea, select, button, a, [contenteditable="true"], .handle, .dbview, .stable-wrap, iframe, img, video, audio, .page-head, .pop, .overlay .dialog-head, .nbutton, .pagelink, .callout-icon, .toggle-arrow, .col-resize, .b-divider, .cal-wrap';
        const onDown = (e) => {
            if (!this.el.isConnected) {
                document.removeEventListener('mousedown', onDown, true);
                return;
            }
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey)
                return;
            const area = this.el.closest('.scroll, .dialog-body, .row-page') ?? this.el.parentElement;
            const t = e.target;
            if (!area || !area.contains(t) || t.closest(NOT_HERE))
                return;
            // the scrollbar is not a place to start
            if (e.clientX > area.getBoundingClientRect().left + area.clientWidth)
                return;
            const x0 = e.clientX, y0 = e.clientY + area.scrollTop;
            const base = e.shiftKey ? new Set(this.selected) : new Set();
            let box = null, lastY = e.clientY, lastX = e.clientX, raf = 0;
            const update = () => {
                raf = 0;
                const top = Math.min(y0 - area.scrollTop, lastY), bottom = Math.max(y0 - area.scrollTop, lastY);
                const left = Math.min(x0, lastX), right = Math.max(x0, lastX);
                Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
                const hit = [];
                for (const b of this.el.querySelectorAll('.block[data-id]')) {
                    if (b.classList.contains('b-columns'))
                        continue; // inside columns the blocks themselves are picked
                    const r = b.getBoundingClientRect();
                    if (r.bottom > top && r.top < bottom && r.right > left && r.left < right)
                        hit.push(b.dataset.id);
                }
                this.select(this.topLevel([...new Set([...base, ...hit])]), !e.shiftKey);
            };
            const move = (ev) => {
                lastX = ev.clientX;
                lastY = ev.clientY;
                if (!box) {
                    if (Math.hypot(ev.clientX - x0, ev.clientY + area.scrollTop - y0) < 6)
                        return;
                    box = h('div', { class: 'marquee' });
                    document.body.appendChild(box);
                    document.body.classList.add('marqueeing');
                    getSelection()?.removeAllRanges();
                }
                // near the top or bottom edge the page scrolls along
                const ar = area.getBoundingClientRect();
                if (ev.clientY < ar.top + 30)
                    area.scrollTop -= 14;
                else if (ev.clientY > ar.bottom - 30)
                    area.scrollTop += 14;
                ev.preventDefault();
                if (!raf)
                    raf = requestAnimationFrame(update);
            };
            const up = () => {
                document.removeEventListener('mousemove', move, true);
                document.removeEventListener('mouseup', up, true);
                if (raf) {
                    cancelAnimationFrame(raf);
                    if (box)
                        update();
                }
                // a plain click on an empty spot ends a selection
                if (!box) {
                    if (!e.shiftKey && this.selected.size)
                        this.select([]);
                    return;
                }
                box.remove();
                document.body.classList.remove('marqueeing');
                // the click that ends the drag doesn't add a line or deselect
                const eat = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
                document.addEventListener('click', eat, { capture: true, once: true });
                setTimeout(() => document.removeEventListener('click', eat, true), 0);
                this.el.focus({ preventScroll: true });
            };
            document.addEventListener('mousemove', move, true);
            document.addEventListener('mouseup', up, true);
        };
        document.addEventListener('mousedown', onDown, true);
    }
    /** opens a file block's file (pictures, PDFs … in a tab) or downloads it under its own name */
    async openFile(b, download = false) {
        const src = b.src ?? '';
        const name = b.text || src.split('/').pop()?.replace(/^[a-z0-9]{6}-/, '') || 'file';
        let url = /^(https?:|data:|blob:)/.test(src) ? src : await this.ctx.assetUrl(src).catch(() => '');
        if (!url) {
            toast(`File missing: ${src}`);
            return;
        }
        // web pages, SVG drawings and the like are never shown in a tab: there they could run code as Nook
        const viewable = SAFE_TO_VIEW.test(name);
        if (url.includes('/api/fs/raw?'))
            url += `&name=${encodeURIComponent(name)}${download || !viewable ? '&download=1' : ''}`;
        openOrDownload(url, name, download);
    }
    /** deleting blocks that hold files from assets/: ask first, then the file goes too (unless used elsewhere) */
    confirmFiles(ids, run) {
        const gone = new Set(ids);
        const files = [];
        for (const id of ids) {
            const b = this.index.get(id)?.block;
            if (b)
                walkTree([b], (x) => { if (assetOf(x))
                    files.push(x); });
        }
        if (!files.length || this.readonly) {
            run();
            return;
        }
        const ws = this.ctx.ws;
        // still used in what stays on this page, or on another page / entry?
        const remaining = [];
        walkTree(this.blocks, (x) => { if (!gone.has(x.id) && assetOf(x))
            remaining.push(assetOf(x)); }, gone);
        const paths = [...new Set(files.map((f) => assetOf(f)))];
        const keep = paths.filter((p) => remaining.includes(p) || ws.assetUsedElsewhere(p, this.commentPath));
        const del = paths.filter((p) => !keep.includes(p));
        const nameOf = (p) => files.find((f) => assetOf(f) === p)?.text || p.split('/').pop().replace(/^[a-z0-9]{6}-/, '');
        const one = paths.length === 1;
        const lines = [one
                ? `“${nameOf(paths[0])}” is removed from this page${del.length ? ' and deleted from the workspace folder.' : '.'}`
                : `${paths.length} files are removed from this page${del.length ? ` and ${del.length === paths.length ? 'deleted' : `${del.length} of them deleted`} from the workspace folder.` : '.'}`];
        if (keep.length)
            lines.push(one ? 'The file stays in the workspace folder: it is used somewhere else too.' : `${keep.length} stay in the workspace folder: they are used somewhere else too.`);
        confirmDialog({ title: one ? 'Delete file?' : `Delete ${paths.length} files?`, lines, ok: 'Delete', danger: true, onOk: async () => {
                run();
                let failed = 0;
                for (const p of del)
                    await ws.deleteAsset(p).catch(() => { failed++; });
                if (failed)
                    toast(`Could not delete ${failed === 1 ? 'the file' : `${failed} files`} from the workspace folder`);
            } });
    }
    removeMany(ids) {
        const first = this.index.get(ids[0]);
        for (const id of ids) {
            const loc = this.index.get(id);
            if (loc)
                loc.arr.splice(loc.arr.indexOf(loc.block), 1);
        }
        if (!this.blocks.length)
            this.blocks.push({ id: ulid(), type: 'paragraph', text: '' });
        this.normalizeColumns(this.blocks);
        this.selected.clear();
        const keep = first?.arr[Math.max(0, first.arr.indexOf(first.block))];
        this.changed();
        if (keep)
            this.select([]);
    }
    duplicateMany(ids) {
        const copies = ids.map((id) => cloneBlock(this.index.get(id).block));
        const last = this.index.get(ids[ids.length - 1]);
        last.arr.splice(last.arr.indexOf(last.block) + 1, 0, ...copies);
        this.selected = new Set(copies.map((c) => c.id));
        this.changed();
    }
    /** Put blocks side by side: n columns, the blocks shared out in reading order. */
    putInColumns(ids, n) {
        ids = this.topLevel(ids);
        const first = this.index.get(ids[0]);
        if (!first)
            return;
        const blocks = ids.map((id) => this.index.get(id).block);
        const arr = first.arr;
        let at = arr.indexOf(first.block);
        for (const b of blocks) {
            const loc = this.index.get(b.id);
            const i = loc.arr.indexOf(b);
            if (loc.arr === arr && i < at)
                at--;
            loc.arr.splice(i, 1);
        }
        const per = Math.ceil(blocks.length / n);
        const cols = [];
        for (let i = 0; i < n; i++) {
            const part = blocks.slice(i * per, (i + 1) * per);
            cols.push({ id: ulid(), type: 'column', width: 1, children: part.length ? part : [{ id: ulid(), type: 'paragraph', text: '' }] });
        }
        arr.splice(Math.max(0, at), 0, { id: ulid(), type: 'columns', children: cols });
        this.normalizeColumns(this.blocks);
        this.selected.clear();
        this.changed();
    }
    /** a block alone in columns gets empty neighbours */
    addEmptyColumns(id, n) {
        const loc = this.index.get(id);
        if (!loc)
            return;
        const i = loc.arr.indexOf(loc.block);
        const cols = [{ id: ulid(), type: 'column', width: 1, children: [loc.block] }];
        for (let k = 0; k < n; k++)
            cols.push({ id: ulid(), type: 'column', width: 1, children: [{ id: ulid(), type: 'paragraph', text: '' }] });
        loc.arr.splice(i, 1, { id: ulid(), type: 'columns', children: cols });
        this.changed({ id: cols[1].children[0].id, at: 'start' });
    }
    /** columns back into normal blocks, one after another */
    unwrapColumns(b) {
        const loc = this.index.get(b.id);
        if (!loc)
            return;
        loc.arr.splice(loc.arr.indexOf(b), 1, ...(b.children ?? []).flatMap((c) => c.children ?? []));
        this.changed();
    }
    /** no empty columns, no single column left over */
    normalizeColumns(arr) {
        for (let i = arr.length - 1; i >= 0; i--) {
            const b = arr[i];
            if (b.children)
                this.normalizeColumns(b.children);
            if (b.type === 'columns') {
                b.children = (b.children ?? []).filter((c) => c.type !== 'column' || (c.children?.length ?? 0) > 0);
                if (b.children.length === 0)
                    arr.splice(i, 1);
                else if (b.children.length === 1)
                    arr.splice(i, 1, ...(b.children[0].children ?? []));
            }
        }
    }
    // ---------- drag & drop of blocks ----------
    /**
     * One drop handler for the whole page: above / below a block, into a toggle or callout (drop on
     * its first line), at the end of a column, or to the right of a block to put them side by side.
     */
    blockDnd() {
        const nearest = (e) => {
            let best = null, dist = Infinity;
            for (const x of this.el.querySelectorAll('.block')) {
                const r = x.getBoundingClientRect();
                if (!r.height || e.clientX < r.left - 80 || e.clientX > r.right + 40)
                    continue;
                const d = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
                if (d < dist || (d === dist && best?.contains(x))) {
                    dist = d;
                    best = x;
                }
            }
            return best;
        };
        const targetOf = (e) => {
            const ids = this.dragIds;
            const blocked = (id) => ids.includes(id) || ids.some((d) => this.isInside(id, d));
            const t = e.target;
            const colEl = t.closest('.column');
            let wrap = t.closest('.block');
            if (wrap && !this.el.contains(wrap))
                wrap = null;
            // empty space in a column: to the end of that column
            if (colEl && this.el.contains(colEl) && (!wrap || wrap.contains(colEl)))
                return blocked(colEl.dataset.id) ? null : { id: colEl.dataset.id, where: 'column-end' };
            wrap ??= nearest(e);
            if (!wrap)
                return null;
            const id = wrap.dataset.id;
            const b = this.index.get(id)?.block;
            if (!b || blocked(id))
                return null;
            const r = wrap.getBoundingClientRect();
            if (e.clientX > r.right - 48 && r.width > 160 && e.clientY > r.top && e.clientY < r.bottom)
                return { id, where: 'right' };
            if (b.type === 'toggle') {
                const row = wrap.querySelector(':scope > .toggle-row').getBoundingClientRect();
                if (e.clientY < row.top + row.height * 0.3)
                    return { id, where: 'before' };
                if (e.clientY <= row.bottom)
                    return { id, where: 'inside' };
                return { id, where: e.clientY > r.bottom - 6 ? 'after' : 'inside-end' };
            }
            if (b.type === 'pagelink' && b.target && b.target !== this.ownerPage && this.ctx.ws.pages.has(b.target)) {
                const card = (wrap.querySelector('.pagelink') ?? wrap).getBoundingClientRect();
                const edge = Math.min(8, card.height / 4);
                if (e.clientY < card.top + edge)
                    return { id, where: 'before' };
                if (e.clientY > card.bottom - edge)
                    return { id, where: 'after' };
                return this.canMoveInto(ids, b.target) ? { id, where: 'into-page' } : null;
            }
            if (b.type === 'callout' || b.type === 'capture') {
                if (e.clientY < r.top + 8)
                    return { id, where: 'before' };
                if (e.clientY > r.bottom - 8)
                    return { id, where: 'after' };
                return { id, where: 'inside-end' };
            }
            return { id, where: e.clientY < r.top + r.height / 2 ? 'before' : 'after' };
        };
        const show = (t) => {
            this.clearDrop();
            if (!t)
                return;
            const sel = t.where === 'column-end' ? `.column[data-id="${CSS.escape(t.id)}"]` : `.block[data-id="${CSS.escape(t.id)}"]`;
            const el = this.el.querySelector(sel);
            el?.classList.add({ before: 'drop-before', after: 'drop-after', inside: 'drop-inside', 'inside-end': 'drop-inside', right: 'drop-right', 'column-end': 'drop-into', 'into-page': 'drop-page' }[t.where]);
        };
        let last = null;
        this.el.addEventListener('dragover', (e) => {
            if (!this.dragIds.length || !e.dataTransfer?.types.includes('text/x-nook-block'))
                return;
            const t = targetOf(e);
            if (!t) {
                show(null);
                last = null;
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            if (!last || last.id !== t.id || last.where !== t.where)
                show(t);
            last = t;
        });
        this.el.addEventListener('dragleave', (e) => { if (!this.el.contains(e.relatedTarget)) {
            this.clearDrop();
            last = null;
        } });
        this.el.addEventListener('drop', (e) => {
            if (!this.dragIds.length || !e.dataTransfer?.types.includes('text/x-nook-block'))
                return;
            e.preventDefault();
            e.stopPropagation();
            const t = targetOf(e) ?? last;
            this.clearDrop();
            last = null;
            if (t)
                this.moveBlocks(this.dragIds, t);
        });
    }
    /** a page preview took a subpage: its own link block goes away (the page stays, now shown in the preview) */
    listenUnlink() {
        // an upload slot got its files: they take its place
        this.el.addEventListener('nook-insert-files', (e) => {
            const id = e.target.closest('.block')?.dataset.id;
            if (!id || this.readonly)
                return;
            const r = e.target.getBoundingClientRect();
            const d = e.detail;
            // the slot is replaced by what was added – or stays (then new things go above or below it)
            void this.insertFiles(d.files, { id, before: !!(d.keep && d.above), replace: !d.keep }, { x: r.left, y: r.bottom }, true, d.compress);
        });
        // blocks dropped onto a page in the breadcrumb: they move into that page
        const onMoveInto = (e) => {
            if (!this.el.isConnected) {
                document.removeEventListener('nook-move-into', onMoveInto);
                return;
            }
            const d = e.detail;
            const moving = d.ids.map((id) => this.index.get(id)?.block).filter((b) => !!b);
            if (!moving.length || !this.canMoveInto(moving.map((b) => b.id), d.page))
                return;
            e.preventDefault();
            this.dragIds = [];
            void this.moveIntoPage(this.topLevel(moving.map((b) => b.id)).map((id) => this.index.get(id).block), d.page);
        };
        document.addEventListener('nook-move-into', onMoveInto);
        this.el.addEventListener('nook-take-pages', (e) => {
            const d = e.detail;
            // page links, and PDFs (blocks or files showing a .pdf): they move into the preview's list
            const isPdf = (b) => (b.type === 'pdf' || b.type === 'file') && /\.pdf$/i.test(b.src ?? '') && !/^[a-z]+:/i.test(b.src ?? '');
            const take = d.ids.map((id) => this.index.get(id)?.block).filter((b) => !!b && ((b.type === 'pagelink' && !!b.target && this.ctx.ws.pages.has(b.target)) || isPdf(b)));
            if (!take.length)
                return;
            e.preventDefault();
            for (const b of take) {
                d.out.push(b.type === 'pagelink' ? b.target : b.src);
                const loc = this.index.get(b.id);
                if (loc)
                    loc.arr.splice(loc.arr.indexOf(b), 1);
            }
            if (!this.blocks.length)
                this.blocks.push({ id: ulid(), type: 'paragraph', text: '' });
            this.dragIds = [];
            this.select([]);
            // the preview's own save (right after) also counts these pages as still linked
            queueMicrotask(() => this.changed());
        });
    }
    async moveIntoPage(moving, pageId) {
        const ws = this.ctx.ws;
        const page = ws.pages.get(pageId);
        if (!page || !this.canMoveInto(moving.map((b) => b.id), pageId))
            return;
        for (const b of moving) {
            const loc = this.index.get(b.id);
            if (loc)
                loc.arr.splice(loc.arr.indexOf(b), 1);
        }
        if (!this.blocks.length)
            this.blocks.push({ id: ulid(), type: 'paragraph', text: '' });
        this.normalizeColumns(this.blocks);
        // subpages of this page whose links move become subpages of the target page
        const kids = [];
        walkTree(moving, (x) => { if (x.type === 'pagelink' && x.target && this.ownerPage && ws.pages.get(x.target)?.parent === this.ownerPage)
            kids.push(x.target); });
        for (const id of kids)
            ws.pages.get(id).parent = pageId;
        const last = page.blocks[page.blocks.length - 1];
        if (last && last.type === 'paragraph' && !last.text && page.blocks.length > 0)
            page.blocks.pop();
        page.blocks.push(...moving);
        this.selected.clear();
        ws.boundary();
        this.changed();
        await ws.savePage(page);
        for (const id of kids)
            await ws.savePage(ws.pages.get(id));
        this.ctx.refreshSidebar?.();
        toast(`Moved ${moving.length === 1 ? '1 block' : `${moving.length} blocks`} to “${page.title}”`);
    }
    /** blocks may go into that page: not a subpage into itself or into one of its own subpages */
    canMoveInto(ids, pageId) {
        const ws = this.ctx.ws;
        let ok = true;
        walkTree(ids.map((id) => this.index.get(id)?.block).filter(Boolean), (x) => {
            if (x.type === 'pagelink' && x.target && (x.target === pageId || isDescendantPage(ws, pageId, x.target)))
                ok = false;
        });
        return ok;
    }
    moveBlocks(ids, t) {
        ids = this.topLevel(ids);
        const moving = ids.map((id) => this.index.get(id)?.block).filter(Boolean);
        if (!moving.length)
            return;
        const dst = this.index.get(t.id);
        if (!dst)
            return;
        if (t.where === 'into-page') {
            void this.moveIntoPage(moving, dst.block.target);
            return;
        }
        for (const b of moving) {
            const loc = this.index.get(b.id);
            loc.arr.splice(loc.arr.indexOf(b), 1);
        }
        const target = dst.block;
        switch (t.where) {
            case 'before':
            case 'after': {
                const i = dst.arr.indexOf(target);
                dst.arr.splice(t.where === 'before' ? i : i + 1, 0, ...moving);
                break;
            }
            case 'inside':
                target.children ??= [];
                if (target.open === false)
                    target.children.push(...moving);
                else
                    target.children.unshift(...moving);
                break;
            case 'inside-end':
            case 'column-end':
                (target.children ??= []).push(...moving);
                break;
            case 'right': {
                const col = { id: ulid(), type: 'column', width: 1, children: moving };
                if (dst.parent?.type === 'column') {
                    // already in columns: a new column next to this one
                    const cl = this.index.get(dst.parent.id);
                    cl.arr.splice(cl.arr.indexOf(dst.parent) + 1, 0, col);
                }
                else {
                    const i = dst.arr.indexOf(target);
                    dst.arr.splice(i, 1, { id: ulid(), type: 'columns', children: [{ id: ulid(), type: 'column', width: 1, children: [target] }, col] });
                }
                break;
            }
        }
        this.normalizeColumns(this.blocks);
        this.selected = new Set(ids.length > 1 ? ids : []);
        this.changed();
    }
}
/** the element that forms a block's first row, by block type */
const FIRST_ROW = {
    view: ':scope > .dbview .vtoolbar', toggle: ':scope > .toggle-row', callout: ':scope > .callout', table: 'tr', button: '.nbutton',
    pagelink: '.pagelink', divider: 'hr', embed: '.bm-ico, .embed-bar', file: '.file-card', code: 'pre .txt, .txt, pre', image: 'img', pdf: ':scope > :not(.handle)',
    audio: ':scope > :not(.handle)', video: ':scope > :not(.handle)', columns: '.column .block .txt, .column .block',
};
/** Callouts: the icon, the grip and the fold chevron sit centred on the first line of text
 *  (measured, so it fits headings, bold titles and every density). */
let fontsSettled = false;
function alignCallouts(root) {
    for (const box of root.querySelectorAll('.callout')) {
        const first = box.querySelector(':scope > .blocks > .block:first-child');
        const txt = first?.querySelector('.txt') ?? null;
        const br = box.getBoundingClientRect();
        if (!br.height)
            continue;
        let mid;
        if (txt) {
            const cs = getComputedStyle(txt);
            const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
            mid = txt.getBoundingClientRect().top + parseFloat(cs.paddingTop || '0') + line / 2 - br.top - 1; // 1 px up: optical centre of the text
        }
        else if (first) {
            const fr = first.getBoundingClientRect();
            mid = fr.top - br.top + Math.min(fr.height, 40) / 2;
        }
        else
            continue;
        const icon = box.querySelector(':scope > .callout-icon');
        if (icon) {
            const pad = parseFloat(getComputedStyle(box).paddingTop) || 0;
            icon.style.marginTop = `${Math.max(0, Math.round(mid - pad - icon.offsetHeight / 2))}px`;
        }
        box.style.setProperty('--fold-top', `${Math.round(mid - 12)}px`);
    }
}
function placeHandle(wrap, handle, type) {
    if (wrap.classList.contains('tile') || handle.parentElement !== wrap) {
        handle.style.top = '';
        return;
    } // large tiles: the grip sits inside, centred by CSS
    const target = wrap.querySelector(FIRST_ROW[type] ?? ':scope > .txt, :scope > .row .txt, .txt') ?? wrap;
    const tr = target.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
    // centre the grip (not the whole handle box) on the row
    const grip = handle.querySelector('.grip') ?? handle;
    const hr = handle.getBoundingClientRect(), gr = grip.getBoundingClientRect();
    const gripMid = gr.height ? gr.top - hr.top + gr.height / 2 : 12;
    let mid;
    if (target.classList.contains('txt')) {
        const cs = getComputedStyle(target);
        const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
        mid = tr.top + parseFloat(cs.paddingTop || '0') + line / 2;
    }
    else if (type === 'callout') {
        // callouts: the line of the icon
        const icon = target.querySelector('.callout-icon');
        const ir = icon?.getBoundingClientRect();
        mid = ir ? ir.top + ir.height / 2 : tr.top + 20;
    }
    else
        mid = tr.height > 44 ? tr.top + 16 : tr.top + tr.height / 2;
    handle.style.top = `${Math.round(mid - wr.top - gripMid)}px`;
}
/** For text fields outside the editor (page and entry titles): the same replacements while typing
    (-> → …), and Backspace right after one brings back what was typed. */
export function enableAutoReplace(el) {
    let last = null;
    el.addEventListener('input', (e) => {
        last = null;
        if (e.inputType !== 'insertText')
            return;
        const sel = getSelection();
        const node = sel?.anchorNode;
        if (!sel || !sel.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !el.contains(node))
            return;
        const text = node, off = sel.anchorOffset, before = text.data.slice(0, off);
        for (const [from, to] of autoReplacements(before)) {
            if (!before.endsWith(from))
                continue;
            text.data = before.slice(0, -from.length) + to + text.data.slice(off);
            const at = off - from.length + to.length;
            const r = document.createRange();
            r.setStart(text, at);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            last = { node: text, at, from, to };
            el.dispatchEvent(new Event('input', { bubbles: true })); // listeners save the new text
            last = { node: text, at, from, to };
            return;
        }
    });
    el.addEventListener('keydown', (e) => {
        const lr = last;
        last = null;
        if (e.key !== 'Backspace' || !lr)
            return;
        const sel = getSelection();
        if (!sel?.isCollapsed || sel.anchorNode !== lr.node || sel.anchorOffset !== lr.at || lr.node.data.slice(lr.at - lr.to.length, lr.at) !== lr.to)
            return;
        e.preventDefault();
        lr.node.data = lr.node.data.slice(0, lr.at - lr.to.length) + lr.from + lr.node.data.slice(lr.at);
        const r = document.createRange();
        r.setStart(lr.node, lr.at - lr.to.length + lr.from.length);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, true);
}
/** typed → replaced (longest first where they overlap) */
/** the replacements for the text before the caret: the fixed ones, and ½ ⅓ ¼ – "1/2" becomes ½ once a space or
    punctuation follows (so dates like 1/2/2026 and 1/25 stay as typed) */
function autoReplacements(before) {
    const m = /(?:^|[^\w/])(1\/([234]))([ .,;:!?)\]])$/.exec(before);
    return m ? [[m[1] + m[3], { 2: '½', 3: '⅓', 4: '¼' }[m[2]] + m[3]], ...AUTO_REPLACE] : AUTO_REPLACE;
}
const AUTO_REPLACE = [
    ['←>', '↔'], ['->', '→'], ['<-', '←'], ['=>', '⇒'], ['<=', '≤'], ['>=', '≥'], ['!=', '≠'],
    ['--', '—'], ['(c)', '©'], ['(C)', '©'], ['(r)', '®'], ['(R)', '®'], ['(tm)', '™'], ['(TM)', '™'],
];
function cloneBlock(b) {
    return { ...b, id: ulid(), children: b.children?.map(cloneBlock) };
}
// ---------- caret utilities ----------
function hasSelection() { const s = getSelection(); return !!s && !s.isCollapsed; }
function caretOffset(el) {
    const s = getSelection();
    if (!s || !s.rangeCount)
        return 0;
    const r = s.getRangeAt(0).cloneRange();
    r.selectNodeContents(el);
    r.setEnd(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset);
    return r.toString().length;
}
function caretAtStart(el) { return caretOffset(el) === 0; }
function caretAtEnd(el) { return caretOffset(el) >= (el.textContent ?? '').length; }
function caretRect() {
    const s = getSelection();
    if (!s || !s.rangeCount)
        return null;
    const r = s.getRangeAt(0).getClientRects();
    return r.length ? r[0] : null;
}
function caretOnFirstLine(el) {
    if (caretAtStart(el))
        return true;
    const c = caretRect();
    if (!c)
        return true;
    return c.top - el.getBoundingClientRect().top < 14;
}
function caretOnLastLine(el) {
    if (caretAtEnd(el))
        return true;
    const c = caretRect();
    if (!c)
        return true;
    return el.getBoundingClientRect().bottom - c.bottom < 14;
}
export function placeCaret(el, at) {
    const sel = getSelection();
    if (!sel)
        return;
    const range = document.createRange();
    if (at === 'start' || at === 'end') {
        range.selectNodeContents(el);
        range.collapse(at === 'start');
    }
    else {
        let left = at;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        if (!node) {
            range.selectNodeContents(el);
            range.collapse(false);
        }
        while (node) {
            const len = node.textContent?.length ?? 0;
            if (left <= len) {
                range.setStart(node, left);
                range.collapse(true);
                break;
            }
            left -= len;
            const next = walker.nextNode();
            if (!next) {
                range.setStart(node, len);
                range.collapse(true);
            }
            node = next;
        }
    }
    sel.removeAllRanges();
    sel.addRange(range);
}
/** which viewer a dropped file gets, or null for a plain file attachment */
function mediaKind(f) {
    const t = f.type, n = f.name.toLowerCase();
    if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|avif|heic)$/.test(n))
        return 'image';
    if (t === 'application/pdf' || n.endsWith('.pdf'))
        return 'pdf';
    if (t.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg|flac|aiff?)$/.test(n))
        return 'audio';
    if (t.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/.test(n))
        return 'video';
    return null;
}
function fileIcon(name) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext))
        return 'archive';
    if (['mp3', 'm4a', 'wav', 'aac', 'flac', 'aif', 'aiff', 'ogg'].includes(ext))
        return 'music';
    if (['mp4', 'mov', 'webm', 'mkv', 'm4v'].includes(ext))
        return 'video';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext))
        return 'image';
    if (['js', 'ts', 'py', 'json', 'html', 'css', 'swift', 'rs'].includes(ext))
        return 'code';
    if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext))
        return 'table';
    return 'file-text';
}
/** numbered lists as in Notion: 1. → a. → i. by depth */
function numLabel(n, depth) {
    const d = depth % 3;
    if (d === 1) {
        let s = '';
        let x = n;
        while (x > 0) {
            x--;
            s = String.fromCharCode(97 + (x % 26)) + s;
            x = Math.floor(x / 26);
        }
        return s;
    }
    if (d === 2) {
        const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
        let s = '', x = n;
        for (const [v, r] of map)
            while (x >= v) {
                s += r;
                x -= v;
            }
        return s;
    }
    return String(n);
}
/** the assets/ file a block shows (image, PDF, audio, video, file) – none for links */
function assetOf(b) {
    return ['image', 'pdf', 'audio', 'video', 'file'].includes(b.type) && b.src && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(b.src) && !/\.(md|json)$/i.test(b.src) ? b.src : undefined;
}
/** every block of a tree; `skip`: ids whose subtree is left out */
function walkTree(blocks, fn, skip) {
    for (const b of blocks) {
        if (skip?.has(b.id))
            continue;
        fn(b);
        if (b.children)
            walkTree(b.children, fn, skip);
    }
}
/** blocks copied or cut in Nook (Ctrl+C / Ctrl+X), so pasting gives the same blocks back */
let blockClip = null;
const normClip = (t) => t.replace(/\r\n/g, '\n').trim();
/** is `id` somewhere below `ancestor` in the page tree? */
function isDescendantPage(ws, id, ancestor) {
    const seen = new Set();
    for (let p = ws.pages.get(id); p?.parent && !seen.has(p.parent); p = ws.pages.get(p.parent)) {
        if (p.parent === ancestor)
            return true;
        seen.add(p.parent);
    }
    return false;
}
// the page preview widget draws a page read-only with the editor
setPreviewRenderer((host, blocks, app) => { const ed = new Editor(blocks, app, () => { }, true); host.append(ed.el); });
// An inline reminder (“🔔 Tue 09:00”) is one piece: Backspace / Delete next to it removes it whole,
// typing inside it goes after it instead of changing its letters.
const REM = 'a[href^="nook:remind:"]';
document.addEventListener('beforeinput', (e) => {
    const ie = e;
    const sel = getSelection();
    if (!sel || !sel.rangeCount)
        return;
    const r = sel.getRangeAt(0);
    const host = (r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement)?.closest('[contenteditable="true"]');
    if (!host)
        return;
    const inside = (n) => (n instanceof Element ? n : n.parentElement)?.closest(REM) ?? null;
    const isRem = (n) => n instanceof HTMLElement && n.matches(REM);
    const sibling = (back) => {
        if (!r.collapsed)
            return null;
        let n = r.startContainer, off = r.startOffset;
        if (n.nodeType === Node.TEXT_NODE) {
            const len = (n.textContent ?? '').length;
            if (back ? off > 0 : off < len) {
                // only a no-break space between caret and the chip counts as "right next to it"
                const t = n.textContent ?? '';
                if (back && off === 1 && t[0] === ' ' && isRem(n.previousSibling))
                    return n.previousSibling;
                return null;
            }
            n = back ? n.previousSibling : n.nextSibling;
        }
        else
            n = n.childNodes[back ? off - 1 : off] ?? null;
        while (n && n.nodeType === Node.TEXT_NODE && !(n.textContent ?? ''))
            n = back ? n.previousSibling : n.nextSibling;
        return isRem(n) ? n : null;
    };
    const kill = (a) => {
        e.preventDefault();
        const next = a.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE && (next.textContent ?? '').startsWith(' '))
            next.textContent = (next.textContent ?? '').slice(1);
        const at = document.createRange();
        at.setStartBefore(a);
        at.collapse(true);
        a.remove();
        sel.removeAllRanges();
        sel.addRange(at);
        host.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const inRem = inside(r.startContainer) ?? inside(r.endContainer);
    if (ie.inputType.startsWith('delete')) {
        if (inRem) {
            kill(inRem);
            return;
        }
        const a = sibling(ie.inputType.includes('Backward'));
        if (a)
            kill(a);
    }
    else if (ie.inputType.startsWith('insert') && inRem) {
        // type after the chip
        const at = document.createRange();
        at.setStartAfter(inRem);
        at.collapse(true);
        sel.removeAllRanges();
        sel.addRange(at);
    }
}, true);
/** bare web addresses in a line (not already links, not in code) → links; true if any changed */
function linkifyIn(el) {
    const RE = /\b(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'’”]|www\.[a-z0-9-]+\.[^\s<>"]*[^\s<>".,;:!?)\]'’”])/gi;
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const pe = n.parentElement;
        if (pe && !pe.closest('a, code, [contenteditable="false"]'))
            texts.push(n);
    }
    let changed = false;
    for (const t of texts) {
        const str = t.data;
        RE.lastIndex = 0;
        if (!RE.test(str))
            continue;
        RE.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        for (let m = RE.exec(str); m; m = RE.exec(str)) {
            frag.append(str.slice(last, m.index));
            const url = m[0];
            const a = document.createElement('a');
            a.href = /^www\./i.test(url) ? `https://${url}` : url;
            a.textContent = url;
            frag.append(a);
            last = m.index + url.length;
        }
        frag.append(str.slice(last));
        t.replaceWith(frag);
        changed = true;
    }
    return changed;
}
//# sourceMappingURL=editor.js.map