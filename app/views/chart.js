import { aggregate, periodRange, query } from '../workspace.js';
import { COLORS, MONTHS, asDate, fmtNumber, h, weekStart, svgIcon, ICONS } from '../util.js';
import { menu } from '../ui/pop.js';
import { typeIcon } from './cells.js';
import { openDrill } from './drill.js';
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs))
        el.setAttribute(k, String(v));
    return el;
};
const colorOf = (c) => COLORS[c]?.text ?? COLORS.gray.text;
const SERIES = ['blue', 'green', 'orange', 'purple', 'pink', 'red', 'yellow', 'brown', 'gray'];
/** "Count", "Sum of Amount", "Average of Weight" … */
export function valueLabel(c) {
    if (!c?.prop || c.agg === 'count' || c.agg === 'none')
        return 'Count';
    return `${{ sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum' }[c.agg] ?? 'Sum'} of ${c.prop}`;
}
/** the measured value of these rows */
function measure(db, cfg, rows) {
    if (!cfg.prop || cfg.agg === 'count' || cfg.agg === 'none')
        return rows.length;
    return aggregate(db, rows, cfg.prop, cfg.agg);
}
/** sums and counts add up (percent, totals, running totals); averages, minimums and maximums do not */
const additive = (cfg) => !cfg.prop || cfg.agg === 'count' || cfg.agg === 'sum' || cfg.agg === 'none';
/** the option(s) a row belongs to for this property */
function keysOf(db, r, prop) {
    const v = db.value(r, prop);
    if (Array.isArray(v))
        return v.length ? v.map(String) : [''];
    if (typeof v === 'boolean')
        return [v ? 'Yes' : 'No'];
    return [v == null || v === '' ? '' : String(v)];
}
function groupRows(db, rows, prop) {
    const groups = new Map();
    // options in their order, so colors and the legend stay put
    for (const o of db.prop(prop)?.options ?? [])
        groups.set(o.name, []);
    for (const r of rows)
        for (const k of keysOf(db, r, prop)) {
            if (!groups.has(k))
                groups.set(k, []);
            groups.get(k).push(r);
        }
    return groups;
}
const groupColor = (db, prop, k, i) => !k ? 'gray' : db.prop(prop)?.type === 'checkbox' ? (k === 'Yes' ? 'green' : 'gray') : db.prop(prop)?.options?.some((o) => o.name === k) ? db.optionColor(prop, k) : SERIES[i % SERIES.length];
export function renderChart(env, res) {
    const { db, view } = env;
    const cfg = view.chart;
    if (!cfg)
        return h('div', { class: 'muted small' }, 'Set up the chart under ⋯ (view settings).');
    const fmt = db.prop(cfg.prop ?? '')?.format;
    const show = (v) => (!cfg.prop || cfg.agg === 'count' ? fmtNumber(v, 'number') : fmtNumber(Math.round(v * 100) / 100, fmt ?? 'number'));
    if (cfg.kind === 'cards')
        return renderCards(env, res, cfg);
    if (cfg.kind === 'goal')
        return renderGoal(env, res, cfg, show);
    return cfg.kind === 'line' ? renderGraph(env, res, cfg, show) : renderGroups(env, res, cfg, show);
}
// ---------- donut and bars ----------
function renderGroups(env, res, cfg, show) {
    const { db } = env;
    const def = db.prop(cfg.groupBy);
    if (!def)
        return h('div', { class: 'muted small' }, 'Choose what to group by under ⋯ (view settings → Group by).');
    const groups = groupRows(db, res.rows, cfg.groupBy);
    let data = [...groups.entries()].map(([k, rows], i) => ({ key: k || 'None', value: measure(db, cfg, rows), color: groupColor(db, cfg.groupBy, k, i), n: rows.length, rows }))
        .filter((d) => d.value != null && d.n > 0);
    data = cfg.sort === 'name' ? data : data.sort((a, b) => b.value - a.value);
    if (!data.length)
        return h('div', { class: 'chart-empty muted small' }, res.range ? `No entries in ${res.range.label}.` : 'No entries to show.');
    const add = additive(cfg);
    const total = data.reduce((s, d) => s + d.value, 0);
    const pct = (v) => (add && total > 0 && v >= 0 ? ` · ${Math.round((v / total) * 100)} %` : '');
    const drill = (d) => openDrill(env, d.key, `${show(d.value)} · ${d.rows.length} entr${d.rows.length === 1 ? 'y' : 'ies'}${res.range ? ' · ' + res.range.label : ''}`, d.rows, colorOf(d.color));
    const title = h('div', { class: 'chart-title' }, h('strong', null, valueLabel(cfg)), h('span', null, ` by ${def.name}`), res.range ? h('span', { class: 'muted' }, ` · ${res.range.label}`) : null);
    if (cfg.kind === 'bar') {
        // bars as rows: name, bar, value – readable at any width; negative values grow to the left
        const max = Math.max(...data.map((d) => Math.abs(d.value)), 1e-9);
        const neg = data.some((d) => d.value < 0);
        const rows = data.map((d) => {
            const w = (Math.abs(d.value) / max) * (neg ? 50 : 100);
            const bar = h('span', { class: 'cb-bar', style: { width: `${w}%`, background: colorOf(d.color), ...(neg ? { [d.value < 0 ? 'right' : 'left']: '50%' } : {}) } });
            return h('div', { class: 'cb-row drillable', role: 'button', tabindex: 0, title: `${d.key}: ${show(d.value)} – click to see the entries`, onclick: () => drill(d), onkeydown: (e) => { if (e.key === 'Enter')
                    drill(d); } }, h('span', { class: 'cb-name' }, d.key), h('span', { class: 'cb-track' + (neg ? ' neg' : '') }, bar), h('span', { class: 'cb-val' }, show(d.value), h('small', null, pct(d.value))));
        });
        return h('div', { class: 'chart chart-bars' }, title, ...rows, add && data.length > 1 ? h('div', { class: 'cb-row cb-total' }, h('span', { class: 'cb-name' }, 'Total'), h('span', { class: 'cb-track' }), h('span', { class: 'cb-val' }, show(total))) : null);
    }
    // hovering a slice or its legend line lights both up
    let hoverKey = (_k) => { };
    // donut: only for positive parts of a whole
    const parts = data.filter((d) => d.value > 0);
    const sum = parts.reduce((s, d) => s + d.value, 0);
    const chart = svg('svg', { viewBox: '10 10 200 200', class: 'chart-donut', role: 'img', 'aria-label': `${valueLabel(cfg)} by ${def.name}` });
    let a0 = -Math.PI / 2;
    const R = 100, r = 64, cx = 110, cy = 110;
    for (const d of parts) {
        const a1 = a0 + (d.value / sum) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (rad, a) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
        const path = parts.length === 1
            ? `M ${cx - R} ${cy} A ${R} ${R} 0 1 1 ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx - R} ${cy} M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy}`
            : `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
        const el = svg('path', { d: path, fill: colorOf(d.color), stroke: 'var(--bg)', 'stroke-width': 2, 'fill-rule': 'evenodd', class: 'slice', 'data-key': d.key });
        const t = svg('title');
        t.textContent = `${d.key}: ${show(d.value)}${pct(d.value)} – click to see the entries`;
        el.appendChild(t);
        el.addEventListener('click', () => drill(d));
        el.addEventListener('pointerenter', () => hoverKey(d.key));
        el.addEventListener('pointerleave', () => hoverKey(null));
        chart.appendChild(el);
        a0 = a1;
    }
    // the middle: the total for sums and counts; averages etc. have no meaningful total
    if (add) {
        const v = svg('text', { x: 110, y: 112, 'text-anchor': 'middle', fill: 'var(--fg-strong)', 'font-size': 18, 'font-weight': 650 });
        v.textContent = show(total);
        const l = svg('text', { x: 110, y: 132, 'text-anchor': 'middle', fill: 'var(--fg-muted)', 'font-size': 11 });
        l.textContent = 'Total';
        chart.append(v, l);
    }
    const legend = h('div', { class: 'chart-legend' }, data.map((d) => h('div', { class: 'li2 drillable', 'data-key': d.key, role: 'button', tabindex: 0, title: 'Click to see the entries', onclick: () => drill(d), onpointerenter: () => hoverKey(d.key), onpointerleave: () => hoverKey(null) }, h('span', { class: 'sw', style: { background: colorOf(d.color) } }), h('span', { class: 'lk' }, d.key), h('span', { class: 'val' }, show(d.value) + pct(d.value)))));
    const wrapD = h('div', { class: 'chart chart-donut-wrap' }, title, h('div', { class: 'chart-row' }, chart, legend));
    hoverKey = (k) => {
        wrapD.classList.toggle('has-hover', k != null);
        wrapD.querySelectorAll('[data-key]').forEach((e) => e.classList.toggle('hot', e.getAttribute('data-key') === k));
    };
    return wrapD;
}
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (s) => new Date(s + 'T12:00:00Z');
const MON = (i) => MONTHS[i].slice(0, 3);
/** the first day of the step that holds this day */
function bucketStart(day, b) {
    if (b === 'day')
        return day;
    if (b === 'month')
        return day.slice(0, 8) + '01';
    if (b === 'year')
        return day.slice(0, 5) + '01-01';
    const d = utc(day), first = (weekStart() + 1) % 7;
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() - first + 7) % 7);
    return iso(d);
}
function nextBucket(start, b) {
    const d = utc(start);
    if (b === 'day')
        d.setUTCDate(d.getUTCDate() + 1);
    else if (b === 'week')
        d.setUTCDate(d.getUTCDate() + 7);
    else if (b === 'month')
        d.setUTCMonth(d.getUTCMonth() + 1);
    else
        d.setUTCFullYear(d.getUTCFullYear() + 1);
    return iso(d);
}
function bucketLabel(start, b, long = false) {
    const d = utc(start);
    if (b === 'year')
        return String(d.getUTCFullYear());
    if (b === 'month')
        return long ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : `${MON(d.getUTCMonth())}${d.getUTCMonth() === 0 ? ' ' + String(d.getUTCFullYear()).slice(2) : ''}`;
    const day = `${d.getUTCDate()} ${MON(d.getUTCMonth())}`;
    if (b === 'week')
        return long ? `Week from ${day} ${d.getUTCFullYear()}` : day;
    return long ? `${day} ${d.getUTCFullYear()}` : day;
}
/** auto: the period switcher's unit decides; without one, the span of the data */
function autoBucket(unit, first, last) {
    if (unit === 'week' || unit === 'month')
        return 'day';
    if (unit === 'year')
        return 'month';
    const days = (utc(last).getTime() - utc(first).getTime()) / 864e5;
    return days <= 62 ? 'day' : days <= 366 ? 'week' : days <= 366 * 4 ? 'month' : 'year';
}
/** round axis steps: 1, 2, 2.5, 5 × 10ⁿ */
function niceTicks(min, max, count = 5) {
    if (min === max) {
        if (min === 0)
            max = 1;
        else if (min > 0)
            min = 0;
        else
            max = 0;
    }
    const raw = (max - min) / count, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    const out = [];
    for (let v = Math.floor(min / step) * step; v <= max + step * 1e-6; v += step)
        out.push(Math.round(v * 1e6) / 1e6);
    if (out[out.length - 1] < max)
        out.push(out[out.length - 1] + step);
    return out;
}
const short = (v) => {
    const a = Math.abs(v);
    return a >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : a >= 1e4 ? `${+(v / 1e3).toFixed(1)}k` : String(+v.toFixed(2));
};
/** amounts add up per step; measurements (weight, ratings …) are averaged */
export const defaultCombine = (db, prop) => {
    const f = db.prop(prop)?.format;
    return f && ['euro', 'dollar', 'pound', 'franc', 'yen'].includes(f) ? 'sum' : 'avg';
};
const COMBINE = { sum: 'added up', avg: 'averaged', min: 'lowest', max: 'highest' };
const SOLO = new Map();
function renderGraph(env, res, cfg, show) {
    const { db, view } = env;
    const xDef = db.prop(cfg.x ?? '') ?? db.schema.properties.find((p) => p.type === 'date');
    if (!xDef)
        return h('div', { class: 'muted small' }, 'A graph needs a date: add a date property, then choose it under ⋯ (view settings → X axis).');
    const yProp = cfg.prop && db.prop(cfg.prop) && cfg.agg !== 'count' ? cfg.prop : undefined;
    const pointsMode = !!(cfg.points && yProp);
    const dayOf = (r) => {
        const v = db.value(r, xDef.name);
        if (xDef.type === 'date')
            return asDate(v)?.start?.slice(0, 10) ?? null;
        return typeof v === 'string' && v ? v.slice(0, 10) : null;
    };
    const fmtDay = (d) => bucketLabel(d, 'day', true);
    const numOf = (r) => { const v = yProp ? db.value(r, yProp) : null; return typeof v === 'number' && Number.isFinite(v) ? v : null; };
    const dated = res.rows.map((r) => ({ r, day: dayOf(r) })).filter((x) => !!x.day).sort((a, b) => a.day.localeCompare(b.day));
    // the time span: the period shown by the switcher (whole period, also empty steps), or the data's
    const range = view.period ? periodRange(view.period, env.state.offset) : null;
    const spanStart = range?.start ?? dated[0]?.day;
    const spanLast = range ? iso(new Date(utc(range.end).getTime() - 864e5)) : dated.at(-1)?.day;
    const yName = yProp ?? 'Entries';
    // the value shown can be switched right here; everything else stays in the view settings
    const nums = db.schema.properties.filter((p) => p.type === 'number' || p.type === 'formula' || p.type === 'rollup');
    const pick = (prop) => {
        const c = view.chart;
        if (!prop) {
            c.agg = 'count';
            delete c.prop;
            delete c.points;
        }
        else if (c.prop !== prop || c.agg === 'count') {
            c.prop = prop;
            c.agg = defaultCombine(db, prop);
        }
        env.saveView();
        env.redraw();
    };
    const title = h('button', { class: 'graph-y', title: 'Change what the graph shows', 'aria-haspopup': 'menu', onclick: () => menu(title, [
            { label: 'Number of entries', icon: typeIcon('number'), hint: yProp ? undefined : '✓', run: () => pick() },
            ...(nums.length ? ['sep'] : []),
            ...nums.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), hint: yProp === p.name ? '✓' : undefined, run: () => pick(p.name) })),
        ]) }, h('strong', null, (cfg.cumulative ? 'Running total of ' : '') + (yProp ? yProp : 'Number of entries')), svgIcon(ICONS.chevron, 11));
    const note = h('span', { class: 'muted' });
    const head = h('div', { class: 'chart-title' }, title, h('span', null, ` over ${xDef.name}`), note, range ? h('span', { class: 'muted' }, ` · ${range.label}`) : null);
    const empty = (t) => h('div', { class: 'chart chart-graph' }, head, h('div', { class: 'chart-empty muted small' }, t));
    // a running total from earlier (this year, say) still has something to show in an empty period
    const carries = !!(cfg.cumulative && range && cfg.runFrom && cfg.runFrom !== 'period');
    if (!spanStart || !spanLast || (!dated.length && !carries))
        return empty(range ? `No dated entries in ${range.label}.` : 'No dated entries to show.');
    let b = !cfg.bucket || cfg.bucket === 'auto' ? autoBucket(view.period?.unit, spanStart, spanLast) : cfg.bucket;
    // at most ~400 steps
    const order = ['day', 'week', 'month', 'year'];
    const count = (bk) => { let n = 0; for (let s = bucketStart(spanStart, bk); s <= spanLast && n < 2000; s = nextBucket(s, bk))
        n++; return n; };
    while (b !== 'year' && count(b) > 400)
        b = order[order.indexOf(b) + 1];
    const steps = [];
    for (let s = bucketStart(spanStart, b); s <= spanLast; s = nextBucket(s, b))
        steps.push(s);
    // x is time: days since the first step
    const t0 = utc(steps[0] < spanStart ? steps[0] : spanStart).getTime();
    const tOf = (day) => (utc(day).getTime() - t0) / 864e5;
    const tMax = Math.max(1, tOf(pointsMode ? spanLast : steps[steps.length - 1]));
    // series: everything, or one per option of "Lines by"
    const split = cfg.splitBy && db.prop(cfg.splitBy) ? cfg.splitBy : undefined;
    const seriesRows = split ? [...groupRows(db, dated.map((x) => x.r), split).entries()].filter(([, rows]) => rows.length) : [['', dated.map((x) => x.r)]];
    // the period switcher filters out what came before it: the filtered entries of all time
    let allRows = null;
    const everything = () => (allRows ??= query(db, { ...view, period: undefined }, 0, env.state.search).rows);
    const combine = yProp ? (cfg.agg === 'sum' || cfg.agg === 'avg' || cfg.agg === 'min' || cfg.agg === 'max' ? cfg.agg : defaultCombine(db, yProp)) : 'count';
    const mcfg = { ...cfg, agg: combine, prop: yProp };
    const adds = combine === 'count' || combine === 'sum' || pointsMode;
    const zero = !pointsMode && (cfg.gaps ? cfg.gaps === 'zero' : combine === 'count' || combine === 'sum');
    let combined = false;
    const allSeries = seriesRows.map(([k, rows], i) => {
        let pts;
        if (pointsMode) {
            pts = rows.map((r) => ({ t: tOf(dayOf(r)), v: numOf(r), when: fmtDay(dayOf(r)), what: db.rowLabel(r), day: dayOf(r), rows: [r] })).filter((p) => p.v != null);
        }
        else {
            const per = new Map();
            for (const r of rows) {
                const d = dayOf(r);
                if (!d)
                    continue;
                const st = bucketStart(d, b);
                if (!per.has(st))
                    per.set(st, []);
                per.get(st).push(r);
            }
            if (yProp && [...per.values()].some((rs) => rs.filter((r) => numOf(r) != null).length > 1))
                combined = true;
            pts = steps.map((st) => { const rs = per.get(st); return { t: tOf(st), v: rs?.length ? measure(db, mcfg, rs) : zero ? 0 : null, when: bucketLabel(st, b, true), day: st, rows: rs ?? [] }; });
        }
        if (cfg.cumulative && adds) {
            // counted from: the shown period's start (default), the start of each year / month / week, or ever
            const from = cfg.runFrom ?? 'period';
            const keyOf = (day) => from === 'year' ? day.slice(0, 4) : from === 'month' ? day.slice(0, 7) : from === 'week' ? bucketStart(day, 'week') : '';
            const sumOf = (rs) => yProp ? rs.reduce((a, r) => a + (numOf(r) ?? 0), 0) : rs.length;
            // what came before the shown span but belongs to the same running total (earlier this year, say)
            const firstDay = pointsMode ? spanStart : steps[0] < spanStart ? steps[0] : spanStart;
            const lower = from === 'all' ? '' : from === 'period' ? null : from === 'year' ? firstDay.slice(0, 4) + '-01-01' : from === 'month' ? firstDay.slice(0, 7) + '-01' : bucketStart(firstDay, 'week');
            let run = lower === null ? 0 : sumOf(everything().filter((r) => { const d = dayOf(r); return d && d >= lower && d < firstDay && (!split || keysOf(db, r, split).includes(k)); }));
            let cur = keyOf(firstDay);
            for (const p of pts) {
                if (from !== 'all' && from !== 'period' && keyOf(p.day) !== cur) {
                    cur = keyOf(p.day);
                    run = 0;
                }
                run += p.v ?? 0;
                p.v = run;
            }
        }
        return { key: split ? (k || 'None') : yName, color: split ? groupColor(db, split, k, i) : 'blue', pts };
    });
    if (cfg.cumulative && adds)
        note.textContent = { year: ' · since January 1st', month: ' · since the 1st of each month', week: ' · since the start of each week', all: ' · since the beginning' }[cfg.runFrom ?? ''] ?? '';
    if (combined && !cfg.cumulative)
        note.textContent = ` · ${COMBINE[combine]} per ${b}`;
    if (!allSeries.some((s) => s.pts.some((p) => p.v != null)))
        return empty('No values to show.');
    // the legend picks one line (again: all lines); kept per view while Nook is open
    let solo = SOLO.get(view.id);
    if (solo && !allSeries.some((s) => s.key === solo))
        solo = undefined;
    const box = h('div', { class: 'graph-box' });
    const tip = h('div', { class: 'graph-tip', hidden: true });
    const legend = split ? h('div', { class: 'chart-legend graph-legend' }) : null;
    const drawLegend = () => legend?.replaceChildren(...allSeries.map((s) => h('button', {
        class: 'li2' + (solo && solo !== s.key ? ' off' : '') + (solo === s.key ? ' solo' : ''), 'aria-pressed': String(solo === s.key),
        title: solo === s.key ? 'Show all lines' : `Show only ${s.key}`,
        onclick: () => { solo = solo === s.key ? undefined : s.key; if (solo)
            SOLO.set(view.id, solo);
        else
            SOLO.delete(view.id); drawLegend(); if (lastW)
            draw(lastW); },
    }, h('span', { class: 'sw', style: { background: colorOf(s.color) } }), h('span', { class: 'lk' }, s.key))));
    drawLegend();
    const wrap = h('div', { class: 'chart chart-graph' }, head, box, legend);
    const draw = (W) => {
        if (W < 120)
            return;
        const series = solo ? allSeries.filter((s) => s.key === solo) : allSeries;
        const all = series.flatMap((s) => s.pts.map((p) => p.v)).filter((v) => v != null);
        if (!all.length)
            all.push(0);
        const H = Math.round(Math.min(340, Math.max(200, W * 0.45)));
        const lo = Math.min(adds || all.some((v) => v < 0) ? 0 : Math.min(...all), ...all), hi = Math.max(...all);
        // measurements (weight …) get an axis around their values instead of from 0
        const ticks = niceTicks(adds ? Math.min(0, lo) : lo - (hi - lo) * 0.1, hi);
        const y0 = ticks[0], y1 = ticks[ticks.length - 1];
        // the left margin fits the labels of all lines, so picking one line in the legend moves nothing sideways
        const everyV = allSeries.flatMap((x) => x.pts.map((p) => p.v)).filter((v) => v != null);
        const allTicks = everyV.length ? niceTicks(Math.min(0, ...everyV), Math.max(...everyV)) : ticks;
        const padL = Math.max(28, Math.max(...ticks.map((t) => short(t).length), ...allTicks.map((t) => short(t).length)) * 7 + 10), padR = 12, padT = 10, padB = 26;
        const iw = W - padL - padR, ih = H - padT - padB;
        const single = !pointsMode && steps.length === 1;
        const X = (t) => padL + (single ? iw / 2 : (t / tMax) * iw);
        const Y = (v) => padT + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
        const g = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'graph', role: 'img', 'aria-label': `${yName} over ${xDef.name}` });
        for (const t of ticks) {
            g.appendChild(svg('line', { x1: padL, x2: W - padR, y1: Y(t), y2: Y(t), class: t === 0 ? 'g-zero' : 'g-grid' }));
            // axis numbers start at the chart's left edge, like the title and the legend
            const tx = svg('text', { x: 0, y: Y(t) + 4, 'text-anchor': 'start', class: 'g-lab' });
            tx.textContent = short(t);
            g.appendChild(tx);
        }
        // x labels at step starts, as many as fit
        const every = Math.max(1, Math.ceil(steps.length / Math.max(2, Math.floor(iw / 64))));
        steps.forEach((st, i) => {
            if (i % every)
                return;
            const x = X(tOf(st));
            const tx = svg('text', { x, y: H - 8, 'text-anchor': single ? 'middle' : x - padL < 20 ? 'start' : W - padR - x < 20 ? 'end' : 'middle', class: 'g-lab' });
            tx.textContent = bucketLabel(st, b);
            g.appendChild(tx);
        });
        for (const s of series) {
            let d = '', area = '', open = false, firstX = 0, lastX = 0;
            const base = Y(Math.max(0, y0));
            for (const p of s.pts) {
                if (p.v == null) {
                    if (!zero)
                        continue; // "Skip": the line goes on to the next value
                    if (open && series.length === 1)
                        area += ` L ${lastX} ${base} L ${firstX} ${base} Z`;
                    open = false;
                    continue;
                }
                const x = X(p.t), y = Y(p.v);
                if (!open) {
                    d += ` M ${x} ${y}`;
                    area += ` M ${x} ${y}`;
                    firstX = x;
                    open = true;
                }
                else {
                    d += ` L ${x} ${y}`;
                    area += ` L ${x} ${y}`;
                }
                lastX = x;
            }
            if (open && series.length === 1)
                area += ` L ${lastX} ${base} L ${firstX} ${base} Z`;
            const c = colorOf(s.color);
            if (series.length === 1 && area && adds)
                g.appendChild(svg('path', { d: area, fill: c, opacity: 0.12, stroke: 'none' }));
            g.appendChild(svg('path', { d, fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
            const shown = s.pts.filter((p) => p.v != null);
            if (pointsMode || shown.length <= 40)
                for (const p of shown)
                    g.appendChild(svg('circle', { cx: X(p.t), cy: Y(p.v), r: pointsMode ? 3.2 : 2.6, fill: c }));
        }
        // hover / touch: the nearest step (or, per entry, the nearest entry)
        const cursor = svg('line', { y1: padT, y2: padT + ih, class: 'g-cursor', visibility: 'hidden' });
        const marks = series.map((s) => svg('circle', { r: 4.5, fill: colorOf(s.color), stroke: 'var(--bg)', 'stroke-width': 2, visibility: 'hidden' }));
        g.append(cursor, ...marks);
        // what a click opens: the series nearest to the pointer at the hovered step (or the entry)
        let target = null;
        const at = (clientX, clientY) => {
            const rect = g.getBoundingClientRect();
            const py = clientY == null ? null : clientY - rect.top;
            const t = ((clientX - rect.left - padL) / (iw || 1)) * tMax;
            const near = (pts) => pts.reduce((best, p) => p.v != null && (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) ? p : best, null);
            let rowsOut = [], cx = 0, when = '';
            if (pointsMode) {
                // the one nearest entry over all lines
                let best = null;
                series.forEach((s, k) => { const p = near(s.pts); if (p && (!best || Math.abs(p.t - t) < Math.abs(best.p.t - t)))
                    best = { p, k }; });
                if (!best)
                    return;
                const { p, k } = best;
                target = { s: series[k], p };
                marks.forEach((m, j) => m.setAttribute('visibility', j === k ? 'visible' : 'hidden'));
                marks[k].setAttribute('cx', String(X(p.t)));
                marks[k].setAttribute('cy', String(Y(p.v)));
                cx = X(p.t);
                when = p.when;
                rowsOut = [h('div', { class: 'gt-row' }, series.length > 1 ? h('span', { class: 'sw', style: { background: colorOf(series[k].color) } }) : null, h('span', null, p.what ?? ''), h('strong', null, show(p.v)))];
            }
            else {
                const i = Math.max(0, Math.min(steps.length - 1, Math.round((t / tMax) * (steps.length - 1))));
                // steps are not evenly spaced in days (months): pick the step whose time is nearest
                let j = i;
                for (let q = 0; q < steps.length; q++)
                    if (Math.abs(tOf(steps[q]) - t) < Math.abs(tOf(steps[j]) - t))
                        j = q;
                cx = X(tOf(steps[j]));
                when = bucketLabel(steps[j], b, true);
                series.forEach((s, k) => { const v = s.pts[j].v; marks[k].setAttribute('visibility', v == null ? 'hidden' : 'visible'); if (v != null) {
                    marks[k].setAttribute('cx', String(cx));
                    marks[k].setAttribute('cy', String(Y(v)));
                } });
                let tk = -1;
                series.forEach((s, k) => { const v = s.pts[j].v; if (v == null)
                    return; if (tk < 0 || (py != null && Math.abs(Y(v) - py) < Math.abs(Y(series[tk].pts[j].v) - py)))
                    tk = k; });
                target = tk >= 0 ? { s: series[tk], p: series[tk].pts[j] } : null;
                marks.forEach((m, k) => { m.setAttribute('r', k === tk ? '6' : '4.5'); m.classList.toggle('hot', k === tk); });
                rowsOut = [...series].filter((s) => series.length < 9 || (s.pts[j].v ?? 0) !== 0).sort((x, y) => (y.pts[j].v ?? -Infinity) - (x.pts[j].v ?? -Infinity)).slice(0, 8)
                    .map((s) => h('div', { class: 'gt-row' + (target?.s === s ? ' hot' : '') }, series.length > 1 ? h('span', { class: 'sw', style: { background: colorOf(s.color) } }) : null, series.length > 1 ? h('span', null, s.key) : null, h('strong', null, s.pts[j].v == null ? '–' : show(s.pts[j].v))));
            }
            cursor.setAttribute('x1', String(cx));
            cursor.setAttribute('x2', String(cx));
            cursor.setAttribute('visibility', 'visible');
            const n = target?.p.rows.length ?? 0;
            tip.replaceChildren(h('div', { class: 'gt-when' }, h('span', null, when), n ? h('span', { class: 'gt-hint' }, pointsMode ? 'Click to open' : `Click: ${n} entr${n === 1 ? 'y' : 'ies'}`) : null), ...rowsOut);
            g.classList.toggle('can-drill', n > 0);
            tip.hidden = false;
            const tw = tip.offsetWidth || 140;
            tip.style.left = `${cx + 12 + tw > W ? cx - tw - 12 : cx + 12}px`;
            tip.style.top = `${padT}px`;
        };
        const leave = () => { tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); marks.forEach((m) => m.setAttribute('visibility', 'hidden')); };
        g.addEventListener('pointermove', (e) => at(e.clientX, e.clientY));
        g.addEventListener('pointerdown', (e) => at(e.clientX, e.clientY));
        g.addEventListener('click', () => {
            if (!target || !target.p.rows.length)
                return;
            if (pointsMode) {
                env.ctx.openRow(db, target.p.rows[0]);
                return;
            }
            const rs = target.p.rows;
            const val = measure(db, mcfg, rs);
            openDrill(env, `${series.length > 1 ? target.s.key + ' · ' : ''}${target.p.when}`, `${val != null ? show(val) + ' · ' : ''}${rs.length} entr${rs.length === 1 ? 'y' : 'ies'}`, rs, series.length > 1 ? colorOf(target.s.color) : undefined);
        });
        g.addEventListener('pointerleave', leave);
        box.replaceChildren(g, tip);
    };
    // drawn at the real width (text keeps its size on a phone), again when the width changes
    let lastW = 0;
    const ro = new ResizeObserver((es) => {
        const w = Math.floor(es[0].contentRect.width);
        if (Math.abs(w - lastW) < 2)
            return;
        lastW = w;
        if (!box.isConnected) {
            ro.disconnect();
            return;
        }
        draw(w);
    });
    ro.observe(box);
    return wrap;
}
// ---------- number cards ----------
const AGG_NAME = { sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest', count: 'Entries' };
/** "Betrag", "Average Betrag", "Entries" … */
export function cardLabel(c) {
    if (c.label)
        return c.label;
    if (!c.prop || c.agg === 'count')
        return 'Entries';
    return c.agg === 'sum' ? c.prop : `${AGG_NAME[c.agg] ?? ''} ${c.prop}`.trim();
}
/** the default cards of a database: entries, and each currency or number totalled / averaged */
export function defaultCards(db) {
    const id = () => Math.random().toString(36).slice(2, 8);
    const out = [{ id: id(), agg: 'count', compare: true }];
    for (const p of db.schema.properties.filter((x) => x.type === 'number').slice(0, 3))
        out.push({ id: id(), agg: defaultCombine(db, p.name), prop: p.name, compare: true, spark: true });
    return out;
}
function renderCards(env, res, cfg) {
    const { db, view, state } = env;
    const cards = cfg.cards?.length ? cfg.cards : defaultCards(db);
    const periodic = !!view.period && view.period.unit !== 'all';
    // rows of other periods, fetched once each
    const cache = new Map();
    const rowsAt = (d) => {
        if (d === 0)
            return res.rows;
        if (!cache.has(d))
            cache.set(d, query(db, view, state.offset + d, state.search).rows);
        return cache.get(d);
    };
    const valueOf = (c, rows) => (!c.prop || c.agg === 'count' ? rows.length : aggregate(db, rows, c.prop, c.agg));
    const fmt = (c, v) => (!c.prop || c.agg === 'count' ? fmtNumber(v, 'number') : fmtNumber(Math.round(v * 100) / 100, db.prop(c.prop)?.format ?? 'number'));
    const prevName = periodic ? (periodRange(view.period, state.offset - 1)?.label ?? 'before') : '';
    const grid = h('div', { class: 'chart-cards' }, cards.map((c) => {
        const v = valueOf(c, res.rows);
        let delta = null;
        if (c.compare && periodic && v != null) {
            const p = valueOf(c, rowsAt(-1));
            if (p != null) {
                const diff = v - p, up = diff > 0;
                const pct = p !== 0 ? Math.round((Math.abs(diff) / Math.abs(p)) * 100) : null;
                const tone = diff === 0 || !c.up || c.up === 'neutral' ? 'neutral' : (up === (c.up === 'good')) ? 'good' : 'bad';
                delta = h('span', { class: `cc-delta ${tone}`, title: `${prevName}: ${fmt(c, p)}` }, diff === 0 ? `= ${prevName}` : `${up ? '▲' : '▼'} ${pct != null && c.agg !== 'count' && c.prop ? pct + ' %' : fmt(c, Math.abs(diff))} vs. ${prevName}`);
            }
        }
        let spark = null;
        if (c.spark && periodic) {
            const vals = [-7, -6, -5, -4, -3, -2, -1, 0].map((d) => valueOf(c, rowsAt(d)) ?? 0);
            const lo = Math.min(...vals), hi = Math.max(...vals), w = 100, hgt = 24;
            const pts = vals.map((x, i) => `${(i / (vals.length - 1)) * w},${hgt - 2 - ((x - lo) / (hi - lo || 1)) * (hgt - 4)}`).join(' ');
            spark = svg('svg', { class: 'cc-spark', viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Trend over the last 8 periods' });
            spark.appendChild(svg('polyline', { points: pts, fill: 'none', stroke: colorOf('blue'), 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
        }
        const open = () => openDrill(env, cardLabel(c), `${v == null ? '–' : fmt(c, v)} · ${res.rows.length} entr${res.rows.length === 1 ? 'y' : 'ies'}${res.range ? ' · ' + res.range.label : ''}`, res.rows);
        return h('div', { class: 'cc drillable', role: 'button', tabindex: 0, title: 'Click to see the entries', onclick: open, onkeydown: (e) => { if (e.key === 'Enter')
                open(); } }, h('span', { class: 'cc-label' }, cardLabel(c)), h('span', { class: 'cc-value' }, v == null ? '–' : fmt(c, v)), delta, spark);
    }));
    return h('div', { class: 'chart chart-cards-wrap' }, grid);
}
// ---------- progress toward a goal ----------
function renderGoal(env, res, cfg, show) {
    const { db, view } = env;
    const limit = (cfg.goalType ?? 'limit') === 'limit';
    const name = valueLabel(cfg).replace(/^Sum of /, '');
    const range = view.period ? periodRange(view.period, env.state.offset) : null;
    // a due date: the entries from `since` up to that day count (whatever period is shown); else the shown period
    const dateProp = view.period?.prop && db.prop(view.period.prop) ? view.period.prop : db.schema.properties.find((p) => p.type === 'date')?.name;
    const dayOf = (r) => (dateProp ? asDate(db.value(r, dateProp))?.start?.slice(0, 10) : undefined);
    const due = cfg.due, since = cfg.since;
    const rows = due && dateProp ? query(db, { ...view, period: undefined }, 0, env.state.search).rows.filter((r) => { const d = dayOf(r); return !!d && d <= due && (!since || d >= since); }) : res.rows;
    const fmtD = (iso) => bucketLabel(iso, 'day', true);
    const head = h('div', { class: 'chart-title' }, h('strong', null, name), h('span', null, limit ? ' against budget' : ' toward goal'), due ? h('span', { class: 'muted' }, ` · ${since ? fmtD(since) + ' – ' : 'by '}${fmtD(due)}`) : range ? h('span', { class: 'muted' }, ` · ${range.label}`) : null);
    if (cfg.goalType === 'countdown')
        return renderCountdown(cfg, head);
    const v = measure(db, cfg, rows) ?? 0;
    const target = cfg.target;
    if (!target)
        return h('div', { class: 'chart chart-goal' }, head, h('div', { class: 'chart-empty muted small' }, 'Set a target under ⋯ (view settings → Target).'));
    const ratio = v / target;
    const bad = limit ? ratio > 1 : false, done = !limit && ratio >= 1;
    const color = bad ? colorOf('red') : done ? colorOf('green') : limit && ratio > 0.85 ? colorOf('orange') : colorOf('blue');
    // the ring: full turns past 100 % show as a lighter second lap
    const R = 74, C = 2 * Math.PI * R;
    const ring = svg('svg', { class: 'goal-ring', viewBox: '8 8 164 164', role: 'img', 'aria-label': `${show(v)} of ${show(target)}, ${Math.round(ratio * 100)} percent` });
    ring.appendChild(svg('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: 'var(--bg-hover)', 'stroke-width': 16 }));
    ring.appendChild(svg('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: color, 'stroke-width': 16, 'stroke-linecap': ratio > 0 && ratio < 1 ? 'round' : 'butt', 'stroke-dasharray': `${Math.min(1, Math.max(0, ratio)) * C} ${C}`, transform: 'rotate(-90 90 90)' }));
    if (ratio > 1)
        ring.appendChild(svg('circle', { cx: 90, cy: 90, r: R, fill: 'none', stroke: color, opacity: 0.55, 'stroke-width': 16, 'stroke-linecap': 'round', 'stroke-dasharray': `${Math.min(1, ratio - 1) * C} ${C}`, transform: 'rotate(-90 90 90)' }));
    const t1 = svg('text', { x: 90, y: 92, 'text-anchor': 'middle', class: 'goal-pct' });
    t1.textContent = `${Math.round(ratio * 100)} %`;
    const t2 = svg('text', { x: 90, y: 114, 'text-anchor': 'middle', class: 'goal-of' });
    t2.textContent = `of ${show(target)}`;
    ring.append(t1, t2);
    // pace: how far through its time the goal is (a due date, or the current period)
    const today = iso(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4));
    // counting from: as set, else the first entry that counts
    const firstDay = rows.map(dayOf).filter((d) => !!d).sort()[0];
    const from = due ? since ?? firstDay : range?.start, last = due ?? (range ? iso(new Date(utc(range.end).getTime() - 864e5)) : undefined);
    const span = from && last ? (utc(last).getTime() - utc(from).getTime()) / 864e5 + 1 : 0;
    const f = span > 0 ? Math.min(1, Math.max(0, ((utc(today).getTime() - utc(from).getTime()) / 864e5 + 1) / span)) : null;
    const daysLeft = last ? Math.round((utc(last).getTime() - utc(today).getTime()) / 864e5) : null;
    if (f != null && f > 0 && f < 1) {
        // where it should be by today: a small mark on the ring
        const a = -Math.PI / 2 + f * Math.PI * 2;
        ring.appendChild(svg('line', { x1: 90 + (R - 11) * Math.cos(a), y1: 90 + (R - 11) * Math.sin(a), x2: 90 + (R + 11) * Math.cos(a), y2: 90 + (R + 11) * Math.sin(a), stroke: 'var(--fg-strong)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
    }
    const left = target - v;
    const status = limit
        ? (left >= 0 ? `${show(left)} left` : `${show(-left)} over budget`)
        : (left > 0 ? `${show(left)} to go` : `Reached · ${show(-left)} beyond`);
    const pace = [];
    // counts are whole: "Behind by 189", "41 per week"
    const sp = (x) => show(!cfg.prop || cfg.agg === 'count' ? Math.ceil(x - 1e-9) : x);
    if (daysLeft != null && (due || (f != null && f < 1 && f > 0))) {
        pace.push(h('span', { class: 'cc-delta neutral' }, daysLeft > 1 ? `${daysLeft} days left` : daysLeft === 1 ? '1 day left' : daysLeft === 0 ? 'Last day' : `Ended ${-daysLeft} day${daysLeft === -1 ? '' : 's'} ago`));
        if (daysLeft >= 0 && !done && !bad) {
            if (limit && f && v > 0) {
                const projected = v / f;
                pace.push(h('span', { class: 'cc-delta ' + (projected > target ? 'bad' : 'good') }, projected > target ? `On pace for ${sp(projected)} – over by ${sp(projected - target)}` : `On pace for ${sp(projected)}`));
                if (left > 0 && daysLeft > 0)
                    pace.push(h('span', { class: 'cc-delta neutral' }, `${sp(left / (daysLeft + 1))} per day left to spend`));
            }
            else if (!limit) {
                if (f != null && f > 0) {
                    const expected = target * f;
                    pace.push(h('span', { class: 'cc-delta ' + (v >= expected ? 'good' : 'bad') }, v >= expected ? 'On track' : `Behind by ${sp(expected - v)}`));
                }
                if (left > 0)
                    pace.push(h('span', { class: 'cc-delta neutral' }, daysLeft >= 14 ? `${sp(left / ((daysLeft + 1) / 7))} per week to reach it` : `${sp(left / (daysLeft + 1))} per day to reach it`));
            }
        }
    }
    const main = h('div', { class: 'goal-main' }, ring, h('div', { class: 'goal-facts' }, h('span', { class: 'cc-label' }, limit ? 'So far' : 'Reached'), h('span', { class: 'cc-value' }, show(v)), h('span', { class: 'cc-delta ' + (bad ? 'bad' : done ? 'good' : 'neutral') }, status), ...pace));
    // a bar per option that has its own target
    const bars = [];
    const by = cfg.groupBy && db.prop(cfg.groupBy) ? cfg.groupBy : undefined;
    if (by && cfg.targets && Object.keys(cfg.targets).length) {
        const groups = groupRows(db, rows, by);
        let i = 0;
        for (const [k, grows] of groups) {
            const t = cfg.targets[k];
            if (!t) {
                i++;
                continue;
            }
            const gv = measure(db, cfg, grows) ?? 0, gr = gv / t;
            const over = limit ? gr > 1 : gr >= 1;
            bars.push(h('div', { class: 'goal-bar' }, h('span', { class: 'gb-name' }, k || 'None'), h('span', { class: 'gb-track' }, h('span', { style: { width: `${Math.min(100, gr * 100)}%`, background: over && limit ? colorOf('red') : colorOf(groupColor(db, by, k, i)) } })), h('span', { class: 'gb-val' + (over && limit ? ' bad' : '') }, `${show(gv)} / ${show(t)}`)));
            i++;
        }
    }
    return h('div', { class: 'chart chart-goal' }, head, main, bars.length ? h('div', { class: 'goal-bars' }, bars) : null);
}
/** countdown: only time, always from today – a card like the number cards: name, days left, the date */
function renderCountdown(cfg, head0) {
    void head0;
    const due = cfg.due;
    const name = cfg.title?.trim() || 'Countdown';
    // the card's color tints its background and draws the bar / ring
    const tint = cfg.color && cfg.color !== 'default' ? cfg.color : undefined;
    const cardStyle = tint ? { background: COLORS[tint].bg, outline: `var(--ring-1, 1px) solid ${COLORS[tint].tag}`, outlineOffset: 'calc(-1 * var(--ring-1, 1px))', borderColor: 'transparent' } : {};
    if (!due)
        return h('div', { class: 'chart chart-cards-wrap' }, h('div', { class: 'chart-cards' }, h('div', { class: 'cc', style: cardStyle }, h('span', { class: 'cc-label' }, name), h('span', { class: 'cc-delta neutral' }, 'Choose the date under ⋯ (view settings → Date).'))));
    const today = iso(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4));
    const left = Math.round((utc(due).getTime() - utc(today).getTime()) / 864e5);
    const weeks = left >= 14 ? `${Math.floor(left / 7)} weeks${left % 7 ? ` and ${left % 7} day${left % 7 === 1 ? '' : 's'}` : ''}` : null;
    const big = left > 1 ? `${left} days` : left === 1 ? '1 day' : left === 0 ? 'Today' : `${-left} day${left === -1 ? '' : 's'} ago`;
    const start = cfg.since && cfg.since < due ? cfg.since : undefined;
    const ratio = start ? Math.min(1, Math.max(0, (utc(today).getTime() - utc(start).getTime()) / (utc(due).getTime() - utc(start).getTime()))) : null;
    const fill = colorOf(tint ?? (left >= 0 && left <= 7 ? 'orange' : 'blue'));
    const until = h('span', { class: 'cc-delta neutral' }, `${left >= 0 ? 'until' : 'since'} ${bucketLabel(due, 'day', true)}${weeks ? ` · ${weeks}` : ''}`);
    const goneText = ratio != null ? h('span', { class: 'cc-delta neutral' }, `${Math.round(ratio * 100)} % of the time gone since ${bucketLabel(start, 'day', true)}`) : null;
    const cls = 'cc cc-countdown' + (left >= 0 && left <= 7 && !tint ? ' soon' : '') + (left < 0 ? ' past' : '');
    let card;
    if ((cfg.shape ?? 'bar') === 'ring' && ratio != null) {
        // ring: the time gone around the days left
        const R = 40, C = 2 * Math.PI * R;
        const ring = svg('svg', { class: 'cc-ring', viewBox: '0 0 100 100', role: 'img', 'aria-label': `${Math.round(ratio * 100)} percent of the time gone` });
        ring.appendChild(svg('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: 'var(--bg-hover)', 'stroke-width': 9 }));
        ring.appendChild(svg('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: fill, 'stroke-width': 9, 'stroke-linecap': ratio > 0 && ratio < 1 ? 'round' : 'butt', 'stroke-dasharray': `${ratio * C} ${C}`, transform: 'rotate(-90 50 50)' }));
        const t = svg('text', { x: 50, y: 56, 'text-anchor': 'middle', class: 'cc-ring-pct' });
        t.textContent = `${Math.round(ratio * 100)}%`;
        ring.appendChild(t);
        card = h('div', { class: cls + ' cc-with-ring', style: cardStyle }, ring, h('div', { class: 'cc-ring-text' }, h('span', { class: 'cc-label' }, name), h('span', { class: 'cc-value' }, big), until, h('span', { class: 'cc-delta neutral' }, `time gone since ${bucketLabel(start, 'day', true)}`)));
    }
    else {
        card = h('div', { class: cls, style: cardStyle }, h('span', { class: 'cc-label' }, name), h('span', { class: 'cc-value' }, big), until, ...(ratio != null ? [h('span', { class: 'gb-track cc-progress' }, h('span', { style: { width: `${ratio * 100}%`, background: fill } })), goneText] : []));
    }
    return h('div', { class: 'chart chart-cards-wrap' }, h('div', { class: 'chart-cards' }, card));
}
//# sourceMappingURL=chart.js.map