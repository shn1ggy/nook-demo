import { h, svgIcon, ICONS, fmtTime, fmtDay, ulid, COLORS } from '../util.js';
import { iconSvg } from './icons.js';
import { confirmReminder, setConfirmHandler } from './confirm.js';
import { dialog, menu, toast, svgClose, openPop } from './pop.js';
import { dateEditor } from '../views/cells.js';
import { asDate } from '../util.js';
import { remindersBetween, quickTimes } from './reminders.js';
import { parseWhen, localIso, fromLocalIso, fmtWhen, shortWhen } from '../when.js';
const STATE = '.workspace/notifications.json';
const SEEN = 'nook:notif-seen';
const OWN = '.workspace/reminders.json';
const phone = () => document.documentElement.classList.contains('phone');
const minutes = (ms) => Math.round(ms / 60_000);
function relative(due, start) {
    if (!start)
        start = localIso(new Date(due));
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const t = new Date(), y = new Date(t.getTime() - 864e5), tm = new Date(t.getTime() + 864e5);
    const day = start.slice(0, 10), dayName = day === iso(t) ? 'Today' : day === iso(tm) ? 'Tomorrow' : day === iso(y) ? 'Yesterday' : fmtDay(day);
    const when = start.length > 10 ? `${dayName}, ${fmtTime(start.slice(11, 16))}` : dayName;
    const startMs = start.length > 10 ? new Date(start.slice(0, 16)).getTime() : NaN;
    const left = Number.isNaN(startMs) ? NaN : minutes(startMs - Date.now());
    const rel = Number.isNaN(left) ? '' : left > 0 && left < 120 ? ` · in ${left} minute${left === 1 ? '' : 's'}` : left <= 0 && left > -120 ? (left === 0 ? ' · now' : ` · ${-left} minute${left === -1 ? '' : 's'} ago`) : '';
    void due;
    return when + rel;
}
export class Notifications {
    host;
    done = {};
    later = {};
    /** Done items taken off the list (trash / Clear all) */
    cleared = {};
    /** + Reminder: reminders of their own (.workspace/reminders.json) */
    own = [];
    loaded = false;
    seen = new Set();
    carded = new Set();
    since = Date.now();
    missing = 0;
    unsaved = null;
    timers = [];
    panel = null;
    get panelOpen() { return !!this.panel; }
    /** leaving the Notifications page for another tab: gone at once (no closing slide over the bottom bar) */
    closePanel() { const ov = this.panel?.box.closest('.overlay'); if (ov)
        ov.style.display = 'none'; this.panel?.close(); this.panel = null; ov?.remove(); }
    awayShown = false;
    constructor(host) {
        this.host = host;
        setConfirmHandler((t, w, e) => this.setCard(t, w, e));
        // browsers only allow sound after a click or key: get it ready on the first one
        const unlock = () => { try {
            const C = window.AudioContext ?? window.webkitAudioContext;
            const c = Notifications.actx ??= new C();
            void c.resume();
        }
        catch { /* none */ } };
        document.addEventListener('pointerdown', unlock, { once: true, capture: true });
        document.addEventListener('keydown', unlock, { once: true, capture: true });
        try {
            this.seen = new Set(JSON.parse(localStorage.getItem(SEEN) ?? '[]'));
        }
        catch { /* private window */ }
    }
    get ws() { return this.host.ws; }
    start() {
        void this.load().then(() => this.tick());
        this.timers.push(window.setInterval(() => this.tick(), 30_000));
        // missing files: looked for once things have settled, then every 10 minutes
        const look = () => { try {
            this.missing = this.ws.settings.notifyMissing === false ? 0 : this.ws.missingFiles().length;
        }
        catch {
            this.missing = 0;
        } this.paint(); };
        this.timers.push(window.setTimeout(() => void this.ws.whenFresh().then(() => setTimeout(look, 8000)), 100));
        this.timers.push(window.setInterval(look, 600_000));
        const st = this.ws.storage;
        const off = st.onStatus?.((s) => { const was = !!this.unsaved; this.unsaved = (s.offline && s.pending) || s.error ? s : null; if (was !== !!this.unsaved)
            this.paint(); });
        return () => { this.timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); off?.(); };
    }
    // ---------- state (shared through the workspace) ----------
    async load() {
        try {
            const t = await this.ws.storage.read(STATE);
            this.lastState = t;
            this.ws.cache.set(STATE, t);
            const j = JSON.parse(t);
            this.done = j.done ?? {};
            this.later = j.later ?? {};
            this.cleared = j.cleared ?? {};
        }
        catch { /* none yet */ }
        try {
            const t = await this.ws.storage.read(OWN);
            this.lastOwn = t;
            this.ws.cache.set(OWN, t);
            const j = JSON.parse(t);
            this.own = Array.isArray(j.reminders) ? j.reminders : [];
        }
        catch { /* none yet */ }
        // a month later nobody needs to know any more
        const old = Date.now() - 31 * 864e5;
        for (const k of Object.keys(this.done))
            if (this.done[k] < old)
                delete this.done[k];
        for (const k of Object.keys(this.later))
            if (this.later[k] < old)
                delete this.later[k];
        for (const k of Object.keys(this.cleared))
            if (this.cleared[k] < old)
                delete this.cleared[k];
        this.loaded = true;
    }
    // every change is an undo step (⌘Z / Ctrl+Z, or Undo in the toast on the phone)
    lastState = null;
    lastOwn = null;
    stateText() { return JSON.stringify({ done: this.done, later: this.later, cleared: this.cleared }, null, 2) + '\n'; }
    ownText() { return JSON.stringify({ reminders: this.own }, null, 2) + '\n'; }
    save() {
        const t = this.stateText();
        if (t === this.lastState)
            return;
        this.ws.recordFile(STATE, this.lastState, t);
        this.lastState = t;
        void this.ws.storage.write(STATE, t).catch(() => { });
    }
    saveOwn() {
        const t = this.ownText();
        if (t !== this.lastOwn) {
            this.ws.recordFile(OWN, this.lastOwn, t);
            this.lastOwn = t;
            void this.ws.storage.write(OWN, t).catch(() => { });
        }
        this.paint();
    }
    /** after undo / redo: take the state back from the files */
    fromHistory() {
        const st = this.ws.cache.get(STATE), ow = this.ws.cache.get(OWN);
        if (st !== undefined && st !== this.lastState) {
            this.lastState = st;
            try {
                const j = st ? JSON.parse(st) : {};
                this.done = j.done ?? {};
                this.later = j.later ?? {};
                this.cleared = j.cleared ?? {};
            }
            catch { /* keep */ }
        }
        if (ow !== undefined && ow !== this.lastOwn) {
            this.lastOwn = ow;
            try {
                const j = ow ? JSON.parse(ow) : {};
                this.own = Array.isArray(j.reminders) ? j.reminders : [];
            }
            catch { /* keep */ }
        }
        this.carded.clear();
        document.querySelectorAll('.ncard').forEach((c) => c.remove());
        this.paint();
        this.panel?.draw();
    }
    undoHint(what) { toast(`${what} · ${/Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl+'}Z to undo`); }
    /** opens what a reminder belongs to */
    go(r) {
        const s = r.src;
        if (s.kind === 'row')
            this.host.openRow(s.db, s.row);
        else if (s.kind === 'page')
            this.host.openPage(s.page.id);
        else if (s.kind === 'text') {
            if (s.page)
                this.host.openPage(s.page.id);
            else if (s.db && s.row)
                this.host.openRow(s.db, s.row);
        }
        else
            this.ownForm(s.own);
    }
    /** trash on a reminder coming up: a time you set goes; reminders before a date or in the text are skipped this once */
    async remove(r) {
        const s = r.src, ws = this.ws, at = localIso(new Date(r.due));
        if (s.kind === 'row' && s.row.remindAt?.includes(at)) {
            s.row.remindAt = s.row.remindAt.filter((x) => x !== at);
            if (!s.row.remindAt.length)
                delete s.row.remindAt;
            ws.boundary();
            await ws.saveRow(s.db, s.row);
        }
        else if (s.kind === 'page' && s.page.remindAt?.includes(at)) {
            s.page.remindAt = s.page.remindAt.filter((x) => x !== at);
            if (!s.page.remindAt.length)
                delete s.page.remindAt;
            ws.boundary();
            await ws.savePage(s.page);
        }
        else if (s.kind === 'own' && !s.own.repeat) {
            this.own = this.own.filter((x) => x.id !== s.own.id);
            this.saveOwn();
        }
        else {
            this.done[r.key] = Date.now();
            this.cleared[r.key] = Date.now();
            this.save();
        }
        this.paint();
        this.undoHint('Reminder deleted');
    }
    markSeen(keys) { for (const k of keys)
        this.seen.add(k); try {
        localStorage.setItem(SEEN, JSON.stringify([...this.seen].slice(-800)));
    }
    catch { /* private window */ } }
    // ---------- what there is ----------
    dueReminders() {
        const now = Date.now();
        const back = (this.ws.settings.remindMissed ?? 24) * 3600_000;
        return remindersBetween(this.ws, now - back, now, this.own).filter((r) => !this.done[r.key] && !(this.later[r.key] > now));
    }
    /** what needs you: due reminders first, then the rest */
    items() {
        const out = this.loaded ? this.dueReminders().reverse().map((r) => ({ key: r.key, kind: 'reminder', title: r.title, sub: `${relative(r.due, r.start)} · ${r.where}`, r })) : [];
        if (this.ws.settings.notifySync !== false) {
            for (const c of this.ws.conflicts) {
                const nm = (c.original.split('/').pop() ?? '').replace(/\.(md|json)$/i, '');
                out.push({ key: `conflict:${c.path}`, kind: 'conflict', title: `Conflict · ${nm}`, sub: 'Changed on two devices at the same time', act: { label: 'Compare…', run: () => this.host.openConflicts() } });
            }
            if (this.unsaved)
                out.push({ key: `unsaved:${this.unsaved.error ?? 'offline'}`, kind: 'unsaved', title: this.unsaved.error ? 'Not saved to Dropbox' : `${this.unsaved.pending} ${this.unsaved.pending === 1 ? 'change' : 'changes'} not saved yet`, sub: this.unsaved.error ?? 'Offline – they go out when the connection is back' });
        }
        if (this.ws.settings.notifyMissing !== false) {
            if (this.missing)
                out.push({ key: `missing:${this.missing}`, kind: 'missing', title: `${this.missing} missing ${this.missing === 1 ? 'file' : 'files'}`, sub: 'Pages and entries point at files that are gone', act: { label: 'Look…', run: () => window.dispatchEvent(new CustomEvent('nook-open-settings', { detail: 'files' })) } });
        }
        return out;
    }
    upcoming(days = 7) {
        if (!this.loaded)
            return [];
        const now = Date.now();
        const ahead = remindersBetween(this.ws, now + 1, now + days * 864e5, this.own).filter((r) => !this.done[r.key]);
        // put off with Later: listed at the new time until then
        const snoozed = remindersBetween(this.ws, now - 31 * 864e5, now, this.own).filter((r) => !this.done[r.key] && this.later[r.key] > now).map((r) => ({ ...r, due: this.later[r.key] }));
        return [...snoozed, ...ahead.filter((r) => !snoozed.some((x) => x.key === r.key))].sort((a, b) => a.due - b.due).slice(0, 12);
    }
    count() { return this.items().length; }
    fresh() { return this.items().some((x) => !this.seen.has(x.key)); }
    // ---------- badges ----------
    /** the count and the dot wherever they are drawn (called after every redraw too) */
    paint() {
        this.placeStack();
        const n = this.count(), f = n > 0; // the red dot stays until each one is dealt with (Later or Done), not when it was merely seen
        document.querySelectorAll('.nb-count').forEach((e) => { e.textContent = n > 99 ? '99+' : String(n); e.hidden = !n; });
        document.querySelectorAll('.nb-dot').forEach((e) => { e.hidden = !f; });
        // the tab shows how many are open: "(2) Workspace · Nook"
        const base = document.title.replace(/^\(\d+\+?\) /, '');
        const want = n ? `(${n > 99 ? '99+' : n}) ${base}` : base;
        if (document.title !== want)
            document.title = want;
        this.panel?.draw();
    }
    // ---------- every 30 seconds ----------
    tick() {
        if (!this.loaded)
            return;
        const due = this.dueReminders();
        // came due while Nook was closed: summed up once, on opening
        if (!this.awayShown) {
            this.awayShown = true;
            const away = due.filter((r) => r.due < this.since && !this.seen.has(r.key));
            const others = this.items().filter((x) => x.kind !== 'reminder' && !this.seen.has(x.key));
            for (const r of due)
                if (r.due < this.since)
                    this.carded.add(r.key);
            if (away.length || others.length)
                this.awayCard(away, others);
        }
        for (const r of due)
            if (!this.carded.has(r.key)) {
                this.carded.add(r.key);
                this.card(r);
            }
        this.paint();
    }
    // ---------- acting on an item ----------
    finish(key, hint = true) { this.done[key] = Date.now(); delete this.later[key]; this.markSeen([key]); this.save(); this.paint(); this.panel?.draw(); if (hint)
        this.undoHint('Done'); }
    snooze(key, until) { this.later[key] = until; this.carded.delete(key); this.markSeen([key]); this.save(); this.paint(); this.panel?.draw(); this.undoHint('Later'); }
    laterMenu(at, key, after) {
        const now = new Date(), t = (d) => d.getTime();
        const evening = new Date(now);
        evening.setHours(19, 0, 0, 0);
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        const pick = (ms) => { this.snooze(key, ms); after?.(); };
        menu(at, [
            { section: 'Remind me again' },
            { label: 'In 10 minutes', run: () => pick(Date.now() + 10 * 60_000) },
            { label: 'In 1 hour', run: () => pick(Date.now() + 3600_000) },
            ...(now.getHours() < 18 ? [{ label: 'This evening (19:00)', run: () => pick(t(evening)) }] : []),
            { label: 'Tomorrow (9:00)', run: () => pick(t(tomorrow)) },
        ]);
    }
    // ---------- the card when something comes due ----------
    stack() {
        let box = document.querySelector('.ncards');
        if (!box) {
            box = h('div', { class: 'ncards', role: 'status' });
            document.body.appendChild(box);
        }
        this.placeStack(box);
        return box;
    }
    /** desktop: the cards hang below the bell (its left edge), wherever the bell is – sidebar open or closed */
    /** desktop: pop-ups sit in the corner between sidebar and top bar, 8px in */
    corner() {
        const main = document.querySelector('.main'), bar = document.querySelector('.topbar');
        if (!main || !bar)
            return null;
        return { left: main.getBoundingClientRect().left + 8, top: bar.getBoundingClientRect().bottom + 8 };
    }
    /** desktop: after the sidebar opened or closed – the panel and the cards follow the corner */
    relayout() {
        this.placeStack();
        const p = this.panel;
        if (!p || phone() || !p.anchorBell)
            return;
        requestAnimationFrame(() => { const c = this.corner(); if (!c)
            return; p.box.style.left = `${Math.min(Math.max(8, c.left), innerWidth - 400)}px`; p.box.style.top = `${c.top}px`; p.box.style.maxHeight = `${innerHeight - c.top - 16}px`; });
    }
    /** an upcoming reminder opened from the panel: the panel stays open (desktop) and gets the focus back when the window closes */
    openFromPanel(r) {
        const box = this.panel?.box;
        const had = new Set(document.querySelectorAll('.overlay'));
        this.go(r);
        if (!box)
            return;
        setTimeout(() => {
            const ov = [...document.querySelectorAll('.overlay')].find((o) => !had.has(o));
            if (!ov)
                return;
            const mo = new MutationObserver(() => { if (!ov.isConnected) {
                mo.disconnect();
                if (box.isConnected) {
                    box.tabIndex = -1;
                    box.focus({ preventScroll: true });
                }
            } });
            mo.observe(document.body, { childList: true, subtree: true });
        }, 50);
    }
    placeStack(box = document.querySelector('.ncards')) {
        if (!box || phone())
            return;
        const c = this.corner();
        if (!c) {
            box.style.left = '';
            box.style.top = '';
            box.style.right = '';
            return;
        }
        box.style.right = 'auto';
        box.style.left = `${Math.max(8, Math.min(c.left, innerWidth - box.offsetWidth - 8))}px`;
        box.style.top = `${c.top}px`;
    }
    /** phone: swipe a row to the left for its buttons (Done, Delete); a tap elsewhere closes it again */
    swipeRow(row) {
        let x0 = 0, y0 = 0, dx = 0, on = false, open = false;
        const W = () => row.querySelector('.np-acts')?.offsetWidth || 128;
        const set = (v, anim) => { row.style.setProperty('--sx', `${v}px`); row.classList.toggle('sw-anim', anim); row.classList.toggle('sw-open', v < 0); };
        row.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; on = false; }, { passive: true });
        row.addEventListener('touchmove', (e) => {
            const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
            if (!on && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
                on = true;
                row.parentElement?.querySelectorAll('.np-tr.sw-open').forEach((o) => { if (o !== row) {
                    o.style.setProperty('--sx', '0px');
                    o.classList.remove('sw-open');
                } });
            }
            if (!on)
                return;
            e.preventDefault();
            dx = mx;
            set(Math.min(0, Math.max(-W() - 24, (open ? -W() : 0) + dx)), false);
        }, { passive: false });
        row.addEventListener('touchend', () => { if (!on)
            return; const v = (open ? -W() : 0) + dx; open = v < -W() / 2; set(open ? -W() : 0, true); });
        row.addEventListener('click', (e) => { if (open && !e.target.closest('.np-acts')) {
            e.stopPropagation();
            e.preventDefault();
            open = false;
            set(0, true);
        } }, true);
    }
    /** a small soft ping (two short tones), made in the browser – no sound file */
    static actx = null;
    ping() {
        if (this.ws.settings.notifySound === false)
            return;
        try {
            const C = window.AudioContext ?? window.webkitAudioContext;
            const ctx = Notifications.actx ??= new C();
            if (ctx.state === 'suspended')
                void ctx.resume();
            const t0 = ctx.currentTime;
            for (const [f, at] of [[1318.5, 0], [1760, 0.11]]) {
                const o = ctx.createOscillator(), g = ctx.createGain();
                o.type = 'sine';
                o.frequency.value = f;
                g.gain.setValueAtTime(0, t0 + at);
                g.gain.linearRampToValueAtTime(0.12, t0 + at + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
                o.connect(g).connect(ctx.destination);
                o.start(t0 + at);
                o.stop(t0 + at + 0.5);
            }
        }
        catch { /* no sound possible */ }
    }
    card(r) {
        this.ping();
        // the panel is open: it shows there (marked new), no card on top of it
        if (this.panel) {
            this.panel.draw();
            return;
        }
        const name = r.title;
        const close = () => { card.classList.add('out'); setTimeout(() => card.remove(), 180); };
        const t = new Date(r.due), today = new Date().toDateString() === t.toDateString();
        const when = (today ? fmtTime(t.toTimeString().slice(0, 5)) : `${fmtDay(localIso(t).slice(0, 10))} ${fmtTime(t.toTimeString().slice(0, 5))}`) + (Date.now() - r.due < 3600e3 ? ' · now' : '');
        // like the due line in Notifications: click opens, Later + Done on the right
        const card = h('div', { class: 'ncard np-due', role: 'button', tabindex: 0, onclick: () => { this.finish(r.key, false); close(); this.go(r); } }, iconSvg('bell', 16), h('div', { class: 'np-due-tx' }, h('b', null, name), h('span', null, when)), h('button', { class: 'set-btn', onclick: (e) => { e.stopPropagation(); this.laterMenu(e.currentTarget, r.key, close); } }, 'Later'), h('button', { class: 'btn-new', onclick: (e) => { e.stopPropagation(); this.finish(r.key); close(); } }, 'Done'));
        this.stack().appendChild(card);
    }
    /** "Reminder set": like a reminder card, in the corner, gone after a few seconds (stays while the pointer is on it) */
    setCard(title, when, onEdit) {
        document.querySelectorAll('.ncard.set-ok').forEach((c) => c.remove());
        const close = () => { card.classList.add('out'); setTimeout(() => card.remove(), 180); };
        const card = h('div', { class: 'ncard np-due set-ok', role: 'status' }, iconSvg('bell', 16), h('div', { class: 'np-due-tx' }, h('b', null, title || 'Reminder set'), h('span', null, `Set for ${shortWhen(when)}`)), onEdit ? h('button', { class: 'set-btn', onclick: () => { close(); onEdit(); } }, 'Edit') : null);
        let t = window.setTimeout(close, 4500);
        card.addEventListener('pointerenter', () => clearTimeout(t));
        card.addEventListener('pointerleave', () => { t = window.setTimeout(close, 2000); });
        this.stack().appendChild(card);
        this.placeStack();
    }
    awayCard(rem, others) {
        const close = () => { card.classList.add('out'); setTimeout(() => card.remove(), 180); };
        const names = (l) => l.slice(0, 3).map((r) => r.title).join(', ') + (l.length > 3 ? ` and ${l.length - 3} more` : '');
        const parts = [rem.length ? `${rem.length} ${rem.length === 1 ? 'reminder' : 'reminders'} · ${names(rem)}` : '', ...others.map((x) => x.title)].filter(Boolean);
        // like the reminder card: one line, click shows them, Later + Show on the right
        const card = h('div', { class: 'ncard np-due away2', role: 'button', tabindex: 0, onclick: () => { close(); this.open(document.querySelector('.top-bell') ?? undefined); } }, iconSvg('bell', 16), h('div', { class: 'np-due-tx' }, h('b', null, 'While you were away'), h('span', null, parts.join(' · '))), h('button', { class: 'set-btn', onclick: (e) => { e.stopPropagation(); close(); } }, 'Later'), h('button', { class: 'btn-new', onclick: (e) => { e.stopPropagation(); close(); this.open(document.querySelector('.top-bell') ?? undefined); } }, 'Show'));
        this.stack().appendChild(card);
        this.placeStack();
    }
    // ---------- + Reminder: one of your own ----------
    ownForm(edit) {
        const o = edit ? { ...edit } : { id: ulid(), text: '', at: localIso(quickTimes()[1]?.[1] ?? new Date(Date.now() + 3600_000)) };
        let at = fromLocalIso(o.at);
        let rep = o.repeat;
        const REP = [[undefined, 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']];
        const title = h('input', { class: 'own-title', placeholder: 'Untitled', value: o.text });
        const chip = h('button', { class: 'rem-chip on own-when' });
        // phone: When is a row (value on the right) with the quick times as pills below
        let anchorEl = chip;
        const whenVal = h('span', { class: 'og-v og-when' });
        const pills = [];
        let drawChip = () => {
            chip.textContent = '';
            chip.append(iconSvg('bell', 12), h('span', null, fmtWhen(at)));
            const sw = shortWhen(at);
            whenVal.textContent = sw[0].toUpperCase() + sw.slice(1);
            for (const [b, d] of pills)
                b.classList.toggle('on', localIso(d) === localIso(at));
        };
        // type the time the way you'd say it; "Pick in calendar" switches to the usual date picker
        const calendar = () => dateEditor({ start: localIso(at) }, anchorEl, (v) => { const d = asDate(v); if (d) {
            at = fromLocalIso(d.start.length > 10 ? d.start.slice(0, 16) : `${d.start.slice(0, 10)}T${localIso(at).slice(11, 16)}`);
            drawChip();
        } }, false, { noEnd: true, noClear: true });
        const other = () => {
            const inp = h('input', { class: 'pop-input' });
            const hint = h('div', { class: 'own-type-hint' });
            let closeP = () => { };
            const apply = () => { const d = parseWhen(inp.value); if (d) {
                at = d;
                drawChip();
                closeP();
            }
            else {
                hint.textContent = 'Not understood – try “sun 18” or “tomorrow 21:00”';
                hint.classList.add('bad');
            } };
            inp.addEventListener('input', () => { const d = parseWhen(inp.value); hint.textContent = inp.value.trim() ? (d ? fmtWhen(d) : 'Not understood yet') : ''; hint.classList.toggle('bad', !d); });
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
                e.preventDefault();
                apply();
            } });
            // as the other quick questions: a line saying what to type, the field, OK – and the calendar below
            const box = h('div', { class: 'pop-prompt own-type-pop' }, h('div', { class: 'pop-label' }, 'e.g. sun 18 · tomorrow 21:00 · 23.11. 14:00 · in 2 hours'), inp, hint, h('button', { class: 'btn-new', onclick: apply }, 'OK'), h('button', { class: 'set-btn own-cal', onclick: () => { closeP(); calendar(); } }, iconSvg('calendar', 14), 'Pick in calendar'));
            closeP = openPop(anchorEl, box);
            inp.focus();
        };
        chip.addEventListener('click', other);
        drawChip();
        const quick = h('div', { class: 'own-quick' }, ...quickTimes().map(([l, d]) => h('button', { class: 'set-btn', onclick: () => { at = d; drawChip(); } }, { 'This evening (19:00)': 'This evening', 'Tomorrow (9:00)': 'Tomorrow 9:00', 'Next week (Mon 9:00)': 'Next week' }[l] ?? l)), h('button', { class: 'set-btn', onclick: other }, 'Other time…'), h('button', { class: 'set-btn', onclick: calendar }, 'Calendar…'));
        const repVal = h('button', { class: 'own-val' });
        const drawRep = () => { repVal.textContent = (phone() && !rep) ? 'Never' : REP.find(([k]) => k === rep)?.[1] ?? 'Does not repeat'; };
        repVal.addEventListener('click', () => menu(repVal, REP.map(([k, l]) => ({ label: (rep === k ? '✓ ' : '   ') + l, run: () => { rep = k; drawRep(); } }))));
        drawRep();
        const notes = h('textarea', { class: 'own-notes', rows: 2, placeholder: 'Notes …' });
        notes.value = o.notes ?? '';
        const grow = () => { notes.style.height = 'auto'; notes.style.height = `${notes.scrollHeight}px`; };
        notes.addEventListener('input', grow);
        setTimeout(grow, 0);
        const save = () => {
            if (!title.value.trim()) {
                title.focus();
                return;
            }
            const next = { id: o.id, text: title.value.trim(), at: localIso(at), ...(rep ? { repeat: rep } : {}), ...(notes.value.trim() ? { notes: notes.value.trim() } : {}) };
            const i = this.own.findIndex((x) => x.id === o.id);
            if (i >= 0)
                this.own[i] = next;
            else
                this.own.push(next);
            this.saveOwn();
            close();
            this.panel?.draw();
            confirmReminder(next.text, at, () => this.ownForm(next));
        };
        // phone: day row, time tiles and repeat switch right in the sheet – nothing opens on top
        const phoneBody = () => {
            title.placeholder = 'Title';
            notes.placeholder = 'Add a note';
            notes.rows = 1;
            const ymd = (d) => localIso(d).slice(0, 10);
            const hm = () => localIso(at).slice(11, 16);
            const setDay = (d) => { const [H, M] = hm().split(':').map(Number); at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), H, M); draw(); };
            const setTime = (t) => { const [H, M] = t.split(':').map(Number); at = new Date(at.getFullYear(), at.getMonth(), at.getDate(), H, M); draw(); };
            const days = h('div', { class: 'ogb-days' });
            const times = h('div', { class: 'ogb-times' });
            const reps = h('div', { class: 'ogb-seg' });
            const TIMES = ['09:00', '12:00', '19:00'];
            const REPS = [[undefined, 'Once'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];
            const draw = () => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const sel = new Date(at);
                sel.setHours(0, 0, 0, 0);
                const start = (sel.getTime() - today.getTime()) / 864e5 > 6 ? sel : today;
                days.replaceChildren(...Array.from({ length: 7 }, (_, i) => {
                    const d = new Date(start);
                    d.setDate(start.getDate() + i);
                    return h('button', { class: 'ogb-day' + (ymd(d) === ymd(at) ? ' on' : ''), onclick: () => setDay(d) }, h('span', null, d.toLocaleDateString(undefined, { weekday: 'short' }).replace('.', '')), h('b', null, String(d.getDate())));
                }));
                times.replaceChildren(...TIMES.map((t) => h('button', { class: 'ogb-time' + (t === hm() ? ' on' : ''), onclick: () => { typed.value = ''; typedOut.textContent = ''; setTime(t); } }, fmtTime(t))));
                reps.replaceChildren(...REPS.map(([k, l]) => h('button', { class: 'ogb-rep' + (rep === k ? ' on' : ''), onclick: () => { rep = k; draw(); } }, l)));
                orig();
            };
            // any other day or time: typed right here (“sun 18”, “tomorrow 21:00”), or picked in the calendar
            const typed = h('input', { class: 'ogb-typed', placeholder: 'Other: sun 18, tomorrow 21:00 …', enterkeyhint: 'done' });
            const typedOut = h('span', { class: 'ogb-typed-out' });
            typed.addEventListener('input', () => {
                const d = typed.value.trim() ? parseWhen(typed.value) : null;
                typedOut.textContent = typed.value.trim() ? (d ? shortWhen(d) : '?') : '';
                typedOut.classList.toggle('bad', !!typed.value.trim() && !d);
                if (d) {
                    at = d;
                    draw();
                }
            });
            typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
                e.preventDefault();
                typed.blur();
            } });
            const otherRow = h('div', { class: 'ogb-other' }, typed, typedOut, h('button', { class: 'ogb-cal', 'aria-label': 'Pick in calendar', onclick: () => calendar() }, iconSvg('calendar', 18)));
            anchorEl = otherRow;
            // a time typed or picked in "Other…" redraws the tiles too
            const orig = drawChip;
            drawChip = draw;
            draw();
            return h('div', { class: 'own-body own-body-phone ogb' }, h('div', { class: 'ogb-head' }, edit ? 'REMINDER' : 'NEW REMINDER'), h('div', { class: 'ogb-card' }, title, notes), days, times, otherRow, reps);
        };
        const prop = (icon, name, ...v) => h('div', { class: 'own-prop' }, h('span', { class: 'own-k' }, iconSvg(icon, 15), name), h('div', { class: 'own-v' }, ...v));
        const close = dialog(h('div', { class: 'bwindow own-window' }, phone()
            ? null
            : h('div', { class: 'own-head' }, iconSvg('bell', 14), h('span', null, 'Reminder'), h('span', { style: { flex: '1' } }), h('button', { class: 'icon-btn mclose', 'aria-label': 'Close', onclick: () => close() }, svgClose())), phone() ? phoneBody() : h('div', { class: 'own-body' }, title, prop('clock', 'When', chip), quick, prop('repeat', 'Repeat', repVal), notes), phone() ? h('div', { class: 'ogb-foot' }, h('button', { class: 'ogb-save', onclick: save }, 'Save'), edit ? h('button', { class: 'ogb-del', onclick: () => { this.own = this.own.filter((x) => x.id !== o.id); this.saveOwn(); close(); this.panel?.draw(); this.undoHint('Reminder deleted'); } }, 'Delete reminder') : null) :
            h('div', { class: 'own-foot' }, edit ? h('button', { class: 'set-btn own-del', onclick: () => { this.own = this.own.filter((x) => x.id !== o.id); this.saveOwn(); close(); this.panel?.draw(); this.undoHint('Reminder deleted'); } }, phone() ? null : iconSvg('trash', 13), phone() ? 'Delete reminder' : 'Delete') : null, h('span', { style: { flex: '1' } }), h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn-new', onclick: save }, 'Done'))), { wide: true });
        title.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
            e.preventDefault();
            save();
        } });
        // Ctrl/⌘ + Enter saves from anywhere in the window (also from the notes)
        // (caught before the dialog's own Ctrl+Enter, which would only close it)
        const onKey = (k) => { if (k.key === 'Enter' && (k.ctrlKey || k.metaKey) && document.body.contains(title)) {
            k.preventDefault();
            k.stopImmediatePropagation();
            save();
        } };
        window.addEventListener('keydown', onKey, true);
        const gone = new MutationObserver(() => { if (!document.body.contains(title)) {
            window.removeEventListener('keydown', onKey, true);
            gone.disconnect();
        } });
        gone.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => title.focus(), 30);
    }
    // ---------- the panel ----------
    open(anchor) {
        if (this.panel) {
            this.panel.close();
            return;
        }
        document.querySelectorAll('.ncard').forEach((c) => c.remove());
        let tab = 'up';
        const body = h('div', { class: 'np-body' });
        const seg = h('div', { class: 'np-seg' });
        const foot = h('div', { class: 'np-foot' });
        const icon = (k) => k === 'reminder' ? 'bell' : k === 'conflict' ? 'alert' : k === 'missing' ? 'file' : 'cloud';
        const when = (d) => {
            const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(new Date().setHours(0, 0, 0, 0)).getTime()) / 864e5);
            const t = fmtTime(d.toTimeString().slice(0, 5));
            return days === 0 ? `Today ${t}` : days === 1 ? `Tomorrow ${t}` : days === -1 ? `Yesterday ${t}` : Math.abs(days) < 7 ? `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${t}` : `${fmtDay(localIso(d).slice(0, 10))} ${t}`;
        };
        // what needs you now: a box above the timeline
        const dueBox = (x) => h('div', { class: 'np-due' + (x.kind === 'reminder' ? '' : ' warn'), role: x.r ? 'button' : null, tabindex: x.r ? 0 : null,
            onclick: x.r ? () => { const r = x.r; this.finish(x.key, false); close(); this.go(r); } : null }, iconSvg(icon(x.kind), 16), h('div', { class: 'np-due-tx' }, h('b', null, x.title), h('span', null, x.r ? when(new Date(x.r.due)).replace(/^Today /, '') + (Date.now() - x.r.due < 3600e3 ? ' · now' : '') : x.sub)), x.r ? [
            h('button', { class: 'set-btn', onclick: (e) => { e.stopPropagation(); this.laterMenu(e.currentTarget, x.key); } }, 'Later'),
            h('button', { class: 'btn-new', onclick: (e) => { e.stopPropagation(); this.finish(x.key); } }, 'Done')
        ]
            : x.act ? h('button', { class: 'set-btn', onclick: (e) => { e.stopPropagation(); close(); x.act.run(); } }, x.act.label) : null);
        const swipe = (row) => { if (phone())
            this.swipeRow(row); return row; };
        const tlRow = (r, right, acts, past = false) => swipe(h('div', { class: 'np-tr' + (past ? ' past' : ''), role: 'button', tabindex: 0, onclick: () => { this.openFromPanel(r); } }, h('span', { class: 'np-dot', style: past ? null : { background: COLORS[evColor(r)]?.text ?? '' } }), h('span', { class: 'np-tt', title: r.where && r.where !== 'Reminder' ? `${r.title} · ${r.where}` : r.title }, h('span', { class: 'np-t1' }, r.title), [forWhen(r), r.where && r.where !== 'Reminder' ? r.where : ''].filter(Boolean).length ? h('span', { class: 'np-src' }, `· ${[forWhen(r), r.where && r.where !== 'Reminder' ? r.where : ''].filter(Boolean).join(' · ')}`) : null), h('span', { class: 'np-when' }, right), h('span', { class: 'np-acts' }, ...acts)));
        const btn = (title, ic, run) => h('button', { class: 'icon-btn', title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); run(); } }, iconSvg(ic, 14));
        // phone: a page – the due item as a big card, then an agenda by day (date on the left), earlier ones on request
        let showEarlier = false;
        const ago = (t) => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : when(new Date(t)); };
        const dayKey = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
        const today0 = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();
        const sub = (r) => { const t = fmtTime(new Date(r.due).toTimeString().slice(0, 5)); const rep = r.src.kind === 'own' && r.src.own.repeat ? `every ${r.src.own.repeat === 'daily' ? 'day' : r.src.own.repeat.replace('ly', '')}` : ''; return [t, rep || (r.where && r.where !== 'Reminder' ? r.where : 'Reminder')].join(' · '); };
        // the source under a title only when there are several (all from one calendar: it would just repeat)
        let oneSource = null;
        // a reminder ahead of its date says which time it is for (“for Mon 10:00”, the same day: “for 10:00”)
        const forWhen = (r) => {
            if (!r.start || !r.mins)
                return '';
            const st = fromLocalIso(r.start.length > 10 ? r.start.slice(0, 16) : `${r.start.slice(0, 10)}T00:00`);
            const t = r.start.length > 10 ? fmtTime(r.start.slice(11, 16)) : '';
            if (dayKey(st.getTime()) === dayKey(r.due))
                return t ? `for ${t}` : '';
            const n = Math.round((dayKey(st.getTime()) - today0()) / 864e5);
            const day = n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 1 && n < 7 ? st.toLocaleDateString('en-GB', { weekday: 'short' }) : st.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
            return `for ${day}${t ? ' ' + t : ''}`;
        };
        let showAllDays = false;
        // the app's colours by kind: own reminders blue, repeating ones purple, calendar/database entries orange, reminders in page text green
        const evColor = (r) => (r.src.kind === 'own' ? (r.src.own.repeat ? 'purple' : 'blue') : r.src.kind === 'text' ? 'green' : 'orange');
        const evIcon = (r) => r.src.kind === 'own' ? (r.src.own.repeat ? 'repeat' : 'bell') : r.src.kind === 'text' ? 'bell' : 'calendar';
        const evCard = (r, acts, past = false) => swipe(h('div', { class: 'np-tr np-ev' + (past ? ' past' : ''), role: 'button', tabindex: 0, onclick: () => { this.openFromPanel(r); } }, (() => { const ic = iconSvg(past ? 'check-bold' : evIcon(r), 18); if (!past)
            ic.style.color = COLORS[evColor(r)]?.text ?? ''; return ic; })(), h('div', { class: 'np-ev-tx' }, h('b', null, r.title), h('span', null, [forWhen(r), sub(r).replace(/^[^·]*· ?/, '').replace(/^Reminder$/, '').replace(oneSource ?? '\u0000', '')].filter(Boolean).join(' · '))), h('span', { class: 'np-ev-t' }, fmtTime(new Date(r.due).toTimeString().slice(0, 5))), h('span', { class: 'np-acts' }, ...acts)));
        // “Tomorrow · Sun 22 Nov”, “Tuesday · 24 Nov”, further away “Sat 28 Nov” (the year only when it isn't this one)
        const dayHead = (k) => {
            const n = Math.round((k - today0()) / 864e5), d = new Date(k);
            const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
            const wd = d.toLocaleDateString('en-GB', { weekday: 'short' });
            return n === 0 ? `Today · ${date}` : n === 1 ? `Tomorrow · ${wd} ${date}` : n === -1 ? `Yesterday · ${date}` : Math.abs(n) < 7 ? `${d.toLocaleDateString('en-GB', { weekday: 'long' })} · ${date}` : `${wd} ${date}`;
        };
        const agenda = (list, acts, past = false) => {
            const days = new Map();
            for (const r of list) {
                const k = dayKey(r.due);
                (days.get(k) ?? days.set(k, []).get(k)).push(r);
            }
            return [...days.entries()].flatMap(([k, rs]) => [h('div', { class: 'np-h' }, dayHead(k)), h('div', { class: 'np-card' }, ...rs.map((r) => evCard(r, acts(r), past)))]);
        };
        const hero = (x) => h('div', { class: 'np-card np-hero' + (x.kind === 'reminder' ? '' : ' warn'), role: x.r ? 'button' : null, onclick: x.r ? () => { const r = x.r; this.finish(x.key, false); close(); this.go(r); } : null }, h('div', { class: 'np-hero-top' }, iconSvg(icon(x.kind), 20), h('div', { class: 'np-ev-tx' }, h('b', null, x.title), h('span', null, x.r ? `${when(new Date(x.r.due))} · ${ago(x.r.due)}` : x.sub))), h('div', { class: 'np-hero-b' }, ...(x.r ? [
            h('button', { class: 'btn-new', onclick: (e) => { e.stopPropagation(); const r = x.r; this.finish(x.key, false); close(); this.go(r); } }, 'Open'),
            h('button', { class: 'set-btn', onclick: (e) => { e.stopPropagation(); this.laterMenu(e.currentTarget, x.key); } }, 'Later', svgIcon(ICONS.chevron, 12)),
            h('button', { class: 'set-btn', onclick: (e) => { e.stopPropagation(); this.finish(x.key); } }, iconSvg('check-bold', 13), 'Done')
        ]
            : x.act ? [h('button', { class: 'btn-new', onclick: (e) => { e.stopPropagation(); close(); x.act.run(); } }, x.act.label)] : [])));
        const drawPhone = () => {
            body.textContent = '';
            foot.textContent = '';
            // the title scrolls with the list (the list is what scrolls – New reminder below it stays put, even when pulled past the end)
            body.append(h('div', { class: 'np-head np-head-in' }, h('b', null, 'Notifications')));
            foot.append(h('button', { class: 'set-btn np-new', onclick: () => { this.ownForm(); } }, iconSvg('bell', 16), 'New reminder'));
            const up = this.upcoming(31), items = this.items();
            if (items.length)
                body.append(h('div', { class: 'np-h due' }, 'Due now'), ...items.map(hero));
            {
                const srcs = new Set(up.filter((r) => r.src.kind !== 'own').map((r) => r.where));
                oneSource = srcs.size === 1 ? [...srcs][0] : null;
            }
            // a week ahead; the rest on request
            const limit = today0() + 8 * 864e5, near = showAllDays ? up : up.filter((r) => r.due < limit), rest = up.length - near.length;
            if (near.length)
                body.append(...agenda(near, (r) => [
                    btn('Done', 'check-bold', () => { this.done[r.key] = Date.now(); this.save(); draw(); this.paint(); this.undoHint('Done'); }),
                    btn('Delete this reminder', 'trash', () => { void this.remove(r); setTimeout(draw, 50); })
                ]));
            if (rest > 0)
                body.append(h('div', { class: 'np-more' }, h('button', { class: 'set-btn', onclick: () => { showAllDays = true; draw(); } }, `Show more · ${rest}`)));
            if (!items.length && !up.length)
                body.append(h('div', { class: 'np-empty' }, 'Nothing coming up.'));
            const past = Object.entries(this.done).filter(([k]) => !this.cleared[k]).sort((a, b) => b[1] - a[1]).slice(0, 30);
            const all = remindersBetween(this.ws, Date.now() - 31 * 864e5, Date.now() + 8 * 864e5, this.own);
            const done = past.map(([k]) => all.find((x) => x.key === k)).filter((x) => !!x).sort((a, b) => b.due - a.due);
            if (!done.length)
                return;
            if (!showEarlier) {
                body.append(h('div', { class: 'np-more' }, h('button', { class: 'set-btn', onclick: () => { showEarlier = true; draw(); } }, `Show earlier · ${done.length}`)));
                return;
            }
            body.append(h('div', { class: 'np-sec' }, h('span', null, 'Earlier'), h('button', { class: 'set-btn', onclick: () => { showEarlier = false; draw(); } }, 'Hide')), ...agenda(done, (r) => [btn('Remove from the list', 'trash', () => { this.cleared[r.key] = Date.now(); this.save(); draw(); this.undoHint('Removed from the list'); })], true), h('div', { class: 'np-more' }, h('button', { class: 'set-btn danger', onclick: () => { for (const x of done)
                    this.cleared[x.key] = Date.now(); this.save(); showEarlier = false; draw(); this.undoHint('Cleared'); } }, 'Clear earlier')));
        };
        const draw = () => {
            if (phone()) {
                drawPhone();
                return;
            }
            const up = this.upcoming();
            seg.textContent = '';
            for (const [k, l] of [['up', up.length ? `Upcoming ${up.length}` : 'Upcoming'], ['past', 'Earlier']])
                seg.append(h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; draw(); } }, l));
            body.textContent = '';
            foot.textContent = '';
            if (tab === 'up') {
                const items = this.items();
                body.append(...items.map(dueBox));
                if (up.length)
                    body.append(h('div', { class: 'np-tl' }, ...up.map((r) => tlRow(r, when(new Date(r.due)), [
                        btn('Done', 'check-bold', () => { this.done[r.key] = Date.now(); this.save(); draw(); this.paint(); this.undoHint('Done'); }),
                        btn('Delete this reminder', 'trash', () => { void this.remove(r); setTimeout(draw, 50); })
                    ]))));
                if (!body.childElementCount)
                    body.append(h('div', { class: 'np-empty' }, 'Nothing coming up.'));
                foot.append(h('button', { class: 'set-btn np-add', title: 'A reminder of your own – e.g. every Sunday 18:00', onclick: () => { this.panel?.close(); this.ownForm(); } }, iconSvg('bell', 14), 'New reminder'));
            }
            else {
                const past = Object.entries(this.done).filter(([k]) => !this.cleared[k]).sort((a, b) => b[1] - a[1]).slice(0, 30);
                const all = remindersBetween(this.ws, Date.now() - 31 * 864e5, Date.now() + 8 * 864e5, this.own); // also ones done before they were due
                const done = past.map(([k, t]) => ({ r: all.find((x) => x.key === k), t })).filter((x) => x.r);
                if (done.length) {
                    body.append(h('div', { class: 'np-tl' }, ...done.map(({ r }) => tlRow(r, when(new Date(r.due)), [btn('Remove from the list', 'trash', () => { this.cleared[r.key] = Date.now(); this.save(); draw(); this.undoHint('Removed from the list'); })], true))));
                    foot.append(h('button', { class: 'set-btn danger np-add', onclick: () => { for (const x of done)
                            this.cleared[x.r.key] = Date.now(); this.save(); draw(); this.undoHint('Cleared'); } }, 'Clear all'));
                }
                else
                    body.append(h('div', { class: 'np-empty' }, 'Nothing here yet.'));
            }
        };
        const box = h('div', { class: 'np np2' + (phone() ? ' phone' : ''), role: 'dialog', 'aria-label': 'Notifications' }, h('div', { class: 'np-head' }, h('b', null, 'Notifications'), phone() ? null : h('button', { class: 'icon-btn mclose', 'aria-label': 'Close', onclick: () => close() }, svgClose())), phone() ? null : seg, body, foot);
        let close;
        if (phone()) {
            close = dialog(box, { onClose: () => { this.panel = null; } });
            box.closest('.overlay')?.classList.add('phone-page');
        }
        else {
            // a popover beside what opened it (or top left)
            const r = anchor?.getBoundingClientRect();
            // below the bell (under the top bar), its left edge like the reminder cards
            const bell = anchor?.classList.contains('top-bell');
            const c = bell ? this.corner() : null;
            box.style.left = `${Math.min(Math.max(8, c ? c.left : r ? r.right + 8 : 240), innerWidth - 400)}px`;
            const top = c ? c.top : r ? Math.max(8, r.top - 8) : 60;
            box.style.top = `${top}px`;
            box.style.maxHeight = `${innerHeight - top - 16}px`;
            if (r && r.top > innerHeight * 0.55) {
                box.style.top = '';
                box.style.bottom = `${Math.max(8, innerHeight - r.bottom - 8)}px`;
                box.style.maxHeight = `${r.bottom - 16}px`;
            }
            document.body.appendChild(box);
            const outside = (e) => { if (!box.contains(e.target) && !e.target.closest?.('.pop, .menu, .overlay, .top-bell, .nb-host, .side-toggle'))
                close(); };
            const key = (e) => { if (e.key === 'Escape' && !document.querySelector('.pop, .overlay')) {
                e.preventDefault();
                close();
            } };
            setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
            document.addEventListener('keydown', key, true);
            close = () => { box.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', key, true); this.panel = null; };
        }
        this.panel = { close: () => close(), draw, box, anchorBell: !!anchor?.classList.contains('top-bell') };
        draw();
        // looked at: the dot goes (the count stays until done)
        this.markSeen(this.items().map((x) => x.key));
        this.paint();
    }
}
/** the red count (hidden while 0) and the dot (hidden while nothing is new) – filled in by paint() */
export const nbCount = () => h('span', { class: 'nb-count', hidden: true });
export const nbDot = () => h('span', { class: 'nb-dot', hidden: true });
//# sourceMappingURL=notify.js.map