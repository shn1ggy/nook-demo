// Shared behaviour for entries shown in views (calendar events, board cards, list rows, table rows):
// click selects (⇧/⌘-click adds), double-click or Enter opens, Delete/Backspace deletes
// (undoable), and drag-and-drop sets a manual order when the view has no sort.
import { rowTarget } from '../links.js';
import { addDays, asDate, dayNum, h, svgIcon, ICONS } from '../util.js';
import { isTyping } from '../ui/commands.js';
import { closePop, menu, toast } from '../ui/pop.js';
/** sub-items shown open in tables ("db:rowId"), for this session */
export const openSubItems = new Set();
/** dimmed parents (shown because of their sub-items) are open unless closed here */
const closedSubItems = new Set();
/** is this entry's list of sub-items open? */
export const subOpen = (key, ghost) => (ghost ? !closedSubItems.has(key) : openSubItems.has(key));
export const toggleSub = (key, ghost) => { const set = ghost ? closedSubItems : openSubItems; if (set.has(key))
    set.delete(key);
else
    set.add(key); };
let sel = null;
const envOf = new WeakMap();
/** The same database can be rendered more than once, even with the same saved view. */
const sameViewInstance = (a, b) => a === b ||
    (!!a.selectionRoot && a.selectionRoot === b.selectionRoot && a.db === b.db && a.view.id === b.view.id);
export const isRowSelected = (env, key) => !!sel && sameViewInstance(sel.env, env) && sel.ids.has(key);
const selectionElement = (el) => el.closest('tr.row') ?? el;
/** after Esc: where the selection was, so arrows continue there (a second Esc goes back to the days) */
let parked = null;
/** Select one entry element (as a plain click would) and give it the keyboard focus. */
export function selectElement(el) {
    const env = envOf.get(el);
    const key = el.dataset.row;
    if (!env || !key)
        return;
    parked = null;
    sel = { env, ids: new Set([key]), last: key, anchor: key };
    mark();
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
const visibleEl = (key, env = sel?.env) => [...document.querySelectorAll(`.selectable[data-row="${CSS.escape(key)}"]`)].find((x) => x.offsetParent && env && !!envOf.get(x) && sameViewInstance(envOf.get(x), env));
// ---------- touch: a "Select" mode (there is no ⇧ or ⌘ to hold) ----------
let selectBar = null;
const selecting = () => !!selectBar;
/** leave the "Select" mode (Done, or another page was opened) */
export function endSelectMode() { if (selectBar)
    clearSelection(); }
function updateSelectBar() {
    if (!selectBar)
        return;
    const n = sel?.ids.size ?? 0;
    if (!n) {
        endSelectMode();
        return;
    }
    selectBar.querySelector('.select-count').textContent = `${n} selected`;
}
/** start picking with this entry selected; the bar offers the actions for all picked entries */
export function startSelectMode(key) {
    const el = [...document.querySelectorAll(`.selectable[data-row="${CSS.escape(key)}"]`)].find((x) => x.offsetParent && envOf.get(x));
    const env = el && envOf.get(el);
    if (!el || !env)
        return;
    sel = { env, ids: new Set([key]), last: key, anchor: key };
    mark();
    selectBar?.remove();
    const actions = h('button', { class: 'select-act', onclick: () => {
            const first = sel && visibleEl(sel.last && sel.ids.has(sel.last) ? sel.last : [...sel.ids][0]);
            const r = first?.getBoundingClientRect();
            if (first && r)
                first.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10, view: window }));
        } }, 'Actions');
    selectBar = h('div', { class: 'select-bar', role: 'toolbar', 'aria-label': 'Selection' }, h('button', { class: 'select-act', onclick: () => { const one = sel && visibleEl([...sel.ids][0]); if (one && sel) {
            selectAll(one, sel.env);
            updateSelectBar();
        } } }, 'All'), h('span', { class: 'select-count' }, '1 selected'), actions, h('button', { class: 'select-act strong', onclick: endSelectMode }, 'Done'));
    document.body.appendChild(selectBar);
}
function clearSelection() {
    sel = null;
    if (selectBar) {
        selectBar.remove();
        selectBar = null;
    } // nothing selected: picking is over
    document.querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected'));
}
function mark() {
    document.querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected'));
    if (!sel)
        return;
    for (const el of document.querySelectorAll('.selectable')) {
        const env = envOf.get(el);
        if (env && isRowSelected(env, el.dataset.row))
            selectionElement(el).classList.add('is-selected');
    }
}
/** keys are row ids, or "rowId@YYYY-MM-DD" for one occurrence of a repeating entry */
const rowIdOf = (key) => key.split('@')[0];
export function selectedRows() {
    if (!sel || !sel.ids.size)
        return null;
    const ids = new Set([...sel.ids].map(rowIdOf));
    const rows = sel.env.db.rows.filter((r) => ids.has(r.id));
    return rows.length ? { env: sel.env, rows } : null;
}
/**
 * Ctrl/⌘+A in a view: first the entries of the column / group the selection is in (a board column,
 * a calendar's "N more" list), pressed again all entries of the view.
 */
export function selectAll(from, env) {
    const view = from.closest('.dbview') ?? from.closest('.more-pop');
    if (!view)
        return false;
    const keysIn = (scope) => [...new Set([...scope.querySelectorAll('.selectable')].filter((x) => x.offsetParent).map((x) => x.dataset.row))];
    const group = from.closest('.bcol, .more-pop');
    const cur = sel && sameViewInstance(sel.env, env) ? sel.ids : new Set();
    const covers = (keys) => keys.length > 0 && keys.every((k) => cur.has(k));
    let keys = group ? keysIn(group) : keysIn(view);
    if (group && covers(keys))
        keys = keysIn(view);
    if (!keys.length)
        return false;
    sel = { env, ids: new Set(keys), last: sel?.last && keys.includes(sel.last) ? sel.last : keys[0], anchor: sel?.anchor && keys.includes(sel.anchor) ? sel.anchor : keys[0] };
    mark();
    return true;
}
export async function deleteSelected() {
    const s = selectedRows();
    if (!s)
        return;
    const { env } = s;
    const keys = [...sel.ids];
    env.ctx.ws.boundary();
    let deleted = 0, skipped = 0;
    for (const key of keys) {
        const row = env.db.rows.find((r) => r.id === rowIdOf(key));
        if (!row)
            continue;
        const occ = key.split('@')[1];
        if (occ && row.repeat) {
            await skipOccurrence(env, row, occ);
            skipped++;
        }
        else {
            await env.ctx.ws.deleteRow(env.db, row);
            deleted++;
        }
    }
    clearSelection();
    env.redraw();
    const what = [deleted ? `Deleted ${deleted === 1 ? '1 entry' : deleted + ' entries'}` : '', skipped ? `Skipped ${skipped === 1 ? '1 occurrence' : skipped + ' occurrences'}` : ''].filter(Boolean).join(', ');
    toast(`${what} · ${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'}Z to undo`);
}
const openOf = new WeakMap();
/** Settings → General → "Open entries with" */
let openWith = 'double';
export function setOpenWith(m) { openWith = m ?? 'double'; }
/** Open the selected entry (the last one clicked or moved to) – like Enter or a double-click. */
export function openSelected() {
    if (!sel || !sel.ids.size)
        return false;
    const key = sel.last && sel.ids.has(sel.last) ? sel.last : [...sel.ids][0];
    const el = visibleEl(key);
    const open = el && openOf.get(el);
    if (!open)
        return false;
    clearSelection();
    open();
    return true;
}
/** Make an element represent `row`: selection, open, delete. `open` defaults to opening the entry page. */
export function selectable(el, env, row, open, key = row.id) {
    el.dataset.row = key;
    el.classList.add('selectable');
    envOf.set(el, env);
    if (sel && sameViewInstance(sel.env, env)) {
        sel.env = env;
        if (sel.ids.has(key))
            selectionElement(el).classList.add('is-selected');
    }
    const doOpen = open ?? (() => env.ctx.openRow(env.db, row));
    openOf.set(el, doOpen);
    // middle-click: the entry in a new tab (⌘-click selects here, so only the middle button)
    if (!open) {
        el.addEventListener('mousedown', (e) => { if (e.button === 1)
            e.preventDefault(); });
        el.addEventListener('auxclick', (e) => {
            if (e.button !== 1 || e.target.closest('a, input'))
                return;
            const u = env.ctx.pageUrl?.(rowTarget(env.db.key, row.id));
            if (u) {
                e.preventDefault();
                e.stopPropagation();
                window.open(u, '_blank');
            }
        });
    }
    el.addEventListener('click', (e) => {
        if (e.target.closest('button, a, input, .cb'))
            return;
        e.stopPropagation();
        // single-click mode: a plain click opens the entry (⇧ / ⌘ still select)
        // (on a touch screen a tap always opens: there is no double-click)
        // "Select" on a touch screen: taps add to or take from the selection until Done
        const picking = selecting();
        if (!picking && (openWith === 'single' || matchMedia('(pointer: coarse)').matches) && !el.closest('table') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
            clearSelection();
            doOpen();
            return;
        }
        const toggle = e.metaKey || e.ctrlKey || picking;
        const same = !!sel && sameViewInstance(sel.env, env);
        if (e.shiftKey && same && sel.last) {
            // ⇧-click: everything between the last clicked entry and this one, in the order shown
            // inside a calendar's "N more" list only the entries of that list count
            const scope = el.closest('.more-pop') ?? el.closest('.dbview') ?? document;
            const all = visualOrder([...scope.querySelectorAll('.selectable')].filter((x) => x.offsetParent)).map((x) => x.dataset.row);
            const keys = [...new Set(all)];
            const a = keys.indexOf(sel.anchor ?? sel.last), b = keys.indexOf(key);
            if (a >= 0 && b >= 0) {
                sel.ids = new Set(keys.slice(Math.min(a, b), Math.max(a, b) + 1));
                sel.last = key;
                mark();
                el.focus({ preventScroll: true });
                return;
            }
        }
        if (!same || !toggle)
            sel = { env, ids: new Set() };
        if (toggle && sel.ids.has(key))
            sel.ids.delete(key);
        else
            sel.ids.add(key);
        sel.last = key;
        sel.anchor = key;
        mark();
        if (picking) {
            updateSelectBar();
            return;
        }
        el.focus({ preventScroll: true });
    });
    el.addEventListener('dblclick', (e) => { e.stopPropagation(); if (openWith === 'single')
        return; clearSelection(); doOpen(); });
    el.addEventListener('keydown', (e) => {
        // a database of files: Enter renames (as F2 does), double-click opens
        if (e.key === 'Enter' && env.db.schema.files) {
            e.preventDefault();
            e.stopPropagation();
            renameAt(el);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            clearSelection();
            doOpen();
        }
    });
}
let installed = false;
export function installSelectionKeys() {
    if (installed)
        return;
    installed = true;
    document.addEventListener('keydown', (e) => {
        if (isTyping(e.target) || document.querySelector('.overlay'))
            return;
        // a popover is open: only a list of entries in it (a calendar's "N more") takes the keys
        const inList = document.activeElement?.closest?.('.more-pop');
        if (document.querySelector('.pop:not(.pop-closing)') && !inList)
            return;
        // nothing selected, but Esc was just pressed on a selection: arrows pick up there again,
        // a second Esc goes back to the calendar day of that entry
        if ((!sel || !sel.ids.size) && parked) {
            const el = visibleEl(parked.key, parked.env);
            if (!el) {
                parked = null;
                return;
            }
            if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                e.stopPropagation();
                selectElement(el);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                parked = null;
                el.closest('.cal-wrap')?.dispatchEvent(new CustomEvent('nook-return-to-day', { detail: el }));
                return;
            }
            return;
        }
        if (!sel || !sel.ids.size)
            return;
        // calendar: Tab (or ⇧Tab) on a selected entry goes back to navigating the days
        if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const el = sel.last ? visibleEl(sel.last) : null;
            const wrap = el?.closest('.cal-wrap');
            if (el && wrap) {
                e.preventDefault();
                e.stopPropagation();
                clearSelection();
                parked = null;
                wrap.dispatchEvent(new CustomEvent('nook-return-to-day', { detail: el }));
                return;
            }
        }
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
            const el = sel.last ? (inList ? inList.querySelector(`.selectable[data-row="${CSS.escape(sel.last)}"]`) : visibleEl(sel.last)) : null;
            if (el && selectAll(el, sel.env)) {
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }
        // a database of files: F2 or Enter renames the selected file or folder (Windows and Mac)
        if ((e.key === 'F2' || e.key === 'Enter') && sel.env.db.schema.files && sel.ids.size === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const el = visibleEl([...sel.ids][0]);
            if (el) {
                e.preventDefault();
                e.stopPropagation();
                renameAt(el);
            }
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            e.stopPropagation();
            if (inList)
                closePop();
            deleteSelected();
        }
        else if (e.key === 'Escape') {
            if (selecting())
                return; // closing a menu while picking keeps the picked entries
            e.preventDefault();
            e.stopPropagation();
            const last = sel.last;
            const env = sel.env;
            // in a month calendar Esc goes straight back to the days (like Tab)
            const el = last ? visibleEl(last) : null;
            const wrap = el?.closest('.cal-wrap');
            if (el && wrap) {
                clearSelection();
                parked = null;
                wrap.dispatchEvent(new CustomEvent('nook-return-to-day', { detail: el }));
                return;
            }
            clearSelection();
            if (last && visibleEl(last, env))
                parked = { key: last, env };
        }
        else if (e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey && !e.altKey) {
            if (moveSelection(e.key, e.shiftKey)) {
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }, true);
    document.addEventListener('mousedown', (e) => {
        if (!e.target.closest('.pop, .overlay'))
            parked = null;
        if (!sel)
            return;
        const t = e.target;
        if (t.closest('[data-row], .pop, .overlay, .select-bar'))
            return;
        if (selecting())
            return; // picking on a touch screen ends with Done
        clearSelection();
    });
}
/** Duplicate the selected entries as they are (same name, values, page content); the copies get selected. */
export async function duplicateSelected() {
    const s = selectedRows();
    if (!s)
        return 0;
    const { env, rows } = s;
    env.ctx.ws.boundary();
    const copies = [];
    for (const r of rows) {
        const c = await env.ctx.ws.addRow(env.db, structuredClone(r.values));
        if (r.body || r.icon || r.repeat) {
            c.body = r.body;
            if (r.icon)
                c.icon = r.icon;
            if (r.repeat) {
                c.repeat = r.repeat;
                c.except = r.except ? [...r.except] : undefined;
            }
            await env.ctx.ws.saveRow(env.db, c);
        }
        copies.push(c);
    }
    sel = { env, ids: new Set(copies.map((c) => c.id)), last: copies[copies.length - 1]?.id, anchor: copies[0]?.id };
    env.ctx.ws.emit();
    requestAnimationFrame(mark);
    toast(`Duplicated ${copies.length === 1 ? '1 entry' : copies.length + ' entries'}`);
    return copies.length;
}
/**
 * Entries in the order you read them: in a calendar day by day (week, weekday, top to bottom),
 * elsewhere as laid out (lists and tables top to bottom, boards column by column).
 */
function visualOrder(els) {
    if (!els.some((e) => e.closest('.cal-week')))
        return els;
    const key = (e) => {
        const week = e.closest('.cal-week');
        if (!week)
            return [Infinity, 0, 0];
        const w = [...week.parentElement.children].indexOf(week);
        const wr = week.getBoundingClientRect(), r = e.getBoundingClientRect();
        const col = Math.floor(((r.left + 2 - wr.left) / wr.width) * 7);
        return [w, col, r.top];
    };
    const keyed = els.map((e) => ({ e, k: key(e) }));
    keyed.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2]);
    return keyed.map((x) => x.e);
}
/** Move the selection to the nearest entry in that direction within the same view (⇧ extends it). */
function moveSelection(dir, extend) {
    if (!sel?.last)
        return false;
    const cur = visibleEl(sel.last);
    const scope = cur?.closest('.dbview');
    if (!cur || !scope)
        return false;
    const c = cur.getBoundingClientRect();
    const cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    let best = null, score = Infinity;
    for (const el of scope.querySelectorAll('.selectable')) {
        if (el === cur || !el.offsetParent || el.dataset.row === sel.last)
            continue;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const dx = x - cx, dy = y - cy;
        const along = dir === 'ArrowDown' ? dy : dir === 'ArrowUp' ? -dy : dir === 'ArrowRight' ? dx : -dx;
        const across = dir === 'ArrowDown' || dir === 'ArrowUp' ? Math.abs(dx) : Math.abs(dy);
        if (along < 4)
            continue;
        const s = along + across * 2.5;
        if (s < score) {
            score = s;
            best = el;
        }
    }
    if (!best)
        return true; // at the edge: keep the selection, swallow the key
    const key = best.dataset.row;
    const env = envOf.get(best) ?? sel.env;
    if (!extend || !sameViewInstance(sel.env, env))
        sel = { env, ids: new Set(), anchor: key };
    sel.ids.add(key);
    sel.last = key;
    mark();
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
}
// ---------- repeating entries ----------
/** Leave one date out of a repeating entry. */
export async function skipOccurrence(env, row, occ) {
    row.except = [...new Set([...(row.except ?? []), occ])].sort();
    await env.ctx.ws.saveRow(env.db, row);
}
/** Turn one occurrence into its own entry (optionally on another day); the series skips that date. */
export async function detachOccurrence(env, row, occ, dateProp, toDay = occ) {
    const d = asDate(row.values[dateProp]);
    const values = structuredClone(row.values);
    if (d) {
        const shift = dayNum(toDay) - dayNum(d.start.slice(0, 10));
        values[dateProp] = { start: toDay + d.start.slice(10), ...(d.end ? { end: addDays(d.end.slice(0, 10), shift) + d.end.slice(10) } : {}) };
    }
    env.ctx.ws.boundary();
    const copy = await env.ctx.ws.addRow(env.db, values);
    if (row.body) {
        copy.body = row.body;
        await env.ctx.ws.saveRow(env.db, copy);
    }
    await skipOccurrence(env, row, occ);
    return copy;
}
// ---------- dragging several entries, Alt = copy ----------
/** the entries a drag carries (keys: row id or "id@date"): the whole selection when the dragged one is part of it */
export function dragKeys(env, key) {
    if (sel && sameViewInstance(sel.env, env) && sel.ids.has(key) && sel.ids.size > 1)
        return [...sel.ids];
    return [key];
}
export function dragRows(env, row) {
    const keys = dragKeys(env, row.id);
    const ids = new Set(keys.map(rowIdOf));
    const rows = env.db.rows.filter((r) => ids.has(r.id));
    return rows.length ? rows : [row];
}
/** Alt (Option on a Mac) held while dropping: copy instead of move */
export const isCopyDrop = (e) => e.altKey;
/** for the drag cursor: a copy while Alt is held */
export function dropEffect(e) { if (e.dataTransfer)
    e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'; }
/** a date moved by whole days and (timed dates only) minutes */
function shiftDate(d, days, minutes = 0) {
    const one = (v) => {
        if (v.length <= 10 || !minutes)
            return addDays(v.slice(0, 10), days) + v.slice(10);
        const [hh, mm] = v.slice(11, 16).split(':').map(Number);
        let t = hh * 60 + mm + minutes, extra = 0;
        while (t < 0) {
            t += 1440;
            extra--;
        }
        while (t >= 1440) {
            t -= 1440;
            extra++;
        }
        return `${addDays(v.slice(0, 10), days + extra)}T${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    };
    return { ...d, start: one(d.start), ...(d.end ? { end: one(d.end) } : {}) };
}
/**
 * Moves (or, with `copy`, copies) entries in time: by whole days, timed ones also by minutes.
 * One date of a repeating entry moves (or is copied) on its own; `exact` gives one key an exact new date.
 */
export async function shiftEntries(env, keys, dateProp, days, opts = {}) {
    const ws = env.ctx.ws, db = env.db;
    ws.boundary();
    for (const key of keys) {
        const [id, occ] = key.split('@');
        const row = db.rows.find((r) => r.id === id);
        const d = row && asDate(row.values[dateProp]);
        if (!row || !d)
            continue;
        const exact = opts.exact?.key === key ? opts.exact.date : undefined;
        if (occ && row.repeat) {
            // that one date: as a single entry of its own
            const from = { start: occ + d.start.slice(10), ...(d.end ? { end: addDays(d.end.slice(0, 10), dayNum(occ) - dayNum(d.start.slice(0, 10))) + d.end.slice(10) } : {}) };
            const next = exact ?? shiftDate(from, days, opts.minutes);
            if (opts.copy) {
                const c = await ws.duplicateRow(db, row, { ...structuredClone(row.values), [dateProp]: next });
                delete c.repeat;
                delete c.except;
                await ws.saveRow(db, c);
            }
            else {
                const c = await detachOccurrence(env, row, occ, dateProp);
                c.values[dateProp] = next;
                await ws.saveRow(db, c);
            }
            continue;
        }
        const next = exact ?? shiftDate(d, days, opts.minutes);
        if (opts.copy)
            await ws.duplicateRow(db, row, { ...structuredClone(row.values), [dateProp]: next });
        else {
            row.values[dateProp] = next;
            if (row.except && days)
                row.except = row.except.map((x) => addDays(x, days));
            await ws.saveRow(db, row);
        }
    }
}
// ---------- manual order ----------
/** Current manual order of all rows for a view (ids), starting from the saved order. */
function baseOrder(env) {
    const ids = env.db.rows.map((r) => r.id);
    const known = new Set(ids);
    const saved = (env.view.order ?? []).filter((id) => known.has(id));
    const seen = new Set(saved);
    return [...saved, ...ids.filter((id) => !seen.has(id))];
}
async function moveRow(env, ids, target, before) {
    const base = baseOrder(env);
    // several entries keep the order they had
    ids = [...ids].sort((a, b) => base.indexOf(a) - base.indexOf(b));
    const order = base.filter((x) => !ids.includes(x) || x === target);
    if (ids.includes(target)) {
        const t = order.indexOf(target);
        order.splice(t, 1);
        ids = ids.filter((x) => x !== target);
        const at = Math.min(t, order.length);
        order.splice(at, 0, ...[target, ...ids].sort((a, b) => base.indexOf(a) - base.indexOf(b)));
    }
    else {
        let i = order.indexOf(target);
        if (i < 0)
            i = order.length;
        else if (!before)
            i++;
        order.splice(i, 0, ...ids);
    }
    env.view.order = order;
    env.ctx.ws.boundary();
    await env.saveView();
    env.redraw();
}
/** dropped on an entry of another group (grouped by a select): the dragged entry moves into that group */
export function groupDrop(env, key) {
    const gp = env.view.groupBy?.prop;
    const p = gp ? env.db.prop(gp) : undefined;
    if (key === undefined || !gp || !p || p.type !== 'select')
        return undefined;
    return async (dragged) => {
        if ((env.db.value(dragged, gp) ?? '') === key)
            return;
        env.ctx.ws.boundary();
        if (key)
            dragged.values[gp] = key;
        else
            delete dragged.values[gp];
        await env.ctx.ws.saveRow(env.db, dragged);
    };
}
/**
 * Drag to reorder. `axis` decides whether the drop indicator is above/below or left/right.
 * `onDropExtra` runs before reordering (e.g. a board card moved to another column).
 */
export function reorderable(el, env, row, opts = {}) {
    const grip = opts.handle ?? el;
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/x-nook-row', row.id);
        e.dataTransfer.setData(`text/x-nook-db-${env.db.key}`, '1');
        e.dataTransfer.effectAllowed = 'copyMove';
        // all selected entries go along (e.g. onto a calendar day of another view)
        e.dataTransfer.setData('text/x-nook-rows', JSON.stringify(dragRows(env, row).map((r) => r.id)));
        const n = dragKeys(env, row.id).length;
        if (n > 1) {
            const ghost = h('div', { class: 'drag-ghost' }, `${n} entries`);
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, 10, 10);
            setTimeout(() => ghost.remove());
        }
        else if (grip !== el)
            e.dataTransfer.setDragImage(el, 12, 12);
        requestAnimationFrame(() => el.classList.add('dragging'));
    });
    grip.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes(`text/x-nook-db-${env.db.key}`))
            return;
        e.preventDefault();
        e.stopPropagation();
        dropEffect(e);
        const b = el.getBoundingClientRect();
        const into = !!opts.nest && !!env.db.schema.subItems && e.clientY > b.top + b.height * 0.25 && e.clientY < b.bottom - b.height * 0.25;
        const before = !into && e.clientY < b.top + b.height / 2;
        el.classList.toggle('drop-into', into);
        el.classList.toggle('drop-before', before);
        el.classList.toggle('drop-after', !into && !before);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after', 'drop-into'));
    el.addEventListener('drop', async (e) => {
        const before = el.classList.contains('drop-before');
        const into = el.classList.contains('drop-into');
        el.classList.remove('drop-before', 'drop-after', 'drop-into');
        const id = e.dataTransfer?.getData('text/x-nook-row');
        if (!id || !e.dataTransfer?.types.includes(`text/x-nook-db-${env.db.key}`))
            return;
        e.preventDefault();
        e.stopPropagation();
        const dragged = env.db.rows.find((r) => r.id === id);
        if (!dragged)
            return;
        // the whole selection goes along; with Alt the entries are copied
        let rows = dragRows(env, dragged);
        if (isCopyDrop(e)) {
            env.ctx.ws.boundary();
            const copies = [];
            for (const r of rows)
                copies.push(await env.ctx.ws.duplicateRow(env.db, r));
            rows = copies;
        }
        // onto the entry: they become its sub-items (never an entry under itself or under one of its own sub-items)
        const si = env.db.schema.subItems;
        if (into && si) {
            const ws = env.ctx.ws;
            const under = (x, anc) => { for (let y = x, n = 0; y && n < 50; y = ws.parentOf(env.db, y), n++)
                if (y.id === anc.id)
                    return true; return false; };
            ws.boundary();
            for (const r of rows)
                if (r.id !== row.id && !under(row, r))
                    await ws.setRelation(env.db, r, si.parent, [row.id]);
            openSubItems.add(`${env.db.key}:${row.id}`);
            env.redraw();
            return;
        }
        // above / below an entry: the dragged ones go to that entry's level (out of or into a parent)
        if (opts.nest && si) {
            const ws = env.ctx.ws;
            const target = ws.parentOf(env.db, row);
            const under = (x, anc) => { for (let y = x, n = 0; y && n < 50; y = ws.parentOf(env.db, y), n++)
                if (y.id === anc.id)
                    return true; return false; };
            for (const r of rows) {
                if (ws.parentOf(env.db, r)?.id === target?.id || (target && under(target, r)))
                    continue;
                ws.boundary();
                await ws.setRelation(env.db, r, si.parent, target ? [target.id] : []);
            }
        }
        if (opts.onDropExtra)
            for (const r of rows)
                await opts.onDropExtra(r);
        const ids = rows.map((r) => r.id);
        if (ids.length === 1 && ids[0] === row.id) {
            env.redraw();
            return;
        }
        if (env.view.sorts?.length) {
            // as in Notion: a sorted view has no manual order — offer to drop the sort
            const names = env.view.sorts.map((s) => s.prop).join(', ');
            menu({ x: e.clientX, y: e.clientY }, [
                { section: `Sorted by ${names}` },
                { label: 'Remove sort and keep this position', run: async () => { env.view.sorts = []; await moveRow(env, ids, row.id, before); } },
                { label: 'Cancel', run: () => env.redraw() },
            ]);
            return;
        }
        await moveRow(env, ids, row.id, before);
    });
}
/** small grip shown on hover, used where the whole element can't be the drag handle */
export function gripEl() {
    return h('span', { class: 'row-grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, svgIcon(ICONS.grip, 14, { fill: true }));
}
/** start renaming the entry an element shows (its name cell in a table, else the element itself) */
export function renameAt(el) {
    const t = el.closest('tr')?.querySelector('td.title') ?? el;
    t.dispatchEvent(new CustomEvent('nook-rename', { bubbles: true }));
}
//# sourceMappingURL=rowselect.js.map