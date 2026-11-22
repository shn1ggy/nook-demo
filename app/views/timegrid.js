import { zoomPicker, stepNav } from '../ui/zoomcal.js';
import { ruleColors } from '../workspace.js';
import { COLORS, MONTHS, WEEKDAYS, addDays, asDate, dayNum, fmtTime, h, isoFromDay, pad2, todayISO, weekStart } from '../util.js';
import { entryTitle } from './cells.js';
import { selectable } from './rowselect.js';
import { rowMenu } from './rowmenu.js';
import { iconSvg, renderIcon } from '../ui/icons.js';
import { menu } from '../ui/pop.js';
import { calTitle, collectEvents, eventEl, eventBg, modeSwitch, overlayEl } from './calendar.js';
import { detachOccurrence, dragKeys, shiftEntries } from './rowselect.js';
const HOUR = 44; // px per hour
const SNAP = 15; // minutes
const DEFAULT_LEN = 60; // minutes, for entries with a start time but no end
const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const hhmm = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** weekday index Monday = 0 of a day number */
const dowOf = (n) => (new Date(n * 864e5).getUTCDay() + 6) % 7;
/** start and end minute of a timed entry on one of its days */
function span(d, day) {
    const s0 = dayNum(d.start.slice(0, 10));
    const startM = d.start.length > 10 ? mins(d.start.slice(11, 16)) : 0;
    let e0 = s0, endM = startM + DEFAULT_LEN;
    if (d.end && d.end.length > 10) {
        e0 = dayNum(d.end.slice(0, 10));
        endM = mins(d.end.slice(11, 16));
    }
    const a = day === s0 ? startM : 0;
    const b = day === e0 ? Math.max(endM, a + SNAP) : 24 * 60;
    return { a, b: Math.min(b, 24 * 60) };
}
export function renderTimeGrid(env, dateProp, mode) {
    const { db, view, state, ctx } = env;
    const today = todayISO();
    const todayN = dayNum(today);
    const ws0 = weekStart();
    let from, n;
    if (mode === 'week') {
        const thisWeek = todayN - ((dowOf(todayN) - ws0 + 7) % 7);
        from = thisWeek + state.offset * 7;
        n = 7;
    }
    else {
        from = todayN + state.offset;
        n = 1;
    }
    const to = from + n;
    const days = Array.from({ length: n }, (_, i) => from + i);
    // ----- entries -----
    const evs = collectEvents(env, dateProp, from, to);
    const dateOf = (x) => {
        if (x.ext)
            return { start: (x.occ ?? x.ext.ev.start.slice(0, 10)) + x.ext.ev.start.slice(10), end: x.ext.ev.end };
        const d = asDate(x.row.values[dateProp]);
        if (!d)
            return null;
        if (!x.occ)
            return d;
        // a date of a repeating entry: same times, shifted to that date
        const shift = dayNum(x.occ) - dayNum(d.start.slice(0, 10));
        return { start: addDays(d.start.slice(0, 10), shift) + d.start.slice(10), ...(d.end ? { end: addDays(d.end.slice(0, 10), shift) + d.end.slice(10) } : {}) };
    };
    // all-day row: entries without a time, and timed entries that run over several days
    const allDay = [], timed = [];
    for (const x of evs) {
        const d = dateOf(x);
        if (!d)
            continue;
        // a timed entry that ends on another day is a bar on top too (an end at midnight doesn't count)
        const endsLater = x.e > x.s && !(d.end && d.end.length > 10 && d.end.slice(11, 16) === '00:00' && x.e === x.s + 1);
        if (d.start.length <= 10 || endsLater)
            allDay.push(x);
        else
            timed.push(x);
    }
    // ----- header -----
    const range = mode === 'day'
        ? `${WEEKDAY_LONG[dowOf(from)].slice(0, 3)}, ${+isoFromDay(from).slice(8)} ${MONTHS[+isoFromDay(from).slice(5, 7) - 1]} ${isoFromDay(from).slice(0, 4)}`
        : (() => { const a = isoFromDay(from), b = isoFromDay(to - 1); return a.slice(5, 7) === b.slice(5, 7) ? `${+a.slice(8)}–${+b.slice(8)} ${MONTHS[+a.slice(5, 7) - 1]} ${a.slice(0, 4)}` : `${+a.slice(8)} ${MONTHS[+a.slice(5, 7) - 1].slice(0, 3)} – ${+b.slice(8)} ${MONTHS[+b.slice(5, 7) - 1].slice(0, 3)} ${b.slice(0, 4)}`; })();
    const unit = mode === 'week' ? 'week' : 'day';
    const head = h('div', { class: 'cal-head' }, calTitle(env, range, (at) => zoomPicker(at, { iso: isoFromDay(from), onDay: (iso) => { const d = dayNum(iso); state.offset = mode === 'week' ? Math.floor((d - (todayN - ((dowOf(todayN) - ws0 + 7) % 7))) / 7) : d - todayN; env.redraw(); } })), h('div', { style: { display: 'flex', gap: '2px', alignItems: 'center' } }, modeSwitch(env), h('span', { class: 'cal-head-gap' }), ...stepNav({ unit, keys: true, prev: () => { state.offset--; env.redraw(); }, today: () => { state.offset = 0; env.redraw(); }, next: () => { state.offset++; env.redraw(); } })));
    const cols = `56px repeat(${n}, minmax(0, 1fr))`;
    const dayHead = h('div', { class: 'tg-days', style: { gridTemplateColumns: cols } }, h('div'), ...days.map((d) => {
        const iso = isoFromDay(d);
        return h('button', { class: 'tg-day-head' + (iso === today ? ' today' : ''), title: mode === 'week' ? 'Show this day' : '', onclick: () => { if (mode === 'week') {
                view.calMode = 'day';
                state.offset = d - todayN;
                env.saveView();
                env.redraw();
            } } }, h('span', { class: 'tg-dow' }, WEEKDAYS[dowOf(d)]), h('span', { class: 'tg-num' }, String(+iso.slice(8))));
    }));
    // all-day lanes
    const allRow = h('div', { class: 'tg-allday', style: { gridTemplateColumns: cols } }, h('div', { class: 'tg-label' }, 'all-day'));
    const lanes = [];
    for (const x of allDay.sort((a, b) => a.s - b.s || b.e - a.e)) {
        const a = Math.max(x.s, from) - from, b = Math.min(x.e, to - 1) - from;
        if (b < 0 || a >= n)
            continue;
        let lane = 0;
        while (lanes[lane] && lanes[lane].slice(a, b + 1).some(Boolean))
            lane++;
        (lanes[lane] ??= Array(n).fill(false));
        for (let c = a; c <= b; c++)
            lanes[lane][c] = true;
        const el = x.ext ? overlayEl(x.ext, { startsBefore: x.s < from, endsAfter: x.e >= to, multi: x.e > x.s }, env) : eventEl(env, x.row, dateProp, { startsBefore: x.s < from, endsAfter: x.e >= to, multi: x.e > x.s, occ: x.occ });
        el.draggable = false;
        el.style.gridColumn = `${a + 2} / ${b + 3}`;
        el.style.gridRow = String(lane + 1);
        allRow.appendChild(el);
    }
    allRow.style.gridTemplateRows = `repeat(${Math.max(1, lanes.length)}, auto)`;
    allRow.firstElementChild.style.gridRow = `1 / span ${Math.max(1, lanes.length)}`;
    // ----- time grid -----
    const body = h('div', { class: 'tg-body', style: { gridTemplateColumns: cols, height: `${24 * HOUR}px` } });
    const hours = h('div', { class: 'tg-hours' }, Array.from({ length: 24 }, (_, i) => h('div', { class: 'tg-hour', style: { top: `${i * HOUR}px` } }, i ? fmtTime(hhmm(i * 60)) : '')));
    body.appendChild(hours);
    const colEls = [];
    for (const d of days) {
        const col = h('div', { class: 'tg-col' + (d === todayN ? ' today' : ''), 'data-day': isoFromDay(d) });
        for (let i = 1; i < 24; i++)
            col.appendChild(h('div', { class: 'tg-line', style: { top: `${i * HOUR}px` } }));
        colEls.push(col);
        body.appendChild(col);
    }
    // now line
    if (todayN >= from && todayN < to) {
        const t = new Date();
        const nowLine = h('div', { class: 'tg-now', style: { top: `${((t.getHours() * 60 + t.getMinutes()) / 60) * HOUR}px` } });
        colEls[todayN - from].appendChild(nowLine);
    }
    // place timed entries, side by side when they overlap
    for (let i = 0; i < n; i++) {
        const day = from + i;
        const items = timed.map((x) => ({ x, d: dateOf(x) })).filter(({ x }) => x.s <= day && x.e >= day)
            // an entry that ends at midnight doesn't show on the next day
            .filter(({ d }) => !(d.end && d.end.length > 10 && d.end.slice(11, 16) === '00:00' && dayNum(d.end.slice(0, 10)) === day && day > dayNum(d.start.slice(0, 10))))
            .map(({ x, d }) => ({ x, d, ...span(d, day) })).sort((p, q) => p.a - q.a || q.b - p.b);
        // clusters of overlapping entries share the width
        let cluster = [], end = -1;
        const flush = () => {
            const colsEnd = [];
            const placed = cluster.map((it) => { let c = colsEnd.findIndex((e) => e <= it.a); if (c < 0) {
                c = colsEnd.length;
                colsEnd.push(it.b);
            }
            else
                colsEnd[c] = it.b; return { it, c }; });
            for (const { it, c } of placed)
                colEls[i].appendChild(block(it.x, it.a, it.b, c, colsEnd.length, day));
            cluster = [];
        };
        for (const it of items) {
            if (it.a >= end && cluster.length)
                flush();
            cluster.push(it);
            end = Math.max(end, it.b);
        }
        if (cluster.length)
            flush();
    }
    /** one timed entry as a block */
    function block(x, a, b, c, of, day) {
        const style = { top: `${(a / 60) * HOUR}px`, height: `${Math.max(18, ((b - a) / 60) * HOUR - 2)}px`, left: `calc(${(c / of) * 100}% + 2px)`, width: `calc(${100 / of}% - 4px)` };
        if (x.ext) {
            const el = overlayEl(x.ext, {}, env);
            el.classList.add('tg-ev');
            Object.assign(el.style, style);
            // same layout as Nook's own blocks: title, then the time below
            const short = b - a < 45;
            if (short)
                el.classList.add('short');
            el.textContent = '';
            el.append(h('div', { class: 'tg-ev-t' }, x.ext.ev.icon ? h('span', { class: 'ev-ico' }, iconSvg(x.ext.ev.icon, 12)) : null, h('span', null, x.ext.ev.title || 'Busy')), short ? '' : h('div', { class: 'tg-ev-time' }, `${fmtTime(hhmm(a))} – ${fmtTime(hhmm(Math.min(b, 1439)))}`));
            return el;
        }
        const row = x.row;
        const cv = view.colorBy ? db.value(row, view.colorBy) : null;
        const rule = ruleColors(db, view, row).row;
        const byProp = (typeof cv === 'string' && cv ? db.optionColor(view.colorBy, cv) : undefined);
        const color = (rule ?? byProp ?? 'default');
        const et = entryTitle(db, row);
        const short = b - a < 45;
        const el = h('div', { class: 'tg-ev' + (short ? ' short' : ''), role: 'button', tabindex: 0, title: `${et.text} · ${fmtTime(hhmm(a))}–${fmtTime(hhmm(Math.min(b, 1439)))}`, style: { ...style, background: eventBg(color), borderLeftColor: COLORS[color]?.text ?? COLORS.gray.text } }, h('div', { class: 'tg-ev-t' }, row.icon && !view.hideIcons ? renderIcon(row.icon, 12) : null, h('span', { class: et.derived ? 'derived-title' : '' }, et.text)), short ? null : h('div', { class: 'tg-ev-time' }, `${fmtTime(hhmm(a))} – ${fmtTime(hhmm(Math.min(b, 1439)))}`), h('div', { class: 'tg-resize', title: 'Drag to change the end' }));
        selectable(el, env, row, undefined, x.occ ? `${row.id}@${x.occ}` : row.id);
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); rowMenu(ctx, db, row, { x: e.clientX, y: e.clientY }, () => env.redraw()); });
        el.addEventListener('mousedown', (e) => drag(e, el, x, a, b, day, e.target.classList.contains('tg-resize') ? 'end' : 'move'));
        return el;
    }
    // ----- dragging: move, change the end, or create -----
    const minuteAt = (y) => Math.max(0, Math.min(24 * 60, Math.round(((y - body.getBoundingClientRect().top) / HOUR) * 60 / SNAP) * SNAP));
    const dayAt = (cx) => { for (let i = 0; i < colEls.length; i++) {
        const r = colEls[i].getBoundingClientRect();
        if (cx < r.right || i === colEls.length - 1)
            return from + i;
    } return from; };
    function drag(e, el, x, a, b, day, kind) {
        if (e.button !== 0)
            return;
        const row = x.row;
        const sx = e.clientX, sy = e.clientY;
        const grabAt = minuteAt(sy) - a;
        let moved = false, na = a, nb = b, nday = day;
        const move = (m) => {
            if (!moved && Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) < 5)
                return;
            if (!moved) {
                moved = true;
                el.classList.add('dragging');
                document.body.classList.add('tg-dragging');
            }
            if (kind === 'end') {
                nb = Math.max(a + SNAP, minuteAt(m.clientY));
                el.style.height = `${((nb - a) / 60) * HOUR - 2}px`;
            }
            else {
                const len = b - a;
                na = Math.max(0, Math.min(24 * 60 - SNAP, minuteAt(m.clientY) - grabAt));
                nb = na + len;
                nday = dayAt(m.clientX);
                el.style.top = `${(na / 60) * HOUR}px`;
                const target = colEls[nday - from];
                if (target && el.parentElement !== target) {
                    target.appendChild(el);
                    el.style.left = '2px';
                    el.style.width = 'calc(100% - 4px)';
                }
            }
            const t = el.querySelector('.tg-ev-time');
            if (t)
                t.textContent = `${fmtTime(hhmm(na))} – ${fmtTime(hhmm(Math.min(nb, 1439)))}`;
        };
        const up = async (m) => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.body.classList.remove('tg-dragging');
            if (!moved)
                return;
            el.classList.remove('dragging');
            // the click that follows a drag must not open the entry
            el.addEventListener('click', (c) => c.stopImmediatePropagation(), { capture: true, once: true });
            const iso = isoFromDay(nday);
            const next = { start: `${iso}T${hhmm(na)}` };
            if (nb >= 24 * 60)
                next.end = `${addDays(iso, 1)}T00:00`;
            else
                next.end = `${iso}T${hhmm(nb)}`;
            // several selected entries move by the same days and minutes; Alt (held when letting go) copies
            const key = x.occ ? `${row.id}@${x.occ}` : row.id;
            const keys = kind === 'move' ? dragKeys(env, key) : [key];
            const copy = kind === 'move' && m.altKey;
            if (keys.length > 1 || copy) {
                await shiftEntries(env, keys, dateProp, nday - day, { minutes: na - a, copy, exact: { key, date: next } });
                env.redraw();
                return;
            }
            if (x.occ && row.repeat) {
                menu({ x: m.clientX, y: m.clientY }, [
                    { section: 'Repeating entry' },
                    { label: 'Change only this date', run: async () => { const c = await detachOccurrence(env, row, x.occ, dateProp, iso); c.values[dateProp] = next; await ctx.ws.saveRow(db, c); env.redraw(); } },
                    { label: 'Change all dates', run: async () => {
                            const shift = nday - dayNum(x.occ);
                            const base = asDate(row.values[dateProp]);
                            const b0 = base.start.slice(0, 10);
                            const s2 = addDays(b0, shift);
                            ctx.ws.boundary();
                            row.values[dateProp] = { start: `${s2}T${hhmm(na)}`, end: nb >= 1440 ? `${addDays(s2, 1)}T00:00` : `${s2}T${hhmm(nb)}` };
                            row.except = row.except?.map((e2) => addDays(e2, shift));
                            await ctx.ws.saveRow(db, row);
                            env.redraw();
                        } },
                    { label: 'Cancel', run: () => env.redraw() },
                ]);
                return;
            }
            ctx.ws.boundary();
            row.values[dateProp] = next;
            await ctx.ws.saveRow(db, row);
            env.redraw();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        e.preventDefault();
    }
    // drag over empty time (or double-click) to create an entry
    body.addEventListener('mousedown', (e) => {
        const col = e.target.closest('.tg-col');
        if (e.button !== 0 || !col || e.target.closest('.tg-ev'))
            return;
        const day = dayNum(col.dataset.day);
        const start = Math.floor(minuteAt(e.clientY - HOUR / 8) / SNAP) * SNAP;
        let endM = start + SNAP, moved = false;
        const ghost = h('div', { class: 'tg-ghost', style: { top: `${(start / 60) * HOUR}px`, height: `${(SNAP / 60) * HOUR}px` } });
        const move = (m) => {
            const cur = minuteAt(m.clientY);
            if (!moved && Math.abs(cur - start) < SNAP)
                return;
            if (!moved) {
                moved = true;
                col.appendChild(ghost);
            }
            endM = Math.max(start + SNAP, cur);
            ghost.style.height = `${((endM - start) / 60) * HOUR}px`;
            ghost.textContent = `${fmtTime(hhmm(start))} – ${fmtTime(hhmm(Math.min(endM, 1439)))}`;
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            ghost.remove();
            if (!moved)
                return;
            const iso = isoFromDay(day);
            env.newRow({ [dateProp]: { start: `${iso}T${hhmm(start)}`, end: endM >= 1440 ? `${addDays(iso, 1)}T00:00` : `${iso}T${hhmm(endM)}` } }, true);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        e.preventDefault();
    });
    // a computer: double-click on an empty time · a touch screen: a tap
    const createEv = matchMedia('(pointer: coarse)').matches ? 'click' : 'dblclick';
    body.addEventListener(createEv, (e) => {
        const col = e.target.closest('.tg-col');
        if (!col || e.target.closest('.tg-ev'))
            return;
        const iso = col.dataset.day;
        const start = Math.floor(minuteAt(e.clientY - HOUR / 4) / 30) * 30;
        env.newRow({ [dateProp]: { start: `${iso}T${hhmm(start)}`, end: `${iso}T${hhmm(Math.min(start + DEFAULT_LEN, 1439))}` } }, true);
    });
    // all-day row: double-click adds an all-day entry
    allRow.addEventListener(createEv, (e) => {
        if (e.target.closest('.ev'))
            return;
        const iso = isoFromDay(dayAt(e.clientX));
        env.newRow({ [dateProp]: { start: iso } }, true);
    });
    const scroller = h('div', { class: 'tg-scroll' }, body);
    // open at 7:00 (or a little before the first entry of the shown days)
    const firstM = Math.min(7 * 60, ...timed.map((x) => span(dateOf(x), Math.max(x.s, from)).a));
    requestAnimationFrame(() => { if (!state.tgScrolled)
        scroller.scrollTop = Math.max(0, (firstM / 60) * HOUR - 8);
    else
        scroller.scrollTop = state.tgScrolled; });
    scroller.addEventListener('scroll', () => { state.tgScrolled = scroller.scrollTop || 1; });
    // use the height there is: down to the bottom of the window when the calendar starts near the top
    const fit = () => {
        if (!scroller.isConnected) {
            removeEventListener('resize', fit);
            return;
        }
        const pane = scroller.closest('.dialog-body, .peek-body, .scroll') ?? document.documentElement;
        const pr = pane.getBoundingClientRect();
        const top = scroller.getBoundingClientRect().top - pr.top + pane.scrollTop; // from the top of the page, not the window
        const h0 = top < pr.height * 0.6 ? pr.height - top - 28 : pr.height - 140;
        scroller.style.maxHeight = `${Math.max(360, Math.round(h0))}px`;
    };
    requestAnimationFrame(fit);
    addEventListener('resize', fit);
    const grid = h('div', { class: 'tg' + (mode === 'day' ? ' tg-one' : '') }, dayHead, allRow, scroller);
    grid.addEventListener('mousedown', (e) => { if (e.detail > 1)
        e.preventDefault(); });
    return h('div', null, head, grid);
}
//# sourceMappingURL=timegrid.js.map