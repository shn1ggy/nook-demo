// Day log: the entries of several databases on one timeline – everything that happened on a
// day (appointments, expenses, meals, notes …), each from its own database, matched by a date
// property. Nothing is copied: the view reads the databases as they are; clicking an entry
// opens it in its own database.
import { query } from '../workspace.js';
import { openViewSettings } from './viewpanel.js';
import { asDate, dayNum, isoFromDay, todayISO, weekStart, MONTHS, WEEKDAYS, fmtNumber, h, COLORS } from '../util.js';
import { renderValue, entryTitle } from './cells.js';
import { rowMenu } from './rowmenu.js';
import { iconSvg } from '../ui/icons.js';
import { menu, openPop, closePop, panel } from '../ui/pop.js';
import { registerWidget } from '../widgets/api.js';
import { viewState } from './view.js';
const COLOR_ORDER = ['blue', 'yellow', 'green', 'purple', 'pink', 'orange', 'red', 'brown', 'gray'];
const dateProps = (db) => db.schema.properties.filter((p) => p.type === 'date' || p.type === 'created_time');
/** the sources of a day log; the first time: this database (if it has a date) */
export function daySources(env) {
    const v = env.view;
    if (!v.sources) {
        const d = v.dlBlock ? undefined : dateProps(env.db)[0];
        v.sources = d ? [{ db: env.db.key, prop: d.name, color: 'blue' }] : [];
    }
    return v.sources.filter((s) => env.ctx.ws.dbs.get(s.db)?.prop(s.prop));
}
export const sourceColor = (s, i) => s.color ?? COLOR_ORDER[i % COLOR_ORDER.length];
/** where the log stands (per view block): unit and the day it shows */
const at = new Map();
function place(env) {
    const k = env.view.id;
    if (!at.has(k))
        at.set(k, { unit: (env.view.dlUnit) ?? 'week', day: dayNum(todayISO()) });
    return at.get(k);
}
const wdOf = (d) => (d + 3) % 7; // 0 = Monday
const weekFirst = (d) => d - ((wdOf(d) - weekStart() + 7) % 7);
function span(env) {
    const p = place(env);
    if (p.unit === 'day')
        return [p.day, p.day + 1];
    if (p.unit === 'week') {
        const f = weekFirst(p.day);
        return [f, f + 7];
    }
    const iso = isoFromDay(p.day), y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    const f = dayNum(`${y}-${String(m).padStart(2, '0')}-01`);
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [f, f + n];
}
const dayLabel = (d) => { const iso = isoFromDay(d); return { wd: WEEKDAYS[wdOf(d)], dm: `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1].slice(0, 3)}` }; };
function collect(env, from, to) {
    const out = [];
    for (const src of daySources(env)) {
        if (src.off)
            continue;
        const db = env.ctx.ws.dbs.get(src.db);
        // the source's own filter and the search (title and text, as in every view)
        const rows = query(db, { id: `dl-${src.db}`, name: '', type: 'table', filter: src.filter }, 0, env.state.search).rows;
        for (const row of rows) {
            const raw = src.prop === 'created' ? null : db.value(row, src.prop);
            const d = asDate(raw);
            if (!d)
                continue;
            const day = dayNum(d.start.slice(0, 10));
            if (day < from || day >= to)
                continue;
            out.push({ db, src, row, day, time: d.start.length > 10 ? d.start.slice(11, 16) : '' });
        }
    }
    const untimedLast = env.view.dlUntimed === 'last';
    return out.sort((a, b) => a.day - b.day || (a.time ? 0 : untimedLast ? 1 : -1) - (b.time ? 0 : untimedLast ? 1 : -1) || a.time.localeCompare(b.time));
}
/** the day's summary chips: per source a sum (of its chosen number) or a count */
function summary(env, items) {
    const out = [];
    for (const src of daySources(env)) {
        const mine = items.filter((x) => x.src === src);
        if (!mine.length)
            continue;
        const db = env.ctx.ws.dbs.get(src.db);
        if (src.sum && db.prop(src.sum)) {
            const total = mine.reduce((a, x) => a + (Number(db.value(x.row, src.sum)) || 0), 0);
            out.push(fmtNumber(total, db.prop(src.sum).format));
        }
        else
            out.push(`${mine.length} ${db.schema.name}`);
    }
    return out;
}
function values(item) {
    const box = h('span', { class: 'dl-vals' });
    for (const name of item.src.props ?? []) {
        const def = item.db.prop(name);
        const v = item.db.value(item.row, name);
        if (!def || v == null || v === '' || (Array.isArray(v) && !v.length))
            continue;
        box.append(h('span', { class: 'dl-val' }, renderValue(item.db, def, v)));
    }
    return box;
}
export function renderDayLog(env) {
    const p = place(env);
    const v = env.view;
    const root = h('div', { class: 'daylog' });
    const sources = daySources(env);
    const [from, to] = span(env);
    const today = dayNum(todayISO());
    const redraw = () => env.redraw();
    const save = () => { env.saveView(); env.redraw(); };
    // ── head: layout, period with a calendar, day / week / month, today, new ──
    const label = p.unit === 'day' ? `${dayLabel(p.day).wd}, ${dayLabel(p.day).dm} ${isoFromDay(p.day).slice(0, 4)}`
        : p.unit === 'week' ? `${dayLabel(from).dm} – ${dayLabel(to - 1).dm} ${isoFromDay(to - 1).slice(0, 4)}`
            : `${MONTHS[+isoFromDay(p.day).slice(5, 7) - 1]} ${isoFromDay(p.day).slice(0, 4)}`;
    const step = (n) => { if (p.unit === 'day')
        p.day += n;
    else if (p.unit === 'week')
        p.day += 7 * n;
    else {
        const iso = isoFromDay(p.day);
        const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + n;
        p.day = dayNum(`${y + Math.floor(m / 12)}-${String(((m % 12) + 12) % 12 + 1).padStart(2, '0')}-01`);
    } redraw(); };
    const per = h('button', { class: 'dl-period', onclick: () => calendarPop(per) }, label, iconSvg('chevron-down', 12));
    const seg = (opts, cur, pick) => h('span', { class: 'mseg dl-seg' }, ...opts.map(([k, t]) => h('span', { class: k === cur ? 'on' : '', onclick: () => pick(k) }, t)));
    root.append(h('div', { class: 'dl-head' }, p.unit === 'week' ? seg([['list', 'List'], ['cols', 'Columns']], v.dlLayout ?? 'list', (k) => { v.dlLayout = k; save(); }) : h('span'), h('span', { class: 'dl-sp' }), h('button', { class: 'icon-btn', 'aria-label': 'Earlier', onclick: () => step(-1) }, iconSvg('chevron-left', 15)), per, h('button', { class: 'icon-btn', 'aria-label': 'Later', onclick: () => step(1) }, iconSvg('chevron-right', 15)), seg([['day', 'Day'], ['week', 'Week'], ['month', 'Month']], p.unit, (k) => { p.unit = k; v.dlUnit = k; env.saveView(); redraw(); }), h('button', { class: 'icon-btn', 'aria-label': 'Today', title: 'Today', onclick: () => { p.day = today; redraw(); } }, iconSvg('crosshair', 15)), 
    // as a block (no database toolbar): its own search and New
    ...(v.dlBlock ? [
        searchField(),
        h('button', { class: 'btn-new', onclick: (e) => dayLogNew(env, e.currentTarget) }, 'New'),
    ] : [])));
    function searchField() {
        const inp = h('input', { class: 'dl-search', placeholder: 'Search', value: env.state.search });
        inp.addEventListener('input', () => {
            env.state.search = inp.value;
            const caret = inp.selectionStart;
            redraw();
            const again = document.querySelector(`[data-dl="${env.view.id}"] .dl-search`);
            if (again) {
                again.focus();
                again.setSelectionRange(caret, caret);
            }
        });
        return h('span', { class: 'dl-search-box' }, iconSvg('search', 14), inp);
    }
    root.dataset.dl = env.view.id;
    // ── source chips: tap to hide / show ──
    if (sources.length)
        root.append(h('div', { class: 'dl-sources' }, ...sources.map((s, i) => {
            const db = env.ctx.ws.dbs.get(s.db);
            return h('button', { class: 'dl-src' + (s.off ? ' off' : ''), onclick: () => { s.off = !s.off || undefined; save(); } }, h('i', { style: { background: COLORS[sourceColor(s, i)].text } }), db.schema.name);
        })));
    if (!sources.length) {
        root.append(h('div', { class: 'dl-empty' }, 'Add databases with a date under View options → Sources.'));
        return root;
    }
    const items = collect(env, from, to);
    const byDay = new Map();
    for (const x of items)
        (byDay.get(x.day) ?? byDay.set(x.day, []).get(x.day)).push(x);
    const colorOf = (s) => COLORS[sourceColor(s, sources.indexOf(s))].text;
    const open = (x) => env.ctx.openRow(x.db, x.row);
    const ctxMenu = (x, e) => { e.preventDefault(); rowMenu(env.ctx, x.db, x.row, { x: e.clientX, y: e.clientY }, redraw); };
    const title = (x) => entryTitle(x.db, x.row).text || 'Untitled';
    const sumEl = (list) => v.dlSummary === false ? null : h('div', { class: 'dl-sum' }, ...summary(env, list).map((s) => h('span', null, s)));
    const days = [];
    for (let d = from; d < to; d++)
        days.push(d);
    if (p.unit === 'week' && v.dlLayout === 'cols') {
        root.append(h('div', { class: 'dl-cols' }, ...days.map((d) => {
            const list = byDay.get(d) ?? [];
            const { wd, dm } = dayLabel(d);
            return h('div', { class: 'dl-col' + (d === today ? ' today' : '') }, h('div', { class: 'dl-dh' }, h('b', null, wd), h('span', null, dm)), sumEl(list), ...list.map((x) => {
                const card = h('div', { class: 'dl-card', onclick: () => open(x), oncontextmenu: (e) => ctxMenu(x, e) }, h('span', { class: 'dl-title' }, title(x)), h('div', { class: 'dl-meta' }, x.time ? h('span', null, x.time) : null, values(x)));
                card.style.setProperty('--c', colorOf(x.src));
                return card;
            }), list.length ? null : h('div', { class: 'dl-none' }, '—'));
        })));
        return root;
    }
    const order = p.unit === 'day' ? days : v.dlOrder === 'old' ? days : [...days].reverse();
    const list = h('div', { class: 'dl-list' });
    for (const d of order) {
        const day = byDay.get(d) ?? [];
        if (!day.length && p.unit !== 'day' && !v.dlEmpty)
            continue;
        const { wd, dm } = dayLabel(d);
        list.append(h('div', { class: 'dl-day' + (d === today ? ' today' : '') }, h('div', { class: 'dl-dh' }, h('b', null, wd), h('span', null, dm)), h('div', { class: 'dl-entries' }, sumEl(day), ...day.map((x) => h('div', { class: 'dl-ev', onclick: () => open(x), oncontextmenu: (e) => ctxMenu(x, e) }, h('span', { class: 'dl-time' }, x.time || '—'), h('i', { class: 'dl-dot', style: { background: colorOf(x.src) } }), h('span', { class: 'dl-title' }, title(x)), values(x))), day.length ? null : h('div', { class: 'dl-none' }, 'Nothing on this day'))));
    }
    if (!list.childElementCount)
        list.append(h('div', { class: 'dl-empty' }, 'Nothing in this period'));
    root.append(list);
    return root;
    // ── a month calendar to jump to a day (days with entries have a dot) ──
    function calendarPop(anchor) {
        let first = (() => { const iso = isoFromDay(p.day); return dayNum(`${iso.slice(0, 7)}-01`); })();
        const box = h('div', { class: 'dl-cal' });
        const draw = () => {
            const iso = isoFromDay(first), y = +iso.slice(0, 4), m = +iso.slice(5, 7);
            const start = weekFirst(first);
            const has = new Set(collect(env, start, start + 42).map((x) => x.day));
            const [sf, st] = span(env);
            box.replaceChildren(h('div', { class: 'dl-cal-h' }, h('button', { class: 'icon-btn', onclick: () => { first = dayNum(`${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`); draw(); } }, iconSvg('chevron-left', 14)), h('b', null, `${MONTHS[m - 1]} ${y}`), h('button', { class: 'icon-btn', onclick: () => { first = dayNum(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`); draw(); } }, iconSvg('chevron-right', 14))), h('div', { class: 'dl-cal-g' }, ...[0, 1, 2, 3, 4, 5, 6].map((i) => h('span', { class: 'wd' }, WEEKDAYS[(i + weekStart()) % 7].slice(0, 2))), ...Array.from({ length: 42 }, (_, i) => start + i).map((d) => h('button', {
                class: [+isoFromDay(d).slice(5, 7) !== m ? 'out' : '', d >= sf && d < st ? 'sel' : '', d === today ? 'today' : '', has.has(d) ? 'has' : ''].join(' '),
                onclick: () => { p.day = d; closePop(); redraw(); },
            }, String(+isoFromDay(d).slice(8, 10))))), h('div', { class: 'dl-cal-f' }, h('button', { class: 'set-btn small', onclick: () => { p.day = today; p.unit = 'day'; closePop(); redraw(); } }, 'Today'), h('button', { class: 'set-btn small', onclick: () => { p.day = today - 1; p.unit = 'day'; closePop(); redraw(); } }, 'Yesterday'), h('button', { class: 'set-btn small', onclick: () => { p.day = today - 7; p.unit = 'week'; closePop(); redraw(); } }, 'Last week')));
        };
        draw();
        openPop(anchor, box);
    }
}
/** New in a day log: which database; the date is the shown day (today when it is in view) */
export function dayLogNew(env, anchor) {
    const p = place(env);
    const sources = daySources(env);
    const [from, to] = span(env);
    const today = dayNum(todayISO());
    const day = p.unit === 'day' ? p.day : today >= from && today < to ? today : from;
    menu(anchor, sources.filter((s) => !s.off).map((s) => ({
        label: env.ctx.ws.dbs.get(s.db).schema.name, icon: h('span', { class: 'swatch', style: { background: COLORS[sourceColor(s, sources.indexOf(s))].text } }),
        run: async () => {
            const db = env.ctx.ws.dbs.get(s.db);
            env.ctx.ws.boundary();
            const row = await env.ctx.ws.addRow(db, { [s.prop]: { start: isoFromDay(day) } });
            env.ctx.openRow(db, row, { isNew: true });
            env.redraw();
        },
    })), { title: `New on ${dayLabel(day).wd}, ${dayLabel(day).dm}` });
}
/** View options → Sources: which databases, by which date, what they show and add up */
export function sourcesRows(env, save) {
    const v = env.view;
    daySources(env);
    const ws = env.ctx.ws;
    const swatch = (c) => h('span', { class: 'swatch', style: { background: COLORS[c].text } });
    const sourcePage = (s) => () => {
        const db = ws.dbs.get(s.db);
        const i = v.sources.indexOf(s);
        return {
            title: db.schema.name,
            rows: () => [
                { label: 'Date', icon: iconSvg('calendar', 15), hint: s.prop, go: () => ({ title: 'Date', rows: () => dateProps(db).map((pp) => ({ label: pp.name, checked: pp.name === s.prop, pick: () => { s.prop = pp.name; save(); }, back: true })) }) },
                { label: 'Colour', icon: swatch(sourceColor(s, i)), hint: sourceColor(s, i)[0].toUpperCase() + sourceColor(s, i).slice(1), go: () => ({ title: 'Colour', rows: () => COLOR_ORDER.map((c) => ({ label: c[0].toUpperCase() + c.slice(1), icon: swatch(c), checked: sourceColor(s, i) === c, pick: () => { s.color = c; save(); }, back: true })) }) },
                { label: 'Shown properties', icon: iconSvg('list', 15), hint: (s.props ?? []).join(', ') || 'None', go: () => ({ title: 'Shown properties', rows: () => db.schema.properties.filter((pp) => pp.name !== db.labelProp && pp.name !== s.prop).map((pp) => ({ label: pp.name, toggle: (s.props ?? []).includes(pp.name), onToggle: () => { const cur = s.props ?? []; s.props = cur.includes(pp.name) ? cur.filter((x) => x !== pp.name) : [...cur, pp.name]; save(); } })) }) },
                { label: 'Filter', icon: iconSvg('filter', 15), hint: s.filter?.rules.length ? `${s.filter.rules.length} rule${s.filter.rules.length > 1 ? 's' : ''}` : 'None', run: () => sourceFilter(env, s, save) },
                { section: 'Day summary' },
                { label: 'Adds up', icon: iconSvg('sigma', 15), hint: s.sum ?? 'Count', go: () => ({ title: 'Adds up', rows: () => [{ label: 'Count entries', checked: !s.sum, pick: () => { delete s.sum; save(); }, back: true }, ...db.schema.properties.filter((pp) => pp.type === 'number').map((pp) => ({ label: `Sum of ${pp.name}`, checked: s.sum === pp.name, pick: () => { s.sum = pp.name; save(); }, back: true }))] }) },
                'sep',
                { label: 'Remove source', icon: iconSvg('minus-circle', 15), danger: true, pick: () => { v.sources = v.sources.filter((x) => x !== s); save(); }, back: true },
            ],
        };
    };
    const can = [...ws.dbs.values()].filter((d) => dateProps(d).length && !v.sources.some((s) => s.db === d.key));
    return [
        { section: 'Shown' },
        ...v.sources.map((s, i) => ({ label: ws.dbs.get(s.db)?.schema.name ?? s.db, icon: swatch(sourceColor(s, i)), hint: s.prop, go: sourcePage(s) })),
        ...(can.length ? [{ section: 'Can be added' }, ...can.map((d) => ({ label: d.schema.name, icon: iconSvg('plus', 15), hint: dateProps(d)[0].name, pick: () => { v.sources.push({ db: d.key, prop: dateProps(d)[0].name, color: COLOR_ORDER[v.sources.length % COLOR_ORDER.length] }); save(); } }))] : []),
    ];
}
/** a source's filter: the same Filter page as every view, working on that source */
function sourceFilter(env, s, save) {
    const db = env.ctx.ws.dbs.get(s.db);
    const target = { id: `dl-${s.db}`, name: db.schema.name, type: 'table' };
    const view = new Proxy(target, {
        get: (t, k) => (k === 'filter' ? s.filter : t[k]),
        set: (t, k, v) => { if (k === 'filter')
            s.filter = v;
        else
            t[k] = v; return true; },
        deleteProperty: (t, k) => { if (k === 'filter')
            delete s.filter;
        else
            delete t[k]; return true; },
    });
    const r = document.querySelector('.pop.pop-panel')?.getBoundingClientRect();
    const at = r ? { x: r.left, y: r.top } : { x: innerWidth / 2 - 150, y: 120 };
    openViewSettings({ ...env, db, view, saveView: () => save(), redraw: () => env.redraw() }, at, () => { }, 'filter');
}
// ── the Day log as a block: it shows databases, it holds none ──
registerWidget({
    id: 'daylog', name: 'Day log', icon: 'book-open', block: true, bare: true,
    description: 'Several databases on one timeline – what happened on a day',
    defaults: () => ({ view: { id: `dl${Math.random().toString(36).slice(2, 8)}`, name: 'Day log', type: 'daylog', dlBlock: true, sources: [] } }),
    render(c) {
        const env = blockEnv(c);
        return renderDayLog(env);
    },
    openSettings(c, at) {
        const env = blockEnv(c);
        const v = env.view;
        const save = () => env.saveView();
        panel(at, { title: 'Day log', rows: () => [
                { label: 'Sources', icon: iconSvg('database', 15), hint: `${daySources(env).filter((x) => !x.off).length} of ${daySources(env).length}`, go: () => ({ title: 'Sources', rows: () => sourcesRows(env, save) }) },
                { section: 'Days' },
                { label: 'Order', icon: iconSvg('arrow-down', 15), seg: { options: [['new', 'Newest'], ['old', 'Oldest']], value: v.dlOrder ?? 'new', pick: (k) => { v.dlOrder = k; save(); } } },
                { label: 'Untimed entries', icon: iconSvg('clock', 15), seg: { options: [['first', 'First'], ['last', 'Last']], value: v.dlUntimed ?? 'first', pick: (k) => { v.dlUntimed = k; save(); } } },
                { label: 'Empty days', icon: iconSvg('calendar', 15), toggle: !!v.dlEmpty, onToggle: () => { v.dlEmpty = !v.dlEmpty || undefined; save(); } },
                { label: 'Day summary', icon: iconSvg('sigma', 15), toggle: v.dlSummary !== false, onToggle: () => { v.dlSummary = v.dlSummary === false ? undefined : false; save(); } },
            ] });
    },
});
/** a view-like setting for the block: its settings live in the block, any database stands in as host */
function blockEnv(c) {
    const app = c._app;
    const data = c.data;
    if (!data.view)
        data.view = { id: `dl${Math.random().toString(36).slice(2, 8)}`, name: 'Day log', type: 'daylog', dlBlock: true, sources: [] };
    const view = data.view;
    const host = [...app.ws.dbs.values()][0];
    return {
        ctx: app, db: host, view, state: viewState(`dlb:${view.id}`),
        redraw: () => c.redraw(), saveView: () => { c.set({ view }); c.redraw(); },
        newRow: async () => { }, tabs: { shown: null, set: () => { }, style: () => 'auto', setStyle: () => { } },
    };
}
//# sourceMappingURL=daylog.js.map