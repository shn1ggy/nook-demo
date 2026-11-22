// Calendars that zoom out: click the title of a month to see the year's 12 months, click the year
// to see 12 years. Picking a year or month goes back down. Used by every calendar in the app.
import { MONTHS, h } from '../util.js';
const cur = () => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; };
/** the 12 months of a year */
export function monthsGrid(y, sel, pick, note) {
    const t = cur();
    return h('div', { class: 'dp-months' }, ...MONTHS.map((name, i) => h('button', {
        class: 'dp-mon' + (sel && sel.y === y && sel.m === i + 1 ? ' on' : '') + (t.y === y && t.m === i + 1 ? ' today' : '') + (y > t.y || (y === t.y && i + 1 > t.m) ? ' future' : ''), tabindex: -1,
        onclick: (e) => { e.stopPropagation(); pick(i + 1); },
    }, name.slice(0, 3), note?.(y, i + 1) ? h('small', null, note(y, i + 1)) : null)));
}
/** 12 years around a year */
export function yearsGrid(y, selY, pick, note) {
    const base = y - (((y % 12) + 12) % 12), t = cur();
    return h('div', { class: 'dp-months' }, ...Array.from({ length: 12 }, (_, i) => base + i).map((yy) => h('button', {
        class: 'dp-mon' + (yy === selY ? ' on' : '') + (yy === t.y ? ' today' : '') + (yy > t.y ? ' future' : ''), tabindex: -1,
        onclick: (e) => { e.stopPropagation(); pick(yy); },
    }, String(yy), note?.(yy) ? h('small', null, note(yy)) : null)));
}
/** the calendar's heading: "November 2026" – the month leads to the year's months, the year to 12 years */
export function crumbParts(zoom, y, m, go) {
    const b = (text, z, dim = false) => h('button', { class: 'dp-crumb-b' + (dim ? ' dim' : ''), tabindex: -1, disabled: !z, onclick: (e) => { e.stopPropagation(); if (z)
            go(z); } }, text);
    // a small ⌄ shows that the heading opens the next level (the year's months, then 12 years)
    const more = () => h('span', { class: 'dp-crumb-more' }, svgIcon(ICONS.chevron, 12));
    if (zoom === 'days') {
        const yb = b(String(y), 'years', true);
        yb.appendChild(more());
        return [b(MONTHS[m - 1], 'year'), yb];
    }
    if (zoom === 'year') {
        const yb = b(String(y), 'years');
        yb.appendChild(more());
        return [yb];
    }
    return [b(yearsTitle(y), null)];
}
const yearsTitle = (y) => { const base = y - (((y % 12) + 12) % 12); return `${base} – ${base + 11}`; };
import { WEEKDAYS, weekStart, dayNum, isoFromDay, todayISO, pad2, svgIcon, ICONS, keyHint } from '../util.js';
import { openPop, closePop } from './pop.js';
/** ‹ Today › – the step buttons of every calendar, view and picker. `unit` names the step ("month");
 *  `keys` adds the keyboard shortcuts of views to the tooltips; `small` is for pickers */
export function stepNav(o) {
    const size = o.small ? 14 : 16, u = o.unit;
    return [
        h('button', { class: 'icon-btn', 'aria-label': u ? `Previous ${u}` : 'Earlier', title: o.keys ? `Previous ${u ?? ''}${keyHint('period.prev')}` : undefined, onclick: (e) => { e.stopPropagation(); o.prev(); } }, svgIcon(ICONS.chevronL, size)),
        h('button', { class: 'vtab', 'data-action': o.keys ? 'today' : undefined, title: o.keys ? `Go to today${keyHint('view.today')}` : undefined, onclick: (e) => { e.stopPropagation(); o.today(); } }, 'Today'),
        h('button', { class: 'icon-btn', 'aria-label': u ? `Next ${u}` : 'Later', title: o.keys ? `Next ${u ?? ''}${keyHint('period.next')}` : undefined, onclick: (e) => { e.stopPropagation(); o.next(); } }, svgIcon(ICONS.chevronR, size)),
    ];
}
/**
 * A calendar popover for moving a view: days (when `onDay` is given) or months, with zoom out to
 * the year and to 12 years. `has` marks days with entries.
 */
export function zoomPicker(anchor, o) {
    const top = o.onDay ? 'days' : 'year';
    let zoom = top;
    let y = +o.iso.slice(0, 4), m = +o.iso.slice(5, 7);
    const selY = y, selM = m;
    const box = h('div', { class: 'dp zoom-pop' });
    const done = () => closePop();
    const draw = () => {
        const step = (n) => { if (zoom === 'days') {
            m += n;
            if (m < 1) {
                m = 12;
                y--;
            }
            if (m > 12) {
                m = 1;
                y++;
            }
        }
        else
            y += zoom === 'year' ? n : 12 * n; draw(); };
        const title = h('span', { class: 'dp-title dp-crumb' }, ...crumbParts(zoom, y, m, (z) => { zoom = z; draw(); }));
        let grid;
        if (zoom === 'days') {
            const first = dayNum(`${y}-${pad2(m)}-01`);
            const lead = ((new Date(first * 864e5).getUTCDay() + 6) % 7 - weekStart() + 7) % 7;
            const t = todayISO();
            grid = h('div', { class: 'dp-grid' }, ...[0, 1, 2, 3, 4, 5, 6].map((i) => h('span', { class: 'dp-dow' }, WEEKDAYS[(i + weekStart()) % 7].slice(0, 2))), ...Array.from({ length: 42 }, (_, i) => isoFromDay(first - lead + i)).map((iso) => h('button', {
                class: 'dp-day' + (+iso.slice(5, 7) !== m ? ' out' : '') + (iso === t ? ' today' : '') + (iso === o.iso ? ' on' : '') + (o.has?.(iso) ? ' has' : ''), tabindex: -1,
                onclick: () => { done(); o.onDay(iso); },
            }, String(+iso.slice(8)))));
        }
        else if (zoom === 'year') {
            grid = monthsGrid(y, { y: selY, m: selM }, (mm) => { if (top === 'year') {
                done();
                o.onMonth?.(y, mm);
            }
            else {
                m = mm;
                zoom = 'days';
                draw();
            } }, o.note);
        }
        else
            grid = yearsGrid(y, selY, (yy) => { y = yy; zoom = 'year'; draw(); }, o.yearNote);
        box.replaceChildren(h('div', { class: 'dp-head' }, title, ...stepNav({ small: true, prev: () => step(-1), next: () => step(1),
            today: () => { const t = todayISO(); done(); if (o.onDay)
                o.onDay(t);
            else
                o.onMonth?.(+t.slice(0, 4), +t.slice(5, 7)); } })), grid);
    };
    draw();
    openPop(anchor, box);
}
//# sourceMappingURL=zoomcal.js.map