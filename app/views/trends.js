// Trends: a log's days over a week, a month or a year – built from modules like the Day view (a figure,
// a line, bars, habit squares, a comparison with / without a habit). Values come from what the log's
// modules record and from the databases it shows (sums and counts).
import { segmented, dayNum, isoFromDay, fmtNumber, h, shortId, svgIcon, ICONS } from '../util.js';
import { zoomPicker, stepNav } from '../ui/zoomcal.js';
import { iconSvg } from '../ui/icons.js';
import { menu, prompt, menuIcon } from '../ui/pop.js';
import { phoneHead, dayConfig, habitColor, dayIndex, dayOfValue, label, num, srcColor, today, weekFirst } from './days.js';
const TREND_KINDS = [
    { kind: 'figure', label: 'Figure', icon: 'hash', desc: 'One number, compared to before' },
    { kind: 'line', label: 'Line', icon: 'chart-bar', desc: 'A value day by day' },
    { kind: 'bars', label: 'Bars', icon: 'sigma', desc: 'A sum per day' },
    { kind: 'habits', label: 'Habit squares', icon: 'check-square', desc: 'One square per day' },
    { kind: 'compare', label: 'Comparison', icon: 'columns', desc: 'A value with and without a habit' },
];
/** every value Trends can show: numbers recorded in the log, and sums or counts of its databases */
function measures(env, cfg) {
    const { db, ctx } = env;
    const index = dayIndex(db, cfg.prop);
    const out = [];
    const mk = (key, label, unit, total, day, fmt, range, color) => ({
        key, label, unit, total, range, color, day, fmt,
        vals: (a, b) => { const r = []; for (let d = a; d < b; d++) {
            const v = day(d);
            if (v != null)
                r.push(v);
        } return r; },
        sum: (a, b) => { let t = 0; for (let d = a; d < b; d++)
            t += day(d) ?? 0; return t; },
    });
    for (const p of db.schema.properties) {
        if (p.type !== 'number')
            continue;
        const m = cfg.modules.find((x) => x.prop === p.name && (x.kind === 'rating' || x.kind === 'number' || x.kind === 'counter'));
        if (!m)
            continue; // only what the log still records
        const rating = m.kind === 'rating';
        out.push(mk(`p:${p.name}`, m.title, rating ? 'of 5' : m.unit ?? '', false, (d) => num(index.get(d)?.values[p.name] ?? null), (n) => fmtNumber(Math.round(n * 10) / 10, p.format === 'stars' ? undefined : p.format), rating ? [1, 5] : undefined));
    }
    for (const src of cfg.sources) {
        const sdb = ctx.ws.dbs.get(src.db);
        if (!sdb)
            continue;
        const per = new Map();
        for (const r of sdb.rows) {
            const d = dayOfValue(sdb.value(r, src.prop));
            if (d == null)
                continue;
            const e = per.get(d) ?? { s: 0, c: 0 };
            e.c++;
            if (src.sum)
                e.s += num(sdb.value(r, src.sum)) ?? 0;
            per.set(d, e);
        }
        const color = srcColor(cfg, src);
        if (src.sum)
            out.push(mk(`s:${src.db}`, `${sdb.schema.name} · ${src.sum}`, '', true, (d) => per.get(d)?.s ?? null, (n) => fmtNumber(Math.round(n * 100) / 100, sdb.prop(src.sum)?.format), undefined, color));
        out.push(mk(`c:${src.db}`, `${sdb.schema.name} · entries`, '', true, (d) => per.get(d)?.c ?? null, (n) => fmtNumber(Math.round(n * 10) / 10), undefined, color));
    }
    return out;
}
/** what a log's Trends start with: made from its modules and databases, then up to the person */
function defaultTrends(ms, habits) {
    const out = [];
    const recorded = ms.filter((x) => !x.total), sums = ms.filter((x) => x.key.startsWith('s:'));
    for (const x of [...recorded, ...sums].slice(0, 4))
        out.push({ id: shortId(), kind: 'figure', m: x.key });
    if (habits.length)
        out.push({ id: shortId(), kind: 'habits' });
    for (const x of recorded)
        out.push({ id: shortId(), kind: 'line', m: x.key });
    for (const x of sums)
        out.push({ id: shortId(), kind: 'bars', m: x.key });
    return out;
}
const trendsAt = new Map();
export function renderTrends(env, mode) {
    const { db, ctx } = env;
    const cfg = dayConfig(db);
    const key = `${db.key}:${env.view.id}`;
    if (!trendsAt.has(key))
        trendsAt.set(key, { unit: 'month', day: today() });
    const st = trendsAt.get(key);
    const range = (d) => {
        if (st.unit === 'week') {
            const f = weekFirst(d);
            return [f, f + 7];
        }
        const iso = isoFromDay(d), y = +iso.slice(0, 4), m = +iso.slice(5, 7);
        if (st.unit === 'year')
            return [dayNum(`${y}-01-01`), dayNum(`${y + 1}-01-01`)];
        return [dayNum(`${iso.slice(0, 7)}-01`), dayNum(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`)];
    };
    const [from, to] = range(st.day);
    const [pf, pt] = range(from - 1);
    const index = dayIndex(db, cfg.prop);
    const root = h('div', { class: 'trv' });
    const step = (n) => { st.day = n < 0 ? from - 1 : to; env.redraw(); };
    const l = label(from);
    const title = st.unit === 'year' ? String(l.year) : st.unit === 'month' ? `${l.month} ${l.year}` : `${l.day} ${l.month.slice(0, 3)} – ${label(to - 1).day} ${label(to - 1).month.slice(0, 3)} ${label(to - 1).year}`;
    const n = to - from;
    const recorded = [...index.keys()].filter((d) => d >= from && d < to).length;
    const unitSeg = () => segmented([['week', 'Week'], ['month', 'Month'], ['year', 'Year']], st.unit, (u) => { st.unit = u; env.redraw(); }, 'Period', 'small dayv-unit');
    const tbtn = h('button', { class: 'dayv-titlebtn', 'aria-label': 'Pick a period', onclick: () => zoomPicker(tbtn, st.unit === 'week' ? { iso: isoFromDay(from), onDay: (iso) => { st.day = dayNum(iso); env.redraw(); } } : { iso: isoFromDay(from), onMonth: (yy, mm) => { st.day = dayNum(`${yy}-${String(mm).padStart(2, '0')}-01`); env.redraw(); } }) }, h('span', { class: 'cal-title large' }, h('span', { class: 'cal-t-main' }, title)), iconSvg('chevron-down', 16));
    const isPhone = document.documentElement.classList.contains('phone');
    // phone: the month, a line saying what's in it, then each switch on a row of its own – nothing runs off the screen
    if (isPhone) {
        const cur = range(today())[0] === from;
        root.append(phoneHead(tbtn, `${n} days · ${recorded} recorded`, null, cur ? null : () => { st.day = today(); env.redraw(); }, () => step(-1), () => step(1), [...(mode ? [mode()] : []), unitSeg()]));
    }
    else
        root.append(h('div', { class: 'cal-head dayv-head' }, h('div', { class: 'dayv-date' }, tbtn, h('div', { class: 'dayv-meta' }, mode ? mode() : null, unitSeg(), h('span', null, `${n} days`), h('span', { class: 'sepd' }, `${recorded} recorded`))), h('div', { class: 'dayv-nav' }, unitSeg(), mode ? mode() : null, h('span', { class: 'cal-head-gap' }), ...stepNav({ unit: st.unit, prev: () => step(-1), today: () => { st.day = today(); env.redraw(); }, next: () => step(1) }))));
    const avg = (xs) => xs.length ? xs.reduce((s0, x) => s0 + x, 0) / xs.length : null;
    const f1 = (x) => fmtNumber(Math.round(x * 10) / 10);
    const saveCfg = () => { void ctx.ws.saveSchema(db); env.redraw(); };
    const ms = measures(env, cfg);
    const habitProps = cfg.modules.filter((m) => m.kind === 'habits').flatMap((m) => m.props ?? []).filter((p) => db.prop(p));
    if (!cfg.trends)
        cfg.trends = defaultTrends(ms, habitProps);
    // a module whose value is no longer recorded goes with it
    const alive = cfg.trends.filter((t) => !t.m || ms.some((x) => x.key === t.m));
    if (alive.length !== cfg.trends.length) {
        cfg.trends = alive;
        void ctx.ws.saveSchema(db);
    }
    const mods = cfg.trends;
    const days = Array.from({ length: n }, (_, i) => from + i);
    const grid = h('div', { class: 'trgrid' });
    for (const t of mods) {
        const meas = t.m ? ms.find((x) => x.key === t.m) : undefined;
        let body = null;
        switch (t.kind) {
            case 'figure': {
                if (!meas)
                    break;
                const now = meas.total ? meas.sum(from, to) : avg(meas.vals(from, to)), was = meas.total ? meas.sum(pf, pt) : avg(meas.vals(pf, pt));
                if (now == null) {
                    body = h('div', { class: 'trc-v muted' }, '–');
                    break;
                }
                let cmp = '', tone = '';
                if (was != null && was !== 0) {
                    if (meas.total) {
                        const pct = Math.round(((now - was) / Math.abs(was)) * 100);
                        cmp = Math.abs(pct) < 5 ? 'about the same' : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)} % vs before`;
                        tone = Math.abs(pct) < 5 ? '' : pct > 0 ? 'warn' : 'up';
                    }
                    else {
                        const d = now - was;
                        cmp = Math.abs(d) < 0.1 ? 'about the same' : `${d > 0 ? '↑' : '↓'} ${f1(Math.abs(d))} vs before`;
                        tone = Math.abs(d) < 0.1 ? '' : d > 0 ? 'up' : 'down';
                    }
                }
                body = h('div', null, h('div', { class: 'trc-v' }, meas.fmt(now), h('small', null, meas.total ? '' : meas.unit)), h('div', { class: `trc-d ${tone}` }, cmp || (meas.total ? `Ø ${meas.fmt(now / n)} a day` : 'average')));
                break;
            }
            case 'line': {
                if (!meas)
                    break;
                const pts = days.map((d) => meas.day(d));
                body = pts.filter((x) => x != null).length < 2 ? h('div', { class: 'dmod-none' }, 'Not enough days yet') : isPhone ? axedLine(pts, meas.range ?? null, meas.fmt, days) : lineChart(pts, meas.range ?? null);
                break;
            }
            case 'bars': {
                if (!meas)
                    break;
                const per = days.map((d) => meas.day(d) ?? 0);
                body = per.some((x) => x) ? barChart(per, meas.color ?? 'var(--accent)') : h('div', { class: 'dmod-none' }, 'Nothing in this period');
                break;
            }
            case 'habits': {
                const list = (t.props?.length ? t.props : habitProps).filter((p) => db.prop(p));
                if (!list.length) {
                    body = h('div', { class: 'dmod-none' }, 'No habits yet');
                    break;
                }
                body = h('div', null, ...list.map((p) => {
                    let done = 0, counted = 0, run = 0, best = 0;
                    const cells = days.map((d) => { const on = !!index.get(d)?.values[p]; if (d <= today()) {
                        counted++;
                        if (on)
                            done++;
                        run = on ? run + 1 : 0;
                        best = Math.max(best, run);
                    } return h('i', { class: on ? 'y' : d > today() ? 'f' : '', title: `${label(d).day} ${label(d).month}` }); });
                    return h('div', { class: 'trh', style: { '--hc': habitColor(cfg, p) } }, h('span', { class: 'trh-l' }, p), h('div', { class: 'trh-c' + (st.unit === 'year' ? ' year' : '') }, ...cells), h('span', { class: 'trh-n', title: `Best streak ${best}` }, `${done} / ${counted}`));
                }));
                break;
            }
            case 'compare': {
                if (!meas || !t.b || !db.prop(t.b)) {
                    body = h('div', { class: 'dmod-none' }, 'Choose a value and a habit in ⋯');
                    break;
                }
                const w = [], wo = [];
                for (const d of days) {
                    const v = meas.day(d);
                    if (v == null)
                        continue;
                    (index.get(d)?.values[t.b] ? w : wo).push(v);
                }
                const aw = avg(w), awo = avg(wo);
                const bar = (lab, v, k) => { const mx = Math.max(aw ?? 0, awo ?? 0) || 1; return h('div', { class: 'trcmp' }, h('span', null, lab), h('div', { class: 'trcmp-b' }, h('i', { style: { width: `${v == null ? 0 : (v / mx) * 100}%` } })), h('b', null, v == null ? '–' : meas.fmt(v)), h('small', null, `${k} days`)); };
                body = h('div', null, bar(`With ${t.b}`, aw, w.length), bar(`Without`, awo, wo.length));
                break;
            }
        }
        if (!body)
            body = h('div', { class: 'dmod-none' }, 'Its value is gone – choose another in ⋯');
        grid.append(h('section', { class: `dmod dcard widget-card trmod tr-${t.kind}` }, h('div', { class: 'dmod-h' }, h('span', { class: 'w-label' }, t.title || meas?.label || TREND_KINDS.find((k) => k.kind === t.kind).label), h('button', { class: 'icon-btn dmod-more', 'aria-label': 'Settings', onclick: (e) => trendMenu(t, e.currentTarget) }, svgIcon(ICONS.more, 16, { fill: true }))), body));
    }
    grid.append(h('button', { class: 'dayv-add tr-add', onclick: (e) => addTrend(e.currentTarget) }, iconSvg('plus', 14), 'Add module'));
    root.append(grid);
    return root;
    function measureRows(t, filter) {
        return ms.filter(filter).map((x) => ({ label: `${t.m === x.key ? '✓' : '   '} ${x.label}`, run: () => { t.m = x.key; saveCfg(); } }));
    }
    function trendMenu(t, at) {
        const i = mods.indexOf(t);
        const move = (k) => { const j = i + k; if (j < 0 || j >= mods.length)
            return; [mods[i], mods[j]] = [mods[j], mods[i]]; saveCfg(); };
        const own = [];
        if (t.kind === 'figure' || t.kind === 'line' || t.kind === 'compare')
            own.push({ label: 'Value', icon: menuIcon('hash'), hint: ms.find((x) => x.key === t.m)?.label ?? 'None', sub: () => measureRows(t, (x) => t.kind !== 'compare' || !x.total) });
        if (t.kind === 'bars')
            own.push({ label: 'Value', icon: menuIcon('hash'), hint: ms.find((x) => x.key === t.m)?.label ?? 'None', sub: () => measureRows(t, () => true) });
        if (t.kind === 'compare')
            own.push({ label: 'Habit', icon: menuIcon('check-square'), hint: t.b ?? 'None', sub: () => habitProps.map((p) => ({ label: `${t.b === p ? '✓' : '   '} ${p}`, run: () => { t.b = p; saveCfg(); } })) });
        if (t.kind === 'habits')
            own.push({ section: 'Shown' }, ...habitProps.map((p) => ({ label: p, toggle: !t.props?.length || t.props.includes(p), onToggle: (on) => { const cur = t.props?.length ? t.props : [...habitProps]; t.props = on ? [...cur, p] : cur.filter((x) => x !== p); saveCfg(); } })));
        menu(at, [
            { label: 'Rename', icon: menuIcon('pencil'), run: () => prompt(at, 'Title (empty: automatic)', t.title ?? '', (v) => { t.title = v.trim() || undefined; saveCfg(); }) },
            ...own,
            { section: 'Arrange' },
            { label: 'Move earlier', icon: menuIcon('arrow-up'), run: () => move(-1) },
            { label: 'Move later', icon: menuIcon('arrow-down'), run: () => move(1) },
            'sep',
            { label: 'Remove module', icon: menuIcon('trash'), danger: true, run: () => { cfg.trends = mods.filter((x) => x !== t); saveCfg(); } },
        ], { title: t.title || TREND_KINDS.find((k) => k.kind === t.kind).label });
    }
    function addTrend(at) {
        menu(at, TREND_KINDS.map((k) => ({ label: k.label, icon: menuIcon(k.icon), hint: k.desc, run: () => {
                const m0 = k.kind === 'bars' ? ms.find((x) => x.total) ?? ms[0] : ms.find((x) => !x.total) ?? ms[0];
                mods.push({ id: shortId(), kind: k.kind, m: m0?.key, b: k.kind === 'compare' ? habitProps[0] : undefined });
                saveCfg();
            } })), { title: 'Add module' });
    }
}
function svgEl(tag, attrs) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs))
    e.setAttribute(k, String(v)); return e; }
function lineChart(pts, fixed) {
    const W = 600, H = 120, xs = pts.filter((x) => x != null);
    const lo = fixed ? fixed[0] : Math.min(...xs), hi = fixed ? fixed[1] : Math.max(...xs), sp = hi - lo || 1;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'trchart' });
    for (const y of [10, H / 2, H - 10])
        svg.append(svgEl('line', { x1: 0, x2: W, y1: y, y2: y, class: 'grid' }));
    const coords = pts.map((p, i) => (p == null ? null : `${(i / Math.max(1, pts.length - 1)) * W},${H - 10 - ((p - lo) / sp) * (H - 20)}`)).filter(Boolean);
    svg.append(svgEl('polyline', { points: coords.join(' '), class: 'line' }));
    return svg;
}
/** phone: the line with its scale – lowest, middle and highest value on the left, first, middle and last day below, the latest value marked */
function axedLine(pts, fixed, fmt, days) {
    const xs = pts.filter((x) => x != null);
    const lo = fixed ? fixed[0] : Math.min(...xs), hi = fixed ? fixed[1] : Math.max(...xs);
    const svg = lineChart(pts, fixed);
    let last = -1;
    pts.forEach((p, i) => { if (p != null)
        last = i; });
    const W = 600, H = 120, sp = hi - lo || 1;
    let dotEl = null;
    if (last >= 0) {
        const cx = (last / Math.max(1, pts.length - 1)) * W, cy = H - 10 - ((pts[last] - lo) / sp) * (H - 20);
        dotEl = h('i', { class: 'trp-dot', style: { left: `${(cx / W) * 100}%`, top: `${(cy / H) * 100}%` } });
    }
    const d0 = label(days[0]).day, dm = label(days[Math.floor((days.length - 1) / 2)]).day, d1 = label(days[days.length - 1]).day;
    return h('div', { class: 'trp-chart' }, h('div', { class: 'trp-y' }, h('span', null, fmt(hi)), h('span', null, fmt((hi + lo) / 2)), h('span', null, fmt(lo))), h('div', { class: 'trp-plot' }, svg, dotEl), h('div', { class: 'trp-x' }, h('span', null, String(d0)), h('span', null, String(dm)), h('span', null, String(d1))));
}
function barChart(per, color) {
    const W = 600, H = 120, mx = Math.max(...per) || 1, bw = W / per.length;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'trchart' });
    const avg = per.reduce((a, b) => a + b, 0) / per.length;
    per.forEach((v, i) => { if (v > 0)
        svg.append(svgEl('rect', { x: i * bw + bw * 0.15, width: bw * 0.7, y: H - (v / mx) * (H - 8), height: (v / mx) * (H - 8), rx: 2, fill: color })); });
    svg.append(svgEl('line', { x1: 0, x2: W, y1: H - (avg / mx) * (H - 8), y2: H - (avg / mx) * (H - 8), class: 'avg' }));
    return svg;
}
// ── a new day database from a preset ──
//# sourceMappingURL=trends.js.map