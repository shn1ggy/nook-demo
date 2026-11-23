// List: compact one-line rows (e.g. the On-Hold list on HOME). Optionally the time of a date property
// before the name ("10:00 Meeting"), and events of other calendars between the entries (an agenda).
import { iconSvg } from '../ui/icons.js';
import { countRoots, matchFilter, nestRows, periodRange, ruleColors, takeRoots } from '../workspace.js';
import { h, COLORS, stepsOf, asDate, compareDateStarts, dayNum, fmtTime, isoFromDay, todayISO } from '../util.js';
import { entryIcon, renderValue, titleEl } from './cells.js';
import { groupBatch, groupHeading, groupOpen, toggleGroupOpen } from './board.js';
import { rowMenu } from './rowmenu.js';
import { gripEl, groupDrop, reorderable, selectable, subOpen, toggleSub } from './rowselect.js';
import { loadMoreBar, newButton } from './view.js';
import { overlaysFor, overlayItems } from '../sync/service.js';
import { overlayDetails } from './calendar.js';
/** the date property a list places things by: the one whose time it shows, else the first date */
function listDateProp(db, view) {
    if (view.timeProp && db.prop(view.timeProp))
        return view.timeProp;
    if (view.dateProp && db.prop(view.dateProp))
        return view.dateProp;
    return db.schema.properties.find((p) => p.type === 'date')?.name;
}
/**
 * Events of the calendars shown in this list, on the days the list covers: the period (if the view has
 * one), else the view's filters on the date property (e.g. "is today"), else the next two weeks.
 */
function listEvents(env, dateProp) {
    const { db, view, state } = env;
    const key = `${db.key}:${view.id}`;
    if (!overlaysFor(key).length)
        return [];
    const today = dayNum(todayISO());
    const range = view.period ? periodRange(view.period, state.offset) : null;
    const dateRules = (view.filter?.mode ?? 'and') === 'and' ? (view.filter?.rules ?? []).filter((r) => !('rules' in r) && r.prop === dateProp) : [];
    const from = range ? dayNum(range.start) : dateRules.length ? today - 400 : today;
    const to = range ? dayNum(range.end) : dateRules.length ? today + 400 : today + 14;
    const items = overlayItems(key, from, to);
    if (!dateRules.length)
        return items;
    const g = { mode: 'and', rules: dateRules };
    return items.filter((x) => {
        const day = isoFromDay(x.s);
        const fake = { id: '', values: { [dateProp]: { start: x.time ? `${day}T${x.time}` : day, end: x.e > x.s ? isoFromDay(x.e) : undefined } }, body: '', created: '', edited: '' };
        return matchFilter(db, fake, g);
    });
}
export function renderList(env, res) {
    const { db, view, ctx } = env;
    const extra = (view.props ?? []).filter((p) => p !== db.titleProp).slice(0, 3);
    const box = h('div', { class: 'list-view' });
    // sub-items: each entry followed by its open sub-items, indented
    const makeTree = (rows) => nestRows(db, rows, (id, ghost) => subOpen(`${db.key}:${id}`, ghost));
    const tree = makeTree(res.rows);
    const info = new Map(tree.map((n) => [n.row.id, n]));
    const rows = tree.map((n) => n.row);
    const treeOf = new Map();
    const hasTree = (m) => { let v = treeOf.get(m); if (v === undefined) {
        v = false;
        for (const n of m.values())
            if (n.kids || n.depth) {
                v = true;
                break;
            }
        treeOf.set(m, v);
    } return v; };
    const lead = (r, rowInfo = info) => {
        if (!db.schema.subItems && !db.schema.files)
            return null;
        // no entry here has sub-items: no empty column in front of the names
        if (!hasTree(rowInfo))
            return null;
        const n = rowInfo.get(r.id), key = `${db.key}:${r.id}`, open = subOpen(key, !!n.ghost);
        return h('span', { class: 'sub-lead' }, h('span', { class: 'sub-indent', style: { width: `${n.depth * 24}px` } }), n.kids ? h('button', { class: 'sub-toggle' + (open ? ' open' : ''), 'aria-label': open ? 'Hide sub-items' : `Show ${n.kids} sub-items`, onclick: (e) => { e.stopPropagation(); toggleSub(key, !!n.ghost); env.redraw(); } }, h('span', { class: 'sub-tri' })) : h('span', { class: 'sub-toggle none' }));
    };
    const lim = env.state.limit || 100;
    if ((env.fullPage || !view.simplified) && view.newAt)
        box.appendChild(newButton(env));
    const shown = takeRoots(tree, 0, lim);
    // the time before the name, and other calendars' events by date
    const tprop = view.timeProp && db.prop(view.timeProp) ? view.timeProp : undefined;
    const sort = view.sorts?.[0];
    const sortDateProp = sort && db.prop(sort.prop)?.type === 'date' ? sort.prop : undefined;
    const dprop = sortDateProp ?? listDateProp(db, view);
    const startOf = (r, prop = dprop) => prop ? asDate(db.value(r, prop))?.start ?? '' : '';
    const events = dprop ? listEvents(env, dprop) : [];
    const evStart = (x) => isoFromDay(x.s) + (x.time ? `T${x.time}` : '');
    // as in the calendar: a time only where there is one
    const timeEl = (t) => tprop && t ? h('span', { class: 'lt-time' }, fmtTime(t)) : null;
    // a colour rule wins, else the option colour of "Color entries by"
    const tintOf = (r) => { const cv = view.colorBy ? db.value(r, view.colorBy) : null; return ruleColors(db, view, r).row ?? (typeof cv === 'string' && cv ? db.optionColor(view.colorBy, cv) : undefined); };
    const dotEl = (r) => { const c = tintOf(r); return h('span', { class: 'dot', style: { background: (c && c !== 'default' ? COLORS[c]?.text : undefined) ?? COLORS.gray.text } }); };
    const entryEl = (r, rowInfo = info, gkey) => {
        const grip = gripEl();
        const s = tprop ? startOf(r, tprop) : '';
        const el = h('div', { class: 'list-row' + (rowInfo.get(r.id)?.ghost ? ' ghost-row' : ''), role: 'button', tabindex: 0, oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); rowMenu(ctx, db, r, { x: e.clientX, y: e.clientY }, () => env.redraw()); } }, grip, lead(r, rowInfo), 
        // with the time shown: the entry's own icon, else a dot in its colour (as in the calendar), then the time as plain text
        tprop ? (r.icon && !view.hideIcons ? entryIcon(r, 15) : dotEl(r)) : null, timeEl(s.length > 10 ? s.slice(11, 16) : ''), !tprop && !view.hideIcons ? entryIcon(r, 15) : null, titleEl(db, r, 'lt'), extra.map((p) => { const v = db.value(r, p); return v == null || v === '' ? null : h('span', { class: 'muted small' }, renderValue(db, db.prop(p), v)); }));
        const tint = tintOf(r);
        // the same shade as the entry on a calendar
        if (tint && tint !== 'default') {
            const st = stepsOf(tint);
            el.style.setProperty('--ev-soft', st.soft);
            el.style.setProperty('--ev-strong', st.strong);
            el.classList.add('tinted');
        }
        selectable(el, env, r);
        // with a mouse the whole row can be dragged (into another view of the database too, e.g. onto a calendar day); touch keeps the grip
        reorderable(el, env, r, { handle: document.documentElement.classList.contains('touch') ? grip : undefined, nest: true, onDropExtra: groupDrop(env, gkey) });
        return el;
    };
    // an event of another calendar: shown, not editable; click for details
    const eventEl = (x) => {
        const el = h('div', { class: 'list-row ext-row', tabindex: 0, title: `${x.ev.title || 'Busy'} · ${x.sub.name} (view only)` }, tprop ? h('span', { class: 'dot', style: { background: x.sub.color || '#8a8a8a' } }) : null, timeEl(x.time), h('span', { class: 'lt' }, x.ev.icon ? h('span', { class: 'ev-ico' }, iconSvg(x.ev.icon, 13)) : null, x.ev.title || 'Busy'), h('span', { class: 'muted small ext-cal' }, h('span', { class: 'ext-dot', style: { background: x.sub.color || '#8a8a8a' } }), x.sub.name));
        // coloured like the entries are (by property or rules): in the calendar's own colour
        if (view.colorBy || view.colorRules?.length)
            el.style.setProperty('background', `color-mix(in srgb, ${x.sub.color || '#8a8a8a'} 16%, transparent)`);
        el.addEventListener('click', (e) => { e.stopPropagation(); overlayDetails(el, x, env); });
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
            e.preventDefault();
            overlayDetails(el, x, env);
        } });
        return el;
    };
    // Merge external events by the primary date sort, independently of the displayed time property.
    const byDate = !!sortDateProp;
    const desc = sort?.dir === 'desc';
    const evs = events.slice().sort((a, b) => compareDateStarts(evStart(a), evStart(b), desc ? 'desc' : 'asc'));
    if (res.groups) {
        for (const g of res.groups) {
            const key = JSON.stringify([db.key, view.id, view.groupBy.prop, g.key]);
            const open = groupOpen(env, g.key);
            const toggle = () => toggleGroupOpen(env, g.key);
            box.appendChild(h('div', { class: 'list-group-head', onclick: toggle }, ...groupHeading(env, g.key, g.rows.length, open, toggle)));
            if (!open)
                continue;
            // Nest within each group, as in tables; multi-select entries may belong to several groups.
            const groupTree = makeTree(g.rows);
            const groupInfo = new Map(groupTree.map(n => [n.row.id, n]));
            const batch = groupBatch(env, key, groupTree);
            for (const n of batch.items)
                box.appendChild(entryEl(n.row, groupInfo, g.key));
            if (batch.more)
                box.appendChild(h('div', { class: 'list-group-more' }, batch.more));
        }
        // External events do not have this database's grouping property; show them once, separately.
        if (evs.length) {
            box.appendChild(h('div', { class: 'list-group-head muted' }, 'External calendars'));
            for (const ev of evs)
                box.appendChild(eventEl(ev));
        }
    }
    else {
        let ei = 0;
        for (const n of shown.items) {
            if (byDate && n.depth === 0) {
                const s = startOf(n.row);
                // Date-only and undated entries follow timed events, just as in query().
                while (ei < evs.length && compareDateStarts(evStart(evs[ei]), s, desc ? 'desc' : 'asc') < 0)
                    box.appendChild(eventEl(evs[ei++]));
            }
            box.appendChild(entryEl(n.row));
        }
        if (shown.end >= tree.length)
            while (ei < evs.length)
                box.appendChild(eventEl(evs[ei++]));
        if (shown.end < tree.length)
            box.appendChild(loadMoreBar(env, countRoots(tree), lim));
    }
    if (!res.groups?.length && !rows.length && !evs.length)
        box.appendChild(h('div', { class: 'muted small', style: { padding: '4px 6px' } }, 'No entries.'));
    if ((env.fullPage || !view.simplified) && view.newAt !== 'top')
        box.appendChild(newButton(env));
    return box;
}
//# sourceMappingURL=list.js.map