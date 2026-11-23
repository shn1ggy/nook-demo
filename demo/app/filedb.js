import { baseOf, dirOf, join, uniqueName, UNUSED } from './layout.js';
import { todayISO } from './util.js';
export const FILE_PROPS = [
    { file: 'type', name: 'Type', type: 'text' },
    { file: 'size', name: 'Size', type: 'number', format: 'bytes' },
    { file: 'length', name: 'Length', type: 'number', format: 'duration' },
    { file: 'created', name: 'Created', type: 'date' },
    { file: 'modified', name: 'Modified', type: 'date' },
    { file: 'added', name: 'Added', type: 'date' },
];
/** the empty file that keeps an empty folder (hidden) */
export const FOLDER_MARK = '.nook-folder';
export const isFileDb = (db) => !!db?.schema.files;
export const filesDir = (db) => `${db.dir}/files`;
const sidecarPath = (db) => `${db.dir}/files.json`;
const sides = new WeakMap();
const side = (db) => { let s = sides.get(db); if (!s) {
    s = {};
    sides.set(db, s);
} return s; };
// ---------- the folder a view shows ----------
const current = new Map();
export const folderOf = (db) => current.get(db.key) ?? '';
export function setFolder(db, rel) { if (rel)
    current.set(db.key, rel);
else
    current.delete(db.key); }
// ---------- kinds ----------
const KINDS = [
    [/\.(png|jpe?g|gif|webp|avif|heic|svg|tiff?|bmp)$/i, 'Image'], [/\.(mp4|mov|m4v|webm|mkv|avi|mxf)$/i, 'Video'],
    [/\.(mp3|m4a|wav|aiff?|aac|ogg|flac|opus)$/i, 'Audio'], [/\.pdf$/i, 'PDF'], [/\.(zip|rar|7z|tar|gz)$/i, 'Archive'],
    [/\.(docx?|pages|odt|rtf|txt|md)$/i, 'Document'], [/\.(xlsx?|numbers|csv|ods)$/i, 'Spreadsheet'], [/\.(pptx?|key|odp)$/i, 'Presentation'],
];
export const kindOf = (name) => KINDS.find(([re]) => re.test(name))?.[1] ?? ((name.match(/\.([^.]+)$/)?.[1] ?? 'File').toUpperCase());
export const isPlayable = (name) => /\.(mp4|mov|m4v|webm|mp3|m4a|wav|aiff?|aac|ogg|flac|opus)$/i.test(name);
/** a date from the storage (UTC) as a local date and time, the way Nook keeps dates */
function local(iso) {
    if (!iso)
        return undefined;
    const d = new Date(iso);
    if (isNaN(+d))
        return undefined;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** the file properties a database of files has (added once, when it is switched on) */
export function addFileProps(schema) {
    for (const f of FILE_PROPS) {
        const had = schema.properties.find((p) => p.file === f.file);
        if (had)
            continue;
        let name = f.name;
        for (let i = 2; schema.properties.some((p) => p.name === name); i++)
            name = `${f.name} ${i}`;
        schema.properties.push({ name, type: f.type, file: f.file, ...(f.format ? { format: f.format } : {}) });
    }
}
const propFor = (db, k) => db.schema.properties.find((p) => p.file === k)?.name;
/** the entries of a database of files, from the workspace's list of files (and its files.json) */
const noCacheDirs = new Set();
/** files of databases of files aren't kept in the browser (they can be big: songs, footage) – always fetched fresh */
function skipCache(ws, db) {
    noCacheDirs.add(filesDir(db) + '/');
    const st = ws.storage;
    if ('noCache' in st)
        st.noCache = (p) => [...noCacheDirs].some((d) => p.startsWith(d));
}
export async function loadFileRows(ws, db, read) {
    skipCache(ws, db);
    try {
        sides.set(db, JSON.parse((await read(sidecarPath(db))) ?? '{}'));
    }
    catch {
        sides.set(db, {});
    }
    buildRows(ws, db);
}
/** (again) every entry from the list of files: after uploads, moves, changes from elsewhere */
export function buildRows(ws, db) {
    const base = filesDir(db) + '/';
    const files = [], dirs = new Set();
    for (const f of ws.files) {
        if (!f.startsWith(base))
            continue;
        const rel = f.slice(base.length);
        const parts = rel.split('/');
        for (let i = 1; i < parts.length; i++)
            dirs.add(parts.slice(0, i).join('/'));
        const name = parts[parts.length - 1];
        if (name.startsWith('.') || name.endsWith('.nook-tmp'))
            continue;
        files.push(rel);
    }
    const old = new Map(db.rows.map((r) => [r.id, r]));
    const rows = [];
    for (const d of dirs)
        if (!d.split('/').some((x) => x.startsWith('.')))
            rows.push(fileRow(db, d, true, old.get('d:' + d)));
    for (const f of files)
        rows.push(fileRow(db, f, false, old.get('f:' + f)));
    db.rows = rows;
    db.invalidate();
}
function fileRow(db, rel, isDir, keep) {
    const s = side(db)[rel];
    const name = baseOf(rel);
    const values = { ...(s?.v ?? {}) };
    values[db.titleProp] = name;
    const set = (k, v) => { const p = propFor(db, k); if (p) {
        if (v == null)
            delete values[p];
        else
            values[p] = v;
    } };
    set('type', isDir ? 'Folder' : kindOf(name));
    if (!isDir) {
        set('size', s?.size);
        set('created', s?.created ? { start: s.created } : undefined);
        set('modified', s?.modified ? { start: s.modified } : undefined);
        set('added', s?.added ? { start: s.added } : undefined);
        set('length', s?.length);
    }
    const now = new Date().toISOString().slice(0, 19);
    const r = keep ?? { id: (isDir ? 'd:' : 'f:') + rel, values, body: '', created: now, edited: now };
    r.values = values;
    r.rel = rel;
    r.isDir = isDir;
    r.file = `${filesDir(db)}/${rel}`;
    return r;
}
/** the folder an entry is in ('' at the top) */
export const parentOf = (r) => dirOf(r.rel ?? '');
/** sizes and dates, read once per file and kept in files.json; read again only when a file's content changed
 *  (a rename isn't a change); then the length of sounds and videos */
export async function refreshFileInfo(ws, db, assetUrl) {
    const st = ws.storage;
    let list = [];
    if (st.fileInfo) {
        try {
            list = await st.fileInfo(filesDir(db));
        }
        catch {
            list = [];
        }
    }
    const base = (filesDir(db) + '/').toLowerCase();
    // Dropbox gives the folder's case only for the last part: matched by lower case
    const byLower = new Map();
    for (const f of list)
        if (f.path.toLowerCase().startsWith(base))
            byLower.set(f.path.slice(base.length).toLowerCase(), f);
    let changed = false;
    const s = side(db);
    for (const r of db.rows) {
        if (r.isDir || !r.rel)
            continue;
        const info = byLower.get(r.rel.toLowerCase());
        const e = (s[r.rel] ??= {});
        if (!e.added) {
            e.added = local(info?.modified ?? info?.created) ?? local(new Date().toISOString());
            changed = true;
        }
        if (!info)
            continue;
        const fp = info.hash ?? `${info.size}:${info.modified ?? ''}`;
        if (e.h === fp && e.size != null)
            continue;
        // new to Nook, or its content changed: read again (and the length too, if it had one)
        if (e.h && e.h !== fp)
            delete e.length;
        // Created is the file's own date: kept from the first time on (uploads keep the date the file had on your computer)
        e.h = fp;
        e.size = info.size;
        e.created ??= local(info.created);
        e.modified = local(info.modified);
        if (!e.created)
            delete e.created;
        if (!e.modified)
            delete e.modified;
        changed = true;
    }
    if (changed) {
        buildRows(ws, db);
        ws.emit();
        if (ws.storage.writable)
            await saveSidecar(ws, db);
    }
    void probeLengths(ws, db, assetUrl);
}
/** the length of sounds and videos: read once from the file's start, then kept in files.json */
const probing = new WeakSet();
async function probeLengths(ws, db, assetUrl) {
    if (probing.has(db) || !propFor(db, 'length'))
        return;
    probing.add(db);
    try {
        const s = side(db);
        const todo = db.rows.filter((r) => !r.isDir && r.rel && isPlayable(r.rel) && s[r.rel]?.length == null);
        let got = 0;
        for (const r of todo) {
            const secs = await mediaLength(await assetUrl(r.file).catch(() => ''), /\.(mp4|mov|m4v|webm)$/i.test(r.rel));
            if (secs == null)
                continue;
            (s[r.rel] ??= {}).length = Math.round(secs);
            const p = propFor(db, 'length');
            if (p)
                r.values[p] = Math.round(secs);
            if (++got % 5 === 0) {
                db.invalidate();
                ws.emit();
            }
        }
        if (got) {
            db.invalidate();
            ws.emit();
            await saveSidecar(ws, db);
        }
    }
    finally {
        probing.delete(db);
    }
}
function mediaLength(url, video) {
    if (!url)
        return Promise.resolve(null);
    return new Promise((done) => {
        const el = document.createElement(video ? 'video' : 'audio');
        const end = (v) => { clearTimeout(t); el.removeAttribute('src'); el.load(); done(v); };
        const t = setTimeout(() => end(null), 15000);
        el.preload = 'metadata';
        el.onloadedmetadata = () => end(Number.isFinite(el.duration) ? el.duration : null);
        el.onerror = () => end(null);
        el.src = url;
    });
}
export async function saveSidecar(ws, db) {
    const s = side(db);
    // only files that are still there
    const live = new Set(db.rows.map((r) => r.rel));
    for (const k of Object.keys(s))
        if (!live.has(k))
            delete s[k];
    await ws.write(sidecarPath(db), JSON.stringify(s, null, 1) + '\n', false);
}
/** an entry was changed: your properties go to files.json; a new name renames the file */
export async function saveFileRow(ws, db, row) {
    const rel = row.rel;
    if (!rel)
        return;
    const s = side(db);
    let name = String(row.values[db.titleProp] ?? '').replace(/[\\/:*?"<>|]+/g, '-').trim();
    const oldName = baseOf(rel);
    // the extension stays, even when only the name part was typed
    const ext = !row.isDir ? oldName.match(/\.[^.]+$/)?.[0] ?? '' : '';
    if (name && ext && !name.toLowerCase().endsWith(ext.toLowerCase()))
        name += ext;
    const own = {};
    for (const p of db.schema.properties)
        if (!p.file && p.type !== 'title' && row.values[p.name] != null)
            own[p.name] = row.values[p.name];
    let to = rel;
    if (name && name !== oldName && ws.storage.move) {
        const taken = new Set([...ws.files].filter((f) => dirOf(f) === dirOf(row.file)).map((f) => baseOf(f).toLowerCase()));
        for (const r of db.rows)
            if (parentOf(r) === parentOf(row) && r.isDir)
                taken.add(baseOf(r.rel).toLowerCase());
        const stem = ext ? name.slice(0, -ext.length) : name;
        to = join(dirOf(rel), uniqueName(stem, taken, ext));
        await moveInside(ws, db, rel, to);
        // the same entry, under its new name (a window showing it stays with it)
        row.rel = to;
        row.id = (row.isDir ? 'd:' : 'f:') + to;
        row.file = `${filesDir(db)}/${to}`;
    }
    const entry = (s[to] ??= {});
    if (Object.keys(own).length)
        entry.v = own;
    else
        delete entry.v;
    buildRows(ws, db);
    await saveSidecar(ws, db);
}
/** move a file or folder inside the files/ folder (rename, or into another folder); its properties go along */
export async function moveInside(ws, db, from, to) {
    if (from === to || !ws.storage.move)
        return;
    const a = `${filesDir(db)}/${from}`, b = `${filesDir(db)}/${to}`;
    await ws.storage.move(a, b);
    for (const f of [...ws.files])
        if (f === a || f.startsWith(a + '/')) {
            ws.files.delete(f);
            ws.files.add(b + f.slice(a.length));
        }
    const s = side(db);
    for (const k of Object.keys(s))
        if (k === from || k.startsWith(from + '/')) {
            s[to + k.slice(from.length)] = s[k];
            delete s[k];
        }
}
/** "Delete": the file (or folder) goes to "Unused files" – Nook never deletes files */
export async function removeFileRow(ws, db, row) {
    if (!row.rel || !ws.storage.move)
        return;
    const a = `${filesDir(db)}/${row.rel}`;
    const name = baseOf(row.rel), ext = row.isDir ? '' : name.match(/\.[^.]+$/)?.[0] ?? '';
    const dir = `${UNUSED}/${todayISO()}`;
    const taken = new Set([...ws.files].filter((f) => dirOf(f) === dir).map((f) => baseOf(f).toLowerCase()));
    const b = `${dir}/${uniqueName(ext ? name.slice(0, -ext.length) : name, taken, ext)}`;
    await ws.storage.move(a, b);
    for (const f of [...ws.files])
        if (f === a || f.startsWith(a + '/')) {
            ws.files.delete(f);
            ws.files.add(b + f.slice(a.length));
        }
    buildRows(ws, db);
    await saveSidecar(ws, db);
}
/** files dropped or picked: into the folder the view shows (names that are taken get a number) */
export async function uploadFiles(ws, db, files, folder = folderOf(db)) {
    if (!ws.storage.writeBinary)
        throw new Error('This workspace cannot store files');
    const dir = folder ? `${filesDir(db)}/${folder}` : filesDir(db);
    const s = side(db);
    let n = 0;
    for (const f of files) {
        const taken = new Set([...ws.files].filter((x) => dirOf(x) === dir).map((x) => baseOf(x).toLowerCase()));
        const ext = f.name.match(/\.[^.]+$/)?.[0] ?? '';
        // a photo or video just taken comes as "image.jpg" / "video.mov": named by when it was taken instead
        const stem0 = ext ? f.name.slice(0, -ext.length) : f.name;
        const stem = /^(image|video|photo|capturedvideo|capturedimage)$/i.test(stem0) ? takenName(f.lastModified || Date.now()) : stem0;
        const name = uniqueName(stem || 'File', taken, ext.toLowerCase() === '.jpeg' ? '.jpg' : ext);
        const path = `${dir}/${name}`;
        await ws.storage.writeBinary(path, new Uint8Array(await f.arrayBuffer()));
        ws.files.add(path);
        const rel = path.slice(filesDir(db).length + 1);
        const e = (s[rel] ??= {});
        e.added = local(new Date().toISOString());
        e.size = f.size;
        e.created = local(new Date(f.lastModified || Date.now()).toISOString());
        e.modified = e.added;
        n++;
    }
    buildRows(ws, db);
    await saveSidecar(ws, db);
    return n;
}
/** a new, empty folder (kept by a hidden marker file until something is put in it) */
export async function newFolder(ws, db, name, folder = folderOf(db)) {
    const dir = folder ? `${filesDir(db)}/${folder}` : filesDir(db);
    const taken = new Set([...ws.files].filter((x) => x.startsWith(dir + '/')).map((x) => x.slice(dir.length + 1).split('/')[0].toLowerCase()));
    const n = uniqueName(name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'New folder', taken);
    const mark = `${dir}/${n}/${FOLDER_MARK}`;
    await ws.storage.write(mark, '');
    ws.files.add(mark);
    buildRows(ws, db);
    return folder ? `${folder}/${n}` : n;
}
/** may "Entries are files" be switched? on: only without entries; off: only while no file is there */
export function canSwitch(db) {
    if (db.schema.files)
        return db.rows.length ? { ok: false, why: 'files' } : { ok: true };
    // an empty entry made with the database doesn't count
    const real = db.rows.filter((r) => r.body.trim() || Object.entries(r.values).some(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
    return real.length ? { ok: false, why: 'entries' } : { ok: true };
}
export async function switchFiles(ws, db, on) {
    if (on) {
        for (const r of [...db.rows])
            await ws.deleteRow(db, r, { history: false });
        db.schema.files = true;
        db.schema.repeat = false;
        skipCache(ws, db);
        // the Date a new database starts with means nothing for files (there are no entries, so it is empty)
        db.schema.properties = db.schema.properties.filter((p) => !(p.type === 'date' && p.name === 'Date'));
        addFileProps(db.schema);
        db.rows = [];
        sides.set(db, {});
        await ws.saveSchema(db);
        // the views show Length, Size, Created and Added (Type and Modified can be switched on)
        const shown = db.schema.properties.filter((p) => p.file && p.file !== 'type' && p.file !== 'modified').map((p) => p.name);
        for (const v of db.views) {
            const base = (v.props ?? db.schema.properties.filter((p) => !p.file).map((p) => p.name)).filter((n) => db.schema.properties.some((p) => p.name === n && !p.file));
            v.props = [...base, ...shown];
            if (v.sorts)
                v.sorts = v.sorts.filter((x) => db.schema.properties.some((p) => p.name === x.prop));
            if (v.filter)
                delete v.filter;
        }
        await ws.saveViews(db);
    }
    else {
        delete db.schema.files;
        delete db.schema.repeat;
        db.schema.properties = db.schema.properties.filter((p) => !p.file);
        db.rows = [];
        await ws.saveSchema(db);
    }
    db.invalidate();
    ws.emit();
}
/** the kinds whose icons have a colour (Settings → Colors → File icons), with their defaults */
export const FILE_KINDS = [
    { key: 'folder', label: 'Folders', icon: 'folder', color: '#e0a930' },
    { key: 'audio', label: 'Audio', icon: 'music', color: '#9b7be0' },
    { key: 'video', label: 'Video', icon: 'video', color: '#e0607e' },
    { key: 'image', label: 'Images', icon: 'image', color: '#3fae7a' },
    { key: 'document', label: 'Documents & PDFs', icon: 'file-text', color: '#4f8fe0' },
    { key: 'sheet', label: 'Spreadsheets', icon: 'table', color: '#2fa37f' },
    { key: 'archive', label: 'Archives', icon: 'file', color: '#c08a52' },
    { key: 'other', label: 'Other files', icon: 'file', color: '#8b9096' },
];
/** a file's kind for its icon */
export function iconKind(name, dir = false) {
    if (dir)
        return 'folder';
    if (/\.(mp3|m4a|wav|aiff?|aac|ogg|flac|opus)$/i.test(name))
        return 'audio';
    if (/\.(mp4|mov|m4v|webm|mkv|avi|mxf)$/i.test(name))
        return 'video';
    if (/\.(png|jpe?g|gif|webp|avif|heic|svg|tiff?|bmp)$/i.test(name))
        return 'image';
    if (/\.(pdf|docx?|pages|odt|rtf|txt|md|pptx?|key)$/i.test(name))
        return 'document';
    if (/\.(xlsx?|numbers|csv|ods)$/i.test(name))
        return 'sheet';
    if (/\.(zip|rar|7z|tar|gz)$/i.test(name))
        return 'archive';
    return 'other';
}
/** "Delete permanently" (asked first): the file or folder is gone, not in Unused files */
export async function deleteFileRows(ws, db, rows) {
    for (const row of rows) {
        if (!row.rel)
            continue;
        const a = `${filesDir(db)}/${row.rel}`;
        await ws.storage.remove(a);
        for (const f of [...ws.files])
            if (f === a || f.startsWith(a + '/'))
                ws.files.delete(f);
    }
    buildRows(ws, db);
    await saveSidecar(ws, db);
}
/** "2026-11-23 21-35-08": when a photo was taken (colons can't be in file names on Windows and in Finder) */
function takenName(t) {
    const d = new Date(t), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
//# sourceMappingURL=filedb.js.map