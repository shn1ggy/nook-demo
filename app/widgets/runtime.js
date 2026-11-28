import { BLOCK_BG, COLORS, stepsOf, asDate, h, svgIcon, ICONS, getTimeFormat, isPhone } from '../util.js';
import { iconSvg, renderIcon } from '../ui/icons.js';
import { pickIcon } from '../ui/iconpicker.js';
import { settingIcon, menu, menuIcon, panel, prompt, toast } from '../ui/pop.js';
import { dateEditor } from '../views/cells.js';
import { openPicker, pageItems } from '../ui/pickers.js';
import { registerWidget, unregisterCustom, widgetDef } from './api.js';
const fetchCache = new Map();
const COLOR_NAMES = ['accent', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
/** the starting block for a widget */
export function newWidgetBlock(b, id) {
    const def = widgetDef(id);
    b.type = 'widget';
    b.kind = id;
    b.text = undefined;
    b.children = undefined;
    b.data = def?.defaults ? def.defaults() : {};
    if (def?.background)
        b.color = `${def.background}_bg`;
}
/** the widget's element; `save` stores the page, `readonly` for previews */
export function mountWidget(b, app, save, readonly = false) {
    const def = widgetDef(b.kind ?? '');
    const box = h('div', { class: 'widget' + (readonly ? ' w-readonly' : ''), 'data-kind': b.kind ?? '' });
    if (!def) {
        box.classList.add('widget-missing');
        box.append(iconSvg('puzzle', 18), h('span', null, `Widget “${b.kind}” isn't installed.`));
        return box;
    }
    if (!def.bare)
        box.classList.add('widget-card');
    b.data ??= def.defaults ? def.defaults() : {};
    // older sticky notes kept their colour in their data
    if (b.kind === 'note' && typeof b.data.color === 'string') {
        if (!b.color)
            b.color = `${b.data.color === 'default' ? 'yellow' : b.data.color}_bg`;
        delete b.data.color;
    }
    const timers = [];
    const stop = () => { while (timers.length)
        clearInterval(timers.pop()); };
    const ctx = {
        get data() { return b.data; },
        set: (patch) => { if (readonly)
            return; Object.assign(b.data, patch); save(); },
        redraw: () => draw(),
        every: (ms, fn) => {
            const t = window.setInterval(() => { if (!box.isConnected) {
                clearInterval(t);
                return;
            } fn(); }, Math.max(100, ms));
            timers.push(t);
        },
        h: (tag, attrs, ...children) => h(tag, attrs ?? null, ...children),
        icon: (name, size = 16) => iconSvg(name, size),
        color: (n) => colorOf(n),
        colorNames: COLOR_NAMES,
        openSettings: () => def.openSettings ? def.openSettings(ctx, ctx.el.querySelector('.widget-more') ?? ctx.el) : openWidgetSettings(def, ctx, undefined, b, restyle),
        pages: () => [...app.ws.pages.values()].map((p) => ({ id: p.id, title: p.title || 'Untitled', icon: p.icon })).sort((a, z) => a.title.localeCompare(z.title)),
        page: (id) => { const p = app.ws.pages.get(id); return p ? { id: p.id, title: p.title || 'Untitled', icon: p.icon, blocks: p.blocks } : null; },
        openPage: (id) => app.openPage(id),
        openUrl: (url) => { if (/^https?:\/\//i.test(url))
            window.open(url, '_blank', 'noopener'); },
        fetchJSON: async (url, cacheMinutes = 15) => {
            if (!/^https:\/\//i.test(url))
                throw new Error('Only https addresses.');
            const c = fetchCache.get(url);
            if (c && Date.now() - c.at < cacheMinutes * 60000)
                return c.v;
            const r = await fetch(url);
            if (!r.ok)
                throw new Error(`${r.status} ${r.statusText}`);
            const v = await r.json();
            fetchCache.set(url, { at: Date.now(), v });
            return v;
        },
        notify: (text) => {
            toast(text, 5000);
            try {
                if ('Notification' in window && Notification.permission === 'granted')
                    new Notification('Nook', { body: text });
            }
            catch { /* not available */ }
        },
        get hour12() { return getTimeFormat() === '12h'; },
        phone: isPhone(),
        readonly,
        el: box,
    };
    // for the built-in page preview only (not part of the public API)
    Object.assign(ctx, {
        _app: app,
        _menu: (e, entries, opts) => menu({ x: e.clientX, y: e.clientY }, entries, opts),
        _pickPage: (at, pick, create) => openPicker(at, pageItems(app.ws), pick, undefined, create ? [{ label: 'New page', icon: menuIcon('file-plus'), create: (q) => void create(q.trim()).then(pick), run: () => void create('').then(pick) }] : []),
    });
    /** the common style settings and the background (block colour) on the card */
    const restyle = () => {
        const bg = b.color?.endsWith('_bg') ? b.color.slice(0, -3) : '';
        box.classList.toggle('w-tinted', !!bg);
        if (bg) {
            const st = stepsOf(bg);
            box.style.setProperty('--w-bg', st.soft);
            box.style.setProperty('--w-tint', st.color);
        }
        else {
            box.style.removeProperty('--w-bg');
            box.style.removeProperty('--w-tint');
        }
    };
    const draw = () => {
        stop();
        restyle();
        let out;
        try {
            out = def.render(ctx);
        }
        catch (e) {
            out = h('div', { class: 'widget-error' }, `${def.name}: ${e.message}`);
        }
        box.replaceChildren(out);
        if (!readonly)
            box.append(h('button', { class: 'icon-btn widget-more', 'aria-label': `${def.name} settings`, title: 'Settings', onclick: (e) => { e.stopPropagation(); ctx.openSettings(); } }, svgIcon(ICONS.more, 16, { fill: true })));
    };
    draw();
    return box;
}
const ACCENT = { tag: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 14%, var(--surface))', text: 'var(--accent)' };
const colorOf = (n) => (!n || n === 'accent' || n === 'default' ? ACCENT : COLORS[n] ?? ACCENT);
const label = (c) => (c === 'accent' || c === 'default' ? 'Accent' : c[0].toUpperCase() + c.slice(1));
const swatch = (css) => h('span', { class: 'swatch', style: { background: css } });
const optList = (f) => (f.options ?? []).map((o) => (Array.isArray(o) ? o : [o, o]));
const fmtDayShort = (iso) => (iso ? new Date(iso.slice(0, 10) + 'T12:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
let zoneCache = null;
const zones = () => (zoneCache ??= (() => { try {
    return Intl.supportedValuesOf('timeZone');
}
catch {
    return ['UTC', 'Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];
} })());
/** "America/Los_Angeles" → "Los Angeles" */
export const zoneCity = (tz) => tz.split('/').pop().replace(/_/g, ' ');
/** a searchable menu of all time zones */
function pickZone(at, cur, pick) {
    menu(at, zones().map((z) => ({ label: `${z === cur ? '✓ ' : ''}${zoneCity(z)}`, hint: z.includes('/') ? z.split('/')[0] : undefined, run: () => pick(z) })), { filter: true, keepBelow: true, sub: true });
}
/** the settings panel: opens from ⋯ (or the block menu); every change shows in the widget right away */
function openWidgetSettings(def, ctx, anchor, block, restyle) {
    const at = anchor ?? ctx.el.querySelector('.widget-more') ?? ctx.el;
    let redrawT;
    const put = (k, v, now = true) => {
        ctx.set({ [k]: v });
        clearTimeout(redrawT);
        if (now)
            ctx.redraw();
        else
            redrawT = window.setTimeout(() => ctx.redraw(), 250);
    };
    const stop = (e) => e.stopPropagation();
    /** a labelled field: the label on the left, the input on the right */
    const inputRow = (f, multiline = false) => {
        const v = ctx.data[f.key];
        const inp = (multiline ? h('textarea', { class: 'rule-input wset-ta', rows: 3, placeholder: f.hint ?? '' }) : h('input', { class: 'rule-input', type: f.type === 'number' ? 'number' : 'text', min: f.min, max: f.max, step: f.step, placeholder: f.hint ?? '' }));
        inp.value = f.type === 'lines' ? (Array.isArray(v) ? v.join('\n') : '') : v == null ? '' : String(v);
        inp.addEventListener('keydown', stop);
        inp.addEventListener('input', () => put(f.key, f.type === 'number' ? (inp.value === '' ? null : Number(inp.value)) : f.type === 'lines' ? inp.value.split('\n').map((x) => x.trim()).filter(Boolean) : inp.value, false));
        return { el: h('div', { class: 'wset-row' + (multiline ? ' tall' : '') }, settingIcon(f.label) ?? null, h('span', { class: 'wset-label' }, f.label), inp) };
    };
    /** a row that opens a picker (date, page, time zone) – looks like a panel row with its value on the right */
    const pickRow = (lab, value, open, icon) => {
        const b = h('button', { class: 'pop-item', onclick: (e) => { e.stopPropagation(); open(b); } }, icon ?? settingIcon(lab) ?? h('span', { class: 'menu-ico menu-ico-blank' }), h('span', null, lab), h('span', { class: 'hint' }, value || '—'), h('span', { class: 'sub-arrow' }, '›'));
        return { el: b };
    };
    const dateRow = (lab, iso, set, nav, optional = true) => pickRow(lab, iso ? fmtDayShort(iso) : 'None', (el) => dateEditor(iso ? { start: iso } : null, el, (v) => {
        const d = asDate(v);
        if (!d && !optional)
            return;
        set(d ? d.start.slice(0, 10) : '');
        nav.refresh();
    }, true));
    const choicePage = (f) => ({
        title: f.label,
        rows: () => (f.type === 'color' ? COLOR_NAMES.map((c) => [c, label(c)]) : optList(f)).map(([val, lab]) => ({
            label: lab, icon: f.type === 'color' ? swatch(colorOf(val).text) : undefined,
            checked: String(ctx.data[f.key] ?? '') === val || (f.type === 'color' && val === 'accent' && (!ctx.data[f.key] || ctx.data[f.key] === 'default')),
            pick: () => put(f.key, val), back: true,
        })),
    });
    // a list (quotes, links, clocks …): one row per item, drag to reorder, × to remove, and "Add …"
    const listRows = (f, nav) => {
        const items = () => (Array.isArray(ctx.data[f.key]) ? ctx.data[f.key] : []);
        const commit = (next, refresh = true) => { put(f.key, next, refresh); if (refresh)
            nav.refresh(); };
        const rows = ['sep', { section: f.label }];
        let from = -1;
        items().forEach((it, i) => {
            const grip = h('span', { class: 'rule-grip', title: 'Drag to move' }, svgIcon(ICONS.grip, 14, { fill: true }));
            const cells = (f.item ?? []).filter((sf) => !sf.show || sf.show(ctx.data)).map((sf) => {
                const val = it[sf.key];
                const set = (v, refresh = true) => { const n = items().map((x, k) => (k === i ? { ...x, [sf.key]: v } : x)); commit(n, refresh); };
                if (sf.type === 'emoji') {
                    const ib = h('button', { class: 'rule-chip wset-icon', title: 'Choose an icon', 'aria-label': 'Icon', onclick: (e) => { e.stopPropagation(); pickIcon(ib, val ? String(val) : undefined, (v) => set(v ?? '')); } }, val ? renderIcon(String(val), 16) : iconSvg('smile', 16));
                    return ib;
                }
                if (sf.type === 'text' || sf.type === 'number') {
                    const inp = h('input', { class: 'rule-input', placeholder: sf.hint ?? sf.label, 'aria-label': sf.label, type: sf.type === 'number' ? 'number' : 'text', style: sf.width ? { flex: `0 0 ${sf.width}px` } : undefined });
                    inp.value = val == null ? '' : String(val);
                    inp.addEventListener('keydown', stop);
                    inp.addEventListener('input', () => set(sf.type === 'number' ? Number(inp.value) : inp.value, false));
                    return inp;
                }
                if (sf.type === 'link') {
                    // one chip: a page of the workspace ("page:<id>") or a web address
                    const pageId = typeof val === 'string' && val.startsWith('page:') ? val.slice(5) : '';
                    const pg = pageId ? ctx.page(pageId) : null;
                    const lc = h('button', { class: 'rule-chip wset-linkchip', title: 'Page or web address', onclick: (e) => {
                            e.stopPropagation();
                            openPicker(lc, pageItems(ctx._app.ws), (id) => set(`page:${id}`), pageId || undefined, [
                                { label: 'Web address…', icon: iconSvg('link', 16), run: () => prompt(lc, 'Web address', pageId ? '' : String(val ?? ''), (v) => set(v.trim())) }, 'sep'
                            ]);
                        } }, pg ? iconSvg('file', 14) : iconSvg('link', 14), h('span', { class: 'wset-linktext' + (val ? '' : ' muted') }, pg ? pg.title : pageId ? 'Deleted page' : String(val || 'Page or address')), svgIcon(ICONS.chevron, 11));
                    return lc;
                }
                // a chip that opens a picker
                const text = sf.type === 'date' ? (val ? fmtDayShort(String(val)) : sf.label)
                    : sf.type === 'timezone' ? (val ? zoneCity(String(val)) : 'Time zone')
                        : sf.type === 'page' ? (ctx.page(String(val ?? ''))?.title ?? 'Page')
                            : (optList(sf).find(([v]) => v === String(val))?.[1] ?? sf.label);
                const chip = h('button', { class: 'rule-chip', title: sf.label, onclick: (e) => {
                        e.stopPropagation();
                        if (sf.type === 'date')
                            dateEditor(val ? { start: String(val) } : null, chip, (v) => { const d = asDate(v); set(d ? d.start.slice(0, 10) : ''); }, true);
                        else if (sf.type === 'timezone')
                            pickZone(chip, String(val ?? ''), (z) => set(z));
                        else if (sf.type === 'page')
                            openPicker(chip, pageItems(ctx._app.ws), (id) => set(id));
                        else
                            menu(chip, optList(sf).map(([v, l]) => ({ label: `${v === String(val) ? '✓ ' : ''}${l}`, run: () => set(v) })), { keepBelow: true, sub: true });
                    } }, text, svgIcon(ICONS.chevron, 11));
                return chip;
            });
            const x = h('button', { class: 'icon-btn rule-x', 'aria-label': 'Remove', title: 'Remove', onclick: (e) => { e.stopPropagation(); commit(items().filter((_, k) => k !== i)); } }, svgIcon(ICONS.close, 13));
            const row = h('div', { class: 'rule-row filter-row wset-item' }, grip, ...cells, x);
            grip.addEventListener('mousedown', () => { row.draggable = true; });
            row.addEventListener('dragstart', (e) => { from = i; row.classList.add('dragging'); e.dataTransfer?.setData('text/plain', String(i)); });
            row.addEventListener('dragend', () => { row.draggable = false; row.classList.remove('dragging'); });
            row.addEventListener('dragover', (e) => { if (from < 0)
                return; e.preventDefault(); const r = row.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; row.classList.toggle('drop-after', after); row.classList.toggle('drop-before', !after); });
            row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                if (from < 0)
                    return;
                const r = row.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                const l = [...items()];
                const [it2] = l.splice(from, 1);
                let to = i + (after ? 1 : 0);
                if (from < to)
                    to--;
                l.splice(to, 0, it2);
                from = -1;
                commit(l);
            });
            rows.push({ el: row });
        });
        if (!items().length && f.hint)
            rows.push({ el: h('div', { class: 'muted small vpanel-empty' }, f.hint) });
        rows.push({ label: f.add ?? 'Add', icon: iconSvg('plus-circle', 16), pick: () => {
                commit([...items(), f.newItem ? f.newItem() : {}]);
                requestAnimationFrame(() => { const ins = document.querySelectorAll('.vpanel .wset-item'); ins[ins.length - 1]?.querySelector('input, .rule-chip')?.focus(); });
            } });
        return rows;
    };
    const row = (f, nav) => {
        if (f.show && !f.show(ctx.data))
            return [];
        switch (f.type) {
            case 'section': return ['sep', { section: f.label }];
            case 'toggle': return [{ label: f.label, toggle: !!ctx.data[f.key], onToggle: () => put(f.key, !ctx.data[f.key]) }];
            case 'select':
            case 'color': {
                const cur = String(ctx.data[f.key] ?? '');
                const hint = f.type === 'color' ? label(cur || 'accent') : optList(f).find(([v]) => v === cur)?.[1] ?? '';
                // a few short choices: right in the row (no extra page)
                const opts = f.type === 'select' ? optList(f) : [];
                if (opts.length > 1 && opts.length <= 4 && opts.every(([, l]) => l.length <= 9))
                    return [{ label: f.label, seg: { options: opts, value: cur || opts[0][0], pick: (v) => put(f.key, v) } }];
                return [{ label: f.label, hint, icon: f.type === 'color' ? swatch(colorOf(cur).text) : undefined, go: () => choicePage(f) }];
            }
            case 'date': return [dateRow(f.label, String(ctx.data[f.key] ?? ''), (v) => put(f.key, v), nav, f.optional !== false)];
            case 'page': return [pickRow(f.label, ctx.page(String(ctx.data[f.key] ?? ''))?.title ?? '', (el) => openPicker(el, pageItems(ctx._app.ws), (id) => { put(f.key, id); nav.refresh(); }))];
            case 'timezone': return [pickRow(f.label, ctx.data[f.key] ? zoneCity(String(ctx.data[f.key])) : '', (el) => pickZone(el, String(ctx.data[f.key] ?? ''), (z) => { put(f.key, z); nav.refresh(); }))];
            case 'list': return listRows(f, nav);
            case 'textarea':
            case 'lines': return [inputRow(f, true)];
            default: return [inputRow(f)];
        }
    };
    // every widget: background (the same as the block menu's Color → background), text size, weight, alignment
    const style = () => {
        const bgName = block?.color?.endsWith('_bg') ? block.color.slice(0, -3) : '';
        const rows = [];
        // the block's background joins the widget's "Look" group (or starts one)
        const secs = (def.settings ?? []).filter((f) => f.type === 'section' && (!f.show || f.show(ctx.data)));
        if (block && secs[secs.length - 1]?.label !== 'Look')
            rows.push('sep', { section: 'Look' });
        if (block)
            rows.push({
                label: 'Background', hint: bgName ? label(bgName) : 'Default', icon: swatch(bgName ? BLOCK_BG[bgName] : 'var(--surface)'),
                go: () => ({ title: 'Background', rows: () => (['default', ...COLOR_NAMES.filter((c) => c !== 'accent')]).map((c) => ({
                        label: c === 'default' ? 'Default' : label(c), icon: swatch(c === 'default' ? 'var(--surface)' : BLOCK_BG[c]),
                        checked: (bgName || 'default') === c,
                        pick: () => { if (c === 'default')
                            delete block.color;
                        else
                            block.color = `${c}_bg`; ctx.set({}); restyle?.(); }, back: true,
                    })) }),
            });
        return rows;
    };
    /** the same shape for every widget: no separator at the start or end, never two in a row */
    const tidy = (rows) => rows.filter((r, i, all) => r !== 'sep' || (i > 0 && i < all.length - 1 && all[i - 1] !== 'sep' && all.slice(0, i).some((x) => x !== 'sep')));
    panel(at, { title: def.name, rows: (nav) => tidy([...(def.settings ?? []).flatMap((f) => row(f, nav)), ...style()]) });
    const boxes = document.querySelectorAll('.vpanel');
    boxes[boxes.length - 1]?.classList.add('wpanel');
}
// ── your own widgets: .workspace/widgets/*.js ────────────────────────────────
export const WIDGET_DIR = '.workspace/widgets';
/** loads (again) every widget file of the workspace; returns the problems */
export async function loadCustomWidgets(ws) {
    unregisterCustom();
    const errors = [];
    const files = (await ws.storage.list(WIDGET_DIR).catch(() => [])).filter((e) => e.kind === 'file' && e.name.endsWith('.js'));
    for (const f of files) {
        try {
            const code = await ws.storage.read(`${WIDGET_DIR}/${f.name}`);
            const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
            try {
                const mod = await import(/* @vite-ignore */ url);
                registerWidget(mod.default, f.name);
            }
            finally {
                URL.revokeObjectURL(url);
            }
        }
        catch (e) {
            errors.push(`${f.name}: ${e.message}`);
        }
    }
    return errors;
}
/** adds (or replaces) a widget file */
export async function installWidget(ws, name, code) {
    const file = name.replace(/[^\w.-]+/g, '-').replace(/\.js$/i, '') + '.js';
    await ws.storage.write(`${WIDGET_DIR}/${file}`, code);
    return loadCustomWidgets(ws);
}
export async function removeWidgetFile(ws, file) {
    await ws.storage.remove?.(`${WIDGET_DIR}/${file}`);
    await loadCustomWidgets(ws);
}
//# sourceMappingURL=runtime.js.map