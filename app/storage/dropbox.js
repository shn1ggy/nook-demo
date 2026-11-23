import { openIdb, todayISO } from '../util.js';
import { autoMerge3 } from './merge.js';
function hosts() {
    try {
        const h = JSON.parse(localStorage.getItem('nook:dropbox-hosts') ?? 'null');
        if (h?.api)
            return h;
    }
    catch { /* default */ }
    return { api: 'https://api.dropboxapi.com', content: 'https://content.dropboxapi.com', notify: 'https://notify.dropboxapi.com', www: 'https://www.dropbox.com' };
}
/** the Dropbox app's key (not a secret): built in, or entered once on this device */
const BUILTIN_APP_KEY = 'vx2zfzygtxoj47e';
export function appKey() { try {
    return localStorage.getItem('nook:dropbox-key') || BUILTIN_APP_KEY;
}
catch {
    return BUILTIN_APP_KEY;
} }
export function setAppKey(k) { try {
    localStorage.setItem('nook:dropbox-key', k.trim());
}
catch { /* ignore */ } }
const TOKENS = 'nook:dropbox-tokens';
const loadTokens = () => { try {
    return JSON.parse(localStorage.getItem(TOKENS) ?? 'null');
}
catch {
    return null;
} };
const saveTokens = (t) => { try {
    if (t)
        localStorage.setItem(TOKENS, JSON.stringify(t));
    else
        localStorage.removeItem(TOKENS);
}
catch { /* ignore */ } };
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const redirectUri = () => location.origin + location.pathname;
export const dropboxConnected = () => !!loadTokens();
export function dropboxSignOut() { saveTokens(null); }
/** goes to Dropbox's login page; Dropbox comes back to this page with ?code=… */
export async function dropboxLogin() {
    const key = appKey();
    if (!key)
        throw new Error('No Dropbox app key');
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    sessionStorage.setItem('nook:dropbox-pkce', JSON.stringify({ verifier, state }));
    const q = new URLSearchParams({ client_id: key, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: redirectUri(), token_access_type: 'offline', state });
    location.assign(`${hosts().www}/oauth2/authorize?${q}`);
}
/** on start: if Dropbox just sent us back with a code, turn it into tokens (true = logged in now) */
export async function finishDropboxLogin() {
    const q = new URLSearchParams(location.search);
    const code = q.get('code');
    if (!code)
        return false;
    const saved = JSON.parse(sessionStorage.getItem('nook:dropbox-pkce') ?? 'null');
    // the address bar loses the code either way
    history.replaceState(null, '', location.pathname + location.hash);
    if (!saved || q.get('state') !== saved.state)
        throw new Error('The Dropbox login could not be finished – please try again.');
    sessionStorage.removeItem('nook:dropbox-pkce');
    const res = await fetch(`${hosts().api}/oauth2/token`, { method: 'POST', body: new URLSearchParams({ code, grant_type: 'authorization_code', code_verifier: saved.verifier, client_id: appKey(), redirect_uri: redirectUri() }) });
    if (!res.ok)
        throw new Error(`Dropbox did not accept the login (${res.status})`);
    const j = await res.json();
    const t = { access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000, account: j.account_id };
    saveTokens(t);
    try {
        const me = await rpc('/2/users/get_current_account', null);
        t.name = me.name?.display_name;
        saveTokens(t);
    }
    catch { /* the name is only shown */ }
    return true;
}
async function token() {
    const t = loadTokens();
    if (!t)
        throw new Error('Not connected to Dropbox');
    if (Date.now() < t.expires)
        return t.access;
    const res = await fetch(`${hosts().api}/oauth2/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: appKey() }) });
    if (!res.ok) {
        if (res.status === 400 || res.status === 401)
            saveTokens(null);
        throw new Error('The Dropbox login has expired – connect again');
    }
    const j = await res.json();
    t.access = j.access_token;
    t.expires = Date.now() + (j.expires_in - 60) * 1000;
    saveTokens(t);
    return t.access;
}
// ---------- API calls ----------
class DropboxError extends Error {
    status;
    summary;
    constructor(msg, status, summary = '') {
        super(msg);
        this.status = status;
        this.summary = summary;
    }
}
/** Dropbox-API-Arg must be plain ASCII */
const argHeader = (arg) => JSON.stringify(arg).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
/** requests under way: cut off when the app comes back after a while (they may hang after a pause) */
const abortAll = new Set();
let hiddenAt = 0;
if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            hiddenAt = Date.now();
            return;
        }
        if (hiddenAt && Date.now() - hiddenAt > 10_000)
            for (const c of abortAll)
                c.abort();
        hiddenAt = 0;
    });
async function call(url, init, auth = true) {
    for (let attempt = 0;; attempt++) {
        const headers = new Headers(init.headers);
        if (auth)
            headers.set('Authorization', `Bearer ${await token()}`);
        let res;
        // a time limit: on the iPhone a request can hang for good (the app paused in the background, the network
        // switched) – Saving would wait forever; cut off, the change stays queued and goes again
        const size = init.body instanceof Blob ? init.body.size : typeof init.body === 'string' ? init.body.length : 0;
        // confirming a batch of saves can take Dropbox minutes – it gets that long
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), (/finish_batch/.test(url) ? 300_000 : 30_000) + size / 50);
        abortAll.add(ctl);
        try {
            res = await fetch(url, { ...init, headers, signal: ctl.signal });
        }
        catch (e) {
            clearTimeout(timer);
            abortAll.delete(ctl);
            if (attempt >= 3)
                throw new Error(`No connection to Dropbox (${e.message})`);
            await new Promise((ok) => setTimeout(ok, 400 * (attempt + 1)));
            continue;
        }
        clearTimeout(timer);
        abortAll.delete(ctl);
        if (res.status === 401 && auth && attempt === 0) {
            const t = loadTokens();
            if (t) {
                t.expires = 0;
                saveTokens(t);
            }
            continue;
        }
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
            const wait = Number(res.headers.get('retry-after')) || attempt + 1;
            await new Promise((ok) => setTimeout(ok, wait * 1000));
            continue;
        }
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            let summary = text;
            try {
                summary = JSON.parse(text).error_summary ?? text;
            }
            catch { /* plain text */ }
            throw new DropboxError(`Dropbox: ${summary || res.status}`, res.status, summary);
        }
        return res;
    }
}
async function rpc(endpoint, body) {
    const res = await call(`${hosts().api}${endpoint}`, body === null ? { method: 'POST' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
}
async function content(endpoint, arg, body) {
    return call(`${hosts().content}${endpoint}`, { method: 'POST', headers: { 'Dropbox-API-Arg': argHeader(arg), ...(body !== undefined ? { 'Content-Type': 'application/octet-stream' } : {}) }, body });
}
/** where fetchUrl lets Dropbox put what it fetched (removed right after reading) */
const FETCH_DIR = '.workspace/fetched';
const notFound = (e) => e instanceof DropboxError && e.status === 409 && /not_found/.test(e.summary);
/** the folders of a Dropbox folder (for choosing the workspace); `isWorkspace`: it holds a Nook workspace */
export async function dropboxFolders(path) {
    const out = [];
    let r = await rpc('/2/files/list_folder', { path, recursive: false, limit: 2000 });
    out.push(...r.entries);
    while (r.has_more) {
        r = await rpc('/2/files/list_folder/continue', { cursor: r.cursor });
        out.push(...r.entries);
    }
    return out.filter((e) => e['.tag'] === 'folder' && !e.name.startsWith('.')).map((e) => ({ name: e.name, path: e.path_display ?? e.path_lower ?? '' })).sort((a, b) => a.name.localeCompare(b.name));
}
export async function dropboxCreateFolder(path) {
    await rpc('/2/files/create_folder_v2', { path, autorename: false });
}
export async function dropboxIsWorkspace(path) {
    try {
        await rpc('/2/files/get_metadata', { path: `${path}/.workspace/workspace.json` });
        return true;
    }
    catch (e) {
        if (notFound(e))
            return false;
        throw e;
    }
}
const idb = () => openIdb('nook-dropbox', 3, ['files', 'meta', 'outbox', 'assets', 'assetuse'], ['snap']);
const req = (r) => new Promise((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
const done_ = (t) => new Promise((ok, fail) => { t.oncomplete = () => ok(); t.onerror = () => fail(t.error); t.onabort = () => fail(t.error); });
const range = (prefix) => IDBKeyRange.bound(prefix + '\u0000', prefix + '\u0000￿');
const TEXT = /\.(md|json)$/i;
/** folders whose text files Nook reads when it opens (assets stay in Dropbox until they are shown) */
// every text file of the workspace except history, trash, put-aside files and pictures' folder; pages and
// databases can sit in any folder (the folders follow the sidebar)
const SKIP = /^(\.workspace\/(history|trash|unused-files|fetched)\/|assets\/|unused files\/)/i;
const inTree = (rel) => TEXT.test(rel) && !SKIP.test(rel) && (!rel.startsWith('.workspace/') || !rel.slice(11).includes('/') || rel.startsWith('.workspace/comments/'));
/** other files that belong to the workspace's content (pictures, PDFs next to pages …): only their names are kept */
const isFile = (rel) => !TEXT.test(rel) && !rel.startsWith('.workspace/') && !rel.endsWith('.nook-tmp');
const under = (path, dir) => path === dir || path.startsWith(dir + '/');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** files up to this size are kept in the browser once shown */
const ASSET_CACHE_MAX = 25 * 1024 * 1024;
// ---------- how much this browser keeps ----------
/** the limit for files kept after they were shown, in MB (0: no limit); per device */
export function assetLimitMB() { try {
    const v = localStorage.getItem('nook:asset-limit');
    return v == null ? 300 : Number(v) || 0;
}
catch {
    return 300;
} }
export function setAssetLimitMB(mb) { try {
    localStorage.setItem('nook:asset-limit', String(mb));
}
catch { /* ignore */ } void trimAssets(); }
function markUsed(key) { void (async () => { try {
    const t = (await idb()).transaction('assetuse', 'readwrite');
    t.objectStore('assetuse').put(Date.now(), key);
    await done_(t);
}
catch { /* only for tidying */ } })(); }
/** what this browser holds: the workspace text and the kept files */
export async function deviceStorage() {
    const db = await idb();
    let textBytes = 0, fileBytes = 0, files = 0;
    await new Promise((ok) => { const c = db.transaction('files').objectStore('files').openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur)
        return ok(); const v = cur.value; textBytes += (Array.isArray(v) ? v[0] : String(v)).length; cur.continue(); }; c.onerror = () => ok(); });
    await new Promise((ok) => { const c = db.transaction('assets').objectStore('assets').openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur)
        return ok(); fileBytes += cur.value?.size ?? 0; files++; cur.continue(); }; c.onerror = () => ok(); });
    return { textBytes, fileBytes, files };
}
export async function clearAssets() {
    const db = await idb();
    const t = db.transaction(['assets', 'assetuse'], 'readwrite');
    t.objectStore('assets').clear();
    t.objectStore('assetuse').clear();
    await done_(t);
}
/** over the limit: the files not shown for the longest time go (Dropbox still has them) */
async function trimAssets() {
    const limit = assetLimitMB() * 1024 * 1024;
    if (!limit)
        return;
    try {
        const db = await idb();
        const list = [];
        await new Promise((ok) => { const c = db.transaction('assets').objectStore('assets').openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur)
            return ok(); list.push({ k: cur.key, size: cur.value?.size ?? 0 }); cur.continue(); }; c.onerror = () => ok(); });
        let total = list.reduce((a, x) => a + x.size, 0);
        if (total <= limit)
            return;
        const used = new Map();
        await new Promise((ok) => { const c = db.transaction('assetuse').objectStore('assetuse').openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur)
            return ok(); used.set(String(cur.key), Number(cur.value)); cur.continue(); }; c.onerror = () => ok(); });
        list.sort((a, b) => (used.get(String(a.k)) ?? 0) - (used.get(String(b.k)) ?? 0));
        const t = db.transaction(['assets', 'assetuse'], 'readwrite');
        for (const x of list) {
            if (total <= limit * 0.9)
                break;
            t.objectStore('assets').delete(x.k);
            t.objectStore('assetuse').delete(x.k);
            total -= x.size;
        }
        await done_(t);
    }
    catch { /* only for tidying */ }
}
export class DropboxStorage {
    base;
    writable = true;
    /** text files of the workspace: relative path → text and Dropbox's version of it */
    files = null;
    /** other files read or written this session (history, trash …): their text (if text) and version */
    other = new Map();
    cursor = null;
    /** the version of each file the app last read: a save is checked against it, so a text read before a sync can't overwrite newer changes */
    served = new Map();
    /** names of the workspace's other files (pictures, PDFs …), for the folders' contents */
    bins = new Set();
    syncing = null;
    lastSync = 0;
    dirty = new Set();
    persistTimer;
    /** changes waiting to go to Dropbox, in order */
    ops = [];
    pumping = null;
    /** changes being sent right now (not to be merged with newer ones) */
    inflight = new Set();
    outboxLoaded = null;
    offline = false;
    lastError;
    changeListeners = new Set();
    statusListeners = new Set();
    urls = new Map();
    /** `base`: the folder in Dropbox, e.g. "/05 Nook" */
    constructor(base) {
        this.base = base;
        // closing the tab or switching apps (phone): what hasn't gone out yet is kept for next time
        if (typeof window !== 'undefined') {
            const keep = () => { if (this.ops.length)
                this.saveOutbox(true); void this.persist(); };
            window.addEventListener('pagehide', keep);
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden')
                keep(); });
            this.joinTabs();
        }
    }
    // ---------- several tabs of Nook on this computer ----------
    // Each tab keeps its own list of waiting saves (one tab can't overwrite another's); a tab that was closed
    // with saves still waiting is taken over by the next one. Saves go out one tab at a time, and what one tab
    // saved shows up in the others right away (not only after the round trip through Dropbox).
    tabId = Math.random().toString(36).slice(2, 10);
    channel = null;
    tabsReady = false;
    joinTabs() {
        const locks = navigator.locks;
        if (!locks)
            return;
        void locks.request(`nook-tab:${this.tabId}`, () => new Promise(() => { }));
        this.tabsReady = true;
        if (typeof BroadcastChannel === 'undefined')
            return;
        this.channel = new BroadcastChannel(`nook:${this.snapKey()}`);
        let queued = false;
        const changed = () => { if (queued)
            return; queued = true; queueMicrotask(() => { queued = false; this.changeListeners.forEach((f) => f()); }); };
        this.channel.onmessage = (e) => {
            const m = e.data;
            if (!m?.path || this.pendingFor(m.path))
                return;
            if (m.t === 'w') {
                if (this.files && inTree(m.path)) {
                    if (this.files.get(m.path)?.rev === m.rev)
                        return;
                    this.files.set(m.path, { text: m.text, rev: m.rev });
                    this.touch(m.path);
                }
                else
                    this.other.set(m.path, { text: m.text, rev: m.rev });
            }
            else {
                if (this.files?.delete(m.path))
                    this.touch(m.path);
                this.other.delete(m.path);
            }
            changed();
        };
    }
    tell(m) { try {
        this.channel?.postMessage(m);
    }
    catch { /* only a shortcut */ } }
    outboxKey() { return this.tabsReady ? `${this.snapKey()}#${this.tabId}` : this.snapKey(); }
    /** waiting saves of this tab, plus those of tabs that are closed now */
    async orphanOutboxes() {
        const locks = navigator.locks;
        const store = (await idb()).transaction('outbox').objectStore('outbox');
        const keys = (await req(store.getAllKeys()));
        const live = new Set(((locks ? (await locks.query()).held : []) ?? []).map((l) => l.name));
        const base = this.snapKey();
        const mine = keys.filter((k) => k === base || (k.startsWith(base + '#') && (k === this.outboxKey() || !live.has(`nook-tab:${k.slice(base.length + 1)}`))));
        const out = [];
        for (const key of mine) {
            const ops = await req((await idb()).transaction('outbox').objectStore('outbox').get(key));
            if (ops?.length || key !== this.outboxKey())
                out.push({ key, ops: ops ?? [] });
        }
        return out;
    }
    get label() { return this.base.split('/').filter(Boolean).pop() ?? 'Dropbox'; }
    /** a path inside the workspace folder – never above it, whatever a file's content asks for */
    abs(rel) { const r = rel.split('/').filter((x) => x && x !== '.' && x !== '..').join('/'); return r ? `${this.base}/${r}` : this.base; }
    rel(path) { const b = this.base.toLowerCase(); const p = path.toLowerCase(); return p === b ? '' : p.startsWith(b + '/') ? path.slice(this.base.length + 1) : null; }
    snapKey() { return `${loadTokens()?.account ?? ''}:${this.base.toLowerCase()}`; }
    // ---------- the local copy ----------
    touch(rel) { this.dirty.add(rel); this.persistSoon(); }
    persistSoon(delay = 800) { clearTimeout(this.persistTimer); this.persistTimer = setTimeout(() => void this.persist(), delay); }
    async persist() {
        if (!this.files || !this.cursor)
            return;
        const key = this.snapKey();
        const changed = [...this.dirty];
        this.dirty.clear();
        try {
            const t = (await idb()).transaction(['files', 'meta'], 'readwrite');
            const fs = t.objectStore('files');
            for (const rel of changed) {
                const v = this.files.get(rel);
                if (v)
                    fs.put([v.text, v.rev], `${key}\u0000${rel}`);
                else
                    fs.delete(`${key}\u0000${rel}`);
            }
            t.objectStore('meta').put({ cursor: this.cursor, bins: [...this.bins] }, key);
            await done_(t);
        }
        catch { /* the copy is only for speed */ }
    }
    async loadCopy() {
        try {
            const db = await idb();
            const key = this.snapKey();
            const t = db.transaction(['files', 'meta']);
            const [meta, keys, vals] = await Promise.all([req(t.objectStore('meta').get(key)), req(t.objectStore('files').getAllKeys(range(key))), req(t.objectStore('files').getAll(range(key)))]);
            if (!meta?.cursor)
                return false;
            const files = new Map();
            keys.forEach((k, i) => { const [text, rev] = vals[i]; files.set(String(k).slice(key.length + 1), { text, rev }); });
            this.files = files;
            this.cursor = meta.cursor;
            this.bins = new Set(Array.isArray(meta.bins) ? meta.bins : []);
            if (!Array.isArray(meta.bins))
                return false; // a copy from before the folders followed the sidebar: load again
            return true;
        }
        catch {
            return false;
        }
    }
    async replaceCopy() {
        try {
            const key = this.snapKey();
            const t = (await idb()).transaction(['files', 'meta'], 'readwrite');
            const fs = t.objectStore('files');
            fs.delete(range(key));
            for (const [rel, v] of this.files)
                fs.put([v.text, v.rev], `${key}\u0000${rel}`);
            t.objectStore('meta').put({ cursor: this.cursor, bins: [...this.bins] }, key);
            await done_(t);
            this.dirty.clear();
        }
        catch { /* only for speed */ }
    }
    // ---------- reading from Dropbox ----------
    /** when the copy was last brought up to date (ms) */
    get lastChecked() { return this.lastSync; }
    /** throws the copy away and loads the whole workspace again (unsaved changes are sent first) */
    async reloadAll() {
        await this.flush();
        await this.syncing?.catch(() => { });
        this.files = null;
        this.cursor = null;
        await this.loadAll();
        this.lastSync = Date.now();
        this.changeListeners.forEach((f) => f());
    }
    /** brings the copy up to date: everything the first time, afterwards only what changed; resolves with the number of files changed elsewhere */
    sync() {
        if (!this.syncing)
            this.syncing = this.doSync().then((n) => { this.freshDone?.(); return n; }).finally(() => { this.syncing = null; this.lastSync = Date.now(); });
        return this.syncing;
    }
    freshDone = null;
    fresh = new Promise((ok) => { this.freshDone = ok; });
    whenFresh() { return this.fresh; }
    async doSync() {
        await this.loadOutbox();
        if (!this.files)
            await this.loadCopy();
        if (this.files && this.cursor) {
            try {
                let n = await this.applyChanges();
                // now and then the whole list is compared too: whatever the changes missed (files removed elsewhere) is put right
                if (Date.now() - this.lastReconcile > 10 * 60_000) {
                    this.lastReconcile = Date.now();
                    n += await this.reconcile().catch(() => 0);
                }
                if (n)
                    this.changeListeners.forEach((f) => f());
                return n;
            }
            catch (e) {
                if (!(e instanceof DropboxError && e.status === 409))
                    throw e; /* cursor too old: load everything again */
            }
        }
        await this.loadAll();
        return 0;
    }
    /** first load: the text folders as zips, versions and the cursor from one listing */
    /** how the first download is going (for the start screen): what it does, parts done of all, MB so far */
    onProgress = null;
    /**
     * The first load: one listing (versions, cursor), then the text folders as zips – one per database, so
     * it shows progress and can go on where it stopped: every finished part is kept in the browser at once.
     * If the phone locks or the tab is closed, the next start continues instead of beginning again.
     */
    async loadAll() {
        const key = this.snapKey();
        const partKey = `${key}\u0001partial`;
        let bytes = 0;
        const report = (step, done, total) => this.onProgress?.({ step, done, total, mb: Math.round(bytes / 1e5) / 10 });
        // the screen stays on while this runs (where the browser allows it)
        let wake = null;
        try {
            wake = await navigator.wakeLock?.request('screen') ?? null;
        }
        catch { /* not allowed */ }
        try {
            await navigator.storage?.persist?.();
        }
        catch { /* best effort */ }
        try {
            // an earlier start that didn't finish: its listing and the parts it got
            let part = null;
            try {
                part = await req((await idb()).transaction('meta').objectStore('meta').get(partKey)) ?? null;
            }
            catch { /* none */ }
            const files = new Map();
            let revs, names, cursor;
            let bins = new Map();
            const done = new Set(part?.done ?? []);
            if (part) {
                revs = new Map(part.revs);
                names = new Map(part.names);
                cursor = part.cursor;
                bins = new Map(part.bins ?? []);
                try {
                    const t = (await idb()).transaction('files');
                    const [keys, vals] = await Promise.all([req(t.objectStore('files').getAllKeys(range(key))), req(t.objectStore('files').getAll(range(key)))]);
                    keys.forEach((k, i) => { const [text, rev] = vals[i]; files.set(String(k).slice(key.length + 1), { text, rev }); });
                }
                catch {
                    done.clear();
                }
            }
            else {
                revs = new Map();
                names = new Map();
                let n = 0;
                report('Listing the files', 0, 0);
                let r = await rpc('/2/files/list_folder', { path: this.base, recursive: true, limit: 2000 });
                const take = (es) => { for (const e of es)
                    if (e['.tag'] === 'file') {
                        n++;
                        const rel = this.rel(e.path_display ?? e.path_lower ?? '');
                        if (rel && inTree(rel)) {
                            revs.set(rel.toLowerCase(), e.rev ?? '');
                            names.set(rel.toLowerCase(), rel);
                        }
                        else if (rel && isFile(rel))
                            bins.set(rel, e.size ?? 0);
                    } };
                take(r.entries);
                while (r.has_more) {
                    report(`Listing the files (${n.toLocaleString()})`, 0, 0);
                    r = await rpc('/2/files/list_folder/continue', { cursor: r.cursor });
                    take(r.entries);
                }
                cursor = r.cursor;
                try {
                    const t = (await idb()).transaction(['meta', 'files'], 'readwrite');
                    t.objectStore('files').delete(range(key));
                    t.objectStore('meta').put({ cursor, revs: [...revs], names: [...names], done: [], bins: [...bins] }, partKey);
                    await done_(t);
                }
                catch { /* not kept: no resume */ }
            }
            // a finished part is kept right away
            const keep = async (unit, got) => {
                for (const [k, v] of got)
                    files.set(k, v);
                done.add(unit);
                try {
                    const t = (await idb()).transaction(['meta', 'files'], 'readwrite');
                    for (const [k, v] of got)
                        t.objectStore('files').put([v.text, v.rev], `${key}\u0000${k}`);
                    t.objectStore('meta').put({ cursor, revs: [...revs], names: [...names], done: [...done], bins: [...bins] }, partKey);
                    await done_(t);
                }
                catch { /* kept in memory only */ }
            };
            const { readZip } = await import('../importer/notion.js');
            const dec = new TextDecoder();
            const fetchCounted = async (res) => {
                if (!res.body) {
                    const b = await res.arrayBuffer();
                    bytes += b.byteLength;
                    return b;
                }
                const reader = res.body.getReader();
                const chunks = [];
                let len = 0;
                for (;;) {
                    const { done: end, value } = await reader.read();
                    if (end)
                        break;
                    chunks.push(value);
                    len += value.length;
                    bytes += value.length;
                }
                const out = new Uint8Array(len);
                let o = 0;
                for (const c of chunks) {
                    out.set(c, o);
                    o += c.length;
                }
                return out.buffer;
            };
            const one = async (rel, into) => {
                try {
                    into.set(rel, { text: dec.decode(await fetchCounted(await content('/2/files/download', { path: this.abs(rel) }))), rev: revs.get(rel.toLowerCase()) ?? '' });
                }
                catch (e) {
                    if (!notFound(e))
                        throw e;
                }
            };
            const zipInto = async (dir, into) => {
                let buf;
                try {
                    buf = await fetchCounted(await content('/2/files/download_zip', { path: this.abs(dir) }));
                }
                catch (e) {
                    if (notFound(e))
                        return;
                    if (!(e instanceof DropboxError && /too_many_files|too_large/.test(e.summary)))
                        throw e;
                    // Dropbox zips at most 10,000 files: a bigger folder goes in parts (its sub-folders)
                    const low = dir.toLowerCase() + '/';
                    const subs = new Set();
                    const direct = [];
                    for (const [k, rel] of names)
                        if (k.startsWith(low)) {
                            const rest = rel.slice(low.length);
                            if (rest.includes('/'))
                                subs.add(`${dir}/${rest.split('/')[0]}`);
                            else
                                direct.push(rel);
                        }
                    for (const d of direct)
                        await one(d, into);
                    for (const sub of subs)
                        await zipInto(sub, into);
                    return;
                }
                for (const [name, data] of await readZip(buf)) {
                    // the zip's paths start with the folder's own name; the listing has the exact spelling
                    const raw = `${dir}/${name.split('/').slice(1).join('/')}`;
                    const rel = names.get(raw.toLowerCase()) ?? raw;
                    if (inTree(rel))
                        into.set(rel, { text: dec.decode(data), rev: revs.get(rel.toLowerCase()) ?? '' });
                }
            };
            // the parts: the settings files, then folder by folder – a folder as one zip unless it holds big other
            // files (pictures next to pages): then its text files one by one and its sub-folders on their own
            const units = [];
            const texts = [...names.values()];
            const ws = texts.filter((r) => r.startsWith('.workspace/'));
            if (ws.length)
                units.push({ id: '.workspace', label: 'Settings', run: async (into) => { await Promise.all(ws.map((r) => one(r, into))); } });
            // without case: Dropbox can report one folder as "pages" for some files and "Pages" for others
            const binsLower = [...bins].map(([b, sz]) => [b.toLowerCase(), sz]);
            const binSize = (dir) => { const d = dir.toLowerCase(); let n = 0; for (const [b, sz] of binsLower)
                if (b === d || b.startsWith(d + '/'))
                    n += sz; return n; };
            const ones = (list, id, label) => units.push({ id, label, run: async (into) => { let i = 0; const w = async () => { while (i < list.length)
                    await one(list[i++], into); }; await Promise.all([w(), w(), w(), w(), w(), w()]); } });
            const plan = (dir) => {
                const pre = dir ? dir + '/' : '';
                const preL = pre.toLowerCase();
                const mine = texts.filter((r) => !r.startsWith('.workspace/') && r.toLowerCase().startsWith(preL));
                if (!mine.length)
                    return;
                if (dir && binSize(dir) < 3e6) {
                    units.push({ id: dir, label: dir.split('/').pop(), run: (into) => zipInto(dir, into) });
                    return;
                }
                const direct = mine.filter((r) => !r.slice(pre.length).includes('/'));
                if (direct.length)
                    ones(direct, `${pre}*`, dir.split('/').pop() || 'Pages');
                const subs = new Map();
                for (const r of mine)
                    if (r.slice(pre.length).includes('/')) {
                        const sub = pre + r.slice(pre.length).split('/')[0];
                        if (!subs.has(sub.toLowerCase()))
                            subs.set(sub.toLowerCase(), sub);
                    }
                for (const sub of subs.values())
                    plan(sub);
            };
            plan('');
            const todo = units.filter((u) => !done.has(u.id));
            let finished = units.length - todo.length;
            report('Downloading', finished, units.length);
            // a few at a time
            let next = 0;
            const worker = async () => {
                while (next < todo.length) {
                    const u = todo[next++];
                    const got = new Map();
                    await u.run(got);
                    await keep(u.id, got);
                    finished++;
                    report(`Downloading · ${u.label}`, finished, units.length);
                }
            };
            await Promise.all([worker(), worker(), worker(), worker()]);
            report('Saving', units.length, units.length);
            // what this device changed and hasn't sent yet stays
            for (const op of this.ops)
                if (op.kind === 'write' && typeof op.data === 'string' && inTree(op.path))
                    files.set(op.path, { text: op.data, rev: files.get(op.path)?.rev ?? '' });
            this.files = files;
            this.cursor = cursor;
            this.bins = new Set(bins.keys());
            await this.replaceCopy();
            try {
                const t = (await idb()).transaction('meta', 'readwrite');
                t.objectStore('meta').delete(partKey);
                await done_(t);
            }
            catch { /* ignore */ }
        }
        finally {
            void wake?.release().catch(() => { });
        }
    }
    lastReconcile = 0;
    /** the copy here against the full list in Dropbox: files gone there are dropped, files with another version fetched */
    async reconcile() {
        const files = this.files;
        const revs = new Map(), names = new Map(), bins = new Set(), binNames = new Map();
        let r = await rpc('/2/files/list_folder', { path: this.base, recursive: true, limit: 2000 });
        const take = (es) => { for (const e of es)
            if (e['.tag'] === 'file') {
                const rel = this.rel(e.path_display ?? e.path_lower ?? '');
                if (!rel)
                    continue;
                if (inTree(rel)) {
                    revs.set(rel.toLowerCase(), e.rev ?? '');
                    names.set(rel.toLowerCase(), rel);
                }
                else if (isFile(rel)) {
                    bins.add(rel.toLowerCase());
                    binNames.set(rel.toLowerCase(), rel);
                }
            } };
        take(r.entries);
        while (r.has_more) {
            r = await rpc('/2/files/list_folder/continue', { cursor: r.cursor });
            take(r.entries);
        }
        let n = 0;
        const fetch = [];
        for (const [k, v] of [...files]) {
            if (this.pendingFor(k))
                continue;
            const rev = revs.get(k.toLowerCase());
            if (rev === undefined) {
                files.delete(k);
                this.touch(k);
                n++;
            }
            else if (rev !== v.rev)
                fetch.push({ rel: k, rev });
        }
        // and files that are there but not here
        const here = new Set([...files.keys()].map((k) => k.toLowerCase()));
        for (const [low, rev] of revs)
            if (!here.has(low) && !this.pendingFor(names.get(low)))
                fetch.push({ rel: names.get(low), rev });
        for (const b of [...this.bins])
            if (!bins.has(b.toLowerCase()) && !this.pendingFor(b)) {
                this.bins.delete(b);
                n++;
                this.persistSoon();
            }
        const haveBins = new Set([...this.bins].map((b) => b.toLowerCase()));
        for (const [low, b] of binNames)
            if (!haveBins.has(low)) {
                this.bins.add(b);
                n++;
                this.persistSoon();
            }
        for (let i = 0; i < fetch.length; i += 8) {
            await Promise.all(fetch.slice(i, i + 8).map(async (c) => {
                try {
                    const text = await (await content('/2/files/download', { path: this.abs(c.rel) })).text();
                    if (this.pendingFor(c.rel))
                        return;
                    files.set(c.rel, { text, rev: c.rev });
                    this.touch(c.rel);
                    n++;
                }
                catch (e) {
                    if (!notFound(e))
                        throw e;
                }
            }));
        }
        return n;
    }
    /** what changed since the cursor: changed text files are fetched again, deleted ones dropped */
    async applyChanges() {
        const files = this.files;
        // a lower-case index only when Dropbox spells a name differently (rare)
        let idxMap = null;
        const idx = () => (idxMap ??= new Map([...files.keys()].map((k) => [k.toLowerCase(), k])));
        const changed = [];
        let removed = 0;
        let r = { entries: [], cursor: this.cursor, has_more: true };
        while (r.has_more) {
            r = await rpc('/2/files/list_folder/continue', { cursor: r.cursor });
            for (const e of r.entries) {
                const rel = this.rel(e.path_display ?? e.path_lower ?? '');
                if (!rel)
                    continue;
                if (rel === FETCH_DIR || rel.startsWith(FETCH_DIR + '/'))
                    continue; // fetchUrl's short-lived files are not workspace content
                const low = rel.toLowerCase();
                const key = files.has(rel) ? rel : idx().get(low) ?? rel;
                // this device's own change is newer than anything Dropbox reports
                if (this.pendingFor(key))
                    continue;
                if (e['.tag'] === 'deleted') {
                    if (this.bins.delete(rel) || [...this.bins].some((b) => under(b, rel))) {
                        for (const b of [...this.bins])
                            if (under(b, rel))
                                this.bins.delete(b);
                        removed++;
                        this.persistSoon();
                    }
                    if (files.has(key)) {
                        if (!this.pendingFor(key)) {
                            files.delete(key);
                            idxMap?.delete(low);
                            this.touch(key);
                            removed++;
                        }
                    }
                    else if (!TEXT.test(rel))
                        for (const [l, k] of idx())
                            if (l.startsWith(low + '/')) {
                                if (this.pendingFor(k))
                                    continue;
                                files.delete(k);
                                idx().delete(l);
                                this.touch(k);
                                removed++;
                            }
                    this.other.delete(key);
                    continue;
                }
                if (e['.tag'] === 'file') {
                    if (isFile(rel) && !this.bins.has(rel)) {
                        this.bins.add(rel);
                        removed++;
                        this.persistSoon();
                    }
                    const o = this.other.get(key);
                    if (o && o.rev !== e.rev)
                        this.other.delete(key);
                    if (inTree(rel) && files.get(key)?.rev !== e.rev)
                        changed.push({ rel: key, rev: e.rev ?? '' });
                }
            }
        }
        for (let i = 0; i < changed.length; i += 8) {
            await Promise.all(changed.slice(i, i + 8).map(async (c) => {
                try {
                    const text = await (await content('/2/files/download', { path: this.abs(c.rel) })).text();
                    if (this.pendingFor(c.rel))
                        return;
                    files.set(c.rel, { text, rev: c.rev });
                    this.touch(c.rel);
                }
                catch (e) {
                    if (!notFound(e))
                        throw e;
                }
            }));
        }
        if (r.cursor !== this.cursor) {
            this.cursor = r.cursor;
            this.persistSoon();
        }
        return changed.length + removed;
    }
    // ---------- writing: right away here, to Dropbox in the background ----------
    /** the newest change this device still has to send for a path (or a folder above it) */
    pendingFor(path) {
        for (let i = this.ops.length - 1; i >= 0; i--) {
            const op = this.ops[i];
            if (op.kind === 'moves' ? op.pairs.some(([a, b]) => under(path, a) || under(path, b)) : op.kind === 'move' ? (under(path, op.from) || under(path, op.to)) : under(path, op.path))
                return op;
        }
        return undefined;
    }
    async loadOutbox() {
        this.outboxLoaded ??= (async () => {
            try {
                const found = await this.orphanOutboxes();
                const saved = found.flatMap((f) => f.ops);
                // taken over: the other tabs' lists go, they are part of this one now
                const gone = found.filter((f) => f.key !== this.outboxKey());
                if (gone.length) {
                    const t = (await idb()).transaction('outbox', 'readwrite');
                    for (const f of gone)
                        t.objectStore('outbox').delete(f.key);
                    await done_(t);
                }
                if (saved.length) {
                    // saved changes first, then ones made since; one save per file (the newest), so nothing waits twice
                    const all = [...saved, ...this.ops], last = new Map();
                    all.forEach((o, i) => { if (o.kind === 'write')
                        last.set(o.path, i); });
                    this.ops = all.filter((o, i) => o.kind !== 'write' || last.get(o.path) === i);
                    this.saveOutbox();
                    this.kick();
                }
            }
            catch { /* nothing waiting */ }
        })();
        return this.outboxLoaded;
    }
    outboxTimer;
    saveOutbox(now = false) {
        clearTimeout(this.outboxTimer);
        const run = async () => { try {
            const t = (await idb()).transaction('outbox', 'readwrite');
            t.objectStore('outbox').put(this.ops.slice(), this.outboxKey());
            await done_(t);
        }
        catch { /* best effort */ } };
        if (now)
            void run();
        else
            this.outboxTimer = setTimeout(run, 150);
    }
    enqueue(op) {
        // a newer save of the same file replaces one that hasn't gone out yet
        if (op.kind === 'write') {
            const last = this.pendingFor(op.path);
            if (last?.kind === 'write' && last.path === op.path && !this.inflight.has(last)) {
                last.data = op.data;
                if (last.base === undefined)
                    last.base = op.base;
                if (last.rev === undefined)
                    last.rev = op.rev;
                this.saveOutbox();
                this.kick();
                return;
            }
        }
        this.ops.push(op);
        this.saveOutbox();
        this.kick();
    }
    kick() { this.status(); if (!this.pumping)
        this.pumping = this.oneTabAtATime(() => this.pump()).finally(() => { this.pumping = null; this.status(); if (this.ops.length)
            this.kick(); }); }
    /** saves go out from one tab at a time (two tabs sending the same file at once is what makes conflicts) */
    oneTabAtATime(run) {
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        return locks ? locks.request(`nook-send:${this.snapKey()}`, run) : run();
    }
    async pump() {
        let wait = 1000;
        let single = false;
        // how many saves go in one batch: smaller after a batch timed out, down to one at a time
        let most = 40;
        while (this.ops.length) {
            const head = this.ops[0];
            // a run of saves to different files goes as one batch (one commit in Dropbox)
            const batch = [];
            if (head.kind === 'write' && !single)
                for (const op of this.ops) {
                    if (op.kind !== 'write' || batch.length >= most || batch.some((b) => b.path === op.path))
                        break;
                    batch.push(op);
                }
            const sending = batch.length > 1 ? batch : [head];
            sending.forEach((o) => this.inflight.add(o));
            try {
                if (batch.length > 1)
                    await this.uploadBatch(batch);
                else if (head.kind === 'write')
                    await this.uploadOne(head.path, head.data, head.base, head.rev);
                else if (head.kind === 'remove') {
                    try {
                        await rpc('/2/files/delete_v2', { path: this.abs(head.path) });
                    }
                    catch (e) {
                        if (!notFound(e))
                            throw e;
                    }
                    this.tell({ t: 'r', path: head.path });
                }
                else if (head.kind === 'moves') {
                    // at most 1000 in one batch (Dropbox's limit); what is done comes off the list, so a stop goes on from there
                    const chunk = head.pairs.slice(0, 1000);
                    await this.moveChunk(chunk);
                    head.pairs = head.pairs.slice(chunk.length);
                    this.saveOutbox();
                    this.status();
                    if (head.pairs.length) {
                        this.offline = false;
                        this.lastError = undefined;
                        wait = 1000;
                        continue;
                    }
                }
                else {
                    try {
                        await rpc('/2/files/move_v2', { from_path: this.abs(head.from), to_path: this.abs(head.to), autorename: false });
                    }
                    catch (e) {
                        if (!notFound(e))
                            throw e;
                    }
                }
                this.ops = this.ops.filter((o) => !sending.includes(o));
                this.offline = false;
                this.lastError = undefined;
                wait = 1000;
                single = false;
                most = Math.min(40, most * 2);
                this.saveOutbox();
                this.status();
            }
            catch (e) {
                if (e instanceof DropboxError && e.status !== 401 && sending.length > 1) {
                    single = true;
                    continue;
                }
                if (e instanceof DropboxError && e.status !== 401) {
                    // Dropbox refused this change for good (a name it doesn't accept, say): say so and go on
                    this.lastError = `${e.message} (${head.kind === 'moves' ? `${head.pairs.length} moves` : head.kind === 'move' ? head.from : head.path})`;
                    this.ops = this.ops.filter((o) => o !== head);
                    this.saveOutbox();
                    this.status();
                    continue;
                }
                // no connection, or it took too long: smaller batches next time; keep everything and try again
                if (sending.length > 1)
                    most = Math.max(1, Math.floor(sending.length / 2));
                this.offline = true;
                this.lastError = e.message;
                this.status();
                await sleep(wait);
                wait = Math.min(wait * 2, 30_000);
            }
            finally {
                sending.forEach((o) => this.inflight.delete(o));
            }
        }
    }
    /** what waits to be saved, by folder (Settings → Dropbox) */
    pendingSummary() {
        const by = new Map();
        for (const o of this.ops) {
            const p = o.kind === 'moves' ? 'Moving files' : o.kind === 'move' ? o.from : o.path;
            const k = p.split('/').slice(0, p.startsWith('databases/') ? 2 : 1).join('/');
            by.set(k, (by.get(k) ?? 0) + (o.kind === 'moves' ? o.pairs.length : 1));
        }
        return [...by].sort((a, b) => b[1] - a[1]);
    }
    known(path) { return this.files?.get(path)?.rev || this.other.get(path)?.rev || ''; }
    /** where a file is after the moves still waiting (a save that went out before them lands there) */
    forward(path) {
        for (const op of this.ops) {
            if (op.kind === 'move' && under(path, op.from))
                path = op.to + path.slice(op.from.length);
            else if (op.kind === 'moves')
                for (const [a, b] of op.pairs)
                    if (under(path, a)) {
                        path = b + path.slice(a.length);
                        break;
                    }
        }
        return path;
    }
    sent(path, rev, data) {
        const to = this.forward(path);
        if (typeof data === 'string')
            this.tell({ t: 'w', path: to, rev, text: data });
        this.served.set(to, { rev, text: typeof data === 'string' ? data : undefined });
        if (to !== path) {
            const g = this.files?.get(to);
            if (g) {
                g.rev = rev;
                this.touch(to);
            }
            else {
                const o = this.other.get(to);
                if (o)
                    o.rev = rev;
            }
            return;
        }
        const f = this.files?.get(path);
        if (f) {
            f.rev = rev;
            this.touch(path);
        }
        else if (this.files && inTree(path) && typeof data === 'string') {
            this.files.set(path, { text: data, rev });
            this.touch(path);
        }
        else
            this.other.set(path, { text: typeof data === 'string' ? data : undefined, rev });
    }
    mode(path, opRev, text = false) {
        // a save waiting behind moves: the moved file's version is the one to check against
        const rev = opRev && this.forward(path) === path ? opRev : this.known(path);
        if (rev)
            return { '.tag': 'update', update: rev };
        // a text file Nook doesn't know a version of: only created, never written over unseen (a conflict is merged or kept as a copy)
        return text ? 'add' : 'overwrite';
    }
    /** texts this device sent for a file whose answer never came back (the connection dropped, the app was put away):
     *  Dropbox may have them – finding one there later is this device's own save, not someone else's change */
    attempted = new Map();
    attempt(path, data) {
        if (typeof data !== 'string')
            return;
        const a = this.attempted.get(path) ?? [];
        a.push(data);
        this.attempted.set(path, a.slice(-5));
    }
    async uploadOne(path, data, base, rev) {
        this.attempt(path, data);
        try {
            const meta = await (await content('/2/files/upload', { path: this.abs(path), mode: this.mode(path, rev, typeof data === 'string'), autorename: false, mute: true }, new Blob([data]))).json();
            this.sent(path, meta.rev ?? '', data);
            this.attempted.delete(path);
        }
        catch (e) {
            if (!(e instanceof DropboxError && e.status === 409 && /conflict/.test(e.summary)))
                throw e;
            await this.conflicted(path, data, base);
        }
    }
    async uploadBatch(batch) {
        const enc = new TextEncoder();
        const bodies = batch.map((op) => typeof op.data === 'string' ? enc.encode(op.data) : op.data);
        for (const op of batch)
            this.attempt(op.path, op.data);
        const sessions = new Array(batch.length);
        for (let i = 0; i < batch.length; i += 8) {
            await Promise.all(bodies.slice(i, i + 8).map(async (b, j) => {
                const r = await (await content('/2/files/upload_session/start', { close: true }, new Blob([b]))).json();
                sessions[i + j] = r.session_id;
            }));
        }
        const res = await rpc('/2/files/upload_session/finish_batch_v2', {
            entries: batch.map((op, i) => ({ cursor: { session_id: sessions[i], offset: bodies[i].length }, commit: { path: this.abs(op.path), mode: this.mode(op.path, op.rev, typeof op.data === 'string'), autorename: false, mute: true } })),
        });
        for (let i = 0; i < batch.length; i++) {
            const r = res.entries[i];
            if (r?.['.tag'] === 'success') {
                this.sent(batch[i].path, r.rev ?? '', batch[i].data);
                this.attempted.delete(batch[i].path);
                continue;
            }
            const f = r?.failure;
            if (f?.['.tag'] === 'path' && f.path?.['.tag'] === 'conflict')
                await this.conflicted(batch[i].path, batch[i].data, batch[i].base);
            else
                await this.uploadOne(batch[i].path, batch[i].data, batch[i].base, batch[i].rev);
        }
    }
    /** changed elsewhere in the meantime: this device's version goes next to it, the other one is loaded */
    async conflicted(path, data, base) {
        // first try to merge: bookkeeping and edit times are no reason for a copy (see merge.ts)
        if (typeof data === 'string') {
            try {
                const res = await content('/2/files/download', { path: this.abs(path) });
                const theirs = await res.text();
                let rev = '';
                try {
                    rev = JSON.parse(res.headers.get('Dropbox-API-Result') ?? '{}').rev ?? '';
                }
                catch { /* unknown */ }
                // nobody else changed it (its version number changed with a move, say): this device's version simply goes up
                // Dropbox has a text this device sent before without hearing back: its own save – this newer one simply goes on top
                const own = theirs === data || (this.attempted.get(path) ?? []).includes(theirs);
                const merged = !rev ? null : own ? data : base !== undefined && theirs === base ? data : autoMerge3(path, base, data, theirs);
                if (merged !== null) {
                    const meta = await (await content('/2/files/upload', { path: this.abs(path), mode: { '.tag': 'update', update: rev }, autorename: false, mute: true }, new Blob([merged]))).json();
                    this.sent(path, meta.rev ?? '', merged);
                    this.attempted.delete(path);
                    if (this.files && inTree(path) && merged !== data) {
                        this.files.set(path, { text: merged, rev: meta.rev ?? '' });
                        this.touch(path);
                        this.changeListeners.forEach((f) => f());
                    }
                    return;
                }
            }
            catch { /* changed again in the meantime, or gone: a copy as before */ }
        }
        const day = todayISO();
        const copy = path.replace(/(\.[a-z0-9]+)?$/i, (ext) => ` (Nook conflicted copy ${day})${ext}`);
        const meta = await (await content('/2/files/upload', { path: this.abs(copy), mode: 'overwrite', autorename: true, mute: true }, new Blob([data]))).json();
        const copyRel = this.rel(meta.path_display ?? '') ?? copy;
        if (typeof data === 'string' && this.files && inTree(copyRel)) {
            this.files.set(copyRel, { text: data, rev: meta.rev ?? '' });
            this.touch(copyRel);
        }
        try {
            const res = await content('/2/files/download', { path: this.abs(path) });
            const text = await res.text();
            let rev = '';
            try {
                rev = JSON.parse(res.headers.get('Dropbox-API-Result') ?? '{}').rev ?? '';
            }
            catch { /* unknown */ }
            if (this.files && inTree(path)) {
                this.files.set(path, { text, rev });
                this.touch(path);
            }
            else
                this.other.set(path, { text, rev });
        }
        catch { /* gone: the copy is kept */ }
        this.changeListeners.forEach((f) => f());
    }
    status() {
        const s = { pending: this.ops.length, offline: this.offline, error: this.lastError };
        this.statusListeners.forEach((f) => f(s));
    }
    /** saving state for the app (pending changes, offline) */
    onStatus(fn) { this.statusListeners.add(fn); fn({ pending: this.ops.length, offline: this.offline, error: this.lastError }); return () => this.statusListeners.delete(fn); }
    /** resolves once every change is in Dropbox */
    async flush() { await this.loadOutbox(); while (this.ops.length || this.pumping) {
        this.kick();
        await this.pumping;
    } }
    // ---------- Storage ----------
    async readTree(dirs, exts) {
        await this.loadOutbox();
        if (!this.files)
            await this.loadCopy();
        // with a copy here, it opens right away; what changed elsewhere comes a moment later
        if (this.files && this.cursor) {
            if (Date.now() - this.lastSync > 2000)
                void this.sync().catch(() => { });
        }
        else
            await this.sync();
        const ok = (k) => dirs.some((d) => !d || under(k, d)) && exts.some((x) => k.toLowerCase().endsWith('.' + x));
        return [...this.files].filter(([k]) => ok(k)).map(([k, v]) => { this.served.set(k, { rev: v.rev, text: v.text }); return [k, v.text]; });
    }
    async readAll(dir, ext) {
        const d = dir.replace(/\/+$/, '');
        if (inTree(`${d}/x.${ext}`)) {
            if (!this.files)
                await this.readTree([d], [ext]);
            return [...this.files].filter(([k]) => k.startsWith(d + '/') && !k.slice(d.length + 1).includes('/') && k.endsWith('.' + ext)).map(([k, v]) => { this.served.set(k, { rev: v.rev, text: v.text }); return [k.slice(d.length + 1), v.text]; });
        }
        const out = [];
        for (const e of await this.list(d))
            if (e.kind === 'file' && e.name.endsWith('.' + ext))
                out.push([e.name, await this.read(`${d}/${e.name}`)]);
        return out;
    }
    /** size and dates of every file below a folder: "created" is the file's own date (as on the computer it came from) */
    async fileInfo(dir) {
        const out = [];
        const take = (es) => { for (const e of es)
            if (e['.tag'] === 'file') {
                const rel = this.rel(e.path_display ?? e.path_lower ?? '');
                if (rel)
                    out.push({ path: rel, size: e.size ?? 0, created: e.client_modified, modified: e.server_modified });
            } };
        try {
            let r = await rpc('/2/files/list_folder', { path: this.abs(dir), recursive: true, limit: 2000 });
            take(r.entries);
            while (r.has_more) {
                r = await rpc('/2/files/list_folder/continue', { cursor: r.cursor });
                take(r.entries);
            }
        }
        catch (e) {
            if (!notFound(e))
                throw e;
        }
        return out;
    }
    async list(dir) {
        const d = dir.replace(/^\/+|\/+$/g, '');
        const out = new Map();
        try {
            let r = await rpc('/2/files/list_folder', { path: this.abs(d), recursive: false, limit: 2000 });
            const take = (es) => { for (const e of es)
                if (e['.tag'] !== 'deleted')
                    out.set(e.name, { name: e.name, kind: e['.tag'] === 'folder' ? 'dir' : 'file' }); };
            take(r.entries);
            while (r.has_more) {
                r = await rpc('/2/files/list_folder/continue', { cursor: r.cursor });
                take(r.entries);
            }
        }
        catch (e) {
            if (!notFound(e))
                throw e;
        }
        // with this device's changes that haven't gone out yet
        const child = (p) => { const rest = d ? (p.startsWith(d + '/') ? p.slice(d.length + 1) : null) : p; return rest == null ? null : rest.split('/'); };
        const add = (p) => { const c = child(p); if (c)
            out.set(c[0], { name: c[0], kind: c.length > 1 ? 'dir' : 'file' }); };
        const drop = (p) => { const c = child(p); if (c && c.length === 1)
            out.delete(c[0]); };
        for (const op of this.ops) {
            if (op.kind === 'write')
                add(op.path);
            else if (op.kind === 'remove')
                drop(op.path);
            else if (op.kind === 'moves')
                for (const [a, b] of op.pairs) {
                    drop(a);
                    add(b);
                }
            else {
                drop(op.from);
                add(op.to);
            }
        }
        return [...out.values()];
    }
    /**
     * The text behind a web address, fetched by Dropbox itself: Dropbox saves the address into a short-lived
     * file of the workspace, Nook reads that file and removes it again. A website cannot fetch from other
     * servers; Dropbox can – this is how calendar links work on the hosted site without any server of your own.
     */
    async fetchUrl(url) {
        let h = 0;
        for (let i = 0; i < url.length; i++)
            h = (h * 31 + url.charCodeAt(i)) | 0;
        const path = `${this.abs(FETCH_DIR)}/fetch-${(h >>> 0).toString(36)}-${Date.now().toString(36)}.txt`;
        const failed = (why) => new Error(/not_found|download_failed|invalid_url/.test(why) ? 'The address could not be fetched (not found, or it needs a login).' : `Dropbox could not fetch the address (${why || 'unknown reason'}).`);
        let r;
        let job = '';
        try {
            r = await rpc('/2/files/save_url', { path, url });
        }
        catch (e) {
            throw failed(e instanceof DropboxError ? e.summary : e.message);
        }
        for (let i = 0; r['.tag'] !== 'complete'; i++) {
            if (r['.tag'] === 'failed')
                throw failed(JSON.stringify(r));
            if (i > 60)
                throw new Error('Dropbox took too long to fetch the address.');
            await new Promise((ok) => setTimeout(ok, i < 5 ? 500 : 1500));
            job = r.async_job_id ?? job;
            r = await rpc('/2/files/save_url/check_job_status', { async_job_id: job });
        }
        try {
            return await (await content('/2/files/download', { path })).text();
        }
        finally {
            void rpc('/2/files/delete_v2', { path }).catch(() => { });
        }
    }
    async read(path) {
        const op = this.pendingFor(path);
        if (op?.kind === 'write' && op.path === path)
            return typeof op.data === 'string' ? op.data : new TextDecoder().decode(op.data);
        if (op?.kind === 'remove' || (op?.kind === 'move' && under(path, op.from)) || (op?.kind === 'moves' && op.pairs.some(([a]) => under(path, a))))
            throw new Error(`Not found: ${path}`);
        const hit = this.files?.get(path) ?? this.other.get(path);
        if (hit?.text != null) {
            if (!op)
                this.served.set(path, { rev: hit.rev, text: hit.text });
            return hit.text;
        }
        if (this.files && this.cursor && inTree(path))
            throw new Error(`Not found: ${path}`);
        try {
            const res = await content('/2/files/download', { path: this.abs(path) });
            const text = await res.text();
            let rev = '';
            try {
                rev = JSON.parse(res.headers.get('Dropbox-API-Result') ?? '{}').rev ?? '';
            }
            catch { /* unknown */ }
            if (!this.pendingFor(path)) {
                this.other.set(path, { text, rev });
                this.served.set(path, { rev, text });
            }
            return text;
        }
        catch (e) {
            if (notFound(e))
                throw new Error(`Not found: ${path}`);
            throw e;
        }
    }
    async write(path, data) {
        const known = this.files?.get(path) ?? this.other.get(path);
        // checked against what the app read – not against a newer version a sync brought in meanwhile
        const seen = this.served.get(path);
        // a save of this file from this device is still on its way: this one builds on it, so it is checked against
        // the version that save produces (not the older one both started from – that made Nook conflict with itself)
        const ownAhead = this.ops.some((o) => o.kind === 'write' && o.path === path);
        const rev = ownAhead ? undefined : seen ? seen.rev : known?.rev;
        const base = ownAhead ? seen?.text : seen ? (seen.rev ? seen.text : undefined) : known?.rev ? known.text : undefined;
        this.served.set(path, { rev: rev ?? '', text: data });
        if (this.files && inTree(path)) {
            this.files.set(path, { text: data, rev: this.files.get(path)?.rev ?? '' });
            this.touch(path);
        }
        else {
            const o = this.other.get(path);
            this.other.set(path, { text: data, rev: o?.rev ?? '' });
        }
        this.enqueue({ kind: 'write', path, data, base, rev });
    }
    async writeBinary(path, data) {
        this.urls.delete(path);
        if (isFile(path)) {
            this.bins.add(path);
            this.persistSoon();
        }
        void this.cacheAsset(path, new Blob([data]));
        this.enqueue({ kind: 'write', path, data });
    }
    async remove(path) {
        if (this.files)
            for (const k of [...this.files.keys()])
                if (under(k, path)) {
                    this.files.delete(k);
                    this.touch(k);
                }
        for (const k of [...this.other.keys()])
            if (under(k, path))
                this.other.delete(k);
        for (const b of [...this.bins])
            if (under(b, path))
                this.bins.delete(b);
        this.persistSoon();
        this.forgetAsset(path);
        this.enqueue({ kind: 'remove', path });
    }
    async move(from, to) { this.moveLocal(from, to); this.enqueue({ kind: 'move', from, to }); }
    /** many files or folders at once (one batch in Dropbox): when the folders are arranged like the sidebar */
    async moveMany(pairs) {
        if (!pairs.length)
            return;
        for (const [a, b] of pairs)
            this.moveLocal(a, b);
        for (let i = 0; i < pairs.length; i += 1000)
            this.enqueue({ kind: 'moves', pairs: pairs.slice(i, i + 1000) });
    }
    movesFolders = true;
    remote = true;
    /** every file of the workspace's content: text files and the others (pictures …) */
    async listAll() {
        if (!this.files)
            await this.readTree([''], ['md']);
        return [...new Set([...this.files.keys(), ...this.bins, ...this.ops.flatMap((o) => (o.kind === 'write' ? [o.path] : []))])];
    }
    /** one batch of moves; refused as a whole: one by one (a file that is gone or already there is skipped) */
    async moveChunk(pairs) {
        try {
            await this.moveBatch(pairs);
            return;
        }
        catch (e) {
            if (!(e instanceof DropboxError) || e.status === 401)
                throw e;
        }
        for (const [a, b] of pairs) {
            try {
                await rpc('/2/files/move_v2', { from_path: this.abs(a), to_path: this.abs(b), autorename: false });
            }
            catch (e) {
                if (!(e instanceof DropboxError && e.status === 409))
                    throw e;
            }
        }
    }
    async moveBatch(pairs) {
        let r = await rpc('/2/files/move_batch_v2', { entries: pairs.map(([a, b]) => ({ from_path: this.abs(a), to_path: this.abs(b) })), autorename: false });
        const job = r.async_job_id;
        for (let i = 0; r['.tag'] === 'async_job_id' || r['.tag'] === 'in_progress'; i++) {
            await sleep(Math.min(500 * (i + 1), 3000));
            r = await rpc('/2/files/move_batch/check_v2', { async_job_id: job });
        }
        if (r['.tag'] === 'failed')
            throw new DropboxError('Dropbox could not move the files', 409, JSON.stringify(r).slice(0, 200));
    }
    moveLocal(from, to) {
        const re = (k) => to + k.slice(from.length);
        for (const b of [...this.bins])
            if (under(b, from)) {
                this.bins.delete(b);
                this.bins.add(re(b));
            }
        this.persistSoon();
        if (this.files)
            for (const [k, v] of [...this.files])
                if (under(k, from)) {
                    this.files.delete(k);
                    this.touch(k);
                    if (inTree(re(k))) {
                        this.files.set(re(k), v);
                        this.touch(re(k));
                    }
                }
        for (const [k, v] of [...this.other])
            if (under(k, from)) {
                this.other.delete(k);
                this.other.set(re(k), v);
            }
        this.forgetAsset(from);
    }
    async exists(path) {
        const op = this.pendingFor(path);
        if (op)
            return op.kind === 'write' ? true : op.kind === 'move' ? under(path, op.to) : op.kind === 'moves' ? op.pairs.some(([, b]) => under(path, b)) : false;
        if (this.files?.has(path) || this.other.has(path))
            return true;
        // the copy knows every text file of the workspace: no need to ask Dropbox
        if (this.files && this.cursor && inTree(path))
            return false;
        try {
            await rpc('/2/files/get_metadata', { path: this.abs(path) });
            return true;
        }
        catch (e) {
            if (notFound(e))
                return false;
            throw e;
        }
    }
    // ---------- files shown in pages (images, PDFs …) ----------
    assetKey(path) { return `${this.snapKey()}\u0000${path}`; }
    async cacheAsset(path, blob) {
        try {
            const t = (await idb()).transaction('assets', 'readwrite');
            t.objectStore('assets').put(blob, this.assetKey(path));
            await done_(t);
            markUsed(this.assetKey(path));
            void trimAssets();
        }
        catch { /* only for speed */ }
    }
    forgetAsset(path) {
        for (const [k, u] of [...this.urls])
            if (under(k, path)) {
                URL.revokeObjectURL(u);
                this.urls.delete(k);
            }
        void (async () => { try {
            const t = (await idb()).transaction('assets', 'readwrite');
            t.objectStore('assets').delete(IDBKeyRange.bound(this.assetKey(path), this.assetKey(path) + '￿'));
            await done_(t);
        }
        catch { /* ignore */ } })();
    }
    /** "Show in Dropbox": dropbox.com at the file's folder, with the file shown */
    /**
     * Files Dropbox still keeps after they were deleted (30 days on Basic, 180 on Plus): for each path the newest
     * version, when the file is gone. Nothing is changed.
     */
    async deletedVersions(paths) {
        const out = new Map();
        let i = 0;
        const one = async () => {
            while (i < paths.length) {
                const p = paths[i++];
                try {
                    const r = await rpc('/2/files/list_revisions', { path: this.abs(p), mode: 'path', limit: 1 });
                    if (r.is_deleted && r.entries?.[0])
                        out.set(p, { rev: r.entries[0].rev, size: r.entries[0].size, when: r.entries[0].server_modified });
                }
                catch { /* never existed there */ }
            }
        };
        await Promise.all([one(), one(), one(), one()]);
        return out;
    }
    /** brings a deleted file back (that version, at its old place) */
    async restoreVersion(path, rev) {
        await rpc('/2/files/restore', { path: this.abs(path), rev });
        if (isFile(path)) {
            this.bins.add(path);
            this.persistSoon();
        }
    }
    async reveal(path) {
        const a = this.abs(path), dir = a.slice(0, a.lastIndexOf('/'));
        window.open(`https://www.dropbox.com/home${dir.split('/').map(encodeURIComponent).join('/')}?preview=${encodeURIComponent(a.split('/').pop())}`, '_blank', 'noopener');
    }
    async assetUrl(path) {
        const known = this.urls.get(path);
        if (known)
            return known;
        const op = this.pendingFor(path);
        if (op?.kind === 'write' && op.path === path) {
            const u = URL.createObjectURL(new Blob([op.data]));
            this.urls.set(path, u);
            return u;
        }
        // shown before: from the browser, instantly
        try {
            const blob = await req((await idb()).transaction('assets').objectStore('assets').get(this.assetKey(path)));
            if (blob) {
                markUsed(this.assetKey(path));
                const u = URL.createObjectURL(blob);
                this.urls.set(path, u);
                return u;
            }
        }
        catch { /* ask Dropbox */ }
        const r = await rpc('/2/files/get_temporary_link', { path: this.abs(path) });
        // kept for next time (in the background; the page shows the link right away)
        if ((r.metadata?.size ?? Infinity) <= ASSET_CACHE_MAX)
            void fetch(r.link).then((res) => res.ok ? res.blob() : null).then((b) => { if (b)
                void this.cacheAsset(path, b); }).catch(() => { });
        this.urls.set(path, r.link);
        setTimeout(() => { if (this.urls.get(path) === r.link)
            this.urls.delete(path); }, 3.5 * 3600_000);
        return r.link;
    }
    // ---------- changes from other devices ----------
    /** calls `onChange` when files changed in Dropbox (another device); this device's own saves don't count */
    watch(onChange) {
        let stopped = false;
        this.changeListeners.add(onChange);
        const onVisible = () => { if (document.visibilityState === 'visible')
            void this.sync().catch(() => { }); };
        const doc = typeof document === 'undefined' ? null : document;
        doc?.addEventListener('visibilitychange', onVisible);
        const loop = async () => {
            while (!stopped) {
                try {
                    if (!this.cursor)
                        await this.sync();
                    const res = await call(`${hosts().notify}/2/files/list_folder/longpoll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cursor: this.cursor, timeout: 90 }) }, false);
                    const j = await res.json();
                    if (stopped)
                        return;
                    if (j.changes)
                        await this.sync();
                    if (j.backoff)
                        await sleep(j.backoff * 1000);
                }
                catch {
                    await sleep(10_000);
                }
            }
        };
        void loop();
        return () => { stopped = true; this.changeListeners.delete(onChange); doc?.removeEventListener('visibilitychange', onVisible); };
    }
}
//# sourceMappingURL=dropbox.js.map