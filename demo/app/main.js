// Boot: pick where the workspace lives (desktop app folder, browser folder access, or the
// in memory for tests), open it, and handle switching / creating / importing workspaces.
import { kbLog, kbDebugOn, startKbDebug } from './ui/kbdebug.js';
import { sheetHead, bigTitle, tileIcon } from './ui/keep.js';
import { moreControl } from './ui/settings.js';
import { wcard, wrow } from './ui/win.js';
import { selectControl, switchControl } from './ui/settings.js';
import { setStorageFetch } from './sync/net.js';
import { calendars } from './sync/service.js';
import { installTouchDrag } from './ui/touchdrag.js';
import { APP } from './config.js';
import { Workspace } from './workspace.js';
import { FolderStorage, MemoryStorage, ServerStorage, TauriStorage } from './storage/storage.js';
import { App } from './ui/app.js';
import { flushPending, h, svgIcon, ICONS, openIdb, segmented } from './util.js';
import { iconSvg } from './ui/icons.js';
// save edits that are still waiting when the window is hidden or closed
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden')
    flushPending(); });
window.addEventListener('pagehide', flushPending);
// a save that fails must never go unnoticed (e.g. the local server was closed, the disk is full)
let lastError = 0;
window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e.reason?.message ?? e.reason ?? '');
    console.error(e.reason);
    if (Date.now() - lastError < 4000)
        return;
    lastError = Date.now();
    const offline = /Failed to fetch|NetworkError|Load failed/i.test(msg);
    toast(offline ? 'Changes could not be saved – is Nook still running? Start it again, then repeat the last change.' : `Something went wrong: ${msg.slice(0, 120)}`, 6000);
});
import { dialog, toast } from './ui/pop.js';
import { importNotion, readZip } from './importer/notion.js';
import { ZipStorage } from './importer/zipwrite.js';
import { DropboxStorage, dropboxConnected, finishDropboxLogin, dropboxSignOut } from './storage/dropbox.js';
import { chooseDropboxFolder, connectDropbox } from './ui/dropboxui.js';
const root = document.getElementById('root');
let app = null;
const idb = () => openIdb('nook', 1, ['recent']);
async function getRecents() {
    if (TauriStorage.available()) {
        try {
            return JSON.parse(localStorage.getItem('nook:recent') ?? '[]');
        }
        catch {
            return [];
        }
    }
    try {
        const db = await idb();
        return await new Promise((res) => {
            const req = db.transaction('recent').objectStore('recent').get('list');
            req.onsuccess = () => res(req.result ?? []);
            req.onerror = () => res([]);
        });
    }
    catch {
        return [];
    }
}
async function setRecents(list) {
    list = list.slice(0, 8);
    if (TauriStorage.available()) {
        try {
            localStorage.setItem('nook:recent', JSON.stringify(list));
        }
        catch { /* ignore */ }
        return;
    }
    try {
        const db = await idb();
        db.transaction('recent', 'readwrite').objectStore('recent').put(list, 'list');
    }
    catch { /* ignore */ }
}
async function remember(r) {
    const where = (x) => x.path ?? x.server ?? (x.dropbox ? 'dropbox:' + x.dropbox.toLowerCase() : x.label);
    const list = (await getRecents()).filter((x) => where(x) !== where(r));
    await setRecents([r, ...list]);
}
// ---------- open ----------
async function openStorage(st, recent) {
    // a big workspace in Dropbox can take a while the first time on a computer (files that are
    // "online only" are downloaded first): say so instead of looking stuck
    const slow = setTimeout(() => {
        const el = h('div', { class: 'toast open-note', role: 'status' }, st instanceof DropboxStorage
            ? 'Loading the workspace from Dropbox… The first time on a device takes a moment; after that it opens right away.'
            : 'Opening the workspace… Files that Dropbox keeps online only are being downloaded first – this can take a minute the first time.');
        document.body.appendChild(el);
        slowEl = el;
    }, 2500);
    let slowEl = null;
    // Dropbox, first time on this device: what it is doing, with a bar
    if (st instanceof DropboxStorage) {
        const text = h('div', { class: 'ld-text' }, 'Connecting to Dropbox…');
        const fill = h('div', { class: 'ld-fill' });
        const meta = h('div', { class: 'ld-meta' });
        let shown = null;
        st.onProgress = (pr) => {
            if (!shown) {
                clearTimeout(slow);
                slowEl?.remove();
                shown = document.body.appendChild(h('div', { class: 'load-card', role: 'status' }, h('div', { class: 'ld-title' }, `Loading “${st.label}” from Dropbox`), text, h('div', { class: 'ld-bar' }, fill), meta, h('div', { class: 'ld-note' }, 'Only the first time on this device. If it stops (screen locked, tab closed), the next start continues where it was.')));
                slowEl = shown;
            }
            text.textContent = pr.step;
            fill.style.width = pr.total ? `${Math.round((pr.done / pr.total) * 100)}%` : '4%';
            fill.classList.toggle('busy', !pr.total);
            meta.textContent = [pr.total ? `${pr.done} of ${pr.total} parts` : '', pr.mb ? `${pr.mb.toLocaleString()} MB` : ''].filter(Boolean).join(' · ');
        };
    }
    try {
        const isWs = await st.exists(`${APP.workspaceDir}/workspace.json`);
        if (!isWs) {
            const files = await st.list('');
            if (files.length) {
                toast('This folder is not a workspace yet. Create a new one or choose an empty folder.');
                return;
            }
            await Workspace.create(st, st.label);
        }
        const ws = await Workspace.open(st);
        app?.destroy();
        stopWatch?.();
        stopWatch = null;
        const hash = location.hash;
        // calendar links on the hosted site: Dropbox fetches them (a website itself may not) – set before the app asks for them
        setStorageFetch(st instanceof DropboxStorage ? (u) => st.fetchUrl(u) : null);
        app = new App(ws, shell, root);
        window.nook = app; // handy for debugging in the dev tools
        app.linkBase = st instanceof MemoryStorage ? '#' : `#ws=${encodeURIComponent(recent?.label ?? st.label)}`;
        if (/[#&](p|row|db)=/.test(hash))
            app.openFromHash(hash);
        else
            app.refresh();
        if (recent)
            await remember(recent);
        // changes made on another device show up by themselves (Dropbox)
        if (st.watch)
            stopWatch = st.watch(() => reloadWhenIdle());
        if (st instanceof DropboxStorage)
            stopWatch = chain(stopWatch, catchUpOnWake(st));
        if (st instanceof DropboxStorage) {
            const off = st.onStatus(showSaveState);
            const prev = stopWatch;
            stopWatch = () => { prev?.(); off(); saveState?.remove(); saveState = null; };
        }
    }
    catch (e) {
        console.error(e);
        toast(`Could not open the workspace: ${e.message}`, 5000);
    }
    finally {
        clearTimeout(slow);
        slowEl?.remove();
    }
}
let stopWatch = null;
/** saving to Dropbox happens in the background: a small note only when it takes long or the connection is gone */
let saveState = null;
let saveTimer;
let lastSaveError = '';
function showSaveState(s) {
    clearTimeout(saveTimer);
    if (s.error && !s.offline && s.error !== lastSaveError) {
        lastSaveError = s.error;
        toast(`Not saved to Dropbox: ${s.error}`, 6000);
    }
    const text = s.offline && s.pending ? `Offline – ${s.pending === 1 ? '1 change waits' : `${s.pending} changes wait`} and will be saved to Dropbox` : s.pending ? (s.pending > 3 ? `Saving to Dropbox… ${s.pending} left` : 'Saving to Dropbox…') : '';
    if (!text) {
        saveState?.remove();
        saveState = null;
        return;
    }
    const draw = () => {
        saveState ??= document.body.appendChild(h('div', { class: 'save-state', role: 'status' }));
        saveState.textContent = text;
        saveState.classList.toggle('offline', s.offline);
    };
    // quick saves stay silent
    if (saveState || s.offline)
        draw();
    else
        saveTimer = setTimeout(draw, 2500);
}
/** re-reads the workspace once nobody is typing or has a menu open */
const chain = (a, b) => () => { a?.(); b(); };
/** when you last typed: a change from another device waits until you pause, then comes in where you are */
let lastTyped = 0;
document.addEventListener('keydown', () => { lastTyped = Date.now(); }, true);
document.addEventListener('input', () => { lastTyped = Date.now(); }, true);
/** the place you are at – scroll position, the text you were in and the caret – to come back to after a reload */
function rememberPlace() {
    const scroll = document.querySelector('.main > .scroll');
    const top = scroll?.scrollTop ?? 0;
    const act = document.activeElement;
    const fields = () => [...document.querySelectorAll('.main [contenteditable="true"], .main input, .main textarea')];
    const at = act && act !== document.body ? fields().indexOf(act) : -1;
    let caret = -1;
    if (at >= 0) {
        if (act instanceof HTMLInputElement || act instanceof HTMLTextAreaElement)
            caret = act.selectionStart ?? -1;
        else {
            const sel = getSelection();
            if (sel?.rangeCount && act.contains(sel.anchorNode)) {
                const r = document.createRange();
                r.selectNodeContents(act);
                r.setEnd(sel.anchorNode, sel.anchorOffset);
                caret = r.toString().length;
            }
        }
    }
    return () => {
        const sc = document.querySelector('.main > .scroll');
        if (sc)
            sc.scrollTop = top;
        if (at < 0)
            return;
        const el = fields()[at];
        if (!el)
            return;
        el.focus({ preventScroll: true });
        if (caret < 0)
            return;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            try {
                el.setSelectionRange(caret, caret);
            }
            catch { /* not a text field */ }
            return;
        }
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let left = caret, n;
        while ((n = walk.nextNode())) {
            const len = n.textContent?.length ?? 0;
            if (left <= len) {
                const r = document.createRange();
                r.setStart(n, left);
                r.collapse(true);
                const sel = getSelection();
                sel?.removeAllRanges();
                sel?.addRange(r);
                return;
            }
            left -= len;
        }
    };
}
/** re-reads the workspace with what changed elsewhere – not while a menu is open, and while you type only once you pause */
function reloadWhenIdle() {
    const a = app;
    if (!a)
        return;
    const busy = document.querySelector('.overlay, .pop') || Date.now() - lastTyped < 2500 || document.documentElement.classList.contains('touch-dragging');
    if (busy) {
        setTimeout(() => { if (app === a)
            reloadWhenIdle(); }, 1500);
        return;
    }
    const back = rememberPlace();
    a.reload(true).then(() => requestAnimationFrame(back)).catch((e) => console.error(e));
}
/** back to Nook after a while away (phone, another window): first what changed elsewhere, then typing – so nothing
 *  is written on an old version. A thin line shows while it catches up (a few seconds at most). */
function catchUpOnWake(st) {
    let hiddenAt = 0;
    const onVis = async () => {
        if (document.visibilityState === 'hidden') {
            hiddenAt = Date.now();
            return;
        }
        if (!hiddenAt || Date.now() - hiddenAt < 5000 || !app)
            return;
        hiddenAt = 0;
        const a = app;
        const shield = document.body.appendChild(h('div', { class: 'catchup', role: 'status' }, h('div', { class: 'catchup-bar' }, h('span', { class: 'catchup-spin' }), h('b', null, 'Getting the latest changes'), h('span', null, 'One moment – so nothing gets overwritten'))));
        const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
        for (const t of ['keydown', 'beforeinput', 'pointerdown', 'touchstart'])
            document.addEventListener(t, stop, { capture: true, passive: false });
        try {
            const n = await Promise.race([st.sync().catch(() => 0), new Promise((r) => setTimeout(() => r(-1), 5000))]);
            if (n !== 0 && app === a) {
                const back = rememberPlace();
                await a.reload(true);
                requestAnimationFrame(back);
            }
        }
        catch (e) {
            console.error(e);
        }
        finally {
            for (const t of ['keydown', 'beforeinput', 'pointerdown', 'touchstart'])
                document.removeEventListener(t, stop, { capture: true });
            shield.remove();
        }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
}
/** a folder in Dropbox: connects first if needed (the login leaves the page and comes back) */
async function openDropbox() {
    if (!dropboxConnected()) {
        sessionStorage.setItem('nook:after-dropbox-login', 'choose');
        connectDropbox();
        return;
    }
    const path = await chooseDropboxFolder();
    if (!path)
        return;
    const st = new DropboxStorage(path);
    await openStorage(st, { label: st.label, dropbox: path });
}
/** for automated tests: open a workspace held in memory (nothing is written anywhere) */
window.nookOpenMemory = (files) => openStorage(new MemoryStorage('In memory', files));
async function pickFolder() {
    if (TauriStorage.available()) {
        const dlg = window.__TAURI__.dialog;
        const path = await dlg.open({ directory: true, multiple: false, title: 'Open folder as workspace' });
        if (!path)
            return null;
        const st = new TauriStorage(String(path));
        return { st, recent: { label: st.label, path: String(path) } };
    }
    // started with scripts/serve.mjs: the server opens folders, so every browser works (Firefox too)
    if (ServerStorage.available()) {
        const path = await chooseServerFolder();
        if (!path)
            return null;
        const st = new ServerStorage(path);
        return { st, recent: { label: st.label, server: path } };
    }
    if (!FolderStorage.supported()) {
        toast('Start Nook with "node scripts/serve.mjs" (or the Start Nook file) to open folders in this browser.', 6000);
        return null;
    }
    const st = await FolderStorage.pick();
    if (!st)
        return null;
    return { st, recent: { label: st.label, handle: st.root } };
}
/**
 * Choose a folder through the local server: the computer's own folder dialog, or (if that is not
 * available, e.g. Linux without zenity) Nook's folder browser.
 */
async function chooseServerFolder() {
    // the system's folder window can open behind the browser (macOS): after a moment, a note
    // says so and offers Nook's own folder browser instead
    let note = null;
    let switchTo;
    const instead = new Promise((ok) => { switchTo = () => ok('browser'); });
    const timer = setTimeout(() => {
        note = h('div', { class: 'toast pick-note', role: 'status' }, h('span', null, 'A folder window is open – it may be behind this window.'), h('button', { class: 'set-btn', onclick: () => switchTo() }, 'Choose here instead'));
        document.body.appendChild(note);
    }, 1500);
    const native = (async () => {
        try {
            const r = await (await ServerStorage.call('pick', {})).json();
            if (r.path)
                return r.path;
            if (!r.unavailable)
                return null; // cancelled
        }
        catch { /* fall back to the browser below */ }
        return 'browser';
    })();
    const got = await Promise.race([native, instead]);
    clearTimeout(timer);
    note?.remove();
    return got === 'browser' ? folderBrowser() : got;
}
/** Nook's own folder browser (fallback when the system dialog cannot be shown). */
function folderBrowser() {
    return new Promise((done) => {
        let cur = '';
        let finished = false;
        const pathEl = h('input', { class: 'set-input fb-path', 'aria-label': 'Folder path', placeholder: 'Folder path' });
        const list = h('div', { class: 'fb-list set-card' });
        const chooseBtn = h('button', { class: 'btn-new', onclick: () => finish(cur || null) }, 'Open');
        const newBtn = h('button', { class: 'set-row set-add fb-new', onclick: () => import('./ui/pop.js').then(({ prompt }) => prompt(newBtn, 'New folder name', '', async (n) => { n = n.trim(); if (!n)
                return; await ServerStorage.call('mkdir', { path: join(cur, n) }); go(join(cur, n)); })) }, '+  New folder');
        const note = h('div', { class: 'fb-note' });
        const go = async (p) => {
            try {
                const r = await (await ServerStorage.call('dirs', p ? { path: p } : {})).json();
                cur = r.path;
                pathEl.value = r.path;
                list.textContent = '';
                if (r.parent)
                    list.appendChild(h('button', { class: 'set-row fb-row fb-up', onclick: () => go(r.parent) }, '↑  Up'));
                for (const d of r.dirs)
                    list.appendChild(h('button', { class: 'set-row fb-row', onclick: () => go(join(r.path, d)) }, h('span', { class: 'set-title' }, d), h('span', { class: 'fb-chev' }, '›')));
                if (!r.dirs.length)
                    list.appendChild(h('div', { class: 'set-row fb-empty' }, 'No sub-folders'));
                list.appendChild(newBtn);
                note.replaceChildren(r.isWorkspace ? h('span', { class: 'fb-tag' }, 'Nook workspace') : '');
                const nm = r.path.split(/[\\/]/).filter(Boolean).pop() ?? r.path;
                chooseBtn.textContent = `Open “${nm}”`;
            }
            catch (e) {
                note.textContent = e.message;
            }
        };
        const join = (a, b) => (a.endsWith('/') || a.endsWith('\\') ? a + b : a + (a.includes('\\') && !a.includes('/') ? '\\' : '/') + b);
        pathEl.addEventListener('keydown', (e) => { if (e.key === 'Enter')
            go(pathEl.value.trim()); });
        const finish = (v) => { if (finished)
            return; finished = true; close(); done(v); };
        const close = dialog(h('div', { class: 'bwindow fb-box' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px' } }, 'Choose a folder')), h('div', { class: 'dialog-body bwin fb-body' }, pathEl, note, list), h('div', { class: 'bfooter' }, h('button', { class: 'set-btn', onclick: () => finish(null) }, 'Cancel'), chooseBtn)), { onClose: () => { if (!finished) {
                finished = true;
                done(null);
            } } });
        go();
    });
}
async function openRecent(r) {
    if (r.dropbox) {
        if (!dropboxConnected()) {
            sessionStorage.setItem('nook:after-dropbox-login', 'recent:' + r.dropbox);
            connectDropbox();
            return;
        }
        return openStorage(new DropboxStorage(r.dropbox), r);
    }
    if (r.path && TauriStorage.available())
        return openStorage(new TauriStorage(r.path), r);
    if (r.server) {
        if (!ServerStorage.available()) {
            toast('This workspace was opened through Nook\'s local server. Start it with "node scripts/serve.mjs".', 6000);
            return;
        }
        return openStorage(new ServerStorage(r.server), r);
    }
    const handle = r.handle;
    if (!handle)
        return;
    // browsers ask again for permission once per session
    const perm = await handle.queryPermission?.({ mode: 'readwrite' });
    if (perm !== 'granted' && (await handle.requestPermission?.({ mode: 'readwrite' })) !== 'granted') {
        toast('No access to the folder');
        return;
    }
    return openStorage(new FolderStorage(handle), r);
}
async function createWorkspace() {
    const picked = await pickFolder();
    if (!picked)
        return;
    if ((await picked.st.list('')).some((e) => !e.name.startsWith('.'))) {
        if (await picked.st.exists(`${APP.workspaceDir}/workspace.json`))
            return openStorage(picked.st, picked.recent);
        toast('Please choose an empty folder (or create a new one).', 4000);
        return;
    }
    await Workspace.create(picked.st, picked.st.label);
    await openStorage(picked.st, picked.recent);
}
/**
 * Import from Notion in two steps: 1) read the export (zip files or the unzipped folder),
 * 2) choose where the workspace goes — an empty folder (Chrome, Edge, desktop app) or a
 * downloaded .zip to unzip into Dropbox (works in every browser, e.g. Firefox).
 * The folder picker needs a fresh click, which is why it is its own step.
 */
async function importFromNotion() {
    const status = h('div', { class: 'imp-status' });
    const bar = h('div', { class: 'import-bar' }, h('div'));
    const progressBox = h('div', { class: 'imp-progress', hidden: true }, bar, status);
    let files = null;
    const say = (m, frac) => { progressBox.hidden = false; status.textContent = m; if (frac !== undefined)
        bar.firstChild.style.width = `${Math.round(frac * 100)}%`; };
    const progress = (m) => { const n = m.match(/(\d+) \/ (\d+)/); say(m, n ? +n[1] / +n[2] : undefined); };
    const fail = (m) => { say(m); status.classList.add('err'); };
    const zipInput = h('input', { type: 'file', accept: '.zip,application/zip', multiple: true, style: { display: 'none' } });
    const dirInput = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    dirInput.setAttribute('webkitdirectory', '');
    dirInput.setAttribute('directory', '');
    // ----- step 1: the export -----
    const pickZip = h('button', { class: 'set-btn', onclick: () => zipInput.click() }, 'Choose .zip…');
    const pickDir = h('button', { class: 'set-btn', onclick: () => dirInput.click() }, 'Choose folder…');
    const picked = h('div', { class: 'set-row imp-picked', hidden: true });
    const step1 = wcard('1 · Notion’s export', wrow('Export file', pickZip, 'Notion: Settings → Export → “Markdown & CSV” with subpages. Several parts? Choose them all.'), wrow('…or a folder', pickDir, 'The unzipped export'), picked);
    // ----- step 2: where it goes -----
    const name = h('input', { type: 'text', class: 'field', value: 'My workspace', 'aria-label': 'Name of the new workspace', placeholder: 'Name' });
    const canFolder = ServerStorage.available() || FolderStorage.supported() || TauriStorage.available();
    const canCurrent = !!app && app.ws.storage.writable;
    const d = new Date();
    const intoTitle = `Notion import ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
    const busy = (on) => { step2.classList.toggle('busy', on); step1.classList.toggle('busy', on); };
    const toFolder = async () => {
        if (!files)
            return;
        const target = await pickFolder(); // still inside the click, so the browser allows the picker
        if (!target)
            return;
        if ((await target.st.list('')).some((e) => !e.name.startsWith('.'))) {
            fail('That folder is not empty. Create and choose an empty folder.');
            return;
        }
        try {
            busy(true);
            const rep = await importNotion(files, target.st, name.value.trim() || 'Workspace', progress, { keepIcons });
            close();
            await openStorage(target.st, target.recent);
            toast(`Imported ${rep.pages} pages, ${rep.databases} databases, ${rep.rows} entries and ${rep.assets} files.${rep.warnings.length ? ' ' + rep.warnings.join(' · ') : ''}`, 8000);
        }
        catch (e) {
            console.error(e);
            busy(false);
            fail(`Import failed: ${e.message}`);
        }
    };
    const toZip = async () => {
        if (!files)
            return;
        try {
            busy(true);
            const wsName = name.value.trim() || 'Workspace';
            const zs = new ZipStorage(wsName);
            const rep = await importNotion(files, zs, wsName, progress, { keepIcons });
            say('Packing the zip…', 1);
            await new Promise((r) => setTimeout(r, 30));
            const url = URL.createObjectURL(zs.toBlob(wsName));
            const a = h('a', { href: url, download: `${wsName} (Nook workspace).zip` });
            document.body.appendChild(a);
            a.click();
            a.remove();
            busy(false);
            say(`Done: ${rep.pages} pages, ${rep.databases} databases, ${rep.rows} entries, ${rep.assets} files. Unzip “${wsName} (Nook workspace).zip” where you keep your files, then open the folder “${wsName}” in Nook.${rep.warnings.length ? ' Notes: ' + rep.warnings.join(' · ') : ''}`, 1);
        }
        catch (e) {
            console.error(e);
            busy(false);
            fail(`Import failed: ${e.message}`);
        }
    };
    // into the open workspace: below a new page, databases get folder names of their own
    const toCurrent = async () => {
        if (!files || !app)
            return;
        const cur = app;
        try {
            busy(true);
            await cur.ws.idle();
            const rep = await importNotion(files, cur.ws.storage, cur.ws.meta.name, progress, { into: { takenKeys: [...cur.ws.dbs.keys()], title: intoTitle, parent: under || undefined }, keepIcons });
            close();
            await cur.reload();
            if (rep.root)
                cur.openPage(rep.root);
            toast(`Imported ${rep.pages} pages, ${rep.databases} databases, ${rep.rows} entries and ${rep.assets} files into “${intoTitle}”.${rep.warnings.length ? ' ' + rep.warnings.join(' · ') : ''}`, 8000);
        }
        catch (e) {
            console.error(e);
            busy(false);
            fail(`Import failed: ${e.message}`);
        }
    };
    // where it goes: this workspace (below a page, if wanted) or a new one
    let target = canCurrent ? 'here' : 'new';
    let under = '';
    let keepIcons = true;
    const pageOpts = [['', 'Top level'], ...(canCurrent ? [...app.ws.pages.values()].filter((p) => !p.parent).slice(0, 200).map((p) => [p.id, p.title || 'Untitled']) : [])];
    const dyn = h('div');
    const drawStep2 = () => dyn.replaceChildren(...(target === 'here'
        ? [wrow('Under a page', selectControl(pageOpts, under, (v) => { under = v; }, 'Under a page'), `A new page “${intoTitle}” holds everything`)]
        : [wrow('Name', name), ...(canFolder ? [] : [wrow('Saved as', null, 'A .zip to unzip where you keep your files')])]));
    const intoOpts = canCurrent ? [['here', 'This workspace'], ['new', 'A new workspace']] : [['new', 'A new workspace']];
    const step2 = wcard('2 · Where it goes', wrow('Into', segmented(intoOpts, target, (v) => { target = v; drawStep2(); }, 'Into')), dyn, wrow('Keep Notion’s page icons', switchControl(keepIcons, (v) => { keepIcons = v; }, 'Keep Notion’s page icons')));
    step2.hidden = true;
    drawStep2();
    const importBtn = h('button', { class: 'btn-new', disabled: true, onclick: () => (target === 'here' ? toCurrent() : canFolder ? toFolder() : toZip()) }, 'Import');
    const ready = (f) => {
        const n = [...f.keys()];
        const csv = n.filter((k) => k.endsWith('.csv')).length, md = n.filter((k) => k.endsWith('.md')).length;
        if (!csv && !md) {
            fail('This does not look like a Notion “Markdown & CSV” export (no .md or .csv files found).');
            return;
        }
        files = f;
        progressBox.hidden = true;
        picked.hidden = false;
        picked.replaceChildren(h('span', { class: 'imp-ok' }, iconSvg('check-circle', 16)), h('span', null, `${n.length.toLocaleString()} files · ${md.toLocaleString()} pages and entries · ${csv} databases`));
        step2.hidden = false;
        importBtn.disabled = false;
    };
    const readFiles = async (fn) => {
        status.classList.remove('err');
        try {
            ready(await fn());
        }
        catch (e) {
            console.error(e);
            fail(`Could not read the export: ${e.message}`);
        }
    };
    zipInput.addEventListener('change', () => readFiles(async () => {
        const list = [...(zipInput.files ?? [])];
        const all = new Map();
        for (const [i, f] of list.entries()) {
            say(`Unzipping ${list.length > 1 ? `${i + 1} of ${list.length}: ` : ''}${f.name} (${Math.round(f.size / 1e6)} MB)…`, i / list.length);
            (await readZip(await f.arrayBuffer(), (dn, t) => say(`Unzipping ${f.name}: ${dn} / ${t} files…`, (i + dn / t) / list.length))).forEach((b, k) => all.set(k, b));
        }
        return all;
    }));
    dirInput.addEventListener('change', () => readFiles(async () => {
        const list = [...(dirInput.files ?? [])];
        const all = new Map();
        for (const [i, f] of list.entries()) {
            // drop the chosen folder's own name, keep the paths inside it
            const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
            if (rel.toLowerCase().endsWith('.zip'))
                (await readZip(await f.arrayBuffer())).forEach((b, k) => all.set(k, b));
            else
                all.set(rel, new Uint8Array(await f.arrayBuffer()));
            if (i % 200 === 0)
                say(`Reading folder: ${i} / ${list.length} files…`, i / list.length);
        }
        return all;
    }));
    const body = h('div', { class: 'dialog-body bwin imp' }, step1, step2, progressBox, zipInput, dirInput);
    const close = dialog(h('div', { class: 'bwindow imp-window' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px' } }, 'Import from Notion')), body, h('div', { class: 'bfooter' }, h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), importBtn)));
}
/** a workspace off the list – and, if wanted, its folder into the trash / Recycle Bin */
function removeWorkspace(r) {
    const where = (x) => x.path ?? x.server ?? x.label;
    const offList = async () => { await setRecents((await getRecents()).filter((x) => where(x) !== where(r))); };
    const canTrash = !!r.server && ServerStorage.available();
    const mac = /Mac/i.test(navigator.platform);
    const bin = mac ? 'Trash' : /Win/i.test(navigator.platform) ? 'Recycle Bin' : 'trash';
    const listBtn = h('button', { class: canTrash ? 'set-btn' : 'btn-new' }, 'Remove from list');
    const trashBtn = canTrash ? h('button', { class: 'btn-new danger-btn' }, `Move folder to ${bin}`) : null;
    const close = dialog(h('div', { class: 'confirm-box' }, h('div', { class: 'confirm-title' }, `Remove “${r.label}”?`), h('p', { class: 'confirm-text' }, canTrash
        ? `Take it off the list only (the folder stays where it is), or also move its folder to the ${bin}.`
        : 'It is taken off the list. The folder stays where it is.'), ...(canTrash ? [h('p', { class: 'confirm-text' }, r.server)] : []), h('div', { class: 'confirm-actions' }, h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), listBtn, trashBtn)));
    listBtn.addEventListener('click', async () => { close(); await offList(); toast(`“${r.label}” removed from the list`); });
    trashBtn?.addEventListener('click', async () => {
        trashBtn.setAttribute('disabled', '');
        const res = await fetch(`/api/fs/trashdir?${new URLSearchParams({ path: r.server })}`, { method: 'POST', headers: { 'x-nook-key': ServerStorage.key() ?? '' } }).catch(() => null);
        const body = res ? await res.json().catch(() => ({})) : { error: 'no connection' };
        if (!res?.ok) {
            trashBtn.removeAttribute('disabled');
            toast(body.error === 'unknown' ? 'Restart Nook (its start file) once to use this.' : `Could not move the folder: ${body.error ?? res?.status}`, 6000);
            return;
        }
        close();
        await offList();
        toast(`“${r.label}” moved to the ${bin}`);
    });
    requestAnimationFrame(() => listBtn.focus());
}
// ---------- shell (workspace menu) ----------
const shell = {
    /** the workspaces window: your workspaces (tap to switch), then ways to add one */
    async workspaceMenu(_anchor) {
        const recents = await getRecents();
        const current = app?.ws.storage.label;
        const list = recents.length ? recents : current ? [{ label: current }] : [];
        const TILE_C = ['#3d8fe6', '#4f9c51', '#9d68d3', '#e97d2f', '#d15796', '#d8a046'];
        const tile = (name) => h('span', { class: 'ws-tile', 'aria-hidden': 'true', style: { background: TILE_C[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TILE_C.length] } }, name.trim().charAt(0).toUpperCase() || '?');
        const go = (fn) => () => { close(); fn(); };
        const rows = list.map((r) => {
            const on = r.label === current;
            return h('div', { class: 'set-row ws-row' + (on ? ' on' : ''), role: 'button', tabindex: 0, onclick: on ? () => close() : go(() => openRecent(r)) }, tile(r.label), h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, r.label), on ? h('div', { class: 'set-desc' }, 'Open now') : null), h('div', { class: 'set-control', onclick: (e) => e.stopPropagation() }, on ? h('span', { class: 'ws-check' }, svgIcon(ICONS.check, 16)) : moreControl(() => [{ label: 'Open', run: go(() => openRecent(r)) }, 'sep', { label: 'Remove from this list', danger: true, run: go(() => removeWorkspace(r)) }])));
        });
        const act = (icon, label, run, desc, color = '#6b6b70') => h('div', { class: 'set-row ws-act', role: 'button', tabindex: 0, onclick: go(run) }, tileIcon(iconSvg(icon, 16), color), h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, label), desc ? h('div', { class: 'set-desc' }, desc) : null), h('span', { class: 'ws-chev' }, svgIcon(ICONS.chevronR, 13)));
        const adds = [
            ...(canOpenFolders() ? [act('folder', 'Open a folder', async () => { const p = await pickFolder(); if (p)
                    openStorage(p.st, p.recent); }, 'A folder with a Nook workspace', '#d8a046'), act('plus', 'Create a new workspace', () => createWorkspace(), undefined, '#4f9c51')] : []),
            act('cloud', dropboxConnected() ? 'Open from Dropbox' : 'Connect Dropbox', () => openDropbox(), undefined, '#3d8fe6'),
            act('arrow-down', 'Import from Notion', () => importFromNotion()),
            ...(TauriStorage.available() ? [act('folder', 'Show this workspace in its folder', () => shell.showInFolder?.())] : []),
        ];
        const body = h('div', { class: 'dialog-body bwin pset' }, bigTitle('Workspaces'), h('section', { class: 'set-sec' }, h('div', { class: 'set-heading' }, h('h3', null, 'Your workspaces')), h('div', { class: 'set-card' }, ...rows)), h('section', { class: 'set-sec' }, h('div', { class: 'set-heading' }, h('h3', null, 'Add')), h('div', { class: 'set-card' }, ...adds)));
        const close = dialog(h('div', { class: 'bwindow keep-window ws-window' }, sheetHead('Workspaces', () => close()), body));
    },
    importNotion: () => importFromNotion(),
    showInFolder: TauriStorage.available() ? () => {
        const p = app?.ws.storage?.base;
        if (p)
            window.__TAURI__.opener?.revealItemInDir?.(p);
    } : undefined,
};
// ---------- welcome ----------
const canOpenFolders = () => ServerStorage.available() || FolderStorage.supported() || TauriStorage.available();
async function welcome(wanted) {
    let recents = await getRecents();
    if (wanted)
        recents = [wanted, ...recents.filter((x) => x !== wanted)];
    root.textContent = '';
    const actions = h('div', { class: 'actions' });
    for (const r of recents.slice(0, 4))
        actions.appendChild(h('button', { class: 'big primary', onclick: () => openRecent(r) }, h('span', null, `Open ${r.label}`), h('span', null, '→')));
    actions.append(canOpenFolders() ? h('button', { class: 'big', onclick: async () => { const p = await pickFolder(); if (p)
            openStorage(p.st, p.recent); } }, h('span', null, 'Open folder as workspace…'), h('kbd', null, '⌘O')) : '', h('button', { class: 'big', onclick: () => openDropbox() }, h('span', null, dropboxConnected() ? 'Open from Dropbox…' : 'Connect Dropbox…'), h('span', null, '')), canOpenFolders() ? h('button', { class: 'big', onclick: () => createWorkspace() }, h('span', null, 'Create a new, empty workspace…'), h('span', null, '')) : '', h('button', { class: 'big', onclick: () => importFromNotion() }, h('span', null, 'Import from Notion…'), h('span', null, '')));
    root.appendChild(h('div', { class: 'welcome' }, h('h1', null, APP.name), h('p', { class: 'muted', style: { margin: 0 } }, 'Pages and databases as files in a folder you own. Put the workspace in your Dropbox folder and it is on all your computers.'), actions, dropboxConnected() ? h('button', { class: 'link-btn muted small', onclick: () => { dropboxSignOut(); welcome(wanted); } }, 'Disconnect Dropbox') : null));
}
// ---------- start ----------
// a phone shows Nook like an app: no pinch or double-tap zoom (Safari ignores the viewport's "no
// zoom" since iOS 10, its own gesture events can still be stopped)
for (const t of ['gesturestart', 'gesturechange', 'gestureend'])
    document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
// iPhone home-screen app, drawn under the status bar: iOS lays the page out in a window that is
// shorter than the screen by the status bar (a dead band stays at the bottom), but it does show a
// taller page in full. So there the page – not a pinned box – gets the real screen height.
const fitScreen = () => {
    const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const probe = document.body.appendChild(document.createElement('div'));
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none';
    const under = probe.offsetHeight > 0;
    probe.remove();
    const portrait = matchMedia('(orientation: portrait)').matches;
    const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const on = standalone && under && full - window.innerHeight > 20;
    document.documentElement.classList.toggle('fullscreen', on);
    document.documentElement.style.setProperty('--screen-h', `${full}px`);
};
fitScreen();
addEventListener('orientationchange', () => setTimeout(fitScreen, 350));
// iOS needs two taps on anything that changes on hover (the first one only "hovers"). On a phone a
// short tap on a button-like element clicks it straight away; text fields are left to the system.
const TAPPABLE = 'button, a[href], [role="button"], [role="switch"], [role="tab"], [role="menuitem"], .pop-item, .side-item, .t-card, .list-row, .g-card, .ev, .compact-month-day, .tab, .card, label';
let tapStart = null;
document.addEventListener('touchstart', (e) => {
    if (!document.documentElement.matches('.phone, .touch') || e.touches.length !== 1) {
        tapStart = null;
        return;
    }
    const t = e.touches[0];
    const el = e.target.closest?.(TAPPABLE);
    tapStart = el && !e.target.closest('input, textarea, select, [contenteditable="true"]') ? { x: t.clientX, y: t.clientY, t: Date.now(), el } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
    const s = tapStart;
    tapStart = null;
    if (!s || e.defaultPrevented)
        return;
    const t = e.changedTouches[0];
    if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10 || Date.now() - s.t > 450)
        return;
    if (!s.el.isConnected)
        return;
    e.preventDefault();
    // the mouse events code listens for (menus close on a press outside, etc.), then the click
    const opts = { bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY, view: window };
    const target = document.elementFromPoint(t.clientX, t.clientY) ?? s.el;
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    s.el.focus?.({ preventScroll: true });
    s.el.click();
}, { passive: false });
// sheets (an entry, dialogs, and every menu or panel) close by pulling them down
document.addEventListener('touchstart', (e) => {
    if (!document.documentElement.classList.contains('phone') || e.touches.length !== 1)
        return;
    const t = e.target;
    const sheet = (t.closest?.('.pop') ?? t.closest?.('.dialog'));
    if (!sheet)
        return;
    // full pages (Settings, Notifications) are tabs, not sheets: pulling them down does nothing
    if (sheet.parentElement?.classList.contains('phone-page'))
        return;
    const isPop = sheet.classList.contains('pop');
    // inside something that is scrolled down, the finger scrolls it back up first
    for (let el = t; el && el !== sheet.parentElement; el = el.parentElement) {
        if (el instanceof HTMLElement && el.scrollTop > 0)
            return;
    }
    // text being typed in keeps the finger for itself (cursor, selection); a field that is not in use can be pulled like the rest
    const field = t.closest('input, textarea, [contenteditable="true"]');
    if (field && ((field === document.activeElement && !field.classList.contains('palette-input')) || field.matches('input[type="range"]') || (!isPop && !t.closest('.peek-head, .dialog-head'))))
        return;
    const y0 = e.touches[0].clientY, x0 = e.touches[0].clientX;
    const base = isPop ? 'translateY(-100%) ' : '';
    let dy = 0, on = false, dead = false, lastY = y0, lastT = performance.now(), vel = 0;
    const scrim = sheet.closest('.overlay');
    const move = (ev) => {
        if (dead)
            return;
        const p = ev.touches[0];
        const now = performance.now();
        vel = (p.clientY - lastY) / Math.max(1, now - lastT);
        lastY = p.clientY;
        lastT = now;
        const raw = p.clientY - y0;
        // pulled up: a little give, as on iOS; pulled down: it follows the finger
        dy = raw >= 0 ? raw : -Math.sqrt(-raw) * 2;
        if (!on) {
            if (Math.abs(p.clientX - x0) > 12 && Math.abs(p.clientX - x0) > dy) {
                dead = true;
                return;
            } // a sideways swipe (chips, a slider)
            if (dy <= 6)
                return;
            if (document.documentElement.classList.contains('touch-dragging')) {
                dead = true;
                return;
            } // something was lifted to be moved
            on = true;
        }
        ev.preventDefault();
        sheet.classList.add('dragging');
        sheet.style.animation = 'none';
        sheet.style.transform = `${base}translateY(${dy}px)`;
        if (scrim && !isPop)
            scrim.style.backgroundColor = `rgba(0,0,0,${0.4 * Math.max(0, 1 - Math.max(0, dy) / (sheet.offsetHeight || 600))})`;
    };
    const end = () => {
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', end);
        if (!on)
            return;
        sheet.classList.remove('dragging');
        // far enough, or flicked down: it slides away with the finger's speed; else it springs back
        if (dy > Math.min(140, (sheet.offsetHeight || 600) * 0.25) || vel > 0.5) {
            const left = (sheet.offsetHeight || 600) - dy;
            const ms = Math.max(160, Math.min(320, left / Math.max(1.2, vel)));
            sheet.style.transition = `transform ${ms}ms cubic-bezier(.32,.72,0,1)`;
            sheet.style.transform = `${base}translateY(${(sheet.offsetHeight || 600) + 40}px)`;
            if (scrim && !isPop) {
                scrim.style.transition = `background-color ${ms}ms ease-out`;
                scrim.style.backgroundColor = 'rgba(0,0,0,0)';
            }
            sheet.dataset.gone = '1';
            setTimeout(() => { (isPop ? sheet : document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); if (sheet.isConnected) {
                delete sheet.dataset.gone;
                settle();
            } }, ms);
        }
        else
            settle();
    };
    const settle = () => {
        sheet.classList.add('settling');
        sheet.style.transition = '';
        sheet.style.transform = '';
        if (scrim) {
            scrim.style.transition = 'background-color .3s ease';
            scrim.style.backgroundColor = '';
        }
        setTimeout(() => { sheet.classList.remove('settling'); sheet.style.animation = ''; if (scrim)
            scrim.style.transition = ''; }, 360);
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
}, { passive: true });
// Nook never runs inside another website's frame (a page around it could trick clicks)
if (window.top !== window.self && !document.querySelector('meta[name="nook-demo"]')) {
    document.documentElement.textContent = '';
    throw new Error('Nook does not run inside another page.');
}
// touched, whatever the layout (a phone, a tablet): taps, hold-to-move and Undo buttons follow this
document.documentElement.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);
document.addEventListener('nook:undo', () => void app?.undo());
installTouchDrag();
// Phone: a menu, picker or panel with a search field does not bring up the keyboard by itself – the
// choices stay in view, and the keyboard comes when the field is tapped. (A plain "type a name" prompt
// still gets it: typing is all there is to do.)
{
    const tapped = new WeakSet();
    document.addEventListener('touchend', (e) => { const f = e.target?.closest?.('.pop input, .pop textarea, .set-nav input'); const pop = f?.closest('.pop, .set-nav'); if (pop)
        tapped.add(pop); }, true);
    const nativeFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (opts) {
        // (only where typing means an on-screen keyboard: a narrow window with a real keyboard keeps its focus)
        if (document.documentElement.matches('.phone.touch') && this.matches('input, textarea')) {
            const pop = this.closest('.pop, .set-nav');
            if (pop && !tapped.has(pop) && !this.closest('.pop-prompt'))
                return;
        }
        // keyboard up: moving to another line (Enter, ↑ ↓) must not make iOS pan the screen – the sheet jumped down
        // and back with every new line. The page scrolls the line into view itself (keepCaret below).
        // ONE rule for the phone: whatever puts the cursor into text – a tap, Enter, ↑ ↓, a window or menu opening
        // a field by itself – focuses without letting iOS scroll, and a field low on the screen is moved up inside
        // its window before the keyboard arrives (kbSoon). No special cases per window.
        if (document.documentElement.classList.contains('phone') && (this.isContentEditable || this.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea'))) {
            const r = document.documentElement;
            // keyboard still down: the keyboard is opened on a hidden field at the top of the screen (nothing for iOS
            // to reveal, so it never slides); once it is up, the line is lifted above it and gets the cursor (proxyFocus)
            if (r.classList.contains('touch') && !r.classList.contains('kb-open') && document.activeElement !== this && !this.classList.contains('kb-proxy')) {
                proxyFocus(this, nativeFocus);
                return;
            }
            nativeFocus.call(this, { ...opts, preventScroll: true });
            return;
        }
        nativeFocus.call(this, opts);
    };
    // selecting a field's text focuses it too
    const nativeSelect = HTMLInputElement.prototype.select;
    HTMLInputElement.prototype.select = function () {
        const pop = document.documentElement.matches('.phone.touch') ? this.closest('.pop') : null;
        if (pop && !tapped.has(pop) && !this.closest('.pop-prompt') && document.activeElement !== this)
            return;
        nativeSelect.call(this);
    };
}
// ---------------------------------------------------------------------------------------------
// Phone and the on-screen keyboard – one model:
//  1. The document itself never scrolls (it is pinned to the screen; only boxes inside it scroll).
//  2. Windows (sheets) never change size or place for the keyboard; it slides over them.
//  3. A tap into text while the keyboard is down opens the keyboard on a hidden field at the top
//     (proxyFocus) – iOS finds nothing to reveal and doesn't slide the screen. Once the keyboard is up,
//     the tapped line is lifted above it (lift / keepCaret) and gets the cursor.
//  4. Lifting: the nearest box that scrolls gets the keyboard's height as room at its end (.kb-room) and
//     scrolls by exactly what is missing; a window without such a box grows upwards instead.
// iOS reports the keyboard through the visual viewport (its height drops), which is all this needs.
// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// Phone, the one global rule for the keyboard: iOS slides the screen when the keyboard comes up and the field
// that has the cursor would be under it. So the cursor is never in such a field at that moment: the keyboard
// is opened on a hidden field at the top of the screen, and when it is up, the tapped line is lifted above it
// inside whatever box scrolls (any window, sheet, page) and then gets the cursor – already visible, so iOS
// has nothing to do. No list of windows; sheets, pages and windows all go the same way.
// ---------------------------------------------------------------------------------------------
let pending = null;
let lift = () => { };
let proxy = null;
const finishFocus = (nativeFocus) => {
    const p = pending;
    if (!p)
        return;
    pending = null;
    clearTimeout(p.timer);
    if (document.activeElement !== proxy || !p.el.isConnected) {
        kbLog('proxy: focus went elsewhere');
        return;
    }
    const isInput = p.el.matches('input, textarea');
    let range = p.range;
    if (!isInput && !range) {
        range = document.createRange();
        range.selectNodeContents(p.el);
        range.collapse(false);
    }
    const caret = () => {
        if (isInput) {
            const b = p.el.getBoundingClientRect();
            return { top: b.top, bottom: Math.min(b.bottom, b.top + 56) };
        }
        const b = range.getBoundingClientRect();
        return b.height ? b : p.el.getBoundingClientRect();
    };
    lift(p.el, caret);
    nativeFocus.call(p.el, { preventScroll: true });
    if (!isInput && range) {
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }
    kbLog('proxy: line lifted, cursor placed');
};
const proxyFocus = (el, nativeFocus) => {
    if (!proxy) {
        proxy = document.createElement('input');
        proxy.className = 'kb-proxy';
        proxy.setAttribute('aria-hidden', 'true');
        proxy.tabIndex = -1;
        proxy.setAttribute('autocomplete', 'off');
        proxy.setAttribute('autocorrect', 'off');
        proxy.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top,0px) + 8px);left:0;width:1px;height:24px;opacity:0;font-size:16px;border:0;padding:0;pointer-events:none;caret-color:transparent;z-index:-1';
    }
    if (!proxy.isConnected)
        document.body.appendChild(proxy);
    if (pending)
        clearTimeout(pending.timer);
    // done when the keyboard is up – or after a moment if none comes (a focus from a script, a hardware keyboard)
    pending = { el, range: null, timer: window.setTimeout(() => finishFocus(nativeFocus), 900) };
    nativeFocus.call(proxy, { preventScroll: true });
    kbLog('proxy: keyboard opened at the top');
    const wait = () => { if (!pending || pending.el !== el)
        return; if (document.documentElement.classList.contains('kb-open'))
        finishFocus(nativeFocus);
    else
        requestAnimationFrame(wait); };
    requestAnimationFrame(wait);
};
const fullSeen = { w: 0, h: 0 };
const isField = (a) => !!a && (a.isContentEditable || a.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea'));
const fitSheets = () => {
    const root = document.documentElement, vv = window.visualViewport;
    if (!vv || !document.body)
        return;
    // the screen's full height (a home-screen app's own height can shrink with the keyboard; the screen's can't)
    const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const screenH = standalone && root.classList.contains('phone') ? (innerWidth > innerHeight ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height)) : 0;
    const now = Math.max(innerHeight, screenH);
    if (fullSeen.w !== innerWidth) {
        fullSeen.w = innerWidth;
        fullSeen.h = now;
    }
    const full = Math.max(now, fullSeen.h);
    fullSeen.h = full;
    const kb = root.classList.contains('phone') ? Math.max(0, Math.round(full - vv.height)) : 0;
    const keyboard = kb > 150;
    if (root.classList.contains('kb-open') !== keyboard)
        kbLog(`keyboard ${keyboard ? `UP ${kb}` : 'down'}`);
    root.classList.toggle('kb-open', keyboard);
    if (keyboard) {
        try {
            localStorage.setItem('nook.kbh', String(kb));
        }
        catch { /* private */ }
    }
    root.style.setProperty('--full-h', `${Math.round(full)}px`);
    root.style.setProperty('--kb-h', `${keyboard ? kb : 0}px`);
    // menus sit on the bottom edge – or on top of the keyboard while it is up
    root.style.setProperty('--sheet-top', `${Math.round(vv.offsetTop)}px`);
    root.style.setProperty('--sheet-h', `${Math.round(keyboard ? vv.height : full)}px`);
    // keyboard gone: windows that grew for it go back
    if (!keyboard)
        document.querySelectorAll('.kb-room').forEach((d) => d.classList.remove('kb-room'));
    if (!keyboard)
        document.querySelectorAll('[data-kbx]').forEach((d) => { d.style.paddingBottom = d.dataset.kbx === '-' ? '' : d.dataset.kbx; delete d.dataset.kbx; delete d.dataset.kbxN; });
};
window.visualViewport?.addEventListener('resize', fitSheets);
addEventListener('resize', fitSheets);
addEventListener('orientationchange', () => setTimeout(fitSheets, 350));
if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', fitSheets);
else
    fitSheets();
const kbStart = () => { if (kbDebugOn())
    startKbDebug(); };
if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', kbStart);
else
    kbStart();
setTimeout(fitSheets, 500);
// the document is a little taller than iOS's window in a home-screen app (it reaches under the home
// indicator), so iOS can scroll it by that much: put it back – while the keyboard is down that is invisible
addEventListener('scroll', () => {
    const r = document.documentElement;
    if (!r.classList.contains('phone') || r.classList.contains('kb-open') || (!scrollY && !scrollX))
        return;
    kbLog(`page put back ${Math.round(scrollY)}`);
    scrollTo(0, 0);
}, { passive: true });
// The keyboard is about to come up for a tap (its height known from last time): the line is brought above
// where it will end, before it arrives – so iOS finds nothing hidden and doesn't slide the screen.
// Phone, everywhere: a short tap into text – a line, a title, a field – is handled by Nook, not iOS. Nook
// puts the cursor where the finger was and focuses with “don't scroll” (the keyboard still comes up, as the
// focus happens in the tap). Left to iOS, the screen slid to centre the text and Nook had to slide it back.
// This covers the first tap (keyboard still down), taps into another line, and fields a window had already
// put the cursor in by itself. Long presses, selections, links, chips and controls keep iOS's own handling.
{
    let x0 = 0, y0 = 0, t0 = 0, moved = false;
    // a touch on a line while the keyboard is down: where the cursor would go is noted now, and if the line is
    // low it starts gliding up at once (a swipe instead of a tap stops the glide where it is)
    let pre = null;
    document.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        x0 = t.clientX;
        y0 = t.clientY;
        t0 = Date.now();
        moved = e.touches.length > 1;
        pre = null;
        const r = document.documentElement, target = e.target;
        if (moved || !r.classList.contains('phone') || r.classList.contains('kb-open'))
            return;
        const ed = target.closest?.('[contenteditable="true"]');
        if (!ed || target.closest('a, button, select, .chip, [contenteditable="false"], .rem-chip, mark[data-comment]') || document.activeElement === ed)
            return;
        const range = document.caretRangeFromPoint?.(x0, y0) ?? null;
        const okRange = range && ed.contains(range.startContainer) ? range : null;
        const cr = okRange?.getBoundingClientRect();
        const bottom = cr && cr.height ? cr.bottom : ed.getBoundingClientRect().bottom;
        pre = { ed, range: okRange };
        // (a glide here was tried: iOS still slid the screen – the line is moved at once on release instead)
        void bottom;
    }, { capture: true, passive: true });
    document.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (Math.abs(t.clientX - x0) > 8 || Math.abs(t.clientY - y0) > 8) {
        if (!moved) {
            pre?.stop?.();
            pre = null;
        }
        moved = true;
    } }, { capture: true, passive: true });
    const TEXT_INPUT = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=date]):not([type=time]):not([type=datetime-local]):not([type=color]):not([type=button]):not([type=submit]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])';
    document.addEventListener('touchend', (e) => {
        const r = document.documentElement;
        if (!r.classList.contains('phone') || moved || Date.now() - t0 > 500 || e.defaultPrevented) {
            if (r.classList.contains('phone'))
                kbLog(`tap left to iOS (${moved ? 'moved' : Date.now() - t0 > 500 ? 'long' : 'taken'})`);
            return;
        }
        const target = e.target;
        const kbUp = r.classList.contains('kb-open');
        // a text field
        const f = target.closest?.(TEXT_INPUT);
        if (f) {
            // already typing in it: the tap moves the cursor inside it – iOS does that best
            if (document.activeElement === f && kbUp)
                return;
            e.preventDefault();
            if (document.activeElement === f)
                f.blur();
            f.focus({ preventScroll: true });
            const end = f.value.length;
            try {
                f.setSelectionRange(end, end);
            }
            catch { /* some inputs */ }
            kbLog('field focused without scrolling');
            return;
        }
        // a line of text
        const ed = target.closest?.('[contenteditable="true"]');
        if (!ed || target.closest('a, button, select, .chip, [contenteditable="false"], .rem-chip, mark[data-comment]'))
            return;
        const sel = getSelection();
        if (sel && !sel.isCollapsed && ed.contains(sel.anchorNode))
            return; // a selection is being made or changed
        // noted on touch-down (the line may have glided since)
        const noted = pre && pre.ed === ed ? pre : null;
        let range = noted ? noted.range : document.caretRangeFromPoint?.(x0, y0) ?? null;
        // a tap beside or below the words (in the line's empty part): the cursor goes to the line's end
        if (!range || !ed.contains(range.startContainer)) {
            range = document.createRange();
            range.selectNodeContents(ed);
            range.collapse(false);
        }
        e.preventDefault();
        if (document.activeElement === ed && !kbUp)
            ed.blur();
        ed.focus({ preventScroll: true });
        if (pending && pending.el === ed)
            pending.range = range;
        else {
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
        kbLog('tap: cursor placed without scrolling');
    }, { capture: true, passive: false });
}
// keyboard up, iOS's ↑ ↓ buttons above the keyboard: iOS moves the cursor to the next line itself and
// slides the screen to it. Such a move comes without a touch or a key – Nook catches it the moment it
// happens and focuses the same line again, this time telling iOS not to scroll.
{
    let lastInput = 0;
    document.addEventListener('touchend', () => { lastInput = Date.now(); }, true);
    document.addEventListener('keydown', () => { lastInput = Date.now(); }, true);
    let refocusing = false;
    document.addEventListener('focusin', (e) => {
        const r = document.documentElement, t = e.target;
        if (refocusing || !r.classList.contains('phone') || !r.classList.contains('kb-open') || !isField(t) || Date.now() - lastInput < 600)
            return;
        const sel = getSelection();
        const range = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        refocusing = true;
        t.blur();
        t.focus({ preventScroll: true });
        if (range && t.contains(range.startContainer)) {
            sel.removeAllRanges();
            sel.addRange(range);
        }
        refocusing = false;
        kbLog('↑↓: line focused again without scrolling');
    }, true);
}
// the line being typed: only moved when the keyboard would cover it
{
    let queued = false;
    const SC = '.peek-body, .dialog-body, .set-main, .vpanel, .main > .scroll, .overlay > .dialog';
    const keepCaret = () => {
        queued = false;
        const root = document.documentElement, vv = window.visualViewport;
        if (!vv || !root.classList.contains('kb-open') || !isField(document.activeElement) || document.activeElement.classList.contains('kb-proxy'))
            return;
        const act = document.activeElement;
        let el, caret;
        if (act.matches('input, textarea')) {
            // a field: its first lines are what matters (a tall notes field needn't fit whole)
            el = act;
            caret = () => { const r = act.getBoundingClientRect(); return { top: r.top, bottom: Math.min(r.bottom, r.top + 56) }; };
        }
        else {
            const sel = getSelection();
            if (!sel || !sel.rangeCount)
                return;
            const node = sel.focusNode;
            const e = (node?.nodeType === 1 ? node : node?.parentElement);
            if (!e || !act.contains(e))
                return;
            el = e;
            const range = sel.getRangeAt(0).cloneRange();
            range.collapse(false);
            caret = () => { const r = range.getBoundingClientRect(); return r.height ? r : e.getBoundingClientRect(); };
        }
        liftNow(el, caret);
    };
    const liftNow = (el, caret) => {
        const vv = window.visualViewport;
        // where the keyboard begins, as seen on screen (the visible area's lower edge), with a little air
        const bottom = vv.offsetTop + vv.height - 12;
        let over = caret().bottom - bottom;
        // a window with a group of fields (the reminder window): room for the whole group as soon as one has the cursor
        {
            const win = el.closest('.overlay > .dialog'), group = win?.querySelector('.own-body-phone .og');
            if (group)
                over = Math.max(over, group.getBoundingClientRect().bottom + 8 - bottom);
        }
        if (over > 1) {
            // the box the line is in scrolls, if it can
            // the nearest box that scrolls – whatever it is (no list): it gets the keyboard's height as room at its end
            // the known scroll areas first (a page, an entry, a window body – as it worked before 0.9.30), then any box that scrolls
            let sc = el.closest(SC.replace(', .overlay > .dialog', ''));
            if (!sc)
                for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
                    const oy = getComputedStyle(p).overflowY;
                    if (oy === 'auto' || oy === 'scroll') {
                        sc = p;
                        break;
                    }
                }
            if (!sc)
                sc = el.closest('.overlay > .dialog');
            if (sc) {
                if (!sc.classList.contains('kb-room')) {
                    sc.classList.add('kb-room');
                    void sc.offsetHeight;
                }
                const room = sc.scrollHeight - sc.clientHeight - sc.scrollTop;
                const by = Math.min(over, Math.max(0, room));
                if (by > 0) {
                    kbLog(`scroll ${String(sc.className).split(' ')[0]} +${Math.round(by)}`);
                    sc.scrollTop += by;
                    over -= by;
                }
            }
            // a window without enough to scroll grows upwards by what is missing (its bottom stays behind the keyboard) –
            // enough for all of its fields together, so moving between them changes nothing
            const win = el.closest('.overlay > .dialog');
            const group = win?.querySelector('.own-body-phone .og');
            if (group && win && over > 1) {
                const gOver = group.getBoundingClientRect().bottom + 8 - bottom;
                if (gOver > over)
                    over = gOver;
            }
            if (over > 1 && win) {
                if (win.dataset.kbx === undefined)
                    win.dataset.kbx = win.style.paddingBottom || '-';
                const extra = (Number(win.dataset.kbxN) || 0) + over;
                win.dataset.kbxN = String(Math.round(extra));
                kbLog(`window grows +${Math.round(over)}`);
                win.style.paddingBottom = `calc(${win.dataset.kbx === '-' ? '0px' : win.dataset.kbx} + ${Math.round(extra)}px)`;
            }
        }
        else {
            // a line above the top of its box (moving up with ↑): scroll back just enough
            const sc = el.closest(SC);
            if (sc) {
                const top = sc.getBoundingClientRect().top + 8, r = caret();
                if (r.top < top) {
                    kbLog(`scroll up ${Math.round(top - r.top)}`);
                    sc.scrollTop -= top - r.top;
                }
            }
        }
    };
    lift = liftNow;
    const queue = () => { if (!queued) {
        queued = true;
        requestAnimationFrame(keepCaret);
    } };
    document.addEventListener('input', queue, true);
    document.addEventListener('selectionchange', queue);
    // the keyboard has finished sliding in
    window.visualViewport?.addEventListener('resize', () => { queue(); setTimeout(queue, 120); });
    // iOS may still slide the visible area up for a line it thinks is covered: the line is brought into view
    // inside its window first, then the screen is put back where it belongs
    window.visualViewport?.addEventListener('scroll', () => {
        const vv = window.visualViewport;
        if (!document.documentElement.classList.contains('phone') || vv.offsetTop < 1)
            return;
        kbLog(`iOS slid the screen ${Math.round(vv.offsetTop)}`);
        requestAnimationFrame(() => { scrollTo(0, 0); fitSheets(); keepCaret(); });
    });
    // (a script focusing the next line – Enter, a new row – must not make iOS slide the screen either)
}
// phone: pull the page down at its top to fetch what changed elsewhere (Dropbox, calendars)
{
    let pill = null;
    document.addEventListener('touchstart', (e) => {
        const root = document.documentElement;
        if (!root.classList.contains('phone') || e.touches.length !== 1 || !app)
            return;
        if (document.querySelector('.overlay, .pop, .side-backdrop') || root.classList.contains('kb-open'))
            return;
        const sc = e.target.closest?.('.main > .scroll');
        if (!sc || sc.scrollTop > 0)
            return;
        // inside something that scrolls on its own (a board, a long list in a callout) the pull belongs to that
        for (let el = e.target; el && el !== sc; el = el.parentElement)
            if (el.scrollTop > 0)
                return;
        const y0 = e.touches[0].clientY, x0 = e.touches[0].clientX;
        let dy = 0, dead = false;
        const move = (ev) => {
            if (dead)
                return;
            const t = ev.touches[0];
            dy = t.clientY - y0;
            if (dy < 0 || Math.abs(t.clientX - x0) > Math.max(24, dy) || sc.scrollTop > 0 || root.classList.contains('touch-dragging')) {
                dead = true;
                pill?.remove();
                pill = null;
                return;
            }
            if (dy < 24)
                return;
            if (!pill) {
                pill = document.createElement('div');
                pill.className = 'pull-pill';
                document.body.appendChild(pill);
            }
            const ready = dy > 110;
            pill.textContent = ready ? 'Release to refresh' : 'Pull to refresh';
            pill.classList.toggle('ready', ready);
            pill.style.transform = `translate(-50%, ${Math.min(64, (dy - 24) * 0.45)}px)`;
            pill.style.opacity = String(Math.min(1, (dy - 24) / 60));
        };
        const end = async () => {
            document.removeEventListener('touchmove', move);
            document.removeEventListener('touchend', end);
            document.removeEventListener('touchcancel', end);
            const p = pill;
            pill = null;
            if (!p)
                return;
            if (dead || dy <= 110) {
                p.remove();
                return;
            }
            p.textContent = 'Refreshing…';
            p.classList.add('busy');
            try {
                const st = app.ws.storage;
                const n = st.sync ? await st.sync() : 0;
                await app.reload(true);
                void calendars.refreshSubs();
                toast(n ? `${n} change${n === 1 ? '' : 's'} from your other devices` : 'Everything is up to date');
            }
            catch (err) {
                toast(`Could not refresh: ${err.message}`, 4000);
            }
            p.remove();
        };
        document.addEventListener('touchmove', move, { passive: true });
        document.addEventListener('touchend', end);
        document.addEventListener('touchcancel', end);
    }, { passive: true });
}
// phone: the open sidebar is swiped away to the left (it follows the finger)
document.addEventListener('touchstart', (e) => {
    if (!document.documentElement.classList.contains('phone') || e.touches.length !== 1 || !app)
        return;
    const side = document.querySelector('.app > .sidebar');
    const back = document.querySelector('.side-backdrop');
    if (!side || !back || document.querySelector('.overlay, .pop'))
        return;
    const x0 = e.touches[0].clientX, y0 = e.touches[0].clientY;
    let dx = 0, on = false, dead = false;
    const move = (ev) => {
        if (dead)
            return;
        const t = ev.touches[0];
        dx = Math.min(0, t.clientX - x0);
        const dy = Math.abs(t.clientY - y0);
        if (!on) {
            if (dy > 12 && dy > -dx) {
                dead = true;
                return;
            } // scrolling the page list
            if (dx > -10)
                return;
            if (document.documentElement.classList.contains('touch-dragging')) {
                dead = true;
                return;
            } // a page is being moved
            on = true;
        }
        ev.preventDefault();
        side.style.transition = 'none';
        back.style.transition = 'none';
        side.style.transform = `translateX(${dx}px)`;
        back.style.opacity = String(Math.max(0, 1 + dx / side.offsetWidth));
    };
    const end = () => {
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', end);
        if (!on)
            return;
        side.style.transition = 'transform .16s ease-out';
        back.style.transition = 'opacity .16s ease-out';
        if (dx < -70) {
            side.style.transform = 'translateX(-105%)';
            back.style.opacity = '0';
            setTimeout(() => { if (document.querySelector('.side-backdrop'))
                app?.toggleSidebar(); }, 150);
        }
        else {
            side.style.transform = '';
            back.style.opacity = '';
            setTimeout(() => { side.style.transition = ''; back.style.transition = ''; }, 180);
        }
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
}, { passive: true });
// back and forward by swiping in from the left or right edge, as everywhere on iOS
document.addEventListener('touchstart', (e) => {
    const root = document.documentElement;
    if (!root.classList.contains('phone') || e.touches.length !== 1 || !app)
        return;
    if (document.querySelector('.overlay, .pop, .side-backdrop'))
        return;
    const x0 = e.touches[0].clientX, y0 = e.touches[0].clientY;
    const dir = x0 <= 24 ? 'back' : x0 >= innerWidth - 24 ? 'forward' : null;
    if (!dir || !app.canGo(dir))
        return;
    const sign = dir === 'back' ? 1 : -1;
    const page = document.querySelector('.main > .scroll');
    if (!page)
        return;
    let dx = 0, on = false, dead = false, lastDx = 0, lastT = performance.now(), vx = 0;
    const move = (ev) => {
        if (dead)
            return;
        const t = ev.touches[0];
        dx = Math.max(0, (t.clientX - x0) * sign);
        const dy = Math.abs(t.clientY - y0);
        if (!on) {
            if (dy > 14 && dy > dx) {
                dead = true;
                return;
            }
            if (dx > 10)
                on = true;
            else
                return;
        }
        ev.preventDefault();
        const now = performance.now();
        vx = (dx - lastDx) / Math.max(1, now - lastT);
        lastDx = dx;
        lastT = now;
        page.style.transition = 'none';
        page.style.transform = `translateX(${sign * dx}px)`;
        page.style.boxShadow = `${sign * -12}px 0 28px rgba(0,0,0,${0.35 * (1 - dx / innerWidth)})`;
    };
    const end = () => {
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', end);
        if (!on)
            return;
        // past a third of the screen, or flicked: the page leaves at the finger's speed and the other one comes in
        if (dx > innerWidth / 3 || vx > 0.45) {
            const ms = Math.max(140, Math.min(300, (innerWidth - dx) / Math.max(1.4, vx)));
            page.style.transition = `transform ${ms}ms cubic-bezier(.32,.72,0,1)`;
            page.style.transform = `translateX(${sign * innerWidth}px)`;
            setTimeout(() => {
                page.style.boxShadow = '';
                root.classList.add(dir === 'back' ? 'nav-from-left' : 'nav-from-right');
                if (dir === 'back')
                    app?.back();
                else
                    app?.forward();
                setTimeout(() => root.classList.remove('nav-from-left', 'nav-from-right'), 380);
            }, ms);
        }
        else {
            page.style.transition = 'transform .32s cubic-bezier(.32,.72,0,1), box-shadow .32s';
            page.style.transform = '';
            page.style.boxShadow = '';
            setTimeout(() => { page.style.transition = ''; }, 340);
        }
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
}, { passive: true });
// the hosted site (not the local server or the desktop app) keeps its own files for starting offline
if ('serviceWorker' in navigator && location.protocol === 'https:' && !ServerStorage.available() && !TauriStorage.available()) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
}
(async () => {
    const q = new URLSearchParams(location.hash.replace(/^#/, ''));
    // demo build (the hosted test copy): <meta name="nook-demo" content="demo.json"> opens a demo
    // workspace held in this browser's storage; nothing is sent anywhere
    const demo = document.querySelector('meta[name="nook-demo"]')?.getAttribute('content');
    if (demo)
        return openDemo(demo);
    // back from Dropbox's login page
    try {
        if (await finishDropboxLogin()) {
            const next = sessionStorage.getItem('nook:after-dropbox-login') ?? 'choose';
            sessionStorage.removeItem('nook:after-dropbox-login');
            const r = next.startsWith('recent:') ? (await getRecents()).find((x) => x.dropbox === next.slice(7)) : undefined;
            if (r)
                return openRecent(r);
            await welcome();
            return openDropbox();
        }
    }
    catch (e) {
        toast(e.message, 6000);
    }
    const recents = await getRecents();
    if (TauriStorage.available() && recents[0]?.path)
        return openRecent(recents[0]);
    // through the local server no permission is needed: open the linked or last workspace right away
    if (ServerStorage.available()) {
        const wantedName = q.get('ws');
        const r0 = (wantedName ? recents.find((x) => x.label === wantedName && x.server) : undefined) ?? recents.find((x) => x.server);
        if (r0 && (await new ServerStorage(r0.server).exists('.workspace/workspace.json')))
            return openRecent(r0);
    }
    // a link to a workspace (e.g. a page opened in a new tab): open it right away if the browser
    // still has access to the folder, otherwise one click asks for it
    const wanted = q.get('ws');
    const r = wanted ? recents.find((x) => x.label === wanted) : undefined;
    if (r?.handle && (await r.handle.queryPermission?.({ mode: 'readwrite' })) === 'granted')
        return openRecent(r);
    // a Dropbox workspace needs no permission per visit: open the linked or last one right away
    if (dropboxConnected() && !ServerStorage.available() && !TauriStorage.available()) {
        const d = (r?.dropbox ? r : undefined) ?? (!wanted ? recents.find((x) => x.dropbox) : undefined);
        if (d && recents[0] === d)
            return openRecent(d);
        if (d && r === d)
            return openRecent(d);
    }
    return welcome(r);
})();
// thin lines that land on whole screen pixels: with display scaling (e.g. 125 %) a 1px gap between
// rows would come out 1 or 2 screen pixels wide by turns. --hair is exactly one screen pixel, and
// --row-30 a ~30px row height that is a whole number of screen pixels.
function pixelSnap() {
    const d = window.devicePixelRatio || 1;
    const r = document.documentElement.style;
    const snap = (px) => `${Math.max(1, Math.round(px * d)) / d}px`;
    const phone = document.documentElement.classList.contains('phone');
    r.setProperty('--hair', `${1 / d}px`);
    // entries: one height and gap everywhere (desktop 28/2, month cells 22/2, phone 36/2), each a whole number of
    // screen pixels – so every gap between rows looks the same, whatever the display scaling
    const uh = snap(phone ? 36 : 28);
    r.setProperty('--u-h', uh);
    r.setProperty('--row-30', uh);
    r.setProperty('--u-g', snap(2));
    r.setProperty('--ring-1', snap(1));
    r.setProperty('--ring-15', snap(1.5));
    r.setProperty('--ring-2', snap(2));
    r.setProperty('--m-h', snap(22));
    r.setProperty('--m-g', snap(2));
    r.setProperty('--dot', snap(5));
    r.setProperty('--dot-g', snap(3));
}
pixelSnap();
window.addEventListener('resize', pixelSnap);
// the phone layout switches with the window width: the sizes follow
new MutationObserver(pixelSnap).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
// phone: the highlight in the bottom bar is one glass lens that glides from tab to tab – stretching a little
// as it moves and settling with a soft spring, as on iOS. The bar is rebuilt with the page, so the lens
// remembers where it was and starts from there.
{
    let lastX = -1, lastW = 0, queued = false;
    const target = (pill) => {
        // the notifications sheet is open: the lens sits on Notifications while it is (then goes back)
        if (document.querySelector('.np-body'))
            return pill.querySelector('.tab-notifications');
        if (document.querySelector('.dialog.settings-dialog') && !document.querySelector('.overlay ~ .overlay'))
            return pill.querySelector('.tab-settings');
        return pill.querySelector('.tab.on');
    };
    const sync = () => {
        queued = false;
        // ＋ and ⋯ stay pressed-looking while the menu they opened is up
        if (!document.querySelector('.pop:not(.pop-closing)'))
            document.querySelectorAll('.held').forEach((b) => b.classList.remove('held'));
        const pill = document.querySelector('html.phone .tab-bar .tab-pill');
        if (!pill)
            return;
        let lens = pill.querySelector(':scope > .tab-lens');
        if (!lens) {
            lens = document.createElement('div');
            lens.className = 'tab-lens';
            pill.prepend(lens);
            if (lastX >= 0) {
                lens.style.width = `${lastW}px`;
                lens.style.transform = `translateX(${lastX}px)`;
                lens.style.opacity = '1';
            }
        }
        const t = target(pill);
        pill.querySelectorAll('.tab').forEach((x) => x.classList.toggle('lit', x === t));
        if (!t) {
            lens.style.opacity = '0';
            return;
        }
        const x = t.offsetLeft, w = t.offsetWidth;
        if (x === lastX && w === lastW && lens.style.opacity === '1')
            return;
        const from = lastX, fromW = lastW, shown = lens.style.opacity === '1';
        lastX = x;
        lastW = w;
        lens.style.width = `${w}px`;
        lens.style.transform = `translateX(${x}px)`;
        lens.style.opacity = '1';
        if (!shown || from < 0 || matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        const dist = Math.abs(x - from), stretch = Math.min(0.35, dist / 400);
        lens.animate([
            { width: `${fromW}px`, transform: `translateX(${from}px) scale(1, 1)` },
            { width: `${Math.max(w, fromW)}px`, transform: `translateX(${from + (x - from) * 0.55}px) scale(${1 + stretch}, ${1 - stretch * 0.4})`, offset: 0.45 },
            { width: `${w}px`, transform: `translateX(${x}px) scale(1, 1)` },
        ], { duration: 460, easing: 'cubic-bezier(.3, 1.25, .45, 1)' });
        // a short light in the glass as it lands (iOS lights the lens up while it moves)
        lens.animate([
            { boxShadow: '0 0 0 0 rgba(255,255,255,0), inset 0 1px 0 rgba(255,255,255,.14)', backgroundColor: 'color-mix(in srgb, var(--fg) 11%, transparent)' },
            { boxShadow: '0 0 18px 2px rgba(255,255,255,.16), inset 0 1px 0 rgba(255,255,255,.4), inset 0 0 14px rgba(255,255,255,.14)', backgroundColor: 'color-mix(in srgb, var(--fg) 22%, transparent)', offset: 0.4 },
            { boxShadow: '0 0 0 0 rgba(255,255,255,0), inset 0 1px 0 rgba(255,255,255,.14)', backgroundColor: 'color-mix(in srgb, var(--fg) 11%, transparent)' },
        ], { duration: 620, easing: 'ease-out', composite: 'replace' });
        const icon = t.querySelector('svg');
        icon?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'cubic-bezier(.3, 1.4, .5, 1)' });
    };
    const queue = () => { if (!queued) {
        queued = true;
        requestAnimationFrame(sync);
    } };
    const start = () => { new MutationObserver(queue).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] }); queue(); };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', start);
    else
        start();
    addEventListener('resize', queue);
    document.addEventListener('click', (e) => { const b = e.target.closest?.('html.phone .tab-fab, html.phone .page-more'); if (b)
        setTimeout(() => { if (document.querySelector('.pop:not(.pop-closing)'))
            b.classList.add('held'); }, 30); }, true);
}
// Measured distance from the bottom of the viewport to the top of the bottom bar.
// Things that must sit just above the bar (the New reminder button) use it, so they
// don't depend on how tall any container turns out to be on a given device.
{
    const measureBar = () => {
        const bar = document.querySelector('.tab-bar .tab-pill');
        if (!bar)
            return;
        // measured from the bottom of the page (body), the same box the bar itself sits in
        const h = Math.max(0, Math.round(document.body.getBoundingClientRect().bottom - bar.getBoundingClientRect().top));
        document.documentElement.style.setProperty('--bar-top', h + 'px');
        // the Notifications page: measured from its own bottom edge, wherever that ends
        const np = document.querySelector('.np.phone');
        if (np)
            np.style.setProperty('--bar-top', Math.max(0, Math.round(np.getBoundingClientRect().bottom - bar.getBoundingClientRect().top)) + 'px');
    };
    measureBar();
    addEventListener('resize', measureBar);
    new MutationObserver(() => { requestAnimationFrame(measureBar); setTimeout(measureBar, 450); }).observe(document.body, { childList: true });
    setTimeout(measureBar, 300);
}
/** Demo workspace: starts from demo.json, edits are kept in this browser (localStorage). */
async function openDemo(url) {
    const KEY = 'nook:demo-files';
    let files = null;
    try {
        if (!/[?&#]reset\b/.test(location.href))
            files = JSON.parse(localStorage.getItem(KEY) || 'null');
    }
    catch {
        files = null;
    }
    if (!files)
        files = window.__NOOK_DEMO ?? await (await fetch(url)).json();
    const st = new MemoryStorage('Demo', files);
    const save = () => { try {
        localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(st.files)));
    }
    catch { /* full or blocked: stays in memory */ } };
    let t = 0;
    const later = () => { clearTimeout(t); t = window.setTimeout(save, 400); };
    for (const m of ['write', 'remove', 'move', 'writeBinary']) {
        const f = st[m]?.bind(st);
        if (f)
            st[m] = async (...a) => { const r = await f(...a); later(); return r; };
    }
    await openStorage(st);
}
//# sourceMappingURL=main.js.map