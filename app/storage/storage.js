// Storage adapters. The app only ever talks to this interface, so the same code runs on
// a local folder (desktop via Tauri, or Chrome's folder access), in memory (tests),
// and later the Dropbox API (phone).
const norm = (p) => p.replace(/^\/+|\/+$/g, '');
const split = (p) => norm(p).split('/').filter(Boolean);
// ---------- memory (tests) ----------
export class MemoryStorage {
    label;
    writable = true;
    files = new Map();
    constructor(label, init) {
        this.label = label;
        if (init)
            for (const [k, v] of Object.entries(init))
                this.files.set(norm(k), v);
    }
    async list(dir) {
        const d = norm(dir), prefix = d ? d + '/' : '';
        const seen = new Map();
        for (const k of this.files.keys()) {
            if (!k.startsWith(prefix))
                continue;
            const rest = k.slice(prefix.length);
            const [first, ...more] = rest.split('/');
            if (!seen.has(first))
                seen.set(first, { name: first, kind: more.length ? 'dir' : 'file' });
        }
        return [...seen.values()];
    }
    async read(path) {
        const v = this.files.get(norm(path));
        if (v === undefined)
            throw new Error(`Not found: ${path}`);
        return v;
    }
    async write(path, data) { this.files.set(norm(path), data); }
    /** binary files (dropped images, PDFs …) live only for this session in memory */
    blobs = new Map();
    async writeBinary(path, data) { this.blobs.set(norm(path), data); this.files.set(norm(path), ''); }
    async assetUrl(path) {
        const b = this.blobs.get(norm(path));
        if (!b)
            throw new Error(`Not found: ${path}`);
        return URL.createObjectURL(new Blob([b]));
    }
    async remove(path) {
        const p = norm(path);
        for (const k of [...this.files.keys()])
            if (k === p || k.startsWith(p + '/'))
                this.files.delete(k);
    }
    movesFolders = true;
    async listAll() { return [...this.files.keys()]; }
    async fileInfo(dir) {
        const d = norm(dir) + '/';
        return [...this.files.keys()].filter((k) => k.startsWith(d)).map((k) => ({ path: k, size: this.blobs.get(k)?.length ?? this.files.get(k).length }));
    }
    async move(from, to) {
        const a = norm(from), b = norm(to);
        const keys = [...this.files.keys()].filter((k) => k === a || k.startsWith(a + '/'));
        if (!keys.length)
            throw new Error(`Not found: ${from}`);
        for (const k of keys) {
            const n = b + k.slice(a.length);
            this.files.set(n, this.files.get(k));
            this.files.delete(k);
            const blob = this.blobs.get(k);
            if (blob) {
                this.blobs.set(n, blob);
                this.blobs.delete(k);
            }
        }
    }
    async exists(path) {
        const p = norm(path);
        for (const k of this.files.keys())
            if (k === p || k.startsWith(p + '/'))
                return true;
        return false;
    }
}
export class FolderStorage {
    root;
    writable = true;
    constructor(root) {
        this.root = root;
    }
    get label() { return this.root.name; }
    static supported() { return typeof window.showDirectoryPicker === 'function'; }
    static async pick() {
        try {
            const h = await window.showDirectoryPicker({ mode: 'readwrite', id: 'nook-workspace' });
            return new FolderStorage(h);
        }
        catch {
            return null;
        }
    }
    async dir(parts, create = false) {
        let d = this.root;
        for (const p of parts)
            d = await d.getDirectoryHandle(p, { create });
        return d;
    }
    async list(dir) {
        let d;
        try {
            d = await this.dir(split(dir));
        }
        catch {
            return [];
        }
        const out = [];
        for await (const [name, h] of d.entries())
            out.push({ name, kind: h.kind === 'directory' ? 'dir' : 'file' });
        return out;
    }
    async read(path) {
        const parts = split(path), name = parts.pop();
        const d = await this.dir(parts);
        const f = await (await d.getFileHandle(name)).getFile();
        return f.text();
    }
    async write(path, data) {
        const parts = split(path), name = parts.pop();
        const d = await this.dir(parts, true);
        const fh = await d.getFileHandle(name, { create: true });
        // createWritable writes to a swap file and swaps on close → atomic for readers
        const w = await fh.createWritable();
        await w.write(data);
        await w.close();
    }
    async writeBinary(path, data) { return this.write(path, data); }
    movesFolders = true;
    /** a file or a whole folder; with the browser's own move where it has one (instant), else copied over */
    async move(from, to) {
        const parts = split(from), name = parts.pop();
        const tparts = split(to), tname = tparts.pop();
        const src = await this.dir(parts);
        let h;
        try {
            h = await src.getFileHandle(name);
        }
        catch {
            h = await src.getDirectoryHandle(name);
        }
        const dest = await this.dir(tparts, true);
        if (typeof h.move === 'function') {
            try {
                await h.move(dest, tname);
                return;
            }
            catch { /* copy instead */ }
        }
        if (h.kind === 'file') {
            const f = await h.getFile();
            await this.write(to, new Uint8Array(await f.arrayBuffer()));
        }
        else {
            const names = [];
            for await (const [n] of h.entries())
                names.push(n);
            for (const n of names)
                await this.move(`${from}/${n}`, `${to}/${n}`);
        }
        await src.removeEntry(name, { recursive: true });
    }
    async moveMany(pairs) { for (const [a, b] of pairs)
        await this.move(a, b); }
    /** every file below the folder */
    async listAll() {
        const out = [];
        const walk = async (d, pre, depth) => {
            for await (const [n, h] of d.entries()) {
                const p = pre ? `${pre}/${n}` : n;
                if (h.kind === 'directory') {
                    if (depth < 14 && !/^\.workspace\/(history|trash|unused-files|fetched)$/.test(p))
                        await walk(h, p, depth + 1);
                }
                else if (!n.endsWith('.nook-tmp') && n !== '.DS_Store' && n !== 'desktop.ini' && !n.startsWith('~$'))
                    out.push(p);
            }
        };
        await walk(this.root, '', 0);
        return out;
    }
    async remove(path) {
        const parts = split(path), name = parts.pop();
        const d = await this.dir(parts);
        await d.removeEntry(name, { recursive: true });
    }
    async fileInfo(dir) {
        const out = [];
        let root;
        try {
            root = await this.dir(split(dir));
        }
        catch {
            return out;
        }
        const walk = async (d, pre, depth) => {
            for await (const [n, h] of d.entries()) {
                const p = `${pre}/${n}`;
                if (h.kind === 'directory') {
                    if (depth < 12)
                        await walk(h, p, depth + 1);
                    continue;
                }
                try {
                    const f = await h.getFile();
                    const m = new Date(f.lastModified).toISOString();
                    out.push({ path: p, size: f.size, created: m, modified: m });
                }
                catch { /* gone */ }
            }
        };
        await walk(root, norm(dir), 0);
        return out;
    }
    async exists(path) {
        const parts = split(path), name = parts.pop();
        try {
            const d = await this.dir(parts);
            try {
                await d.getFileHandle(name);
                return true;
            }
            catch {
                await d.getDirectoryHandle(name);
                return true;
            }
        }
        catch {
            return false;
        }
    }
    async assetUrl(path) {
        const parts = split(path), name = parts.pop();
        const d = await this.dir(parts);
        return URL.createObjectURL(await (await d.getFileHandle(name)).getFile());
    }
}
// ---------- Tauri desktop app ----------
// Uses @tauri-apps/plugin-fs through the global API (withGlobalTauri = true).
export class TauriStorage {
    base;
    writable = true;
    constructor(base) {
        this.base = base;
    }
    get label() { return this.base.split(/[\\/]/).pop() ?? this.base; }
    static available() { return !!window.__TAURI__?.fs; }
    get fs() { return window.__TAURI__.fs; }
    abs(p) { return `${this.base}/${norm(p)}`; }
    async list(dir) {
        try {
            const items = await this.fs.readDir(this.abs(dir));
            return items.map((e) => ({ name: e.name, kind: e.isDirectory ? 'dir' : 'file' }));
        }
        catch {
            return [];
        }
    }
    read(path) { return this.fs.readTextFile(this.abs(path)); }
    async write(path, data) {
        const target = this.abs(path);
        const dir = target.slice(0, target.lastIndexOf('/'));
        await this.fs.mkdir(dir, { recursive: true }).catch(() => { });
        const tmp = `${target}.nook-tmp`;
        await this.fs.writeTextFile(tmp, data);
        await this.fs.rename(tmp, target);
    }
    async writeBinary(path, data) {
        const target = this.abs(path);
        await this.fs.mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true }).catch(() => { });
        await this.fs.writeFile(target, data);
    }
    remove(path) { return this.fs.remove(this.abs(path), { recursive: true }); }
    async move(from, to) {
        const target = this.abs(to);
        await this.fs.mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true }).catch(() => { });
        await this.fs.rename(this.abs(from), target);
    }
    exists(path) { return this.fs.exists(this.abs(path)); }
    async assetUrl(path) { return window.__TAURI__.core.convertFileSrc(this.abs(path)); }
    readAll(dir, ext) {
        return window.__TAURI__.core.invoke('read_texts', { dir: this.abs(dir), ext });
    }
}
// ---------- Nook's local server (any browser, e.g. Firefox) ----------
// scripts/serve.mjs reads and writes the folder on this computer; the page gets a key for it.
/** true while the page is being hidden or closed (then saves use keepalive) */
let pageClosing = false;
const closing = () => pageClosing;
if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { pageClosing = true; });
    window.addEventListener('pageshow', () => { pageClosing = false; });
    document.addEventListener('visibilitychange', () => { pageClosing = document.visibilityState === 'hidden'; });
}
export class ServerStorage {
    base;
    writable = true;
    constructor(base) {
        this.base = base;
    }
    get label() { return this.base.split(/[\\/]/).filter(Boolean).pop() ?? this.base; }
    static key() { return document.querySelector('meta[name="nook-server"]')?.content || null; }
    static available() { return !!ServerStorage.key(); }
    static async call(op, params, init = {}) {
        const url = `/api/fs/${op}?${new URLSearchParams(params)}`;
        const opts = { ...init, headers: { ...(init.headers ?? {}), 'x-nook-key': ServerStorage.key() ?? '' } };
        // a dropped connection (busy computer, many files at once) is tried again a few times before it counts
        let res;
        for (let i = 0;; i++) {
            try {
                res = await fetch(url, opts);
                break;
            }
            catch (e) {
                if (i >= 3)
                    throw new Error(`No connection to Nook's local server (${e.message}). Is the start file still running?`);
                await new Promise((ok) => setTimeout(ok, 250 * (i + 1)));
            }
        }
        if (!res.ok)
            throw new Error(res.status === 404 ? `Not found: ${params.path ?? ''}` : `${op} failed (${res.status}): ${await res.text().catch(() => '')}`);
        return res;
    }
    q(path) { return { root: this.base, path: norm(path) }; }
    async list(dir) { try {
        return await (await ServerStorage.call('list', this.q(dir))).json();
    }
    catch {
        return [];
    } }
    async read(path) { return (await ServerStorage.call('read', this.q(path))).text(); }
    // responses are always read to the end, so the browser can release the connection
    // keepalive lets a last save finish while the tab is closing – only then: browsers allow just 64 KB of
    // keepalive requests at a time, so using it for every save makes bursts (an import) fail
    async write(path, data) { await (await ServerStorage.call('write', this.q(path), { method: 'PUT', body: data, keepalive: closing() && data.length < 60000 })).text(); }
    async writeBinary(path, data) { await (await ServerStorage.call('write', this.q(path), { method: 'PUT', body: new Blob([data]) })).text(); }
    async remove(path) { await (await ServerStorage.call('remove', this.q(path), { method: 'DELETE' })).text(); }
    async move(from, to) {
        const res = await fetch(`/api/fs/move?${new URLSearchParams({ ...this.q(from), to })}`, { method: 'POST', headers: { 'x-nook-key': ServerStorage.key() ?? '' } });
        if (res.ok)
            return;
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error === 'unknown' ? 'Restart Nook (its start file) once to use this.' : body.error || `failed (${res.status})`);
    }
    async exists(path) { try {
        return (await (await ServerStorage.call('exists', this.q(path))).json()).exists;
    }
    catch {
        return false;
    } }
    async assetUrl(path) { return `/api/fs/raw?${new URLSearchParams({ ...this.q(path), k: ServerStorage.key() ?? '' })}`; }
    async readAll(dir, ext) { return (await ServerStorage.call('readall', { ...this.q(dir), ext })).json(); }
    async reveal(path) {
        const res = await fetch(`/api/fs/reveal?${new URLSearchParams({ root: this.base, path })}`, { headers: { 'x-nook-key': ServerStorage.key() ?? '' } });
        if (res.ok)
            return;
        const body = await res.json().catch(() => ({}));
        // a local server started before this version doesn't know "reveal" yet
        throw new Error(body.error === 'unknown' ? 'Restart Nook (its start file) once to use this.' : body.error || `failed (${res.status})`);
    }
    movesFolders = true;
    async listAll() { return (await ServerStorage.call('listall', { root: this.base })).json(); }
    async readTree(dirs, exts) { return (await ServerStorage.call('readtree', { root: this.base, dirs: dirs.join(','), ext: exts.join(',') })).json(); }
}
//# sourceMappingURL=storage.js.map