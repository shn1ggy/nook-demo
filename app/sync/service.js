import { holidayEvents, HOLIDAY_URL } from './holidays.js';
import { parseRRule, occurrences } from '../recur.js';
import { dayNum, openIdb } from '../util.js';
import { loadConfig, saveConfig } from './calsync.js';
import { parseEvents } from './ical.js';
import { browserNet } from './net.js';
const STALE_MS = 15 * 60_000;
class CalendarService {
    ws = null;
    cfg = { subscriptions: [] };
    subs = new Map();
    /** tests set their own */
    net = browserNet;
    timers = [];
    offs = [];
    listeners = new Set();
    onStatus(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    changed() { this.listeners.forEach((f) => f()); }
    gen = 0;
    async attach(ws) {
        this.detach();
        const gen = ++this.gen; // a newer attach (e.g. a quick reload) wins; this one stops after its awaits
        this.ws = ws;
        const cfg = await loadConfig(ws);
        if (gen !== this.gen)
            return;
        this.cfg = cfg;
        // older calendar links showed in every calendar view, also ones made later: they get the list of the
        // views that show them now, so a new calendar view starts without them
        const legacy = cfg.subscriptions.filter((x) => !x.showIn);
        if (legacy.length) {
            const all = calendarViewKeys(ws).filter((k) => { const [d, v] = k.split(':'); return ws.dbs.get(d)?.views.find((x) => x.id === v)?.type === 'calendar'; });
            for (const x of legacy) {
                x.showIn = all.filter((k) => !x.hiddenIn?.includes(k));
                delete x.hiddenIn;
            }
            await saveConfig(ws, cfg).catch(() => { });
        }
        // calendars that were removed leave nothing behind
        for (const id of [...this.subs.keys()])
            if (!cfg.subscriptions.some((s) => s.id === id))
                this.subs.delete(id);
        // the copy kept on this device: shown at once, the fresh version follows
        const kept = await readKept();
        if (gen !== this.gen)
            return;
        for (const sub of cfg.subscriptions) {
            const k = kept[sub.id];
            if (k && !this.subs.get(sub.id)?.events.length && (k.url === sub.url && (k.rules ?? '') === (sub.rules ?? '')))
                this.subs.set(sub.id, { events: k.events, fetched: k.fetched, kept: true });
        }
        this.changed();
        this.ws?.emit();
        if (!cfg.subscriptions.length)
            return;
        this.timers.push(setInterval(() => void this.refreshStale(), STALE_MS));
        const onFocus = () => void this.refreshStale();
        window.addEventListener('focus', onFocus);
        this.offs.push(() => window.removeEventListener('focus', onFocus));
        // they survive a reload of the workspace: only the missing or old ones are fetched
        void this.refreshStale();
    }
    detach() {
        this.timers.forEach(clearInterval);
        this.timers = [];
        this.offs.forEach((f) => f());
        this.offs = [];
    }
    /** after saving settings: reload and restart */
    async reconfigure() { if (this.ws)
        await this.attach(this.ws); }
    isStale(sub) {
        const st = this.subs.get(sub.id);
        return !st?.fetched || !!st.error || !!st.kept || Date.now() - new Date(st.fetched + 'Z').getTime() > STALE_MS - 5000;
    }
    async refreshStale() { await Promise.all(this.cfg.subscriptions.filter((s) => this.isStale(s) && !this.subs.get(s.id)?.running).map((s) => this.refreshSub(s))); }
    async refreshSubs() { await Promise.all(this.cfg.subscriptions.map((s) => this.refreshSub(s))); }
    /** loads one calendar; a load already under way for it is joined, not started twice
     *  (two requests at once to the same link can make the server refuse one) */
    loading = new Map();
    refreshSub(sub) {
        let p = this.loading.get(sub.id);
        if (!p) {
            p = this.loadSub(sub).finally(() => this.loading.delete(sub.id));
            this.loading.set(sub.id, p);
        }
        return p;
    }
    async loadSub(sub) {
        // a database calendar is read live when drawn – nothing to fetch
        if (sub.url === 'nook:db') {
            this.subs.set(sub.id, { events: [], fetched: new Date().toISOString().slice(0, 19) });
            return;
        }
        const cur = this.subs.get(sub.id) ?? { events: [] };
        cur.running = true;
        this.subs.set(sub.id, cur);
        this.changed();
        try {
            cur.events = await this.fromLink(sub);
            cur.fetched = new Date().toISOString().slice(0, 19);
            cur.error = undefined;
            cur.kept = false;
            void keep(sub, cur);
        }
        catch (e) {
            cur.error = e.message || String(e);
        }
        cur.running = false;
        this.changed();
        this.ws?.emit();
    }
    async fromLink(sub) {
        if (sub.url === HOLIDAY_URL)
            return holidayEvents(sub.rules ?? '', sub.id);
        let url = sub.url.replace(/^webcal:/i, 'https:');
        let r = await this.net({ method: 'GET', url });
        // a link that moved (the local server hands redirects back instead of following them)
        for (let hop = 0; hop < 5 && [301, 302, 303, 307, 308].includes(r.status) && r.headers.location; hop++) {
            url = new URL(r.headers.location, url).toString();
            r = await this.net({ method: 'GET', url });
        }
        if (r.status === 401 || r.status === 403)
            throw new Error('The calendar link needs a login or is no longer valid.');
        if (r.status >= 300)
            throw new Error(`The calendar link answered ${r.status}.`);
        if (!/BEGIN:VCALENDAR/i.test(r.body))
            throw new Error('This link is not a calendar (.ics).');
        return parseEvents(r.body);
    }
}
export const calendars = new CalendarService();
const keptDb = () => openIdb('nook-calendars', 1, ['kept']);
async function readKept() {
    try {
        const db = await keptDb();
        return await new Promise((ok) => { const q = db.transaction('kept').objectStore('kept').get('all'); q.onsuccess = () => ok(q.result ?? {}); q.onerror = () => ok({}); });
    }
    catch {
        return {};
    }
}
async function keep(sub, st) {
    try {
        const all = await readKept();
        all[sub.id] = { url: sub.url, rules: sub.rules, fetched: st.fetched, events: st.events };
        for (const id of Object.keys(all))
            if (!calendars.cfg.subscriptions.some((s) => s.id === id))
                delete all[id];
        const db = await keptDb();
        await new Promise((ok) => { const t = db.transaction('kept', 'readwrite'); t.objectStore('kept').put(all, 'all'); t.oncomplete = () => ok(); t.onerror = () => ok(); });
    }
    catch { /* only for speed */ }
}
/** every calendar and list view of the workspace: key "db:view" and a label "Database · View" */
export function calendarViews(ws) {
    const out = [];
    for (const db of [...ws.dbs.values()].sort((a, b) => a.schema.name.localeCompare(b.schema.name)))
        // calendar views, and list views (an agenda: events between the entries)
        for (const v of db.views)
            if (v.type === 'calendar' || v.type === 'list')
                out.push({ key: `${db.key}:${v.id}`, label: db.views.filter((x) => x.type === 'calendar' || x.type === 'list').length > 1 ? `${db.schema.name} · ${v.name}` : db.schema.name });
    return out;
}
export const calendarViewKeys = (ws) => calendarViews(ws).map((v) => v.key);
/** is a calendar shown in this view ("db:view")? */
export function subShownIn(s, viewKey) {
    return s.showIn ? s.showIn.includes(viewKey) : !s.hiddenIn?.includes(viewKey);
}
/** show / hide a calendar in one view (an older one is turned into an explicit list first) */
export function setSubShown(s, viewKey, on, allViews) {
    const set = new Set(s.showIn ?? allViews.filter((k) => !s.hiddenIn?.includes(k)));
    if (on)
        set.add(viewKey);
    else
        set.delete(viewKey);
    s.showIn = [...set];
    delete s.hiddenIn;
}
/** the calendars shown in a view (only the views chosen for each) */
export function overlaysFor(viewKey) {
    return calendars.cfg.subscriptions.filter((s) => subShownIn(s, viewKey));
}
/** a database as a calendar: each entry on its date – every year with the age when `yearly` (birthdays) */
function dbItems(sub, from, to) {
    const db = calendars.ws?.dbs.get(sub.db ?? '');
    if (!db || !sub.prop)
        return [];
    const out = [];
    const y0 = new Date(from * 864e5).getUTCFullYear(), y1 = new Date(to * 864e5).getUTCFullYear();
    for (const row of db.rows) {
        const v = db.value(row, sub.prop);
        const iso = (typeof v === 'string' ? v : v?.start ?? '').slice(0, 10);
        if (!/^\d{4}-\d\d-\d\d$/.test(iso))
            continue;
        const name = String(db.value(row, db.titleProp) ?? '').trim() || 'Untitled';
        const days = sub.yearly ? Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i).filter((y) => y >= +iso.slice(0, 4)).map((y) => [y, `${y}${iso.slice(4)}`]) : [[+iso.slice(0, 4), iso]];
        for (const [y, day] of days) {
            // 29 February in other years: on 28 February
            const d = /-02-29$/.test(day) && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? `${y}-02-28` : day;
            const n = dayNum(d);
            if (n < from || n >= to)
                continue;
            const age = y - +iso.slice(0, 4), lab = sub.label ?? 'age';
            const extra = !sub.yearly || lab === 'name' ? '' : lab === 'year' ? ` · ${iso.slice(0, 4)}` : age > 0 ? ` · ${age}` : '';
            out.push({ ev: { uid: `${row.id}-${y}`, title: name + extra, start: d, rowRef: { db: db.key, id: row.id }, icon: sub.icon }, sub, s: n, e: n, time: '' });
        }
    }
    return out;
}
/** their events between two day numbers (repeats expanded) */
export function overlayItems(viewKey, from, to) {
    const out = [];
    for (const sub of overlaysFor(viewKey)) {
        if (sub.url === 'nook:db') {
            out.push(...dbItems(sub, from, to));
            continue;
        }
        for (const ev of calendars.subs.get(sub.id)?.events ?? []) {
            if (!ev.start)
                continue;
            const s = dayNum(ev.start.slice(0, 10));
            const e = Math.max(s, ev.end ? dayNum(ev.end.slice(0, 10)) : s);
            const time = ev.start.length > 10 ? ev.start.slice(11, 16) : '';
            const rule = ev.rrule ? parseRRule(ev.rrule) : null;
            if (rule) {
                rule.except = ev.exdates;
                const len = e - s;
                const isoFrom = new Date((from - len) * 864e5).toISOString().slice(0, 10), isoTo = new Date(to * 864e5).toISOString().slice(0, 10);
                for (const occ of occurrences(ev.start.slice(0, 10), rule, isoFrom, isoTo)) {
                    const os = dayNum(occ);
                    out.push({ ev, sub, s: os, e: os + len, time, occ });
                }
                continue;
            }
            if (e < from || s >= to)
                continue;
            out.push({ ev, sub, s, e, time });
        }
    }
    return out;
}
//# sourceMappingURL=service.js.map