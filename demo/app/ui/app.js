import { attachSources } from '../sync/sources.js';
import { newDayDatabase } from '../views/days.js';
import '../widgets/builtins.js';
import { loadCustomWidgets } from '../widgets/runtime.js';
import { parseRowTarget, resolveRowTarget, rowTarget } from '../links.js';
import { backlinksSection } from './backlinks.js';
import { openDuplicates } from '../views/dupes.js';
// The app shell: sidebar (pages, databases, workspace switcher + settings at the bottom,
// like Scriptwright), page routing, entry pages, quick add, command palette, settings, undo.
import { APP } from '../config.js';
import { resolvePageWidth, resolveDatabaseWidth, workspaceWidth, widthStyle } from '../pagewidth.js';
import { runButton } from './buttons.js';
import { openSettings } from './settingsdialog.js';
import { Workspace } from '../workspace.js';
import { asDate, h, svgIcon, ICONS, debounce, flushPending, todayISO, fmtTime, setTimeFormat, setDateFormat, setNumberLocale, setDefaultBlockSize, setWeekStart, fmtDate, ulid, applyColors, setShortcutHint, setPalette, themeVars, DEFAULT_BG, compareText, PHONE_QUERY, isPhone } from '../util.js';
import { plainText } from '../format/inline.js';
import { parsePage, serializePage, pageToText } from '../format/page.js';
import { Editor, enableAutoReplace } from './editor.js';
import { widthEntry } from './widthcontrol.js';
import { iconSvg, renderIcon } from './icons.js';
import { describeRepeat, parseRRule } from '../recur.js';
import { repeatMenu } from '../views/repeat.js';
import { repeatOn } from '../views/cells.js';
import { addPropertyMenu, propertyEntries } from '../views/propmenu.js';
import { calSelection } from '../views/calendar.js';
import { duplicateSelected, endSelectMode, installSelectionKeys, openSelected, selectedRows, setOpenWith } from '../views/rowselect.js';
import { pickIcon } from './iconpicker.js';
import { pageItems, pickEntries } from './pickers.js';
import { dialog, menu, prompt, toast, closePop, closePeeks, closeSheets, confirmDialog, installClearButtons, keysOnly, menuIcon } from './pop.js';
import { prepareUpload } from './compress.js';
import { Keymap, prettyKey, isTyping, keyAlternatives } from './commands.js';
import { openHistory, openTrash, openConflicts, openAllComments } from './keep.js';
import { describeRemind, remindMenu, remindAtMenu, remindChip, remindDateProp, REMIND_TIMED, REMIND_DAY } from './reminders.js';
import { fmtWhen, fromLocalIso } from '../when.js';
import { Notifications, nbCount, nbDot } from './notify.js';
import { databaseCsv, entryProps, exportDatabase, exportEntry, exportHtml, exportPage, safeName, saveFile } from '../exporter/export.js';
import { openFind, closeFind } from './find.js';
import { calendars } from '../sync/service.js';
import { editValue, renderValue, setAssetResolver, setRowOpener, typeIcon } from '../views/cells.js';
import { renderViewBlock } from '../views/view.js';
/** font presets: id, label, CSS font stack */
export const FONTS = [
    // Geist is Nook's font; serif and monospace are the only alternatives
    ['system', 'Geist', 'Geist, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif'],
    ['serif', 'Serif', 'ui-serif, "Iowan Old Style", Charter, Georgia, Cambria, serif'],
    ['mono', 'Monospace', 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace'],
];
const TAURI = typeof window !== 'undefined' && !!window.__TAURI__;
// a narrow window, or a phone held sideways (wide but very low, and touched)
export class App {
    ws;
    shell;
    root;
    route = null;
    lastRoute = '';
    /** phone: the Pages screen (instead of the sidebar) is showing; `libraryAt`: the page whose subpages it lists */
    libraryOn = false;
    /** where each Library list was scrolled to (back from a page returns there) */
    libScroll = new Map();
    libScrollWatch = document.addEventListener('scroll', (e) => {
        const t = e.target;
        if (this.libraryOn && t instanceof HTMLElement && t.matches('.main > .scroll'))
            this.libScroll.set(this.libraryAt ?? '', t.scrollTop);
    }, true);
    libraryAt = null;
    pagesQuery = '';
    /** sidebar item that has the keyboard focus (after clicking it) */
    sideFocus = null;
    /** start of links to this workspace ("#ws=Name"), set by main.ts */
    linkBase = '';
    keymap;
    sidebarOpen;
    /** sidebar: collapsed sections and expanded pages (per computer, like Notion) */
    side = { closed: new Set(), open: new Set() };
    sideKey() { return `nook:side:${this.ws.meta.name}`; }
    loadSide() {
        try {
            const v = JSON.parse(localStorage.getItem(this.sideKey()) ?? '{}');
            this.side = { closed: new Set(v.closed ?? []), open: new Set(v.open ?? []) };
        }
        catch { /* defaults */ }
    }
    saveSide() { try {
        localStorage.setItem(this.sideKey(), JSON.stringify({ closed: [...this.side.closed], open: [...this.side.open] }));
    }
    catch { /* private window */ } }
    history = [];
    cleanup = () => { };
    /** Notifications (reminders, conflicts …) – see notify.ts */
    notes;
    constructor(ws, shell, mount) {
        this.ws = ws;
        this.shell = shell;
        this.root = mount;
        ws.activate();
        // your own widgets (.workspace/widgets/*.js): loaded in the background, then drawn
        void loadCustomWidgets(ws).then((errs) => { if (errs.length)
            toast(`Widget problem: ${errs.join(' · ')}`, 8000); this.render(); });
        // on a phone the sidebar slides in over the page when asked for
        this.sidebarOpen = ws.settings.sidebar && !isPhone();
        document.documentElement.classList.toggle('phone', isPhone());
        this.loadSide();
        try {
            const w = Number(localStorage.getItem('nook:sidebar-width'));
            if (w)
                this.setSideWidth(w, false);
        }
        catch { /* defaults */ }
        this.keymap = new Keymap(ws.keymap);
        this.registerCommands();
        setShortcutHint((id) => prettyKey(keyAlternatives(this.keymap.binding(id))[0] ?? ''));
        setAssetResolver((p) => this.assetUrl(p));
        setRowOpener((d, r) => this.openRow(d, r));
        installSelectionKeys();
        installClearButtons();
        this.applySettings();
        calendars.attach(ws);
        attachSources(ws);
        void ws.whenFresh().then(() => ws.tidyConflicts()).then((n) => { if (n)
            this.render(); });
        const home = ws.homePage();
        const saved = sessionStorageGet(`nook:route:${ws.meta.name}`);
        if (saved && saved.kind === 'page' && ws.pages.has(saved.id))
            this.route = saved;
        else if (home)
            this.route = { kind: 'page', id: home.id };
        // a phone opens where you chose (Settings → Navigation → Open on): the start page, Pages, or the last page
        if (isPhone() && !saved) {
            const on = phonePref().start;
            if (on === 'pages')
                this.libraryOn = true;
            else if (on === 'last') {
                const l = this.recent()[0];
                if (l?.startsWith('page:') && ws.pages.has(l.slice(5)))
                    this.route = { kind: 'page', id: l.slice(5) };
                else if (l?.startsWith('db:') && ws.dbs.has(l.slice(3)))
                    this.route = { kind: 'db', key: l.slice(3) };
            }
        }
        this.render();
        // pages added, renamed or moved anywhere (also without opening them) show up in the sidebar
        let sideQueued = false;
        const offSide = ws.onChange(() => { if (sideQueued)
            return; sideQueued = true; queueMicrotask(() => { sideQueued = false; this.refreshSide(); }); });
        // every saved change: names everywhere (sidebar, favorites, breadcrumbs, titles, page links) follow at once
        const offNames = ws.onWrite(() => { this.refreshSide(); this.syncNames(); });
        const onKey = (e) => {
            if (document.querySelector('.overlay') && !e.metaKey && !e.ctrlKey)
                return;
            this.keymap.handle(e);
        };
        // pick up changes Dropbox synced from other computers when the desktop window comes back
        const onFocus = () => {
            // storages that report changes themselves (Dropbox) need no re-read here
            if (!this.ws.storage.readAll || this.ws.storage.watch)
                return;
            const busy = document.querySelector('.overlay:not(.phone-page), .pop') || (document.activeElement && document.activeElement !== document.body);
            if (!busy)
                this.reload(true);
        };
        // working somewhere else ends the sidebar's keyboard focus
        const onFocusIn = (e) => { if (!e.target?.closest?.('.sidebar'))
            this.sideFocus = null; };
        document.addEventListener('keydown', onKey);
        document.addEventListener('focusin', onFocusIn);
        window.addEventListener('focus', onFocus);
        const onOpenSettings = (e) => this.settingsDialog(e.detail);
        window.addEventListener('nook-open-settings', onOpenSettings);
        const self = this;
        this.notes = new Notifications({ get ws() { return self.ws; }, openRow: (d, r) => this.openRow(d, r), openPage: (id) => this.openPage(id), openConflicts: () => openConflicts(this.ws, this, () => this.render()), render: () => this.render() });
        const stopReminders = this.notes.start();
        // "Match the computer": follow the system's dark / light setting live
        const mq = matchMedia('(prefers-color-scheme: light)');
        const onScheme = () => { if (this.ws.settings.theme === 'system') {
            this.applySettings();
            this.render();
        } };
        mq.addEventListener('change', onScheme);
        // phone ↔ wider window: the layout changes (sidebar as a drawer, tab bar)
        const phoneMq = matchMedia(PHONE_QUERY);
        const onPhone = () => { document.documentElement.classList.toggle('phone', phoneMq.matches); this.applySettings(); if (phoneMq.matches)
            this.sidebarOpen = false; this.render(); };
        phoneMq.addEventListener('change', onPhone);
        this.cleanup = () => { document.removeEventListener('keydown', onKey); document.removeEventListener('focusin', onFocusIn); window.removeEventListener('focus', onFocus); window.removeEventListener('nook-open-settings', onOpenSettings); stopReminders(); mq.removeEventListener('change', onScheme); offSide(); offNames(); phoneMq.removeEventListener('change', onPhone); };
    }
    destroy() { this.cleanup(); calendars.detach(); this.root.textContent = ''; }
    applySettings() {
        const s = this.ws.settings;
        // theme and look: one background colour → every surface; the modern look is one extra stylesheet
        const mode = s.theme === 'light' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
        const root = document.documentElement;
        root.dataset.theme = mode;
        setPalette(mode);
        const bg = s.background?.[mode] ?? DEFAULT_BG[mode];
        for (const [k, v] of Object.entries(themeVars(mode, bg)))
            root.style.setProperty(k, v);
        if (s.density === 'comfortable')
            s.density = 'compact'; // removed option
        document.documentElement.dataset.density = s.density;
        document.documentElement.toggleAttribute('data-blur', !!s.blur);
        // Appearance → Scale
        // the system's bars (iPhone status bar, the fades at the screen edges) take the page's colour
        requestAnimationFrame(() => {
            const bg = getComputedStyle(document.body).backgroundColor;
            for (const m of document.querySelectorAll('meta[name="theme-color"]'))
                m.content = bg;
        });
        // the scale setting is for computers; a phone shows Nook at its own size
        document.documentElement.style.zoom = s.zoom && s.zoom !== 100 && !isPhone() ? String(s.zoom / 100) : '';
        setOpenWith(s.openWith);
        // the modern look uses Geist when it's available (installed, or online), else the system font
        const fontStack = (FONTS.find((f) => f[0] === s.font) ?? FONTS[0])[2];
        document.documentElement.style.setProperty('--font', fontStack);
        document.documentElement.style.setProperty('--mono', '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace');
        document.documentElement.style.setProperty('--accent', /^#[0-9a-f]{6}$/i.test(s.accent ?? '') ? s.accent : '#2383e2');
        setTimeFormat(s.timeFormat ?? '24h');
        setDateFormat(s.dateFormat ?? 'DD.MM.YYYY');
        setNumberLocale(this.ws.meta.locale);
        setDefaultBlockSize(s.blockSize);
        setWeekStart(s.weekStart ?? 'mon');
        applyColors(s.colors, s.contrast ?? 0, s.colorSat ?? 0, s.colorLight ?? 0, s.colorShade ?? 0);
        document.title = `${this.notes?.count() ? `(${this.notes.count()}) ` : ""}${this.ws.meta.name} · ${APP.name}`;
    }
    // ---------- Ctx ----------
    /** URL of a page of this workspace (opened in a new tab by middle-click) */
    pageUrl(id) { if (id.startsWith('db:'))
        return `${location.pathname}${this.linkBase || '#'}&db=${encodeURIComponent(id.slice(3))}`; const row = parseRowTarget(id); return row ? `${location.pathname}${this.linkBase || '#'}&row=${encodeURIComponent(row.db)}/${encodeURIComponent(row.id)}` : `${location.pathname}${this.linkBase || '#'}&p=${encodeURIComponent(id)}`; }
    /** linkTo, returning the element */
    linked(id, el) { this.linkTo(el, id); return el; }
    linkTo(el, pageId) {
        if (TAURI)
            return; // the desktop app has one window
        const openTab = (e) => { e.preventDefault(); e.stopImmediatePropagation(); window.open(this.pageUrl(pageId), '_blank'); };
        el.addEventListener('mousedown', (e) => { if (e.button === 1)
            e.preventDefault(); }); // no autoscroll
        el.addEventListener('auxclick', (e) => { if (e.button === 1)
            openTab(e); });
        el.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey)
            openTab(e); }, true);
        el.title = el.title ? el.title : 'Middle-click or ⌘-click: open in a new tab';
    }
    syncUrl() {
        // phone: the bottom bar's Home follows the route (navigation does not always redraw the bar)
        const home = this.ws.homePage();
        this.root.querySelector('.tab-bar .tab')?.classList.toggle('on', !this.libraryOn && this.route?.kind === 'page' && this.route.id === home?.id);
        this.root.querySelectorAll('.tab-bar .tab')[2]?.classList.toggle('on', this.sidebarOpen || this.libraryOn);
        if (!this.libraryOn)
            this.noteRecent();
        if (TAURI || !this.linkBase)
            return;
        const r = this.route;
        const hash = r?.kind === 'page' ? `${this.linkBase}&p=${encodeURIComponent(r.id)}` : r?.kind === 'row' ? `${this.linkBase}&row=${encodeURIComponent(r.db)}/${encodeURIComponent(r.id)}` : r?.kind === 'db' ? `${this.linkBase}&db=${encodeURIComponent(r.key)}` : this.linkBase;
        try {
            history.replaceState(null, '', hash);
        }
        catch { /* ignore */ }
    }
    /** jump to the page / entry / database named in a link (#…&p=id) */
    openFromHash(hash) {
        const q = new URLSearchParams(hash.replace(/^#/, ''));
        const p = q.get('p'), row = q.get('row'), db = q.get('db');
        if (p && (this.ws.pages.has(p) || resolveRowTarget(this.ws, p)))
            this.openPage(p);
        else if (db && this.ws.dbs.has(db))
            this.openDb(db);
        else if (row) {
            const i = row.indexOf('/');
            if (i > 0) {
                const entry = resolveRowTarget(this.ws, rowTarget(row.slice(0, i), row.slice(i + 1)));
                if (entry)
                    this.openRowPage(entry.db, entry.row);
            }
        }
    }
    openPage(id) {
        const entry = resolveRowTarget(this.ws, id);
        if (entry) {
            this.openRowPage(entry.db, entry.row);
            return;
        }
        if (!this.ws.pages.has(id)) {
            toast('Page not found');
            return;
        }
        this.go({ kind: 'page', id });
        closeFind(); // the marks belong to the page that was open
        sessionStorageSet(`nook:route:${this.ws.meta.name}`, this.route);
        this.navigate(); // a new page starts at the top (its scroll area is new)
    }
    /** a view to show when a database page opens (e.g. from Data sources: entries without a picture) */
    dbViewWanted = new Map();
    openDb(key, view) {
        if (view)
            this.dbViewWanted.set(key, view);
        else
            this.dbViewWanted.delete(key);
        this.go({ kind: 'db', key });
        this.navigate();
    }
    refresh() { this.render(); }
    refreshSidebar() {
        const old = this.root.querySelector('.sidebar');
        if (!old)
            return;
        const top = old.querySelector('.sidebar-body')?.scrollTop ?? 0;
        const fresh = this.sidebar();
        fresh.style.animation = 'none'; // already open: no slide-in again
        old.replaceWith(fresh);
        const body = fresh.querySelector('.sidebar-body');
        if (body)
            body.scrollTop = top;
    }
    isDbPage(key) { return this.route?.kind === 'db' && this.route.key === key; }
    async assetUrl(path) { return this.ws.storage.assetUrl ? this.ws.storage.assetUrl(path) : path; }
    // ---------- layout ----------
    /** Going to another page: only the top bar and the content are built again; the sidebar stays and
     *  just moves its highlight (fast with many pages). Falls back to a full render when the sidebar
     *  would have to change (e.g. the page's parents are folded). */
    navigate() {
        endSelectMode(); // picking entries ends with the page it happened on
        const app = this.root.querySelector(':scope > .app');
        const main = app?.querySelector(':scope > .main');
        const side = app?.querySelector(':scope > .sidebar');
        const r = this.route;
        const folded = r?.kind === 'page' && (() => { for (let q = this.ws.pages.get(r.id)?.parent; q; q = this.ws.pages.get(q)?.parent)
            if (!this.side.open.has(q))
                return true; return false; })();
        if (!app || !main || !!side !== this.sidebarOpen || folded) {
            this.render();
            return;
        }
        this.refreshSide();
        this.syncUrl();
        this.lastRoute = JSON.stringify(r);
        main.querySelector(':scope > .topbar')?.replaceWith(this.topbar());
        const scroll = h('div', { class: 'scroll' }, this.content());
        main.querySelector(':scope > .scroll')?.replaceWith(scroll);
        const id = r?.kind === 'page' ? `page:${r.id}` : r?.kind === 'db' ? `db:${r.key}` : '';
        side?.querySelectorAll('[data-side-id]').forEach((el) => el.classList.toggle('active', el.dataset.sideId === id));
        if (this.sideFocus)
            side?.querySelector(`.side-item[data-side-id="${CSS.escape(this.sideFocus)}"]`)?.focus({ preventScroll: true });
    }
    /** what the sidebar shows; when it changes (a page was added, moved, renamed …) the sidebar is drawn again */
    sideSig = '';
    sideSignature() {
        const pages = [...this.ws.pages.values()].map((p) => `${p.id}|${p.parent ?? ''}|${p.title}|${p.icon ?? ''}|${p.order ?? ''}`).join('\n');
        const dbs = [...this.ws.dbs.values()].map((d) => `${d.key}|${d.schema.name}|${d.schema.icon ?? ''}`).join('\n');
        return `${pages}\n#${dbs}\n#${JSON.stringify(this.ws.settings.favorites ?? [])}#${JSON.stringify(this.ws.settings.quickButtons ?? [])}`;
    }
    // ---------- live names ----------
    // Everything that shows the name of a page, database or entry carries data-name="page:<id>" | "db:<key>" |
    // "row:<db>:<id>" (sidebar items: data-side-id). syncNames() puts the current names in after every saved
    // change; while a name is typed, liveName() shows it everywhere before it is saved.
    liveNames = new Map();
    nameFor(ref) {
        const i = ref.indexOf(':');
        const kind = ref.slice(0, i), id = ref.slice(i + 1);
        if (this.liveNames.has(ref))
            return this.liveNames.get(ref);
        if (kind === 'page') {
            const p = this.ws.pages.get(id);
            return p ? (p.title || 'Untitled') : null;
        }
        if (kind === 'db')
            return this.ws.dbs.get(id)?.schema.name ?? null;
        if (kind === 'row') {
            const j = id.indexOf(':');
            const db = this.ws.dbs.get(id.slice(0, j));
            const row = db?.rows.find((r) => r.id === id.slice(j + 1));
            return db && row ? (db.rowLabel(row)) : null;
        }
        return null;
    }
    /** shows a name that is being typed everywhere (null: back to the saved one) */
    liveName(ref, text) {
        if (text == null)
            this.liveNames.delete(ref);
        else
            this.liveNames.set(ref, text || 'Untitled');
        this.syncNames();
    }
    syncNames() {
        const active = document.activeElement;
        const put = (el, t) => {
            if (t == null || el === active)
                return;
            if (el.classList.contains('page-title') && t === 'Untitled')
                t = ''; // an untitled page shows its placeholder
            if (el.textContent !== t)
                el.textContent = t;
        };
        this.root.querySelectorAll('[data-side-id]').forEach((item) => {
            const t = this.nameFor(item.dataset.sideId);
            if (t == null)
                return;
            item.querySelectorAll(':scope > .t, :scope > .fav-name').forEach((x) => put(x, t));
            if (item.classList.contains('fav-tile') && item.title !== t) {
                item.title = t;
                item.setAttribute('aria-label', t);
            }
        });
        document.querySelectorAll('[data-name]').forEach((el) => {
            const ref = el.dataset.name;
            // an entry's own title field shows the title as stored (with its formatting), not the plain name
            if (ref.startsWith('row:') && el.classList.contains('page-title') && !this.liveNames.has(ref)) {
                const j = ref.indexOf(':', 4);
                const db = this.ws.dbs.get(ref.slice(4, j));
                const row = db?.rows.find((r) => r.id === ref.slice(j + 1));
                if (db && row && el !== active) {
                    const raw = db.dateLabel ? db.rowLabel(row) : String(row.values[db.titleProp] ?? '');
                    if (el.textContent !== raw)
                        el.textContent = raw;
                }
                return;
            }
            put(el, this.nameFor(ref));
        });
    }
    /** a database got a new key (its folder was renamed): elements that point at it follow */
    rekeyDb(old, key) {
        document.querySelectorAll(`[data-name="db:${CSS.escape(old)}"]`).forEach((el) => { el.dataset.name = `db:${key}`; });
        document.querySelectorAll(`[data-name^="row:${CSS.escape(old)}:"]`).forEach((el) => { el.dataset.name = `row:${key}:${el.dataset.name.slice(`row:${old}:`.length)}`; });
        const n = this.liveNames.get(`db:${old}`);
        if (n != null) {
            this.liveNames.delete(`db:${old}`);
            this.liveNames.set(`db:${key}`, n);
        }
    }
    /** the sidebar alone, drawn again only if something in it changed (keeps its scroll position) */
    /** only the sidebar is drawn again (opening a folder must not rebuild the page) */
    redrawSide() { this.sideSig = ''; this.refreshSide(); }
    refreshSide() {
        const sig = this.sideSignature();
        if (sig === this.sideSig)
            return;
        const old = this.root.querySelector(':scope > .app > .sidebar');
        // a name being typed in the sidebar (F2) stays; the sidebar is drawn again when it is done
        if (old?.contains(document.activeElement) && document.activeElement?.classList.contains('side-rename'))
            return;
        if (!old) {
            this.sideSig = sig;
            return;
        }
        const top = old.querySelector('.sidebar-body')?.scrollTop ?? 0;
        const fresh = this.sidebar();
        fresh.style.animation = 'none'; // already open: no slide-in again
        old.replaceWith(fresh);
        const body = fresh.querySelector('.sidebar-body');
        if (body)
            body.scrollTop = top;
        this.sideSig = sig;
    }
    render() {
        this.sideSig = this.sideSignature();
        this.syncUrl();
        const oldScroll = this.root.querySelector('.scroll');
        const scrollTop = oldScroll?.scrollTop ?? 0;
        // the Pages screen counts as a place of its own: switching to or from it starts at the top
        // (it once kept the page's scroll position and height, so Pages opened scrolled far down)
        const here = JSON.stringify(this.route) + (this.libraryOn ? `|pages:${this.libraryAt ?? ''}` : '');
        const sameRoute = here === this.lastRoute;
        this.lastRoute = here;
        // the content's own height (not the scroll height: that would add the page's padding on every redraw and grow)
        const oldHeight = sameRoute ? oldScroll?.firstElementChild?.offsetHeight ?? 0 : 0;
        const sideTop = this.root.querySelector('.sidebar-body')?.scrollTop ?? 0;
        this.root.textContent = '';
        const app = h('div', { class: 'app' });
        if (this.sidebarOpen)
            app.appendChild(this.sidebar());
        const main = h('div', { class: 'main' });
        // a phone has no top bar: the page starts right away (Pages and ⋯ are in the bottom bar)
        if (!isPhone())
            main.appendChild(this.topbar());
        const scroll = h('div', { class: 'scroll' });
        scroll.appendChild(this.content());
        // phone: the page's own options (⋯) at the top right of the page – the bottom bar is for places
        main.appendChild(scroll);
        // (it stays put while the page scrolls, level with the page's icon and title – and is kept there when
        // another page, database or entry replaces the content without a full redraw)
        if (isPhone()) {
            let tries = 0;
            let mo = null;
            const place = () => {
                // always the screen as it is now (an older redraw's main/scroll may be gone)
                const main = this.root.querySelector('.app .main');
                const scroll = main?.querySelector(':scope > .scroll');
                if (!main || !scroll)
                    return;
                // keep watching whatever is there now
                mo?.observe(main, { childList: true });
                mo?.observe(scroll, { childList: true });
                for (const c of [...scroll.children])
                    mo?.observe(c, { childList: true });
                let b = main.querySelector(':scope > .page-more');
                const head = scroll.querySelector(':scope .page-head');
                if (this.libraryOn || !head) {
                    b?.remove();
                    return;
                }
                if (!b) {
                    const nb = h('button', { class: 'icon-btn page-more', 'aria-label': 'Page options', onclick: () => this.moreMenu(nb) }, svgIcon(ICONS.more, 20, { fill: true }));
                    main.appendChild(nb);
                    b = nb;
                }
                const ref = head.querySelector('.page-icon:not(.empty)') ?? head.querySelector('.page-title') ?? head;
                // from the layout (not the screen position – a page sliding in would put it off by the slide)
                if (!ref.offsetHeight) {
                    b.style.visibility = 'hidden';
                    if (tries++ < 20)
                        setTimeout(place, 80);
                    return;
                }
                b.style.visibility = '';
                tries = 0;
                let y = 0;
                for (let e = ref; e && e !== scroll; e = e.offsetParent) {
                    y += e.offsetTop;
                    if (!e.offsetParent || !scroll.contains(e.offsetParent))
                        break;
                }
                b.style.top = `${Math.round(y + scroll.offsetTop + ref.offsetHeight / 2 - 20)}px`;
            };
            requestAnimationFrame(place);
            setTimeout(place, 350);
            // (pages, databases and Library swap the content – or the whole scrolling box – without a full redraw)
            let q = false;
            mo = new MutationObserver(() => { if (q)
                return; q = true; requestAnimationFrame(() => { q = false; place(); }); setTimeout(place, 350); });
            mo.observe(main, { childList: true });
            mo.observe(scroll, { childList: true });
            for (const c of [...scroll.children])
                mo.observe(c, { childList: true });
        }
        // Settings → Appearance → "Workspace bar when the sidebar is closed": floating in the bottom left
        if (!this.sidebarOpen && this.ws.settings.wsFloat)
            main.appendChild(h('div', { class: 'ws-float' }, this.wsbarInner()));
        app.appendChild(main);
        if (isPhone()) {
            main.appendChild(this.tabBar());
            if (this.sidebarOpen)
                app.appendChild(h('div', { class: 'side-backdrop', onclick: () => this.toggleSidebar() }));
        }
        this.root.appendChild(app);
        this.notes?.paint();
        if (isPhone()) {
            // the sidebar ends at the bottom bar
            const tb = this.root.querySelector('.tab-bar');
            if (tb)
                requestAnimationFrame(() => document.documentElement.style.setProperty('--tabbar-h', `${tb.offsetHeight}px`));
        }
        // re-drawing the same page: pictures and embeds load again, so hold the old height for a
        // moment – otherwise the page would jump up while they load
        // (only when needed: asking for sizes makes the browser lay out the page right away)
        if (oldHeight && oldHeight > scroll.clientHeight) {
            const content = scroll.firstElementChild;
            if (content) {
                content.style.boxSizing = 'border-box';
                content.style.minHeight = `${oldHeight}px`;
                setTimeout(() => { content.style.minHeight = ''; content.style.boxSizing = ''; }, 1500);
            }
        }
        if (sameRoute && scrollTop)
            scroll.scrollTop = scrollTop;
        const sb = this.root.querySelector('.sidebar-body');
        if (sb && sideTop)
            sb.scrollTop = sideTop; // choosing something in the sidebar never scrolls it
        if (this.sideFocus)
            this.root.querySelector(`.side-item[data-side-id="${CSS.escape(this.sideFocus)}"]`)?.focus({ preventScroll: true });
    }
    content() {
        if (this.libraryOn && isPhone())
            return this.libraryScreen();
        const r = this.route;
        if (r?.kind === 'page') {
            const p = this.ws.pages.get(r.id);
            if (p)
                return this.pageView(p);
        }
        if (r?.kind === 'db') {
            const db = this.ws.dbs.get(r.key);
            if (db)
                return this.dbPage(db);
        }
        if (r?.kind === 'row') {
            const db = this.ws.dbs.get(r.db);
            const row = db?.rows.find((x) => x.id === r.id);
            if (db && row)
                return this.rowFullPage(db, row);
        }
        return h('div', { class: 'welcome' }, h('h1', null, this.ws.meta.name), h('p', { class: 'muted' }, 'No page selected.'), h('button', { class: 'big primary', onclick: async () => { const p = await this.ws.createPage('Home'); this.ws.meta.home = p.id; await this.ws.saveMeta(); this.openPage(p.id); } }, 'Create a start page'));
    }
    sidebar() {
        const ws = this.ws;
        const cur = this.route;
        const item = (icon, label, active, onclick, ctxMenu, depth = 0, linkPage) => {
            // remember the item you clicked: it keeps the keyboard focus after the page opens (F2 renames it)
            const sideId = linkPage ? `page:${linkPage}` : sideDb ? `db:${sideDb}` : undefined;
            const b = h('button', { class: 'side-item' + (active ? ' active' : ''), 'data-side-id': sideId, onclick: () => { this.sideFocus = sideId ?? null; onclick(); }, style: { paddingLeft: `${8 + depth * 14}px` } }, icon === '+' ? h('span', { class: 'ico' }, svgIcon(ICONS.plus, 15)) : renderIcon(icon, 16, fallbackIcon), h('span', { class: 't' }, label));
            if (ctxMenu)
                b.addEventListener('contextmenu', (e) => { e.preventDefault(); ctxMenu({ x: e.clientX, y: e.clientY }); });
            if (linkPage)
                this.linkTo(b, linkPage);
            else if (sideDb)
                this.linkTo(b, `db:${sideDb}`);
            return b;
        };
        let fallbackIcon = 'file';
        let sideDb;
        const itemDb = (key, ...a) => { fallbackIcon = 'database'; sideDb = key; const el = item(...a); sideDb = undefined; fallbackIcon = 'file'; return el; };
        const body = h('div', { class: 'sidebar-body' });
        /** a section with a heading that folds it away (Favorites, Pages, Databases) */
        const section = (key, label, items, labelEl) => {
            const closed = this.side.closed.has(key);
            const head = h('button', { class: 'side-label' + (closed ? ' closed' : ''), 'aria-expanded': String(!closed), title: closed ? `Show ${label}` : `Hide ${label}`,
                onclick: () => { closed ? this.side.closed.delete(key) : this.side.closed.add(key); this.saveSide(); this.redrawSide(); } }, h('span', null, label), svgIcon(closed ? ICONS.chevronR : ICONS.chevron, 12));
            labelEl?.(head);
            // drag a section's label to move the whole section (order is kept in the workspace settings)
            head.draggable = true;
            head.addEventListener('dragstart', (e) => { e.dataTransfer?.setData('nook/section', key); if (e.dataTransfer)
                e.dataTransfer.effectAllowed = 'move'; dragSection = key; });
            head.addEventListener('dragend', () => { dragSection = null; body.querySelectorAll('.sec-drop-before, .sec-drop-after').forEach((x) => x.classList.remove('sec-drop-before', 'sec-drop-after')); });
            const sec = h('div', { class: 'side-section', 'data-section': key }, head, closed ? null : items());
            sec.addEventListener('dragover', (e) => {
                if (!dragSection || dragSection === key)
                    return;
                e.preventDefault();
                e.stopPropagation();
                const r = sec.getBoundingClientRect(), after = e.clientY > r.top + Math.min(r.height / 2, 40);
                body.querySelectorAll('.sec-drop-before, .sec-drop-after').forEach((x) => x.classList.remove('sec-drop-before', 'sec-drop-after'));
                sec.classList.add(after ? 'sec-drop-after' : 'sec-drop-before');
            });
            sec.addEventListener('drop', (e) => {
                if (!dragSection || dragSection === key)
                    return;
                e.preventDefault();
                e.stopPropagation();
                const after = sec.classList.contains('sec-drop-after');
                const order = [...body.querySelectorAll(':scope > .side-section')].map((x) => x.dataset.section).filter((k) => k !== dragSection);
                order.splice(order.indexOf(key) + (after ? 1 : 0), 0, dragSection);
                ws.settings.sideOrder = order;
                void ws.saveSettings();
                dragSection = null;
                this.render();
            });
            return sec;
        };
        let dragSection = null;
        const dbMenu = (db) => (at) => this.dbSideMenu(db, at);
        const favOf = (id) => {
            if (id.startsWith('db:')) {
                const db = ws.dbs.get(id.slice(3));
                return db ? { id, icon: db.schema.icon, title: db.schema.name, active: cur?.kind === 'db' && cur.key === db.key, open: () => this.openDb(db.key), menu: dbMenu(db), db: db.key } : null;
            }
            const p = ws.pages.get(id);
            return p ? { id, icon: p.icon, title: p.title, active: cur?.kind === 'page' && cur.id === p.id, open: () => this.openPage(p.id), menu: (at) => this.pageMenu(p, at), page: p.id } : null;
        };
        const home = ws.homePage();
        const favIds = ws.settings.favorites.filter((id) => id !== home?.id);
        const pinned = [...(home ? [favOf(home.id)] : []), ...favIds.map(favOf)].filter(Boolean);
        // Favorites: a list, or icons (normal / large) in rows of your choosing – right-click the label
        const fv = ws.settings.favView ?? { style: 'large' };
        if (pinned.length)
            body.appendChild(section('favorites', 'Favorites', () => {
                if (fv.style === 'list')
                    return pinned.map((f) => { const el = f.db ? itemDb(f.db, f.icon, f.title, f.active, f.open, f.menu) : item(f.icon, f.title, f.active, f.open, f.menu, 0, f.page); this.favDrag(el, f.id, home?.id === f.id, false); return el; });
                const large = fv.style === 'large';
                const grid = h('div', { class: 'fav-grid' + (large ? ' large' : '') });
                grid.style.setProperty('--fav-cols', String(fv.perRow ?? (large ? 3 : 5)));
                for (const f of pinned) {
                    const b = h('button', { class: 'fav-tile' + (f.active ? ' active' : ''), 'data-side-id': f.db ? `db:${f.db}` : `page:${f.page}`, title: f.title, 'aria-label': f.title, onclick: f.open }, renderIcon(f.icon, large ? 22 : 17, f.db ? 'database' : 'file'), large ? h('span', { class: 'fav-name' }, f.title) : null);
                    b.addEventListener('contextmenu', (e) => { e.preventDefault(); f.menu({ x: e.clientX, y: e.clientY }); });
                    if (f.page)
                        this.linkTo(b, f.page);
                    else if (f.db)
                        this.linkTo(b, `db:${f.db}`);
                    this.favDrag(b, f.id, home?.id === f.id, true);
                    grid.appendChild(b);
                }
                return [grid];
            }, (label) => label.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const set = (v) => { ws.settings.favView = { ...fv, ...v }; if (ws.settings.favView.style === 'list')
                    delete ws.settings.favView.perRow; void ws.saveSettings(); this.render(); };
                menu({ x: e.clientX, y: e.clientY }, [
                    { section: 'Show favorites as' },
                    { label: `${fv.style === 'list' ? '✓' : '   '} List`, run: () => set({ style: 'list' }) },
                    { label: `${fv.style === 'icons' ? '✓' : '   '} Icons`, run: () => set({ style: 'icons' }) },
                    { label: `${fv.style === 'large' ? '✓' : '   '} Large icons`, run: () => set({ style: 'large' }) },
                    ...(fv.style !== 'list' ? [{ section: 'Per row' }, ...[2, 3, 4, 5, 6, 7].map((n) => ({ label: `${(fv.perRow ?? (fv.style === 'large' ? 3 : 5)) === n ? '✓' : '   '} ${n}`, run: () => set({ perRow: n }) }))] : []),
                ]);
            })));
        // quick buttons (Add to quick buttons on a button): one click runs them; drag to reorder
        const quick = (ws.settings.quickButtons ?? []).map((q) => ({ q, f: this.findButton(q.page, q.block, q.label) })).filter((x) => x.f);
        if (quick.length)
            body.appendChild(section('quick', 'Quick buttons', () => quick.map(({ q, f }) => {
                const c = f.block.color && f.block.color !== 'default' ? `var(--c-${f.block.color})` : 'var(--accent)';
                const el = h('button', { class: 'side-item', title: `Run – on “${f.page.title}”`, onclick: () => this.runJump({ key: '', button: { page: q.page, block: q.block, label: q.label } }) }, h('span', { class: 'ico', style: { color: c } }, f.block.icon ? renderIcon(f.block.icon, 15) : iconSvg('zap', 15)), h('span', { class: 't' }, f.block.text || 'Button'));
                el.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    menu({ x: e.clientX, y: e.clientY }, [
                        { label: 'Go to its page', icon: menuIcon('arrow-right'), run: () => this.openPage(q.page) },
                        { label: 'Remove from quick buttons', icon: menuIcon('x-bold'), run: async () => { ws.settings.quickButtons = (ws.settings.quickButtons ?? []).filter((x) => x !== q); await ws.saveSettings(); this.render(); } }
                    ]);
                });
                this.favDrag(el, q.block, false, false, 'quick');
                return el;
            })));
        const children = (parent) => this.childPages(parent);
        // the page you are on is always visible: its parents are unfolded
        if (cur?.kind === 'page')
            for (let q = ws.pages.get(cur.id)?.parent; q; q = ws.pages.get(q)?.parent)
                this.side.open.add(q);
        // a phone shows the top level only, without folding: subpages are opened from their page
        const phone = isPhone();
        const tree = (parent, depth) => children(parent).flatMap((p) => {
            const el = item(p.icon, p.title, cur?.kind === 'page' && cur.id === p.id, () => this.openPage(p.id), (at) => this.pageMenu(p, at), depth, p.id);
            const kids = phone ? 0 : children(p.id).length;
            const open = this.side.open.has(p.id);
            if (kids) {
                // as in Notion: the icon turns into an arrow on hover that folds the subpages
                el.classList.add('has-kids');
                if (open)
                    el.classList.add('open');
                const tog = h('span', { class: 'side-tog', role: 'button', 'aria-label': open ? `Collapse ${p.title}` : `Expand ${p.title} (${kids} subpages)`, title: open ? 'Collapse' : `Expand · ${kids} subpage${kids > 1 ? 's' : ''}`,
                    onclick: (e) => { e.stopPropagation(); open ? this.side.open.delete(p.id) : this.side.open.add(p.id); this.saveSide(); this.redrawSide(); } }, svgIcon(open ? ICONS.chevron : ICONS.chevronR, 14));
                const ico = el.querySelector('.ico');
                if (ico)
                    ico.appendChild(tog);
                else
                    el.prepend(tog);
            }
            el.appendChild(h('span', { class: 'side-add', role: 'button', title: 'Add a subpage', 'aria-label': `Add a subpage to ${p.title}`, onclick: (e) => { e.stopPropagation(); this.side.open.add(p.id); this.saveSide(); this.newPage(p.id); } }, svgIcon(ICONS.plus, 13)));
            this.sideDrag(el, p);
            return [el, ...(kids && open ? tree(p.id, depth + 1) : [])];
        });
        body.appendChild(section('pages', 'Pages', () => [...tree(undefined, 0), item('+', 'New page', false, () => this.newPage())], (el) => this.sideDropTop(el)));
        body.appendChild(section('databases', 'Databases', () => [...ws.dbs.values()].sort((a, b) => a.schema.name.localeCompare(b.schema.name)).map((db) => itemDb(db.key, db.schema.icon, db.schema.name, cur?.kind === 'db' && cur.key === db.key, () => this.openDb(db.key), (at) => this.dbSideMenu(db, at))).concat(item('+', 'New database', false, () => this.newDatabase()))));
        // drag the right edge to change the width (double-click: back to normal), as in Notion
        const grab = h('div', { class: 'side-resize', title: 'Drag to resize · double-click to reset', 'aria-hidden': 'true' });
        grab.addEventListener('mousedown', (e) => {
            if (e.button !== 0)
                return;
            e.preventDefault();
            const x0 = e.clientX, w0 = this.sideWidth();
            document.body.classList.add('resizing-side');
            const move = (ev) => this.setSideWidth(w0 + ev.clientX - x0, false);
            const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('resizing-side'); this.setSideWidth(this.sideWidth(), true); };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
        grab.addEventListener('dblclick', () => this.setSideWidth(228, true));
        // ↑ / ↓ move between sidebar items, Enter opens (the item is a button)
        body.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')
                return;
            const items = [...body.querySelectorAll('.side-item[data-side-id]')];
            const i = items.indexOf(document.activeElement);
            if (i < 0)
                return;
            e.preventDefault();
            const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
            this.sideFocus = next.dataset.sideId ?? null;
            next.focus();
            next.scrollIntoView({ block: 'nearest' });
        });
        // the trash is a place you go to (an entry at the end of the list), not a button next to the page
        const wsItems = [
            ['trash', 'Trash', 'Deleted pages and entries – restore them from here', () => this.openTrash()],
            ['message', 'Comments', 'All comments in this workspace', () => openAllComments(this.ws, (path, back) => this.openPath(path, back))],
        ];
        const wv = ws.settings.wsView ?? 'large';
        body.appendChild(section('workspace', 'Workspace', () => {
            if (wv === 'list')
                return wsItems.map(([ic, label, tip, run]) => h('button', { class: 'side-item', title: tip, onclick: run }, h('span', { class: 'ico' }, iconSvg(ic, 15)), h('span', { class: 't' }, label), ic === 'bell' ? nbCount() : null));
            const large = wv === 'large';
            const grid = h('div', { class: 'fav-grid' + (large ? ' large' : '') });
            grid.style.setProperty('--fav-cols', large ? '2' : '5');
            for (const [ic, label, tip, run] of wsItems)
                grid.appendChild(h('button', { class: 'fav-tile', title: `${label} – ${tip}`, 'aria-label': label, onclick: run }, iconSvg(ic, large ? 20 : 16), large ? h('span', { class: 'fav-name' }, label) : null, ic === 'bell' ? nbCount() : null));
            return [grid];
        }, (label) => label.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const set = (v) => { if (v === 'large')
                delete ws.settings.wsView;
            else
                ws.settings.wsView = v; void ws.saveSettings(); this.render(); };
            menu({ x: e.clientX, y: e.clientY }, [{ section: 'Show as' },
                { label: `${wv === 'list' ? '✓' : '   '} List`, run: () => set('list') },
                { label: `${wv === 'icons' ? '✓' : '   '} Icons`, run: () => set('icons') },
                { label: `${wv === 'large' ? '✓' : '   '} Large icons`, run: () => set('large') }]);
        })));
        // sections in the order you dragged them into
        const sideOrder = ws.settings.sideOrder ?? [];
        const secs = [...body.querySelectorAll(':scope > .side-section')];
        const rank = (el) => { const k = sideOrder.indexOf(el.dataset.section); return k < 0 ? 99 + secs.indexOf(el) : k; };
        [...secs].sort((a, b) => rank(a) - rank(b)).forEach((el) => body.appendChild(el));
        return h('nav', { class: 'sidebar', 'aria-label': 'Sidebar' }, grab, 
        // only the sidebar button – it sits exactly where the "show sidebar" button is when the sidebar is closed
        isPhone() ? null : h('div', { class: 'sidebar-head' }, h('button', { class: 'icon-btn side-toggle', 'aria-label': 'Hide sidebar', title: `Hide sidebar (${prettyKey(this.keymap.binding('view.sidebar'))})`, onclick: () => this.toggleSidebar() }, svgIcon(ICONS.sidebar)), this.bellBtn()), body, this.wsbar());
    }
    /** right-click on a database in the sidebar */
    dbSideMenu(db, at) {
        const ws = this.ws, s = ws.settings, key = `db:${db.key}`, fav = s.favorites.includes(key);
        menu(at, [
            { label: 'Open', run: () => this.openDb(db.key) },
            { section: 'Edit' },
            { label: 'Rename', run: () => prompt(at, 'Database name', db.schema.name, (v) => { void this.renameDb(db, v); }) },
            { label: 'Icon', icon: menuIcon('sparkles'), run: () => pickIcon(at, db.schema.icon, async (v) => { db.schema.icon = v; await ws.saveSchema(db); this.render(); }) },
            { section: 'Arrange' },
            { label: 'Duplicate', run: async () => {
                    ws.boundary();
                    try {
                        const c = await ws.duplicateDatabase(db);
                        this.refreshSide();
                        this.openDb(c.key);
                        toast(`Duplicated “${db.schema.name}”`);
                    }
                    catch (e) {
                        toast(`Could not duplicate: ${e.message}`, 5000);
                    }
                } },
            { label: 'Favourite', icon: menuIcon('star'), toggle: fav, onToggle: async (on) => { s.favorites = on ? [...s.favorites.filter((x) => x !== key), key] : s.favorites.filter((x) => x !== key); await ws.saveSettings(); this.render(); } },
            { section: 'Info' },
            { label: 'Find duplicates…', run: () => openDuplicates(this, db) },
            this.usedInEntry(db),
            ...this.revealEntry(`${db.dir}/database.json`),
            'sep',
            { label: 'Delete database…', danger: true, run: () => this.confirmDeleteDb(db) },
        ], { title: db.schema.name });
    }
    /** after a rename: the database's folder / the page's file get the new name too (on disk, in Dropbox) */
    /** renames: the new name shows everywhere at once; saving and renaming the file / folder follow */
    async renamePage(p, title) {
        title = title.trim();
        if (!title)
            return;
        if (title === p.title) {
            await this.renamedOnDisk({ page: p });
            return;
        }
        p.title = title;
        this.syncNames();
        this.refreshSide();
        try {
            await this.ws.savePage(p);
        }
        catch (e) {
            toast(`Could not save the name: ${e.message}`, 5000);
            return;
        }
        await this.renamedOnDisk({ page: p });
    }
    async renameDb(db, name) {
        name = name.trim();
        if (!name)
            return;
        // the same name again still brings the folder in line (e.g. after a rename whose folder step failed)
        if (name === db.schema.name) {
            await this.renamedOnDisk({ db });
            return;
        }
        db.schema.name = name;
        this.syncNames();
        this.refreshSide();
        try {
            await this.ws.saveSchema(db);
        }
        catch (e) {
            toast(`Could not save the name: ${e.message}`, 5000);
            return;
        }
        await this.renamedOnDisk({ db });
    }
    async renamedOnDisk(x) {
        let keyChanged = false;
        try {
            if (x.page)
                await this.ws.renamePageFile(x.page);
            if (x.db) {
                const old = x.db.key;
                const key = await this.ws.renameDatabaseFolder(x.db);
                if (key) {
                    this.rekeyDb(old, key);
                    keyChanged = true;
                    if (this.route?.kind === 'db' && this.route.key === old) {
                        this.route = { ...this.route, key };
                        this.syncUrl();
                    }
                    await calendars.reconfigure();
                }
            }
        }
        catch (e) {
            toast(`Renamed – but the ${x.db ? 'folder' : 'file'} kept its old name: ${e.message}`, 5000);
        }
        this.refreshSide();
        // views, buttons and pages that were drawn with the old folder name are drawn again (unless something is being typed)
        if (keyChanged) {
            const a = document.activeElement;
            if (!a || !a.closest('.main') || !(a.isContentEditable || a.matches('input, textarea')))
                this.render();
            else
                a.addEventListener('blur', () => this.render(), { once: true });
        }
    }
    /** "Show in folder": the file in Finder / Explorer – only offered where Nook can do it (local server) */
    revealEntry(path, label = 'Show in folder') {
        const st = this.ws.storage;
        if (!st.reveal)
            return [];
        const mac = /Mac/i.test(navigator.platform);
        return [{ label: st.remote ? 'Show in Dropbox' : mac ? 'Show in Finder' : label, icon: menuIcon('folder'), run: () => {
                    st.reveal(path).catch((e) => toast(e.message.startsWith('Restart') ? e.message : `Could not show the file: ${e.message}`, 5000));
                } }];
    }
    /** "Used on pages ▸": the pages that show this database in a view; picking one opens it at that view */
    usedInEntry(db) {
        const uses = this.ws.usesOf(db.key);
        const pages = [...new Map(uses.map((u) => [u.page.id, u])).values()];
        return { label: 'Used on pages', icon: menuIcon('file-text'), hint: pages.length ? String(pages.length) : 'None', sub: () => pages.length
                ? pages.map((u) => ({ label: u.page.title || 'Untitled', icon: renderIcon(u.page.icon, 16, 'file'), hint: uses.filter((x) => x.page.id === u.page.id).length > 1 ? `${uses.filter((x) => x.page.id === u.page.id).length} views` : '', run: () => { this.openPage(u.page.id); this.flashBlock(u.block); } }))
                : [{ label: 'Not shown on any page yet', run: () => { } }] };
    }
    /** pages and entries whose text, page links or buttons lead to this page */
    linkedFromEntry(p) {
        const hits = [];
        const points = (bs) => bs.some((b) => (b.type === 'pagelink' && b.target === p.id) || (!!b.text && b.text.includes(`nook:${p.id})`)) || (!!b.steps && b.steps.some((st) => st.target === p.id)) || (!!b.rows && b.rows.some((r) => r.some((c) => c.includes(`nook:${p.id})`)))) || (!!b.children && points(b.children)));
        for (const o of this.ws.pages.values())
            if (o.id !== p.id && o.id !== p.parent && points(o.blocks))
                hits.push({ label: o.title || 'Untitled', icon: renderIcon(o.icon, 16, 'file'), open: () => this.openPage(o.id) });
        for (const db of this.ws.dbs.values())
            for (const r of db.rows)
                if (r.body && r.body.includes(p.id) && points(parsePage(r.body)))
                    hits.push({ label: db.rowLabel(r), icon: renderIcon(r.icon, 16, 'file'), hint: db.schema.name, open: () => this.openRow(db, r) });
        return { label: 'Linked from', icon: undefined, hint: hits.length ? String(hits.length) : 'None', sub: () => hits.length
                ? hits.map((x) => ({ label: x.label, icon: x.icon ?? undefined, hint: x.hint, run: x.open }))
                : [{ label: 'No other page links here yet', run: () => { } }] };
    }
    /** delete a database after saying what goes with it (everything comes back from the trash) */
    confirmDeleteDb(db) {
        const uses = this.ws.usesOf(db.key);
        const pages = new Set(uses.map((u) => u.page.id)).size;
        const lines = [
            `“${db.schema.name}” and its ${db.rows.length} entr${db.rows.length === 1 ? 'y' : 'ies'} go to the trash. You can restore them there for 30 days.`,
            ...(pages ? [`It is shown on ${pages} page${pages > 1 ? 's' : ''}; there it says that the database was deleted until you restore it.`] : []),
        ];
        confirmDialog({ title: `Delete “${db.schema.name}”?`, lines, ok: 'Delete', danger: true, onOk: async () => {
                const wasOpen = this.route?.kind === 'db' && this.route.key === db.key;
                await this.ws.deleteDatabase(db);
                if (wasOpen)
                    this.openPage(this.ws.homePage()?.id ?? [...this.ws.pages.keys()][0]);
                else
                    this.render();
                toast(`Deleted “${db.schema.name}” – it is in the trash`);
            } });
    }
    sideWidth() { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side-w')); return Number.isFinite(v) && v > 0 ? v : 228; }
    setSideWidth(w, store) {
        w = Math.round(Math.min(480, Math.max(216, w)));
        document.documentElement.style.setProperty('--side-w', `${w}px`);
        if (store)
            try {
                localStorage.setItem('nook:sidebar-width', String(w));
            }
            catch { /* private window */ }
    }
    /** F2 on a focused sidebar item: rename it in place (Enter saves, Esc cancels) */
    renameSideItem(el) {
        const id = el.dataset.sideId;
        if (!id)
            return;
        const [kind, key] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
        const page = kind === 'page' ? this.ws.pages.get(key) : undefined;
        const db = kind === 'db' ? this.ws.dbs.get(key) : undefined;
        if (!page && !db)
            return;
        const label = el.querySelector('span.t');
        if (!label)
            return;
        const input = h('input', { class: 'side-rename', value: page?.title ?? db.schema.name, 'aria-label': 'New name' });
        label.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = async (save) => {
            if (done)
                return;
            done = true;
            const v = input.value.trim();
            this.sideFocus = id;
            // the label comes back right away (with the new name); the files follow in the background
            input.replaceWith(label);
            if (save && v) {
                this.ws.boundary();
                if (page) {
                    label.textContent = v;
                    void this.renamePage(page, v);
                }
                if (db) {
                    label.textContent = v;
                    void this.renameDb(db, v);
                }
            }
            this.refreshSide();
            this.root.querySelector(`[data-side-id="${CSS.escape(id)}"]`)?.focus();
        };
        input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') {
            e.preventDefault();
            finish(true);
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
        } });
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('click', (e) => e.stopPropagation());
    }
    /** how many pages are below this one */
    descendants(id) { return this.childPages(id).reduce((n, c) => n + 1 + this.descendants(c.id), 0); }
    /** sub-pages in sidebar order: dragged order first, then alphabetical */
    childPages(parent) {
        return [...this.ws.pages.values()].filter((p) => p.parent === parent)
            .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || compareText(a.title, b.title));
    }
    isInside(id, ancestor) {
        for (let p = this.ws.pages.get(id); p; p = p.parent ? this.ws.pages.get(p.parent) : undefined)
            if (p.id === ancestor)
                return true;
        return false;
    }
    /** Move a page: into another page (as its last subpage) or before / after a page. */
    async movePage(p, target, where) {
        const parent = where === 'inside' ? target?.id : target?.parent;
        if (parent && this.isInside(parent, p.id)) {
            toast('A page cannot go inside its own subpage');
            return;
        }
        const siblings = this.childPages(parent).filter((x) => x !== p);
        let i = siblings.length;
        if (target && where !== 'inside')
            i = siblings.indexOf(target) + (where === 'after' ? 1 : 0);
        siblings.splice(i, 0, p);
        this.ws.boundary();
        // the link block moves along: out of the old parent's content, into the new one's
        if (p.parent !== parent) {
            await this.ws.unlinkSubpage(p.parent, p.id);
            await this.ws.linkSubpage(parent, p.id);
        }
        p.parent = parent;
        for (const [k, x] of siblings.entries())
            if (x.order !== k || x === p) {
                x.order = k;
                await this.ws.savePage(x);
            }
        this.render();
    }
    /** a page in the breadcrumb takes pages (from the sidebar) and blocks (from the page content) dropped on it */
    crumbDrop(el, pageId) {
        const ok = (e) => !!e.dataTransfer && (e.dataTransfer.types.includes('text/x-nook-block') || e.dataTransfer.types.includes('text/x-nook-page'));
        el.addEventListener('dragover', (e) => { if (!ok(e))
            return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('crumb-drop'); });
        el.addEventListener('dragleave', () => el.classList.remove('crumb-drop'));
        el.addEventListener('drop', async (e) => {
            if (!ok(e))
                return;
            e.preventDefault();
            e.stopPropagation();
            el.classList.remove('crumb-drop');
            const target = this.ws.pages.get(pageId);
            if (!target)
                return;
            const blocks = e.dataTransfer.getData('text/x-nook-block');
            if (blocks) {
                const ev = new CustomEvent('nook-move-into', { cancelable: true, detail: { ids: blocks.split(','), page: pageId } });
                document.dispatchEvent(ev);
                if (ev.defaultPrevented)
                    return;
            }
            const id = e.dataTransfer.getData('text/x-nook-page');
            const p = id ? this.ws.pages.get(id) : undefined;
            if (!p || p.id === pageId)
                return;
            if (p.parent === pageId)
                return;
            await this.movePage(p, target, 'inside');
            toast(`“${p.title || 'Untitled'}” moved to “${target.title || 'Untitled'}”`);
        });
    }
    sideDrag(el, p) {
        el.draggable = true;
        el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-nook-page', p.id); e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => el.classList.add('dragging')); });
        el.addEventListener('dragend', () => { el.classList.remove('dragging'); this.root.querySelectorAll('.drop-into,.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-into', 'drop-before', 'drop-after')); });
        // the place shown while dragging is where it goes: Safari does not give a drop its pointer position reliably
        let shown = 'inside';
        const zone = (e) => { const r = el.getBoundingClientRect(); const y = e.clientY - r.top; return y < r.height * 0.28 ? 'before' : y > r.height * 0.72 ? 'after' : 'inside'; };
        el.addEventListener('dragover', (e) => {
            if (!e.dataTransfer?.types.includes('text/x-nook-page'))
                return;
            e.preventDefault();
            const z = zone(e);
            shown = z;
            el.classList.toggle('drop-into', z === 'inside');
            el.classList.toggle('drop-before', z === 'before');
            el.classList.toggle('drop-after', z === 'after');
        });
        el.addEventListener('dragleave', () => el.classList.remove('drop-into', 'drop-before', 'drop-after'));
        el.addEventListener('drop', (e) => {
            const id = e.dataTransfer?.getData('text/x-nook-page');
            const z = shown;
            el.classList.remove('drop-into', 'drop-before', 'drop-after');
            const moving = id ? this.ws.pages.get(id) : undefined;
            if (!moving || moving === p)
                return;
            e.preventDefault();
            this.movePage(moving, p, z);
        });
    }
    /** dropping on the "Pages" label moves a page to the top level */
    sideDropTop(el) {
        el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/x-nook-page')) {
            e.preventDefault();
            el.classList.add('drop-into');
        } });
        el.addEventListener('dragleave', () => el.classList.remove('drop-into'));
        el.addEventListener('drop', (e) => {
            el.classList.remove('drop-into');
            const p = this.ws.pages.get(e.dataTransfer?.getData('text/x-nook-page') ?? '');
            if (!p)
                return;
            e.preventDefault();
            const first = this.childPages(undefined)[0];
            this.movePage(p, first && first !== p ? first : null, first && first !== p ? 'before' : 'inside');
        });
    }
    /** the bell next to the sidebar button – always in the same place, sidebar open or closed */
    bellBtn() {
        return h('button', { class: 'icon-btn nb-host top-bell', 'aria-label': 'Notifications', title: `Notifications (${prettyKey(this.keymap.binding('notifications'))})`, onclick: (e) => this.notes.open(e.currentTarget) }, iconSvg('bell', 16), nbDot());
    }
    /** Bottom of the sidebar: workspace switcher, command palette, settings (as in Scriptwright). */
    wsbar() {
        return h('div', { class: 'wsbar-wrap' }, this.wsbarInner());
    }
    wsbarInner() {
        const name = this.ws.meta.name || 'Workspace';
        return h('div', { class: 'wsbar' }, h('button', { class: 'ws-name', title: `Switch workspace (${prettyKey(this.keymap.binding('workspace.switch'))})`, onclick: (e) => this.shell.workspaceMenu(e.currentTarget) }, h('span', { class: 'ws-avatar', 'aria-hidden': 'true' }, name.trim().charAt(0).toUpperCase()), h('span', { class: 'ws-text' }, h('span', { class: 'ws-title' }, name), h('span', { class: 'ws-sub' }, 'Switch workspace')), svgIcon(ICONS.chevron, 13)), h('button', { class: 'icon-btn', 'aria-label': 'Search', title: `Search (${prettyKey(this.keymap.binding('palette'))})`, onclick: () => this.palette() }, iconSvg('search', 16)), h('button', { class: 'icon-btn', 'aria-label': 'Workspace settings', title: `Workspace settings (${prettyKey(this.keymap.binding('settings'))})`, onclick: () => this.settingsDialog() }, iconSvg('settings', 16)));
    }
    openTrash() { openTrash(this.ws, () => this.render()); }
    /** open the page or entry a workspace file belongs to */
    /** open the page or entry a workspace file belongs to; `back` runs when an entry window opened here closes */
    openPath(path, back) {
        const page = [...this.ws.pages.values()].find((p) => p.file === path);
        if (page) {
            this.openPage(page.id);
            return;
        }
        const hit = this.ws.rowAt(path);
        if (hit)
            this.openRow(hit.db, hit.row, { onClose: back });
    }
    /** files put into a page's or entry's folder (in Finder …) that it doesn't show yet: listed under it, to open or add */
    folderFiles(owner, used, add) {
        const list = this.ws.looseFiles(owner, used());
        if (!list.length)
            return null;
        const kind = (f) => /\.(png|jpe?g|gif|webp|avif|heic|svg)$/i.test(f) ? 'image' : /\.pdf$/i.test(f) ? 'pdf' : /\.(mp3|m4a|wav|aac|ogg)$/i.test(f) ? 'audio' : /\.(mp4|mov|webm)$/i.test(f) ? 'video' : 'file';
        const name = (f) => f.split('/').pop();
        return h('section', { class: 'folder-files' }, h('div', { class: 'folder-files-h' }, 'In this folder'), ...list.map((f) => h('div', { class: 'folder-file' }, h('button', { class: 'ff-open', title: 'Open', onclick: () => void this.assetUrl(f).then((u) => window.open(u, '_blank', 'noopener')).catch((e) => toast(e.message)) }, h('span', { class: 'ff-ico' }, iconSvg(kind(f) === 'image' ? 'image' : 'file', 15)), h('span', { class: 'ff-name' }, name(f))), h('button', { class: 'set-btn small', onclick: () => add({ id: ulid(), type: kind(f), src: f, text: name(f) }) }, 'Add to page'))));
    }
    /** an entry's file (for its history) */
    rowFile(dbKey, id) { const db = this.ws.dbs.get(dbKey); const row = db?.byId(id); return db && row ? this.ws.rowPath(db, row) : `databases/${dbKey}/rows/${id}.md`; }
    openHistory(path) { openHistory(this.ws, this, path, () => this.render()); }
    topbar() {
        const crumbs = h('div', { class: 'crumbs' });
        const phone = isPhone();
        if (!this.sidebarOpen && !phone) {
            crumbs.appendChild(h('button', { class: 'icon-btn side-toggle', 'aria-label': 'Show sidebar', title: `Show sidebar (${prettyKey(this.keymap.binding('view.sidebar'))})`, onclick: () => this.toggleSidebar() }, svgIcon(ICONS.sidebar)));
            crumbs.appendChild(this.bellBtn());
        }
        // Back and Forward are always there; greyed out when there is nowhere to go (a phone swipes instead)
        if (!phone)
            crumbs.append(h('button', { class: 'icon-btn nav-btn', 'aria-label': 'Back', title: `Back (${prettyKey(this.keymap.binding('nav.back'))})`, disabled: !this.history.length, onclick: () => this.back() }, svgIcon(ICONS.back)), h('button', { class: 'icon-btn nav-btn', 'aria-label': 'Forward', title: `Forward (${prettyKey(this.keymap.binding('nav.forward'))})`, disabled: !this.future.length, onclick: () => this.forward() }, svgIcon('M6.5 4l4 4-4 4')));
        const r = this.route;
        // optional: the start page first in every path (unless the path already starts there)
        const home = this.ws.settings.homeCrumb && !phone ? this.ws.homePage() : undefined;
        if (home) {
            let top;
            if (r?.kind === 'page') {
                let q = this.ws.pages.get(r.id);
                while (q) {
                    top = q.id;
                    q = q.parent ? this.ws.pages.get(q.parent) : undefined;
                }
            }
            if (top !== home.id) {
                const ch = h('button', { class: 'crumb crumb-home', onclick: () => this.openPage(home.id) }, renderIcon(home.icon, 15, 'home'), h('span', { class: 'crumb-t', 'data-name': `page:${home.id}` }, home.title || 'Untitled'));
                this.linkTo(ch, home.id);
                this.crumbDrop(ch, home.id);
                crumbs.append(ch, h('span', { class: 'crumb-sep' }, '/'));
            }
        }
        if (r?.kind === 'page') {
            const chain = [];
            let p = this.ws.pages.get(r.id);
            while (p && chain.length < 6) {
                chain.unshift(p);
                p = p.parent ? this.ws.pages.get(p.parent) : undefined;
            }
            // a subpage of a database entry: the database and the entry come first
            const m = chain[0]?.parent?.match(/^row:([^:]+):(.+)$/);
            const edb = m ? this.ws.dbs.get(m[1]) : undefined;
            const erow = edb?.rows.find((x) => x.id === m[2]);
            if (edb && erow) {
                const cdb = h('button', { class: 'crumb', onclick: () => this.openDb(edb.key) }, renderIcon(edb.schema.icon, 15, 'database'), h('span', { class: 'crumb-t', 'data-name': `db:${edb.key}` }, edb.schema.name));
                this.linkTo(cdb, `db:${edb.key}`);
                crumbs.appendChild(cdb);
                crumbs.appendChild(h('span', { class: 'crumb-sep' }, '/'));
                const crow = h('button', { class: 'crumb', onclick: () => this.openRowPage(edb, erow) }, erow.icon ? renderIcon(erow.icon, 15) : null, h('span', { class: 'crumb-t', 'data-name': `row:${edb.key}:${erow.id}` }, edb.rowLabel(erow)));
                this.linkTo(crow, rowTarget(edb.key, erow.id));
                crumbs.appendChild(crow);
            }
            chain.forEach((c, i) => {
                if (i || (edb && erow))
                    crumbs.appendChild(h('span', { class: 'crumb-sep' }, '/'));
                const cb = h('button', { class: 'crumb', onclick: () => this.openPage(c.id) }, renderIcon(c.icon, 15), h('span', { class: 'crumb-t', 'data-name': `page:${c.id}` }, c.title));
                this.linkTo(cb, c.id);
                this.crumbDrop(cb, c.id);
                crumbs.appendChild(cb);
            });
        }
        else if (r?.kind === 'db') {
            const db = this.ws.dbs.get(r.key);
            crumbs.appendChild(h('span', { class: 'crumb' }, renderIcon(db?.schema.icon, 15, 'database'), h('span', { class: 'crumb-t', 'data-name': db ? `db:${db.key}` : undefined }, db?.schema.name ?? '')));
        }
        else if (r?.kind === 'row') {
            const db = this.ws.dbs.get(r.db);
            const row = db?.rows.find((x) => x.id === r.id);
            if (db)
                crumbs.appendChild(this.linked(`db:${db.key}`, h('button', { class: 'crumb', onclick: () => this.openDb(db.key) }, renderIcon(db.schema.icon, 15, 'database'), h('span', { class: 'crumb-t', 'data-name': `db:${db.key}` }, db.schema.name))));
            crumbs.appendChild(h('span', { class: 'crumb-sep' }, '/'));
            crumbs.appendChild(h('span', { class: 'crumb' }, row?.icon ? renderIcon(row.icon, 15) : null, h('span', { class: 'crumb-t', 'data-name': db && row ? `row:${db.key}:${row.id}` : undefined }, db && row ? db.rowLabel(row) : 'Untitled')));
        }
        const right = h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, r?.kind === 'row' ? h('button', { class: 'icon-btn', 'aria-label': 'History', title: 'History of this entry', onclick: () => this.openHistory(this.rowFile(r.db, r.id)) }, iconSvg('clock', 16)) : null, r?.kind === 'row' ? h('button', { class: 'icon-btn', 'aria-label': 'Delete entry', title: 'Delete entry', onclick: async () => {
                const db = this.ws.dbs.get(r.db);
                const row = db?.rows.find((x) => x.id === r.id);
                if (!db || !row)
                    return;
                this.ws.boundary();
                await this.ws.deleteRow(db, row);
                toast(`Entry moved to the trash · ${prettyKey('Mod+Z')} to undo`);
                this.back();
            } }, svgIcon(ICONS.trash)) : null, 
        // favorite star: grey outline, yellow when it is a favorite
        (() => {
            const id = r?.kind === 'page' ? r.id : r?.kind === 'db' ? `db:${r.key}` : null;
            if (!id)
                return null;
            const st = this.ws.settings, on = st.favorites.includes(id) || (r?.kind === 'page' && this.ws.homePage()?.id === r.id);
            const isHome = r?.kind === 'page' && this.ws.homePage()?.id === r.id;
            return h('button', { class: 'icon-btn fav-star' + (on ? ' on' : ''), 'aria-label': on ? 'Remove from favorites' : 'Add to favorites', 'aria-pressed': String(on), title: isHome ? 'The start page is always a favorite' : on ? 'Remove from favorites' : 'Add to favorites',
                onclick: async () => { if (isHome)
                    return; st.favorites = on ? st.favorites.filter((x) => x !== id) : [...st.favorites, id]; await this.ws.saveSettings(); this.render(); } }, iconSvg(on ? 'star-fill' : 'star', 16));
        })(), r?.kind === 'page' ? h('button', { class: 'icon-btn', 'aria-label': 'Page options', title: 'Page options', onclick: (e) => { const p = this.ws.pages.get(r.id); if (p)
                this.pageMenu(p, e.currentTarget, 'top'); } }, svgIcon(ICONS.more, 16, { fill: true }))
            : h('button', { class: 'icon-btn', 'aria-label': 'Options', title: 'Options', onclick: (e) => this.optionsMenu(e.currentTarget) }, svgIcon(ICONS.more, 16, { fill: true })));
        return h('header', { class: 'topbar' }, crumbs, phone ? null : right);
    }
    /** ⋯ of a database or an entry (top bar; on a phone the ⋯ in the bottom bar) */
    optionsMenu(at) {
        const r = this.route;
        const db = r?.kind === 'db' ? this.ws.dbs.get(r.key) : undefined;
        const dw = db ? db.schema.layoutWidth ?? (db.schema.pageWidth ? resolveDatabaseWidth(db.schema, this.ws.settings) : undefined) : undefined;
        const rdb = r?.kind === 'row' ? this.ws.dbs.get(r.db) : undefined;
        const row = r?.kind === 'row' ? rdb?.rows.find((x) => x.id === r.id) : undefined;
        menu(at, [
            ...this.phoneExtras(),
            ...(db ? [
                { section: 'Edit' },
                { label: 'Reminders…', icon: menuIcon('bell'), run: () => this.dbRemindersDialog(db) },
                ...(isPhone() ? [] : [widthEntry(dw, (v) => { db.schema.layoutWidth = v; delete db.schema.pageWidth; void this.ws.saveSchema(db); this.render(); })]),
                { section: 'Info' }, this.usedInEntry(db), ...this.revealEntry(`${db.dir}/database.json`),
                { label: 'Import CSV…', icon: menuIcon('arrow-down'), run: () => this.importCsvFile(db) },
                { label: 'Export', icon: menuIcon('arrow-up'), sub: () => [
                        { label: 'CSV with entries as Markdown', hint: '.zip', run: () => this.runExport(() => exportDatabase(this.ws, db)) },
                        { label: 'CSV only', run: () => this.runExport(async () => ({ name: `${safeName(db.schema.name)}.csv`, blob: new Blob([databaseCsv(db)], { type: 'text/csv' }), files: 1 })) },
                        { label: 'Print / PDF', hint: '⌘P', run: () => setTimeout(() => window.print(), 100) },
                    ] }
            ] : []),
            ...(rdb && row ? [{ section: 'Info' }, { label: 'Export', sub: () => [
                        { label: 'Markdown', run: () => this.runExport(() => exportEntry(this.ws, rdb, row)) },
                        { label: 'HTML', run: () => this.runExport(() => exportHtml(this.ws, rdb.rowLabel(row), row.body ? parsePage(row.body) : [], entryProps(rdb, row))) },
                        { label: 'Print / PDF', hint: '⌘P', run: () => setTimeout(() => window.print(), 100) },
                    ] }] : []),
            'sep',
            { label: 'Settings', hint: prettyKey(this.keymap.binding('settings')), run: () => this.settingsDialog() },
            ...(db ? ['sep', { label: 'Delete database…', danger: true, run: () => this.confirmDeleteDb(db) }] : []),
        ], { title: db ? db.schema.name : rdb && row ? rdb.rowLabel(row) || 'Untitled' : undefined });
    }
    pageView(p) {
        // a subpage in the sidebar is always in its parent's content (the blocks are added before the editor is built)
        this.ws.ensureSubpageBlocks(p.id).catch(() => { });
        const save = () => this.ws.savePage(p);
        const editor = new Editor(p.blocks, this, save, false, p.id);
        editor.commentPath = p.file;
        editor.fileOf = () => p.file;
        const title = h('h1', { class: 'page-title', contenteditable: 'true', spellcheck: 'false', 'data-name': `page:${p.id}` }, p.title === 'Untitled' || p.title === 'New page' ? '' : p.title);
        const saveTitle = debounce(() => { p.title = title.textContent?.trim() || 'Untitled'; save(); }, 400);
        title.addEventListener('input', saveTitle);
        // sidebar, favorites and breadcrumb follow while typing
        title.addEventListener('input', () => this.liveName(`page:${p.id}`, title.textContent?.trim() || 'Untitled'));
        enableAutoReplace(title);
        editor.onTitle = () => { title.focus(); placeCaretEnd(title); };
        title.addEventListener('blur', async () => {
            p.title = title.textContent?.trim() || 'Untitled';
            this.liveName(`page:${p.id}`, null);
            await save();
            // the file is renamed once the title is done (not on every key)
            await this.renamedOnDisk({ page: p });
            editor.commentPath = p.file;
            editor.fileOf = () => p.file;
        });
        title.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                // as in Notion: Enter starts a new first line; text after the cursor moves down into it
                e.preventDefault();
                const sel = getSelection();
                const full = title.textContent ?? '';
                let at = full.length;
                if (sel && sel.rangeCount && title.contains(sel.anchorNode)) {
                    const r = document.createRange();
                    r.selectNodeContents(title);
                    r.setEnd(sel.anchorNode, sel.anchorOffset);
                    at = r.toString().length;
                }
                const tail = full.slice(at);
                if (tail) {
                    title.textContent = full.slice(0, at).trimEnd();
                    p.title = title.textContent.trim() || 'Untitled';
                }
                const first = p.blocks[0];
                if (!tail && first && first.type === 'paragraph' && !first.text && p.blocks.length === 1) {
                    editor.focus(first.id, 'start');
                    return;
                }
                const nb = { id: ulid(), type: 'paragraph', text: tail.trim() };
                p.blocks.unshift(nb);
                editor.changed({ id: nb.id, at: 'start' });
            }
        });
        const icon = h('button', { class: 'page-icon' + (p.icon ? '' : ' empty'), title: 'Change icon', onclick: (e) => pickIcon(e.currentTarget, p.icon, (v) => { p.icon = v; save(); this.render(); }) }, p.icon ? renderIcon(p.icon, 32) : h('span', { class: 'add-icon' }, svgIcon(ICONS.plus, 14), 'Add icon'));
        // Explicit page width wins over the workspace default; CSS clamps to available space.
        const ownW = resolvePageWidth(p, this.ws.settings);
        const pageEl = h('div', { class: 'page layout-page' + (ownW === 'full' ? ' full' : ''), style: widthStyle(ownW) }, 
        // with a cover, icon and title sit on the picture, which fades into the page
        ((head) => (p.cover ? this.heroEl(p, head) : head))(this.ws.homePage()?.id === p.id && this.ws.settings.homeClock ? h('div', { class: 'page-head greeting' }, icon, title, this.homeClock()) : h('div', { class: 'page-head' }, icon, title)), editor.el, this.folderFiles(p.file, () => JSON.stringify(p.blocks) + (p.cover ?? ''), (b) => { p.blocks.push(b); void this.ws.savePage(p).then(() => this.render()); }), backlinksSection(this.ws, p.id, { page: p.id }, p.backlinks ?? this.ws.settings.backlinks ?? 'collapsed', this.blOpen()));
        // the start page: right-click its title to show or hide the date and time
        if (this.ws.homePage()?.id === p.id)
            title.parentElement?.addEventListener('contextmenu', (e) => {
                if (e.target.closest('.page-title') && (document.activeElement === title))
                    return; // editing the title: the normal menu
                e.preventDefault();
                const on = !!this.ws.settings.homeClock;
                menu({ x: e.clientX, y: e.clientY }, [{ label: on ? 'Hide date and time' : 'Show date and time', run: () => { if (on)
                            delete this.ws.settings.homeClock;
                        else
                            this.ws.settings.homeClock = true; void this.ws.saveSettings(); this.render(); } }]);
            });
        return pageEl;
    }
    /** the start page's date and time on the right of its title (Settings → General) */
    homeClock() {
        // "Sat, Oct 31 · 23:54" in title size: the date muted, the time bright
        const hm = h('span', { class: 'clock-hm' });
        const date = h('span', { class: 'clock-date' });
        const clock = h('div', { class: 'greet-clock', 'aria-label': 'Date and time' }, date, h('span', { class: 'clock-sep', 'aria-hidden': 'true' }, '·'), hm);
        const pad = (n) => String(n).padStart(2, '0');
        const tick = () => {
            const now = new Date();
            const tm = fmtTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
            if (hm.textContent !== tm)
                hm.textContent = tm;
            const d = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); // "Sat, Oct 31"
            if (date.textContent !== d)
                date.textContent = d;
        };
        tick();
        // checks on the full second (so the minute flips on time); stops once the start page is left
        const loop = () => { window.setTimeout(() => { if (!clock.isConnected)
            return; tick(); loop(); }, 1000 - (Date.now() % 1000) + 5); };
        loop();
        return clock;
    }
    /** ＋ in the phone's bottom bar: your quick buttons, then a new page */
    quickMenu(at) {
        const qs = this.ws.settings.quickButtons ?? [];
        const entries = [];
        if (qs.length) {
            entries.push({ section: 'Quick buttons' });
            for (const q of qs) {
                const f = this.findButton(q.page, q.block, q.label);
                if (!f)
                    continue;
                const c = f.block.color && f.block.color !== 'default' ? `var(--c-${f.block.color})` : 'var(--accent)';
                entries.push({ label: f.block.text || 'Button', hint: f.page.title, icon: h('span', { class: 'menu-ico', style: { color: c } }, f.block.icon ? renderIcon(f.block.icon, 18) : iconSvg('zap', 18)), run: () => this.runJump({ key: '', button: { page: q.page, block: q.block, label: q.label } }) });
            }
        }
        else {
            entries.push({ section: 'No quick buttons yet – hold a button, then “Add to quick buttons”' });
        }
        entries.push('sep', { label: 'New page', icon: menuIcon('file-plus'), run: () => { this.libraryOn = false; this.newPage(); } });
        menu(at, entries);
        // phone: the bottom bar stays on top of this sheet – its last row (New page) must end above the bar
        const pops = document.querySelectorAll('.pop');
        pops[pops.length - 1]?.classList.add('quick-sheet');
    }
    /** the pages and databases you opened last (phone: Pages → Recent, and "Open on: Last page") */
    recentKey() { return `nook:recent:${this.ws.meta.name}`; }
    recent() { try {
        const v = JSON.parse(localStorage.getItem(this.recentKey()) ?? '[]');
        return Array.isArray(v) ? v : [];
    }
    catch {
        return [];
    } }
    noteRecent() {
        const r = this.route, id = r?.kind === 'page' ? `page:${r.id}` : r?.kind === 'db' ? `db:${r.key}` : '';
        if (!id)
            return;
        const list = this.recent();
        if (list[0] === id)
            return;
        try {
            localStorage.setItem(this.recentKey(), JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 8)));
        }
        catch { /* private window */ }
    }
    /**
     * The phone's Pages screen (instead of a sidebar): favourites as tiles, then recent pages, pages
     * and databases as lists. A page with subpages opens its own list; ＋ adds a page there.
     */
    libraryScreen() {
        const ws = this.ws, at = this.libraryAt ? ws.pages.get(this.libraryAt) : undefined;
        const chev = () => h('span', { class: 'mp-chev' }, svgIcon(ICONS.chevronR, 14));
        const rowEl = (icon, label, run, extra, more = true) => h('button', { class: 'mp-row', onclick: run }, h('span', { class: 'mp-ico' }, icon), h('span', { class: 'mp-label' }, label || 'Untitled'), extra ? h('span', { class: 'mp-val' }, extra) : null, more ? chev() : null);
        const pageRow = (p) => {
            const kids = this.childPages(p.id).length;
            // into its subpages: a step of Back / Forward (the edge swipe too)
            return rowEl(renderIcon(p.icon, 20, 'file'), p.title, () => { if (kids) {
                this.history.push({ kind: 'pages', at: this.libraryAt });
                this.future = [];
                this.libraryAt = p.id;
                slideIn('right');
                this.render();
                this.root.querySelector('.scroll')?.scrollTo(0, 0);
            }
            else
                this.openPage(p.id); }, kids ? String(kids) : '');
        };
        const dbRow = (db) => rowEl(renderIcon(db.schema.icon, 20, 'database'), db.schema.name, () => this.openDb(db.key));
        const sec = (title, ...rows) => rows.some(Boolean) ? h('section', { class: 'mp-sec' }, title ? h('div', { class: 'mp-sh' }, title) : null, h('div', { class: 'mp-card' }, ...rows)) : null;
        if (at) {
            const parent = at.parent ? ws.pages.get(at.parent) : undefined;
            return h('div', { class: 'mp' }, h('div', { class: 'mp-bar' }, h('button', { class: 'mp-back pset-back', onclick: () => { slideIn('left'); const top = this.history[this.history.length - 1]; if (top?.kind === 'pages')
                    this.back();
                else {
                    this.libraryAt = parent?.id ?? null;
                    this.render();
                } } }, svgIcon(ICONS.chevron, 15), parent?.title || 'Library'), h('span', { class: 'mp-title' }, at.title || 'Untitled'), h('span')), sec(null, h('button', { class: 'mp-row strong', onclick: () => this.openPage(at.id) }, h('span', { class: 'mp-ico' }, renderIcon(at.icon, 20, 'file')), h('span', { class: 'mp-label' }, `Open “${at.title || 'Untitled'}”`), chev())), sec(`${this.childPages(at.id).length} subpages`, ...this.childPages(at.id).map(pageRow)));
        }
        // search: pages and databases by name, as one list
        const q = this.pagesQuery.trim().toLowerCase();
        // the same search field as in Settings
        const input = h('input', { class: 'pset-search-in', type: 'text', autocomplete: 'off', placeholder: 'Search', 'aria-label': 'Search pages', enterkeyhint: 'search', value: this.pagesQuery });
        const clear = h('button', { class: 'pset-search-clear', 'aria-label': 'Clear search', hidden: !this.pagesQuery, onclick: (e) => { e.preventDefault(); input.value = ''; fill(); input.focus(); } }, svgIcon(ICONS.close, 11));
        const results = h('div', { class: 'mp-results' });
        const fill = () => {
            const qq = input.value.trim().toLowerCase();
            this.pagesQuery = input.value;
            clear.hidden = !input.value;
            results.replaceChildren(...(qq ? [sec(null, ...[...ws.pages.values()].filter((p) => (p.title || '').toLowerCase().includes(qq)).slice(0, 40).map((p) => rowEl(renderIcon(p.icon, 20, 'file'), p.title, () => this.openPage(p.id), '', false)), ...[...ws.dbs.values()].filter((d) => d.schema.name.toLowerCase().includes(qq)).map(dbRow)) ?? h('p', { class: 'mp-none' }, `Nothing called “${input.value}”`)] : []));
            body.hidden = !!qq;
        };
        input.addEventListener('input', fill);
        const home = ws.homePage();
        const favIds = [...(home ? [home.id] : []), ...ws.settings.favorites.filter((id) => id !== home?.id)];
        const favs = favIds.map((id) => {
            if (id.startsWith('db:')) {
                const db = ws.dbs.get(id.slice(3));
                return db ? h('button', { class: 'mp-fav', onclick: () => this.openDb(db.key) }, h('span', { class: 'mp-fav-ico' }, renderIcon(db.schema.icon, 26, 'database')), h('span', { class: 'mp-fav-name' }, db.schema.name)) : null;
            }
            const p = ws.pages.get(id);
            return p ? h('button', { class: 'mp-fav', onclick: () => this.openPage(p.id) }, h('span', { class: 'mp-fav-ico' }, renderIcon(p.icon, 26, 'file')), h('span', { class: 'mp-fav-name' }, p.title || 'Untitled')) : null;
        }).filter(Boolean);
        const dbs = [...ws.dbs.values()].sort((a, b) => a.schema.name.localeCompare(b.schema.name));
        // Pages and Databases fold (closed at first; remembered on this device)
        const foldKey = 'nook:mp-open';
        const opened = (() => { try {
            return new Set(JSON.parse(localStorage.getItem(foldKey) ?? '[]'));
        }
        catch {
            return new Set();
        } })();
        const fold = (key, title, rows) => {
            if (!rows.length)
                return null;
            const open = opened.has(key);
            const card = h('div', { class: 'mp-card' }, ...rows);
            card.hidden = !open;
            const head = h('button', { class: 'mp-sh mp-fold' + (open ? ' open' : ''), 'aria-expanded': String(open), onclick: () => {
                    const on = !!card.hidden;
                    card.hidden = !on;
                    head.classList.toggle('open', on);
                    head.setAttribute('aria-expanded', String(on));
                    if (on)
                        opened.add(key);
                    else
                        opened.delete(key);
                    try {
                        localStorage.setItem(foldKey, JSON.stringify([...opened]));
                    }
                    catch { /* private window */ }
                } }, h('span', null, title), h('span', { class: 'mp-count' }, String(rows.length)), h('span', { class: 'mp-fold-chev' }, svgIcon(ICONS.chevronR, 13)));
            return h('section', { class: 'mp-sec' }, head, card);
        };
        const body = h('div', { class: 'mp-body' }, favs.length ? h('section', { class: 'mp-sec' }, h('div', { class: 'mp-sh' }, 'Favorites'), h('div', { class: 'mp-favs' }, ...favs)) : null, 
        // places of the workspace (not pages of yours): Trash and Comments
        h('section', { class: 'mp-sec' }, h('div', { class: 'mp-sh' }, 'Workspace'), h('div', { class: 'mp-card' }, h('button', { class: 'mp-row', onclick: () => this.openTrash() }, h('span', { class: 'mp-ico' }, iconSvg('trash', 18)), h('span', { class: 'mp-label' }, 'Trash'), h('span', { class: 'mp-chev' }, svgIcon(ICONS.chevronR, 14))), h('button', { class: 'mp-row', onclick: () => openAllComments(ws, (path, back) => this.openPath(path, back)) }, h('span', { class: 'mp-ico' }, iconSvg('message', 18)), h('span', { class: 'mp-label' }, 'Comments'), h('span', { class: 'mp-chev' }, svgIcon(ICONS.chevronR, 14))))), fold('pages', 'Pages', this.childPages(undefined).map(pageRow)), fold('dbs', 'Databases', dbs.map(dbRow)));
        const screen = h('div', { class: 'mp' }, h('h1', { class: 'mp-big' }, 'Library'), h('label', { class: 'pset-search' }, svgIcon(ICONS.search, 16), input, clear), results, body);
        if (q)
            fill();
        return screen;
    }
    /** favorites in the sidebar: drag one onto another to change the order (the start page stays first) */
    favDrag(el, id, isHome, across, kind = 'fav') {
        const T = `text/x-nook-${kind}`;
        if (!isHome) {
            el.draggable = true;
            el.addEventListener('dragstart', (e) => { e.stopPropagation(); e.dataTransfer.setData(T, id); e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => el.classList.add('dragging')); }, true);
            el.addEventListener('dragend', () => el.classList.remove('dragging'));
        }
        let shownAfter = false; // as for pages: the side shown while dragging decides (Safari)
        const after = (e) => { const r = el.getBoundingClientRect(); return isHome || (across ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2); };
        const clear = () => el.classList.remove('fav-drop-before', 'fav-drop-after');
        el.addEventListener('dragover', (e) => {
            if (!e.dataTransfer?.types.includes(T))
                return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            const a = after(e);
            shownAfter = a;
            el.classList.toggle('fav-drop-after', a);
            el.classList.toggle('fav-drop-before', !a);
        });
        el.addEventListener('dragleave', clear);
        el.addEventListener('drop', async (e) => {
            const from = e.dataTransfer?.getData(T);
            clear();
            if (!from || from === id)
                return;
            e.preventDefault();
            e.stopPropagation();
            const st = this.ws.settings;
            if (kind === 'quick') {
                const qs = st.quickButtons ?? [], moved = qs.find((q) => q.block === from);
                if (!moved)
                    return;
                const rest = qs.filter((q) => q !== moved);
                rest.splice(rest.findIndex((q) => q.block === id) + (shownAfter ? 1 : 0), 0, moved);
                st.quickButtons = rest;
                await this.ws.saveSettings();
                this.render();
                return;
            }
            const list = st.favorites.filter((x) => x !== from);
            const at = isHome ? 0 : list.indexOf(id) + (shownAfter ? 1 : 0);
            list.splice(Math.max(0, at), 0, from);
            st.favorites = list;
            await this.ws.saveSettings();
            this.render();
        });
    }
    /** a database's page title: type a new name to rename the database (Enter or leaving the title saves) */
    dbTitle(db) {
        const title = h('h1', { class: 'page-title', contenteditable: 'true', spellcheck: 'false', 'data-ph': 'Untitled', 'aria-label': 'Database name', 'data-name': `db:${db.key}` }, db.schema.name);
        enableAutoReplace(title);
        const save = async () => {
            const v = (title.textContent ?? '').replace(/\s+/g, ' ').trim();
            this.liveName(`db:${db.key}`, null);
            if (!v) {
                title.textContent = db.schema.name;
                return;
            }
            if (v === db.schema.name)
                return;
            await this.renameDb(db, v);
        };
        title.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
            e.preventDefault();
            title.blur();
        }
        else if (e.key === 'Escape') {
            title.textContent = db.schema.name;
            this.liveName(`db:${db.key}`, null);
            title.blur();
        } });
        title.addEventListener('blur', () => { void save(); });
        title.addEventListener('input', () => this.liveName(`db:${db.key}`, title.textContent?.trim() || 'Untitled'));
        return title;
    }
    dbPage(db) {
        const want = this.dbViewWanted.get(db.key);
        const block = { id: `dbpage-${db.key}`, type: 'view', db: db.key, view: want && db.views.some((v) => v.id === want) ? want : db.views[0]?.id };
        // Database pages use the same defaults and overrides as regular pages.
        const w = resolveDatabaseWidth(db.schema, this.ws.settings);
        return h('div', { class: 'page layout-page' + (w === 'full' ? ' full' : ''), style: widthStyle(w) }, h('div', { class: 'page-head' }, h('button', { class: 'page-icon', title: 'Change icon', onclick: (e) => pickIcon(e.currentTarget, db.schema.icon, async (v) => { db.schema.icon = v; await this.ws.saveSchema(db); this.render(); }) }, renderIcon(db.schema.icon, 32, 'database')), this.dbTitle(db)), renderViewBlock(this, block, () => { }, true), backlinksSection(this.ws, `db:${db.key}`, {}, this.ws.settings.backlinks ?? 'collapsed', this.blOpen()));
    }
    /** a CSV file as a new database (or more entries for `into`), then open it */
    importCsvFile(into) {
        const inp = h('input', { type: 'file', accept: '.csv,.tsv,text/csv', hidden: true });
        inp.addEventListener('change', async () => {
            const f = inp.files?.[0];
            inp.remove();
            if (!f)
                return;
            try {
                const { importCsv } = await import('../importer/csv.js');
                const { db, added } = await importCsv(this.ws, f, into);
                toast(`${added} ${added === 1 ? 'entry' : 'entries'} imported into “${db.schema.name}”`);
                this.openDb(db.key);
            }
            catch (e) {
                toast(`Could not import: ${e.message}`);
            }
        });
        document.body.appendChild(inp);
        inp.click();
    }
    /** a page with a cover: the picture with icon and title on it, fading into the page.
     *  Across the whole window (unless "Page"), S / M / L high; drag the picture to choose what shows. */
    /** the page whose cover is being repositioned (⋯ → Cover → Reposition) */
    coverMoving = null;
    heroEl(p, head) {
        const cover = this.coverEl(p.cover);
        cover.style.backgroundPositionY = `${p.coverY ?? 50}%`;
        const hero = h('div', { class: `page-hero h-${p.coverHeight ?? 'm'}` + (p.coverWidth === 'page' ? '' : ' full') }, cover, head);
        // full width: as wide as the scrolling area (the page itself is narrower and centred in it)
        if (p.coverWidth !== 'page')
            requestAnimationFrame(() => {
                const sc = hero.closest('.scroll');
                if (!sc)
                    return;
                const fit = () => {
                    const pg = hero.parentElement, cs = getComputedStyle(pg);
                    const col = pg.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
                    hero.style.setProperty('--hero-w', `${sc.clientWidth}px`);
                    hero.style.setProperty('--hero-pad', `${Math.max(0, (sc.clientWidth - col) / 2)}px`);
                };
                fit();
                new ResizeObserver(fit).observe(sc);
            });
        // Reposition (⋯ → Cover): drag the picture up or down until Done – also with a finger
        if (this.coverMoving === p.id) {
            hero.classList.add('moving');
            const start = p.coverY ?? 50;
            const done = () => { document.removeEventListener('keydown', key, true); this.coverMoving = null; if ((p.coverY ?? 50) !== start)
                void this.ws.savePage(p); this.render(); };
            const key = (e) => { if (e.key === 'Escape' || e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                done();
            } };
            document.addEventListener('keydown', key, true);
            hero.appendChild(h('div', { class: 'hero-moving' }, iconSvg('move', 15), h('span', null, 'Drag the picture'), h('button', { class: 'set-btn primary', onclick: done }, 'Done')));
            cover.addEventListener('pointerdown', (e) => {
                if (e.button !== 0)
                    return;
                e.preventDefault();
                const y0 = e.clientY, from = p.coverY ?? 50, hgt = cover.clientHeight || 1;
                cover.setPointerCapture(e.pointerId);
                cover.classList.add('dragging');
                const move = (ev) => { p.coverY = Math.max(0, Math.min(100, Math.round(from - ((ev.clientY - y0) / hgt) * 100))); cover.style.backgroundPositionY = `${p.coverY}%`; };
                const up = () => { cover.removeEventListener('pointermove', move); cover.removeEventListener('pointerup', up); cover.classList.remove('dragging'); };
                cover.addEventListener('pointermove', move);
                cover.addEventListener('pointerup', up);
            });
        }
        return hero;
    }
    /** a page's cover: a link, or a picture stored in the workspace (assets/…) */
    coverEl(src) {
        const el = h('div', { class: 'page-cover' });
        const show = (u) => { el.style.backgroundImage = `url("${u.replace(/"/g, '%22')}")`; };
        if (/^(https?:|data:|blob:)/.test(src))
            show(src);
        else
            void this.assetUrl(src).then(show).catch(() => el.classList.add('missing'));
        return el;
    }
    /** pick a picture on this device and make it the page's cover (stored with the workspace's files) */
    uploadCover(p) {
        const st = this.ws.storage;
        if (!st.writeBinary) {
            toast('This workspace cannot store files');
            return;
        }
        const inp = h('input', { type: 'file', accept: 'image/*', hidden: true });
        inp.addEventListener('change', async () => {
            const f0 = inp.files?.[0];
            inp.remove();
            if (!f0)
                return;
            const f = (await prepareUpload([f0], this.ws.settings.compress))?.[0];
            if (!f)
                return;
            const path = this.ws.newFilePath(p.file, f.name || 'cover.jpg');
            try {
                await this.ws.writeFile(path, new Uint8Array(await f.arrayBuffer()));
            }
            catch (e) {
                toast(`Could not store the picture: ${e.message}`);
                return;
            }
            this.ws.boundary();
            p.cover = path;
            await this.ws.savePage(p);
            this.render();
        });
        document.body.appendChild(inp);
        inp.click();
    }
    /** how a backlink opens its page or entry */
    blOpen() { return { page: (id) => this.openPage(id), row: (db, row) => this.openRowPage(db, row), linkTo: (el, id) => this.linkTo(el, id) }; }
    /** Page menu: right-click in the sidebar ('side') or ⋯ at the top right of an open page ('top'). */
    pageMenu(p, anchor, where = 'side') {
        const s = this.ws.settings;
        const fav = s.favorites.includes(p.id);
        const side = where === 'side';
        // grouped: open · change the page · how it looks · where it is kept · look into it · delete
        const words = (() => { const text = pageToText(serializePage(p.blocks)); const n = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length; return { label: `${n.toLocaleString()} word${n === 1 ? '' : 's'}`, hint: `${text.replace(/\s/g, '').length.toLocaleString()} characters`, run: () => { } }; })();
        const width = p.layoutWidth ?? (p.fullWidth || p.width ? resolvePageWidth(p, this.ws.settings) : undefined);
        // the same order in every menu: open · edit · arrange · info · delete
        menu(anchor, [
            ...(!side && isPhone() ? [{ label: 'New page', run: () => void this.newPage() }] : []),
            ...(side ? [{ label: 'Open', run: () => this.openPage(p.id) }] : []),
            ...(TAURI || isPhone() ? [] : [{ label: 'Open in new tab', hint: '⌘↵', run: () => window.open(this.pageUrl(p.id), '_blank') }]),
            { label: 'New subpage', run: () => this.newPage(p.id) },
            { section: 'Edit' },
            { label: 'Rename', run: () => prompt(anchor, 'Page title', p.title, (v) => { void this.renamePage(p, v); }) },
            { label: 'Icon', icon: menuIcon('sparkles'), run: () => pickIcon(anchor, p.icon, async (v) => { p.icon = v; await this.ws.savePage(p); this.render(); }) },
            { label: 'Cover', icon: menuIcon('image'), hint: p.cover ? 'Image' : 'None', sub: () => [
                    { label: 'Upload image…', icon: menuIcon('upload'), run: () => this.uploadCover(p) },
                    { label: 'Image link…', icon: menuIcon('link'), run: () => prompt(anchor, 'Image URL for the cover', /^https?:/.test(p.cover ?? '') ? p.cover : '', async (v) => { p.cover = v || undefined; await this.ws.savePage(p); this.render(); }) },
                    ...(p.cover ? [
                        { section: 'Display' },
                        { label: 'Width', icon: menuIcon('move-horizontal'), seg: { options: [['page', 'Page'], ['full', 'Full']], value: p.coverWidth ?? 'full', pick: (v) => { if (v === 'page')
                                    p.coverWidth = 'page';
                                else
                                    delete p.coverWidth; void this.ws.savePage(p); this.render(); } } },
                        { label: 'Height', icon: menuIcon('move-vertical'), seg: { options: [['s', 'S'], ['m', 'M'], ['l', 'L']], value: p.coverHeight ?? 'm', pick: (v) => { if (v === 'm')
                                    delete p.coverHeight;
                                else
                                    p.coverHeight = v; void this.ws.savePage(p); this.render(); } } },
                        { label: 'Reposition', icon: menuIcon('move'), run: () => { this.coverMoving = p.id; this.render(); } },
                    ] : []),
                    ...(p.cover ? ['sep', { label: 'Remove cover', icon: menuIcon('trash'), danger: true, run: async () => { p.cover = undefined; await this.ws.savePage(p); this.render(); } }] : []),
                ] },
            ...(isPhone() ? [] : [widthEntry(width, (v) => { p.layoutWidth = v; delete p.fullWidth; delete p.width; void this.ws.savePage(p); this.render(); })]),
            { label: 'Backlinks', icon: menuIcon('link'), seg: { options: [['default', 'Auto'], ['expanded', 'Open'], ['collapsed', 'Folded'], ['off', 'Off']], value: p.backlinks ?? 'default', pick: async (v) => { if (v === 'default')
                        delete p.backlinks;
                    else
                        p.backlinks = v; await this.ws.savePage(p); this.render(); } } },
            { section: 'Arrange' },
            { label: 'Move to', icon: menuIcon('folder'), hint: p.parent ? (this.ws.pages.get(p.parent)?.title || 'Untitled') : 'Top level', subFilter: true, sub: () => [{ label: 'Top level', icon: menuIcon('home'), run: () => this.movePage(p, null, 'inside') },
                    'sep',
                    ...pickEntries(pageItems(this.ws, (x) => x.id === p.id || this.isInside(x.id, p.id)), (id) => this.movePage(p, this.ws.pages.get(id), 'inside'), p.parent)] },
            { label: 'Duplicate', hint: side ? undefined : '⌘D', run: async () => {
                    this.ws.boundary();
                    try {
                        const c = await this.ws.duplicatePage(p);
                        this.refreshSide();
                        this.openPage(c.id);
                    }
                    catch (e) {
                        toast(`Could not duplicate: ${e.message}`, 5000);
                    }
                } },
            { label: 'Favourite', icon: menuIcon('star'), toggle: fav, onToggle: async (on) => { s.favorites = on ? [...s.favorites.filter((x) => x !== p.id), p.id] : s.favorites.filter((x) => x !== p.id); await this.ws.saveSettings(); this.render(); } },
            { label: 'Start page', icon: menuIcon('home'), toggle: this.ws.meta.home === p.id, onToggle: async (on) => { if (on)
                    this.ws.meta.home = p.id;
                else if (this.ws.meta.home === p.id)
                    delete this.ws.meta.home; await this.ws.saveMeta(); this.render(); } },
            { section: 'Info' },
            ...(where === 'top' ? [{ label: 'Find on page', hint: '⌘F', run: () => openFind() }] : []),
            this.linkedFromEntry(p),
            { label: 'History', icon: menuIcon('clock'), run: () => this.openHistory(p.file) },
            { label: 'Export', sub: () => [
                    { label: 'Markdown', run: () => this.runExport(() => exportPage(this.ws, p)) },
                    { label: 'Markdown with subpages', hint: '.zip', run: () => this.runExport(() => exportPage(this.ws, p, { subpages: true, databases: true })) },
                    { label: 'HTML', run: () => this.runExport(() => exportHtml(this.ws, p.title, p.blocks)) },
                    { label: 'Print / PDF', hint: '⌘P', run: () => { if (!(this.route?.kind === 'page' && this.route.id === p.id))
                            this.openPage(p.id); setTimeout(() => window.print(), 350); } },
                ] },
            { label: p.remindAt?.length ? `Remind me · ${p.remindAt.length}` : 'Remind me about this page…', icon: menuIcon('bell'), run: () => remindAtMenu(this.ws, { page: p }, anchor, () => this.render()) },
            ...this.revealEntry(p.file),
            words,
            ...(isPhone() && (this.ws.canUndo() || this.ws.canRedo()) ? ['sep'] : []),
            ...(isPhone() && this.ws.canUndo() ? [{ label: 'Undo', run: () => void this.undo() }] : []),
            ...(isPhone() && this.ws.canRedo() ? [{ label: 'Redo', run: () => void this.redo() }] : []),
            ...(side ? [] : ['sep', { label: 'Settings', hint: prettyKey(this.keymap.binding('settings')), run: () => this.settingsDialog() }]),
            'sep',
            { label: 'Delete page', danger: true, run: () => this.confirm(`Delete "${p.title}"${this.descendants(p.id) ? ` and its ${this.descendants(p.id)} subpage${this.descendants(p.id) > 1 ? 's' : ''}` : ''}? You can bring it back from the trash for 30 days${isPhone() ? '' : ` (or undo with ${prettyKey('Mod+Z')})`}.`, async () => {
                    await this.ws.deletePage(p);
                    if (this.route?.kind === 'page' && this.route.id === p.id) {
                        const home = this.ws.homePage();
                        this.route = home ? { kind: 'page', id: home.id } : null;
                    }
                    this.render();
                }) },
        ], { title: p.title || 'Untitled' });
    }
    confirm(text, ok) {
        // "Delete "X" and its 2 subpages? You can bring it back …" → the question as the title, the rest below
        const m = /^(.*?\?)\s*(.*)$/s.exec(text);
        confirmDialog({ title: m ? m[1] : text, lines: m && m[2] ? [m[2]] : [], ok: 'Delete', danger: true, onOk: ok });
    }
    newDatabase(kind) {
        const at = this.root.querySelector('.side .side-new-db') ?? this.root.querySelector('.side') ?? this.root;
        if (!kind) {
            // a plain database, or one entry per day (diary, habits, shoot days …)
            menu(at, [
                { label: 'Database', icon: menuIcon('database'), hint: 'Table, board, calendar …', run: () => this.newDatabase('plain') },
                { label: 'Log', icon: menuIcon('calendar'), hint: 'One entry per day – diary, habits, shoot days', run: () => newDayDatabase(this) },
            ], { title: 'New' });
            return;
        }
        prompt(at, 'Name of the new database', 'New database', async (v) => {
            const name = v.trim();
            if (!name)
                return;
            const db = await this.ws.createDatabase(name);
            this.openDb(db.key);
        });
    }
    async newPage(parent) {
        // a new page starts with an empty title (greyed "Untitled") and the cursor in it: just type
        const p = await this.ws.createPage('Untitled', parent);
        this.openPage(p.id);
        requestAnimationFrame(() => { this.root.querySelector('.page-title[contenteditable="true"]')?.focus(); });
    }
    /** on a phone the top bar shows only where you are: favorites, history and delete move into ⋯ */
    phoneExtras() {
        if (!isPhone())
            return [];
        const r = this.route, st = this.ws.settings, out = [{ label: 'New page', run: () => void this.newPage() }, 'sep'];
        if (r?.kind === 'db') {
            const id = `db:${r.key}`, on = st.favorites.includes(id);
            out.push({ label: on ? 'Remove from favorites' : 'Add to favorites', run: async () => { st.favorites = on ? st.favorites.filter((x) => x !== id) : [...st.favorites, id]; await this.ws.saveSettings(); this.render(); } }, 'sep');
        }
        if (r?.kind === 'row') {
            out.push({ label: 'History of this entry', run: () => this.openHistory(this.rowFile(r.db, r.id)) }, ...this.revealEntry(this.rowFile(r.db, r.id)), { label: 'Delete entry', danger: true, run: async () => {
                    const db = this.ws.dbs.get(r.db);
                    const row = db?.rows.find((x) => x.id === r.id);
                    if (!db || !row)
                        return;
                    this.ws.boundary();
                    await this.ws.deleteRow(db, row);
                    toast('Entry moved to the trash');
                    this.back();
                } }, 'sep');
        }
        return out;
    }
    /** the ⋯ in the phone's bottom bar: the page's menu (with favorites), or the database's / entry's */
    moreMenu(at) {
        const r = this.route;
        const p = r?.kind === 'page' ? this.ws.pages.get(r.id) : undefined;
        if (p)
            this.pageMenu(p, at, 'top');
        else
            this.optionsMenu(at);
    }
    /** only the sidebar and the top bar change – the page stays as it is (fast, keeps scroll and state) */
    /** the bar at the bottom on a phone */
    /** Settings as a phone page, left for another tab: gone at once */
    closeSettingsNow() {
        const ov = document.querySelector('.overlay:has(.settings-dialog)');
        if (ov)
            ov.style.display = 'none';
        this.settingsWin?.close();
        this.settingsWin = null;
        ov?.remove();
    }
    tabBar() {
        const home = this.ws.homePage();
        const onHome = !this.libraryOn && this.route?.kind === 'page' && this.route.id === home?.id;
        const tab = (label, icon, run, on = false) => h('button', { class: 'tab tab-' + label.toLowerCase() + (on ? ' on' : ''), onclick: () => {
                // Settings and Notifications are pages of their own (phone): a tab shows one page – tapping the page
                // that is open stays on it, any other tab leaves it at once (no closing slide over the bar)
                // windows open on top (an entry, a page …) go first – the bar stays above them, so a tab means leaving them
                closeSheets();
                closePop();
                const settingsOpen = !!(this.settingsWin && document.querySelector('.set-window'));
                if ((label === 'Settings' && settingsOpen && !this.notes.panelOpen) || (label === 'Notifications' && this.notes.panelOpen))
                    return;
                if (label !== 'Notifications' && this.notes.panelOpen)
                    this.notes.closePanel();
                if (label === 'Settings' && settingsOpen)
                    return;
                if (settingsOpen)
                    this.closeSettingsNow();
                run();
            } }, typeof icon === 'string' ? iconSvg(icon, 22) : icon, h('span', null, label));
        // the tabs float in a frosted capsule; ＋ is its own round button beside it
        const add = h('button', { class: 'tab-fab', 'aria-label': 'Quick buttons and new page', onclick: () => this.quickMenu(add) }, svgIcon(ICONS.plus, 24));
        return h('nav', { class: 'tab-bar', 'aria-label': 'Main' }, h('div', { class: 'tab-pill' }, tab('Home', 'home', () => {
            if (!home)
                return;
            if (this.libraryOn) {
                this.libraryOn = false;
                this.render();
                if (this.route?.kind === 'page' && this.route.id === home.id)
                    return;
            }
            // already home: glide back to the top instead of reloading
            if (this.route?.kind === 'page' && this.route.id === home.id) {
                const sc = [...this.root.querySelectorAll('.scroll, .main, main')].find((e) => e.scrollTop > 0);
                if (sc)
                    sc.scrollTo({ top: 0, behavior: 'smooth' });
                else
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            this.openPage(home.id);
        }, onHome), tab('Library', 'list', () => {
            // the Pages screen; tapped again: back to its top level, then back to the page you were on
            // on Pages and scrolled down: glide back to the top first (as Home does)
            if (this.libraryOn) {
                const sc = this.root.querySelector('.main > .scroll');
                if (sc && sc.scrollTop > 4) {
                    sc.scrollTo({ top: 0, behavior: 'smooth' });
                    return;
                }
            }
            if (this.libraryOn && this.libraryAt) {
                this.libraryAt = null;
                this.render();
                return;
            }
            // already on Pages at the top: nothing to do – tapping Pages never closes it
            if (this.libraryOn)
                return;
            // opening it is a step back can return from
            if (this.route)
                this.history.push(this.route);
            this.future = [];
            this.libraryOn = true;
            this.libraryAt = null;
            this.pagesQuery = '';
            this.render();
        }, this.libraryOn), (() => { const b = tab('Notifications', 'bell', () => this.notes.open()); b.setAttribute('aria-label', 'Notifications'); b.classList.add('nb-host', 'tab-bell'); b.appendChild(nbDot()); return b; })(), tab('Settings', 'settings', () => this.settingsDialog())), add);
    }
    toggleSidebar() {
        if (isPhone() && this.sidebarOpen) {
            // closing on a phone: it slides away to the left, as when swiped
            const side = this.root.querySelector('.app > .sidebar'), back = this.root.querySelector('.side-backdrop');
            if (side && !side.dataset.closing && !side.style.transform.includes('-105%')) {
                side.dataset.closing = '1';
                side.style.transition = 'transform .2s ease-in';
                side.style.transform = 'translateX(-105%)';
                if (back) {
                    back.style.transition = 'opacity .2s ease-in';
                    back.style.opacity = '0';
                }
                this.root.querySelectorAll('.tab-bar .tab')[2]?.classList.remove('on');
                setTimeout(() => { this.sidebarOpen = false; this.render(); }, 190);
                return;
            }
            if (side?.dataset.closing && !side.style.transform.includes('-105%'))
                return;
        }
        this.sidebarOpen = !this.sidebarOpen;
        if (isPhone()) {
            this.render();
            return;
        }
        const app = this.root.querySelector(':scope > .app');
        const tb = app?.querySelector('.main > .topbar');
        if (!app || !tb) {
            this.render();
            return;
        }
        app.querySelector(':scope > .sidebar')?.remove();
        if (this.sidebarOpen)
            app.prepend(this.sidebar());
        tb.replaceWith(this.topbar());
        app.querySelector('.ws-float')?.remove();
        if (!this.sidebarOpen && this.ws.settings.wsFloat)
            app.querySelector('.main')?.appendChild(h('div', { class: 'ws-float' }, this.wsbarInner()));
        // an open Notifications panel and the reminder cards move along with the corner
        this.notes.relayout();
    }
    /** a new place: remembered for Back (going to the page you are on changes nothing) */
    go(r) {
        // on a phone, choosing a page closes the drawer
        if (isPhone() && this.sidebarOpen) {
            this.sidebarOpen = false;
            this.root.querySelector('.app > .sidebar')?.remove();
            this.root.querySelector('.side-backdrop')?.remove();
        }
        // opened from the Pages screen: Back (or the edge swipe) returns to it
        if (this.libraryOn) {
            const mark = { kind: 'pages', at: this.libraryAt };
            this.libraryOn = false;
            this.libraryAt = null;
            if (this.route)
                this.history.push(this.route);
            this.history.push(mark);
            this.future = [];
            if (this.route && JSON.stringify(this.route) === JSON.stringify(r)) {
                this.history.pop();
                this.history.push(mark);
                this.render();
                return;
            }
            this.route = r;
            return;
        }
        closePeeks(); // a link in a centre peek: the peek makes way for what it opened
        if (this.route && JSON.stringify(this.route) === JSON.stringify(r))
            return;
        this.keepScroll();
        if (this.route)
            this.history.push(this.route);
        this.future = [];
        this.route = r;
    }
    future = [];
    canGo(dir) { return (dir === 'back' ? this.history : this.future).length > 0; }
    /** where each place was scrolled to: Back and Forward (buttons, keys, edge swipes) come back to it */
    scrollPos = new Map();
    keepScroll() {
        const sc = this.root.querySelector('.main > .scroll');
        if (this.route && sc)
            this.scrollPos.set(JSON.stringify(this.route), sc.scrollTop);
    }
    restoreScroll() {
        const top = this.scrollPos.get(JSON.stringify(this.route));
        if (!top)
            return;
        const apply = () => { const sc = this.root.querySelector('.main > .scroll'); if (sc)
            sc.scrollTop = top; };
        apply();
        requestAnimationFrame(apply);
        setTimeout(apply, 120); // views and pictures may still be growing
    }
    back() {
        const r = this.history.pop();
        if (!r)
            return;
        this.keepScroll();
        const here = this.libraryOn ? { kind: 'pages', at: this.libraryAt } : this.route;
        if (here)
            this.future.push(here);
        this.show(r);
    }
    forward() {
        const r = this.future.pop();
        if (!r)
            return;
        this.keepScroll();
        const here = this.libraryOn ? { kind: 'pages', at: this.libraryAt } : this.route;
        if (here)
            this.history.push(here);
        this.show(r);
    }
    /** a step of Back / Forward: a place, or the Pages screen */
    show(r) {
        if (r.kind === 'pages') {
            this.libraryOn = true;
            this.libraryAt = r.at;
            this.render();
            // back in the Library: where you were in the list
            const y = this.libScroll.get(r.at ?? '') ?? 0, sc = this.root.querySelector('.main > .scroll');
            if (sc && y) {
                sc.scrollTop = y;
                requestAnimationFrame(() => { sc.scrollTop = y; });
            }
            return;
        }
        // the place under the Pages screen is the one before it (the route stays as it was)
        if (this.libraryOn) {
            this.libraryOn = false;
            this.libraryAt = null;
        }
        this.route = r;
        this.navigate();
        this.restoreScroll();
    }
    // ---------- export ----------
    async runExport(make) {
        toast('Preparing the export…', 1500);
        try {
            const x = await make();
            await saveFile(x);
            if (x.files > 1)
                toast(`Exported ${x.files} files`);
        }
        catch (e) {
            toast(`The export did not work: ${e.message}`, 5000);
        }
    }
    // ---------- undo / redo ----------
    async undo() {
        closePop();
        if (!this.ws.canUndo()) {
            toast('Nothing to undo');
            return;
        }
        await this.ws.undo();
        this.afterHistory();
    }
    async redo() {
        closePop();
        if (!this.ws.canRedo()) {
            toast('Nothing to redo');
            return;
        }
        await this.ws.redo();
        this.afterHistory();
    }
    afterHistory() {
        this.notes.fromHistory();
        this.keymap.overrides = this.ws.keymap;
        this.applySettings();
        if (this.route?.kind === 'page' && !this.ws.pages.has(this.route.id)) {
            const h0 = this.ws.homePage();
            this.route = h0 ? { kind: 'page', id: h0.id } : null;
        }
        if (document.querySelector('.overlay:not(.phone-page)'))
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        this.render();
    }
    // ---------- page peek ----------
    /** a page in the centre peek window (as entries open): icon, title and its content, editable; ⤢ opens it as a full page */
    peekPage(id) {
        const ws = this.ws, p = ws.pages.get(id);
        if (!p)
            return;
        const save = () => ws.savePage(p);
        const editor = new Editor(p.blocks, this, save, false, p.id);
        editor.commentPath = p.file;
        editor.fileOf = () => p.file;
        const title = h('h1', { class: 'page-title', contenteditable: 'true', spellcheck: 'false', 'data-ph': 'Untitled' }, p.title === 'Untitled' ? '' : p.title);
        title.addEventListener('input', debounce(() => { p.title = title.textContent?.trim() || 'Untitled'; save(); ws.emit(); }, 400));
        enableAutoReplace(title);
        const crumb = h('span', { style: { flex: 1, padding: '0 6px', display: 'inline-flex', alignItems: 'center', gap: '6px' } }, renderIcon(p.icon, 14), h('span', null, p.title || 'Untitled'));
        let close = () => { };
        close = dialog(h('div', { class: 'peek' }, h('div', { class: 'dialog-head' }, crumb, h('button', { class: 'icon-btn', 'aria-label': 'Open as full page', title: 'Open as full page', onclick: () => { close(); this.openPage(id); } }, iconSvg('maximize', 14)), h('button', { class: 'icon-btn', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => close() }, svgIcon(ICONS.close, 17))), h('div', { class: 'dialog-body peek-body' }, h('div', { class: 'page page-peek' }, h('div', { class: 'page-head' }, h('button', { class: 'page-icon' + (p.icon ? '' : ' empty'), title: 'Change icon', onclick: (e) => pickIcon(e.currentTarget, p.icon, (v) => { p.icon = v; save(); const ic = e.target.closest('.page-icon'); if (ic)
                ic.replaceChildren(renderIcon(v, 32)); this.render(); }) }, p.icon ? renderIcon(p.icon, 32) : h('span', { class: 'add-icon' }, svgIcon(ICONS.plus, 14), 'Add icon')), title), editor.el))), { wide: true, onClose: () => { ws.emit(); } });
    }
    // ---------- entry page (peek) ----------
    /**
     * An entry is a page: icon, title, properties, then the same block editor as any page.
     * Built once and shown either in the peek window or as a full page (route "row").
     */
    rowPage(db, row, onTitle) {
        const ws = this.ws;
        const titleProp = db.titleProp;
        let showHidden = false;
        const title = h('h1', { class: 'page-title', contenteditable: db.dateLabel ? 'false' : 'true', spellcheck: 'false', 'data-ph': db.dateLabel ? 'No date' : 'Untitled', 'aria-label': db.dateLabel ?? titleProp, 'data-name': `row:${db.key}:${row.id}` }, db.dateLabel ? db.rowLabel(row) : String(row.values[titleProp] ?? ''));
        const saveTitle = () => { if (db.dateLabel)
            return; const t = (title.textContent ?? '').replace(/\n/g, ' ').trim(); if (t !== String(row.values[titleProp] ?? '')) {
            row.values[titleProp] = t;
            ws.saveRow(db, row);
            onTitle?.();
        } };
        title.addEventListener('input', debounce(saveTitle, 400));
        title.addEventListener('input', () => this.liveName(`row:${db.key}:${row.id}`, (title.textContent ?? '').replace(/\n/g, ' ').trim() || 'Untitled'));
        title.addEventListener('blur', () => { saveTitle(); this.liveName(`row:${db.key}:${row.id}`, null); });
        enableAutoReplace(title);
        const props = h('div', { class: 'props' });
        const hiddenToggle = h('button', { class: 'vtool small', style: { margin: '-4px 0 8px' } });
        const isEmpty = (v) => v == null || v === '' || v === false || (Array.isArray(v) && !v.length);
        const repeatDate = () => (repeatOn(db) ? db.schema.properties.find((x) => x.type === 'date')?.name : undefined);
        const remindDate = () => db.views.find((v) => v.type === 'calendar' && v.dateProp)?.dateProp ?? db.schema.properties.find((x) => x.type === 'date')?.name;
        /** the order of the fields on entry pages: properties plus "@repeat" / "@reminder" (drag to change, stored per database) */
        const fieldOrder = () => {
            const def = [];
            for (const p of db.schema.properties) {
                if (p.type === 'title' && !(db.dateLabel && db.schema.showNameWithDate))
                    continue;
                def.push(p.name);
                if (p.name === repeatDate())
                    def.push('@repeat');
                if (p.name === remindDate())
                    def.push('@reminder');
            }
            const saved = db.schema.pageOrder;
            if (!saved)
                return def;
            const out = saved.filter((k) => def.includes(k));
            def.forEach((k, i) => { if (!out.includes(k)) {
                const prev = def[i - 1];
                const at = prev ? out.indexOf(prev) : -1;
                out.splice(at + 1, 0, k);
            } });
            return out;
        };
        const saveOrder = async (order) => { db.schema.pageOrder = order; ws.boundary(); await ws.saveSchema(db); drawProps(); };
        /** a new property right above / below another field */
        const addNear = (key, where, at) => addPropertyMenu(ws, db, at, (np) => {
            const order = fieldOrder().filter((k) => k !== np.name);
            const i = order.indexOf(key);
            order.splice(i < 0 ? order.length : where === 'above' ? i : i + 1, 0, np.name);
            void saveOrder(order);
        });
        let dragKey = null;
        const draggableName = (name, key) => {
            name.dataset.key = key;
            name.draggable = true;
            // pressing a property name starts a move, not the page's selection rectangle
            name.addEventListener('mousedown', (e) => e.stopPropagation());
            name.addEventListener('dragstart', (e) => { dragKey = key; e.dataTransfer?.setData('text/plain', key); if (e.dataTransfer)
                e.dataTransfer.effectAllowed = 'move'; name.classList.add('dragging'); });
            name.addEventListener('dragend', () => { dragKey = null; props.querySelectorAll('.drop-before, .drop-after, .dragging').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'dragging')); });
        };
        const drawProps = () => {
            if (db.dateLabel) {
                title.textContent = db.rowLabel(row);
                this.liveName(`row:${db.key}:${row.id}`, db.rowLabel(row));
            }
            props.textContent = '';
            let hidden = 0;
            const fieldHide = (k, empty) => { const m = db.schema.fieldsHidden?.[k]; return m === 'always' || (m === 'empty' && empty); };
            for (const key of fieldOrder()) {
                if (key === '@repeat' || key === '@reminder') {
                    // the built-in Repeat and Reminder fields can be hidden and moved like properties
                    const k = key === '@repeat' ? 'repeat' : 'reminder';
                    // Reminder: the times of "Remind me about this" (reminders before the date are a chip next to the date)
                    // with a date, the times show in the chip beside it
                    if (k === 'reminder' && (!row.remindAt?.length || (remindDate() && asDate(row.values[remindDate()]))))
                        continue;
                    const hideIt = fieldHide(k, k === 'repeat' ? !row.repeat : !row.remindAt?.length);
                    if (hideIt)
                        hidden++;
                    if (hideIt && !showHidden)
                        continue;
                    const els = k === 'repeat' ? this.repeatField(db, row, drawProps) : this.remindField(db, row, remindDate(), drawProps);
                    if (hideIt)
                        els[0].classList.add('is-hidden');
                    draggableName(els[0], key);
                    props.append(...els);
                    continue;
                }
                const p = db.prop(key);
                if (!p)
                    continue;
                const v = db.value(row, p.name);
                const hide = p.name !== db.dateLabel && (p.pageHidden === 'always' || (p.pageHidden === 'empty' && isEmpty(v)));
                if (hide)
                    hidden++;
                if (hide && !showHidden)
                    continue;
                const val = h('div', { class: 'prop-val' + (v == null || v === '' ? ' empty' : ''), tabindex: 0, role: 'button' });
                const rendered = renderValue(db, p, v);
                if (rendered === '')
                    val.textContent = p.type === 'formula' || p.type.endsWith('_time') ? '' : 'Empty';
                else
                    val.append(rendered);
                // the reminder sits with the date: a bell chip (faint until one is set)
                if (p.type === 'date' && (p.name === remindDate() || db.schema.reminders?.props?.[p.name] != null) && v)
                    val.append(this.remindChipEl(db, row, p.name, p.name === remindDate(), drawProps));
                const edit = () => editValue(ws, db, row, p.name, val, drawProps);
                val.addEventListener('click', edit);
                val.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
                    e.preventDefault();
                    edit();
                } });
                const name = h('div', { class: 'prop-name' + (hide ? ' is-hidden' : ''), title: p.formula ? `= ${p.formula}` : 'Click for options · drag to move' }, typeIcon(p.type, p.icon), p.name);
                const ctxMenu = (e) => { e.preventDefault(); e.stopPropagation(); this.propMenu(db, p, { x: e.clientX, y: e.clientY }, drawProps, (where, at) => addNear(p.name, where, at)); };
                name.addEventListener('contextmenu', ctxMenu);
                name.addEventListener('click', ctxMenu);
                draggableName(name, p.name);
                props.append(name, val);
            }
            // "Add a property" can be hidden (right-click); it then shows with the hidden properties
            const addHidden = !!db.schema.hideAddProp;
            if (addHidden)
                hidden++;
            if (!addHidden || showHidden) {
                const add = h('button', { class: 'prop-add' + (addHidden ? ' is-hidden' : ''), title: 'Right-click to hide', onclick: (e) => addPropertyMenu(ws, db, e.currentTarget, () => drawProps()) }, svgIcon(ICONS.plus, 14), 'Add a property');
                add.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    // the same Display row as every property (it is never filled, so only Show / Hide)
                    menu({ x: e.clientX, y: e.clientY }, [{ section: 'Display' }, { label: 'On entry pages', icon: menuIcon('file-text'), seg: { options: [['', 'Show'], ['always', 'Hide']], value: addHidden ? 'always' : '',
                                pick: async (v) => { if (v)
                                    db.schema.hideAddProp = true;
                                else
                                    delete db.schema.hideAddProp; ws.boundary(); await ws.saveSchema(db); drawProps(); } } }]);
                });
                props.append(add, h('span'));
            }
            hiddenToggle.textContent = showHidden ? `Hide ${hidden} hidden ${hidden === 1 ? 'item' : 'items'}` : `${hidden} hidden ${hidden === 1 ? 'item' : 'items'}`;
            hiddenToggle.style.display = hidden ? '' : 'none';
        };
        // drag a field's name to move it (the drop line shows where it goes)
        const target = (e) => {
            const names = [...props.querySelectorAll('.prop-name[data-key]')];
            let best = null, after = false;
            for (const n of names) {
                const r = n.getBoundingClientRect();
                if (e.clientY >= r.top - 2) {
                    best = n;
                    after = e.clientY > r.top + r.height / 2;
                }
            }
            return best ? { el: best, after } : null;
        };
        props.addEventListener('dragover', (e) => {
            if (!dragKey)
                return;
            e.preventDefault();
            props.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
            const t = target(e);
            if (t && t.el.dataset.key !== dragKey)
                t.el.classList.add(t.after ? 'drop-after' : 'drop-before');
        });
        props.addEventListener('drop', (e) => {
            if (!dragKey)
                return;
            e.preventDefault();
            const t = target(e);
            const key = dragKey;
            dragKey = null;
            if (!t || t.el.dataset.key === key) {
                drawProps();
                return;
            }
            const order = fieldOrder().filter((k) => k !== key);
            const i = order.indexOf(t.el.dataset.key);
            order.splice(t.after ? i + 1 : i, 0, key);
            void saveOrder(order);
        });
        hiddenToggle.addEventListener('click', () => { showHidden = !showHidden; drawProps(); });
        drawProps();
        const blocks = parsePage(row.body || '');
        if (!blocks.length)
            blocks.push({ id: crypto.randomUUID(), type: 'paragraph', text: '' });
        const editor = new Editor(blocks, this, () => { const body = serializePage(blocks); row.body = body.trim() ? body : ''; ws.saveRow(db, row); }, false, `row:${db.key}:${row.id}`);
        editor.onTitle = () => { title.focus(); placeCaretEnd(title); };
        editor.commentPath = ws.rowPath(db, row);
        editor.fileOf = () => ws.rowPath(db, row);
        title.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                const sel = getSelection();
                const full = title.textContent ?? '';
                let at = full.length;
                if (sel && sel.rangeCount && title.contains(sel.anchorNode)) {
                    const r = document.createRange();
                    r.selectNodeContents(title);
                    r.setEnd(sel.anchorNode, sel.anchorOffset);
                    at = r.toString().length;
                }
                const tail = full.slice(at);
                if (tail)
                    title.textContent = full.slice(0, at).trimEnd();
                saveTitle();
                // an empty first line is reused, otherwise a new one goes above the content
                const first = blocks[0];
                if (!tail && first && first.type === 'paragraph' && !first.text && blocks.length === 1) {
                    editor.focus(first.id, 'start');
                    return;
                }
                const nb = { id: ulid(), type: 'paragraph', text: tail.trim() };
                blocks.unshift(nb);
                editor.changed({ id: nb.id, at: 'start' });
            }
        });
        const icon = h('button', { class: 'page-icon' + (row.icon ? '' : ' empty'), title: 'Change icon', onclick: (e) => pickIcon(e.currentTarget, row.icon, async (v) => {
                if (v)
                    row.icon = v;
                else
                    delete row.icon;
                ws.boundary();
                await ws.saveRow(db, row);
                icon.textContent = '';
                icon.classList.toggle('empty', !row.icon);
                icon.append(row.icon ? renderIcon(row.icon, 30) : h('span', { class: 'add-icon' }, svgIcon(ICONS.plus, 14), 'Add icon'));
            }) }, row.icon ? renderIcon(row.icon, 30) : h('span', { class: 'add-icon' }, svgIcon(ICONS.plus, 14), 'Add icon'));
        const el = h('div', { class: 'row-page' }, h('div', { class: 'page-head' }, icon, title), props, hiddenToggle, h('div', { class: 'row-page-body' }, editor.el, this.folderFiles(ws.rowPath(db, row), () => JSON.stringify(blocks) + JSON.stringify(row.values), (b) => { blocks.push(b); row.body = serializePage(blocks); void ws.saveRow(db, row).then(() => this.render()); })), backlinksSection(ws, rowTarget(db.key, row.id), { row: row.id }, ws.settings.backlinks ?? 'collapsed', this.blOpen()));
        return { el, focusTitle: () => { if (db.dateLabel) {
                editValue(ws, db, row, db.dateLabel, title, drawProps);
                return;
            } title.focus({ preventScroll: true }); placeCaretEnd(title); } };
    }
    /** "On entry pages: show / hide when empty / hide" for the built-in Repeat and Reminder fields */
    fieldVisibility(db, k, redraw) {
        const cur = db.schema.fieldsHidden?.[k];
        const set = async (v) => {
            const f = { ...(db.schema.fieldsHidden ?? {}) };
            if (v)
                f[k] = v;
            else
                delete f[k];
            if (Object.keys(f).length)
                db.schema.fieldsHidden = f;
            else
                delete db.schema.fieldsHidden;
            this.ws.boundary();
            await this.ws.saveSchema(db);
            redraw();
        };
        // the same row as for every property: Show / If filled / Hide
        return [
            { section: 'Display' },
            { label: 'On entry pages', icon: menuIcon('file-text'), seg: { options: [['', 'Show'], ['empty', 'If filled'], ['always', 'Hide']], value: cur ?? '', pick: (v) => void set((v || undefined)) } },
        ];
    }
    /** the bell chip next to a date: what reminds before it; click to change */
    remindChipEl(db, row, prop, main, redraw) {
        const d = asDate(row.values[prop]);
        const text = main ? remindChip(this.ws, db, row, d) : (() => { const m = db.schema.reminders?.props?.[prop]; return m == null ? '' : describeRemind({ ...row, remind: m }, d); })();
        const chip = h('button', { class: 'rem-chip' + (text ? ' on' : ''), title: main ? 'Reminder · click to change' : 'Set for this database (⋯ → Reminders)', onclick: (e) => {
                e.stopPropagation();
                if (main)
                    remindMenu(this.ws, db, row, prop, chip, redraw);
                else
                    this.dbRemindersDialog(db);
            } }, iconSvg('bell', 12), text ? h('span', null, text) : null);
        return chip;
    }
    /** "Reminder" field: the times of "Remind me about this" */
    remindField(db, row, _dateProp, redraw) {
        void _dateProp;
        const val = h('div', { class: 'prop-val rem-list', tabindex: 0, role: 'button' }, ...(row.remindAt ?? []).map((x) => h('span', { class: 'rem-chip on' }, iconSvg('clock', 12), h('span', null, fmtWhen(fromLocalIso(x))))));
        const open = () => remindAtMenu(this.ws, { row, db }, val, redraw);
        val.addEventListener('click', open);
        val.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
            e.preventDefault();
            open();
        } });
        const name = h('div', { class: 'prop-name', role: 'button', tabindex: 0, title: 'Remind me about this · click for options' }, h('span', { class: 'th-ico' }, iconSvg('bell', 14)), 'Remind');
        const opts = (at) => menu(at, this.fieldVisibility(db, 'reminder', redraw));
        name.addEventListener('click', (e) => opts(e.currentTarget));
        name.addEventListener('contextmenu', (e) => { e.preventDefault(); opts({ x: e.clientX, y: e.clientY }); });
        return [name, val];
    }
    /** a database's ⋯ → Reminders: which dates remind, how early; all-day entries; only entries not done */
    dbRemindersDialog(db) {
        const ws = this.ws;
        const cfg = db.schema.reminders ?? {};
        const save = () => { db.schema.reminders = cfg; if (!cfg.props || !Object.keys(cfg.props).length)
            delete cfg.props; void ws.saveSchema(db); this.notes.paint(); this.render(); };
        const dates = db.schema.properties.filter((p) => p.type === 'date');
        const main = remindDateProp(db);
        const sel = (value, opts, set) => {
            const s2 = h('select', { class: 'set-select' }, h('option', { value: '' }, main ? 'Workspace default' : 'None'), ...opts.map(([m, l]) => h('option', { value: String(m) }, l)));
            s2.value = value == null ? '' : String(value);
            s2.addEventListener('change', () => { set(s2.value === '' ? undefined : Number(s2.value)); save(); });
            return s2;
        };
        const rows = h('div', { class: 'dbr-body' }, h('div', { class: 'dbr-h' }, 'Remind before'), ...dates.map((p) => h('div', { class: 'dbr-row' }, iconSvg('calendar', 14), h('span', { class: 'dbr-n' }, p.name, p.name === main ? h('span', { class: 'dbr-sub' }, ' · calendar') : null), sel(cfg.props?.[p.name], REMIND_TIMED, (v) => { cfg.props ??= {}; if (v == null)
            delete cfg.props[p.name];
        else
            cfg.props[p.name] = v; }))), h('div', { class: 'dbr-row' }, iconSvg('sun', 14), h('span', { class: 'dbr-n' }, 'All-day entries'), sel(cfg.day, REMIND_DAY, (v) => { if (v == null)
            delete cfg.day;
        else
            cfg.day = v; })), h('label', { class: 'dbr-row' }, iconSvg('check-square', 14), h('span', { class: 'dbr-n' }, 'Only while not done'), (() => { const c = h('input', { type: 'checkbox', class: 'switch' }); c.checked = !!cfg.onlyOpen; c.addEventListener('change', () => { if (c.checked)
            cfg.onlyOpen = true;
        else
            delete cfg.onlyOpen; save(); }); return c; })()));
        const close = dialog(h('div', { class: 'bwindow dbr-window' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px', flex: 1 } }, `${db.schema.name} · Reminders`), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, svgIcon(ICONS.close))), rows));
    }
    /** "Repeat" field shown with the date in an entry page */
    repeatField(db, row, redraw) {
        const r = parseRRule(row.repeat);
        if (r && row.except)
            r.except = row.except;
        const val = h('div', { class: 'prop-val' + (r ? '' : ' empty'), tabindex: 0, role: 'button' }, describeRepeat(r, (d) => fmtDate({ start: d })));
        const open = () => repeatMenu(this.ws, db, row, val, redraw);
        val.addEventListener('click', open);
        val.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
            e.preventDefault();
            open();
        } });
        const name = h('div', { class: 'prop-name', role: 'button', tabindex: 0, title: 'Repeat this entry · click for options' }, h('span', { class: 'th-ico' }, iconSvg('repeat', 14)), 'Repeat');
        // switch the whole feature off for this database (entries keep their rules, they are just ignored)
        const opts = (at) => menu(at, [
            ...this.fieldVisibility(db, 'repeat', redraw),
            'sep',
            { label: 'Turn off repeating for this database', hint: db.schema.name, run: async () => { db.schema.repeat = false; this.ws.boundary(); await this.ws.saveSchema(db); toast('Repeating is off for this database – turn it on again in a view’s ⋯ settings'); redraw(); this.ws.emit(); } },
        ]);
        name.addEventListener('click', (e) => opts(e.currentTarget));
        name.addEventListener('contextmenu', (e) => { e.preventDefault(); opts({ x: e.clientX, y: e.clientY }); });
        return [name, val];
    }
    openRow(db, row, opts = {}) {
        closePop();
        const ws = this.ws;
        const initial = JSON.stringify(row.values);
        const initialBody = row.body ?? '';
        const crumb = h('span', { class: 'muted small dlg-crumb' });
        const setCrumb = () => { crumb.textContent = ''; crumb.append(h('button', { class: 'dlg-crumb-db', title: `Open ${db.schema.name}`, onclick: () => { noBack = true; close(); while (document.querySelector('.overlay')) {
                const n = document.querySelectorAll('.overlay').length;
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
                if (document.querySelectorAll('.overlay').length >= n)
                    break;
            } this.openDb(db.key); } }, renderIcon(db.schema.icon, 14, 'database'), h('span', null, db.schema.name))); if (opts.backLabel)
            crumb.append(h('span', { class: 'dlg-crumb-sep' }, '/'), h('span', { class: 'dlg-crumb-from' }, opts.backLabel)); };
        setCrumb();
        const page = this.rowPage(db, row);
        // everything behind the window (calendar, tables …) follows the edits live
        const live = debounce(() => ws.emit(), 250);
        const offLive = ws.onRowSaved((d, r) => { if (d === db && r === row)
            live(); });
        let close = () => { };
        let keep = false; // ⌘/Ctrl+Enter: keep the entry even if nothing was typed
        let noBack = false;
        const full = () => { noBack = true; close(); this.openRowPage(db, row); };
        const onKeep = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.stopPropagation();
            document.activeElement?.blur();
            keep = true;
            setTimeout(() => close(), 0);
        } };
        close = dialog(h('div', { class: 'peek' }, h('div', { class: 'dialog-head' }, opts.back ? h('button', { class: 'icon-btn peek-back', 'aria-label': 'Back', title: 'Back to the list', onclick: () => { const b = opts.back; close(); b(); } }, iconSvg('arrow-left', 16)) : null, h('span', { style: { flex: 1, padding: '0 6px', display: 'inline-flex', alignItems: 'center', gap: '4px' } }, crumb), h('button', { class: 'icon-btn', 'aria-label': 'History', title: 'History of this entry', onclick: () => this.openHistory(ws.rowPath(db, row)) }, iconSvg('clock', 13)), ws.storage.reveal ? h('button', { class: 'icon-btn', 'aria-label': ws.storage.remote ? 'Show in Dropbox' : 'Show in folder', title: ws.storage.remote ? 'Show in Dropbox' : 'Show in folder', onclick: () => void ws.storage.reveal(ws.rowPath(db, row)).catch((e) => toast(e.message)) }, iconSvg('folder', 13)) : null, h('button', { class: 'icon-btn', 'aria-label': 'Open as full page', title: 'Open as full page', onclick: full }, iconSvg('maximize', 14)), h('button', { class: 'icon-btn', 'aria-label': 'Delete entry', title: 'Delete entry', onclick: async () => { ws.boundary(); await ws.deleteRow(db, row); close(); } }, svgIcon(ICONS.trash, 17)), h('button', { class: 'icon-btn', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => close() }, svgIcon(ICONS.close, 17))), h('div', { class: 'dialog-body peek-body' }, page.el)), { wide: true, onClose: async () => {
                offLive();
                window.removeEventListener('keydown', onKeepAny, true);
                // a new entry closed without typing anything is discarded, as in Notion
                // a new entry you didn't touch (also one a button filled in) goes away again
                if (opts.isNew && !(db.dateLabel && asDate(row.values[db.dateLabel])?.start) && !keep && JSON.stringify(row.values) === initial && (row.body ?? '') === initialBody && db.rows.includes(row)) {
                    await ws.deleteRow(db, row);
                    ws.forgetFile(ws.rowPath(db, row));
                }
                ws.emit();
                if (!noBack)
                    opts.onClose?.();
            } });
        // capture phase, so the title and the editor can't swallow it
        // on the window, so it also works when nothing has the focus (after picking a select option, say);
        // only while this entry is the topmost window
        const peekEl = [...document.querySelectorAll('.peek')].pop();
        // a link inside the entry that leads elsewhere (a page, a database, another entry's page) closes the window,
        // so what was opened is not hidden behind it
        peekEl?.addEventListener('click', () => {
            const before = JSON.stringify(this.route);
            for (const ms of [0, 150, 400])
                setTimeout(() => { if (JSON.stringify(this.route) !== before && peekEl.isConnected) {
                    keep = true;
                    close();
                } }, ms);
        }, true);
        const onKeepAny = (e) => {
            if (!peekEl?.isConnected) {
                window.removeEventListener('keydown', onKeepAny, true);
                return;
            }
            const top = [...document.querySelectorAll('.overlay > .dialog')].pop();
            if (top && !top.contains(peekEl))
                return;
            onKeep(e);
        };
        window.addEventListener('keydown', onKeepAny, true);
        if (db.dateLabel ? opts.isNew : !row.values[db.titleProp]) {
            // phone: the keyboard comes up at once, so the sheet fades in instead of sliding (a sheet that moves while
            // its name has the focus makes iOS push the whole screen up)
            if (isPhone())
                [...document.querySelectorAll('.overlay > .dialog')].pop()?.classList.add('kb-first');
            page.focusTitle();
        }
    }
    /** An entry as a full page (route), like any other page. */
    openRowPage(db, row) {
        this.go({ kind: 'row', db: db.key, id: row.id });
        this.navigate(); // a new page starts at the top (its scroll area is new)
    }
    rowFullPage(db, row) {
        const page = this.rowPage(db, row, () => { const c = this.root.querySelector('.crumb:last-of-type .crumb-t'); if (c)
            c.textContent = db.rowLabel(row); });
        const width = workspaceWidth(this.ws.settings);
        return h('div', { class: 'page layout-page' + (width === 'full' ? ' full' : ''), style: widthStyle(width) }, page.el);
    }
    /** Right-click (or click) on a property name in an entry page: the same settings as in a table header. */
    propMenu(db, p, at, redraw, addNear) {
        const ws = this.ws;
        const setVis = async (v) => { if (v)
            p.pageHidden = v;
        else
            delete p.pageHidden; ws.boundary(); await ws.saveSchema(db); redraw(); };
        // hiding comes first, as in Notion; the rest is the same as in a table header
        void setVis;
        const own = propertyEntries(ws, db, p, at, redraw);
        const del = own.filter((e) => typeof e === 'object' && 'label' in e && e.label === 'Delete property');
        menu(at, [
            ...own.filter((e) => !del.includes(e) && e !== 'sep'),
            ...(addNear ? [{ section: 'Arrange' }, { label: 'Add a property above', icon: iconSvg('arrow-up', 15), run: () => addNear('above', at) }, { label: 'Add a property below', icon: iconSvg('arrow-down', 15), run: () => addNear('below', at) }] : []),
            ...(del.length ? ['sep', ...del] : []),
        ].filter((e, i, arr) => !(typeof e === 'object' && 'section' in e && e.section === 'Arrange' && arr.findIndex((x) => typeof x === 'object' && 'section' in x && x.section === 'Arrange') !== i)), { title: p.name });
    }
    // ---------- quick add ----------
    quickAdd(dbKey, values = {}) {
        const ws = this.ws;
        // the database last used for quick add on this computer, else the first one alphabetically
        const order = [...ws.dbs.values()].sort((a, b) => a.schema.name.localeCompare(b.schema.name)).map((d) => d.key);
        const last = (() => { try {
            return localStorage.getItem(`nook:quickadd:${ws.meta.name}`) ?? '';
        }
        catch {
            return '';
        } })();
        let key = dbKey && ws.dbs.has(dbKey) ? dbKey : ws.dbs.has(last) ? last : order[0];
        if (!key) {
            toast('No database in this workspace yet');
            return;
        }
        const head = h('div', { class: 'dialog-head' });
        const body = h('div', { class: 'dialog-body' });
        let draft = {};
        let close = () => { };
        const draw = () => {
            const db = ws.dbs.get(key);
            head.textContent = '';
            head.append(h('span', { class: 'muted small', style: { padding: '0 6px' } }, 'New entry in'), h('button', { class: 'vtab on', title: 'Choose database', onclick: (e) => menu(e.currentTarget, order.map((k) => ({ label: ws.dbs.get(k).schema.name, icon: renderIcon(ws.dbs.get(k).schema.icon, 16, 'database'), run: () => { key = k; draft = {}; draw(); } })), { filter: true }) }, renderIcon(db.schema.icon, 15, 'database'), db.schema.name, svgIcon(ICONS.chevron, 12)));
            body.textContent = '';
            const title = h('input', { class: 'qa-title', placeholder: db.titleProp, value: String(draft[db.titleProp] ?? '') });
            title.addEventListener('input', () => { draft[db.titleProp] = title.value; });
            if (!db.dateLabel || db.schema.showNameWithDate)
                body.appendChild(title);
            const dateP = db.dateLabel ? db.prop(db.dateLabel) : db.schema.properties.find((p) => p.type === 'date');
            if (dateP && draft[dateP.name] === undefined)
                draft[dateP.name] = { start: todayISO() };
            for (const [k, v] of Object.entries(values))
                if (draft[k] === undefined)
                    draft[k] = v;
            const fake = { id: 'draft', values: draft, body: '', created: '', edited: '' };
            const grid = h('div', { class: 'props' });
            const editable = db.schema.properties.filter((p) => !['title', 'formula', 'created_time', 'last_edited_time'].includes(p.type) && (p.pageHidden !== 'always' || p.name === db.dateLabel)).sort((a, b) => Number(b.name === db.dateLabel) - Number(a.name === db.dateLabel)).slice(0, 8);
            const fakeWs = { boundary: () => { }, saveRow: async () => { }, saveSchema: (d) => ws.saveSchema(d) };
            const drawFields = () => {
                grid.textContent = '';
                for (const p of editable) {
                    const v = draft[p.name] ?? null;
                    const val = h('div', { class: 'prop-val' + (v == null || v === '' ? ' empty' : ''), tabindex: 0, role: 'button' });
                    const r = renderValue(db, p, v);
                    if (r === '')
                        val.textContent = 'Empty';
                    else
                        val.append(r);
                    const edit = () => editValue(fakeWs, db, fake, p.name, val, drawFields);
                    val.addEventListener('click', edit);
                    val.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        edit();
                    } });
                    grid.append(h('div', { class: 'prop-name' }, typeIcon(p.type, p.icon), p.name), val);
                }
            };
            drawFields();
            body.appendChild(grid);
            requestAnimationFrame(() => { if (db.dateLabel)
                grid.querySelector('.prop-val')?.focus();
            else
                title.focus(); });
        };
        const save = async (again) => {
            const db = ws.dbs.get(key);
            const vals = Object.fromEntries(Object.entries(draft).filter(([, v]) => v !== null && v !== ''));
            ws.boundary();
            await ws.addRow(db, vals);
            try {
                localStorage.setItem(`nook:quickadd:${ws.meta.name}`, key);
            }
            catch { /* ignore */ }
            toast(`Saved to ${db.schema.name}`);
            ws.emit();
            if (again) {
                draft = {};
                draw();
            }
            else
                close();
        };
        const box = h('div', { onkeydown: (e) => {
                const mod = e.metaKey || e.ctrlKey;
                if (mod && e.key === 'Enter') {
                    e.preventDefault();
                    save(true);
                }
                else if (e.key === 'Enter' && e.target.classList.contains('qa-title')) {
                    e.preventDefault();
                    save(false);
                }
            } }, head, body, h('div', { class: 'dialog-foot' }, h('span', null, h('kbd', null, 'Tab'), ' next field · ', h('kbd', null, '↵'), ' save · ', h('kbd', null, prettyKey('Mod+Enter')), ' save & add another · ', h('kbd', null, 'Esc'), ' cancel'), h('button', { class: 'btn-new', onclick: () => save(false) }, 'Save')));
        draw();
        close = dialog(box);
    }
    // ---------- palette ----------
    palette() {
        const ws = this.ws;
        const input = h('input', { class: 'palette-input', placeholder: 'Search pages, entries, text and commands…', 'aria-label': 'Search' });
        const list = h('div', { class: 'palette-list' });
        let hi = 0;
        let items = [];
        const build = () => {
            const q = input.value.trim().toLowerCase();
            items = [];
            for (const c of this.keymap.all())
                if (!c.hidden && (!q || c.label.toLowerCase().includes(q)))
                    items.push({ label: c.label, hint: prettyKey(this.keymap.binding(c.id)), run: c.run });
            for (const p of ws.pages.values())
                if (!q || p.title.toLowerCase().includes(q))
                    items.push({ label: p.title, icon: renderIcon(p.icon, 16), hint: 'Page', run: () => this.openPage(p.id) });
            for (const db of ws.dbs.values()) {
                if (!q || db.schema.name.toLowerCase().includes(q))
                    items.push({ label: db.schema.name, icon: renderIcon(db.schema.icon, 16, 'database'), hint: 'Database', run: () => this.openDb(db.key) });
                if (q.length >= 2) {
                    let n = 0;
                    for (const r of db.rows) {
                        const t = db.rowLabel(r);
                        if (t.toLowerCase().includes(q)) {
                            items.push({ label: plainText(t), hint: db.schema.name, run: () => this.openRow(db, r) });
                            if (++n >= 8)
                                break;
                        }
                    }
                }
            }
            // inside pages and entries: text of blocks, entry contents and text properties
            if (q.length >= 3) {
                let n = 0;
                for (const p of ws.pages.values()) {
                    if (n >= 25)
                        break;
                    const hit = findInBlocks(p.blocks, q);
                    if (hit) {
                        items.push({ label: p.title, icon: renderIcon(p.icon, 16), hint: 'in page', snippet: snippetEl(hit.text, q), run: () => { this.openPage(p.id); this.flashBlock(hit.id); } });
                        n++;
                    }
                }
                for (const db of ws.dbs.values()) {
                    for (const r of db.rows) {
                        if (n >= 40)
                            break;
                        const title = db.rowLabel(r);
                        if (title.toLowerCase().includes(q))
                            continue; // already listed above
                        let text = r.body && r.body.toLowerCase().includes(q) ? r.body : '';
                        if (!text)
                            for (const pd of db.schema.properties) {
                                const v = r.values[pd.name];
                                if (pd.type === 'text' && typeof v === 'string' && v.toLowerCase().includes(q)) {
                                    text = `${pd.name}: ${v}`;
                                    break;
                                }
                            }
                        if (text) {
                            items.push({ label: plainText(title) || 'Untitled', icon: renderIcon(r.icon ?? db.schema.icon, 16, 'file-text'), hint: `in ${db.schema.name}`, snippet: snippetEl(plainText(text.replace(/<[^>]+>/g, ' ')), q), run: () => this.openRow(db, r) });
                            n++;
                        }
                    }
                }
            }
            items = q ? items.slice(0, 80) : items.slice(0, 40);
            hi = 0;
            draw();
        };
        const draw = () => {
            list.textContent = '';
            items.forEach((it, i) => list.appendChild(h('button', { class: 'pop-item' + (i === hi ? ' hi' : '') + (it.snippet ? ' has-snippet' : ''), onclick: () => { close(); it.run(); } }, it.icon ?? null, it.snippet ? h('span', { class: 'pal-text' }, h('span', null, it.label), it.snippet) : h('span', null, it.label), it.hint && !keysOnly(it.hint) ? h('span', { class: 'hint' }, it.hint) : null)));
            list.children[hi]?.scrollIntoView({ block: 'nearest' });
        };
        input.addEventListener('input', debounce(build, 60));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') {
                hi = Math.min(items.length - 1, hi + 1);
                draw();
                e.preventDefault();
            }
            else if (e.key === 'ArrowUp') {
                hi = Math.max(0, hi - 1);
                draw();
                e.preventDefault();
            }
            else if (e.key === 'Enter') {
                const it = items[hi];
                if (it) {
                    close();
                    it.run();
                }
                e.preventDefault();
            }
        });
        build();
        const close = dialog(h('div', null, input, list));
        input.focus();
    }
    /** after jumping to a search hit: scroll to the block and let it light up briefly */
    flashBlock(id) {
        setTimeout(() => {
            const el = this.root.querySelector(`.block[data-id="${CSS.escape(id)}"]`);
            if (!el)
                return;
            el.scrollIntoView({ block: 'center' });
            el.classList.add('flash');
            setTimeout(() => el.classList.remove('flash'), 1600);
        }, 60);
    }
    // ---------- settings ----------
    settingsWin = null;
    settingsDialog(start) { openSettings(this, start); }
    // ---------- commands ----------
    registerCommands() {
        const k = this.keymap;
        const nativeUndo = (e) => isTyping(e.target) && document.queryCommandEnabled?.('undo');
        k.register({ id: 'edit.undo', label: 'Undo', key: 'Mod+Z', run: () => this.undo(), when: (e) => !nativeUndo(e) });
        k.register({ id: 'edit.redo', label: 'Redo', key: 'Mod+Shift+Z', run: () => this.redo(), when: (e) => !(isTyping(e.target) && document.queryCommandEnabled?.('redo')) });
        k.register({ id: 'palette', label: 'Command palette', key: 'Mod+K', run: () => this.palette() });
        k.register({ id: 'quickadd', label: 'Quick add entry (choose database)', key: 'Mod+Shift+A', run: () => this.quickAdd() });
        k.register({ id: 'view.sidebar', label: 'Show / hide sidebar', key: 'Mod+0', run: () => this.toggleSidebar() });
        k.register({ id: 'sidebar.rename', label: 'Rename the selected sidebar item', key: 'F2', when: () => !!document.activeElement?.closest?.('.side-item[data-side-id]'), run: () => this.renameSideItem(document.activeElement.closest('.side-item')) });
        k.register({ id: 'nav.home', label: 'Go to start page', key: 'Mod+1 | G H', run: () => { const h0 = this.ws.homePage(); if (h0)
                this.openPage(h0.id); } });
        k.register({ id: 'nav.back', label: 'Back', key: 'Mod+[', run: () => this.back() });
        k.register({ id: 'nav.forward', label: 'Forward', key: 'Mod+]', run: () => this.forward() });
        k.register({ id: 'page.new', label: 'New page', key: 'Mod+Shift+N', run: () => this.newPage() });
        k.register({ id: 'database.new', label: 'New database', key: '', run: () => this.newDatabase() });
        k.register({ id: 'settings', label: 'Workspace settings', key: 'Mod+,', run: () => this.settingsDialog() });
        k.register({ id: 'trash', label: 'Open trash', key: '', run: () => this.openTrash() });
        k.register({ id: 'notifications', label: 'Notifications', key: 'Mod+Shift+N', run: () => this.notes.open(this.root.querySelector('.top-bell') ?? undefined) });
        k.register({ id: 'comments', label: 'All comments', key: '', run: () => openAllComments(this.ws, (path, back) => this.openPath(path, back)) });
        k.register({ id: 'history', label: 'History of this page', key: '', when: () => this.route?.kind === 'page' || this.route?.kind === 'row', run: () => { const r = this.route; if (r?.kind === 'page') {
                const p = this.ws.pages.get(r.id);
                if (p)
                    this.openHistory(p.file);
            }
            else if (r?.kind === 'row')
                this.openHistory(this.rowFile(r.db, r.id)); } });
        k.register({ id: 'workspace.switch', label: 'Switch workspace', key: 'Mod+O', run: () => this.shell.workspaceMenu(this.root.querySelector('.ws-name') ?? this.root) });
        k.register({ id: 'workspace.reload', label: 'Reload workspace (changes from other computers)', key: 'Mod+Shift+R', run: () => this.reload() });
        k.register({ id: 'period.prev', label: 'Previous month / period', key: 'Mod+ArrowLeft | Ctrl+ArrowLeft | Alt+ArrowLeft', when: (e) => !isTyping(e.target), run: () => this.viewAction('[aria-label="Previous month"], [aria-label="Previous period"]:not([disabled])') });
        k.register({ id: 'period.next', label: 'Next month / period', key: 'Mod+ArrowRight | Ctrl+ArrowRight | Alt+ArrowRight', when: (e) => !isTyping(e.target), run: () => this.viewAction('[aria-label="Next month"], [aria-label="Next period"]:not([disabled])') });
        k.register({ id: 'view.today', label: 'Jump to today (calendar / current period)', key: 'T', run: () => this.viewAction('[data-action="today"]:not([disabled])') });
        k.register({ id: 'entries.duplicate', label: 'Duplicate selected entries', key: 'Mod+D', when: (e) => !isTyping(e.target) && !!selectedRows(), run: () => { duplicateSelected(); } });
        k.register({ id: 'entries.open', label: 'Open selected entry', key: 'E', when: (e) => !isTyping(e.target) && !!selectedRows() && !document.querySelector('.overlay') && (!document.querySelector('.pop:not(.pop-closing)') || !!document.activeElement?.closest?.('.more-pop')), run: () => { closePop(); openSelected(); } });
        k.register({ id: 'calendar.newOnDay', label: 'New entry on the selected calendar day', key: 'N', run: () => calSelection?.create(), when: () => !!calSelection && calSelection.el.isConnected && calSelection.el.contains(document.activeElement) });
        this.registerActions();
        if (this.shell.showInFolder)
            k.register({ id: 'workspace.reveal', label: 'Show workspace in folder', run: () => this.shell.showInFolder() });
    }
    // ---------- custom shortcuts (Settings → Custom shortcuts) ----------
    describeAction(a) {
        const db = this.ws.dbs.get(a.db);
        const v = a.value === 'toggle' ? 'toggle' : a.value === null ? 'clear' : a.value === true ? 'checked' : a.value === false ? 'unchecked' : typeof a.value === 'object' && a.value && 'start' in a.value ? 'today' : String(a.value);
        return `${db?.schema.name ?? a.db} · ${a.prop} → ${v}`;
    }
    /** (re)register the user's custom shortcuts as commands */
    registerActions() {
        for (const c of this.keymap.all())
            if (c.id.startsWith('action.') || c.id.startsWith('jump.'))
                this.keymap.unregister(c.id);
        for (const j of this.ws.settings.jumps ?? []) {
            if (!j.key)
                continue;
            this.keymap.register({ id: `jump.${j.id}`, label: this.describeJump(j), key: j.key, when: (e) => !isTyping(e.target) && !document.querySelector('.overlay'), run: () => this.runJump(j) });
        }
        for (const a of this.ws.settings.actions ?? []) {
            this.keymap.register({
                id: `action.${a.id}`, label: this.describeAction(a), key: a.key,
                when: () => this.actionTargets(a).length > 0,
                run: () => this.runAction(a),
            });
        }
    }
    /** a button block somewhere in a page */
    findButton(pageId, blockId, label) {
        const page = this.ws.pages.get(pageId);
        if (!page)
            return null;
        const walk = (arr, ok) => {
            for (const b of arr) {
                if (ok(b))
                    return { page, block: b, arr };
                const r = b.children ? walk(b.children, ok) : null;
                if (r)
                    return r;
            }
            return null;
        };
        // by id; older shortcuts (made before buttons kept their id) by the button's text
        return walk(page.blocks, (b) => b.id === blockId) ?? (label ? walk(page.blocks, (b) => b.type === 'button' && (b.text ?? '') === label) : null);
    }
    describeJump(j) {
        if (j.button) {
            const f = this.findButton(j.button.page, j.button.block, j.button.label);
            return f ? `Run “${f.block.text || 'Button'}” (${f.page.title})` : 'Run a button (deleted)';
        }
        if (j.open?.startsWith('db:'))
            return `Open ${this.ws.dbs.get(j.open.slice(3))?.schema.name ?? 'a database (deleted)'}`;
        return `Open ${j.open ? this.ws.pages.get(j.open)?.title ?? 'a page (deleted)' : '?'}`;
    }
    /** run a button (the one on screen when its page is open, else on its own) or open a page / database */
    runJump(j) {
        if (j.open) {
            if (j.open.startsWith('db:'))
                this.openDb(j.open.slice(3));
            else
                this.openPage(j.open);
            return;
        }
        if (!j.button)
            return;
        const f = this.findButton(j.button.page, j.button.block, j.button.label);
        if (f && f.block.id !== j.button.block) {
            j.button.block = f.block.id;
            void this.ws.saveSettings();
        } // heal an old reference
        const onScreen = f && document.querySelector(`.block[data-id="${CSS.escape(f.block.id)}"] > .nbutton`);
        if (onScreen) {
            onScreen.click();
            return;
        }
        if (!f) {
            toast('That button is gone');
            return;
        }
        void runButton(f.block, { ctx: this, pageId: f.page.id, insert: (blocks, where) => { const i = f.arr.indexOf(f.block); f.arr.splice(where === 'above' ? i : i + 1, 0, ...blocks); void this.ws.savePage(f.page); } });
    }
    /** entries a custom shortcut applies to: the selected ones, else the entry page that is open */
    actionTargets(a) {
        const db = this.ws.dbs.get(a.db);
        if (!db || !db.prop(a.prop))
            return [];
        const s = selectedRows();
        if (s && s.env.db === db)
            return s.rows;
        if (this.route?.kind === 'row' && this.route.db === db.key) {
            const r = db.rows.find((x) => x.id === this.route.id);
            return r ? [r] : [];
        }
        return [];
    }
    async runAction(a) {
        const db = this.ws.dbs.get(a.db);
        const p = db.prop(a.prop);
        const rows = this.actionTargets(a);
        this.ws.boundary();
        for (const r of rows) {
            if (a.value === 'toggle')
                r.values[p.name] = !(r.values[p.name] === true);
            else if (a.value === null)
                delete r.values[p.name];
            else if (p.type === 'multi_select') {
                const cur = Array.isArray(r.values[p.name]) ? r.values[p.name] : [];
                if (!cur.includes(String(a.value)))
                    r.values[p.name] = [...cur, String(a.value)];
            }
            else if (p.type === 'date' && typeof a.value === 'object')
                r.values[p.name] = { start: todayISO() };
            else
                r.values[p.name] = a.value;
            await this.ws.saveRow(db, r);
        }
        this.ws.emit();
        if (this.route?.kind === 'row')
            this.render();
        toast(`${a.prop} → ${this.describeAction(a).split('→ ')[1]} · ${rows.length === 1 ? '1 entry' : rows.length + ' entries'}`);
    }
    /** Re-read the workspace folder, e.g. after Dropbox synced changes from another computer. */
    async reload(quiet = false) {
        // finish our own pending saves first, so they are never mistaken for outside changes
        flushPending();
        await this.ws.idle();
        const fresh = await Workspace.open(this.ws.storage, { repair: false });
        // nothing changed on disk (the usual case when the window gets focus): keep everything,
        // including undo history
        if (quiet && !this.ws.differsFrom(fresh)) {
            // a new Dropbox conflict copy changes no loaded file, but should show up
            if (fresh.conflicts.map((c) => c.path).join() !== this.ws.conflicts.map((c) => c.path).join()) {
                this.ws.conflicts = fresh.conflicts;
                void this.ws.tidyConflicts().then(() => this.render());
                this.render();
            }
            return;
        }
        this.ws = fresh.activate();
        void fresh.repairs();
        calendars.attach(fresh);
        attachSources(fresh);
        this.keymap.overrides = fresh.keymap;
        this.applySettings();
        if (this.route?.kind === 'page' && !fresh.pages.has(this.route.id)) {
            const h0 = fresh.homePage();
            this.route = h0 ? { kind: 'page', id: h0.id } : null;
        }
        this.render();
        if (!quiet)
            toast('Workspace reloaded');
    }
    /**
     * Click a control of the database view you are working in (else the first calendar, else the
     * first view that has it) and keep keyboard focus where it was.
     */
    viewAction(sel) {
        const active = document.activeElement;
        const scope = active?.closest('.dbview') ?? document.querySelector(`.dbview:has(.cal)`) ?? [...document.querySelectorAll('.dbview')].find((v) => v.querySelector(sel));
        const btn = scope?.querySelector(sel);
        const key = active?.closest('[data-focus-key]')?.dataset.focusKey;
        btn?.click();
        if (key)
            requestAnimationFrame(() => document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true }));
    }
}
function sessionStorageGet(k) {
    try {
        const v = sessionStorage.getItem(k);
        return v ? JSON.parse(v) : null;
    }
    catch {
        return null;
    }
}
function sessionStorageSet(k, v) { try {
    sessionStorage.setItem(k, JSON.stringify(v));
}
catch { /* ignore */ } }
function placeCaretEnd(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = getSelection();
    s?.removeAllRanges();
    s?.addRange(r);
}
/** the first block (also inside toggles, columns, callouts) whose text contains q */
function findInBlocks(blocks, q) {
    for (const b of blocks) {
        const t = b.text ? plainText(b.text) : '';
        if (t && t.toLowerCase().includes(q))
            return { id: b.id, text: t };
        if (b.children) {
            const r = findInBlocks(b.children, q);
            if (r)
                return r;
        }
    }
    return null;
}
/** "…words around the match…" with the match marked */
function snippetEl(text, q) {
    const flat = text.replace(/\s+/g, ' ');
    const i = flat.toLowerCase().indexOf(q);
    if (i < 0)
        return h('span', { class: 'pal-snippet' }, flat.slice(0, 90));
    const from = Math.max(0, i - 36), to = Math.min(flat.length, i + q.length + 50);
    return h('span', { class: 'pal-snippet' }, from > 0 ? '…' : '', flat.slice(from, i), h('mark', null, flat.slice(i, i + q.length)), flat.slice(i + q.length, to), to < flat.length ? '…' : '');
}
/** phone-only choices, kept on this device: where Nook opens, and the Recent list on Pages */
export function phonePref() {
    try {
        const v = JSON.parse(localStorage.getItem('nook:phone') ?? '{}');
        return { start: v.start ?? 'home', recent: v.recent !== false, tabLabels: v.tabLabels !== false };
    }
    catch {
        return { start: 'home', recent: true, tabLabels: true };
    }
}
export function setPhonePref(v) { try {
    localStorage.setItem('nook:phone', JSON.stringify({ ...phonePref(), ...v }));
}
catch { /* private window */ } applyPhonePref(); }
/** the bottom bar: icons with labels (default) or icons only */
export function applyPhonePref() { document.documentElement.classList.toggle('tabs-icons-only', !phonePref().tabLabels); }
applyPhonePref();
/** phone: the next screen slides in from that side (iOS push / pop) */
function slideIn(from) {
    const r = document.documentElement;
    if (!r.classList.contains('phone'))
        return;
    r.classList.remove('nav-from-left', 'nav-from-right');
    void r.offsetWidth;
    r.classList.add(from === 'left' ? 'nav-from-left' : 'nav-from-right');
    setTimeout(() => r.classList.remove('nav-from-left', 'nav-from-right'), 400);
}
//# sourceMappingURL=app.js.map