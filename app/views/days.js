import { parsePage } from '../format/page.js';
import { openViewer, mediaMenu } from '../ui/viewer.js';
import { svgIcon, ICONS, IMAGE_RE, shortId, segmented, fmtTime, parseTime, asDate, dayNum, isoFromDay, todayISO, weekStart, MONTHS, WEEKDAYS, fmtNumber, h, COLORS } from '../util.js';
import { zoomPicker, monthsGrid, yearsGrid, crumbParts, stepNav } from '../ui/zoomcal.js';
import { renderTrends } from './trends.js';
import { renderValue, entryTitle } from './cells.js';
import { rowMenu } from './rowmenu.js';
import { iconSvg } from '../ui/icons.js';
import { menu, prompt, toast, dialog, menuIcon, colorEntries, colorDot, cssDot } from '../ui/pop.js';
import { removePropFromView } from './propmenu.js';
const VIDEO_RE = /\.(mp4|mov|m4v|webm)$/i, PDF_RE = /\.pdf$/i;
const mediaKindOf = (p) => IMAGE_RE.test(p) ? 'image' : VIDEO_RE.test(p) ? 'video' : PDF_RE.test(p) ? 'pdf' : null;
const SORT_LABEL = { time: 'Time', name: 'Name A–Z', value: 'Value (highest first)', new: 'Newest first' };
/** a timeline's order: keys in turn, each on or off (older logs: one choice) */
function sortKeys(m) {
    if (m.sorts?.length)
        return m.sorts;
    const first = m.sort ?? 'time';
    return [first, ...['time', 'name', 'value', 'new'].filter((k) => k !== first)].map((key) => ({ key, on: key === first }));
}
/** entries in a timeline's order: its keys one after another (like a database's sorts) */
function orderItems(items, m) {
    const titleOf = (x) => entryTitle(x.db, x.row).text || '';
    const valOf = (x) => num(x.src.sum ? x.db.value(x.row, x.src.sum) : x.src.avg ? x.db.value(x.row, x.src.avg) : null) ?? -Infinity;
    const cmp = {
        time: (a, b) => (a.time ? 0 : 1) - (b.time ? 0 : 1) || (a.time || '').localeCompare(b.time || ''),
        name: (a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { numeric: true, sensitivity: 'base' }),
        value: (a, b) => valOf(b) - valOf(a),
        new: (a, b) => String(b.row.created ?? '').localeCompare(String(a.row.created ?? '')),
    };
    const keys = (m ? sortKeys(m) : [{ key: 'time', on: true }]).filter((k) => k.on).map((k) => cmp[k.key]);
    return items.map((x, i) => ({ x, i })).sort((a, b) => { for (const f of keys) {
        const r = f(a.x, b.x);
        if (r)
            return r;
    } return a.i - b.i; }).map((o) => o.x);
}
const COLOR_ORDER = ['blue', 'yellow', 'green', 'purple', 'pink', 'orange', 'red', 'brown', 'gray'];
const isDate = (p) => p.type === 'date';
const KINDS = [
    { kind: 'photos', label: 'Media', icon: 'image', desc: 'Photos, videos and PDFs from the day’s entries' },
    { kind: 'timeline', label: 'Timeline', icon: 'list', desc: 'Entries from your databases' },
    { kind: 'calendar', label: 'Calendar', icon: 'calendar', desc: 'The month at a glance', side: true },
    { kind: 'covers', label: 'Covers', icon: 'image', desc: 'Posters or covers of the day, e.g. films' },
    { kind: 'onthisday', label: 'On this day', icon: 'clock', desc: 'The same date in earlier years' },
    { kind: 'note', label: 'Note', icon: 'pencil', desc: 'A question and space to write', records: 'text' },
    { kind: 'habits', label: 'Habits', icon: 'check-square', desc: 'Tick off, with streaks', records: 'checkbox', side: true },
    { kind: 'rating', label: 'Rating', icon: 'smile', desc: 'Mood, energy, sleep – 1 to 5', records: 'number', side: true },
    { kind: 'counter', label: 'Counter', icon: 'plus-circle', desc: '+ and −, e.g. glasses of water', records: 'number', side: true },
    { kind: 'number', label: 'Number', icon: 'chart-bar', desc: 'A value with its trend', records: 'number', side: true },
];
const kindOf = (k) => KINDS.find((x) => x.kind === k);
/** the day database's settings (in its schema, shared by its Day and Trends views) */
export function dayConfig(db) {
    const s = db.schema;
    if (!s.day)
        s.day = { prop: db.schema.properties.find(isDate)?.name ?? 'Date', sources: [], modules: [] };
    // the timeline is always there (it can move, not go)
    if (!s.day.modules.some((m) => m.kind === 'timeline'))
        s.day.modules.unshift({ id: 'timeline', kind: 'timeline', title: 'Timeline' });
    // Photos became Media (photos, videos, PDFs): the old default name follows
    for (const m of s.day.modules)
        if (m.kind === 'photos' && m.title === 'Photos')
            m.title = 'Media';
    return s.day;
}
/** phone head of a day log (Day and Trends alike): the date or period with ‹ › beside it, one quiet line
 *  (with "Today" to jump back when you are elsewhere), then the switches – every row the same height */
export function phoneHead(title, sub, back, toToday, prev, next, rows) {
    const nav = (icon, lab, run) => h('button', { type: 'button', class: 'trp-nav', 'aria-label': lab, onclick: run }, iconSvg(icon, 18));
    return h('div', { class: 'trp-head' }, h('div', { class: 'trp-top' }, title, h('span', { class: 'trp-navs' }, nav('chevron-left', 'Before', prev), nav('chevron-right', 'After', next))), h('div', { class: 'trp-sub' }, back, h('span', null, sub), toToday ? h('button', { type: 'button', class: 'trp-today', onclick: toToday }, 'Today') : null), ...rows.map((r) => h('div', { class: 'trp-row' }, r)));
}
// ── days ──
const wdOf = (d) => (d + 3) % 7;
export const weekFirst = (d) => d - ((wdOf(d) - weekStart() + 7) % 7);
export const today = () => dayNum(todayISO());
export const dayOfValue = (v) => { const d = asDate(v); return d ? dayNum(d.start.slice(0, 10)) : null; };
export function dayIndex(db, prop) {
    const m = new Map();
    for (const r of db.rows) {
        const d = dayOfValue(db.value(r, prop));
        if (d != null && !m.has(d))
            m.set(d, r);
    }
    return m;
}
export const label = (d) => {
    const iso = isoFromDay(d);
    return { wd: WEEKDAYS[wdOf(d)], day: +iso.slice(8, 10), month: MONTHS[+iso.slice(5, 7) - 1], year: +iso.slice(0, 4) };
};
const relative = (d) => { const t = today(); return d === t ? 'Today' : d === t - 1 ? 'Yesterday' : d === t + 1 ? 'Tomorrow' : ''; };
/** where each Day view stands */
const shown = new Map();
const dayMode = new Map();
const grpOpen = new Set();
/** the day a jump (calendar, On this day) started from: a Back chip leads there */
const cameFrom = new Map();
const calAt = new Map();
const otdOpen = new Map();
function itemsOn(ctx, cfg, from, to) {
    const out = [];
    for (const src of cfg.sources) {
        const db = ctx.ws.dbs.get(src.db);
        if (!db?.prop(src.prop))
            continue;
        for (const row of db.rows) {
            const d = asDate(db.value(row, src.prop));
            if (!d)
                continue;
            const day = dayNum(d.start.slice(0, 10));
            if (day >= from && day < to)
                out.push({ db, src, row, day, time: d.start.length > 10 ? d.start.slice(11, 16) : '' });
        }
    }
    return out.sort((a, b) => a.day - b.day || (a.time || '99').localeCompare(b.time || '99'));
}
export const srcColor = (cfg, s) => COLORS[s.color ?? COLOR_ORDER[cfg.sources.indexOf(s) % COLOR_ORDER.length]].text;
/** a habit's colour (as a CSS colour): its own, or the accent */
export function habitColor(cfg, p) {
    const c = cfg.modules.find((m) => m.kind === 'habits' && m.props?.includes(p))?.colors?.[p];
    return c && c !== 'default' ? COLORS[c].text : 'var(--accent)';
}
export const num = (v) => (typeof v === 'number' ? v : v == null || v === '' ? null : Number(v));
// ── the Day view ──
export function renderDay(env) {
    coverGen++;
    const { db, ctx } = env;
    const cfg = dayConfig(db);
    const key = `${db.key}:${env.view.id}`;
    if (!shown.has(key))
        shown.set(key, today());
    const day = shown.get(key);
    const go = (d, top = false) => {
        // jumps are remembered one by one, so Back goes to the day you just came from
        if (top && d !== day) {
            const st0 = cameFrom.get(key) ?? [];
            st0.push(day);
            cameFrom.set(key, st0.slice(-30));
        }
        shown.set(key, d);
        env.redraw();
        // from a calendar or On this day: back up to the date, briefly
        if (top)
            requestAnimationFrame(() => {
                const el = document.querySelector(`.dayv[data-key="${CSS.escape(key)}"]`);
                let sc = el?.parentElement ?? null;
                while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY))
                    sc = sc.parentElement;
                if (!el || !sc)
                    return;
                const y = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 16;
                if (y < sc.scrollTop)
                    sc.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
            });
    };
    const modeSeg = () => segmented([['day', 'Day'], ['trends', 'Trends']], dayMode.get(key) ?? 'day', (k) => { dayMode.set(key, k); env.redraw(); }, 'Show', 'small dayv-mode');
    if (dayMode.get(key) === 'trends')
        return renderTrends(env, modeSeg);
    // ← → move between days (not while typing)
    const keys = (e) => {
        if (!root.isConnected) {
            document.removeEventListener('keydown', keys);
            return;
        }
        const t = e.target;
        if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, [contenteditable="true"], .pop, .overlay'))
            return;
        if (document.querySelector('.pop, .overlay, .dlbox'))
            return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            document.removeEventListener('keydown', keys);
            go(day + (e.key === 'ArrowLeft' ? -1 : 1));
        }
    };
    document.addEventListener('keydown', keys);
    const saveCfg = () => { void ctx.ws.saveSchema(db); env.redraw(); };
    const index = dayIndex(db, cfg.prop);
    let entry = index.get(day) ?? null;
    /** the day's entry – made when something is first recorded */
    const ensure = async () => {
        if (entry)
            return entry;
        ctx.ws.boundary();
        const l = label(day);
        entry = await ctx.ws.addRow(db, { [db.labelProp]: `${l.wd}, ${l.day} ${l.month} ${l.year}`, [cfg.prop]: { start: isoFromDay(day) } }, '');
        return entry;
    };
    const setVal = async (prop, v, redraw = true) => { const r = await ensure(); r.values[prop] = v; await ctx.ws.saveRow(db, r); if (redraw)
        env.redraw(); };
    const items = itemsOn(ctx, cfg, day, day + 1);
    const root = h('div', { class: 'dayv', 'data-key': key });
    // head: the date as heading, one quiet line; the period switcher as in the calendar views
    const l = label(day);
    const rel = relative(day);
    const title = h('button', { class: 'dayv-titlebtn', 'aria-label': 'Pick a day', onclick: () => calendar(title) }, h('span', { class: 'cal-title large' }, h('span', { class: 'cal-t-main' }, h('span', { class: 'long' }, `${l.wd}, ${l.day} ${l.month}`), h('span', { class: 'short' }, `${l.wd.slice(0, 3)}, ${l.day} ${l.month.slice(0, 3)}`)), l.year !== label(today()).year ? [' ', h('span', { class: 'cal-t-year' }, String(l.year))] : null), iconSvg('chevron-down', 16));
    const isPhone = document.documentElement.classList.contains('phone');
    // phone: the same head as Trends – the date, one quiet line, then Day | Trends and the day steps on rows of their own
    if (isPhone) {
        const back = cameFrom.get(key)?.length ? h('button', { class: 'dayv-back', onclick: () => { const b = cameFrom.get(key).pop(); go(b); } }, iconSvg('chevron-left', 12), (() => { const st0 = cameFrom.get(key); const b = label(st0[st0.length - 1]); return `${b.wd}, ${b.day} ${b.month.slice(0, 3)}`; })()) : null;
        root.append(phoneHead(title, [rel, items.length ? `${items.length} ${items.length === 1 ? 'entry' : 'entries'}` : 'No entries'].filter(Boolean).join(' · '), back, day === today() ? null : () => go(today()), () => go(day - 1), () => go(day + 1), [modeSeg()]));
    }
    else
        root.append(h('div', { class: 'cal-head dayv-head' }, h('div', { class: 'dayv-date' }, title, h('div', { class: 'dayv-meta' }, modeSeg(), cameFrom.get(key)?.length ? h('button', { class: 'dayv-back', title: 'Back to the day you came from', onclick: () => { const b = cameFrom.get(key).pop(); go(b); } }, iconSvg('chevron-left', 12), (() => { const st0 = cameFrom.get(key); const b = label(st0[st0.length - 1]); return `${b.wd}, ${b.day} ${b.month.slice(0, 3)}${b.year !== label(day).year ? ` ${b.year}` : ''}`; })()) : null, ...[rel, items.length ? `${items.length} ${items.length === 1 ? 'entry' : 'entries'}` : 'No entries'].filter(Boolean).map((t, i) => h('span', { class: i ? 'sepd' : '' }, t)))), h('div', { class: 'dayv-nav' }, modeSeg(), h('span', { class: 'cal-head-gap' }), ...stepNav({ unit: 'day', prev: () => go(day - 1), today: () => go(today()), next: () => go(day + 1) }))));
    // swipe between days on a phone
    let sx = 0, sy = 0;
    root.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; if (sx <= 32 || sx >= innerWidth - 32)
        sx = NaN; sy = e.touches[0].clientY; }, { passive: true });
    root.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && !e.target.closest('input, textarea, .dcal'))
        go(day + (dx < 0 ? 1 : -1)); });
    if (!cfg.modules.length) {
        root.append(h('div', { class: 'dayv-empty' }, h('p', null, 'This log has no modules yet.'), addButton()));
        return root;
    }
    const main = h('div', { class: 'dayv-main' }), side = h('div', { class: 'dayv-side' });
    for (const m of cfg.modules) {
        const body = moduleBody(m);
        if (!body)
            continue;
        const box = h('section', { class: `dmod dcard widget-card dmod-${m.kind}` }, h('div', { class: 'dmod-h' }, h('span', { class: 'w-label' }, m.title), h('button', { class: 'icon-btn dmod-more', 'aria-label': `${m.title} settings`, title: 'Settings', onclick: (e) => moduleMenu(m, e.currentTarget) }, svgIcon(ICONS.more, 16, { fill: true }))), body);
        ((m.col ?? (kindOf(m.kind).side ? 'side' : 'main')) === 'side' ? side : main).append(box);
    }
    side.append(addButton());
    if (cfg.phoneFirst === 'record')
        main.append(h('div', { class: 'dayv-add-end' }, addButton()));
    const grid = h('div', { class: 'dayv-grid' + (side.childElementCount > 1 ? '' : ' one') + (cfg.phoneFirst === 'record' ? ' record-first' : '') }, main, side);
    root.append(grid);
    return root;
    function addButton() {
        return h('button', { class: 'dayv-add', onclick: (e) => addModule(e.currentTarget) }, iconSvg('plus', 14), 'Add module');
    }
    // ── the modules ──
    function moduleBody(m) {
        switch (m.kind) {
            case 'timeline': {
                if (!cfg.sources.length)
                    return h('div', { class: 'dmod-hint' }, h('div', { class: 'dtl-first' }, h('span', null, 'Show entries of your other databases here – tasks, expenses, films …'), h('button', { class: 'set-btn small', onclick: (e) => sourcesMenu(e.currentTarget) }, iconSvg('plus', 13), 'Add your first database')));
                if (!items.length)
                    return h('div', { class: 'dmod-none' }, 'Nothing yet');
                const row = (x) => h('div', { class: 'dtl-row bar' + (m.tint ? ' tint' : ''), onclick: () => ctx.openRow(x.db, x.row), oncontextmenu: (e) => { e.preventDefault(); rowMenu(ctx, x.db, x.row, { x: e.clientX, y: e.clientY }, () => env.redraw(), [], [{ label: `Show in “${x.db.schema.name}”`, icon: menuIcon('database'), run: () => ctx.openDb(x.db.key) }]); } }, h('i', { class: 'dtl-dot', style: { background: srcColor(cfg, x.src) } }), x.src.image ? cover(x.db, x.row, x.src.image, 'dtl-img') : null, h('div', { class: 'dtl-c' }, h('div', { class: 'dtl-title' }, entryTitle(x.db, x.row).text || 'Untitled'), subline(x)), x.time ? h('span', { class: 'dtl-r' }, x.time) : null, x.src.sum && num(x.db.value(x.row, x.src.sum)) != null ? h('span', { class: 'dtl-r' }, fmtNumber(num(x.db.value(x.row, x.src.sum)), x.db.prop(x.src.sum)?.format) + (x.src.unit ? ` ${x.src.unit}` : '')) : null);
                // timed entries first, then "Without time" (as in the calendar's day list) – only when a group has both
                const timedFirst = (g) => [...g.filter((x) => x.time), ...g.filter((x) => !x.time)];
                const sep = () => h('div', { class: 'dtl-untimed' }, 'Without time');
                const withSep = (g, els) => { const k = g.findIndex((x) => !x.time); if (k <= 0 || !g.some((x) => x.time))
                    return els; return [...els.slice(0, k), sep(), ...els.slice(k)]; };
                const sorted = orderItems(items, m);
                const groups = cfg.sources.map((s) => timedFirst(sorted.filter((x) => x.src === s))).filter((g) => g.length);
                const tintRow = (x) => { const e = row(x); e.style.setProperty('--rc', srcColor(cfg, x.src)); return e; };
                const total = (g) => { const s0 = g[0].src; if (s0.avg && g[0].db.prop(s0.avg)) {
                    const xs = g.map((x) => num(x.db.value(x.row, s0.avg))).filter((n) => n != null && n > 0);
                    return xs.length ? h('b', { class: 'dtl-sum' }, 'Ø ', h('span', { class: 'stars' }, fmtNumber(xs.reduce((a, b) => a + b, 0) / xs.length, g[0].db.prop(s0.avg)?.format === 'stars' ? 'stars' : undefined))) : null;
                } if (!s0.sum)
                    return null; const t = g.reduce((a, x) => a + (num(x.db.value(x.row, s0.sum)) ?? 0), 0); return h('b', { class: 'dtl-sum' }, fmtNumber(t, g[0].db.prop(s0.sum)?.format) + (s0.unit ? ` ${s0.unit}` : '')); };
                if (groups.length === 1 && !groups[0][0].src.sum && !groups[0][0].src.avg && !groups[0][0].src.image) {
                    const g = groups[0];
                    return h('div', { class: 'dtl' }, ...withSep(g, g.map(tintRow)));
                }
                // long groups: the first five, then "Show N more"
                const limited = (g) => {
                    const per = m.goal ?? 5, k = `${key}:${g[0].src.db}`, all = !per || grpOpen.has(k) || g.length <= per + 1;
                    const shown = all ? g : g.slice(0, per);
                    return [...withSep(shown, shown.map(tintRow)), per && g.length > per + 1 ? h('button', { class: 'dotd-more dtl-more', onclick: () => { if (grpOpen.has(k))
                                grpOpen.delete(k);
                            else
                                grpOpen.add(k); env.redraw(); } }, grpOpen.has(k) ? 'Show less' : `Show ${g.length - per} more`) : null].filter(Boolean);
                };
                // a source with pictures (films, books): its entries side by side as small cards
                const cardsOf = (g) => h('div', { class: 'dtl-cards' }, ...g.map((x) => {
                    const c = h('button', { class: 'dtl-card' + (m.tint ? ' tint' : ''), onclick: () => ctx.openRow(x.db, x.row), oncontextmenu: (e) => { e.preventDefault(); rowMenu(ctx, x.db, x.row, { x: e.clientX, y: e.clientY }, () => env.redraw(), [], [{ label: `Show in “${x.db.schema.name}”`, icon: menuIcon('database'), run: () => ctx.openDb(x.db.key) }]); } }, cover(x.db, x.row, x.src.image, 'dtl-card-img') ?? h('span', { class: 'dtl-card-img empty' }, h('span', { class: 'ph-t' }, entryTitle(x.db, x.row).text || '')), h('b', null, entryTitle(x.db, x.row).text || 'Untitled'), subline(x));
                    c.style.setProperty('--rc', srcColor(cfg, x.src));
                    return c;
                }));
                return h('div', { class: 'dtl' }, ...groups.flatMap((g) => [h('div', { class: 'dtl-grp' }, g[0].db.schema.name, h('span', null, String(g.length)), total(g)), ...(g[0].src.image ? [cardsOf(g)] : limited(g))]));
            }
            case 'totals': return null;
            case 'calendar': {
                const ck = `${key}:${m.id}`;
                let st = calAt.get(ck);
                if (!st || st.day !== day) {
                    st = { day, y: label(day).year, m: +isoFromDay(day).slice(5, 7), zoom: 'days' };
                    calAt.set(ck, st);
                }
                const s0 = st;
                const busy = new Set(index.keys());
                for (const src of cfg.sources) {
                    const sdb = ctx.ws.dbs.get(src.db);
                    if (sdb)
                        for (const r of sdb.rows) {
                            const d = dayOfValue(sdb.value(r, src.prop));
                            if (d != null)
                                busy.add(d);
                        }
                }
                const tone = (d) => { if (!m.prop)
                    return null; const v = num(index.get(d)?.values[m.prop] ?? null); if (v == null)
                    return null; const t = Math.max(0, Math.min(1, (v - 1) / 4)); return `hsl(${Math.round(t * 120)} 55% 45% / .38)`; };
                const step = (n) => { if (s0.zoom === 'days') {
                    if (m.size === 'week') {
                        go(day + 7 * n);
                        return;
                    }
                    s0.m += n;
                    if (s0.m < 1) {
                        s0.m = 12;
                        s0.y--;
                    }
                    if (s0.m > 12) {
                        s0.m = 1;
                        s0.y++;
                    }
                }
                else
                    s0.y += s0.zoom === 'year' ? n : 12 * n; env.redraw(); };
                let grid;
                if (s0.zoom === 'days') {
                    const first = dayNum(`${s0.y}-${String(s0.m).padStart(2, '0')}-01`);
                    const start = m.size === 'week' ? weekFirst(day) : weekFirst(first), n = m.size === 'week' ? 7 : 42;
                    grid = h('div', { class: 'dp-grid' }, ...[0, 1, 2, 3, 4, 5, 6].map((i) => h('span', { class: 'dp-dow' }, WEEKDAYS[(i + weekStart()) % 7].slice(0, 2))), ...Array.from({ length: n }, (_, i) => start + i).map((d) => { const b = h('button', { class: 'dp-day' + (m.size !== 'week' && +isoFromDay(d).slice(5, 7) !== s0.m ? ' out' : '') + (d === today() ? ' today' : '') + (d === day ? ' on' : '') + (busy.has(d) ? ' has' : ''), title: `${label(d).wd}, ${label(d).day} ${label(d).month}`, onclick: () => go(d, true) }, String(label(d).day)); const c = tone(d); if (c)
                        b.style.setProperty('--tone', c); return b; }));
                }
                else if (s0.zoom === 'year')
                    grid = monthsGrid(s0.y, { y: label(day).year, m: +isoFromDay(day).slice(5, 7) }, (mm) => { s0.m = mm; s0.zoom = 'days'; env.redraw(); }, (yy, mm) => { const a = dayNum(`${yy}-${String(mm).padStart(2, '0')}-01`); let c = 0; for (const d of busy)
                        if (d >= a && d < a + 31 && isoFromDay(d).slice(5, 7) === String(mm).padStart(2, '0'))
                            c++; return c ? String(c) : ''; });
                else
                    grid = yearsGrid(s0.y, label(day).year, (yy) => { s0.y = yy; s0.zoom = 'year'; env.redraw(); });
                // phone: swipe the calendar sideways for the previous / next month (week); not from the screen edges
                // (Back / Forward) – and the day swipe of the log leaves the calendar alone
                let cx = NaN, cy = 0;
                grid.addEventListener('touchstart', (e) => { const t = e.touches[0]; cx = t.clientX <= 32 || t.clientX >= innerWidth - 32 ? NaN : t.clientX; cy = t.clientY; }, { passive: true });
                grid.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - cx, dy = e.changedTouches[0].clientY - cy; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5)
                    step(dx < 0 ? 1 : -1); });
                return h('div', { class: 'dp dcal' + (m.size === 'week' ? ' week' : '') + (m.prop ? ' toned' : '') }, h('div', { class: 'dp-head' }, h('span', { class: 'dp-title dp-crumb' }, ...crumbParts(s0.zoom, s0.y, s0.m, (z) => { s0.zoom = z; env.redraw(); })), h('span', { class: 'dp-nav' }, h('button', { class: 'icon-btn', 'aria-label': 'Earlier', onclick: () => step(-1) }, iconSvg('chevron-left', 14)), 
                // back to today: the log jumps there, the calendar shows its month
                h('button', { class: 'dp-today', onclick: () => { const t = today(); calAt.delete(ck); if (t !== day)
                        go(t, true);
                    else
                        env.redraw(); } }, 'Today'), h('button', { class: 'icon-btn', 'aria-label': 'Later', onclick: () => step(1) }, iconSvg('chevron-right', 14)))), grid);
            }
            case 'covers': {
                const src = cfg.sources.find((x) => x.db === m.prop) ?? cfg.sources.find((x) => x.image);
                if (!src?.image)
                    return h('div', { class: 'dmod-none' }, 'Covers come from a database with a picture – e.g. a Letterboxd source');
                const mine = items.filter((x) => x.src === src);
                if (!mine.length)
                    return null;
                return h('div', { class: 'dcov' }, ...mine.map((x) => h('button', { class: 'dcov-c', onclick: () => ctx.openRow(x.db, x.row) }, cover(x.db, x.row, src.image, 'dcov-img') ?? h('span', { class: 'dcov-img empty dtl-card-img' }, h('span', { class: 'ph-t' }, entryTitle(x.db, x.row).text || '')), h('b', null, entryTitle(x.db, x.row).text || 'Untitled'), ...(src.props ?? []).slice(0, 1).map((p) => { const v = x.db.value(x.row, p); const d = x.db.prop(p); return d && v != null && v !== '' ? h('span', { class: 'dcov-sub' }, renderValue(x.db, d, v)) : null; }))));
            }
            case 'photos': {
                // photos, videos and PDFs of the day: in Files & media properties and in the entries' text (any block)
                const want = new Set(m.media ?? ['image', 'video', 'pdf']);
                const found = [];
                const add = (f, d, r) => { const k = mediaKindOf(f); if (k && want.has(k) && !found.some((x) => x.path === f))
                    found.push({ path: f, open: () => ctx.openRow(d, r), entryName: entryTitle(d, r).text || 'Untitled' }); };
                const walk = (bs, d, r) => { for (const b of bs) {
                    if (b.src && ['image', 'video', 'pdf', 'file'].includes(b.type))
                        add(b.src, d, r);
                    if (b.children)
                        walk(b.children, d, r);
                } };
                const take = (d, r) => {
                    for (const p of d.schema.properties)
                        if (p.type === 'files') {
                            const v = d.value(r, p.name);
                            for (const f of Array.isArray(v) ? v : v ? [v] : [])
                                if (typeof f === 'string')
                                    add(f, d, r);
                        }
                    if (r.body) {
                        try {
                            walk(parsePage(r.body), d, r);
                        }
                        catch { /* unreadable text */ }
                    }
                };
                if (entry)
                    take(db, entry);
                for (const x of items)
                    take(x.db, x.row);
                // always there, also on a day without any (else the module seems to have vanished)
                if (!found.length)
                    return h('div', { class: 'dmod-none dph-none' }, 'No media on this day.');
                // pictures and videos first (as tiles), then PDFs (as rows) – the viewer goes through them in this order
                const order = [...found.filter((x) => mediaKindOf(x.path) !== 'pdf'), ...found.filter((x) => mediaKindOf(x.path) === 'pdf')];
                const wire = (el, i) => {
                    el.addEventListener('click', () => openViewer(ctx, order, i));
                    el.addEventListener('keydown', (e) => { if (e.key === ' ') {
                        e.preventDefault();
                        openViewer(ctx, order, i);
                    } });
                    el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); mediaMenu(ctx, order, i, { x: e.clientX, y: e.clientY }); });
                    return el;
                };
                const tiles = h('div', { class: 'dph' }), rows = h('div', { class: 'dph-files' });
                order.forEach((it, i) => {
                    const k = mediaKindOf(it.path);
                    const nm = it.path.split('/').pop() ?? '';
                    if (k === 'pdf') {
                        rows.append(wire(h('button', { class: 'dph-row', title: nm }, h('span', { class: 'dph-ic' }, iconSvg('file-text', 13)), h('span', { class: 'dph-n' }, nm.replace(/\.pdf$/i, '')), h('span', { class: 'dph-s' }, 'PDF')), i));
                        return;
                    }
                    const el = k === 'video' ? h('video', { muted: true, playsInline: true, preload: 'metadata' }) : h('img', { alt: '', loading: 'lazy' });
                    const tile = h('button', { class: 'dph-i' + (k === 'video' ? ' dph-vid' : ''), 'aria-label': k === 'video' ? `Play ${nm}` : `Show ${nm}` }, el);
                    if (k === 'video') {
                        const d = h('span', { class: 'dph-dur' });
                        el.addEventListener('loadedmetadata', () => { const s = el.duration; if (Number.isFinite(s))
                            d.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; });
                        tile.append(h('span', { class: 'dph-play' }, iconSvg('play', 12)), d);
                    }
                    void ctx.assetUrl(it.path).then((u) => { el.src = k === 'video' ? `${u}#t=0.1` : u; }).catch(() => tile.classList.add('missing'));
                    tiles.append(wire(tile, i));
                });
                return h('div', { class: 'dph-wrap' }, tiles.childElementCount ? tiles : null, rows.childElementCount ? rows : null);
            }
            case 'onthisday': {
                const iso = isoFromDay(day).slice(5);
                const hits = [];
                // the log's own day only with something written that day (its note); the year itself jumps there
                const noteProp = m.prop ?? cfg.modules.find((x) => x.kind === 'note')?.prop;
                for (const [d, r] of index) {
                    const t = noteProp && typeof r.values[noteProp] === 'string' ? String(r.values[noteProp]).trim() : '';
                    if (t && Math.abs(d - day) > 300 && isoFromDay(d).slice(5) === iso)
                        hits.push({ year: label(d).year, text: `“${t}”`, open: () => go(d, true), note: true });
                }
                for (const s of cfg.sources) {
                    const sdb = ctx.ws.dbs.get(s.db);
                    if (!sdb)
                        continue;
                    for (const r of sdb.rows) {
                        const d = dayOfValue(sdb.value(r, s.prop));
                        if (d != null && Math.abs(d - day) > 300 && isoFromDay(d).slice(5) === iso) {
                            const dv = asDate(sdb.value(r, s.prop));
                            hits.push({ year: label(d).year, text: entryTitle(sdb, r).text, open: () => ctx.openRow(sdb, r), color: srcColor(cfg, s), right: () => { const v = rightValue(sdb, r, s); const t = dv && dv.start.length > 10 ? dv.start.slice(11, 16) : ''; return t && v ? h('span', { class: 'dotd-tv' }, t, ' · ', v) : t || v; }, it: { db: sdb, src: s, row: r, day: d, time: dv && dv.start.length > 10 ? dv.start.slice(11, 16) : '' } });
                        }
                    }
                }
                if (!hits.length)
                    return null;
                hits.sort((a, b) => b.year - a.year);
                const per = m.goal ?? 6, maxYears = m.props?.length ? Number(m.props[0]) || 5 : 5;
                const open = otdOpen.get(`${key}:${m.id}`) ?? new Set();
                const years = [...new Set(hits.map((x) => x.year))].slice(0, maxYears);
                return h('div', { class: 'dotd' }, ...years.map((yr) => {
                    const ago = label(day).year - yr;
                    const inYear = hits.filter((x) => x.year === yr);
                    const tl = cfg.modules.find((x) => x.kind === 'timeline');
                    // grouped by database in the timeline's order, then sorted inside each like the timeline
                    const its = inYear.filter((x) => x.it).map((x) => x.it);
                    const ordered = cfg.sources.flatMap((src) => orderItems(its.filter((it) => it.src === src), tl));
                    const list = [...inYear.filter((x) => x.note), ...ordered.map((it) => inYear.find((x) => x.it === it))];
                    const all = open.has(yr);
                    const jump = () => go(dayNum(`${yr}-${isoFromDay(day).slice(5)}`), true);
                    return h('div', { class: 'dotd-yr' }, h('button', { class: 'dotd-side', title: `Go to ${label(day).day} ${label(day).month} ${yr}`, onclick: jump }, h('b', null, String(yr)), h('span', null, ago > 0 ? (ago === 1 ? '1 year earlier' : `${ago} years earlier`) : (ago === -1 ? '1 year later' : `${-ago} years later`))), h('div', { class: 'dotd-list' }, ...(all ? list : list.slice(0, per)).map((x) => { const rv = x.right?.(); const b = h('button', { class: 'dotd-row' + (x.note ? ' note' : ''), onclick: x.open }, h('span', { class: 'dotd-t' }, x.text || 'Untitled'), rv ? h('span', { class: 'dtl-r' }, rv) : null); if (x.color)
                        b.style.setProperty('--rc', x.color); return b; }), list.length > per ? h('button', { class: 'dotd-more', onclick: () => { if (all)
                            open.delete(yr);
                        else
                            open.add(yr); otdOpen.set(`${key}:${m.id}`, open); env.redraw(); } }, all ? 'Show less' : `Show ${list.length - per} more`) : null));
                }));
            }
            case 'note': {
                if (!m.prop || !db.prop(m.prop))
                    return missing(m);
                const ta = h('textarea', { class: 'dnote', rows: 2, placeholder: 'Write a few lines…' });
                ta.value = entry ? String(entry.values[m.prop] ?? '') : '';
                const fit = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
                requestAnimationFrame(fit);
                let t = 0;
                ta.addEventListener('input', () => { fit(); clearTimeout(t); t = window.setTimeout(() => void setVal(m.prop, ta.value, false), 600); });
                ta.addEventListener('blur', () => { clearTimeout(t); if ((entry?.values[m.prop] ?? '') !== ta.value)
                    void setVal(m.prop, ta.value, false); });
                return ta;
            }
            case 'habits': {
                const props = (m.props ?? []).filter((p) => db.prop(p));
                if (!props.length)
                    return h('div', { class: 'dmod-hint' }, h('button', { class: 'set-btn small', onclick: () => addHabit(m) }, 'Add a habit'));
                return h('div', { class: 'dhab' }, ...props.map((p) => {
                    const on = !!entry?.values[p];
                    let streak = 0;
                    for (let d = on ? day : day - 1;; d--) {
                        const r = index.get(d);
                        if (r?.values[p])
                            streak++;
                        else
                            break;
                    }
                    return h('button', { class: 'dhab-row' + (on ? ' on' : ''), style: { '--hc': habitColor(cfg, p) }, onclick: () => void setVal(p, !on) }, h('span', { class: 'w-box' + (on ? ' on' : '') }, on ? iconSvg('check-bold', 11) : null), h('span', { class: 'dhab-l' }, p), streak > 1 ? h('span', { class: 'dhab-s' + (streak >= 7 ? ' hot' : '') }, `${streak} days`) : null);
                }));
            }
            case 'rating': {
                if (!m.prop || !db.prop(m.prop))
                    return missing(m);
                const v = num(entry?.values[m.prop] ?? null);
                return h('div', { class: 'drate' }, ...[1, 2, 3, 4, 5].map((n) => h('button', { class: v === n ? 'on' : '', 'aria-label': `${n} of 5`, onclick: () => void setVal(m.prop, v === n ? null : n) }, face(n))));
            }
            case 'counter':
            case 'number': {
                if (!m.prop || !db.prop(m.prop))
                    return missing(m);
                if (m.kind === 'number' && m.times)
                    return sleepTimes(m);
                const v = num(entry?.values[m.prop] ?? null);
                const stepBy = m.kind === 'number' ? 0.5 : 1;
                const cur = v ?? 0;
                const big = h('button', { class: 'w-big w-mono dstep-v', title: 'Type a value', onclick: () => prompt(big, m.title, v == null ? '' : String(v), (t) => { const n = Number(t.replace(',', '.')); void setVal(m.prop, t.trim() === '' || !Number.isFinite(n) ? null : n); }) }, v == null ? (m.kind === 'counter' ? '0' : '–') : fmtNumber(v));
                const goal = m.goal ?? 0;
                const pts = [];
                if (m.kind === 'number')
                    for (let d = day - 13; d <= day; d++) {
                        const x = num(index.get(d)?.values[m.prop] ?? null);
                        if (x != null)
                            pts.push(x);
                    }
                return h('div', { class: 'w-col w-center dstep' }, h('div', { class: 'w-row w-counter' }, h('button', { class: 'w-btn round', 'aria-label': 'Less', onclick: () => void setVal(m.prop, Math.max(0, cur - stepBy)) }, '−'), h('div', { class: 'w-col w-center' }, big, m.unit || goal ? h('span', { class: 'w-sub' }, goal ? `of ${goal}${m.unit ? ` ${m.unit}` : ''}` : m.unit) : null), h('button', { class: 'w-btn round primary', 'aria-label': 'More', onclick: () => void setVal(m.prop, Math.round((cur + stepBy) * 10) / 10) }, '+')), goal ? h('div', { class: 'dstep-bar' }, h('i', { style: { width: `${Math.min(100, (cur / goal) * 100)}%` } })) : null, pts.length > 1 ? spark(pts) : null);
            }
        }
    }
    /** two times (to bed, up) – the hours in between are stored in the module's property; a bar shows the
     *  night from 20:00 to 12:00 */
    function sleepTimes(m) {
        const bedP = `${m.prop} · bed`, upP = `${m.prop} · up`;
        const timeOf = (p) => { const raw = String(entry?.values[p] ?? ''); return /^\d\d:\d\d$/.test(raw) ? raw : null; };
        const field = (p, lab) => {
            const raw = timeOf(p);
            const inp = h('input', { type: 'text', inputmode: 'numeric', class: 'dsl-t', value: raw ? fmtTime(raw) : '', placeholder: lab, 'aria-label': lab });
            // the field is as wide as its text: an invisible copy of the text sizes the box (works in every browser)
            const box = h('span', { class: 'dsl-tw' }, inp);
            const fit = () => { box.dataset.v = inp.value || lab; };
            fit();
            inp.addEventListener('input', fit);
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter')
                inp.blur(); });
            inp.addEventListener('change', async () => {
                const t = parseTime(inp.value);
                if (inp.value.trim() && !t) {
                    inp.value = raw ? fmtTime(raw) : '';
                    fit();
                    return;
                }
                inp.value = t ? fmtTime(t) : '';
                fit();
                if (!db.prop(p)) {
                    db.schema.properties.push({ name: p, type: 'text' });
                    await ctx.ws.saveSchema(db);
                }
                const r = await ensure();
                r.values[p] = parseTime(inp.value) || null;
                const a = String(r.values[bedP] ?? ''), b = String(r.values[upP] ?? '');
                if (/^\d\d:\d\d$/.test(a) && /^\d\d:\d\d$/.test(b)) {
                    const mins = (((+b.slice(0, 2) * 60 + +b.slice(3)) - (+a.slice(0, 2) * 60 + +a.slice(3))) + 1440) % 1440;
                    r.values[m.prop] = Math.round(mins / 6) / 10;
                }
                await ctx.ws.saveRow(db, r);
                env.redraw();
            });
            return box;
        };
        const v = num(entry?.values[m.prop] ?? null);
        const total = v == null ? h('span', { class: 'dsl-tot none' }, '0:00', h('small', null, 'h')) : h('span', { class: 'dsl-tot' }, `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`, h('small', null, 'h'));
        // the night: 20:00 → 12:00 (16 hours)
        const bed = timeOf(bedP), up = timeOf(upP);
        const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3);
        let fill = null;
        if (bed && up) {
            const from = (mins(bed) - 1200 + 1440) % 1440, len = (mins(up) - mins(bed) + 1440) % 1440;
            const l = Math.min(960, from), w = Math.max(0, Math.min(960, from + len) - l);
            fill = h('i', { style: { left: `${(l / 960) * 100}%`, width: `${(w / 960) * 100}%` } });
        }
        return h('div', { class: 'dsl' }, h('div', { class: 'dsl-row' }, field(bedP, 'To bed'), h('span', { class: 'dsl-arr' }, '→'), field(upP, 'Up'), total), h('div', { class: 'dsl-bar' }, fill), h('div', { class: 'dsl-ticks' }, ...['20:00', '00:00', '04:00', '08:00', '12:00'].map((t) => h('span', null, fmtTime(t)))));
    }
    function subline(x) {
        const time = null;
        const vals = (x.src.props ?? []).filter((p) => p !== x.src.sum).map((p) => { const d = x.db.prop(p); const v = x.db.value(x.row, p); return d && v != null && v !== '' && !(Array.isArray(v) && !v.length) ? renderValue(x.db, d, v) : null; }).filter(Boolean);
        return time || vals.length ? h('div', { class: 'dtl-sub' }, ...(time ? [time] : []), ...vals) : null;
    }
    function missing(m) {
        return h('div', { class: 'dmod-hint' }, h('button', { class: 'set-btn small', onclick: () => { void makeProp(m).then(saveCfg); } }, `Store in “${m.title}”`));
    }
    // ── settings ──
    async function makeProp(m) {
        const type = kindOf(m.kind).records;
        let name = m.title, i = 2;
        while (db.prop(name))
            name = `${m.title} ${i++}`;
        db.schema.properties.push({ name, type });
        m.prop = name;
        await ctx.ws.saveSchema(db);
    }
    function addHabit(m) {
        prompt(root, 'Habit', '', async (v) => {
            const name = v.trim();
            if (!name)
                return;
            if (!db.prop(name))
                db.schema.properties.push({ name, type: 'checkbox' });
            m.props = [...(m.props ?? []).filter((x) => x !== name), name];
            saveCfg();
        });
    }
    function addModule(at) {
        const entries = [{ section: 'Shows things' }];
        for (const k of KINDS) {
            if (k.kind === 'timeline')
                continue; // always there
            if (k.kind === 'note')
                entries.push({ section: 'Records things' });
            entries.push({ label: k.label, icon: menuIcon(k.icon), hint: k.desc, run: async () => {
                    const m = { id: shortId(), kind: k.kind, title: k.kind === 'note' ? 'How was your day?' : k.kind === 'rating' ? 'Mood' : k.kind === 'counter' ? 'Water' : k.kind === 'number' ? 'Sleep' : k.label };
                    if (k.records && k.kind !== 'habits')
                        await makeProp(m);
                    cfg.modules.push(m);
                    saveCfg();
                    if (k.kind === 'timeline' && !cfg.sources.length)
                        toast('Add databases under the timeline’s ⋯ → Databases');
                } });
        }
        menu(at, entries, { title: 'Add module' });
    }
    function moduleMenu(m, at) {
        const i = cfg.modules.indexOf(m);
        // up / down among the modules of the same column (the list holds both columns)
        const colOf = (x) => x.col ?? (kindOf(x.kind).side ? 'side' : 'main');
        const move = (n) => {
            let j = i + n;
            while (j >= 0 && j < cfg.modules.length && colOf(cfg.modules[j]) !== colOf(m))
                j += n;
            if (j < 0 || j >= cfg.modules.length)
                return;
            [cfg.modules[i], cfg.modules[j]] = [cfg.modules[j], cfg.modules[i]];
            saveCfg();
        };
        const own = [];
        if (m.kind === 'timeline') {
            const list = sortKeys(m);
            own.push({ label: 'Order', icon: menuIcon('arrow-up-down'), hint: list.filter((k) => k.on).map((k) => SORT_LABEL[k.key].split(' ')[0]).join(', ') || 'As stored', sub: () => [
                    { section: 'Sorted by these, top first' },
                    ...list.map((k, i) => ({ label: SORT_LABEL[k.key], toggle: k.on, onToggle: (on) => { k.on = on; m.sorts = list; delete m.sort; saveCfg(); },
                        reorder: { key: 'tl-sort', index: i, move: (from, to) => { const [x] = list.splice(from, 1); list.splice(to, 0, x); m.sorts = list; delete m.sort; saveCfg(); } } })),
                ] });
        }
        if (m.kind === 'timeline')
            own.push({ label: 'Entries per database', icon: menuIcon('list'), hint: m.goal === 0 ? 'All' : String(m.goal ?? 5), sub: () => [3, 5, 10, 0].map((n) => ({ label: `${(m.goal ?? 5) === n ? '✓' : '   '} ${n || 'All'}`, run: () => { m.goal = n === 5 ? undefined : n; saveCfg(); } })) });
        if (m.kind === 'timeline')
            own.push({ label: 'Color rows by database', icon: menuIcon('palette'), toggle: !!m.tint, onToggle: (on) => { m.tint = on || undefined; saveCfg(); } });
        if (m.kind === 'timeline')
            own.push({ label: 'Databases', icon: menuIcon('database'), hint: String(cfg.sources.length), sub: () => logDatabaseEntries(env) });
        if (m.kind === 'habits')
            own.push({ label: 'Habits', icon: menuIcon('check-square'), hint: String((m.props ?? []).length), sub: () => habitEntries(m, at) });
        if (m.kind === 'calendar') {
            own.push({ label: 'Size', icon: menuIcon('calendar'), seg: { options: [['month', 'Month'], ['week', 'Week']], value: m.size ?? 'month', pick: (v) => { m.size = v === 'week' ? 'week' : undefined; saveCfg(); } } });
            own.push({ label: 'Color days by', icon: menuIcon('palette'), hint: m.prop ?? 'None', sub: () => [{ label: `${!m.prop ? '✓' : '   '} None`, run: () => { delete m.prop; saveCfg(); } }, ...cfg.modules.filter((x) => x.kind === 'rating' && x.prop).map((x) => ({ label: `${m.prop === x.prop ? '✓' : '   '} ${x.title}`, run: () => { m.prop = x.prop; saveCfg(); } }))] });
        }
        if (m.kind === 'photos')
            own.push({ label: 'Shows', icon: menuIcon('image'), hint: (m.media ?? ['image', 'video', 'pdf']).length === 3 ? 'All' : String((m.media ?? []).length), sub: () => ['image', 'video', 'pdf'].map((k) => ({ label: { image: 'Photos', video: 'Videos', pdf: 'PDFs' }[k], icon: menuIcon({ image: 'image', video: 'video', pdf: 'file-text' }[k]), toggle: (m.media ?? ['image', 'video', 'pdf']).includes(k), onToggle: (on) => { const cur = new Set(m.media ?? ['image', 'video', 'pdf']); if (on)
                        cur.add(k);
                    else
                        cur.delete(k); m.media = cur.size === 3 ? undefined : [...cur]; saveCfg(); } })) });
        if (m.kind === 'covers')
            own.push({ label: 'Database', icon: menuIcon('database'), hint: ctx.ws.dbs.get(m.prop ?? '')?.schema.name ?? 'Auto', sub: () => cfg.sources.filter((x) => x.image).map((x) => ({ label: `${m.prop === x.db ? '✓' : '   '} ${ctx.ws.dbs.get(x.db)?.schema.name ?? x.db}`, run: () => { m.prop = x.db; saveCfg(); } })) });
        if (m.kind === 'onthisday') {
            own.push({ label: 'Entries per year', icon: menuIcon('list'), hint: String(m.goal ?? 6), sub: () => [3, 6, 10, 20].map((n) => ({ label: `${(m.goal ?? 6) === n ? '✓' : '   '} ${n}`, run: () => { m.goal = n === 6 ? undefined : n; saveCfg(); } })) });
            own.push({ label: 'Years', icon: menuIcon('calendar'), hint: m.props?.[0] ?? '5', sub: () => [3, 5, 10, 20].map((n) => ({ label: `${Number(m.props?.[0] ?? 5) === n ? '✓' : '   '} ${n}`, run: () => { m.props = n === 5 ? undefined : [String(n)]; saveCfg(); } })) });
        }
        if (m.kind === 'counter')
            own.push({ label: 'Goal', icon: menuIcon('target'), hint: m.goal ? String(m.goal) : 'None', run: () => prompt(at, 'Goal per day (empty: none)', m.goal ? String(m.goal) : '', (v) => { const n = Number(v); m.goal = n > 0 ? Math.round(n) : undefined; saveCfg(); }) });
        if (m.kind === 'number')
            own.push({ label: 'Enter', icon: menuIcon('clock'), seg: { options: [['value', 'Value'], ['times', 'Two times']], value: m.times ? 'times' : 'value', pick: (v) => { m.times = v === 'times' || undefined; saveCfg(); } } });
        if (m.kind === 'counter' || (m.kind === 'number' && !m.times))
            own.push({ label: 'Unit', icon: menuIcon('type'), hint: m.unit || 'None', run: () => prompt(at, 'Unit (e.g. glasses, h, kg)', m.unit ?? '', (v) => { m.unit = v.trim() || undefined; saveCfg(); }) });
        if (kindOf(m.kind).records && m.kind !== 'habits')
            own.push({ label: 'Stored in', icon: menuIcon('database'), hint: m.prop ?? '—', sub: () => db.schema.properties.filter((p) => p.type === kindOf(m.kind).records).map((p) => ({ label: `${p.name === m.prop ? '✓' : '   '} ${p.name}`, run: () => { m.prop = p.name; saveCfg(); } })) });
        menu(at, [
            { label: 'Rename', icon: menuIcon('pencil'), run: () => prompt(at, 'Title', m.title, (v) => { if (v.trim()) {
                    m.title = v.trim();
                    saveCfg();
                } }) },
            ...own,
            { section: 'Arrange' },
            { label: 'Column', icon: menuIcon('columns'), seg: { options: [['main', 'Main'], ['side', 'Side']], value: m.col ?? (kindOf(m.kind).side ? 'side' : 'main'), pick: (v) => { m.col = v; saveCfg(); } } },
            { label: 'Move up', icon: menuIcon('arrow-up'), run: () => move(-1) },
            { label: 'Move down', icon: menuIcon('arrow-down'), run: () => move(1) },
            ...(m.kind === 'timeline' ? [] : ['sep',
                { label: 'Remove module', icon: menuIcon('trash'), danger: true, run: () => removeModule(m) }]),
        ], { title: m.title });
    }
    /** the habits of a module: drag to reorder, each with its own page (name, colour, stop tracking) */
    function habitEntries(m, at) {
        const list = m.props ?? [];
        return [
            ...list.map((p, i) => ({
                label: p, icon: cssDot(habitColor(cfg, p)),
                reorder: { key: 'habits', index: i, move: (from, to) => { const l = [...list]; const [x] = l.splice(from, 1); l.splice(to, 0, x); m.props = l; saveCfg(); } },
                sub: () => [
                    { label: 'Rename', icon: menuIcon('pencil'), run: () => prompt(at, 'Habit', p, async (v) => { const name = v.trim(); if (!name || name === p || db.prop(name))
                            return; ctx.ws.boundary(); await ctx.ws.renameProp(db, p, name); m.props = (m.props ?? []).map((x) => (x === p ? name : x)); if (m.colors?.[p]) {
                            m.colors[name] = m.colors[p];
                            delete m.colors[p];
                        } saveCfg(); }) },
                    { section: 'Color' },
                    ...colorEntries(m.colors?.[p] ?? 'default', (c) => { if (c === 'default')
                        delete m.colors?.[p];
                    else
                        (m.colors ??= {})[p] = c; saveCfg(); }, { none: 'Accent', noneCss: 'var(--accent)', step: 'text' }),
                    'sep',
                    { label: 'Stop tracking', icon: menuIcon('minus-circle'), hint: 'Values are kept', danger: true, run: () => { m.props = (m.props ?? []).filter((x) => x !== p); if (m.colors)
                            delete m.colors[p]; saveCfg(); } },
                ],
            })),
            ...(list.length ? ['sep'] : []),
            { label: 'Add a habit', icon: menuIcon('plus'), run: () => addHabit(m) },
        ];
    }
    /** a recording module's values live in a property: when no other module uses it, ask whether it goes too */
    function removeModule(m) {
        const props = (m.kind === 'habits' ? m.props ?? [] : m.prop && kindOf(m.kind).records && m.kind !== 'note' ? [m.prop] : []).filter((p) => db.prop(p) && !cfg.modules.some((x) => x !== m && (x.prop === p || x.props?.includes(p))));
        const drop = () => { cfg.modules = cfg.modules.filter((x) => x !== m); };
        if (!props.length) {
            drop();
            saveCfg();
            return;
        }
        // asked before anything happens: the module only, or its recorded values too
        const filled = db.rows.filter((r) => props.some((p) => r.values[p] != null && r.values[p] !== '' && r.values[p] !== false)).length;
        const btn = (label, cls, run) => h('button', { class: cls, onclick: async () => { close(); await run(); } }, label);
        const close = dialog(h('div', { class: 'confirm-box' }, h('div', { class: 'confirm-title' }, `Remove “${m.title}”?`), h('p', { class: 'confirm-text' }, filled ? `What you recorded with it is kept on ${filled} day${filled === 1 ? '' : 's'} (in the property “${props.join('”, “')}”).` : 'Nothing has been recorded with it yet.'), h('p', { class: 'confirm-text' }, 'Keep the values to add the module again later with its history, or delete them too.'), h('div', { class: 'confirm-actions' }, btn('Cancel', 'set-btn', () => { }), btn('Remove module, keep values', 'set-btn', () => { drop(); saveCfg(); }), btn('Delete values too', 'btn-new danger-btn', async () => {
            drop();
            db.schema.properties = db.schema.properties.filter((x) => !props.includes(x.name));
            for (const v of db.views)
                for (const p of props)
                    removePropFromView(v, p);
            ctx.ws.boundary();
            await ctx.ws.saveSchema(db);
            await ctx.ws.saveViews(db);
            env.redraw();
        }))));
    }
    function sourcesMenu(at) { logDatabases(env, at); }
    function calendar(anchor) {
        const all = new Set([...index.keys()].map(isoFromDay));
        for (const src of cfg.sources) {
            const sdb = ctx.ws.dbs.get(src.db);
            if (sdb)
                for (const r of sdb.rows) {
                    const d = dayOfValue(sdb.value(r, src.prop));
                    if (d != null)
                        all.add(isoFromDay(d));
                }
        }
        const count = (a, b) => { let n = 0; for (const d of all)
            if (d >= a && d < b)
                n++; return n; };
        zoomPicker(anchor, { iso: isoFromDay(day), onDay: (iso) => go(dayNum(iso), true), has: (iso) => all.has(iso),
            note: (y, mm) => { const n = count(`${y}-${String(mm).padStart(2, '0')}-01`, `${y}-${String(mm).padStart(2, '0')}-32`); return n ? String(n) : ''; },
            yearNote: (y) => { const n = count(`${y}-01-01`, `${y + 1}-01-01`); return n ? `${n} days` : ''; } });
    }
}
/** which databases a log shows (timeline, on this day, photos) – from the timeline's ⋯ or the view settings */
function logDatabases(env, at) { menu(at, logDatabaseEntries(env), { title: 'Databases' }); }
/** the entries of that list – a menu from the timeline, a page in the view settings */
export function logDatabaseEntries(env) {
    const { db, ctx } = env;
    const cfg = dayConfig(db);
    const saveCfg = () => { void ctx.ws.saveSchema(db); env.redraw(); };
    const dbs = [...ctx.ws.dbs.values()].filter((d) => d.key !== db.key && d.schema.properties.some(isDate));
    return [
        ...(cfg.sources.length ? [{ section: 'Shown' }] : []),
        ...cfg.sources.map((s) => {
            const sdb = ctx.ws.dbs.get(s.db);
            return { label: sdb?.schema.name ?? s.db, icon: colorDot(s.color ?? COLOR_ORDER[cfg.sources.indexOf(s) % COLOR_ORDER.length], 'text'), hint: s.sum ? `Σ ${s.sum}` : s.prop,
                reorder: { key: 'sources', index: cfg.sources.indexOf(s), move: (a, b) => { const [x] = cfg.sources.splice(a, 1); cfg.sources.splice(b, 0, x); void ctx.ws.saveSchema(db); env.redraw(); } }, sub: () => sdb ? [
                    { section: 'Date' }, ...sdb.schema.properties.filter(isDate).map((p) => ({ label: `${p.name === s.prop ? '✓' : '   '} ${p.name}`, run: () => { s.prop = p.name; saveCfg(); } })),
                    { section: 'Adds up' }, { label: `${!s.sum ? '✓' : '   '} Count entries`, run: () => { delete s.sum; saveCfg(); } },
                    ...sdb.schema.properties.filter((p) => p.type === 'number').map((p) => ({ label: `${s.sum === p.name ? '✓' : '   '} Sum of ${p.name}`, run: () => { s.sum = p.name; saveCfg(); } })),
                    { section: 'Shown next to entries' }, ...sdb.schema.properties.filter((p) => p.name !== sdb.labelProp && p.name !== s.prop && p.type !== 'title').map((p) => ({ label: p.name, toggle: (s.props ?? []).includes(p.name), onToggle: (on) => { s.props = on ? [...(s.props ?? []), p.name] : (s.props ?? []).filter((x) => x !== p.name); saveCfg(); } })),
                    { section: 'Color' }, ...colorEntries(s.color ?? COLOR_ORDER[cfg.sources.indexOf(s) % COLOR_ORDER.length], (c) => { s.color = c; saveCfg(); }, { step: 'text' }),
                    'sep', { label: 'Remove', danger: true, run: () => { cfg.sources = cfg.sources.filter((x) => x !== s); saveCfg(); } },
                ] : [] };
        }),
        ...(dbs.filter((d) => !cfg.sources.some((s) => s.db === d.key)).length ? [{ section: 'Add' }] : []),
        ...dbs.filter((d) => !cfg.sources.some((s) => s.db === d.key)).map((d) => ({ label: d.schema.name, icon: menuIcon('plus'), run: () => {
                const num1 = d.schema.properties.find((p) => p.type === 'number');
                cfg.sources.push({ db: d.key, prop: d.schema.properties.find(isDate).name, color: COLOR_ORDER[cfg.sources.length % COLOR_ORDER.length], sum: num1?.name, props: num1 ? [num1.name] : [] });
                saveCfg();
            } })),
    ];
}
/** a picture from a link or file property, e.g. a film poster */
/** pictures already shown: the same <img> is moved into the redrawn view, so a redraw never blinks */
const shownImgs = new Map();
let coverGen = 0;
function cover(d, r, prop, cls) {
    const v = d.value(r, prop);
    const src = (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []).find((f) => IMAGE_RE.test(f) || /^https?:\/\//.test(f));
    if (!src)
        return null;
    const k = `${cls}|${src}`;
    let img = shownImgs.get(k);
    // shown in the page now: moved into the new view; already placed in the new view (twice at once): a copy
    if (img && img.dataset.gen === String(coverGen))
        img = img.cloneNode();
    else if (img)
        img.dataset.gen = String(coverGen);
    else if (!img) {
        img = h('img', { alt: '', decoding: 'async' });
        const ctx = window.nook;
        if (/^(https?:|data:|blob:)/.test(src) || !ctx)
            img.src = src;
        else
            void ctx.assetUrl(src).then((u) => { img.src = u; }).catch(() => img.remove());
        img.dataset.gen = String(coverGen);
        shownImgs.set(k, img);
    }
    if (shownImgs.size > 400)
        shownImgs.delete(shownImgs.keys().next().value);
    return h('span', { class: cls }, img);
}
/** what the timeline shows on the right of an entry: the summed value, else the first shown property */
function rightValue(d, r, s) {
    const n = s.sum ? num(d.value(r, s.sum)) : null;
    if (s.sum && n != null)
        return fmtNumber(n, d.prop(s.sum)?.format) + (s.unit ? ` ${s.unit}` : '');
    for (const p of [s.avg, ...(s.props ?? [])]) {
        if (!p)
            continue;
        const def = d.prop(p);
        const v = d.value(r, p);
        if (def && v != null && v !== '' && !(Array.isArray(v) && !v.length))
            return renderValue(d, def, v);
    }
    return null;
}
/** a drawn face, 1 (low) to 5 (high) – the same on every device */
function face(n) {
    const mouth = ['M8 16.5q4-3.5 8 0', 'M8.5 16q3.5-1.6 7 0', 'M8.5 15.5h7', 'M8.5 14.5q3.5 2 7 0', 'M8 14q4 4.5 8 0'][n - 1];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('class', `dface f${n}`);
    svg.innerHTML = `<circle cx="12" cy="12" r="9.2"/><circle cx="9" cy="10" r="1.1" class="eye"/><circle cx="15" cy="10" r="1.1" class="eye"/><path d="${mouth}"/>`;
    return svg;
}
function spark(pts) {
    const w = 90, hh = 26, lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(hh));
    svg.setAttribute('class', 'dspark');
    const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    pl.setAttribute('points', pts.map((p, i) => `${(i / (pts.length - 1)) * w},${hh - 3 - ((p - lo) / span) * (hh - 6)}`).join(' '));
    svg.append(pl);
    return svg;
}
const PRESETS = [
    { id: 'diary', icon: '📔', name: 'Diary', desc: 'Timeline, photos, mood, “How was your day?”, on this day', props: [['Mood', 'number'], ['Note', 'text']],
        modules: [{ kind: 'photos', title: 'Media' }, { kind: 'timeline', title: 'Timeline' }, { kind: 'note', title: 'How was your day?', prop: 'Note' }, { kind: 'onthisday', title: 'On this day', prop: 'Note' }, { kind: 'rating', title: 'Mood', prop: 'Mood' }, { kind: 'habits', title: 'Habits', props: [] }] },
    { id: 'shoot', icon: '🎬', name: 'Shoot days', desc: 'Scenes and call times, costs, set photos, notes, how the day went', props: [['Day went', 'number'], ['Hours', 'number'], ['Notes', 'text']],
        modules: [{ kind: 'timeline', title: 'Timeline' }, { kind: 'note', title: 'Notes from the set', prop: 'Notes' }, { kind: 'photos', title: 'Set photos', col: 'side' }, { kind: 'number', title: 'Hours', prop: 'Hours', unit: 'h' }, { kind: 'rating', title: 'Day went', prop: 'Day went' }] },
    { id: 'health', icon: '💪', name: 'Health', desc: 'Meals and training, water, sleep, energy, habits', props: [['Energy', 'number'], ['Water', 'number'], ['Sleep', 'number']],
        modules: [{ kind: 'timeline', title: 'Timeline' }, { kind: 'rating', title: 'Energy', prop: 'Energy' }, { kind: 'counter', title: 'Water', prop: 'Water', goal: 8, unit: 'glasses' }, { kind: 'number', title: 'Sleep', prop: 'Sleep', unit: 'h' }, { kind: 'habits', title: 'Habits', props: [] }] },
    { id: 'work', icon: '💼', name: 'Work log', desc: 'Meetings and tasks, hours worked, “What got done?”', props: [['Hours', 'number'], ['Done', 'text']],
        modules: [{ kind: 'timeline', title: 'Timeline' }, { kind: 'note', title: 'What got done?', prop: 'Done' }, { kind: 'number', title: 'Hours', prop: 'Hours', unit: 'h' }] },
    { id: 'study', icon: '🎓', name: 'Study', desc: 'Classes and deadlines, study hours, “What did I learn?”', props: [['Study hours', 'number'], ['Learned', 'text']],
        modules: [{ kind: 'timeline', title: 'Timeline' }, { kind: 'note', title: 'What did I learn?', prop: 'Learned' }, { kind: 'counter', title: 'Study hours', prop: 'Study hours', unit: 'h' }] },
    { id: 'travel', icon: '✈️', name: 'Travel', desc: 'Photos, places, expenses, a note per day', props: [['Note', 'text']],
        modules: [{ kind: 'photos', title: 'Media' }, { kind: 'note', title: 'Today', prop: 'Note' }, { kind: 'timeline', title: 'Timeline' }] },
    { id: 'care', icon: '🐶', name: 'Pet / baby', desc: 'Walks or feeds as counters, sleep, notes', props: [['Walks', 'number'], ['Sleep', 'number'], ['Notes', 'text']],
        modules: [{ kind: 'counter', title: 'Walks', prop: 'Walks', col: 'main' }, { kind: 'number', title: 'Sleep', prop: 'Sleep', unit: 'h', col: 'main' }, { kind: 'note', title: 'Notes', prop: 'Notes' }, { kind: 'timeline', title: 'Timeline' }] },
    { id: 'habits', icon: '🌱', name: 'Habits', desc: 'Habits with streaks, one rating, a short note', props: [['Mood', 'number'], ['Note', 'text']],
        modules: [{ kind: 'habits', title: 'Habits', props: [], col: 'main' }, { kind: 'rating', title: 'Mood', prop: 'Mood', col: 'main' }, { kind: 'note', title: 'Note', prop: 'Note' }] },
    { id: 'empty', icon: '◻', name: 'Empty', desc: 'Start with nothing and add modules', props: [], modules: [] },
];
export function newDayDatabase(ctx) {
    let pick = PRESETS[0];
    const nameIn = h('input', { class: 'set-input', value: pick.name });
    const grid = h('div', { class: 'dpre-grid' });
    const drawGrid = () => grid.replaceChildren(...PRESETS.map((p) => h('button', { class: 'dpre' + (p === pick ? ' on' : ''), onclick: () => { if (nameIn.value === pick.name)
            nameIn.value = p.name; pick = p; drawGrid(); } }, h('b', null, h('span', null, p.icon), p.name), h('span', null, p.desc))));
    drawGrid();
    let close = () => { };
    const create = async () => {
        const ws = ctx.ws;
        const db = await ws.createDatabase(nameIn.value.trim() || pick.name);
        db.schema.icon = pick.icon;
        db.schema.properties = db.schema.properties.filter((p) => p.type !== 'multi_select');
        for (const [n, t] of pick.props)
            if (!db.prop(n))
                db.schema.properties.push({ name: n, type: t });
        const cfg = { prop: 'Date', sources: [], modules: pick.modules.map((m) => ({ ...m, id: shortId() })) };
        db.schema.day = cfg;
        db.views = [
            { id: 'day', name: 'Log', type: 'day' },
            { id: 'table', name: 'All days', type: 'table', props: db.schema.properties.map((p) => p.name), sorts: [{ prop: 'Date', dir: 'desc' }] },
        ];
        await ws.saveSchema(db);
        await ws.saveViews(db);
        close();
        ctx.openDb(db.key);
    };
    const box = h('div', { class: 'dpre-box' }, h('h3', null, 'New log'), h('p', { class: 'muted' }, 'One entry per day. Pick a start – modules can be added, moved and removed later.'), h('label', { class: 'dpre-name' }, h('span', null, 'Name'), nameIn), grid, h('div', { class: 'confirm-actions' }, h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'set-btn primary', onclick: () => void create() }, 'Create')));
    close = dialog(box, { wide: false });
}
//# sourceMappingURL=days.js.map