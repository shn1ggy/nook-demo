import { confirmReminder } from './confirm.js';
import { asDate } from '../util.js';
import { occurrences, parseRRule } from '../recur.js';
import { repeatOn, entryTitle } from '../views/cells.js';
import { menu, prompt, toast, menuIcon } from './pop.js';
import { h } from '../util.js';
import { iconSvg } from './icons.js';
import { parseWhen, parseBefore, localIso, fromLocalIso, fmtWhen, shortWhen } from '../when.js';
/** minutes before; entries without a time count from 9:00 */
export const REMIND_TIMED = [[0, 'At the time'], [5, '5 minutes before'], [10, '10 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before']];
export const REMIND_DAY = [[0, 'On the day (9:00)'], [1440, '1 day before (9:00)'], [2880, '2 days before (9:00)'], [10080, '1 week before (9:00)']];
const DAY_TIME = '09:00';
function label(m, timed) {
    const k = (timed ? REMIND_TIMED : REMIND_DAY).find(([x]) => x === m)?.[1];
    if (k)
        return k;
    if (m % 1440 === 0)
        return `${m / 1440} days before`;
    if (m % 60 === 0)
        return `${m / 60} hours before`;
    if (m > 60 && m < 1440 * 2) {
        const h = Math.floor(m / 60), mi = m % 60;
        return `${h} h ${mi} min before`;
    }
    return `${m} minutes before`;
}
/** a time of your own, by the clock: "18:00 the day before", "8:00 on the day", "3 days before, 18:00" */
function clockLabel(m, startIso) {
    const start = fromLocalIso(startIso.length > 10 ? startIso.slice(0, 16) : `${startIso.slice(0, 10)}T09:00`);
    const due = new Date(start.getTime() - m * 60_000);
    const days = Math.round((new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() - new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime()) / 864e5);
    const t = localIso(due).slice(11, 16);
    return days === 0 ? `${t} on the day` : days === 1 ? `${t} the day before` : `${days} days before, ${t}`;
}
const labelFor = (m, timed, startIso) => (timed ? REMIND_TIMED : REMIND_DAY).some(([x]) => x === m) || (timed && m < 120) ? label(m, timed) : clockLabel(m, startIso);
const short = (s) => s.replace(' minutes', ' min').replace(' hours', ' h').replace(' hour', ' h').replace(' (9:00)', '');
/** the date property a database's calendar uses (its own reminders go before it) */
export const remindDateProp = (db) => db.views.find((v) => v.type === 'calendar' && v.dateProp)?.dateProp ?? db.schema.properties.find((p) => p.type === 'date')?.name;
/** the reminders that apply before an entry's main date (its own, else the database's, else the workspace default) */
export function remindersOf(ws, row, d, db) {
    if (row.remind === -1)
        return [];
    if (row.remind !== undefined)
        return (Array.isArray(row.remind) ? row.remind : [row.remind]).filter((m) => m >= 0);
    if (!d)
        return [];
    const timed = d.start.length > 10;
    const cfg = db?.schema.reminders;
    const main = db ? remindDateProp(db) : undefined;
    const own = cfg ? (timed ? (main ? cfg.props?.[main] : undefined) : cfg.day ?? (main ? cfg.props?.[main] : undefined)) : undefined;
    const def = own ?? (timed ? ws.settings.remindTimed : ws.settings.remindDay);
    return def !== undefined && def >= 0 ? [def] : [];
}
export function describeRemind(row, d, ws, db) {
    const timed = !!d && d.start.length > 10;
    const list = ws ? remindersOf(ws, row, d, db) : row.remind === undefined || row.remind === -1 ? [] : Array.isArray(row.remind) ? row.remind : [row.remind];
    return list.slice().sort((a, b) => b - a).map((m) => label(m, timed)).join(', ');
}
/** the chip's text: "15 min before", "15 min, 1 day before" */
export function remindChip(ws, db, row, d) {
    const timed = !!d && d.start.length > 10;
    const list = remindersOf(ws, row, d, db).sort((a, b) => a - b);
    const ls = list.map((m) => short(d ? labelFor(m, timed, d.start) : label(m, timed)));
    const before = !ls.length ? '' : ls.length === 1 ? ls[0] : ls.map((x) => x.replace(/ before$/, '')).join(', ') + ' before';
    const now = Date.now();
    const ats = (row.remindAt ?? []).filter((x) => fromLocalIso(x).getTime() > now - 864e5).map((x) => shortWhen(fromLocalIso(x)));
    return [before, ...ats].filter(Boolean).join(' · ');
}
/** quick times from now: in 1 hour, this evening, tomorrow 9:00, next week */
export function quickTimes(now = new Date()) {
    const at = (days, h, m = 0) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
    const out = [['In 1 hour', new Date(now.getTime() + 3600_000)]];
    if (now.getHours() < 18)
        out.push(['This evening (19:00)', at(0, 19)]);
    out.push(['Tomorrow (9:00)', at(1, 9)]);
    out.push(['Next week (Mon 9:00)', at(((8 - now.getDay()) % 7) || 7, 9)]);
    return out;
}
/** the entry's / page's reminders: before its date (toggles) and at times (trash), one "Add a time…" for both */
export function remindMenu(ws, db, row, dateProp, anchor, done) {
    remindersMenu(ws, { row, db }, dateProp, anchor, done);
}
export function remindAtMenu(ws, t, anchor, done) {
    remindersMenu(ws, t, 'row' in t ? remindDateProp(t.db) : undefined, anchor, done);
}
function remindersMenu(ws, t, dateProp, anchor, done) {
    const row = 'row' in t ? t.row : null, db = 'row' in t ? t.db : null;
    const d = row && dateProp ? asDate(row.values[dateProp]) : null;
    const timed = !!d && d.start.length > 10;
    const list = timed ? REMIND_TIMED : REMIND_DAY;
    const cur = () => (row && db && d ? remindersOf(ws, row, d, db) : []);
    const ats = () => (row ? row.remindAt : t.page.remindAt) ?? [];
    const persist = async () => { ws.boundary(); if (row && db)
        await ws.saveRow(db, row);
    else
        await ws.savePage(t.page); done(); };
    const setBefore = async (next) => {
        if (!row || !db || !d)
            return;
        const def = remindersOf(ws, { ...row, remind: undefined }, d, db);
        if (next.length === def.length && next.every((m) => def.includes(m)))
            delete row.remind;
        else if (!next.length)
            row.remind = -1;
        else
            row.remind = next.length === 1 ? next[0] : [...new Set(next)].sort((a, b) => b - a);
        await persist();
    };
    const setAts = async (next) => {
        const v = next.length ? [...new Set(next)].sort() : undefined;
        const holder = row ?? t.page;
        if (v)
            holder.remindAt = v;
        else
            delete holder.remindAt;
        await persist();
    };
    const addAt = (dt) => { void setAts([...ats(), localIso(dt)]); confirmReminder('', dt); };
    const timeRow = (x) => {
        const el = h('div', { class: 'pop-item rem-at-row' }, h('span', { class: 'pop-label' }, fmtWhen(fromLocalIso(x))), h('button', { class: 'icon-btn rem-del', title: 'Delete this time', 'aria-label': 'Delete this time', onclick: (e) => { e.stopPropagation(); el.remove(); void setAts(ats().filter((y) => y !== x)); } }, iconSvg('trash', 14)));
        return { el };
    };
    const custom = cur().filter((m) => !list.some(([x]) => x === m));
    const q = quickTimes();
    menu(anchor, [
        ...(d ? [
            { section: 'Before the date' },
            ...list.map(([m, l]) => ({ label: l, toggle: cur().includes(m), onToggle: (on) => { const c = cur().filter((x) => x !== m); void setBefore(on ? [...c, m] : c); } })),
            ...custom.map((m) => ({ label: labelFor(m, timed, d.start), toggle: true, onToggle: (on) => void setBefore(on ? [...cur(), m] : cur().filter((x) => x !== m)) })),
        ] : []),
        { section: 'At a time' },
        ...ats().map(timeRow),
        ...q.map(([l, dt]) => ({ label: l, icon: menuIcon('plus'), run: () => addAt(dt) })),
        'sep',
        { label: 'Other time…', icon: menuIcon('clock'), run: () => prompt(anchor, d ? 'e.g. 45 min · 18:00 the day before · sat 10 · in 2 hours' : 'e.g. sat 10 · tomorrow 18:00 · 23.11. 9:00 · in 2 hours', '', (v) => {
                // "1 day", "18:00 the day before" → before the date; "sat 10", "in 2 hours" → at that time
                const m = d && !/^in /i.test(v.trim()) ? parseBefore(v, d.start) : null;
                if (m != null && m >= 0) {
                    void setBefore([...cur().filter((x) => x !== m), m]);
                    toast(`Reminds ${labelFor(m, timed, d.start)}`);
                    return;
                }
                const dt = parseWhen(v);
                if (dt) {
                    addAt(dt);
                    return;
                }
                toast('Didn’t understand that time – try “45 min”, “sat 10” or “18:00 the day before”');
            }) },
        { label: 'No reminder', run: () => { if (row && d) {
                row.remind = remindersOf(ws, { ...row, remind: undefined }, d, db).length ? -1 : undefined;
                if (row.remind === undefined)
                    delete row.remind;
            } const holder = row ?? t.page; delete holder.remindAt; void persist(); } },
    ]);
}
/** the moment a reminder is due for one date of an entry (ms) */
function dueAt(mins, startIso) {
    return fromLocalIso(startIso.length > 10 ? startIso.slice(0, 16) : `${startIso.slice(0, 10)}T${DAY_TIME}`).getTime() - mins * 60_000;
}
const isOpen = (db, row) => {
    for (const p of db.schema.properties) {
        const v = row.values[p.name];
        if (p.type === 'checkbox' && v === true)
            return false;
        if (p.type === 'select' && typeof v === 'string' && /^(done|erledigt|fertig|abgeschlossen|complete|completed|gemacht)$/i.test(v.trim()))
            return false;
    }
    return true;
};
const INLINE = /\[([^\]]*)\]\(nook:remind:(\d{4}-\d\d-\d\dT\d\d:\d\d)\)/g;
function inlineIn(blocks, out) {
    for (const b of blocks) {
        if (b.text && b.text.includes('nook:remind:'))
            for (const m of b.text.matchAll(INLINE))
                out.push({ at: m[2], text: b.text.replace(INLINE, '').replace(/[*_`~]|\[|\]\([^)]*\)/g, '').trim() });
        if (b.children)
            inlineIn(b.children, out);
    }
}
function next(own, from, to) {
    const first = fromLocalIso(own.at);
    if (!own.repeat)
        return [first.getTime()];
    const out = [];
    const d = new Date(first);
    for (let i = 0; i < 2000 && d.getTime() <= to; i++) {
        if (d.getTime() >= from)
            out.push(d.getTime());
        if (own.repeat === 'daily')
            d.setDate(d.getDate() + 1);
        else if (own.repeat === 'weekly')
            d.setDate(d.getDate() + 7);
        else if (own.repeat === 'monthly')
            d.setMonth(d.getMonth() + 1);
        else
            d.setFullYear(d.getFullYear() + 1);
    }
    return out;
}
/** every reminder due between `from` and `to` (ms), oldest first */
export function remindersBetween(ws, from, to, own = []) {
    const out = [];
    const push = (r) => { if (r.due >= from && r.due <= to)
        out.push(r); };
    for (const db of ws.dbs.values()) {
        const main = remindDateProp(db);
        const cfg = db.schema.reminders;
        for (const row of db.rows) {
            const name = entryTitle(db, row).text || 'Untitled';
            const src = { kind: 'row', db, row };
            if (!cfg?.onlyOpen || isOpen(db, row)) {
                // before the main date (repeating entries: before each of their dates), and before other dates the database names
                const props = new Set([...(main ? [main] : []), ...Object.keys(cfg?.props ?? {})]);
                for (const p of props) {
                    const d = asDate(row.values[p]);
                    if (!d)
                        continue;
                    const mins = p === main ? remindersOf(ws, row, d, db) : [cfg.props[p]].filter((m) => m != null && m >= 0);
                    if (!mins.length)
                        continue;
                    let starts = [d.start];
                    const rule = p === main && repeatOn(db) ? parseRRule(row.repeat) : null;
                    if (rule) {
                        rule.except = row.except;
                        starts = occurrences(d.start, rule, new Date(from - 864e5).toISOString().slice(0, 10), new Date(to + 8 * 864e5).toISOString().slice(0, 10)).map((o) => o + d.start.slice(10));
                    }
                    for (const s of starts)
                        for (const m of mins)
                            push({ key: `${db.key}/${row.id}@${s}/${m}${p === main ? '' : `/${p}`}`, due: dueAt(m, s), title: name, where: p === main ? db.schema.name : `${db.schema.name} · ${p}`, src, start: s, mins: m });
                }
            }
            for (const at of row.remindAt ?? [])
                push({ key: `${db.key}/${row.id}!${at}`, due: fromLocalIso(at).getTime(), title: name, where: db.schema.name, src });
            if (row.body.includes('nook:remind:')) {
                const l = [];
                try {
                    inlineIn(parsePageCached(row.body), l);
                }
                catch { /* unreadable */ }
                for (const x of l)
                    push({ key: `${db.key}/${row.id}~${x.at}~${x.text}`, due: fromLocalIso(x.at).getTime(), title: x.text || name, where: `${name} (in the text)`, src: { kind: 'text', db, row, text: x.text } });
            }
        }
    }
    for (const page of ws.pages.values()) {
        for (const at of page.remindAt ?? [])
            push({ key: `page:${page.id}!${at}`, due: fromLocalIso(at).getTime(), title: page.title || 'Untitled', where: 'Page', src: { kind: 'page', page } });
        const l = [];
        inlineIn(page.blocks, l);
        for (const x of l)
            push({ key: `page:${page.id}~${x.at}~${x.text}`, due: fromLocalIso(x.at).getTime(), title: x.text || page.title, where: `${page.title || 'Untitled'} (in the text)`, src: { kind: 'text', page, text: x.text } });
    }
    for (const o of own)
        for (const t of next(o, from, to))
            push({ key: `own:${o.id}@${localIso(new Date(t))}`, due: t, title: o.text || 'Reminder', where: o.repeat ? `every ${{ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[o.repeat]}` : 'Reminder', src: { kind: 'own', own: o } });
    return out.sort((a, b) => a.due - b.due);
}
// entry text is parsed only when it changed (the check runs every 30 seconds)
import { parsePage } from '../format/page.js';
const pcache = new Map();
function parsePageCached(body) {
    let b = pcache.get(body);
    if (!b) {
        b = parsePage(body);
        if (pcache.size > 300)
            pcache.clear();
        pcache.set(body, b);
    }
    return b;
}
//# sourceMappingURL=reminders.js.map