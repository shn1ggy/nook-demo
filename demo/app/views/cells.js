import { monthsGrid, yearsGrid, crumbParts, stepNav } from '../ui/zoomcal.js';
import { prepareUpload } from '../ui/compress.js';
import { Database } from '../workspace.js';
import { iconSvg, renderIcon } from '../ui/icons.js';
import { safeHref, openOrDownload, COLORS, ICONS, WEEKDAYS, asDate, checkbox, debounce, dayNum, dateEl, fmtDate, fmtDay, fmtNumber, fmtTime, h, isoFromDay, pad2, parseDateInput, parseNumber, parseTime, svgIcon, todayISO, weekStart, nextTagColor } from '../util.js';
import { menu, openPop, prompt } from '../ui/pop.js';
import { singleOptionEntries } from './propmenu.js';
import { switchControl } from '../ui/settings.js';
import { plainText } from '../format/inline.js';
import { iconKind, FILE_KINDS } from '../filedb.js';
const TYPE_ICON = {
    title: 'type', text: 'align-left', number: 'hash', select: 'circle-dot', multi_select: 'tags', date: 'calendar', checkbox: 'check-square',
    url: 'link', formula: 'sigma', created_time: 'clock', last_edited_time: 'clock', files: 'paperclip', email: 'mail', phone: 'smartphone',
    relation: 'external', rollup: 'search',
};
/** small property-type icon used in headers and menus */
export function typeIcon(t, custom) {
    const s = h('span', { class: 'th-ico' });
    s.appendChild(custom ? renderIcon(custom, 14) : iconSvg(TYPE_ICON[t] ?? 'type', 14));
    return s;
}
export const TYPE_LABEL = {
    title: 'Title', text: 'Text', number: 'Number', select: 'Select', multi_select: 'Multi-select', date: 'Date',
    checkbox: 'Checkbox', url: 'URL', formula: 'Formula', created_time: 'Created time', last_edited_time: 'Last edited time', files: 'Files & media', email: 'Email', phone: 'Phone',
    relation: 'Relation', rollup: 'Rollup',
};
/** how a linked entry opens when its chip is clicked; set by the app */
let rowOpener = () => { };
export function setRowOpener(fn) { rowOpener = fn; }
/** how assets (assets/…) become URLs; set by the app for the open workspace */
let assetUrl = async (p) => p;
export function setAssetResolver(fn) { assetUrl = fn; }
async function openAsset(path) {
    try {
        if (/^https?:/i.test(path)) {
            window.open(path, '_blank', 'noopener');
            return;
        }
        if (/^data:/i.test(path))
            return; // never opened as a page
        const url = /^blob:/.test(path) ? path : await assetUrl(path);
        openOrDownload(url + (url.includes('/api/fs/raw?') ? `&name=${encodeURIComponent(fileName(path))}` : ''), fileName(path));
    }
    catch { /* missing file */ }
}
const fileName = (p) => decodeURIComponent(p.split('/').pop() ?? p).replace(/^[a-z0-9]{6}-/, '');
export function tag(name, color) {
    return h('span', { class: 'tag', style: { background: COLORS[color]?.tag ?? COLORS.default.tag } }, name);
}
export function renderValue(db, def, v) {
    // a checkbox is always there, also before it was ever ticked
    if (def?.type === 'checkbox' && (v == null || v === ''))
        return checkbox(false);
    if (v == null || v === '')
        return '';
    const type = def?.type ?? 'text';
    switch (type) {
        case 'select': return tag(String(v), db.optionColor(def.name, String(v)));
        case 'multi_select': {
            const arr = optOrder(def, Array.isArray(v) ? v.map(String) : [String(v)]);
            return h('span', { class: 'tags' }, arr.map((x) => tag(x, db.optionColor(def.name, x))));
        }
        case 'date':
        case 'created_time':
        case 'last_edited_time': return dateEl(asDate(v), def?.dateFormat, def?.weekday);
        case 'checkbox': return checkbox(v === true);
        case 'files': {
            const arr = Array.isArray(v) ? v : [String(v)];
            return h('span', { class: 'file-chips' }, arr.map((f) => h('a', { class: 'file-chip', href: '#', title: `Open ${fileName(f)}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); openAsset(f); } }, iconSvg('paperclip', 12), fileName(f))));
        }
        case 'number': return typeof v === 'number' ? (def?.format === 'stars' ? h('span', { class: 'stars', title: `${fmtNumber(v)} of 5` }, fmtNumber(v, 'stars')) : fmtNumber(v, def?.format)) : String(v);
        case 'relation': {
            const target = def?.relation ? Database.lookup(def.relation.db) : undefined;
            const ids = Array.isArray(v) ? v : [String(v)];
            const rows = target ? ids.map((id) => target.byId(String(id))).filter((r) => !!r) : [];
            if (!target || !rows.length)
                return '';
            return h('span', { class: 'rel-chips' }, rows.map((r) => h('a', { class: 'rel-chip', href: '#', title: `Open ${entryTitle(target, r).text}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); rowOpener(target, r); } }, r.icon ? renderIcon(r.icon, 13) : iconSvg('file-text', 13), h('span', null, entryTitle(target, r).text))));
        }
        case 'rollup': {
            const fn = def?.rollup?.fn;
            if (typeof v === 'number')
                return fn === 'percent_checked' ? fmtNumber(v, 'percent') : fn === 'count' || fn === 'count_values' ? String(v) : fmtNumber(v, rollupFormat(db, def));
            if (Array.isArray(v))
                return h('span', { class: 'tags' }, v.map((x) => h('span', { class: 'rollup-item' }, String(x))));
            if (typeof v === 'object')
                return fmtDate(v);
            return String(v);
        }
        case 'email': return h('a', { href: `mailto:${String(v)}`, onclick: (e) => e.stopPropagation() }, String(v));
        case 'phone': return h('a', { href: `tel:${String(v).replace(/[^\d+]/g, '')}`, onclick: (e) => e.stopPropagation() }, String(v));
        case 'url': return h('a', { href: safeHref(String(v)), target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, String(v).replace(/^https?:\/\//, ''));
        case 'formula':
            if (typeof v === 'number')
                return fmtNumber(v, def?.format);
            if (typeof v === 'boolean')
                return v ? '✓' : '';
            if (typeof v === 'object' && !Array.isArray(v))
                return fmtDate(v);
            return String(v);
        case 'text': {
            // keeps line breaks (shown when the column wraps, and on entry pages)
            const s = String(Array.isArray(v) ? v.join(', ') : v);
            return s.includes('\n') ? h('span', { class: 'mltext' }, s) : s;
        }
        default: return String(Array.isArray(v) ? v.join(', ') : v);
    }
}
/** An entry's name; entries without one show the first line of their page (greyed out). */
export function entryTitle(db, row) {
    if (db.dateLabel)
        return { text: db.rowLabel(row), derived: false };
    const t = plainText(String(row.values[db.titleProp] ?? '')).trim();
    if (t)
        return { text: t, derived: false };
    // pictures, embeds and other blocks without words don't count
    const first = row.body.split('\n').map((l) => plainText(l.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, '').replace(/^[#>\-*\s[\]x|]+/, '')).trim()).find(Boolean);
    return first ? { text: first.slice(0, 80), derived: true } : { text: 'Untitled', derived: true };
}
/** an entry's icon in views: its own, or (as in Notion) a page icon once it has content of its own */
export function entryIcon(row, size) {
    if (row.rel != null) {
        const k = iconKind(row.rel, row.isDir);
        return h('span', { class: `auto-icon file-ico fk-${k}`, ...(k === 'audio' ? { 'data-np': row.rel } : {}) }, iconSvg(FILE_KINDS.find((x) => x.key === k).icon, size));
    }
    if (row.icon)
        return renderIcon(row.icon, size);
    if (!row.body?.trim())
        return null;
    return h('span', { class: 'auto-icon' }, iconSvg('file-text', size));
}
export function titleEl(db, row, cls = '') {
    const t = entryTitle(db, row);
    const el = h('span', { class: cls + (t.derived ? ' derived-title' : '') }, t.text);
    // repeating entries show ↻ in every view (the calendar shows each date)
    if (row.repeat && repeatOn(db))
        el.append(h('span', { class: 'repeat-mark', title: 'Repeats' }, iconSvg('repeat', 12)));
    return el;
}
/** Is the Repeat feature switched on for this database? (needs a date property) */
export function repeatOn(db) { return db.schema.repeat !== false && db.schema.properties.some((p) => p.type === 'date'); }
/** Nudge the popover just opened over `cell` so its first value sits exactly on the cell's first value
 *  (the first tag on the first tag, the text on the text). */
function alignOver(cell, target) {
    const pop = [...document.querySelectorAll('.pop')].pop();
    if (!pop)
        return;
    const t = target(pop);
    if (!t)
        return;
    // what the cell shows first: its first tag, else its first piece of text, else its own box
    const tagEl = cell.querySelector('.tag');
    let src = tagEl ? tagEl.getBoundingClientRect() : null;
    if (!src) {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
        const n = walker.nextNode();
        if (n) {
            const r = document.createRange();
            r.selectNodeContents(n);
            src = r.getBoundingClientRect();
        }
    }
    if (!src) {
        const cs = getComputedStyle(cell), b = cell.getBoundingClientRect();
        src = new DOMRect(b.left + parseFloat(cs.paddingLeft), b.top + (b.height - 20) / 2, 0, 20);
    }
    const dst = t.el.getBoundingClientRect();
    const dx = src.left - (dst.left + (t.dx ?? 0));
    const dy = (src.top + src.height / 2) - (dst.top + (t.dy ?? dst.height / 2));
    const left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, pop.offsetLeft + dx));
    const top = Math.max(8, Math.min(innerHeight - pop.offsetHeight - 8, pop.offsetTop + dy));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
}
/** pickers: the first chosen option on the cell's first option (nothing chosen: the search text on the cell's text) */
function alignFirst(cell, input) {
    alignOver(cell, (pop) => {
        const chip = pop.querySelector('.opt-chip-tag');
        if (chip)
            return { el: chip };
        const cs = getComputedStyle(input);
        return { el: input, dx: parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) };
    });
}
/** Text editor: a box that grows with the text; ↵ saves, ⇧↵ starts a new line, Esc cancels. */
function textEditor(v, cell, set, move, initial) {
    const ta = h('textarea', { class: 'text-edit', rows: 1, 'aria-label': 'Text' });
    ta.value = initial ?? (v == null ? '' : String(v));
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(360, ta.scrollHeight + 2)}px`; };
    let done = false;
    const finish = (commit) => { if (done)
        return; done = true; close(); if (commit)
        set(ta.value.replace(/\s+$/, '') || null); };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            move?.('down');
            finish(true);
        }
        else if (e.key === 'Tab') {
            e.preventDefault();
            move?.(e.shiftKey ? 'left' : 'right');
            finish(true);
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        }
    });
    const box = h('div', { class: 'text-edit-box', style: { width: `${Math.max(260, cell.getBoundingClientRect().width)}px` } }, ta);
    // the field sits on the row being edited
    const close = openPop(cell, box, () => finish(true), { over: 7 });
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    grow();
    // the text in the field starts where the cell's text was
    alignOver(cell, () => { const cs = getComputedStyle(ta); const lh = parseFloat(cs.lineHeight) || 20; return { el: ta, dx: parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), dy: parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth) + lh / 2 }; });
}
/**
 * `opts.onMove`: like a spreadsheet – Enter saves and goes to the row below, Tab to the next column
 * (⇧ the other way); `opts.initial`: typing on a selected cell starts editing with that text.
 */
export function editValue(ws, db, row, prop, cell, done, opts = {}) {
    const def = db.prop(prop);
    if (!def || def.file)
        return;
    let then = null;
    const move = opts.onMove ? (d) => { then = d; } : undefined;
    const set = async (v) => {
        if (v === null || v === '')
            delete row.values[prop];
        else
            row.values[prop] = v;
        ws.boundary();
        await ws.saveRow(db, row);
        done();
        if (then)
            opts.onMove(then);
    };
    switch (def.type) {
        case 'formula':
        case 'created_time':
        case 'last_edited_time':
        case 'rollup': return;
        case 'relation': return relationMenu(ws, db, def, row, cell, done);
        case 'checkbox': {
            // the tick shows (with its little animation) right away; saved a moment later
            const on = !(row.values[prop] === true), box = cell.querySelector('.cb');
            if (box) {
                box.classList.toggle('on', on);
                if (on)
                    box.classList.add('cb-anim');
                setTimeout(() => void set(on), on ? 260 : 0);
            }
            else
                void set(on);
            return;
        }
        case 'select': return selectMenu(ws, db, def, row, cell, set);
        case 'multi_select': return multiMenu(ws, db, def, row, cell, set);
        case 'date': return dateEditor(row.values[prop], cell, set);
        case 'files': return filesMenu(ws, row.values[prop], cell, set, ws.rowPath(db, row));
        case 'text': return textEditor(row.values[prop], cell, set, move, opts.initial);
        default: {
            const cur = row.values[prop];
            const input = h('input', { class: 'cell-edit', value: opts.initial ?? (cur == null ? '' : def.type === 'number' ? String(cur).replace('.', ',') : String(cur)) });
            const old = [...cell.childNodes];
            cell.textContent = '';
            cell.appendChild(input);
            input.focus();
            if (opts.initial !== undefined)
                input.setSelectionRange(input.value.length, input.value.length);
            else
                input.select();
            let finished = false;
            const finish = (commit) => {
                if (finished)
                    return;
                finished = true;
                if (!commit) {
                    cell.textContent = '';
                    old.forEach((n) => cell.appendChild(n));
                    done();
                    return;
                }
                const raw = input.value;
                set(def.type === 'number' ? parseNumber(raw) : raw.trim() === '' ? null : raw);
            };
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    move?.(e.shiftKey ? 'up' : 'down');
                    finish(true);
                }
                else if (e.key === 'Escape') {
                    e.preventDefault();
                    finish(false);
                }
                else if (e.key === 'Tab') {
                    e.preventDefault();
                    move?.(e.shiftKey ? 'left' : 'right');
                    finish(true);
                }
            });
            input.addEventListener('blur', () => finish(true));
        }
    }
}
/** a chosen option with its ×, at the top of the pickers */
const optChip = (name, color, remove) => h('span', { class: 'opt-chip' }, h('span', { class: 'tag opt-chip-tag', style: { background: COLORS[color]?.tag ?? COLORS.default.tag } }, name, h('button', { class: 'opt-x', 'aria-label': `Remove ${name}`, title: 'Remove', onclick: (e) => { e.stopPropagation(); remove(); } }, svgIcon(ICONS.close, 12))));
const optGrip = () => h('span', { class: 'opt-grip', 'aria-hidden': 'true' }, svgIcon(ICONS.grip, 14, { fill: true }));
/** Drag an option up or down to change the order of the property's options – used by every view
 *  (board columns, sorting by this property, pickers), as in Notion. */
function dragOption(el, ws, db, def, name, enabled, redraw) {
    if (!enabled)
        return el;
    el.draggable = true;
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-nook-option', name); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes('text/x-nook-option'))
            return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        el.classList.toggle('drop-before', e.clientY < r.top + r.height / 2);
        el.classList.toggle('drop-after', e.clientY >= r.top + r.height / 2);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', async (e) => {
        const from = e.dataTransfer?.getData('text/x-nook-option');
        const after = el.classList.contains('drop-after');
        el.classList.remove('drop-before', 'drop-after');
        if (!from || from === name)
            return;
        e.preventDefault();
        await moveOption(ws, db, def, from, name, after);
        redraw();
    });
    return el;
}
/** Move option `from` before / after option `to`, saved in the database (all views follow). */
export async function moveOption(ws, db, def, from, to, after) {
    const opts = def.options ?? [];
    const o = opts.find((x) => x.name === from);
    if (!o || from === to)
        return;
    const rest = opts.filter((x) => x !== o);
    const i = rest.findIndex((x) => x.name === to);
    if (i < 0)
        return;
    rest.splice(i + (after ? 1 : 0), 0, o);
    def.options = rest;
    ws.boundary();
    await ws.saveSchema(db);
    ws.emit();
}
function selectMenu(ws, db, def, row, cell, set) {
    const box = h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: '240px' } });
    const input = h('input', { class: 'pop-input', placeholder: 'Search or create an option…' });
    const list = h('div', { class: 'opt-list', style: { display: 'flex', flexDirection: 'column' } });
    // the chosen option sits on top with its × (removing it clears the value)
    const chips = h('div', { class: 'opt-chips' });
    box.append(chips, input, list);
    let hi = 0;
    const render = () => {
        const q = input.value.trim();
        const curV = row.values[def.name];
        chips.replaceChildren(...(curV != null && curV !== '' ? [optChip(String(curV), db.optionColor(def.name, String(curV)), () => { close(); set(null); })] : []));
        chips.style.display = chips.childElementCount ? '' : 'none';
        list.textContent = '';
        const opts = (def.options ?? []).filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
        const items = [];
        // typing a new name: "Create" comes first, so Enter creates it (as in Notion)
        const exact = (def.options ?? []).find((o) => o.name.toLowerCase() === q.toLowerCase());
        if (q && !exact) {
            items.push(h('button', { class: 'pop-item', onclick: async () => {
                    close();
                    const color = nextTagColor((def.options?.length ?? 0));
                    (def.options ??= []).push({ name: q, color });
                    ws.boundary();
                    await ws.saveSchema(db);
                    set(q);
                } }, h('span', { class: 'muted' }, 'Create'), tag(q, nextTagColor((def.options?.length ?? 0)))));
        }
        if (exact)
            opts.sort((a, b) => (a === exact ? -1 : b === exact ? 1 : 0));
        for (const o of opts)
            items.push(dragOption(h('button', { class: 'pop-item opt-row', onclick: () => { close(); set(o.name); } }, optGrip(), tag(o.name, o.color), optMore(ws, db, def, o, render)), ws, db, def, o.name, !q, render));
        items.forEach((it) => list.appendChild(it));
        hi = Math.max(0, Math.min(hi, items.length - 1));
        items.forEach((it, i) => it.classList.toggle('hi', i === hi));
    };
    input.addEventListener('input', () => { hi = 0; render(); });
    input.addEventListener('keydown', (e) => {
        const items = [...list.querySelectorAll('.pop-item')];
        if (e.key === 'ArrowDown') {
            hi = Math.min(items.length - 1, hi + 1);
            render();
            e.preventDefault();
        }
        if (e.key === 'ArrowUp') {
            hi = Math.max(0, hi - 1);
            render();
            e.preventDefault();
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            items[hi]?.click();
        }
    });
    render();
    const close = openPop(cell, box, undefined, { over: 9 });
    alignFirst(cell, input);
    focusField(input);
}
/** Files & media: open or remove files, upload new ones (copied into assets/), or add a link. */
function filesMenu(ws, v, cell, set, owner) {
    const cur = Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
    const entries = cur.map((f) => ({
        label: fileName(f), icon: iconSvg('paperclip', 14),
        sub: () => [
            { label: 'Open', run: () => openAsset(f) },
            { label: 'Remove', danger: true, run: () => set(cur.filter((x) => x !== f)) },
        ],
    }));
    if (cur.length)
        entries.push('sep');
    const pick = (accept) => {
        const input = h('input', { type: 'file', multiple: true, accept, style: { display: 'none' } });
        input.addEventListener('change', async () => {
            const added = [];
            const picked = await prepareUpload([...(input.files ?? [])], ws.settings.compress);
            for (const f of picked ?? []) {
                const path = ws.newFilePath(owner, f.name);
                if (ws.storage.writeBinary) {
                    await ws.writeFile(path, new Uint8Array(await f.arrayBuffer()));
                    added.push(path);
                }
            }
            input.remove();
            if (added.length)
                set([...cur, ...added]);
        });
        document.body.appendChild(input);
        input.click();
    };
    // a photo: on a phone this offers the camera and the photo library
    entries.push({ label: 'Photo…', icon: iconSvg('camera', 14), run: () => pick('image/*') }, { label: 'File…', icon: iconSvg('paperclip', 14), run: () => pick() }, { label: 'Add a link…', icon: iconSvg('link', 14), run: () => prompt(cell, 'Link to a file', 'https://', (u) => { if (/^https?:\/\/./.test(u.trim()))
            set([...cur, u.trim()]); }) });
    menu(cell, entries);
}
/** "⋯" on an option in the value picker: rename, colour, reorder, delete (the picker stays open). */
function optMore(ws, db, def, o, refresh) {
    const btn = h('span', { class: 'opt-more', role: 'button', title: 'Edit option', 'aria-label': `Edit option ${o.name}` }, svgIcon(ICONS.more, 16, { fill: true }));
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const r = btn.getBoundingClientRect();
        const box = btn.closest('.pop').getBoundingClientRect();
        menu(btn, singleOptionEntries(ws, db, def, o, btn, refresh), { side: { item: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, menu: { left: box.left, right: box.right, top: box.top, bottom: box.bottom } }, depth: 1 });
    });
    return btn;
}
/** Multi-select: same search / create field as select; stays open to pick several. */
function multiMenu(ws, db, def, row, cell, set) {
    const cur = Array.isArray(row.values[def.name]) ? [...row.values[def.name]] : [];
    const box = h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: '260px' } });
    const chips = h('div', { class: 'opt-chips' });
    const input = h('input', { class: 'pop-input', placeholder: 'Search or create an option…' });
    const list = h('div', { class: 'opt-list', style: { display: 'flex', flexDirection: 'column' } });
    box.append(chips, input, list);
    let hi = 0;
    const commit = () => set(optOrder(def, cur));
    const toggle = (name) => { const i = cur.indexOf(name); if (i >= 0)
        cur.splice(i, 1);
    else
        cur.push(name); render(); };
    const render = () => {
        chips.textContent = '';
        for (const n of cur)
            chips.appendChild(optChip(n, db.optionColor(def.name, n), () => toggle(n)));
        chips.style.display = cur.length ? '' : 'none';
        const q = input.value.trim();
        list.textContent = '';
        const items = [];
        const exact = (def.options ?? []).find((o) => o.name.toLowerCase() === q.toLowerCase());
        if (q && !exact)
            items.push(h('button', { class: 'pop-item', onclick: async () => {
                    const color = nextTagColor((def.options?.length ?? 0));
                    (def.options ??= []).push({ name: q, color });
                    ws.boundary();
                    await ws.saveSchema(db);
                    cur.push(q);
                    input.value = '';
                    hi = 0;
                    render();
                    input.focus();
                } }, h('span', { class: 'muted' }, 'Create'), tag(q, nextTagColor((def.options?.length ?? 0)))));
        for (const o of (def.options ?? []).filter((o) => o.name.toLowerCase().includes(q.toLowerCase()))) {
            items.push(dragOption(h('button', { class: 'pop-item opt-row', onclick: () => { toggle(o.name); input.value = ''; focusField(input); } }, optGrip(), tag(o.name, o.color), optMore(ws, db, def, o, () => { for (let k = cur.length - 1; k >= 0; k--)
                if (!(def.options ?? []).some((x) => x.name === cur[k]))
                    cur.splice(k, 1); render(); })), ws, db, def, o.name, !q, render));
        }
        items.forEach((it) => list.appendChild(it));
        hi = Math.max(0, Math.min(hi, items.length - 1));
        items.forEach((it, i) => it.classList.toggle('hi', i === hi));
    };
    input.addEventListener('input', () => { hi = 0; render(); });
    input.addEventListener('keydown', (e) => {
        const items = [...list.querySelectorAll('.pop-item')];
        if (e.key === 'ArrowDown') {
            hi = Math.min(items.length - 1, hi + 1);
            render();
            e.preventDefault();
        }
        else if (e.key === 'ArrowUp') {
            hi = Math.max(0, hi - 1);
            render();
            e.preventDefault();
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            items[hi]?.click();
        }
        else if (e.key === 'Backspace' && !input.value && cur.length) {
            cur.pop();
            render();
        }
    });
    render();
    openPop(cell, box, commit, { over: 9 });
    alignFirst(cell, input);
    focusField(input);
}
/**
 * Date picker (as in Notion): typed dates in the workspace's date format, a month grid to click,
 * optional time (24h/12h) and end date.
 */
/**
 * Date picker: a Start row and (when switched on) an End row, each with a date and – with
 * "Include time" – a time. The highlighted field is the one a click in the calendar fills;
 * with an end date, the first click sets the start and the next one the end.
 */
/** the date picker; `dayOnly`: one day, without end date and time (e.g. a goal's due date) */
export function dateEditor(v, cell, set, dayOnly = false, opts = {}) {
    let closeIt = () => { };
    const d = asDate(v) ?? { start: '' };
    let startDay = d.start.slice(0, 10), endDay = d.end?.slice(0, 10) ?? '';
    let withEnd = !!d.end;
    // the time field is always there: empty = the whole day, a time typed = with time
    const withTime = !dayOnly;
    let active = 'start';
    let month = (startDay || todayISO()).slice(0, 7);
    const field = (value, placeholder, label, numeric = false) => h('input', { type: 'text', class: 'dp-field', value, placeholder, 'aria-label': label, ...(numeric ? { inputmode: 'numeric' } : {}) });
    const startDate = field(startDay ? fmtDay(startDay) : '', fmtDay(todayISO()), 'Start date');
    const startTime = field(d.start.includes('T') ? fmtTime(d.start.slice(11, 16)) : '', 'Time', 'Start time', true);
    const endDate = field(endDay ? fmtDay(endDay) : '', 'End date', 'End date');
    const endTime = field(d.end && d.end.includes('T') ? fmtTime(d.end.slice(11, 16)) : '', 'Time', 'End time', true);
    const err = h('div', { class: 'dp-err' });
    const grid = h('div', { class: 'dp-grid' });
    let zoom = 'days';
    const title = h('span', { class: 'dp-title dp-crumb' });
    const hint = h('div', { class: 'dp-hint' });
    const startRow = h('div', { class: 'dp-line' }, h('span', { class: 'dp-label' }, 'Start'), startDate, startTime);
    const endRow = h('div', { class: 'dp-line' }, h('span', { class: 'dp-label' }, 'End'), endDate, endTime);
    /** one hour later than a time ("9:30" → "10:30") */
    const plusHour = (t) => { const m = Math.min(23 * 60 + 59, +t.slice(0, 2) * 60 + +t.slice(3, 5) + 60); return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };
    const layout = () => {
        endRow.style.display = withEnd ? '' : 'none';
        startTime.style.display = endTime.style.display = withTime ? '' : 'none';
        startDate.classList.toggle('active', active === 'start');
        endDate.classList.toggle('active', active === 'end' && withEnd);
        hint.textContent = withEnd ? (active === 'start' ? 'Click the first day …' : '… then the last day.') : '';
    };
    const drawGrid = () => {
        grid.textContent = '';
        const [y, m] = month.split('-').map(Number);
        const sel = startDay ? { y: +startDay.slice(0, 4), m: +startDay.slice(5, 7) } : null;
        title.replaceChildren(...crumbParts(zoom, y, m, (z) => { zoom = z; drawGrid(); }));
        grid.className = zoom === 'days' ? 'dp-grid' : 'dp-zoom';
        if (zoom === 'year') {
            grid.append(monthsGrid(y, sel, (mm) => { month = `${y}-${pad2(mm)}`; zoom = 'days'; drawGrid(); }));
            return;
        }
        if (zoom === 'years') {
            grid.append(yearsGrid(y, sel?.y ?? null, (yy) => { month = `${yy}-${pad2(m)}`; zoom = 'year'; drawGrid(); }));
            return;
        }
        const ws = weekStart();
        for (let i = 0; i < 7; i++)
            grid.appendChild(h('span', { class: 'dp-dow' }, WEEKDAYS[(i + ws) % 7].slice(0, 2)));
        const first = dayNum(`${month}-01`);
        const lead = ((new Date(first * 864e5).getUTCDay() + 6) % 7 - ws + 7) % 7;
        const today = todayISO();
        for (let i = 0; i < 42; i++) {
            const iso = isoFromDay(first - lead + i);
            const inRange = withEnd && startDay && endDay && iso > startDay && iso < endDay;
            grid.appendChild(h('button', {
                class: 'dp-day' + (iso.slice(0, 7) !== month ? ' out' : '') + (iso === today ? ' today' : '') + (iso === startDay || (withEnd && iso === endDay) ? ' on' : '') + (inRange ? ' range' : ''),
                tabindex: -1,
                onclick: () => {
                    if (withEnd && active === 'end') {
                        if (startDay && iso < startDay) {
                            endDay = startDay;
                            startDay = iso;
                        }
                        else
                            endDay = iso;
                        active = 'start';
                    }
                    else {
                        startDay = iso;
                        if (endDay && endDay < iso)
                            endDay = iso;
                        if (withEnd) {
                            if (!endDay)
                                endDay = iso;
                            active = 'end';
                        }
                    }
                    startDate.value = startDay ? fmtDay(startDay) : '';
                    endDate.value = endDay ? fmtDay(endDay) : '';
                    layout();
                    drawGrid();
                    live();
                },
            }, String(+iso.slice(8))));
        }
    };
    const step = (n) => { const [y, m] = month.split('-').map(Number); const i = y * 12 + m - 1 + n * (zoom === 'year' ? 12 : zoom === 'years' ? 144 : 1); month = `${Math.floor(i / 12)}-${pad2(i % 12 + 1)}`; drawGrid(); };
    const readDay = (input, which) => {
        const raw = input.value.trim();
        if (!raw) {
            if (which === 'start')
                startDay = '';
            else
                endDay = '';
            return true;
        }
        const p = parseDateInput(raw);
        if (!p) {
            err.textContent = `Date not understood. Try ${fmtDay(todayISO())}, "today" or "+3".`;
            return false;
        }
        err.textContent = '';
        if (which === 'start')
            startDay = p;
        else
            endDay = p;
        month = p.slice(0, 7);
        drawGrid();
        return true;
    };
    const readTime = (input) => {
        if (!input.value.trim())
            return null;
        const t = parseTime(input.value);
        if (!t) {
            err.textContent = 'Time not understood. Try 9:30 or 21:00.';
            input.focus();
            return false;
        }
        return t;
    };
    startDate.addEventListener('change', () => { if (readDay(startDate, 'start'))
        live(); });
    endDate.addEventListener('change', () => { if (readDay(endDate, 'end'))
        live(); });
    for (const t of [startTime, endTime]) {
        t.addEventListener('change', () => live());
        t.addEventListener('input', () => { if (parseTime(t.value))
            live(); });
    }
    startDate.addEventListener('focus', () => { active = 'start'; layout(); });
    endDate.addEventListener('focus', () => { active = 'end'; layout(); });
    // a start time suggests an end time one hour later
    // until the end time is typed in, it follows the start time (one hour later)
    let endTyped = !!d.end?.includes('T');
    endTime.addEventListener('input', () => { endTyped = !!endTime.value.trim(); });
    const followStart = () => { const t = readTime(startTime); if (t && withEnd && !endTyped)
        endTime.value = fmtTime(plusHour(t)); };
    startTime.addEventListener('input', () => { if (parseTime(startTime.value))
        followStart(); });
    startTime.addEventListener('change', followStart);
    const endSwitch = switchControl(withEnd, (on) => {
        withEnd = on;
        if (on) {
            if (!endDay) {
                endDay = startDay;
                endDate.value = startDay ? fmtDay(startDay) : '';
            }
            active = 'end';
            const t = withTime ? readTime(startTime) : null;
            if (t && !endTime.value.trim())
                endTime.value = fmtTime(plusHour(t));
        }
        else
            active = 'start';
        layout();
        drawGrid();
        live();
    }, 'End date');
    /** the value the picker shows right now (undefined while something can't be read) */
    const compute = (quiet) => {
        const errBefore = err.textContent;
        if (!readDay(startDate, 'start') || (withEnd && !readDay(endDate, 'end')))
            return undefined;
        if (!startDay)
            return { v: null };
        let s = startDay, e = withEnd ? endDay || startDay : '';
        if (withTime) {
            const st = quiet && !parseTime(startTime.value) && startTime.value.trim() ? false : readTime(startTime);
            if (st === false)
                return undefined;
            if (st)
                s = `${startDay}T${st}`;
            if (withEnd) {
                const et = quiet && !parseTime(endTime.value) && endTime.value.trim() ? false : readTime(endTime);
                if (et === false)
                    return undefined;
                if (et)
                    e = `${e}T${et}`;
                if (st && et && e <= s) {
                    if (!quiet) {
                        err.textContent = 'The end is before the start.';
                        endTime.focus();
                    }
                    return undefined;
                }
            }
        }
        if (withEnd && e && e < s.slice(0, e.length)) {
            if (!quiet)
                err.textContent = 'The end is before the start.';
            return undefined;
        }
        if (quiet && !errBefore)
            err.textContent = '';
        // an end on the same day without a time says nothing: it is left out
        const keepEnd = withEnd && e && e !== startDay && e !== s;
        return { v: keepEnd ? { start: s, end: e } : { start: s } };
    };
    // every change is saved right away (views update while the picker is open); Done just closes it
    let saved = JSON.stringify(v ?? null);
    const apply = (quiet) => { const r = compute(quiet); if (!r)
        return false; const j = JSON.stringify(r.v ?? null); if (j !== saved) {
        saved = j;
        set(r.v);
    } return true; };
    let closing = false;
    const live = debounce(() => { if (!closing)
        apply(true); }, 150);
    const ok = () => { if (apply(false)) {
        closing = true;
        close();
    } };
    const box = h('div', { class: 'dp dp2', onkeydown: (e) => { if (e.key === 'Enter') {
            e.preventDefault();
            ok();
        } } }, opts.top ? opts.top(() => { closing = true; closeIt(); }) : null, h('div', { class: 'dp-lines' }, startRow, endRow), h('div', { class: 'dp-head' }, title, ...stepNav({ unit: 'month', small: true, prev: () => step(-1), today: () => { month = todayISO().slice(0, 7); zoom = 'days'; drawGrid(); }, next: () => step(1) })), grid, hint, dayOnly || opts.noEnd ? null : h('div', { class: 'dp-switches' }, h('label', { class: 'dp-switch' }, h('span', null, 'End date'), endSwitch)), err, h('div', { class: 'dp-actions' }, opts.noClear ? null : h('button', { class: 'vtool', onclick: () => { closing = true; close(); if (saved !== 'null') {
            saved = 'null';
            set(null);
        } } }, 'Clear'), h('button', { class: 'btn-new', onclick: ok }, 'Done')));
    layout();
    drawGrid();
    // closing by clicking elsewhere keeps what was typed last (if it can be read)
    const close = openPop(cell, box, () => { if (!closing) {
        closing = true;
        apply(true);
    } });
    closeIt = close;
    if (opts.top)
        box.querySelector('input')?.focus();
    else {
        startDate.focus();
        startDate.select();
    }
}
/** a rollup over numbers shows them like the property it adds up (e.g. euros) */
function rollupFormat(db, def) {
    if (!def?.rollup)
        return undefined;
    if (def.format)
        return def.format;
    const rel = db.prop(def.rollup.relation);
    const target = rel?.relation ? Database.lookup(rel.relation.db) : undefined;
    return target?.prop(def.rollup.prop)?.format;
}
/** choose the linked entries: search, tick, or create a new entry in the linked database */
function relationMenu(ws, db, def, row, cell, done) {
    const target = def.relation ? ws.dbs.get(def.relation.db) : undefined;
    if (!target) {
        menu(cell, [{ label: 'The linked database no longer exists', run: () => { } }]);
        return;
    }
    const cur = Array.isArray(row.values[def.name]) ? row.values[def.name].filter((id) => target.byId(id)) : [];
    const box = h('div', { class: 'rel-pop' });
    const head = h('div', { class: 'rel-head' }, renderIcon(target.schema.icon, 14, 'database'), h('span', null, target.schema.name));
    const chips = h('div', { class: 'opt-chips' });
    const input = h('input', { class: 'pop-input', placeholder: `Search ${target.schema.name}…`, 'aria-label': `Search ${target.schema.name}` });
    const list = h('div', { class: 'rel-list' });
    box.append(head, chips, input, list);
    let hi = 0;
    const name = (r) => entryTitle(target, r).text;
    const toggle = (id) => { const i = cur.indexOf(id); if (i >= 0)
        cur.splice(i, 1);
    else
        cur.push(id); render(); };
    const render = () => {
        chips.textContent = '';
        for (const id of cur) {
            const r = target.byId(id);
            if (r)
                chips.appendChild(h('span', { class: 'opt-chip rel-chip' }, h('span', null, name(r)), h('button', { class: 'opt-x', 'aria-label': `Remove ${name(r)}`, onclick: () => toggle(id) }, '×')));
        }
        chips.style.display = cur.length ? '' : 'none';
        const q = input.value.trim().toLowerCase();
        list.textContent = '';
        const items = [];
        // linked ones first, then the most recently edited
        const pool = target.rows.filter((r) => r !== row && (!q || name(r).toLowerCase().includes(q)))
            .sort((a, b) => Number(cur.includes(b.id)) - Number(cur.includes(a.id)) || (a.edited < b.edited ? 1 : a.edited > b.edited ? -1 : 0)).slice(0, 50);
        for (const r of pool)
            items.push(h('button', { class: 'pop-item', onclick: () => { toggle(r.id); input.value = ''; focusField(input); } }, h('span', { class: 'chk' }, cur.includes(r.id) ? '✓' : ''), r.icon ? renderIcon(r.icon, 14) : iconSvg('file-text', 14), h('span', { class: 'rel-name' }, name(r))));
        if (q && !target.rows.some((r) => name(r).toLowerCase() === q))
            items.push(h('button', { class: 'pop-item', onclick: async () => {
                    ws.boundary();
                    const r = await ws.addRow(target, { [target.titleProp]: input.value.trim() });
                    cur.push(r.id);
                    input.value = '';
                    render();
                    input.focus();
                } }, h('span', { class: 'chk' }, '+'), h('span', null, `New entry “${input.value.trim()}” in ${target.schema.name}`)));
        if (!items.length)
            list.appendChild(h('div', { class: 'muted small', style: { padding: '6px 8px' } }, `No entries in ${target.schema.name}`));
        items.forEach((it) => list.appendChild(it));
        hi = Math.max(0, Math.min(hi, items.length - 1));
        items.forEach((it, i) => it.classList.toggle('hi', i === hi));
    };
    input.addEventListener('input', () => { hi = 0; render(); });
    input.addEventListener('keydown', (e) => {
        const items = [...list.querySelectorAll('.pop-item')];
        if (e.key === 'ArrowDown') {
            hi = Math.min(items.length - 1, hi + 1);
            render();
            e.preventDefault();
        }
        else if (e.key === 'ArrowUp') {
            hi = Math.max(0, hi - 1);
            render();
            e.preventDefault();
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            items[hi]?.click();
        }
        else if (e.key === 'Backspace' && !input.value && cur.length) {
            cur.pop();
            render();
        }
    });
    render();
    openPop(cell, box, async () => {
        const before = Array.isArray(row.values[def.name]) ? row.values[def.name].join() : '';
        if (before === cur.join())
            return;
        ws.boundary();
        await ws.setRelation(db, row, def.name, [...cur]);
        done();
    });
    focusField(input);
}
/** a picker's search field: focused right away with a keyboard; on a phone only when it is tapped, so the keyboard does not cover the choices */
function focusField(input) { if (!document.documentElement.classList.contains('phone'))
    input.focus(); }
/** multi-select values in the order of the property's options (unknown ones last, as they were) */
export function optOrder(def, vals) {
    const ix = new Map((def?.options ?? []).map((o, i) => [o.name, i]));
    return vals.map((v, i) => [v, ix.get(v) ?? 1e6 + i]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
}
//# sourceMappingURL=cells.js.map