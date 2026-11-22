import { remindMenu } from '../ui/reminders.js';
import { zoomPicker, stepNav } from '../ui/zoomcal.js';
import { query, ruleColors } from '../workspace.js';
import { COLORS, stepsOf, MONTHS, WEEKDAYS, addDays, asDate, dayNum, fmtTime, h, isoFromDay, pad2, svgIcon, ICONS, todayISO, weekStart, fmtDay, compareDateStarts, compareText } from '../util.js';
import { groupHeading, groupOpen, toggleGroupOpen } from './board.js';
import { rowMenu } from './rowmenu.js';
import { entryTitle, repeatOn } from './cells.js';
import { overlayItems } from '../sync/service.js';
import { detachOccurrence, dragKeys, dropEffect, isCopyDrop, selectable, selectElement, shiftEntries, skipOccurrence } from './rowselect.js';
import { occurrences, parseRRule } from '../recur.js';
import { iconSvg, renderIcon } from '../ui/icons.js';
import { menu, openPop, closePop, toast } from '../ui/pop.js';
import { renderTimeGrid } from './timegrid.js';
/** an entry's background on the calendar: a soft tint of its colour */
export function eventBg(color) {
    const c = color === 'default' ? 'gray' : color;
    return stepsOf(c).soft; // the same fill as coloured buttons
}
/** the last click on a compact-calendar day (for double-clicks across redraws) */
const lastTap = { iso: '', t: 0 };
/** the calendar's heading: bold month, light year (as on a Mac) */
export function calTitle(_env, text, pick) {
    const m = text.match(/^(.*?)\s+(\d{4})$/);
    const t = h('div', { class: 'cal-title large' }, m ? [h('span', { class: 'cal-t-main' }, m[1]), ' ', h('span', { class: 'cal-t-year' }, m[2])] : text);
    if (!pick)
        return t;
    const b = h('button', { class: 'cal-title-btn', title: 'Jump to …', onclick: () => pick(b) }, t, svgIcon(ICONS.chevron, 14));
    return b;
}
/** entries a day shows in the month grid by default (view setting "Entries per day") */
const DEFAULT_LANES = 5;
/** The calendar with a selected day, if any: the "New entry on selected day" shortcut uses it. */
export let calSelection = null;
/** a drag across days in progress (as in Notion: the entry itself stretches, or a "New entry" bar grows) */
let calDrag = null;
/** when the last drag ended (the click that follows it doesn't select a day) */
let calDragEnded = 0;
/** the entries between two day numbers, in the view's order (filters, search and sorts as in tables) */
export function collectEvents(env, dateProp, from, to) {
    const { db, view, state } = env;
    const ordered = query(db, { ...view, period: undefined, groupBy: undefined }, 0, state.search).rows;
    const evs = [];
    ordered.forEach((r, order) => {
        const d = asDate(db.value(r, dateProp));
        if (!d)
            return;
        const s = dayNum(d.start.slice(0, 10));
        const e = Math.max(s, d.end ? dayNum(d.end.slice(0, 10)) : s);
        const time = d.start.length > 10 ? d.start.slice(11, 16) : '';
        const rule = repeatOn(db) ? parseRRule(r.repeat) : null;
        if (rule) {
            rule.except = r.except;
            const len = e - s;
            for (const occ of occurrences(d.start, rule, isoFromDay(from - len), isoFromDay(to))) {
                const os = dayNum(occ);
                evs.push({ row: r, s: os, e: os + len, time, order, occ });
            }
            return;
        }
        if (e < from || s >= to)
            return;
        evs.push({ row: r, s, e, time, order });
    });
    // events of subscribed calendars (view only, e.g. Exchange / Outlook)
    for (const x of overlayItems(`${db.key}:${view.id}`, from, to))
        evs.push({ s: x.s, e: x.e, time: x.time, order: 1e9, ext: x, occ: x.occ });
    return evs;
}
/** Month / Week / Day */
export function modeSwitch(env) {
    const { view, state } = env;
    const cur = view.calMode ?? 'month';
    return h('div', { class: 'cal-modes', role: 'tablist' }, ['month', 'week', 'day'].map((m) => h('button', {
        class: 'vtab' + (cur === m ? ' on' : ''), role: 'tab', 'aria-selected': String(cur === m),
        onclick: () => { if (m === cur)
            return; if (m === 'month')
            delete view.calMode;
        else
            view.calMode = m; state.offset = 0; env.saveView(); env.redraw(); },
    }, m === 'month' ? 'Month' : m === 'week' ? 'Week' : 'Day')));
}
export function renderCalendar(env) {
    const { db, view, state, ctx } = env;
    const dateProp = view.dateProp ?? db.schema.properties.find((p) => p.type === 'date')?.name;
    if (!dateProp)
        return h('div', { class: 'muted small' }, 'This database has no date property.');
    // a phone shows the compact month only (no week or day grid)
    const phone = document.documentElement.classList.contains('phone');
    if (!phone && (view.calMode === 'week' || view.calMode === 'day'))
        return renderTimeGrid(env, dateProp, view.calMode);
    const today = todayISO();
    const idx = +today.slice(0, 4) * 12 + (+today.slice(5, 7) - 1) + state.offset;
    const year = Math.floor(idx / 12), month = idx % 12 + 1;
    const first = `${year}-${pad2(month)}-01`;
    // weeks start on the workspace's first weekday (Monday or Sunday)
    const firstDay = dayNum(first);
    const ws0 = weekStart();
    const dow = ((new Date(firstDay * 864e5).getUTCDay() + 6) % 7 - ws0 + 7) % 7;
    const gridStart = firstDay - dow;
    const nextMonth = dayNum(`${month === 12 ? year + 1 : year}-${pad2(month === 12 ? 1 : month + 1)}-01`);
    const weeks = Math.ceil((nextMonth - gridStart) / 7);
    const gridEnd = gridStart + weeks * 7;
    const hasSorts = !!view.sorts?.length;
    const title = db.titleProp;
    const evs = collectEvents(env, dateProp, gridStart, gridEnd);
    if (calDrag?.ghost)
        evs.push({ s: calDrag.ghost.s, e: calDrag.ghost.e, time: '', order: -1, ghost: true });
    const nameOf = (x) => (x.ext ? x.ext.ev.title : String(x.row.values[title] ?? ''));
    const dateSort = view.sorts?.[0]?.prop === dateProp ? view.sorts[0] : undefined;
    const eventStart = (x) => isoFromDay(x.s) + (x.time ? `T${x.time}` : '');
    // Date sorts include external events and put untimed events last. Other layouts keep multi-day bars first.
    const cmp = (a, b) => {
        if (dateSort && !a.ghost && !b.ghost) {
            const c = compareDateStarts(eventStart(a), eventStart(b), dateSort.dir);
            if (c)
                return c;
        }
        const ma = a.e > a.s ? 0 : 1, mb = b.e > b.s ? 0 : 1;
        if (ma !== mb)
            return ma - mb;
        if (!ma && a.s !== b.s)
            return a.s - b.s;
        if (!ma && a.e !== b.e)
            return b.e - a.e;
        if (hasSorts)
            return a.order - b.order;
        if (a.time !== b.time)
            return (a.time || '~') < (b.time || '~') ? -1 : 1;
        return compareText(nameOf(a), nameOf(b));
    };
    evs.sort(cmp);
    const head = h('div', { class: 'cal-head' }, calTitle(env, `${MONTHS[month - 1]} ${year}`, (at) => zoomPicker(at, { iso: `${year}-${pad2(month)}-01`, onMonth: (yy, mm) => { state.offset = yy * 12 + mm - 1 - (+today.slice(0, 4) * 12 + (+today.slice(5, 7) - 1)); env.redraw(); } })), h('div', { style: { display: 'flex', gap: '2px', alignItems: 'center' } }, phone ? null : modeSwitch(env), phone ? null : h('span', { class: 'cal-head-gap' }), ...stepNav({ unit: 'month', keys: true, prev: () => { state.offset--; env.redraw(); }, today: () => { state.offset = 0; if (state.day)
            state.day = today; env.redraw(); }, next: () => { state.offset++; env.redraw(); } })));
    // a phone always gets the compact month (dots per day, the chosen day's list below)
    if (view.monthLayout === 'compact' || phone)
        return compactMonth(env, dateProp, head, evs, first, gridStart, gridEnd, ws0);
    const cal = h('div', { class: 'cal' });
    cal.appendChild(h('div', { class: 'cal-days' }, WEEKDAYS.map((_, i) => h('div', { class: 'cal-dow' }, WEEKDAYS[(i + ws0) % 7]))));
    for (let w = 0; w < weeks; w++) {
        const ws = gridStart + w * 7, we = ws + 6;
        const week = h('div', { class: 'cal-week' });
        // day cells: background + day number, spanning all lanes
        for (let i = 0; i < 7; i++) {
            const n = ws + i;
            const iso = isoFromDay(n);
            const inMonth = iso.slice(5, 7) === pad2(month);
            const label = +iso.slice(8) === 1 ? `${MONTHS[+iso.slice(5, 7) - 1].slice(0, 3)} 1` : String(+iso.slice(8));
            week.appendChild(h('div', { class: 'cal-day' + (inMonth ? '' : ' out') + (state.day === iso ? ' sel' : ''), 'data-day': iso, style: { gridColumn: String(i + 1) } }, h('div', { class: 'cal-num-row' }, h('button', { class: 'cal-add', 'aria-label': `Add entry on ${iso}`, title: 'New entry', onclick: () => env.newRow({ [dateProp]: { start: iso } }, true) }, svgIcon(ICONS.plus, 14)), h('span', { class: 'cal-num' + (iso === today ? ' today' : '') }, label))));
        }
        // lay out this week's entries in lanes; a multi-day entry is one bar across its days.
        // Every week has the same height: LANES rows; a day that needs more shows LANES-1 entries and "N more".
        const LANES = Math.max(2, Math.min(12, view.perDay ?? DEFAULT_LANES));
        const lanes = [];
        const inWeek = evs.filter((x) => x.e >= ws && x.s <= we);
        const placed = [];
        for (const x of inWeek) {
            const a = Math.max(x.s, ws) - ws, b = Math.min(x.e, we) - ws;
            let lane = 0;
            while (lanes[lane] && lanes[lane].slice(a, b + 1).some(Boolean))
                lane++;
            (lanes[lane] ??= Array(7).fill(false));
            for (let c = a; c <= b; c++)
                lanes[lane][c] = true;
            placed.push({ x, a, b, lane });
        }
        const full = new Set();
        for (const p of placed)
            if (p.lane >= LANES)
                for (let c = p.a; c <= p.b; c++)
                    full.add(c);
        const hidden = new Map();
        for (const { x, a, b, lane } of placed) {
            let show = lane < LANES - 1;
            if (lane === LANES - 1) {
                show = true;
                for (let c = a; c <= b; c++)
                    if (full.has(c))
                        show = false;
            }
            if (!show) {
                for (let c = a; c <= b; c++) {
                    if (!hidden.has(c))
                        hidden.set(c, []);
                    hidden.get(c).push(x);
                }
                continue;
            }
            const el = x.ghost ? h('div', { class: 'ev ghost' + (x.s < ws ? ' from-prev' : '') + (x.e > we ? ' to-next' : '') }, h('span', { class: 't' }, 'New entry')) : x.ext ? overlayEl(x.ext, { startsBefore: x.s < ws, endsAfter: x.e > we, multi: x.e > x.s }, env) : eventEl(env, x.row, dateProp, { startsBefore: x.s < ws, endsAfter: x.e > we, multi: x.e > x.s, occ: x.occ });
            el.style.gridColumn = `${a + 1} / ${b + 2}`;
            el.style.gridRow = String(lane + 2);
            week.appendChild(el);
        }
        for (const [c, list] of hidden) {
            const all = inWeek.filter((x) => Math.max(x.s, ws) - ws <= c && Math.min(x.e, we) - ws >= c);
            const more = h('button', { class: 'cal-more', style: { gridColumn: String(c + 1), gridRow: String(LANES + 1) } }, `${list.length} more`);
            more.addEventListener('click', () => {
                // the whole day (as in Google Calendar), so the order and context stay clear; the date on top
                const box = h('div', { class: 'more-pop' }, h('div', { class: 'more-pop-day' }, fmtDay(isoFromDay(ws + c))), ...all.map((x) => (x.ext ? overlayEl(x.ext, {}, env) : eventEl(env, x.row, dateProp, {}))));
                openPop(more, box);
            });
            week.appendChild(more);
        }
        week.style.gridTemplateRows = `26px repeat(${LANES}, var(--ev-h, 24px)) 1fr`;
        week.style.setProperty('--lanes', String(LANES));
        // drop target: the day under the pointer
        const dayAt = (e) => { const b = week.getBoundingClientRect(); return ws + Math.min(6, Math.max(0, Math.floor(((e.clientX - b.left) / b.width) * 7))); };
        let over = null;
        const mark = (el) => { over?.classList.remove('drop'); over = el; over?.classList.add('drop'); };
        week.addEventListener('dragover', (e) => {
            if (!e.dataTransfer?.types.includes('text/x-nook-row'))
                return;
            e.preventDefault();
            dropEffect(e);
            mark(week.children[dayAt(e) - ws]);
        });
        week.addEventListener('dragleave', (e) => { if (!week.contains(e.relatedTarget))
            mark(null); });
        // the day under the pointer keeps its + (also over its entries, which lie on top of the day)
        let hoverDay = null;
        week.addEventListener('mousemove', (e) => { const b0 = week.getBoundingClientRect(); const el = week.children[Math.min(6, Math.max(0, Math.floor(((e.clientX - b0.left) / b0.width) * 7)))] ?? null; if (el !== hoverDay) {
            hoverDay?.classList.remove('hover');
            hoverDay = el;
            hoverDay?.classList.add('hover');
        } });
        week.addEventListener('mouseleave', () => { hoverDay?.classList.remove('hover'); hoverDay = null; });
        week.addEventListener('drop', async (e) => {
            mark(null);
            await moveCalendarDrop(env, e, isoFromDay(dayAt(e)));
        });
        cal.appendChild(week);
    }
    // selecting a day: click an empty spot; arrows move; Enter or the shortcut (N) adds an entry; double-click adds too
    const wrap = h('div', { class: 'cal-wrap', tabindex: 0, 'aria-label': 'Calendar. Click a day to select it; arrows move between days, Tab goes into its entries, Enter adds one.', 'data-focus-key': `cal:${db.key}:${view.id}` }, cal);
    const createOn = (iso) => env.newRow({ [dateProp]: { start: iso } }, true);
    const select = (iso, focus = true) => {
        state.day = iso;
        cal.querySelectorAll('.cal-day.sel').forEach((x) => x.classList.remove('sel'));
        if (iso)
            cal.querySelector(`.cal-day[data-day="${iso}"]`)?.classList.add('sel');
        calSelection = iso ? { el: wrap, create: () => createOn(iso) } : null;
        if (focus && iso)
            wrap.focus({ preventScroll: true });
    };
    const dayOf = (e) => {
        const t = e.target;
        if (t.closest('.ev, button, .cal-more'))
            return null;
        const week = t.closest('.cal-week');
        if (!week)
            return null;
        const b = week.getBoundingClientRect();
        const col = Math.min(6, Math.max(0, Math.floor(((e.clientX - b.left) / b.width) * 7)));
        return week.children[col]?.dataset.day ?? null;
    };
    // ----- dragging across days, as in Notion: the entry itself stretches over the days (its edge), or a
    // "New entry" bar grows over empty days; the calendar is drawn again only when the day changes -----
    const calKey = `cal:${db.key}:${view.id}`;
    // while dragging, only this calendar is drawn again (in the same frame, no toolbar rebuild – no flashes)
    // (the calendar on the page now – after the first step of a drag it is a newer one than this)
    const redrawCal = () => {
        const cur = document.querySelector(`.cal-wrap[data-focus-key="${CSS.escape(calKey)}"]`)?.parentElement;
        if (!cur) {
            env.redraw();
            return;
        }
        // the page stays where it is (a month with fewer weeks would pull it up)
        const sc = cur.closest('.scroll, .peek-body, .dialog-body');
        const top = sc?.scrollTop ?? 0;
        const next = renderCalendar(env);
        next.style.minHeight = `${cur.offsetHeight}px`;
        cur.replaceWith(next);
        if (sc && sc.scrollTop !== top)
            sc.scrollTop = top;
        setTimeout(() => { next.style.minHeight = ''; }, 600);
    };
    const dayAtPoint = (x, y) => {
        const week = document.elementFromPoint(x, y)?.closest('.cal-week');
        if (!week || week.closest('.cal-wrap')?.dataset.focusKey !== calKey)
            return null;
        const b = week.getBoundingClientRect();
        const col = Math.min(6, Math.max(0, Math.floor(((x - b.left) / b.width) * 7)));
        return week.children[col]?.dataset.day ?? null;
    };
    cal.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.detail > 1)
            return;
        const edgeEl = e.target.closest('.ev-edge');
        const from = edgeEl ? null : dayOf(e);
        if (!edgeEl && !from)
            return;
        const evEl = edgeEl?.closest('.ev[data-row]');
        const row = evEl ? db.rows.find((r) => r.id === evEl.dataset.row) : undefined;
        const d = row ? asDate(row.values[dateProp]) : null;
        if (edgeEl && (!row || !d))
            return;
        e.preventDefault();
        const edge = edgeEl?.dataset.edge;
        const orig = row ? row.values[dateProp] : undefined;
        const s0 = d?.start.slice(0, 10) ?? '', e0 = (d?.end ?? d?.start ?? '').slice(0, 10);
        const st = d ? d.start.slice(10) : '', et = d?.end ? d.end.slice(10) : st;
        let to = from;
        let moved = false;
        const range = () => {
            if (!to)
                return null;
            if (!edge)
                return from <= to ? [from, to] : [to, from];
            return edge === 'end' ? [s0, to < s0 ? s0 : to] : [to > e0 ? e0 : to, e0];
        };
        const valueFor = (r) => { const start = r[0] + st, end = r[1] + et; return r[1] === r[0] && !st ? { start } : { start, end: end > start ? end : start }; };
        const preview = () => {
            const r = range();
            if (!r)
                return;
            if (edge) {
                row.values[dateProp] = valueFor(r);
                calDrag = { row: row.id };
            }
            else
                calDrag = { ghost: { s: dayNum(r[0]), e: dayNum(r[1]) } };
            redrawCal();
        };
        document.body.classList.add(edge ? 'cal-resizing' : 'cal-creating');
        if (edge) {
            calDrag = { row: row.id };
            cal.querySelectorAll('.ev[data-row]').forEach((x) => { if (x.dataset.row === row.id)
                x.classList.add('stretching'); });
        }
        const move = (ev) => {
            const day = dayAtPoint(ev.clientX, ev.clientY);
            if (!day || day === to)
                return;
            to = day;
            moved = true;
            preview();
        };
        const finish = async (keep) => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            document.removeEventListener('keydown', esc, true);
            document.body.classList.remove('cal-resizing', 'cal-creating');
            const r = range();
            calDrag = null;
            if (moved)
                calDragEnded = Date.now();
            if (!edge) {
                // a plain click (no drag) stays a click: the day gets selected as before
                if (!moved)
                    return;
                redrawCal();
                if (keep && r)
                    await env.newRow({ [dateProp]: { start: r[0], end: r[1] } }, true);
                return;
            }
            const changed = keep && r && JSON.stringify(valueFor(r)) !== JSON.stringify(orig);
            if (!changed) {
                row.values[dateProp] = orig;
                if (moved)
                    redrawCal();
                else
                    document.querySelectorAll('.ev.stretching').forEach((x) => x.classList.remove('stretching'));
                return;
            }
            ctx.ws.boundary();
            row.values[dateProp] = valueFor(r);
            await ctx.ws.saveRow(db, row);
            env.redraw();
        };
        const up = () => { void finish(true); };
        const esc = (ev) => { if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            void finish(false);
        } };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        document.addEventListener('keydown', esc, true);
    });
    // a double-click adds an entry: it should not select the text under the mouse
    cal.addEventListener('mousedown', (e) => { if (e.detail > 1)
        e.preventDefault(); });
    // a click on the selected day (not part of a double-click) unselects it
    cal.addEventListener('click', (e) => { if (Date.now() - calDragEnded < 300)
        return; const d = dayOf(e); if (!d)
        return; if (d === state.day && e.detail === 1 && cal.querySelector('.cal-day.sel:not(.sel-idle)'))
        select(undefined);
    else
        select(d); });
    // hovering an entry that spans several weeks lights up all its parts
    let hovered = null;
    cal.addEventListener('mouseover', (e) => {
        const ev = e.target.closest('.ev[data-row]');
        // only when the entry under the mouse changes (mouseover fires for every child element)
        if ((ev?.dataset.row ?? null) === hovered)
            return;
        hovered = ev?.dataset.row ?? null;
        cal.querySelectorAll('.ev.hover').forEach((x) => { if (!ev || x.dataset.row !== ev.dataset.row)
            x.classList.remove('hover'); });
        if (ev)
            cal.querySelectorAll('.ev[data-row]').forEach((x) => { if (x.dataset.row === ev.dataset.row)
                x.classList.add('hover'); });
    });
    cal.addEventListener('mouseleave', () => { hovered = null; cal.querySelectorAll('.ev.hover').forEach((x) => x.classList.remove('hover')); });
    cal.addEventListener('dblclick', (e) => { const d = dayOf(e); if (d) {
        select(d);
        createOn(d);
    } });
    wrap.addEventListener('keydown', (e) => {
        if (!state.day || e.metaKey || e.ctrlKey || e.altKey)
            return;
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (e.key in step) {
            e.preventDefault();
            const next = isoFromDay(dayNum(state.day) + step[e.key]);
            state.day = next;
            if (next.slice(0, 7) !== `${year}-${pad2(month)}`) {
                state.offset += next < first ? -1 : 1;
                env.redraw();
                requestAnimationFrame(() => document.querySelector('.cal-wrap .cal-day.sel')?.closest('.cal-wrap')?.focus({ preventScroll: true }));
            }
            else
                select(next);
        }
        else if ((e.key === 'Enter' && e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) {
            // Tab or ⇧↵: into the entries of this day – arrows then move between entries, Tab / Esc back to the days
            e.preventDefault();
            const first = entriesOn(state.day)[0];
            if (first)
                selectElement(first);
            else
                toast('No entries on this day');
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            createOn(state.day);
        }
        else if (e.key === 'Escape') {
            select(undefined);
            wrap.blur();
        }
    });
    /** the entry elements shown on a day, top to bottom */
    const dayOfEl = (el) => {
        const week = el.closest('.cal-week');
        if (!week)
            return null;
        const wr = week.getBoundingClientRect(), r = el.getBoundingClientRect();
        const col = Math.max(0, Math.min(6, Math.floor(((r.left + 2 - wr.left) / wr.width) * 7)));
        return week.children[col]?.dataset.day ?? null;
    };
    const entriesOn = (iso) => [...cal.querySelectorAll('.selectable')]
        .filter((el) => el.offsetParent && dayOfEl(el) === iso)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    // second Esc after selecting entries: back to the days, on the day of the last entry
    wrap.addEventListener('nook-return-to-day', (e) => {
        const el = e.detail;
        const d = dayOfEl(el) ?? state.day;
        if (d)
            select(d);
    });
    wrap.addEventListener('focusout', (e) => {
        if (wrap.contains(e.relatedTarget))
            return;
        if (calSelection?.el === wrap)
            calSelection = null;
        cal.querySelectorAll('.cal-day.sel').forEach((x) => x.classList.add('sel-idle'));
    });
    wrap.addEventListener('focusin', () => {
        cal.querySelectorAll('.cal-day.sel-idle').forEach((x) => x.classList.remove('sel-idle'));
        if (state.day)
            calSelection = { el: wrap, create: () => createOn(state.day) };
    });
    if (state.day)
        calSelection = { el: wrap, create: () => createOn(state.day) };
    return h('div', { class: 'month-calendar' }, head, wrap);
}
/** an event of a subscribed calendar: shown, not editable; click for details */
export function overlayEl(x, shape, env) {
    const { ev, sub } = x;
    const time = x.time ? `${fmtTime(x.time)} ` : '';
    const el = h('div', { class: 'ev ext' + (shape.startsBefore ? ' from-prev' : '') + (shape.endsAfter ? ' to-next' : ''), title: `${ev.title} · ${sub.name} (view only)`, tabindex: 0 }, ev.icon ? h('span', { class: 'ev-ico' }, iconSvg(ev.icon, 12)) : h('span', { class: 'dot' }), h('span', { class: 't' }, time + (ev.title || 'Busy')));
    el.style.setProperty('--ext', sub.color || '#8a8a8a');
    const show = () => overlayDetails(el, x, env);
    el.addEventListener('click', (e) => { e.stopPropagation(); show(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
        e.preventDefault();
        show();
    } });
    void shape.multi;
    return el;
}
/** the details of an event of a subscribed calendar (calendar and list views) */
export function overlayDetails(el, x, env) {
    const { ev, sub } = x;
    // from a database calendar (birthdays …): open the entry itself
    if (ev.rowRef && env) {
        const d = env.ctx.ws.dbs.get(ev.rowRef.db), r = d?.byId(ev.rowRef.id);
        if (d && r) {
            env.ctx.openRow(d, r);
            return;
        }
    }
    /** an event of a calendar link as an entry of this database (date, time, place and notes come along) */
    const copyIn = async (env) => {
        const { db, ctx, view } = env;
        const dateProp = view.dateProp && db.prop(view.dateProp) ? view.dateProp : db.dateLabel ?? db.schema.properties.find((p) => p.type === 'date')?.name;
        const day = x.occ ?? ev.start.slice(0, 10);
        const shift = (s) => (x.occ && s.slice(0, 10) === ev.start.slice(0, 10) ? x.occ + s.slice(10) : s);
        const values = { [db.titleProp]: ev.title || 'Busy' };
        if (dateProp)
            values[dateProp] = (ev.end ? { start: shift(ev.start), end: ev.end.length > 10 && x.occ ? x.occ + ev.end.slice(10) : ev.end } : { start: ev.start.length > 10 ? shift(ev.start) : day });
        ctx.ws.boundary();
        const body = [ev.location ? `📍 ${ev.location}` : '', ev.description ?? ''].filter(Boolean).join('\n\n');
        const row = await ctx.ws.addRow(db, values);
        if (body) {
            row.body = body + '\n';
            await ctx.ws.saveRow(db, row);
        }
        closePop();
        toast(`Copied into “${db.schema.name}”`);
        env.redraw();
    };
    {
        const when = ev.start.length > 10
            ? `${fmtDay(x.occ ?? ev.start.slice(0, 10))}, ${fmtTime(ev.start.slice(11, 16))}${ev.end && ev.end.length > 10 ? ` – ${ev.end.slice(0, 10) !== ev.start.slice(0, 10) ? fmtDay(ev.end.slice(0, 10)) + ', ' : ''}${fmtTime(ev.end.slice(11, 16))}` : ''}`
            : `${fmtDay(x.occ ?? ev.start)}${ev.end ? ` – ${fmtDay(ev.end)}` : ''}`;
        openPop(el, h('div', { class: 'ext-pop' }, h('div', { class: 'ext-pop-cal' }, h('span', { class: 'ev-dot', style: { background: sub.color } }), sub.name, h('span', { class: 'muted small' }, ' · view only')), h('div', { class: 'ext-pop-title' }, ev.title || 'Busy'), h('div', { class: 'muted' }, when + (ev.rrule ? ' · repeats' : '')), ev.location ? h('div', null, ev.location) : null, ev.description ? h('div', { class: 'ext-pop-desc' }, ...ev.description.split(/(https?:\/\/[^\s<>"]+)/).map((part, i) => i % 2 ? h('a', { href: part, target: '_blank', rel: 'noopener' }, part) : part)) : null, env ? h('div', { class: 'ext-pop-actions' }, h('button', { class: 'set-btn', onclick: () => void copyIn(env) }, svgIcon(ICONS.plus, 13), `Copy into “${env.db.schema.name}”`)) : null));
    }
}
function eventAppearance(env, row) {
    const { db, view } = env;
    const colorProp = view.colorBy;
    const cv = colorProp ? db.value(row, colorProp) : null;
    // conditional colours first; then a one-way synced calendar's own colour (birthdays …, outlined like
    // subscriptions); then the view's colour property; then the colour of a two-way synced calendar
    const rule = ruleColors(db, view, row).row;
    const byProp = (typeof cv === 'string' && cv ? db.optionColor(colorProp, cv) : undefined);
    const color = (rule ?? byProp ?? 'default');
    return { color };
}
export function eventEl(env, row, dateProp, shape) {
    const { db, view, ctx } = env;
    const { color } = eventAppearance(env, row);
    const et = entryTitle(db, row);
    const name = et.text;
    const d = asDate(row.values[dateProp]);
    const time = d && d.start.length > 10 && !shape.startsBefore ? fmtTime(d.start.slice(11, 16)) + ' ' : '';
    const el = h('div', {
        class: 'ev' + (shape.multi ? ' multi' : '') + (shape.startsBefore ? ' from-prev' : '') + (shape.endsAfter ? ' to-next' : ''),
        draggable: true, role: 'button', tabindex: 0, title: name,
        style: { background: eventBg(color) },
    }, row.icon && !view.hideIcons ? renderIcon(row.icon, 13) : h('span', { class: 'dot', style: { background: COLORS[color]?.text ?? COLORS.gray.text } }), h('span', { class: 't' + (et.derived ? ' derived-title' : '') }, time + name), 
    // at the right edge: the repeat mark, then one bell – shown while a reminder is set, a button on hover, always in the same place
    shape.occ ? h('span', { class: 'ev-repeat ev-trail', title: 'Repeating entry' }, iconSvg('repeat', 11)) : null, document.documentElement.classList.contains('touch')
        ? (row.remind !== undefined && row.remind !== -1 ? h('span', { class: 'ev-repeat ev-trail', title: 'Reminder' }, iconSvg('bell', 11)) : null)
        : h('button', { class: 'ev-bell' + (row.remind !== undefined && row.remind !== -1 ? ' on' : ''), 'aria-label': 'Remind me', title: row.remind !== undefined && row.remind !== -1 ? 'Reminder – change…' : 'Remind me…', draggable: false,
            onmousedown: (e) => e.stopPropagation(),
            onclick: (e) => { e.preventDefault(); e.stopPropagation(); remindMenu(env.ctx.ws, env.db, row, dateProp, e.currentTarget, () => env.redraw()); } }, iconSvg('bell', 11)));
    {
        const st = stepsOf(color === 'default' ? 'gray' : color);
        el.style.setProperty('--ev-soft', st.soft);
        el.style.setProperty('--ev-strong', st.strong);
    }
    // edges to pull across days (start on the left, end on the right); not for single dates of a series
    if (d && !shape.occ) {
        if (!shape.startsBefore)
            el.appendChild(h('span', { class: 'ev-edge l', 'data-edge': 'start', title: 'Drag to change the first day' }));
        if (!shape.endsAfter)
            el.appendChild(h('span', { class: 'ev-edge r', 'data-edge': 'end', title: 'Drag to change the last day' }));
    }
    if (calDrag?.row === row.id)
        el.classList.add('stretching');
    selectable(el, env, row, undefined, shape.occ ? `${row.id}@${shape.occ}` : row.id);
    el.addEventListener('dragstart', (e) => {
        if (e.target.closest?.('.ev-edge')) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('text/x-nook-row', row.id);
        // which day of a multi-day bar was grabbed, so the bar moves relative to that day
        let grab = 0;
        if (d && shape.multi) {
            const week = el.parentElement.getBoundingClientRect();
            const col = Math.floor(((e.clientX - week.left) / week.width) * 7);
            const weekStart = dayNum(el.parentElement.firstElementChild.dataset.day);
            grab = weekStart + col - dayNum(shape.occ ?? d.start.slice(0, 10));
        }
        e.dataTransfer.setData('text/x-nook-grab', String(grab));
        if (shape.occ)
            e.dataTransfer.setData('text/x-nook-occ', shape.occ);
        e.dataTransfer.effectAllowed = 'copyMove';
        const n = dragKeys(env, shape.occ ? `${row.id}@${shape.occ}` : row.id).length;
        if (n > 1) {
            const ghost = h('div', { class: 'drag-ghost' }, `${n} entries`);
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 10, 10);
            setTimeout(() => ghost.remove());
        }
    });
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const occ = shape.occ;
        const extra = occ ? [
            { section: `Repeating · ${fmtDay(occ)}` },
            { label: 'Edit only this date', run: async () => { const c = await detachOccurrence(env, row, occ, dateProp); env.redraw(); ctx.openRow(db, c); } },
            { label: 'Skip this date', run: async () => { ctx.ws.boundary(); await skipOccurrence(env, row, occ); env.redraw(); } },
            'sep',
        ] : [];
        rowMenu(ctx, db, row, { x: e.clientX, y: e.clientY }, () => env.redraw(), extra);
    });
    return el;
}
/** A month overview paired with the selected day's real calendar entries. */
function compactMonth(env, dateProp, head, events, first, from, to, weekday) {
    const { db, view, state } = env;
    const today = todayISO();
    if (!state.day || state.day.slice(0, 7) !== first.slice(0, 7))
        state.day = today.slice(0, 7) === first.slice(0, 7) ? today : first;
    const selected = state.day;
    const grid = h('div', { class: 'compact-month-days', 'aria-label': 'Select a date' });
    const details = h('div', { class: 'compact-month-details' });
    const wrap = h('div', { class: 'compact-month month-calendar' }, h('div', { class: 'compact-month-layout' }, h('div', { class: 'compact-month-overview' }, head, h('div', { class: 'compact-month-frame' }, h('div', { class: 'compact-month-weekdays' }, WEEKDAYS.map((_, i) => h('span', { class: 'cal-dow' }, WEEKDAYS[(i + weekday) % 7]))), grid)), details));
    const layout = wrap.querySelector('.compact-month-layout');
    // phone: swipe the month grid sideways for the previous / next month. Touches starting at the screen edges are
    // left alone – those are Back / Forward between pages.
    if (document.documentElement.classList.contains('phone')) {
        const frame = wrap.querySelector('.compact-month-frame');
        let x0 = 0, y0 = 0, dx = 0, on = false, dead = true;
        frame.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            x0 = t.clientX;
            y0 = t.clientY;
            dx = 0;
            on = false;
            dead = e.touches.length !== 1 || x0 <= 32 || x0 >= innerWidth - 32;
        }, { passive: true });
        frame.addEventListener('touchmove', (e) => {
            if (dead)
                return;
            const t = e.touches[0];
            dx = t.clientX - x0;
            const dy = t.clientY - y0;
            if (!on) {
                if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
                    dead = true;
                    return;
                }
                if (Math.abs(dx) < 10)
                    return;
                on = true;
            }
            e.preventDefault();
            frame.style.transition = 'none';
            frame.style.transform = `translateX(${dx * 0.6}px)`;
            frame.style.opacity = String(Math.max(0.4, 1 - Math.abs(dx) / 500));
        }, { passive: false });
        const end = () => {
            if (!on)
                return;
            on = false;
            if (Math.abs(dx) > 60) {
                state.offset += dx < 0 ? 1 : -1;
                state.slide = dx < 0 ? 1 : -1;
                env.redraw();
                return;
            }
            frame.style.transition = 'transform .16s ease-out, opacity .16s';
            frame.style.transform = '';
            frame.style.opacity = '';
        };
        frame.addEventListener('touchend', end);
        frame.addEventListener('touchcancel', end);
        if (state.slide) {
            const d = state.slide;
            delete state.slide;
            frame.style.transform = `translateX(${d * 40}px)`;
            frame.style.opacity = '0.4';
            requestAnimationFrame(() => requestAnimationFrame(() => { frame.style.transition = 'transform .18s ease-out, opacity .18s'; frame.style.transform = ''; frame.style.opacity = ''; }));
        }
    }
    const overview = layout.firstElementChild;
    const divider = h('div', { class: 'compact-month-divider', title: 'Drag to resize · right-click to fix a width', role: 'separator', tabindex: 0, 'aria-label': 'Calendar pane width', 'aria-orientation': 'vertical', 'aria-valuemin': '25', 'aria-valuemax': '75' });
    if (view.compactCalendarRight) {
        layout.prepend(details);
        layout.append(overview);
        wrap.classList.add('calendar-right');
    }
    layout.insertBefore(divider, layout.children[1]);
    const applyWidth = () => {
        const width = view.compactCalendarWidth ?? 46.5;
        const left = view.compactCalendarRight ? 100 - width : width;
        const fixed = view.compactFixedPane;
        const px = fixed ? `min(${fixed.width}px, calc(100% - 112px))` : '';
        layout.style.gridTemplateColumns = fixed
            ? fixed.side === 'left' ? `${px} var(--grab-w) minmax(80px, 1fr)` : `minmax(80px, 1fr) var(--grab-w) ${px}`
            : `minmax(0, ${left}fr) var(--grab-w) minmax(0, ${100 - left}fr)`;
        divider.setAttribute('aria-valuemin', fixed ? '60' : '25');
        divider.setAttribute('aria-valuemax', fixed ? String(Math.max(60, layout.clientWidth - 112)) : '75');
        divider.setAttribute('aria-valuenow', String(Math.round(fixed?.width ?? width)));
        divider.setAttribute('aria-valuetext', fixed ? `${fixed.side} pane ${fixed.width} pixels` : `Calendar ${Math.round(width)} percent`);
    };
    const setLeft = (left, available) => {
        left = Math.max(80, Math.min(available - 80, left));
        if (view.compactFixedPane)
            view.compactFixedPane.width = Math.round(view.compactFixedPane.side === 'left' ? left : available - left);
        else
            view.compactCalendarWidth = Math.max(25, Math.min(75, (view.compactCalendarRight ? available - left : left) / available * 100));
        applyWidth();
    };
    applyWidth();
    divider.addEventListener('pointerdown', e => {
        if (e.button !== 0)
            return;
        e.preventDefault();
        divider.setPointerCapture(e.pointerId);
        divider.classList.add('on');
        document.body.classList.add('resizing-cols');
        const bounds = layout.getBoundingClientRect(), handle = divider.getBoundingClientRect();
        const gap = handle.width + 20, available = bounds.width - gap;
        const center = handle.left + handle.width / 2;
        const move = (ev) => {
            let x = center + ev.clientX - e.clientX;
            for (const f of [0.25, 1 / 3, 0.5, 2 / 3, 0.75]) {
                const snap = bounds.left + f * bounds.width;
                if (Math.abs(x - snap) < 10) {
                    x = snap;
                    break;
                }
            }
            setLeft(x - bounds.left - gap / 2, available);
        };
        const finish = () => { divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', finish); divider.removeEventListener('pointercancel', finish); divider.classList.remove('on'); document.body.classList.remove('resizing-cols'); env.saveView(); };
        divider.addEventListener('pointermove', move);
        divider.addEventListener('pointerup', finish);
        divider.addEventListener('pointercancel', finish);
    });
    divider.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')
            return;
        e.preventDefault();
        e.stopPropagation();
        const step = e.key === 'ArrowRight' ? 2 : -2;
        if (view.compactFixedPane)
            view.compactFixedPane.width = Math.max(60, view.compactFixedPane.width + step * (view.compactFixedPane.side === 'left' ? 1 : -1));
        else
            view.compactCalendarWidth = Math.max(25, Math.min(75, (view.compactCalendarWidth ?? 46.5) + step * (view.compactCalendarRight ? -1 : 1)));
        applyWidth();
        env.saveView();
    });
    divider.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        const measured = (side) => Math.round((side === 'left' ? layout.firstElementChild : layout.lastElementChild).getBoundingClientRect().width);
        const save = () => { applyWidth(); env.saveView(); };
        menu({ x: e.clientX, y: e.clientY }, [
            { section: 'Column width' },
            ...['left', 'right'].map(side => ({ label: `${view.compactFixedPane?.side === side ? '✓' : '   '} Fixed ${side} column`, hint: `${view.compactFixedPane?.side === side ? view.compactFixedPane.width : measured(side)} px`, run: () => { view.compactFixedPane = { side, width: Math.max(60, measured(side)) }; save(); } })),
            { label: `${!view.compactFixedPane ? '✓' : '   '} Both flexible`, run: () => { delete view.compactFixedPane; save(); } },
        ]);
    });
    const create = () => env.newRow({ [dateProp]: { start: selected } }, true);
    calSelection = { el: wrap, create };
    const select = (iso) => {
        state.day = iso;
        const now = new Date(today + 'T12:00:00'), date = new Date(iso + 'T12:00:00');
        state.offset = (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth();
        env.redraw();
        // A local selection must not move focus to another copy of this database view.
        env.selectionRoot?.querySelector(`.compact-month-day[data-day="${iso}"]`)?.focus({ preventScroll: true });
    };
    for (let day = from; day < to; day++) {
        const iso = isoFromDay(day), items = events.filter(x => x.s <= day && x.e >= day);
        const markers = items.map(x => {
            const color = x.ext ? x.ext.sub.color : COLORS[eventAppearance(env, x.row).color]?.text;
            return h('span', { class: 'compact-month-dot', style: { background: color || COLORS.gray.text } });
        });
        const button = h('button', { type: 'button', class: 'compact-month-day' + (iso.slice(0, 7) !== first.slice(0, 7) ? ' out' : ''),
            'data-day': iso, 'data-focus-key': `compact:${db.key}:${view.id}:${iso}`,
            'aria-label': `${fmtDay(iso)} · ${items.length} entries`, 'aria-pressed': String(iso === selected),
            // a second click on the same day soon after: a new entry on it (selecting redraws the
            // month, so the browser's own double-click never reaches the new button)
            onclick: () => {
                const now = Date.now();
                if (lastTap.iso === iso && now - lastTap.t < 400) {
                    lastTap.t = 0;
                    env.newRow({ [dateProp]: { start: iso } }, true);
                    return;
                }
                lastTap.iso = iso;
                lastTap.t = now;
                select(iso);
            },
            onkeydown: (e) => {
                const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
                if (delta) {
                    e.preventDefault();
                    e.stopPropagation();
                    select(addDays(iso, delta));
                }
            },
        }, h('span', { class: 'cal-num' + (iso === today ? ' today' : '') }, String(+iso.slice(8))), h('span', { class: 'compact-month-markers', 'aria-hidden': 'true' }, ...markers));
        button.addEventListener('dragover', e => { if (!e.dataTransfer?.types.includes('text/x-nook-row'))
            return; e.preventDefault(); e.stopPropagation(); dropEffect(e); button.classList.add('drop'); });
        button.addEventListener('dragleave', () => button.classList.remove('drop'));
        button.addEventListener('drop', async (e) => { e.stopPropagation(); button.classList.remove('drop'); await moveCalendarDrop(env, e, iso); });
        grid.appendChild(button);
    }
    // the dots start on a whole screen pixel in every cell (the cells are fractions of the width – dots at
    // half pixels came out blurred and of slightly different sizes)
    requestAnimationFrame(() => {
        const d = devicePixelRatio || 1;
        grid.querySelectorAll('.compact-month-markers').forEach((m) => {
            m.style.transform = '';
            const r = m.getBoundingClientRect();
            const dx = (Math.round(r.left * d) - r.left * d) / d, dy = (Math.round(r.top * d) - r.top * d) / d;
            if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)
                m.style.transform = `translate(${dx}px, ${dy}px)`;
        });
    });
    const day = dayNum(selected);
    const items = events.filter(x => x.s <= day && x.e >= day);
    // Without explicit sorts, day details are an agenda, including spanning and external events.
    if (!view.sorts?.length)
        items.sort((a, b) => compareDateStarts(a.time ? `${selected}T${a.time}` : selected, b.time ? `${selected}T${b.time}` : selected));
    details.appendChild(h('div', { class: 'compact-month-date', 'aria-live': 'polite' }, fmtDay(selected)));
    const appendEntries = (entries, separateUntimed = false) => {
        let untimed = false;
        for (const x of entries) {
            if (separateUntimed && entries.some(entry => !!entry.time) && !x.time && !untimed && (!view.sorts?.length || view.sorts[0].prop === dateProp)) {
                untimed = true;
                details.appendChild(h('div', { class: 'compact-month-untimed muted small' }, 'Without time'));
            }
            const el = x.ext ? overlayEl(x.ext, {}, env) : eventEl(env, x.row, dateProp, { occ: x.occ });
            // List entries retain opening, selection and context menus, not month-bar resizing.
            el.querySelectorAll('.ev-edge').forEach(edge => edge.remove());
            el.draggable = !x.ext;
            if (x.row)
                el.addEventListener('dragstart', e => {
                    // Anchor a spanning entry to the day currently shown in the details pane.
                    e.dataTransfer?.setData('text/x-nook-grab', String(day - x.s));
                });
            details.appendChild(el);
        }
    };
    if (view.groupBy) {
        // Use the shared query's option order, labels and multi-select membership. Restrict counts
        // to the selected day's occurrences, including recurring entries whose start is elsewhere.
        const groups = query(db, { ...view, period: undefined }, 0, state.search).groups ?? [];
        for (const group of groups) {
            const ids = new Set(group.rows.map(row => row.id));
            const entries = items.filter(x => x.row && ids.has(x.row.id));
            if (!entries.length && view.groupBy.hideEmpty !== false)
                continue;
            const open = groupOpen(env, group.key);
            const toggle = () => toggleGroupOpen(env, group.key);
            details.appendChild(h('div', { class: 'list-group-head', onclick: toggle }, ...groupHeading(env, group.key, entries.length, open, toggle)));
            if (open)
                appendEntries(entries);
        }
        const external = items.filter(x => x.ext);
        if (external.length) {
            details.appendChild(h('div', { class: 'list-group-head muted' }, 'External calendars'));
            appendEntries(external);
        }
    }
    else
        appendEntries(items, true);
    if (!items.length)
        details.appendChild(h('div', { class: 'compact-month-empty muted small' }, 'No entries.'));
    details.appendChild(h('button', { type: 'button', class: 'loadmore list-new', onclick: create }, '+ New'));
    return wrap;
}
async function moveCalendarDrop(env, e, iso) {
    const { db, ctx } = env;
    const dateProp = env.view.dateProp ?? db.schema.properties.find(p => p.type === 'date').name;
    const id = e.dataTransfer?.getData('text/x-nook-row');
    const grab = Number(e.dataTransfer?.getData('text/x-nook-grab') || 0);
    const occ = e.dataTransfer?.getData('text/x-nook-occ') || '';
    const row = db.rows.find((r) => r.id === id);
    if (!row)
        return;
    e.preventDefault();
    // from another view (a list, a table…): every dragged entry goes to this day, keeping its time and length
    if (!e.dataTransfer?.types.includes('text/x-nook-grab')) {
        let ids = [row.id];
        try {
            const x = JSON.parse(e.dataTransfer?.getData('text/x-nook-rows') || '[]');
            if (Array.isArray(x) && x.length)
                ids = x;
        }
        catch { /* one entry */ }
        const rows = db.rows.filter((r) => ids.includes(r.id));
        ctx.ws.boundary();
        for (const r of rows) {
            const d0 = asDate(r.values[dateProp]);
            const span = d0?.end ? dayNum(d0.end.slice(0, 10)) - dayNum(d0.start.slice(0, 10)) : 0;
            const t = d0 && d0.start.length > 10 ? d0.start.slice(10) : '';
            const et = d0?.end && d0.end.length > 10 ? d0.end.slice(10) : '';
            r.values[dateProp] = { start: iso + t, ...(d0?.end ? { end: addDays(iso, span) + et } : {}) };
            await ctx.ws.saveRow(db, r);
        }
        ctx.ws.emit();
        if (rows.length > 1)
            toast(`Moved ${rows.length} entries to ${fmtDay(iso)}`);
        return;
    }
    const d = asDate(row.values[dateProp]) ?? { start: iso };
    const delta = dayNum(iso) - grab - dayNum(occ || d.start.slice(0, 10));
    const copy = isCopyDrop(e);
    if (!delta && !copy)
        return;
    // several selected entries (or Alt = copies): all move by the same number of days
    const keys = dragKeys(env, occ ? `${row.id}@${occ}` : row.id);
    if (keys.length > 1 || copy) {
        await shiftEntries(env, keys, dateProp, delta, { copy });
        ctx.ws.emit();
        return;
    }
    if (occ && row.repeat) {
        // a repeating entry: move just this date, or the whole series
        menu({ x: e.clientX, y: e.clientY }, [
            { section: 'Repeating entry' },
            { label: 'Move only this date', run: async () => { await detachOccurrence(env, row, occ, dateProp, addDays(occ, delta)); ctx.ws.emit(); } },
            { label: 'Move all dates', run: async () => {
                    ctx.ws.boundary();
                    row.values[dateProp] = { start: addDays(d.start.slice(0, 10), delta) + d.start.slice(10), ...(d.end ? { end: addDays(d.end.slice(0, 10), delta) + d.end.slice(10) } : {}) };
                    row.except = row.except?.map((x) => addDays(x, delta));
                    await ctx.ws.saveRow(db, row);
                    ctx.ws.emit();
                } },
            { label: 'Cancel', run: () => { } },
        ]);
        return;
    }
    const time = d.start.length > 10 ? d.start.slice(10) : '';
    const endTime = d.end && d.end.length > 10 ? d.end.slice(10) : '';
    ctx.ws.boundary();
    row.values[dateProp] = { start: addDays(d.start.slice(0, 10), delta) + time, ...(d.end ? { end: addDays(d.end.slice(0, 10), delta) + endTime } : {}) };
    await ctx.ws.saveRow(db, row);
    ctx.ws.emit();
}
//# sourceMappingURL=calendar.js.map