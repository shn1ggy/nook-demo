import { autoMerge } from './storage/merge.js';
import { parseRowTarget, rowTarget } from './links.js';
// Loading, saving and querying a workspace folder.
//
// <workspace>/
//   .workspace/workspace.json   name, format version, home page, locale
//   .workspace/settings.json    sidebar, density, theme, accent, favourites
//   .workspace/keymap.json      shortcut overrides
//   pages/<slug>-<id>.md        one page: front matter + blocks
//   databases/<key>/database.json   schema (properties, options, formulas, templates)
//   databases/<key>/views.json      views (table, calendar, board, list, chart)
//   databases/<key>/rows/<id>.md    one row: properties in front matter, page body below
//   assets/                     images, PDFs
//
// Newer workspaces (meta.layout 2) arrange the folder like the sidebar instead – pages as folders, entries
// named after them, files next to the page that shows them: see layout.ts.
import { APP } from './config.js';
import { MemoryStorage } from './storage/storage.js';
import { formatDoc, parseDoc } from './format/frontmatter.js';
import { parsePage, serializePage } from './format/page.js';
import { compile, evaluate, FormulaError, references, renameInFormula } from './formula.js';
import { MONTHS, fmtDate, weekStart, asDate, compareDateStarts, compareText, dayNum, defaultLocale, localeDefaults, pad2, slug, todayISO, hhmmOfDate, ulid } from './util.js';
import { plainText } from './format/inline.js';
import { loadFileRows, buildRows, saveFileRow, removeFileRow, folderOf, parentOf } from './filedb.js';
import { safeName, dirOf, baseOf, stemOf, join, under, pageFolder, uniqueName, namesIn, NOT_CONTENT, PAGES, DATABASES, UNUSED } from './layout.js';
const safeDecode = (s) => { try {
    return decodeURI(s);
}
catch {
    return s;
} };
/** the appearance settings a device can keep for itself (Settings → Appearance) */
const DEVICE_KEYS = ['theme', 'accent', 'background', 'contrast', 'font', 'zoom', 'density', 'blockSize', 'pageWidth', 'blur'];
/** settings of a new workspace; dates, times and the first weekday follow the computer's language */
const DEFAULT_SETTINGS = {
    sidebar: true, density: 'dense', favorites: [], font: 'system', ...localeDefaults(),
};
export class Database {
    key;
    schema;
    views;
    /** other databases of the open workspace (for relations and rollups); set by Workspace.activate() */
    static lookup = () => undefined;
    /** every database of the open workspace (set by Workspace.activate()) */
    static all = () => [];
    rows = [];
    idx = null;
    idxRows = null;
    /** an entry by id (fast; the index follows changes to the rows) */
    byId(id) {
        if (!this.idx || this.idxRows !== this.rows || this.idx.size !== this.rows.length) {
            this.idx = new Map(this.rows.map((r) => [r.id, r]));
            this.idxRows = this.rows;
        }
        const r = this.idx.get(id);
        return r && this.rows.includes(r) ? r : undefined;
    }
    /** the entries a relation property of a row links to (missing ones are skipped) */
    linked(row, prop) {
        const def = this.prop(prop);
        const target = def?.relation ? Database.lookup(def.relation.db) : undefined;
        if (!target)
            return null;
        const ids = row.values[prop];
        const list = Array.isArray(ids) ? ids : typeof ids === 'string' && ids ? [ids] : [];
        return { db: target, rows: list.map((id) => target.byId(String(id))).filter((r) => !!r) };
    }
    formulaOrder = [];
    computed = new Map();
    /** its folder ("databases/<key>", or with the folders following the sidebar, wherever it sits) */
    dir;
    constructor(key, schema, views) {
        this.key = key;
        this.schema = schema;
        this.views = views;
        this.dir = `databases/${key}`;
        this.reorderFormulas();
    }
    prop(name) { return this.schema.properties.find((p) => p.name === name); }
    get titleProp() { return this.schema.properties.find((p) => p.type === 'title')?.name ?? 'Name'; }
    get dateLabel() { const key = this.schema.dateLabel; return key && this.prop(key)?.type === 'date' ? key : undefined; }
    get labelProp() { return this.dateLabel ?? this.titleProp; }
    tableProperties(view) {
        const names = view.props ?? this.schema.properties.map((p) => p.name);
        const visible = names.filter((n) => this.prop(n) && (n !== this.titleProp || !this.dateLabel || this.schema.showNameWithDate));
        return this.dateLabel ? [this.dateLabel, ...visible.filter((n) => n !== this.dateLabel)] : [this.titleProp, ...visible.filter((n) => n !== this.titleProp)];
    }
    rowLabel(row) {
        if (this.dateLabel) {
            const value = asDate(this.value(row, this.dateLabel));
            return value?.start ? fmtDate(value, this.prop(this.dateLabel)?.dateFormat, this.prop(this.dateLabel)?.weekday) : 'No date';
        }
        return plainText(String(row.values[this.titleProp] ?? '')).trim() || 'Untitled';
    }
    reorderFormulas() {
        // formulas that reference other formulas are computed after them
        const formulas = this.schema.properties.filter((p) => p.type === 'formula');
        const names = new Set(formulas.map((f) => f.name));
        const done = new Set(), out = [];
        const visit = (f, seen) => {
            if (done.has(f.name) || seen.has(f.name))
                return;
            seen.add(f.name);
            const n = compile(f.formula ?? '');
            if (!(n instanceof FormulaError))
                for (const r of references(n))
                    if (names.has(r))
                        visit(formulas.find((x) => x.name === r), seen);
            done.add(f.name);
            out.push(f);
        };
        formulas.forEach((f) => visit(f, new Set()));
        this.formulaOrder = out;
        this.computed.clear();
    }
    invalidate(rowId) { if (rowId)
        this.computed.delete(rowId);
    else
        this.computed.clear(); }
    /** Value of a property for a row, including formulas and system properties. */
    value(row, prop) {
        const def = this.prop(prop);
        if (!def)
            return row.values[prop] ?? null;
        if (def.type === 'created_time')
            return { start: row.created.slice(0, 16) };
        if (def.type === 'last_edited_time')
            return { start: row.edited.slice(0, 16) };
        if (def.type === 'rollup')
            return this.rollup(row, def);
        if (def.type !== 'formula')
            return row.values[prop] ?? null;
        let c = this.computed.get(row.id);
        if (!c) {
            c = {};
            const cc = c;
            const lookup = (name) => {
                if (name in cc)
                    return cc[name];
                const d = this.prop(name);
                if (d && d.type !== 'formula')
                    return this.value(row, name);
                return row.values[name] ?? null;
            };
            for (const f of this.formulaOrder) {
                const n = compile(f.formula ?? '');
                try {
                    cc[f.name] = n instanceof FormulaError ? null : evaluate(n, lookup);
                }
                catch {
                    cc[f.name] = null;
                }
            }
            this.computed.set(row.id, c);
        }
        return c[prop] ?? null;
    }
    /** a rollup's value: count, sum, average … of a property of the linked entries */
    rollup(row, def) {
        const cfg = def.rollup;
        if (!cfg)
            return null;
        const l = this.linked(row, cfg.relation);
        if (!l)
            return null;
        if (cfg.fn === 'count')
            return l.rows.length;
        const tp = l.db.prop(cfg.prop);
        const vals = l.rows.map((r) => l.db.value(r, cfg.prop));
        const filled = vals.filter((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
        switch (cfg.fn) {
            case 'count_values': return filled.length;
            case 'percent_checked': return l.rows.length ? vals.filter((v) => v === true).length / l.rows.length : null;
            case 'sum':
            case 'avg':
            case 'min':
            case 'max': {
                const nums = filled.map((v) => (typeof v === 'number' ? v : Number(v))).filter((n) => !Number.isNaN(n));
                if (!nums.length)
                    return cfg.fn === 'sum' ? 0 : null;
                if (cfg.fn === 'sum')
                    return nums.reduce((a, b) => a + b, 0);
                if (cfg.fn === 'avg')
                    return nums.reduce((a, b) => a + b, 0) / nums.length;
                return cfg.fn === 'min' ? Math.min(...nums) : Math.max(...nums);
            }
            case 'earliest':
            case 'latest': {
                const ds = filled.map((v) => asDate(v)?.start).filter((s) => !!s).sort();
                if (!ds.length)
                    return null;
                return { start: cfg.fn === 'earliest' ? ds[0] : ds[ds.length - 1] };
            }
            case 'show': {
                const out = [];
                for (const v of filled) {
                    if (Array.isArray(v))
                        out.push(...v.map(String));
                    else if (typeof v === 'object')
                        out.push(v.start);
                    else if (tp?.type === 'title')
                        out.push(plainText(String(v)));
                    else
                        out.push(String(v));
                }
                return out;
            }
        }
        return null;
    }
    formulaError(prop) {
        const n = compile(this.prop(prop)?.formula ?? '');
        return n instanceof FormulaError ? n.message : null;
    }
    optionColor(prop, value) {
        return this.prop(prop)?.options?.find((o) => o.name === value)?.color ?? 'default';
    }
}
export class Workspace {
    storage;
    meta = { name: 'Workspace', formatVersion: APP.formatVersion, locale: defaultLocale() };
    settings = { ...DEFAULT_SETTINGS };
    keymap = {};
    pages = new Map();
    dbs = new Map();
    /** listeners notified after any change (re-render) */
    listeners = new Set();
    /** last known content of every file (for undo and to skip unchanged writes) */
    cache = new Map();
    past = [];
    future = [];
    lastWrite = 0;
    applying = false;
    /** every file of the workspace (text and others) – for the folders' contents and free names */
    files = new Set();
    get layout2() { return this.meta.layout === 2; }
    /** pages whose parent follows from where their folder is now (moved in Finder): saved by arrange() */
    placeChanged = new Set();
    /** pages whose folder was renamed in Explorer / Finder: their folder (the file inside follows when tidied) */
    adopted = new Map();
    /** names changed on disk, to save: pages, databases, entries */
    renamedOnDisk = { pages: new Set(), dbs: new Set(), rows: [] };
    /**
     * A name changed in Explorer or Finder becomes the name in Nook: a page's folder, a database's folder, an
     * entry's file. (A name that no longer fits what Nook gave it was changed by hand – that one wins.)
     */
    adoptNames() {
        const norm = (x) => x.normalize('NFC').replace(/ \(\d+\)$/, '').toLowerCase();
        const plain = (x) => x.normalize('NFC').replace(/ \(\d+\)$/, '');
        // pages: a page folder holds the page's file under the folder's name; a single page file under another name = the folder was renamed
        const canonical = new Set([...this.pages.values()].map((p) => pageFolder(p.file)?.toLowerCase()).filter(Boolean));
        const byDir = new Map();
        for (const p of this.pages.values())
            if (!pageFolder(p.file)) {
                const d = dirOf(p.file);
                if (d && under(d, PAGES) && d !== PAGES) {
                    byDir.set(d, [...(byDir.get(d) ?? []), p]);
                }
            }
        for (const [d, ps] of byDir) {
            if (ps.length !== 1 || canonical.has(d.toLowerCase()))
                continue;
            const p = ps[0];
            this.adopted.set(p.id, d);
            if (norm(baseOf(d)) !== norm(safeName(p.title))) {
                p.title = plain(baseOf(d));
                this.renamedOnDisk.pages.add(p.id);
            }
        }
        for (const db of this.dbs.values()) {
            if (dirOf(db.dir) !== DATABASES)
                continue;
            if (norm(baseOf(db.dir)) !== norm(safeName(db.schema.name))) {
                db.schema.name = plain(baseOf(db.dir));
                this.renamedOnDisk.dbs.add(db.key);
            }
            for (const r of db.rows) {
                if (!r.file || dirOf(r.file) !== db.dir)
                    continue;
                const stem = stemOf(r.file);
                if (norm(stem) !== norm(this.rowName(db, r))) {
                    r.values[db.titleProp] = plain(stem);
                    this.renamedOnDisk.rows.push([db.key, r.id]);
                }
            }
        }
    }
    /** saves what was renamed on disk; a renamed page folder's file gets the folder's name too */
    async saveAdopted() {
        for (const [id, d] of this.adopted) {
            const p = this.pages.get(id);
            if (p && !pageFolder(p.file))
                await this.relocate(p.file, join(d, `${baseOf(d)}.md`), { relink: false });
        }
        this.adopted.clear();
        for (const id of this.renamedOnDisk.pages) {
            const p = this.pages.get(id);
            if (p)
                await this.savePage(p, false);
        }
        for (const k of this.renamedOnDisk.dbs) {
            const d = this.dbs.get(k);
            if (d)
                await this.saveSchema(d);
        }
        for (const [k, id] of this.renamedOnDisk.rows) {
            const d = this.dbs.get(k);
            const r = d?.byId(id);
            if (d && r)
                await this.saveRow(d, r, { history: false });
        }
        this.renamedOnDisk = { pages: new Set(), dbs: new Set(), rows: [] };
    }
    /** second files of the same page or entry (found when opening): removed when the folder is tidied */
    dupFiles = [];
    constructor(storage) {
        this.storage = storage;
    }
    /** this workspace is the one shown: relations and rollups look up its databases */
    activate() { Database.lookup = (k) => this.dbs.get(k); Database.all = () => [...this.dbs.values()]; return this; }
    /** a new, empty database (a folder with database.json and views.json) */
    async createDatabase(name, _page) {
        const base = slug(name) || 'database';
        let key = base, i = 2;
        while (this.dbs.has(key))
            key = `${base}-${i++}`;
        const schema = { name, icon: 'i:database', properties: [{ name: 'Name', type: 'title' }, { name: 'Date', type: 'date' }, { name: 'Tags', type: 'multi_select', options: [] }] };
        // new entries: “New” at the top, and you stay in the view to type the name (opened entries: center peek)
        const db = new Database(key, schema, [{ ...defaultView(schema), newAt: 'top', newOpens: 'stay' }]);
        if (this.layout2)
            db.dir = join(DATABASES, uniqueName(safeName(name), this.takenIn(DATABASES)));
        this.dbs.set(key, db);
        this.boundary();
        await this.saveSchema(db);
        await this.saveViews(db);
        this.emit();
        return db;
    }
    // ---------- comments ----------
    // Notes to yourself on a page or an entry, in comments/<page or entry>.json: edit, delete, mark done.
    /** where comments are kept: .workspace/comments (with the folders following the sidebar), else comments/ */
    get commentsDir() { return this.layout2 ? `${APP.workspaceDir}/comments` : 'comments'; }
    commentsPath(path) { return `${this.commentsDir}/${slugPath(path)}.json`; }
    async comments(path) {
        const t = await this.readExtra(this.commentsPath(path), true);
        try {
            return t ? JSON.parse(t).comments : [];
        }
        catch {
            return [];
        }
    }
    async saveComments(path, list) {
        const file = this.commentsPath(path);
        if (!list.length) {
            if (this.cache.get(file) != null || await this.storage.exists(file).catch(() => false))
                await this.removeFile(file);
            return;
        }
        await this.write(file, JSON.stringify({ path, comments: list }, null, 2) + '\n');
    }
    /** every comment of the workspace (for the "Comments" list), with the file it belongs to */
    async allComments() {
        let files = [];
        try {
            const dir = this.commentsDir;
            if (this.storage.readAll)
                files = await this.storage.readAll(dir, 'json');
            else
                for (const e of await this.storage.list(dir))
                    if (e.name.endsWith('.json'))
                        files.push([e.name, await this.storage.read(`${dir}/${e.name}`)]);
        }
        catch {
            return [];
        }
        const out = [];
        for (const [name, text] of files) {
            try {
                const j = JSON.parse(text);
                this.cache.set(`${this.commentsDir}/${name.split('/').pop()}`, text);
                out.push({ path: j.path, comments: j.comments ?? [] });
            }
            catch { /* skip */ }
        }
        return out;
    }
    // ---------- relations ----------
    /** sets the entries a relation links to; with a two-way relation the linked entries are updated too */
    async setRelation(db, row, prop, ids) {
        const def = db.prop(prop);
        if (!def?.relation)
            return;
        const before = new Set(Array.isArray(row.values[prop]) ? row.values[prop] : []);
        const after = new Set(ids);
        if (ids.length)
            row.values[prop] = [...ids];
        else
            delete row.values[prop];
        await this.saveRow(db, row);
        const target = this.dbs.get(def.relation.db);
        const rev = def.relation.reverse && target?.prop(def.relation.reverse)?.type === 'relation' ? def.relation.reverse : undefined;
        if (!target || !rev)
            return;
        const changed = [...new Set([...before, ...after])].filter((id) => before.has(id) !== after.has(id));
        for (const id of changed) {
            const t = target.byId(id);
            if (!t)
                continue;
            const cur = Array.isArray(t.values[rev]) ? t.values[rev].filter((x) => x !== row.id) : [];
            if (after.has(id))
                cur.push(row.id);
            if (cur.length)
                t.values[rev] = cur;
            else
                delete t.values[rev];
            await this.saveRow(target, t);
        }
    }
    /** a relation shown on both sides: adds the property on the linked database's side */
    async makeTwoWay(db, def, name) {
        const target = def.relation ? this.dbs.get(def.relation.db) : undefined;
        if (!target || !def.relation)
            return;
        let n = name ?? (target === db ? `${def.name} (back)` : db.schema.name), i = 2;
        const base = n;
        while (target.prop(n))
            n = `${base} ${i++}`;
        target.schema.properties.push({ name: n, type: 'relation', relation: { db: db.key, reverse: def.name } });
        def.relation.reverse = n;
        // the links that exist already show up on the other side
        for (const r of db.rows) {
            const ids = Array.isArray(r.values[def.name]) ? r.values[def.name] : [];
            for (const id of ids) {
                const t = target.byId(id);
                if (!t)
                    continue;
                const cur = Array.isArray(t.values[n]) ? t.values[n] : [];
                if (!cur.includes(r.id)) {
                    t.values[n] = [...cur, r.id];
                    await this.saveRow(target, t);
                }
            }
        }
        await this.saveSchema(target);
        await this.saveSchema(db);
    }
    /** turns sub-items on: a "Parent item" relation to the database itself, two-way with "Sub-items" */
    async enableSubItems(db) {
        if (db.schema.subItems && db.prop(db.schema.subItems.parent) && db.prop(db.schema.subItems.children))
            return;
        // turned on again: the pair from before is used (a relation to itself whose entries have one link at most)
        const pair = db.schema.properties.find((p) => p.type === 'relation' && p.relation?.db === db.key && p.relation.reverse && db.prop(p.relation.reverse)
            && db.rows.every((r) => !Array.isArray(r.values[p.name]) || r.values[p.name].length <= 1) && /parent/i.test(p.name));
        if (pair) {
            db.schema.subItems = { parent: pair.name, children: pair.relation.reverse };
            await this.saveSchema(db);
            return;
        }
        let parent = 'Parent item', i = 2;
        while (db.prop(parent))
            parent = `Parent item ${i++}`;
        const def = { name: parent, type: 'relation', relation: { db: db.key } };
        db.schema.properties.push(def);
        let children = 'Sub-items';
        i = 2;
        while (db.prop(children))
            children = `Sub-items ${i++}`;
        await this.makeTwoWay(db, def, children);
        db.schema.subItems = { parent, children };
        await this.saveSchema(db);
    }
    /** the parent of an entry (sub-items), if it is in the database */
    parentOf(db, row) {
        const p = db.schema.subItems?.parent;
        const v = p ? row.values[p] : undefined;
        const id = Array.isArray(v) ? v[0] : typeof v === 'string' ? v : undefined;
        return id && id !== row.id ? db.byId(String(id)) : undefined;
    }
    /** a new entry below another one */
    async addSubItem(db, parent, values = {}) {
        const si = db.schema.subItems;
        if (!si)
            return undefined;
        const row = await this.addRow(db, values);
        await this.setRelation(db, row, si.parent, [parent.id]);
        return row;
    }
    /** a two-way relation becomes one-way again (the property on the other side stays, without links back) */
    async makeOneWay(db, def) {
        const target = def.relation ? this.dbs.get(def.relation.db) : undefined;
        const rev = def.relation?.reverse ? target?.prop(def.relation.reverse) : undefined;
        if (rev?.relation)
            delete rev.relation.reverse;
        if (def.relation)
            delete def.relation.reverse;
        if (target)
            await this.saveSchema(target);
        await this.saveSchema(db);
    }
    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    /** notified after an entry is saved (e.g. to refresh views live while an entry page is open) */
    rowListeners = new Set();
    onRowSaved(fn) { this.rowListeners.add(fn); return () => this.rowListeners.delete(fn); }
    emit() { [...this.listeners].forEach((f) => f()); this.wrote(); }
    /** after any change of the model that is saved (every write, undo, reload): cheap listeners that keep names,
     *  the sidebar and other chrome current. Called once per task, however many files were written. */
    writeListeners = new Set();
    writeQueued = false;
    /** the files written in this task; null = unknown (undo, reload …), i.e. anything may have changed */
    writtenPaths = new Set();
    onWrite(fn) { this.writeListeners.add(fn); return () => this.writeListeners.delete(fn); }
    wrote(path) {
        if (path === undefined)
            this.writtenPaths = null;
        else
            this.writtenPaths?.add(path);
        if (this.writeQueued)
            return;
        this.writeQueued = true;
        queueMicrotask(() => {
            const paths = this.writtenPaths;
            this.writeQueued = false;
            this.writtenPaths = new Set();
            [...this.writeListeners].forEach((f) => { try {
                f(paths);
            }
            catch (e) {
                console.error(e);
            } });
        });
    }
    // ---------- load ----------
    static async open(target, opts = {}) {
        const ws = new Workspace(target);
        const dir = APP.workspaceDir;
        // storages that can hand over everything at once (the local server) are read in one request
        let storage = target;
        if (target.readTree) {
            try {
                storage = new MemoryStorage('snapshot', Object.fromEntries(await target.readTree([''], ['md', 'json'])));
            }
            catch {
                storage = target;
            }
        }
        const readText = async (p) => { try {
            const t = await storage.read(p);
            ws.cache.set(p, t);
            return t;
        }
        catch {
            return null;
        } };
        const readJson = async (p, fallback) => {
            const t = await readText(p);
            try {
                return t == null ? fallback : JSON.parse(t);
            }
            catch {
                return fallback;
            }
        };
        ws.meta = { ...ws.meta, ...(await readJson(`${dir}/workspace.json`, {})) };
        ws.settings = upgradeSettings({ ...DEFAULT_SETTINGS, ...(await readJson(`${dir}/settings.json`, {})) });
        ws.applyDeviceSettings();
        ws.keymap = await readJson(`${dir}/keymap.json`, {});
        // Dropbox "conflicted copy" files are not loaded as pages or entries; they are listed for the conflict view
        const conflict = (path) => { const orig = conflictOriginal(path); if (orig)
            ws.conflicts.push({ path, original: orig }); return !!orig; };
        // every file: pages and databases can sit in any folder (the folders follow the sidebar)
        let all = null;
        try {
            all = target.listAll ? await target.listAll() : null;
        }
        catch {
            all = null;
        }
        if (!all)
            all = await walkAll(storage);
        ws.files = new Set(all.filter((p) => !/^\.workspace\/(history|trash|unused-files|fetched)\//.test(p)));
        for (const p of all)
            if (p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes('/'))
                conflict(p);
        const texts = all.filter((p) => /\.(md|json)$/i.test(p) && !NOT_CONTENT.test(p) && !conflict(p));
        const dbDirs = new Set(texts.filter((p) => baseOf(p) === 'database.json').map(dirOf).filter((d) => d));
        const dbOf = (p) => {
            const d = dirOf(p);
            if (dbDirs.has(d))
                return d;
            if (baseOf(d) === 'rows' && dbDirs.has(dirOf(d)))
                return dirOf(d);
            return undefined;
        };
        // the text files, in one go where the storage can
        let textOf = readText;
        if (target.readTree && storage === target) {
            try {
                const got = new Map(await target.readTree([''], ['md', 'json']));
                textOf = async (p) => { const t = got.get(p); if (t != null)
                    ws.cache.set(p, t); return t ?? readText(p); };
            }
            catch { /* one by one */ }
        }
        // pages: every .md that isn't an entry (also sub-pages of entries, in the entry's folder)
        const pageFiles = texts.filter((p) => p.toLowerCase().endsWith('.md') && !dbOf(p));
        await Promise.all(pageFiles.map(async (file) => {
            const text = await textOf(file);
            if (text == null)
                return;
            const p = parsePageFile(text, file);
            // only files with Nook's id inside are pages; other Markdown files (notes put there by hand, copies left from
            // a Notion import) are files
            if (!/^---[\s\S]*?\nid:/m.test(text.slice(0, 400)))
                return;
            // the same page twice (a copy made in Finder, or a move that didn't reach Dropbox): the one in its place counts
            const had = ws.pages.get(p.id);
            if (had) {
                const rank = (f) => (pageFolder(f) ? 2 : f.startsWith('pages/') ? 0 : 1);
                if (rank(had.file) >= rank(file)) {
                    ws.dupFiles.push(file);
                    return;
                }
                ws.dupFiles.push(had.file);
            }
            ws.pages.set(p.id, p);
        }));
        await Promise.all([...dbDirs].map(async (base) => {
            const raw = await readJsonAt(textOf, `${base}/database.json`);
            if (!raw)
                return;
            const { key: savedKey, ...schema } = raw;
            const views = (await readJsonAt(textOf, `${base}/views.json`)) ?? [];
            let key = savedKey || baseOf(base);
            for (let i = 2; ws.dbs.has(key); i++)
                key = `${savedKey || baseOf(base)}-${i}`;
            const db = new Database(key, schema, views.length ? views : [defaultView(schema)]);
            db.dir = base;
            if (db.schema.files) {
                await loadFileRows(ws, db, textOf);
                ws.dbs.set(key, db);
                return;
            }
            const rowFiles = texts.filter((p) => p.toLowerCase().endsWith('.md') && dbOf(p) === base);
            const rows = await Promise.all(rowFiles.map(async (f) => { const t = await textOf(f); if (t == null)
                return null; const r = parseRow(t, baseOf(f)); r.file = f; return r; }));
            const byId = new Map();
            for (const r of rows) {
                if (!r)
                    continue;
                const had = byId.get(r.id);
                // twice: the one named after it (not in rows/) counts, the other goes when the folder is tidied
                if (had) {
                    const inRows = (x) => dirOf(x.file) !== base;
                    if (inRows(had) && !inRows(r)) {
                        ws.dupFiles.push(had.file);
                        byId.set(r.id, r);
                    }
                    else
                        ws.dupFiles.push(r.file);
                    continue;
                }
                byId.set(r.id, r);
            }
            db.rows = [...byId.values()];
            ws.dbs.set(key, db);
        }));
        // with the folders following the sidebar, a page's place decides its parent (a folder moved in Finder moves the page)
        if (ws.layout2) {
            ws.adoptNames();
            const byFolder = new Map();
            for (const p of ws.pages.values()) {
                const f = pageFolder(p.file) ?? ws.adopted.get(p.id);
                if (f)
                    byFolder.set(f.toLowerCase(), p);
            }
            const rowByFolder = new Map();
            for (const db of ws.dbs.values())
                for (const r of db.rows)
                    if (r.file)
                        rowByFolder.set(r.file.replace(/\.md$/i, '').toLowerCase(), `row:${db.key}:${r.id}`);
            for (const p of ws.pages.values()) {
                const f = pageFolder(p.file) ?? ws.adopted.get(p.id);
                const container = f ? dirOf(f) : dirOf(p.file);
                const up = byFolder.get(container.toLowerCase());
                // in a page's folder: its sub-page; right in Pages/: at the top; anywhere else: where its file says
                const parent = up && up !== p ? up.id : rowByFolder.get(container.toLowerCase()) ?? (container.toLowerCase() === PAGES.toLowerCase() ? undefined : p.parent);
                if (parent !== p.parent) {
                    p.parent = parent;
                    ws.placeChanged.add(p.id);
                }
            }
        }
        // repairs that write only once the copy is up to date (with Dropbox, the first check for changes made on
        // other devices): done on an older copy, they would overwrite newer files and make conflicts
        if (opts.repair !== false)
            await ws.repairs();
        return ws;
    }
    /** repairs that write: only once the copy is up to date (with Dropbox, the first check for changes made on
        other devices) – done on an older copy, they would overwrite newer files and make conflicts. Only for the
        workspace that is shown (a copy opened just to compare must not move files under the shown one). */
    async repairs() {
        const run = async () => {
            await this.dropPhantomLinks().catch(() => 0);
            await this.ensureSubpageBlocks().catch(() => 0);
            if (this.layout2) {
                await this.saveAdopted().catch((e) => console.warn('names', e));
                await this.arrange(undefined, true).catch((e) => console.warn('arrange', e));
            }
            await this.relinkFiles().catch((e) => console.warn('relink', e));
        };
        if (this.storage.whenFresh)
            void this.whenFresh().then(run);
        else
            await run();
    }
    /**
     * Links to files that are no longer where they point (moved into the new folders, by Nook or by hand): pointed at
     * the file of the same name – next to the page or entry first, else the only file of that name in the workspace.
     * Names that lost their short prefix in the move ("ab12cd-Plan.pdf" → "Plan.pdf") are found too. Returns how many.
     */
    async relinkFiles() {
        const byName = new Map();
        const isFileRef = (r) => /\.[A-Za-z0-9]{1,8}$/.test(r) && !/\.md$/i.test(r) && r.includes('/') && !/^[a-z][a-z0-9+.-]*:/i.test(r);
        for (const f of this.files)
            if (isFileRef(f) && !/^\.workspace\//.test(f)) {
                const k = baseOf(f).toLowerCase();
                byName.set(k, [...(byName.get(k) ?? []), f]);
            }
        const missing = (r) => isFileRef(r) && !this.files.has(r) && !this.files.has(safeDecode(r));
        const fixes = new Map();
        const resolve = (ref, owner) => {
            if (fixes.has(ref))
                return;
            const raw = safeDecode(ref), base = baseOf(raw), short = base.replace(/^[a-z0-9]{6}-/, '');
            const dir = pageFolder(owner) ?? owner.replace(/\.md$/i, '');
            for (const b of [base, short]) {
                const here = join(dir, b);
                if (this.files.has(here)) {
                    fixes.set(ref, here);
                    return;
                }
            }
            for (const b of [base, short]) {
                const all = byName.get(b.toLowerCase()) ?? [];
                const near = all.filter((f) => f.startsWith(dir + '/'));
                const pick = near.length === 1 ? near[0] : all.length === 1 ? all[0] : null;
                if (pick) {
                    fixes.set(ref, pick);
                    return;
                }
            }
        };
        const fromText = (owner, text) => { for (const m of text.matchAll(/(?:src="|\]\(<?|^cover: "?)([^"()<>\n]+?\.[A-Za-z0-9]{1,8})(?=[">\n)])/gm))
            if (missing(m[1]))
                resolve(m[1], owner); };
        const fromValues = (owner, o) => { if (typeof o === 'string') {
            if (missing(o))
                resolve(o, owner);
        }
        else if (Array.isArray(o))
            o.forEach((x) => fromValues(owner, x));
        else if (o && typeof o === 'object')
            Object.values(o).forEach((x) => fromValues(owner, x)); };
        for (const p of this.pages.values()) {
            fromText(p.file, serializePage(p.blocks));
            if (p.cover && missing(p.cover))
                resolve(p.cover, p.file);
        }
        for (const d of this.dbs.values())
            for (const r of d.rows) {
                const own = this.rowPath(d, r);
                fromText(own, r.body);
                fromValues(own, r.values);
                if (r.icon && missing(r.icon))
                    resolve(r.icon, own);
            }
        for (const [a, b] of fixes)
            await this.repath(a, b);
        if (fixes.size)
            this.emit();
        return fixes.size;
    }
    /** links to files that point at nothing (after relinkFiles): each with its page or entry, and where else it may have been */
    missingFiles() {
        const isFileRef = (r) => /\.[A-Za-z0-9]{1,8}$/.test(r) && !/\.md$/i.test(r) && r.includes('/') && !/^[a-z][a-z0-9+.-]*:/i.test(r);
        const out = [];
        // Dropbox ignores upper/lower case, and Macs and iPhones may spell an umlaut as two characters (ä = a + ¨):
        // a file only counts as missing when no file matches in any of these spellings. (Dropbox's own listing,
        // used on Mac and iPhone, doesn't always give folders the case they were created with; a Windows folder does.)
        const norm = (x) => x.normalize('NFC').toLowerCase();
        const have = new Set([...this.files].map(norm));
        const add = (ref, owner, title) => {
            const raw = safeDecode(ref);
            if (!isFileRef(raw) || have.has(norm(raw)) || have.has(norm(ref)) || out.some((x) => x.ref === ref))
                return;
            const dir = pageFolder(owner) ?? owner.replace(/\.md$/i, '');
            const base = baseOf(raw), short = base.replace(/^[a-z0-9]{6}-/, '');
            // where it was, and where the move to the new folders would have put it
            out.push({ ref, owner, title, places: [...new Set([raw, join(dir, short), join(dir, base)])] });
        };
        const fromText = (owner, title, text) => { for (const m of text.matchAll(/(?:src="|\]\(<?|^cover: "?)([^"()<>\n]+?\.[A-Za-z0-9]{1,8})(?=[">\n)])/gm))
            add(m[1], owner, title); };
        const fromValues = (owner, title, o) => { if (typeof o === 'string')
            add(o, owner, title);
        else if (Array.isArray(o))
            o.forEach((x) => fromValues(owner, title, x));
        else if (o && typeof o === 'object')
            Object.values(o).forEach((x) => fromValues(owner, title, x)); };
        for (const p of this.pages.values()) {
            fromText(p.file, p.title, serializePage(p.blocks));
            if (p.cover)
                add(p.cover, p.file, p.title);
        }
        for (const d of this.dbs.values())
            for (const r of d.rows) {
                const own = this.rowPath(d, r);
                const t = `${d.schema.name} · ${String(r.values[d.titleProp] ?? 'Untitled')}`;
                fromText(own, t, r.body);
                fromValues(own, t, r.values);
            }
        return out;
    }
    /**
     * A missing file found again: it goes where it belongs – next to its page or entry, under its name without the
     * short prefix – and the link points there. `data`: the file's content; or null when it already is at `at`
     * (restored by Dropbox), then it is moved to its place.
     */
    async putBackFile(ref, owner, data, at) {
        const raw = safeDecode(ref);
        const dir = this.layout2 ? (pageFolder(owner) ?? owner.replace(/\.md$/i, '')) : dirOf(raw);
        const name = baseOf(raw).replace(/^[a-z0-9]{6}-/, '');
        // the link already points at the right place: the file goes exactly there
        let to = dirOf(raw) === dir ? raw : join(dir, name);
        if (to !== raw && this.files.has(to)) {
            const ext = name.match(/\.[^.]+$/)?.[0] ?? '';
            to = join(dir, uniqueName(name.slice(0, name.length - ext.length), this.takenIn(dir), ext));
        }
        if (data)
            await this.writeFile(to, data);
        else if (at && at !== to) {
            if (!this.storage.move)
                throw new Error('This storage cannot move files.');
            await this.storage.move(at, to);
            this.files.delete(at);
            this.files.add(to);
        }
        this.files.add(to);
        if (to !== ref)
            await this.repath(ref, to);
        return to;
    }
    /** after restoring: the file is back in this list (so links to it work right away) */
    noteFile(path) { this.files.add(path); }
    /** Create the skeleton of a brand-new, empty workspace. */
    static async create(storage, name) {
        const ws = new Workspace(storage);
        ws.meta.name = name;
        const home = {
            id: ulid(), title: 'Home', icon: '⌂', blocks: parsePage(`Welcome to ${APP.name}. Type / for blocks.\n`), file: '',
        };
        ws.meta.layout = 2;
        home.file = ws.newPageFile('Home', undefined, home.id);
        ws.pages.set(home.id, home);
        ws.meta.home = home.id;
        await ws.saveMeta();
        await ws.saveSettings();
        await ws.savePage(home);
        await ws.write(`${APP.workspaceDir}/keymap.json`, '{}\n');
        ws.past = [];
        return ws;
    }
    // ---------- file writes (all go through here, so they can be undone) ----------
    /** an undo step for a file written outside the workspace's own helpers (notifications, reminders) */
    recordFile(path, before, after) { if (before === after)
        return; this.boundary(); this.record({ path, before, after }); this.cache.set(path, after); this.lastWrite = 0; }
    record(c) {
        if (this.applying)
            return;
        const now = Date.now();
        const group = now - this.lastWrite < 800 ? this.past[this.past.length - 1] : undefined;
        this.lastWrite = now;
        if (group) {
            const same = group.find((x) => x.path === c.path);
            if (same)
                same.after = c.after;
            else
                group.push(c);
        }
        else
            this.past.push([c]);
        if (this.past.length > 200)
            this.past.shift();
        this.future = [];
    }
    /** Writes a file; `history: false` keeps it out of undo (workspace settings, shortcuts). */
    async write(path, data, history = true) {
        const before = this.cache.has(path) ? this.cache.get(path) : null;
        if (before === data)
            return;
        if (history)
            this.record({ path, before, after: data });
        if (history && before != null && keepable(path))
            void this.snapshot(path, before);
        this.cache.set(path, data);
        this.files.add(path);
        this.wrote(path);
        try {
            await this.queue(path, () => this.storage.write(path, data));
        }
        catch (e) {
            // not on disk: forget it, so the next attempt really writes again
            if (this.cache.get(path) === data)
                this.cache.set(path, before);
            throw e;
        }
    }
    /** a file of the workspace that isn't part of the model (e.g. calendar sync settings); null if missing */
    async readExtra(path, fresh = false) {
        if (!fresh && this.cache.has(path))
            return this.cache.get(path) ?? null;
        try {
            const t = await this.storage.read(path);
            this.cache.set(path, t);
            return t;
        }
        catch {
            return null;
        }
    }
    /** a loaded file's content (pages and entries are always loaded); null if missing */
    readExtraSync(path) { return this.cache.get(path) ?? null; }
    /** resolves once every write that has started is on disk */
    async idle() { while (this.writing.size)
        await Promise.allSettled([...this.writing.values()]); }
    /** true when another snapshot of the folder has different files than this one knows */
    differsFrom(other) {
        // the files that make the model: pages, databases, entries and the workspace's own settings
        const counts = (k) => (/\.(md|json)$/i.test(k) && !NOT_CONTENT.test(k)) || /^\.workspace\/(workspace|settings|keymap)\.json$/.test(k);
        let n = 0;
        for (const [k, v] of other.cache) {
            if (v == null || !counts(k))
                continue;
            n++;
            if (this.cache.get(k) !== v)
                return true;
        }
        for (const [k, v] of this.cache)
            if (v != null && counts(k))
                n--;
        if (n !== 0)
            return true;
        // other files (pictures put into a page's folder, say) came or went
        const bin = (ws) => [...ws.files].filter((f) => !/\.(md|json)$/i.test(f) && !f.startsWith('.workspace/')).sort().join('\n');
        return bin(this) !== bin(other);
    }
    /** writes to the same file happen one after another, in order (the last edit always wins) */
    writing = new Map();
    queue(path, op) {
        const prev = this.writing.get(path) ?? Promise.resolve();
        const next = prev.catch(() => { }).then(op);
        this.writing.set(path, next);
        next.finally(() => { if (this.writing.get(path) === next)
            this.writing.delete(path); }).catch(() => { });
        return next;
    }
    async removeFile(path, history = true) {
        const before = this.cache.get(path) ?? null;
        if (history)
            this.record({ path, before, after: null });
        if (history && before != null && (keepable(path) || trashable(path)))
            await this.toTrash(path, before);
        this.cache.set(path, null);
        this.files.delete(path);
        await this.queue(path, () => this.storage.remove(path));
    }
    /** Remove a file from the undo history (an empty new entry that was discarded again). */
    forgetFile(path) {
        this.past = this.past.map((g) => g.filter((c) => c.path !== path)).filter((g) => g.length);
        this.lastWrite = 0;
    }
    /** Start a new undo step even if the next write follows quickly. */
    boundary() { this.lastWrite = 0; }
    canUndo() { return this.past.length > 0; }
    canRedo() { return this.future.length > 0; }
    async undo() { return this.step(this.past, this.future, 'before'); }
    async redo() { return this.step(this.future, this.past, 'after'); }
    async step(from, to, side) {
        const group = from.pop();
        if (!group)
            return false;
        this.applying = true;
        try {
            const list = side === 'before' ? [...group].reverse() : group;
            for (const c of list) {
                const content = c[side];
                if (content == null) {
                    await this.storage.remove(c.path).catch(() => { });
                    this.cache.set(c.path, null);
                }
                else {
                    await this.storage.write(c.path, content);
                    this.cache.set(c.path, content);
                }
                this.applyFile(c.path, content);
            }
        }
        finally {
            this.applying = false;
        }
        to.push(group);
        await this.ensureSubpageBlocks().catch(() => 0);
        this.lastWrite = 0;
        this.emit();
        return true;
    }
    /** Bring the in-memory model in line with one file's content (after undo/redo). */
    applyFile(path, content) {
        const dir = APP.workspaceDir;
        const json = (fallback) => { try {
            return content == null ? fallback : JSON.parse(content);
        }
        catch {
            return fallback;
        } };
        if (path === `${dir}/workspace.json`) {
            this.meta = { ...this.meta, ...json({}) };
            return;
        }
        if (path === `${dir}/settings.json`) {
            this.settings = upgradeSettings({ ...DEFAULT_SETTINGS, ...json({}) });
            return;
        }
        if (path === `${dir}/keymap.json`) {
            const k = json({});
            for (const x of Object.keys(this.keymap))
                delete this.keymap[x];
            Object.assign(this.keymap, k);
            return;
        }
        const w = this.whatIs(path);
        if (!w)
            return;
        if (w.kind === 'page') {
            const old = [...this.pages.values()].find((p) => p.file === path);
            if (old)
                this.pages.delete(old.id);
            if (content != null) {
                const p = parsePageFile(content, path);
                this.pages.set(p.id, p);
            }
            return;
        }
        if (w.kind === 'schema') {
            const raw = json(null);
            const schema = raw ? (({ key: _k, ...rest }) => rest)(raw) : null;
            const db = w.db;
            if (db && schema) {
                db.schema = schema;
                db.reorderFormulas();
            }
            else if (!db && schema) {
                const key = raw.key || baseOf(dirOf(path));
                const d = new Database(key, schema, [defaultView(schema)]);
                d.dir = dirOf(path);
                this.dbs.set(key, d);
            }
            else if (db && !schema)
                this.dbs.delete(db.key);
            return;
        }
        const db = w.db;
        if (!db)
            return;
        if (w.kind === 'views') {
            db.views = json([]);
            if (!db.views.length)
                db.views = [defaultView(db.schema)];
            return;
        }
        const r = content != null ? parseRow(content, baseOf(path)) : null;
        db.rows = db.rows.filter((x) => x.file !== path && (!r || x.id !== r.id));
        if (r) {
            r.file = path;
            db.rows.push(r);
        }
        db.invalidate();
    }
    /** the entry a file belongs to (also by an older path, databases/<key>/rows/<id>.md) */
    rowAt(path) {
        for (const db of this.dbs.values())
            for (const row of db.rows)
                if (row.file === path)
                    return { db, row };
        const m = path.match(/^databases\/([^/]+)\/rows\/(.+)\.md$/);
        const db = m ? this.dbs.get(m[1]) : undefined;
        const row = db?.byId(m[2]);
        return db && row ? { db, row } : null;
    }
    /** is this file the one a loaded page or entry lives in? */
    whatIsLoaded(f) {
        for (const p of this.pages.values())
            if (p.file === f)
                return true;
        for (const d of this.dbs.values())
            for (const r of d.rows)
                if (r.file === f)
                    return true;
        return false;
    }
    /** what a file of the workspace is: a page, a database's settings or views, an entry */
    whatIs(path) {
        if (NOT_CONTENT.test(path))
            return null;
        const d = dirOf(path), b = baseOf(path);
        const dbAt = (dir) => [...this.dbs.values()].find((x) => x.dir === dir);
        if (b === 'database.json')
            return { kind: 'schema', db: dbAt(d) };
        if (b === 'views.json')
            return { kind: 'views', db: dbAt(d) };
        if (!/\.md$/i.test(b))
            return null;
        const db = dbAt(d) ?? (baseOf(d) === 'rows' ? dbAt(dirOf(d)) : undefined);
        const legacy = path.match(/^databases\/([^/]+)\/rows\//);
        if (db || legacy)
            return { kind: 'row', db: db ?? this.dbs.get(legacy[1]) };
        return { kind: 'page' };
    }
    // ---------- save ----------
    async saveMeta() { await this.write(`${APP.workspaceDir}/workspace.json`, JSON.stringify(this.meta, null, 2) + '\n', false); }
    async saveSettings() {
        // with an own appearance on this device, those settings stay here; the file keeps the workspace's
        const dev = this.deviceSettings();
        let out = this.settings;
        if (dev) {
            const mine = {};
            out = { ...this.settings };
            for (const k of DEVICE_KEYS) {
                mine[k] = this.settings[k];
                if (this.sharedLook[k] === undefined)
                    delete out[k];
                else
                    out[k] = this.sharedLook[k];
            }
            this.setDeviceSettings(mine);
        }
        else
            for (const k of DEVICE_KEYS)
                this.sharedLook[k] = this.settings[k];
        await this.write(`${APP.workspaceDir}/settings.json`, JSON.stringify(out, null, 2) + '\n', false);
    }
    // ---------- appearance per device ----------
    // Settings → Appearance → "Own appearance on this device": theme, colours, font, scale, layout and
    // widths are kept in this browser / app only, so a big screen and a laptop can differ.
    /** the workspace's own values of the appearance settings (what the file says) */
    sharedLook = {};
    deviceKey() { return `nook:device:${this.storage.label}:${this.meta.name}`; }
    deviceSettings() {
        try {
            const v = JSON.parse(localStorage.getItem(this.deviceKey()) ?? 'null');
            return v && typeof v === 'object' ? v : null;
        }
        catch {
            return null;
        }
    }
    setDeviceSettings(v) {
        try {
            if (v)
                localStorage.setItem(this.deviceKey(), JSON.stringify(v));
            else
                localStorage.removeItem(this.deviceKey());
        }
        catch { /* not kept */ }
    }
    /** after reading settings.json: remember the workspace's values, then use this device's own */
    applyDeviceSettings() {
        this.sharedLook = {};
        for (const k of DEVICE_KEYS)
            this.sharedLook[k] = this.settings[k];
        const dev = this.deviceSettings();
        if (dev)
            for (const k of DEVICE_KEYS) {
                if (dev[k] === undefined)
                    delete this.settings[k];
                else
                    this.settings[k] = dev[k];
            }
    }
    get deviceLook() { return !!this.deviceSettings(); }
    /** on: this device starts from the current look and keeps its changes · off: back to the workspace's look */
    setDeviceLook(on) {
        if (on) {
            const mine = {};
            for (const k of DEVICE_KEYS)
                mine[k] = this.settings[k];
            this.setDeviceSettings(mine);
        }
        else {
            this.setDeviceSettings(null);
            for (const k of DEVICE_KEYS) {
                const v = this.sharedLook[k];
                if (v === undefined)
                    delete this.settings[k];
                else
                    this.settings[k] = v;
            }
        }
    }
    async saveKeymap() { await this.write(`${APP.workspaceDir}/keymap.json`, JSON.stringify(this.keymap, null, 2) + '\n', false); }
    /** `history: false` for moves (a rename of the file): Ctrl+Z must never take a page away */
    async savePage(p, history = true) {
        const meta = { id: p.id, title: p.title, icon: p.icon ?? null, cover: p.cover ?? null, parent: p.parent ?? null };
        if (p.coverWidth)
            meta.coverWidth = p.coverWidth;
        if (p.coverHeight)
            meta.coverHeight = p.coverHeight;
        if (p.coverY !== undefined)
            meta.coverY = p.coverY;
        if (p.layoutWidth !== undefined)
            meta.layoutWidth = p.layoutWidth;
        if (p.layoutWidth === undefined && p.fullWidth)
            meta.fullWidth = true;
        if (p.layoutWidth === undefined && p.width && !p.fullWidth)
            meta.width = p.width;
        if (p.order !== undefined)
            meta.order = p.order;
        if (p.backlinks)
            meta.backlinks = p.backlinks;
        if (p.remindAt?.length)
            meta.remind_at = p.remindAt.join(',');
        await this.write(p.file, formatDoc(meta, serializePage(p.blocks)), history);
        // moved to another parent (sidebar): its folder follows
        const f = this.layout2 && !this.arranging && !this.placing ? pageFolder(p.file) : null;
        if (f && dirOf(f).toLowerCase() !== this.containerFor(p.parent).toLowerCase())
            void this.placePage(p).catch((e) => console.warn('placePage', e));
    }
    // ---------- names on disk follow the names in Nook ----------
    /** a comments / history file that belongs to `from` moves along to `to` */
    /** the side folders' contents, while arranging (listed once, not for every file) */
    sideNames = null;
    async moveSideFiles(moves) {
        if (!moves.length)
            return;
        for (const dir of [this.commentsDir, HISTORY_DIR]) {
            let names = this.sideNames?.get(dir);
            if (!names) {
                names = new Set((await this.storage.list(dir).catch(() => [])).map((e) => e.name));
                this.sideNames?.set(dir, names);
            }
            for (const [from, to] of moves) {
                const a = `${dir}/${slugPath(from)}.json`, b = `${dir}/${slugPath(to)}.json`;
                if (!names.has(a.split('/').pop()) || a === b)
                    continue;
                names.delete(a.split('/').pop());
                names.add(b.split('/').pop());
                // history while arranging: only renamed (in the same batch as everything else)
                if (dir === HISTORY_DIR && this.moveBatch) {
                    await this.moveNow([[a, b]]);
                    continue;
                }
                try {
                    const text = await this.storage.read(a);
                    let out = text;
                    try {
                        const j = JSON.parse(text);
                        if (j && typeof j === 'object' && 'path' in j)
                            j.path = to;
                        out = JSON.stringify(j, null, dir === this.commentsDir ? 2 : undefined) + '\n';
                    }
                    catch { /* keep as it is */ }
                    await this.storage.write(b, out);
                    this.cache.set(b, out);
                    await this.storage.remove(a);
                    this.cache.set(a, null);
                }
                catch { /* a side file that can't be moved stays where it was */ }
            }
        }
    }
    /** a page's file is named after its title ("pages/<title>-<id>.md"): after a rename it moves along
        (the id stays, so links, subpages and favorites keep working) */
    async renamePageFile(p) {
        if (this.layout2)
            return this.placePage(p);
        const file = `pages/${slug(p.title) || 'page'}-${p.id}.md`;
        if (file === p.file)
            return false;
        const from = p.file;
        p.file = file;
        await this.savePage(p, false);
        await this.removeFile(from, false);
        // undo steps that still name the old file now mean the new one
        for (const g of [...this.past, ...this.future])
            for (const c of g)
                if (c.path === from)
                    c.path = file;
        await this.moveSideFiles([[from, file]]);
        return true;
    }
    /** a database's folder is named after it ("databases/<name>/"): after a rename it moves along, and
        everything that points at it follows (views and buttons on pages and in entries, relations of other
        databases, favorites, shortcuts, calendar syncs, comments and history of its entries) */
    async renameDatabaseFolder(db) {
        // with the folders following the sidebar the key stays: only the folder's name follows
        if (this.layout2) {
            await this.placeDb(db);
            if (db.schema.files)
                buildRows(this, db);
            return null;
        }
        // a database of files keeps its folder (its files would have to be copied over)
        if (db.schema.files)
            return null;
        const base = slug(db.schema.name) || 'database';
        const old = db.key;
        if (base === old || old.replace(/-\d+$/, '') === base)
            return null;
        let key = base, i = 2;
        while (this.dbs.has(key) || (await this.storage.exists(`databases/${key}/database.json`).catch(() => false)))
            key = `${base}-${i++}`;
        // 1. the files, written under the new name first; the old folder goes only when everything is there
        const files = [
            [`databases/${key}/database.json`, JSON.stringify(db.schema, null, 2) + '\n'],
            [`databases/${key}/views.json`, JSON.stringify(db.views, null, 2) + '\n'],
            ...db.rows.map((r) => [`databases/${key}/rows/${r.id}.md`, this.cache.get(`databases/${old}/rows/${r.id}.md`) ?? formatRow(db, r)]),
        ];
        for (const [path, text] of files) {
            await this.storage.write(path, text);
            this.cache.set(path, text);
        }
        this.dbs.delete(old);
        db.key = key;
        this.dbs.set(key, db);
        for (const k of [...this.cache.keys()])
            if (k.startsWith(`databases/${old}/`))
                this.cache.set(k, null);
        // the old folder must not stay a database (it would show up twice): at least its database.json goes
        await this.storage.remove(`databases/${old}`).catch(() => { });
        if (await this.storage.exists(`databases/${old}/database.json`).catch(() => false))
            await this.storage.remove(`databases/${old}/database.json`).catch(() => { });
        for (const g of [...this.past, ...this.future])
            for (const c of g)
                if (c.path.startsWith(`databases/${old}/`))
                    c.path = `databases/${key}/` + c.path.slice(`databases/${old}/`.length);
        // 2. everything that points at it
        const fix = (blocks) => {
            let changed = false;
            const retarget = (target) => { const ref = parseRowTarget(target); return ref?.db === old ? rowTarget(key, ref.id) : target; };
            walkBlocks(blocks, (b) => {
                if (b.target) {
                    const target = retarget(b.target);
                    if (target !== b.target) {
                        b.target = target;
                        changed = true;
                    }
                }
                if (b.text) {
                    const text = b.text.replace(/nook:(row:[^\s)"<>]+)/g, (_m, target) => `nook:${retarget(target)}`);
                    if (text !== b.text) {
                        b.text = text;
                        changed = true;
                    }
                }
                if (b.type === 'view' && b.db === old) {
                    b.db = key;
                    changed = true;
                }
                if (b.type === 'button') {
                    if (b.action === 'opendb' && b.target === old) {
                        b.target = key;
                        changed = true;
                    }
                    if (b.action === 'add' && b.target === old) {
                        b.target = key;
                        changed = true;
                    }
                    for (const st of b.steps ?? []) {
                        if ((st.type === 'add' || st.type === 'edit') && st.db === old) {
                            st.db = key;
                            changed = true;
                        }
                        if (st.type === 'open') {
                            const target = retarget(st.target);
                            if (target !== st.target) {
                                st.target = target;
                                changed = true;
                            }
                        }
                        if (st.type === 'open' && st.target === `db:${old}`) {
                            st.target = `db:${key}`;
                            changed = true;
                        }
                    }
                }
            });
            return changed;
        };
        for (const p of this.pages.values())
            if (fix(p.blocks))
                await this.savePage(p);
        // only bodies that mention the old key can point at it (parsing every entry would be slow)
        const mentions = (t) => t.includes(old) || t.includes(encodeURIComponent(old));
        for (const d of this.dbs.values()) {
            for (const r of d.rows) {
                if (!r.body || !mentions(r.body))
                    continue;
                const blocks = parsePage(r.body);
                if (fix(blocks)) {
                    r.body = serializePage(blocks);
                    await this.saveRow(d, r, { keepEdited: true });
                }
            }
            let schemaChanged = false;
            for (const prop of d.schema.properties)
                if (prop.relation?.db === old) {
                    prop.relation.db = key;
                    schemaChanged = true;
                }
            for (const t of d.schema.templates ?? [])
                if (t.body && mentions(t.body)) {
                    const blocks = parsePage(t.body);
                    if (fix(blocks)) {
                        t.body = serializePage(blocks);
                        schemaChanged = true;
                    }
                }
            if (schemaChanged)
                await this.saveSchema(d);
        }
        const st = this.settings;
        const ref = (v) => (v === `db:${old}` ? `db:${key}` : v);
        st.favorites = (st.favorites ?? []).map(ref);
        for (const j of st.jumps ?? [])
            if (j.open)
                j.open = ref(j.open);
        for (const a of st.actions ?? [])
            if (a.db === old)
                a.db = key;
        await this.saveSettings();
        // the calendars shown in its views
        const calPath = `${APP.workspaceDir}/calendars.json`;
        const cal = await this.readExtra(calPath, true);
        if (cal) {
            try {
                const c = JSON.parse(cal);
                const rekey = (x) => (x.startsWith(`${old}:`) ? key + x.slice(old.length) : x);
                for (const sub of c.subscriptions ?? []) {
                    if (sub.hiddenIn)
                        sub.hiddenIn = sub.hiddenIn.map(rekey);
                    if (sub.showIn)
                        sub.showIn = sub.showIn.map(rekey);
                }
                await this.write(calPath, JSON.stringify(c, null, 2) + '\n', false);
            }
            catch { /* leave it */ }
        }
        // comments and history of its entries
        await this.moveSideFiles(db.rows.map((r) => [`databases/${old}/rows/${r.id}.md`, `databases/${key}/rows/${r.id}.md`]));
        db.invalidate();
        this.emit();
        return key;
    }
    // ---------- the folders follow the sidebar (layout 2, see layout.ts) ----------
    /** where things inside a page go (its sub-pages, its files): the page's folder */
    folderOf(p) { return pageFolder(p.file) ?? dirOf(p.file); }
    /** an entry's own folder (its files): next to its file, with the same name */
    rowFolder(db, r) { return this.rowPath(db, r).replace(/\.md$/i, ''); }
    /** the folder a page with this parent belongs in */
    containerFor(parent) {
        const top = this.layout2 ? PAGES : '';
        if (!parent)
            return top;
        if (parent.startsWith('row:')) {
            const ref = parseRowTarget(parent);
            const db = ref ? this.dbs.get(ref.db) : undefined;
            const r = ref && db?.byId(ref.id);
            return db && r ? this.rowFolder(db, r) : top;
        }
        const pp = this.pages.get(parent);
        return pp ? pageFolder(pp.file) ?? top : top;
    }
    /** the names in a folder, leaving out one (the thing being named, so it may keep its name) */
    takenIn(dir, self) { const t = namesIn(dir, this.files); if (self)
        t.delete(self.toLowerCase()); if (!dir) {
        t.add('.workspace');
        t.add('comments');
        t.add('assets');
    } return t; }
    /** the file a new page gets */
    newPageFile(title, parent, id) {
        if (!this.layout2)
            return `pages/${slug(title) || 'page'}-${id}.md`;
        const c = this.containerFor(parent);
        const name = uniqueName(safeName(title), this.takenIn(c));
        const file = join(join(c, name), `${name}.md`);
        this.files.add(file);
        return file;
    }
    /** what an entry's file is called: its name, else its date, else "Untitled" */
    rowName(db, r) {
        const t = plainText(String(r.values[db.titleProp] ?? '')).trim();
        if (t)
            return safeName(t);
        const d = db.schema.properties.find((p) => p.type === 'date');
        const v = d ? asDate(r.values[d.name]) : null;
        return v?.start ? safeName(v.start.replace('T', ' ')) : 'Untitled';
    }
    newRowFile(db, r) {
        if (!this.layout2)
            return `databases/${db.key}/rows/${r.id}.md`;
        const taken = this.takenIn(db.dir);
        taken.add('database.json');
        taken.add('views.json');
        taken.add('rows');
        const file = join(db.dir, uniqueName(this.rowName(db, r), taken, '.md'));
        this.files.add(file);
        return file;
    }
    /** a path for a file added on a page or entry (`owner`: the page's or entry's file): next to it, else in assets/ */
    newFilePath(owner, name) {
        const safe = safeName(name.replace(/\.[^.]+$/, '')) + (name.match(/\.[^.\s/]{1,8}$/)?.[0] ?? '');
        if (!this.layout2 || !owner)
            return `assets/${ulid().slice(-6).toLowerCase()}-${safe}`;
        const dir = pageFolder(owner) ?? owner.replace(/\.md$/i, '');
        const ext = safe.match(/\.[^.]+$/)?.[0] ?? '';
        const path = join(dir, uniqueName(safe.slice(0, safe.length - ext.length), this.takenIn(dir), ext));
        this.files.add(path);
        return path;
    }
    /** files in a page's or entry's folder that it doesn't show (put there in Finder, say) – `used`: its text */
    looseFiles(owner, used) {
        if (!this.layout2)
            return [];
        const dir = pageFolder(owner) ?? owner.replace(/\.md$/i, '');
        const pageFiles = new Set([...this.pages.values()].map((p) => p.file));
        return [...this.files].filter((f) => dirOf(f) === dir && !/\.json$/i.test(f) && !pageFiles.has(f) && !baseOf(f).startsWith('.') && !used.includes(f) && !used.includes(encodeURI(f))).sort((a, b) => a.localeCompare(b));
    }
    /** stores a file (picture, PDF …) */
    async writeFile(path, data) {
        if (!this.storage.writeBinary)
            throw new Error('This workspace cannot store files');
        await this.storage.writeBinary(path, data);
        this.files.add(path);
    }
    /** moves waiting to go out together (arrange: one batch instead of hundreds) */
    moveBatch = null;
    /** every move done while arranging (to undo them if the check afterwards fails) */
    moveLog = null;
    moveProgress;
    /** links to fix once the batch of moves is out (arrange) */
    relinks = [];
    async moveNow(pairs) {
        if (!pairs.length)
            return;
        if (this.moveBatch) {
            this.moveBatch.push(...pairs);
            return;
        }
        this.moveLog?.push(...pairs);
        const st = this.storage;
        if (st.moveMany) {
            if (st.remote || pairs.length <= 50) {
                await st.moveMany(pairs);
                return;
            }
            for (let i = 0; i < pairs.length; i += 50) {
                this.moveProgress?.(`Moving · ${Math.min(i + 50, pairs.length).toLocaleString()} of ${pairs.length.toLocaleString()}`);
                await st.moveMany(pairs.slice(i, i + 50));
            }
            return;
        }
        if (!st.move)
            throw new Error('This storage cannot move files.');
        for (const [a, b] of pairs) {
            if (st.movesFolders || [...this.files].every((f) => f === b || !f.startsWith(a + '/'))) {
                await st.move(a, b).catch((e) => { if (!/not found/i.test(String(e)))
                    throw e; });
                continue;
            }
            // a folder, on a storage that moves only files: file by file
            for (const f of [...this.files])
                if (f.startsWith(a + '/'))
                    await st.move(f, b + f.slice(a.length)).catch(() => { });
        }
    }
    async flushMoves() {
        await this.flushMovesOnly();
        const rl = this.relinks;
        this.relinks = [];
        for (const [a, b] of rl)
            await this.repath(a, b);
    }
    async flushMovesOnly() { const b = this.moveBatch; this.moveBatch = []; if (b?.length) {
        const keep = this.moveBatch;
        this.moveBatch = null;
        try {
            await this.moveNow(b);
        }
        finally {
            this.moveBatch = keep;
        }
    } }
    /** after a move on disk: every path in Nook follows (pages, databases, entries, undo steps, the known files) */
    rebase(from, to) {
        const re = (p) => (p === from || p.startsWith(from + '/') ? to + p.slice(from.length) : p);
        for (const p of this.pages.values())
            p.file = re(p.file);
        for (const d of this.dbs.values()) {
            d.dir = re(d.dir);
            for (const r of d.rows)
                if (r.file)
                    r.file = re(r.file);
        }
        this.cache = new Map([...this.cache].map(([k, v]) => [re(k), v]));
        this.files = new Set([...this.files].map(re));
        this.dupFiles = this.dupFiles.map(re);
        for (const g of [...this.past, ...this.future])
            for (const c of g)
                c.path = re(c.path);
    }
    /** links to files that moved (pictures, PDFs, covers) point at their new place – in pages and entries */
    async repath(from, to) {
        const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), escU = encodeURI(from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const inText = new RegExp(`(^|[("'<])(${esc}|${escU})(?=[/)"'\\s>|]|$)`, 'g');
        const fix = (v) => (v === from || v.startsWith(from + '/') ? to + v.slice(from.length) : v.includes(from) || v.includes(encodeURI(from)) ? v.replace(inText, (_m, pre, hit) => pre + (hit === from ? to : encodeURI(to))) : v);
        const deep = (o) => {
            let changed = false;
            if (Array.isArray(o))
                o.forEach((x, i) => { if (typeof x === 'string') {
                    const n = fix(x);
                    if (n !== x) {
                        o[i] = n;
                        changed = true;
                    }
                }
                else if (x && typeof x === 'object')
                    changed = deep(x) || changed; });
            else if (o && typeof o === 'object')
                for (const [k, x] of Object.entries(o)) {
                    if (typeof x === 'string') {
                        const n = fix(x);
                        if (n !== x) {
                            o[k] = n;
                            changed = true;
                        }
                    }
                    else if (x && typeof x === 'object')
                        changed = deep(x) || changed;
                }
            return changed;
        };
        for (const p of this.pages.values()) {
            let ch = deep(p.blocks);
            if (p.cover) {
                const c = fix(p.cover);
                if (c !== p.cover) {
                    p.cover = c;
                    ch = true;
                }
            }
            if (p.icon) {
                const c = fix(p.icon);
                if (c !== p.icon) {
                    p.icon = c;
                    ch = true;
                }
            }
            if (ch)
                await this.savePage(p, false);
        }
        for (const d of this.dbs.values())
            for (const r of d.rows) {
                let ch = deep(r.values);
                const b = fix(r.body);
                if (b !== r.body) {
                    r.body = b;
                    ch = true;
                }
                if (r.icon) {
                    const c = fix(r.icon);
                    if (c !== r.icon) {
                        r.icon = c;
                        ch = true;
                    }
                }
                if (ch)
                    await this.saveRow(d, r, { keepEdited: true, history: false });
            }
    }
    /** moves a file or folder (and everything that points into it) */
    async relocate(from, to, opts = {}) {
        if (from === to)
            return;
        const mdMoved = [...this.files].filter((f) => (f === from || f.startsWith(from + '/')) && f.toLowerCase().endsWith('.md'));
        await this.moveNow([[from, to]]);
        this.rebase(from, to);
        if (opts.relink !== false) {
            if (this.moveBatch)
                this.relinks.push([from, to]);
            else
                await this.repath(from, to);
        }
        await this.moveSideFiles(mdMoved.map((f) => [f, to + f.slice(from.length)]));
    }
    /** a page goes where it belongs: in its parent's folder, named after it (after a rename or a move in the sidebar) */
    async placePage(p) {
        if (!this.layout2)
            return false;
        const cur = pageFolder(p.file);
        const c = this.containerFor(p.parent);
        if (cur && (cur === c || under(c, cur)))
            return false; // never into itself
        const keep = cur && dirOf(cur).toLowerCase() === c.toLowerCase() ? baseOf(cur) : undefined;
        const name = uniqueName(safeName(p.title), this.takenIn(c, keep), '', keep);
        const folder = join(c, name);
        if (cur) {
            if (cur === folder)
                return false;
            this.placing++;
            try {
                await this.relocate(cur, folder, { relink: false });
                await this.renameInnerFile(p, name);
                if (this.moveBatch)
                    this.relinks.push([cur, folder]);
                else
                    await this.repath(cur, folder);
            }
            finally {
                this.placing--;
            }
            return true;
        }
        // a single file (the old flat layout, or put in by hand): it becomes "<name>/<name>.md"
        await this.relocate(p.file, join(folder, `${name}.md`), { relink: false });
        return true;
    }
    /** after its folder got a new name, the page's file inside gets it too */
    async renameInnerFile(p, name) {
        const want = join(dirOf(p.file), `${name}.md`);
        if (want !== p.file)
            await this.relocate(p.file, want, { relink: false });
    }
    /** an entry's file (and its folder of files) named after it */
    async placeRow(db, r) {
        if (db.schema.files)
            return false;
        if (!this.layout2)
            return false;
        const cur = this.rowPath(db, r);
        const inPlace = dirOf(cur) === db.dir;
        const taken = this.takenIn(db.dir, inPlace ? baseOf(cur) : undefined);
        taken.add('database.json');
        taken.add('views.json');
        taken.add('rows');
        if (inPlace)
            taken.delete(stemOf(cur).toLowerCase());
        const name = uniqueName(this.rowName(db, r), taken, '.md', inPlace ? baseOf(cur) : undefined);
        const to = join(db.dir, name);
        if (to === cur)
            return false;
        // an older file without its id inside (the file name was the id): the id goes in first, or it would change with the name
        if (!/^_id:/m.test(this.cache.get(cur) ?? ''))
            await this.write(cur, formatRow(db, r), false);
        const oldDir = cur.replace(/\.md$/i, ''), newDir = to.replace(/\.md$/i, '');
        const hasDir = inPlace && [...this.files].some((f) => f.startsWith(oldDir + '/'));
        await this.relocate(cur, to, { relink: false });
        r.file = to;
        if (hasDir)
            await this.relocate(oldDir, newDir);
        return true;
    }
    rowTimers = new Map();
    /** renaming an entry's file waits until typing pauses */
    placeRowSoon(db, r) {
        if (!this.layout2 || this.arranging)
            return;
        const k = `${db.key}:${r.id}`;
        clearTimeout(this.rowTimers.get(k));
        this.rowTimers.set(k, setTimeout(() => { this.rowTimers.delete(k); if (db.rows.includes(r))
            void this.placeRow(db, r).catch((e) => console.warn('placeRow', e)); }, 2500));
        this.rowTimers.get(k)?.unref?.();
    }
    /** a database's folder: named after it (in the folder of the page that shows it, when it is new to this layout) */
    async placeDb(db) {
        if (!this.layout2)
            return false;
        const inPlace = dirOf(db.dir) === DATABASES;
        const keep = inPlace ? baseOf(db.dir) : undefined;
        const name = uniqueName(safeName(db.schema.name), this.takenIn(DATABASES, keep), '', keep);
        const to = join(DATABASES, name);
        if (to === db.dir)
            return false;
        await this.relocate(db.dir, to, { relink: false });
        return true;
    }
    arranging = false;
    /** a page is being moved: saving pages meanwhile doesn't move them again */
    placing = 0;
    /**
     * Brings every page, database, entry and file to its place (pages as folders like the sidebar, entries named
     * after them, files from assets/ next to the page or entry that shows them). The first time this turns an
     * older workspace into the new layout; afterwards it tidies what came in another way (an import, a file put
     * into the folder by hand, a page moved in Finder). Resolves with how many things moved.
     */
    async arrange(progress, light = false) {
        if (!this.layout2 || this.arranging)
            return 0;
        if (light) {
            // on opening only a few things that came in another way; many out of place means an arrangement that didn't
            // finish – that is never redone file by file over the network
            let todo = 0;
            for (const p of this.pages.values())
                if (!pageFolder(p.file))
                    todo++;
            for (const db of this.dbs.values()) {
                if (dirOf(db.dir) !== DATABASES)
                    todo += 50;
                for (const r of db.rows)
                    if (dirOf(this.rowPath(db, r)) !== db.dir)
                        todo++;
            }
            if (todo > 40) {
                console.warn(`arrange: ${todo} things out of place – left alone (Settings → Files)`);
                return 0;
            }
        }
        this.arranging = true;
        this.moveProgress = progress;
        let n = 0;
        this.moveBatch = [];
        this.sideNames = new Map();
        try {
            // 2. databases
            progress?.('Databases');
            const movedDbs = [];
            for (const db of this.dbs.values())
                if (await this.placeDb(db)) {
                    n++;
                    movedDbs.push(db);
                }
            await this.flushMoves();
            for (const db of movedDbs)
                await this.saveSchema(db);
            // 3. entries, by name
            progress?.('Entries');
            const total = [...this.dbs.values()].reduce((x, d) => x + d.rows.length, 0);
            let k = 0;
            for (const db of this.dbs.values())
                for (const r of db.rows) {
                    if (++k % 50 === 0)
                        progress?.(`Entries · ${k.toLocaleString()} of ${total.toLocaleString()}`);
                    if ((!light || dirOf(this.rowPath(db, r)) !== db.dir) && await this.placeRow(db, r))
                        n++;
                }
            // 3b. pages (after the entries: a sub-page of an entry goes into the entry's folder), parents first; their front matter follows where they are (moved in Finder)
            progress?.('Pages');
            const depth = (p) => { let d = 0; for (let x = p; x.parent && this.pages.has(x.parent) && d < 50; x = this.pages.get(x.parent))
                d++; return d; };
            // light (on opening): only what isn't in the layout yet – names that differ are left to renames in Nook
            k = 0;
            const all = [...this.pages.values()].sort((a, b) => depth(a) - depth(b));
            for (const p of all) {
                if (++k % 20 === 0)
                    progress?.(`Pages · ${k} of ${all.length}`);
                if ((!light || !pageFolder(p.file)) && await this.placePage(p))
                    n++;
            }
            await this.flushMoves();
            // 4. files in assets/ that a page or entry shows: next to it
            progress?.('Files');
            const assets = light ? [] : [...this.files].filter((f) => f.startsWith('assets/'));
            if (assets.length) {
                const owners = [];
                for (const p of this.pages.values())
                    owners.push({ file: p.file, text: serializePage(p.blocks) + '\n' + (p.cover ?? '') + '\n' + (p.icon ?? '') });
                for (const d of this.dbs.values())
                    for (const r of d.rows)
                        owners.push({ file: this.rowPath(d, r), text: JSON.stringify(r.values) + '\n' + r.body + '\n' + (r.icon ?? '') });
                const moves = [];
                for (const a of assets) {
                    const o = owners.find((x) => x.text.includes(a) || x.text.includes(encodeURI(a)));
                    const name = baseOf(a).replace(/^[a-z0-9]{6}-/, '');
                    // nothing shows it: into "Unused files" (yours to keep or delete), never deleted
                    const ext = name.match(/\.[^.]+$/)?.[0] ?? '';
                    const to = o ? this.newFilePath(o.file, name) : join(UNUSED, uniqueName(name.slice(0, name.length - ext.length), this.takenIn(UNUSED), ext));
                    if (!o)
                        this.files.add(to);
                    moves.push([a, to]);
                }
                for (const [a, b] of moves) {
                    await this.moveNow([[a, b]]);
                    this.rebase(a, b);
                    this.relinks.push([a, b]);
                }
                progress?.(`Files · moving ${moves.length.toLocaleString()}`);
                await this.flushMoves();
                n += moves.length;
            }
            await this.flushMoves();
            // 5. links to files that aren't where they were (a folder moved in Finder): the file of that name next to the page
            const broken = [];
            const look = (owner, text) => {
                const dir = pageFolder(owner) ?? owner.replace(/\.md$/i, '');
                for (const m of text.matchAll(/(?:src="|\]\(|"(?:src|cover)":"|^cover: )([^"()\n]+?\.[A-Za-z0-9]{1,8})(?=["\n)])/gm)) {
                    const ref = m[1];
                    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || this.files.has(ref) || !ref.includes('/'))
                        continue;
                    const here = join(dir, baseOf(ref));
                    if (this.files.has(here) && !broken.some(([a]) => a === ref))
                        broken.push([ref, here]);
                }
            };
            for (const p of this.pages.values())
                look(p.file, (this.cache.get(p.file) ?? '') + '\n' + serializePage(p.blocks));
            for (const d of this.dbs.values())
                for (const r of d.rows)
                    look(this.rowPath(d, r), JSON.stringify(r.values) + '\n' + r.body);
            for (const [a, b] of broken) {
                await this.repath(a, b);
                n++;
            }
            // 6. what follows from the folders, and pages put in by hand (they get their id written in)
            for (const id of this.placeChanged) {
                const p = this.pages.get(id);
                if (p)
                    await this.savePage(p, false);
            }
            this.placeChanged.clear();
            for (const p of this.pages.values())
                if (/^f[a-z0-9]+$/.test(p.id) && !this.cache.get(p.file)?.includes(`id: ${p.id}`))
                    await this.savePage(p, false);
            // 7. second copies of the same page or entry (into the trash)
            for (const f of this.dupFiles.splice(0))
                if (this.layout2 && !this.whatIsLoaded(f)) {
                    await this.removeFile(f);
                    n++;
                }
            // folders are never removed: on Dropbox a folder that looks empty here may still hold files whose move hasn't gone out
        }
        finally {
            this.moveBatch = null;
            this.relinks = [];
            this.sideNames = null;
            this.arranging = false;
            this.moveProgress = undefined;
        }
        if (n)
            this.emit();
        return n;
    }
    /** what must be the same before and after arranging: pages (with their parents), entries, other files */
    census() {
        // a parent that doesn't exist (deleted, or the page itself) counts as the top: that is where it shows
        const real = (p) => {
            const x = p.parent;
            if (!x || x === p.id)
                return '';
            if (x.startsWith('row:')) {
                const ref = parseRowTarget(x);
                return ref && this.dbs.get(ref.db)?.byId(ref.id) ? x : '';
            }
            return this.pages.has(x) ? x : '';
        };
        const pages = new Map([...this.pages.values()].map((p) => [p.id, { parent: real(p), title: p.title }]));
        const rows = [...this.dbs.values()].map((d) => `${d.key}:${d.rows.map((r) => r.id).sort().join(',')}`).sort().join('\n');
        const rowMap = new Map([...this.dbs.values()].flatMap((d) => d.rows.map((r) => [`${d.key}:${r.id}`, `“${plainText(String(r.values[d.titleProp] ?? '')) || 'Untitled'}” in ${d.schema.name}`])));
        const files = [...this.files].filter((f) => !/\.(md|json)$/i.test(f) && !f.startsWith('.workspace/') && !f.startsWith('comments/')).length;
        return { pages, rows, rowMap, files };
    }
    /** what differs between two censuses, in words (a few examples) */
    censusDiff(a, b) {
        const out = [];
        const name = (m, id) => (id ? (id.startsWith('row:') ? 'an entry' : `“${m.get(id)?.title ?? id}”`) : 'the top');
        for (const [id, x] of a.pages) {
            const y = b.pages.get(id);
            if (!y)
                out.push(`page “${x.title}” missing afterwards`);
            else if (x.parent !== y.parent)
                out.push(`page “${x.title}” was under ${name(a.pages, x.parent)}, afterwards under ${name(b.pages, y.parent)}`);
        }
        for (const [id, y] of b.pages)
            if (!a.pages.has(id))
                out.push(`page “${y.title}” new afterwards`);
        for (const [k, t] of a.rowMap)
            if (!b.rowMap.has(k))
                out.push(`entry ${t} missing afterwards`);
        for (const [k, t] of b.rowMap)
            if (!a.rowMap.has(k))
                out.push(`entry ${t} new afterwards`);
        if (a.files !== b.files)
            out.push(`other files: ${a.files} before, ${b.files} afterwards`);
        return out.join('\n');
    }
    /**
     * Arranges an older workspace once (Settings → Files), in a folder on this computer only – there every move is a
     * move on the disk, and the Dropbox app syncs the result. Before: a copy of every text file into
     * .workspace/before-arranging. After: the folder is opened again and compared (every page with its parent,
     * every entry, every other file). Anything different: every move is undone and the copies are put back.
     */
    async useFolderLayout(progress) {
        if (this.storage.remote)
            throw new Error('Open the workspace folder on your computer to arrange it (moving thousands of files over the network is not reliable).');
        if (this.layout2)
            return this.arrange(progress);
        await this.idle();
        const before = this.census();
        // 1. a copy of every text file (pages, entries, settings) – files like pictures are only moved, never changed
        progress?.('Copying for safety');
        // one file with all of them (thousands of small files would take minutes, and Dropbox would upload each)
        const texts = [...this.files].filter((f) => /\.(md|json)$/i.test(f) && !f.startsWith(`${APP.workspaceDir}/before-arranging`) && !/^\.workspace\/(history|trash)\//.test(f));
        const saved = new Map();
        let k = 0;
        for (const f of texts) {
            if (++k % 100 === 0)
                progress?.(`Copying for safety · ${k.toLocaleString()} of ${texts.length.toLocaleString()}`);
            const c = this.cache.get(f);
            try {
                saved.set(f, c ?? await this.storage.read(f));
            }
            catch { /* unreadable: left where it is */ }
        }
        await this.storage.write(`${APP.workspaceDir}/before-arranging.json`, JSON.stringify(Object.fromEntries(saved)));
        this.moveLog = [];
        let n = 0;
        try {
            this.meta.layout = 2;
            await this.saveMeta();
            // 2. the old folders aside first ("pages" and "Pages" are one folder on Windows and Mac)
            // comments go into .workspace (the top stays: Databases, Pages, Unused files)
            if ([...this.files].some((f) => f.startsWith('comments/'))) {
                await this.moveNow([['comments', `${APP.workspaceDir}/comments`]]);
                this.rebase('comments', `${APP.workspaceDir}/comments`);
            }
            for (const d of ['pages', 'databases'])
                if ([...this.files].some((f) => f.startsWith(d + '/')))
                    await this.relocate(d, `${APP.workspaceDir}/arranging/${d}`, { relink: false });
            for (const db of this.dbs.values())
                await this.saveSchema(db);
            n = await this.arrange(progress);
            await this.idle();
            // 3. the check: open it again and compare
            progress?.('Checking');
            const again = await Workspace.open(this.storage, { repair: false });
            const after = again.census();
            const diff = this.censusDiff(before, after);
            if (diff) {
                // everything that differs, each with where its file went and what it was read as
                const lines = diff.split('\n');
                const detail = [];
                for (const [k] of before.rowMap) {
                    if (after.rowMap.has(k))
                        continue;
                    const key = k.slice(0, k.indexOf(':')), id = k.slice(k.indexOf(':') + 1);
                    const d = this.dbs.get(key);
                    const r = d?.byId(id);
                    const f = r ? this.rowPath(d, r) : '?';
                    const t = await this.storage.read(f).catch(() => null);
                    const there = [...again.pages.values()].find((p) => p.file === f) ? 'a page' : [...again.dbs.values()].find((x) => x.rows.some((y) => y.file === f)) ? 'another entry' : again.conflicts.some((c) => c.path === f) ? 'a Dropbox conflict copy' : 'nothing';
                    detail.push(`  entry ${before.rowMap.get(k)}: file “${f}” ${t == null ? 'is not there' : `read as ${there}`}`);
                }
                for (const [id] of before.pages)
                    if (!after.pages.has(id)) {
                        const p = this.pages.get(id);
                        detail.push(`  page “${p?.title}”: file “${p?.file}”`);
                    }
                const report = [`Nook – arranging the folder: ${lines.length} difference${lines.length === 1 ? '' : 's'} (nothing was changed)`, '', ...lines, ...(detail.length ? ['', 'Where their files went:', ...detail] : [])].join('\n');
                const err = new Error(`after arranging: ${lines.length} difference${lines.length === 1 ? '' : 's'} – ${lines[0]}${lines.length > 1 ? ' …' : ''}`);
                err.report = report;
                throw err;
            }
        }
        catch (e) {
            // 4. back as it was
            progress?.('Putting everything back');
            for (const [a, b] of [...(this.moveLog ?? [])].reverse())
                await this.storage.move(b, a).catch(() => { });
            for (const [f, t] of saved)
                await this.storage.write(f, t).catch(() => { });
            this.moveLog = null;
            const err = new Error(`${e.message} – everything was put back as it was`);
            err.report = e.report;
            throw err;
        }
        this.moveLog = null;
        // the emptied old folders go (on this computer the disk itself says they are empty)
        for (const d of [`${APP.workspaceDir}/arranging`, 'assets', ...[...this.dbs.values()].map((db) => `${db.dir}/rows`)]) {
            const left = (await this.storage.listAll?.().catch(() => null))?.some((f) => f.startsWith(d + '/'));
            if (left === false)
                await this.storage.remove(d).catch(() => { });
        }
        this.past = [];
        this.future = [];
        return n;
    }
    /**
     * The arrangement as a plan for Windows (Settings → Files → Prepare): it is worked out here on a copy in memory
     * (and checked there, as useFolderLayout does), then written to .workspace/arrange-plan.json – the script
     * "Arrange Nook (Windows)" carries it out with Windows' own file moves (seconds instead of minutes in a browser).
     * The plan holds what each file it changes must look like before (else it stops: changed since) and everything
     * to put it back.
     */
    async makeArrangePlan(progress) {
        if (this.layout2)
            throw new Error('This workspace already follows the sidebar.');
        await this.idle();
        progress?.('Reading');
        const PH = '\u0000file';
        const seed = {};
        let k = 0;
        for (const f of this.files) {
            if (++k % 200 === 0)
                progress?.(`Reading · ${k.toLocaleString()} of ${this.files.size.toLocaleString()}`);
            if (!/\.(md|json)$/i.test(f)) {
                seed[f] = PH;
                continue;
            }
            const c = this.cache.get(f);
            if (c != null) {
                seed[f] = c;
                continue;
            }
            try {
                seed[f] = await this.storage.read(f);
            }
            catch {
                seed[f] = PH;
            }
        }
        const before = new MemoryStorage('before', seed);
        const sim = new MemoryStorage('plan', seed);
        const moves = [];
        const move = sim.move.bind(sim);
        sim.move = async (a, b) => { await move(a, b); moves.push([a, b]); };
        progress?.('Working out the arrangement');
        const ws = await Workspace.open(sim, { repair: false });
        await ws.useFolderLayout((s) => progress?.(s));
        // the old state with only the moves applied: what is left to write or remove is the difference
        for (const [a, b] of moves)
            await before.move(a, b);
        const skip = (p) => p === `${APP.workspaceDir}/before-arranging.json`;
        const writes = [];
        const removes = [];
        // where a file was before the moves (to check it is unchanged since this plan was made)
        const origin = (p) => { for (let i = moves.length - 1; i >= 0; i--) {
            const [a, b] = moves[i];
            if (p === b || p.startsWith(b + '/'))
                p = a + p.slice(b.length);
        } return p; };
        for (const [p, t] of sim.files) {
            if (skip(p) || t === PH)
                continue;
            const was = before.files.get(p);
            if (was === t)
                continue;
            writes.push({ path: p, text: t, before: was ?? null, from: was != null ? origin(p) : null });
        }
        for (const [p, t] of before.files)
            if (!sim.files.has(p) && !skip(p))
                removes.push({ path: p, text: t === PH ? '' : t });
        if (removes.some((r) => r.text === ''))
            throw new Error('The plan would remove a file it cannot put back – not made.');
        const expect = [...sim.files.keys()].filter((p) => !skip(p) && !p.startsWith(`${APP.workspaceDir}/history/`));
        // emptied folders the script removes (only when empty): the old ones, and each database's old rows/
        const cleanup = [`${APP.workspaceDir}/arranging`, 'assets', 'comments', 'pages', 'databases', ...[...ws.dbs.values()].map((d) => `${d.dir}/rows`)];
        const plan = { nook: 'arrange-plan', version: 1, workspace: this.meta.name, made: new Date().toISOString(), moves, writes, removes, cleanup, expect, hide: [APP.workspaceDir] };
        const path = `${APP.workspaceDir}/arrange-plan.json`;
        await this.storage.write(path, JSON.stringify(plan));
        return { moves: moves.length, writes: writes.length, path };
    }
    /** pages (and entries) that show this database in a view block */
    usesOf(dbKey) {
        const out = [];
        const walk = (p, blocks) => { for (const b of blocks) {
            if (b.type === 'view' && b.db === dbKey)
                out.push({ page: p, block: b.id });
            if (b.children?.length)
                walk(p, b.children);
        } };
        for (const p of this.pages.values())
            walk(p, p.blocks);
        return out;
    }
    /** delete a database: its entries, views and settings go to the trash together (restorable for 30
        days); views of it on pages show that it is gone until it is restored */
    async deleteDatabase(db) {
        const outer = !this.batch;
        if (outer)
            this.batch = ulid();
        try {
            for (const r of [...db.rows])
                await this.removeFile(this.rowPath(db, r));
            await this.removeFile(`${db.dir}/views.json`);
            await this.removeFile(`${db.dir}/database.json`);
            this.dbs.delete(db.key);
            const fav = `db:${db.key}`;
            if (this.settings.favorites?.includes(fav)) {
                this.settings.favorites = this.settings.favorites.filter((x) => x !== fav);
                await this.saveSettings();
            }
        }
        finally {
            if (outer)
                this.batch = null;
        }
        this.emit();
    }
    async deletePage(p) {
        // its subpages go with it (as in Notion); undo brings everything back, and so does the trash
        const outer = !this.batch;
        if (outer)
            this.batch = ulid();
        try {
            for (const c of [...this.pages.values()].filter((x) => x.parent === p.id))
                await this.deletePage(c);
            await this.unlinkSubpage(p.parent, p.id);
            this.pages.delete(p.id);
            await this.removeFile(p.file);
        }
        finally {
            if (outer)
                this.batch = null;
        }
    }
    // ---------- Dropbox conflicts ----------
    // When two computers change the same file before Dropbox syncs, Dropbox keeps both: the other one as
    // "name (X's conflicted copy 2026-10-30).md". Nook lists these and lets you choose.
    conflicts = [];
    /** copies that differ from the file only in the "_edited" time (two devices saved the same thing): dropped quietly */
    /** resolves once this copy is up to date (with Dropbox: the first check for changes from other devices is in) –
     *  everything Nook writes by itself (repairs, data sources, tidying conflicts) waits for it */
    whenFresh() {
        return this.freshP ??= (this.storage.whenFresh ? this.storage.whenFresh().then(() => new Promise((r) => setTimeout(r, 1500))) : Promise.resolve());
    }
    freshP = null;
    async tidyConflicts() {
        const norm = (t) => t.replace(/\r\n?/g, '\n').replace(/^_?edited:.*$/gm, '').split('\n').map((l) => l.trimEnd()).join('\n').trim();
        const same = (a, b) => norm(a) === norm(b);
        let n = 0;
        for (const c of [...this.conflicts]) {
            try {
                const a = await this.storage.read(c.original), b = await this.storage.read(c.path);
                if (same(a, b)) {
                    await this.resolveConflict(c, 'mine');
                    n++;
                    continue;
                }
                // nothing really contradicts (bookkeeping, edit times, ids only one side has): merged, the copy goes
                const merged = autoMerge(c.original, a, b);
                if (merged !== null) {
                    if (merged !== a) {
                        await this.write(c.original, merged, false);
                        this.applyFile(c.original, merged);
                    }
                    await this.resolveConflict(c, 'mine');
                    n++;
                }
            }
            catch { /* leave it for the person */ }
        }
        return n;
    }
    async conflictText(c) { try {
        return await this.storage.read(c.path);
    }
    catch {
        return null;
    } }
    /** the file gets the text put together in the conflict window; the copy goes */
    async resolveConflictWith(c, text) {
        this.boundary();
        await this.write(c.original, text);
        this.applyFile(c.original, text);
        await this.storage.remove(c.path).catch(() => { });
        this.conflicts = this.conflicts.filter((x) => x.path !== c.path);
        this.emit();
    }
    /** keep: 'mine' (drop the copy), 'theirs' (the copy replaces the file), 'both' (the copy becomes a new page or entry) */
    async resolveConflict(c, keep) {
        const text = await this.conflictText(c);
        if (text != null && keep === 'theirs') {
            this.boundary();
            await this.write(c.original, text);
            this.applyFile(c.original, text);
        }
        else if (text != null && keep === 'both') {
            const id = ulid();
            const w = this.whatIs(c.original);
            if (w?.kind === 'page') {
                const p = parsePageFile(text, c.original);
                const copy = { ...p, id, title: `${p.title} (other version)`, file: this.newPageFile(`${p.title} (other version)`, p.parent, id) };
                this.pages.set(id, copy);
                await this.savePage(copy);
                await this.linkSubpage(copy.parent, id);
            }
            else {
                const db = w?.kind === 'row' ? w.db : undefined;
                if (db) {
                    const r = parseRow(text, `${id}.md`);
                    const copy = { ...r, id, values: { ...r.values, [db.titleProp]: `${String(r.values[db.titleProp] ?? '')} (other version)` } };
                    db.rows.push(copy);
                    await this.saveRow(db, copy);
                }
            }
        }
        await this.storage.remove(c.path).catch(() => { });
        this.conflicts = this.conflicts.filter((x) => x.path !== c.path);
        this.emit();
    }
    // ---------- trash ----------
    // Deleted pages and entries are kept in .workspace/trash for 30 days (one small JSON file each).
    batch = null;
    async toTrash(path, content) {
        const deleted = new Date().toISOString().slice(0, 19);
        const item = { path, content, deleted, batch: this.batch ?? undefined, file: '' };
        const file = `${TRASH_DIR}/${deleted.replace(/[-:T]/g, '')}-${ulid().slice(-6)}-${slugPath(path)}.json`;
        try {
            await this.storage.write(file, JSON.stringify({ ...item, file: undefined }) + '\n');
        }
        catch { /* the deletion itself still happens */ }
    }
    /** what is in the trash (newest first); old items (30 days) and items brought back by undo are cleaned up */
    async trash() {
        let files = [];
        try {
            if (this.storage.readAll)
                files = await this.storage.readAll(TRASH_DIR, 'json');
            else
                for (const e of await this.storage.list(TRASH_DIR))
                    if (e.name.endsWith('.json'))
                        files.push([e.name, await this.storage.read(`${TRASH_DIR}/${e.name}`)]);
        }
        catch {
            return [];
        }
        const limit = Date.now() - 30 * 864e5;
        const out = [];
        for (const [name, text] of files) {
            const file = `${TRASH_DIR}/${name.split('/').pop()}`;
            let item;
            try {
                item = { ...JSON.parse(text), file };
            }
            catch {
                continue;
            }
            if (new Date(item.deleted + 'Z').getTime() < limit || this.cache.get(item.path) != null) {
                this.storage.remove(file).catch(() => { });
                continue;
            }
            out.push(item);
        }
        return out.sort((a, b) => b.deleted.localeCompare(a.deleted));
    }
    /** brings an item back – with everything deleted together with it (a page's subpages) */
    async restore(item, all) {
        const rank = (x) => (/\/database\.json$/.test(x.path) ? 0 : /\/views\.json$/.test(x.path) ? 1 : 2);
        // a database first, then its views, then its entries
        const group = (item.batch && all ? all.filter((x) => x.batch === item.batch) : [item]).slice().sort((a, b) => rank(a) - rank(b));
        this.boundary();
        for (const x of group) {
            await this.write(x.path, x.content);
            this.applyFile(x.path, x.content);
            await this.storage.remove(x.file).catch(() => { });
        }
        // every restored page shows up in its parent's content again (its link was removed on deletion)
        for (const x of group) {
            const page = [...this.pages.values()].find((p) => p.file === x.path);
            if (page?.parent)
                await this.linkSubpage(page.parent, page.id);
        }
        this.boundary();
        this.emit();
        return group.length;
    }
    async deleteForever(item) { await this.storage.remove(item.file).catch(() => { }); }
    // ---------- history ----------
    // Earlier versions of pages and entries: at most one every 10 minutes per file, the last 50 kept,
    // in .workspace/history (one JSON file per page or entry).
    snapAt = new Map();
    /** keeps `content` as an earlier version of `path` (at most every 10 minutes) */
    async snapshot(path, content) {
        const now = Date.now();
        if (now - (this.snapAt.get(path) ?? 0) < 10 * 60_000)
            return;
        this.snapAt.set(path, now);
        const file = historyFile(path);
        await this.queue(file, async () => {
            let versions = [];
            try {
                versions = JSON.parse(await this.storage.read(file)).versions ?? [];
            }
            catch { /* first version */ }
            if (versions[versions.length - 1]?.content === content)
                return;
            versions.push({ t: new Date(now).toISOString().slice(0, 19), content });
            await this.storage.write(file, JSON.stringify({ path, versions: versions.slice(-50) }) + '\n');
        }).catch(() => { });
    }
    /** earlier versions of a file, newest first (the current content is not among them) */
    async versions(path) {
        await this.writing.get(historyFile(path))?.catch(() => { });
        try {
            return JSON.parse(await this.storage.read(historyFile(path))).versions.slice().reverse();
        }
        catch {
            return [];
        }
    }
    /** puts an earlier version back (undo works; the version that is replaced goes into the history) */
    async restoreVersion(path, content) {
        this.snapAt.delete(path);
        this.boundary();
        await this.write(path, content);
        this.applyFile(path, content);
        this.boundary();
        this.emit();
    }
    async saveSchema(db) {
        db.reorderFormulas();
        await this.write(`${db.dir}/database.json`, JSON.stringify(this.layout2 ? { key: db.key, ...db.schema } : db.schema, null, 2) + '\n');
    }
    async saveViews(db) {
        await this.write(`${db.dir}/views.json`, JSON.stringify(db.views, null, 2) + '\n');
    }
    /** `history: false` for changes that come from outside (calendar sync): they are not undone with Ctrl+Z */
    async saveRow(db, row, opts = {}) {
        if (db.schema.files) {
            await saveFileRow(this, db, row);
            this.rowListeners.forEach((f) => f(db, row));
            return;
        }
        if (!opts.keepEdited)
            row.edited = new Date().toISOString().slice(0, 19);
        db.invalidate(row.id);
        // formulas elsewhere may use rollups over this entry
        for (const d of this.dbs.values())
            if (d !== db)
                d.invalidate();
        await this.write(this.rowPath(db, row), formatRow(db, row), opts.history !== false);
        this.rowListeners.forEach((f) => f(db, row));
        this.placeRowSoon(db, row);
    }
    rowPath(db, row) { return row.file ??= this.newRowFile(db, row); }
    async deleteRow(db, row, opts = {}) {
        if (db.schema.files) {
            await removeFileRow(this, db, row);
            this.emit();
            return;
        }
        db.rows = db.rows.filter((r) => r !== row);
        await this.removeFile(this.rowPath(db, row), opts.history !== false);
        // subpages of the entry don't disappear with it: they go to the top level
        for (const p of [...this.pages.values()])
            if (p.parent === `row:${db.key}:${row.id}`) {
                delete p.parent;
                await this.savePage(p);
            }
        // deletions made by you (not by a sync) are reported, e.g. so calendar sync deletes the event
        for (const d of this.dbs.values())
            d.invalidate();
        this.wrote(this.rowPath(db, row));
    }
    /** a copy of an entry: values, page content, icon, repetition and reminder (a new id, created now) */
    async duplicateRow(db, r, values) {
        if (db.schema.files)
            return r;
        const now = new Date().toISOString().slice(0, 19);
        const c = { id: ulid(), values: values ?? structuredClone(r.values), body: r.body, created: now, edited: now };
        if (r.icon)
            c.icon = r.icon;
        if (r.repeat)
            c.repeat = r.repeat;
        if (r.except?.length)
            c.except = [...r.except];
        if (r.remind != null)
            c.remind = Array.isArray(r.remind) ? [...r.remind] : r.remind;
        db.rows.push(c);
        await this.saveRow(db, c);
        return c;
    }
    async addRow(db, values = {}, templateName) {
        // templateName '' = an empty entry (only explicitly supplied values)
        const tpl = templateName === '' ? undefined : db.schema.templates?.find((t) => t.name === (templateName ?? db.schema.defaultTemplate));
        const now = new Date().toISOString().slice(0, 19);
        // Resolve relative template dates ('@today' → today).
        const row = { id: ulid(), values: { ...resolveDefaults(tpl?.values), ...values }, body: tpl?.body ?? '', created: now, edited: now };
        db.rows.push(row);
        await this.saveRow(db, row);
        return row;
    }
    /** As in Notion, a subpage is also a link block in its parent's content (added at the end). */
    async linkSubpage(parentId, childId) {
        const parent = parentId ? this.pages.get(parentId) : undefined;
        if (!parent)
            return;
        let has = false;
        walkBlocks(parent.blocks, (b) => { if (b.type === 'pagelink' && b.target === childId)
            has = true; if (b.type === 'widget' && b.kind === 'preview' && Array.isArray(b.data?.pages) && b.data.pages.includes(childId))
            has = true; });
        if (has)
            return;
        // an empty last line is replaced instead of leaving it above the link
        const last = parent.blocks[parent.blocks.length - 1];
        if (last && last.type === 'paragraph' && !last.text && parent.blocks.length > 1)
            parent.blocks.pop();
        parent.blocks.push({ id: ulid(), type: 'pagelink', target: childId });
        await this.savePage(parent);
    }
    // ---------- unused files ----------
    // Files in assets/ that no page, entry, template, comment or deleted item (trash) points at any more.
    // Never automatic: on another computer Dropbox may not have synced every page yet.
    async unusedFiles() {
        const files = [];
        const walk = async (dir, depth) => {
            for (const e of await this.storage.list(dir).catch(() => [])) {
                const p = `${dir}/${e.name}`;
                if (e.kind === 'dir') {
                    if (depth < 8)
                        await walk(p, depth + 1);
                }
                else if (!e.name.startsWith('.') && !e.name.endsWith('.nook-tmp'))
                    files.push(p);
            }
        };
        await walk('assets', 0);
        // what already sits in "Unused files" (moved there by Nook: deleted files, leftovers when tidying)
        const parked = [...this.files].filter((f) => f.startsWith(UNUSED + '/') && !baseOf(f).startsWith('.')).sort();
        if (!files.length)
            return parked;
        const texts = [];
        for (const p of this.pages.values())
            texts.push(serializePage(p.blocks), p.icon ?? '', p.cover ?? '');
        for (const db of this.dbs.values()) {
            texts.push(JSON.stringify(db.schema), JSON.stringify(db.views));
            for (const r of db.rows)
                texts.push(JSON.stringify(r));
        }
        for (const v of this.cache.values())
            if (v)
                texts.push(v);
        const readDir = async (dir, ext) => {
            try {
                if (this.storage.readAll) {
                    for (const [, t] of await this.storage.readAll(dir, ext))
                        texts.push(t);
                    return;
                }
                for (const e of await this.storage.list(dir))
                    if (e.kind === 'file' && e.name.endsWith(`.${ext}`))
                        texts.push(await this.storage.read(`${dir}/${e.name}`).catch(() => ''));
            }
            catch { /* folder missing */ }
        };
        await readDir(this.commentsDir, 'json');
        await readDir(TRASH_DIR, 'json');
        await readDir(APP.workspaceDir, 'json');
        const all = texts.join('\n');
        const variants = (s) => [s, encodeURI(s), encodeURIComponent(s), JSON.stringify(s).slice(1, -1)];
        return [...files.filter((f) => {
                const rel = f.slice('assets/'.length);
                const name = f.split('/').pop();
                return ![...variants(f), ...variants(rel), ...variants(name)].some((v) => all.includes(v));
            }).sort(), ...parked];
    }
    /** is a file in assets/ used by any page or entry other than `skipFile` (the one it is being removed from)? */
    assetUsedElsewhere(path, skipFile) {
        const rel = path.replace(/^assets\//, '');
        const vs = [path, encodeURI(path), encodeURIComponent(path), encodeURI(rel), encodeURIComponent(rel)];
        const hit = (t) => vs.some((v) => t.includes(v));
        for (const p of this.pages.values())
            if (p.file !== skipFile && (hit(serializePage(p.blocks)) || hit(p.cover ?? '') || hit(p.icon ?? '')))
                return true;
        for (const db of this.dbs.values()) {
            if (hit(JSON.stringify(db.schema)))
                return true;
            for (const r of db.rows)
                if (this.rowPath(db, r) !== skipFile && hit(JSON.stringify(r)))
                    return true;
        }
        return false;
    }
    /** deletes a file from assets/ (after the person confirmed it) */
    async deleteAsset(path) {
        if (!path.startsWith('assets/') && (!this.layout2 || /\.(md|json)$/i.test(path) || path.startsWith('.workspace/')))
            return;
        this.files.delete(path);
        await this.storage.remove(path);
    }
    /** deletes files from assets/ for good; returns how many were deleted */
    async deleteUnusedFiles(paths) {
        let n = 0;
        for (const p of paths) {
            if (!p.startsWith('assets/') && !p.startsWith(UNUSED + '/'))
                continue;
            await this.storage.remove(p);
            this.files.delete(p);
            n++;
        }
        return n;
    }
    /** moves files into .workspace/unused-files/<date>/ (same sub-folders) – nothing is deleted; returns how many moved */
    async moveUnusedFiles(paths) {
        if (!this.storage.move)
            throw new Error('This storage cannot move files.');
        const base = this.layout2 ? `${UNUSED}/${todayISO()}` : `${APP.workspaceDir}/unused-files/${todayISO()}`;
        let n = 0;
        for (const p of paths) {
            if (!p.startsWith('assets/'))
                continue;
            const to = `${base}/${p.slice('assets/'.length)}`;
            await this.storage.move(p, to);
            this.files.delete(p);
            this.files.add(to);
            n++;
        }
        return n;
    }
    /**
     * The hard rule: a page that sits under another page in the sidebar has a link block in that page's content.
     * Missing links are added (at the end, in sidebar order). The blocks change synchronously – a caller that
     * builds an editor right after the call already sees them; saving follows without an undo step.
     * `only`: check just this parent page.
     */
    /** subpages whose link was cut (Ctrl+X) and not pasted yet: no link is added for them meanwhile */
    holdSubpages = new Set();
    /** links Nook added for Markdown files it briefly took for pages (0.8.x): they point at nothing, so they go */
    async dropPhantomLinks() {
        let n = 0;
        for (const p of this.pages.values()) {
            const keep = p.blocks.filter((b) => !(b.type === 'pagelink' && /^pl-f[0-9a-z]+$/.test(b.id) && !this.pages.has(b.target ?? '')));
            if (keep.length === p.blocks.length)
                continue;
            n += p.blocks.length - keep.length;
            p.blocks = keep.length ? keep : [{ id: ulid(), type: 'paragraph', text: '' }];
            await this.savePage(p, false);
        }
        return n;
    }
    async ensureSubpageBlocks(only) {
        const kids = new Map();
        for (const c of this.pages.values()) {
            if (!c.parent || c.parent === c.id || (only && c.parent !== only) || this.holdSubpages.has(c.id))
                continue;
            if (!this.pages.has(c.parent))
                continue;
            (kids.get(c.parent) ?? kids.set(c.parent, []).get(c.parent)).push(c);
        }
        const changed = [];
        let added = 0;
        for (const [pid, list] of kids) {
            const parent = this.pages.get(pid);
            const has = new Set();
            walkBlocks(parent.blocks, (b) => {
                if (b.type === 'pagelink' && b.target)
                    has.add(b.target);
                // a page preview block shows its pages – they don't need a block of their own
                if (b.type === 'widget' && b.kind === 'preview' && Array.isArray(b.data?.pages))
                    for (const id of b.data.pages)
                        has.add(id);
            });
            const missing = list.filter((c) => !has.has(c.id))
                .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || compareText(a.title, b.title));
            if (!missing.length)
                continue;
            const last = parent.blocks[parent.blocks.length - 1];
            if (last && last.type === 'paragraph' && !last.text && parent.blocks.length > 1)
                parent.blocks.pop();
            // the same id on every device (it is made from the subpage), so two devices adding it write the same file
            for (const c of missing)
                parent.blocks.push({ id: `pl-${c.id}`, type: 'pagelink', target: c.id });
            added += missing.length;
            changed.push(parent);
        }
        for (const p of changed)
            await this.savePage(p, false);
        return added;
    }
    /** remove the link blocks pointing at a page from another page's content */
    async unlinkSubpage(parentId, childId) {
        const parent = parentId ? this.pages.get(parentId) : undefined;
        if (!parent)
            return;
        let changed = false;
        // in place: an open editor keeps working on the same arrays
        const strip = (arr) => { for (let i = arr.length - 1; i >= 0; i--) {
            const b = arr[i];
            if (b.type === 'pagelink' && b.target === childId) {
                arr.splice(i, 1);
                changed = true;
            }
            else if (b.children)
                strip(b.children);
        } };
        strip(parent.blocks);
        if (!parent.blocks.length)
            parent.blocks.push({ id: ulid(), type: 'paragraph', text: '' });
        if (changed)
            await this.savePage(parent);
    }
    /** `linked`: the caller puts the link into the parent itself (e.g. the editor's “New subpage”) */
    async createPage(title, parent, linked = false) {
        const id = ulid();
        const p = { id, title, blocks: [{ id: ulid(), type: 'paragraph', text: '' }], parent, file: this.newPageFile(title, parent, id) };
        this.pages.set(id, p);
        await this.savePage(p);
        if (!linked)
            await this.linkSubpage(parent, id);
        return p;
    }
    /** A copy of a page with all its subpages (named "… (copy)", right below the original, linked in the parent's content). */
    async duplicatePage(src) {
        const map = new Map(); // old page id → new page id
        const collect = (p) => { map.set(p.id, ulid()); for (const c of this.pages.values())
            if (c.parent === p.id && !map.has(c.id))
                collect(c); };
        collect(src);
        const clone = (bs) => bs.map((b) => ({ ...JSON.parse(JSON.stringify(b)), id: ulid(), ...(b.type === 'pagelink' && b.target && map.has(b.target) ? { target: map.get(b.target) } : {}), ...(b.children ? { children: clone(b.children) } : {}) }));
        let top = null;
        for (const [oldId, id] of map) {
            const o = this.pages.get(oldId);
            const title = oldId === src.id ? `${o.title} (copy)` : o.title;
            const parent = oldId === src.id ? o.parent : map.get(o.parent) ?? o.parent;
            const p = { ...o, id, title, blocks: clone(o.blocks), parent, file: this.newPageFile(title, parent, id) };
            if (oldId === src.id) {
                p.order = o.order != null ? o.order + 0.5 : undefined;
                top = p;
            }
            this.pages.set(id, p);
            await this.savePage(p);
        }
        // the copy's link goes right after the original's link in the parent page
        const parent = src.parent ? this.pages.get(src.parent) : undefined;
        if (parent && top) {
            let placed = false;
            const put = (arr) => { for (let i = 0; i < arr.length && !placed; i++) {
                const b = arr[i];
                if (b.type === 'pagelink' && b.target === src.id) {
                    arr.splice(i + 1, 0, { id: ulid(), type: 'pagelink', target: top.id });
                    placed = true;
                }
                else if (b.children)
                    put(b.children);
            } };
            put(parent.blocks);
            if (placed)
                await this.savePage(parent);
            else
                await this.linkSubpage(parent.id, top.id);
        }
        return top;
    }
    /** A copy of a database: schema, views, templates and all entries, in a folder of its own ("… (copy)"). */
    async duplicateDatabase(src) {
        const name = `${src.schema.name} (copy)`;
        const base = slug(name) || 'database';
        let key = base, i = 2;
        while (this.dbs.has(key) || (await this.storage.exists(`databases/${key}/database.json`).catch(() => false)))
            key = `${base}-${i++}`;
        const schema = JSON.parse(JSON.stringify(src.schema));
        schema.name = name;
        // links to itself point at the copy; links to other databases become one-way (the other side keeps showing the original)
        for (const p of schema.properties)
            if (p.relation) {
                if (p.relation.db === src.key)
                    p.relation.db = key;
                else
                    delete p.relation.reverse;
            }
        const db = new Database(key, schema, JSON.parse(JSON.stringify(src.views)));
        if (this.layout2)
            db.dir = join(DATABASES, uniqueName(safeName(name), this.takenIn(DATABASES)));
        db.rows = src.rows.map((r) => { const c = JSON.parse(JSON.stringify(r)); delete c.file; return c; });
        this.dbs.set(key, db);
        await this.saveSchema(db);
        await this.saveViews(db);
        for (const r of db.rows)
            await this.write(this.rowPath(db, r), formatRow(db, r));
        this.emit();
        return db;
    }
    /** Rename a property everywhere: schema, views, formulas and every row file. */
    async renameProp(db, from, to) {
        const def = db.prop(from);
        if (!def || !to || db.prop(to))
            return;
        def.name = to;
        if (db.schema.dateLabel === from)
            db.schema.dateLabel = to;
        // its place on entry pages stays (the saved order of fields)
        if (db.schema.pageOrder)
            db.schema.pageOrder = db.schema.pageOrder.map((x) => (x === from ? to : x));
        for (const p of db.schema.properties)
            if (p.formula)
                p.formula = renameInFormula(p.formula, from, to);
        for (const v of db.views) {
            v.props = v.props?.map((x) => (x === from ? to : x));
            v.sorts?.forEach((s) => { if (s.prop === from)
                s.prop = to; });
            if (v.groupBy?.prop === from)
                v.groupBy.prop = to;
            if (v.period?.prop === from)
                v.period.prop = to;
            if (v.colorBy === from)
                v.colorBy = to;
            if (v.timeProp === from)
                v.timeProp = to;
            if (v.dateProp === from)
                v.dateProp = to;
            if (v.widths?.[from] !== undefined) {
                v.widths[to] = v.widths[from];
                delete v.widths[from];
            }
            if (v.aggregates?.[from] !== undefined) {
                v.aggregates[to] = v.aggregates[from];
                delete v.aggregates[from];
            }
            // alignment, wrapping, filling, colour rules and charts follow the new name too
            if (v.align?.[from] !== undefined) {
                v.align[to] = v.align[from];
                delete v.align[from];
            }
            for (const k of ['fill', 'wrap']) {
                const list = v[k];
                if (list)
                    v[k] = list.map((x) => (x === from ? to : x));
            }
            v.colorRules?.forEach((r) => { if (r.target === from)
                r.target = to; renameInFilter(r.filter, from, to); });
            if (v.chart?.groupBy === from)
                v.chart.groupBy = to;
            if (v.chart?.prop === from)
                v.chart.prop = to;
            renameInFilter(v.filter, from, to);
        }
        // relations and rollups that refer to this property (here and in other databases)
        for (const p of db.schema.properties)
            if (p.rollup?.relation === from)
                p.rollup.relation = to;
        for (const other of this.dbs.values()) {
            let changed = false;
            for (const p of other.schema.properties) {
                if (p.relation?.db === db.key && p.relation.reverse === from) {
                    p.relation.reverse = to;
                    changed = true;
                }
                if (p.rollup) {
                    const rel = other.prop(p.rollup.relation);
                    if (rel?.relation?.db === db.key && p.rollup.prop === from) {
                        p.rollup.prop = to;
                        changed = true;
                    }
                }
            }
            if (changed && other !== db)
                await this.saveSchema(other);
        }
        const touched = db.rows.filter((r) => from in r.values);
        for (const r of touched) {
            r.values[to] = r.values[from];
            delete r.values[from];
        }
        this.boundary();
        await this.saveSchema(db);
        await this.saveViews(db);
        // only entries that had a value change (the others keep their "last edited" time)
        for (let i = 0; i < touched.length; i += 32)
            await Promise.all(touched.slice(i, i + 32).map((r) => this.saveRow(db, r)));
        db.invalidate();
    }
    homePage() {
        return (this.meta.home && this.pages.get(this.meta.home)) || [...this.pages.values()].find((p) => !p.parent);
    }
}
export function parsePageFile(text, file) {
    const doc = parseDoc(text);
    return {
        id: String(doc.meta.id ?? file.split('/').pop().replace(/\.md$/, '')),
        title: String(doc.meta.title ?? 'Untitled'),
        icon: doc.meta.icon ? String(doc.meta.icon) : undefined,
        cover: doc.meta.cover ? String(doc.meta.cover) : undefined,
        coverWidth: doc.meta.coverWidth === 'page' ? 'page' : undefined,
        coverHeight: doc.meta.coverHeight === 's' || doc.meta.coverHeight === 'l' ? doc.meta.coverHeight : undefined,
        coverY: typeof doc.meta.coverY === 'number' && doc.meta.coverY >= 0 && doc.meta.coverY <= 100 ? doc.meta.coverY : undefined,
        fullWidth: doc.meta.fullWidth === true,
        layoutWidth: doc.meta.layoutWidth === 'full' ? 'full' : typeof doc.meta.layoutWidth === 'number' && Number.isFinite(doc.meta.layoutWidth) && doc.meta.layoutWidth >= 320 && doc.meta.layoutWidth <= 3840 ? doc.meta.layoutWidth : undefined,
        width: typeof doc.meta.width === 'number' && doc.meta.width >= 30 && doc.meta.width <= 100 ? doc.meta.width : undefined,
        parent: doc.meta.parent ? String(doc.meta.parent) : undefined,
        order: typeof doc.meta.order === 'number' ? doc.meta.order : undefined,
        backlinks: doc.meta.backlinks === 'expanded' || doc.meta.backlinks === 'collapsed' || doc.meta.backlinks === 'off' ? doc.meta.backlinks : undefined,
        remindAt: doc.meta.remind_at ? String(doc.meta.remind_at).split(',').map((x) => x.trim()).filter((x) => /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(x)) : undefined,
        blocks: parsePage(doc.body),
        file,
    };
}
function renameInFilter(g, from, to) {
    if (!g)
        return;
    for (const r of g.rules) {
        if ('rules' in r)
            renameInFilter(r, from, to);
        else if (r.prop === from)
            r.prop = to;
    }
}
export function defaultView(schema) {
    return { id: 'table', name: 'Table', type: 'table', props: schema.properties.map((p) => p.name) };
}
// ---------- row files ----------
export function parseRow(text, fileName) {
    const doc = parseDoc(text);
    const values = {};
    let id = fileName.replace(/\.md$/, ''), created = '', edited = '';
    let icon, repeat, except, remind, remindAt;
    for (const [k, v] of Object.entries(doc.meta)) {
        if (k === '_id')
            id = String(v);
        else if (k === '_created')
            created = dateStr(v);
        else if (k === '_edited')
            edited = dateStr(v);
        else if (k === '_icon')
            icon = String(v);
        else if (k === '_repeat')
            repeat = String(v);
        else if (k === '_except')
            except = (Array.isArray(v) ? v : [v]).map((x) => dateStr(x).slice(0, 10));
        else if (k === '_remind_at')
            remindAt = String(v).split(',').map((x) => x.trim()).filter((x) => /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(x));
        else if (k === '_remind') {
            const l = (Array.isArray(v) ? v : String(v).split(',')).map((x) => Number(String(x).trim())).filter((n) => !Number.isNaN(n));
            if (l.length)
                remind = l.length === 1 ? l[0] : l;
        }
        else
            values[k] = v;
    }
    const now = new Date().toISOString().slice(0, 19);
    const row = { id, values, body: doc.body, created: created || now, edited: edited || created || now };
    // entries made from a template before its dates were filled in kept "@today" / "@now": they get the day they were made
    for (const [k, v] of Object.entries(values)) {
        const st = typeof v === 'string' ? v : v && typeof v === 'object' && !Array.isArray(v) && 'start' in v ? v.start : undefined;
        if (st === '@today')
            values[k] = { start: row.created.slice(0, 10) };
        else if (st === '@now')
            values[k] = { start: row.created.slice(0, 16) };
    }
    if (icon)
        row.icon = icon;
    if (repeat)
        row.repeat = repeat;
    if (except?.length)
        row.except = except;
    if (remind !== undefined)
        row.remind = remind;
    if (remindAt?.length)
        row.remindAt = remindAt;
    return row;
}
const dateStr = (v) => (typeof v === 'object' && v && !Array.isArray(v) ? v.start : String(v ?? ''));
export function formatRow(db, row) {
    const meta = { _id: row.id };
    if (row.icon)
        meta._icon = row.icon;
    if (row.repeat)
        meta._repeat = row.repeat;
    if (row.except?.length)
        meta._except = row.except;
    if (row.remindAt?.length)
        meta._remind_at = row.remindAt.join(',');
    if (row.remind !== undefined)
        meta._remind = Array.isArray(row.remind) ? row.remind.join(',') : row.remind;
    for (const p of db.schema.properties) {
        if (p.type === 'formula' || p.type === 'rollup' || p.type === 'created_time' || p.type === 'last_edited_time')
            continue;
        const v = row.values[p.name];
        if (v !== undefined && v !== null && v !== '' && !(p.type === 'checkbox' && v === false))
            meta[p.name] = v;
    }
    // keep values of properties that were removed from the schema, so nothing is lost
    for (const [k, v] of Object.entries(row.values))
        if (!(k in meta) && !db.prop(k))
            meta[k] = v;
    meta._created = { start: row.created };
    meta._edited = { start: row.edited };
    return formatDoc(meta, row.body);
}
// ---------- querying ----------
/** weeks are enabled for a period switcher */
export const weeksOn = (p) => p.weeks === true || p.unit === 'week';
/** ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday) */
function isoWeek(iso) {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 3 - (d.getUTCDay() + 6) % 7);
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((d.getTime() - jan4.getTime()) / 864e5 - 3 + (jan4.getUTCDay() + 6) % 7) / 7);
}
/** a week's name in the period switcher */
export function weekLabel(start, last, how = 'range') {
    const mon = (iso) => MONTHS[+iso.slice(5, 7) - 1].slice(0, 3);
    const day = (iso) => String(+iso.slice(8, 10));
    // the week's number follows its Thursday (ISO), so it also fits weeks that start on Sunday
    const mid = new Date(Date.parse(start + 'T12:00:00Z') + 3 * 864e5).toISOString().slice(0, 10);
    if (how === 'kw')
        return `KW ${isoWeek(mid)}`;
    if (how === 'number')
        return `Week ${isoWeek(mid)}`;
    if (how === 'start')
        return `From ${day(start)} ${mon(start)}`;
    const y = last.slice(0, 4);
    if (start.slice(0, 7) === last.slice(0, 7))
        return `${day(start)} – ${day(last)} ${mon(last)} ${y}`;
    return `${day(start)} ${mon(start)}${start.slice(0, 4) !== y ? ' ' + start.slice(0, 4) : ''} – ${day(last)} ${mon(last)} ${y}`;
}
export function periodRange(p, offset, today = todayISO()) {
    if (p.unit === 'all')
        return null;
    const y = +today.slice(0, 4), m = +today.slice(5, 7);
    if (p.unit === 'week') {
        // Use UTC calendar arithmetic so DST never shortens or lengthens a week.
        const date = new Date(today + 'T12:00:00Z');
        const firstDay = (weekStart() + 1) % 7;
        date.setUTCDate(date.getUTCDate() - (date.getUTCDay() - firstDay + 7) % 7 + offset * 7);
        const start = date.toISOString().slice(0, 10);
        date.setUTCDate(date.getUTCDate() + 6);
        const last = date.toISOString().slice(0, 10);
        date.setUTCDate(date.getUTCDate() + 1);
        return { start, end: date.toISOString().slice(0, 10), label: weekLabel(start, last, p.weekLabel) };
    }
    if (p.unit === 'month') {
        const idx = y * 12 + (m - 1) + offset;
        const yy = Math.floor(idx / 12), mm = (idx % 12) + 1;
        const nIdx = idx + 1, ny = Math.floor(nIdx / 12), nm = (nIdx % 12) + 1;
        return { start: `${yy}-${pad2(mm)}-01`, end: `${ny}-${pad2(nm)}-01`, label: `${MONTHS[mm - 1]} ${yy}` };
    }
    const ys = p.yearStart ?? 1;
    const baseYear = (m >= ys ? y : y - 1) + offset;
    const start = `${baseYear}-${pad2(ys)}-01`;
    const end = `${baseYear + 1}-${pad2(ys)}-01`;
    const label = ys === 1 ? String(baseYear) : `${baseYear}/${String(baseYear + 1).slice(2)}`;
    return { start, end, label };
}
function matchRule(db, row, r) {
    const def = db.prop(r.prop);
    // a filter on a property that no longer exists filters nothing
    if (!def)
        return true;
    const v = def.type === 'relation' ? relationTitles(db, row, r.prop).join(', ') : db.value(row, r.prop);
    const isEmpty = v == null || v === '' || (Array.isArray(v) && !v.length);
    switch (r.op) {
        case 'empty': return isEmpty;
        case 'not_empty': return !isEmpty;
        case 'checked': return v === true;
        case 'unchecked': return v !== true;
    }
    if (def?.type === 'date' || def?.type === 'created_time' || def?.type === 'last_edited_time' || (def?.type === 'rollup' && (def.rollup?.fn === 'earliest' || def.rollup?.fn === 'latest'))) {
        const d = asDate(v);
        if (!d)
            return false;
        const target = resolveDate(r.value);
        const s = d.start.slice(0, 10);
        switch (r.op) {
            case 'before': return s < target;
            case 'after': return s > target;
            case 'on_or_before': return s <= target;
            case 'on_or_after': return s >= target;
            case 'is': return s === target;
        }
    }
    if (Array.isArray(v)) {
        const want = r.value;
        if (r.op === 'is' || r.op === 'contains')
            return v.includes(want);
        if (r.op === 'is_not' || r.op === 'not_contains')
            return !v.includes(want);
    }
    const sv = v == null ? '' : typeof v === 'object' ? v.start : String(v);
    const want = r.value;
    switch (r.op) {
        case 'is': return Array.isArray(want) ? want.includes(sv) : sv === String(want ?? '');
        case 'in': return Array.isArray(want) && want.includes(sv);
        case 'is_not': return Array.isArray(want) ? !want.includes(sv) : sv !== String(want ?? '');
        case 'contains': return sv.toLowerCase().includes(String(want ?? '').toLowerCase());
        case 'not_contains': return !sv.toLowerCase().includes(String(want ?? '').toLowerCase());
        case 'starts_with': return sv.toLowerCase().startsWith(String(want ?? '').toLowerCase());
        case 'gt': return Number(v) > Number(want);
        case 'lt': return Number(v) < Number(want);
        case 'gte': return Number(v) >= Number(want);
        case 'lte': return Number(v) <= Number(want);
    }
    return true;
}
/** Relative date tokens: today, yesterday, tomorrow, +30d, -7d, or an ISO date. */
export function resolveDate(v) {
    const t = todayISO();
    if (typeof v !== 'string' || !v)
        return t;
    if (v === 'today' || v === '@today' || v === 'now' || v === '@now')
        return t;
    const n = dayNum(t);
    if (v === 'yesterday')
        return new Date((n - 1) * 864e5).toISOString().slice(0, 10);
    if (v === 'tomorrow')
        return new Date((n + 1) * 864e5).toISOString().slice(0, 10);
    const m = v.match(/^([+-]\d+)d$/);
    if (m)
        return new Date((n + Number(m[1])) * 864e5).toISOString().slice(0, 10);
    return v.slice(0, 10);
}
/** conditional colours (View settings → Conditional color): the first matching rule colours the
    row (or card / calendar entry); rules for a property colour that cell (tables) */
export function ruleColors(db, view, row) {
    const out = {};
    for (const r of view.colorRules ?? []) {
        // "match:Status": the color of the entry's option in that property (conditions optional)
        const match = r.color.startsWith('match:') ? r.color.slice(6) : null;
        if (!match && !r.filter?.rules.length)
            continue;
        if (r.filter?.rules.length && !matchFilter(db, row, r.filter))
            continue;
        let color = r.color;
        if (match) {
            const v = db.value(row, match);
            const first = Array.isArray(v) ? v[0] : typeof v === 'boolean' ? null : v;
            if (first == null || first === '')
                continue;
            color = db.optionColor(match, String(first));
            if (!color || color === 'default')
                continue;
        }
        if (r.target) {
            out.cells ??= {};
            out.cells[r.target] ??= color;
        }
        else
            out.row ??= color;
    }
    return out;
}
export function matchFilter(db, row, g) {
    if (!g || !g.rules.length)
        return true;
    const test = (r) => ('rules' in r ? matchFilter(db, row, r) : matchRule(db, row, r));
    return g.mode === 'or' ? g.rules.some(test) : g.rules.every(test);
}
/** the names of the entries a relation links to */
function relationTitles(db, row, prop) {
    const l = db.linked(row, prop);
    return l ? l.rows.map((r) => l.db.rowLabel(r)) : [];
}
function sortKey(db, row, prop) {
    const def = db.prop(prop);
    const v = def?.type === 'relation' ? relationTitles(db, row, prop) : db.value(row, prop);
    // a checkbox is never empty: unchecked (no value) sorts as 0, checked as 1
    if (def?.type === 'checkbox')
        return v === true || v === 'true' ? 1 : 0;
    if (v == null || v === '')
        return '';
    if (typeof v === 'number')
        return v;
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    if (typeof v === 'object' && !Array.isArray(v))
        return v.start;
    if (def?.type === 'select' && def.options) {
        const i = def.options.findIndex((o) => o.name === v);
        return i < 0 ? 999 : i;
    }
    return String(Array.isArray(v) ? v.join(',') : v).toLowerCase();
}
/**
 * Sub-items: the rows of a view as a tree – each entry followed by its sub-items (when `open`), in the
 * view's order. When a filter hides a parent but shows its sub-items, the parent is shown dimmed above
 * them (as in Notion). With `addRows`, an open parent ends with a "+ New sub-item" line.
 */
export function nestRows(db, rows, open, addRows = false) {
    const p = db.schema.subItems?.parent;
    const files = !!db.schema.files, top = files ? folderOf(db) : '';
    if (!p && !files)
        return rows.map((row) => ({ row, depth: 0, kids: 0 }));
    if (files)
        addRows = false;
    // a database of files: a file's parent is its folder (above the folder the view shows: none)
    const parentRaw = files ? (r) => { const d = parentOf(r); return d && d !== top ? `d:${d}` : undefined; }
        : (r) => { const v = r.values[p]; const id = Array.isArray(v) ? v[0] : typeof v === 'string' ? v : undefined; return id && id !== r.id ? String(id) : undefined; };
    // the rows of the view plus the parents above them that the view leaves out
    const pos = new Map();
    const ghost = new Set();
    const byId = new Map();
    rows.forEach((r, i) => { pos.set(r.id, i); byId.set(r.id, r); });
    rows.forEach((r, i) => {
        const seen = new Set([r.id]);
        for (let pid = parentRaw(r); pid && !seen.has(pid);) {
            seen.add(pid);
            const pr = byId.get(pid) ?? db.byId(pid);
            if (!pr)
                break;
            if (!pos.has(pid)) {
                ghost.add(pid);
                byId.set(pid, pr);
                pos.set(pid, i);
            }
            else
                pos.set(pid, Math.min(pos.get(pid), i));
            pid = parentRaw(pr);
        }
    });
    const all = [...byId.values()].sort((a, b) => pos.get(a.id) - pos.get(b.id));
    const parentId = (r) => { const id = parentRaw(r); return id && byId.has(id) ? id : undefined; };
    const kids = new Map();
    const roots = [];
    for (const r of all) {
        const pid = parentId(r);
        if (pid)
            (kids.get(pid) ?? kids.set(pid, []).get(pid)).push(r);
        else
            roots.push(r);
    }
    // children in the view's order (a dimmed parent's own position doesn't count)
    const orig = new Map(rows.map((r, i) => [r.id, i]));
    for (const l of kids.values())
        l.sort((a, b) => (orig.get(a.id) ?? 1e9) - (orig.get(b.id) ?? 1e9) || pos.get(a.id) - pos.get(b.id));
    const out = [];
    const done = new Set();
    const walk = (r, depth) => {
        if (done.has(r.id))
            return;
        done.add(r.id);
        const ks = kids.get(r.id) ?? [];
        const g = ghost.has(r.id);
        out.push({ row: r, depth, kids: ks.length, ...(g ? { ghost: true } : {}) });
        if (ks.length && open(r.id, g)) {
            for (const k of ks)
                walk(k, depth + 1);
            if (addRows)
                out.push({ row: r, depth: depth + 1, kids: 0, add: true });
        }
    };
    for (const r of roots)
        walk(r, 0);
    // entries in a loop of parents (A under B under A) are shown at the top level
    const inLoop = (r) => { const seen = new Set(); for (let x = r; x;) {
        if (seen.has(x.id))
            return true;
        seen.add(x.id);
        const pid = parentId(x);
        x = pid ? byId.get(pid) : undefined;
    } return false; };
    for (const r of all)
        if (!done.has(r.id) && inLoop(r))
            walk(r, 0);
    return out;
}
/** from item `from`, the items of the next `n` top-level entries (with everything open below them):
 *  load limits count entries at the top level, opened sub-items come on top */
export function takeRoots(items, from, n) {
    let i = from, roots = 0;
    while (i < items.length) {
        if (items[i].depth === 0 && !items[i].add) {
            if (roots >= n)
                break;
            roots++;
        }
        i++;
    }
    return { items: items.slice(from, i), end: i, roots };
}
export const countRoots = (items, from = 0) => items.slice(from).filter((x) => x.depth === 0 && !x.add).length;
export function query(db, view, offset = 0, search = '', keep) {
    // keep: entries just made here – they stay visible even when the filter would hide them
    const kept = (r) => !!keep?.has(r.id);
    let rows = db.rows.filter((r) => kept(r) || matchFilter(db, r, view.filter));
    // a database of files shows one folder at a time
    // (tables and lists show the folders inside as a tree: everything below it, opened folder by folder)
    if (db.schema.files) {
        const f = folderOf(db), tree = view.type === 'table' || view.type === 'list';
        rows = rows.filter((r) => tree ? (!f || (r.rel ?? '').startsWith(f + '/')) : parentOf(r) === f);
    }
    const range = view.period ? periodRange(view.period, offset) : null;
    if (range && view.period) {
        const prop = view.period.prop;
        rows = rows.filter((r) => {
            if (kept(r))
                return true;
            const d = asDate(db.value(r, prop));
            if (!d)
                return false;
            const s = d.start.slice(0, 10), e = (d.end ?? d.start).slice(0, 10);
            return s < range.end && e >= range.start;
        });
    }
    if (search) {
        const q = search.toLowerCase();
        rows = rows.filter((r) => kept(r) || Object.values(r.values).some((v) => v != null && JSON.stringify(v).toLowerCase().includes(q)));
    }
    const sorts = view.sorts ?? [];
    if (sorts.length) {
        const keyed = rows.map((r) => ({ r, k: sorts.map((s) => sortKey(db, r, s.prop)) }));
        const dateKeys = sorts.map((s) => { const t = db.prop(s.prop)?.type; return t === 'date' || t === 'created_time' || t === 'last_edited_time'; });
        keyed.sort((a, b) => {
            for (let i = 0; i < sorts.length; i++) {
                const x = a.k[i], y = b.k[i];
                if (x === y)
                    continue;
                if (dateKeys[i]) {
                    const c = compareDateStarts(String(x), String(y), sorts[i].dir);
                    if (c)
                        return c;
                    continue;
                }
                if (x === '')
                    return 1;
                if (y === '')
                    return -1;
                // numbers and dates (ISO strings) compare directly; only real text needs the collator
                const c = typeof x === 'number' && typeof y === 'number' ? x - y : dateKeys[i] ? (x < y ? -1 : 1) : compareText(String(x), String(y));
                return sorts[i].dir === 'desc' ? -c : c;
            }
            return 0;
        });
        rows = keyed.map((x) => x.r);
    }
    else if (view.order?.length) {
        // manual order (drag and drop); entries not in the list keep their place after it
        const pos = new Map(view.order.map((id, i) => [id, i]));
        const n = view.order.length;
        rows = rows.map((r, i) => ({ r, k: pos.get(r.id) ?? n + i })).sort((a, b) => a.k - b.k).map((x) => x.r);
    }
    // entries just made here sit next to the New button (top or bottom), whatever the sorting says – until the view is opened again
    if (keep?.size) {
        const fresh = [...keep].map((id) => rows.find((r) => r.id === id)).filter((r) => !!r);
        if (fresh.length) {
            const rest = rows.filter((r) => !keep.has(r.id));
            rows = view.newAt === 'top' ? [...fresh.reverse(), ...rest] : [...rest, ...fresh];
        }
    }
    // folders before files (in the order the sorting gives)
    if (db.schema.files) {
        if (!sorts.length && !view.order?.length)
            rows = [...rows].sort((a, b) => compareText(a.rel ?? '', b.rel ?? ''));
        rows = [...rows.filter((r) => r.isDir), ...rows.filter((r) => !r.isDir)];
    }
    let groups = null;
    if (view.groupBy) {
        const prop = view.groupBy.prop;
        const def = db.prop(prop);
        const map = new Map();
        if (def?.options)
            for (const o of def.options)
                map.set(o.name, []);
        for (const r of rows) {
            const v = db.value(r, prop);
            const keys = Array.isArray(v) ? (v.length ? v : ['']) : [v == null ? '' : typeof v === 'object' ? v.start : String(v)];
            for (const k of keys) {
                if (!map.has(k))
                    map.set(k, []);
                map.get(k).push(r);
            }
        }
        groups = [...map.entries()].map(([key, rs]) => ({ key, rows: rs }));
        // empty key last
        groups.sort((a, b) => (a.key === '' ? 1 : 0) - (b.key === '' ? 1 : 0));
        if (view.groupBy.hideEmpty !== false)
            groups = groups.filter((g) => g.rows.length);
    }
    return { rows, groups, range };
}
export function aggregate(db, rows, prop, agg) {
    if (agg === 'none')
        return null;
    if (agg === 'count')
        return rows.filter((r) => { const v = db.value(r, prop); return v != null && v !== ''; }).length;
    const nums = rows.map((r) => db.value(r, prop)).filter((v) => typeof v === 'number');
    if (!nums.length)
        return agg === 'sum' ? 0 : null;
    switch (agg) {
        case 'sum': return Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
        case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
        case 'min': return Math.min(...nums);
        case 'max': return Math.max(...nums);
    }
    return null;
}
/** Walk every block in a page (for search, views, etc). */
export function walkBlocks(blocks, fn) {
    for (const b of blocks) {
        fn(b);
        if (b.children)
            walkBlocks(b.children, fn);
    }
}
/** a database's default values for new entries, with '@today' / '@now' dates filled in */
function resolveDefaults(d) {
    if (!d)
        return {};
    const out = {};
    const today = todayISO();
    for (const [k, v] of Object.entries(d)) {
        const start = v && typeof v === 'object' && !Array.isArray(v) && 'start' in v ? v.start : undefined;
        if (start === '@today')
            out[k] = { start: today };
        else if (start === '@now')
            out[k] = { start: `${today}T${hhmmOfDate(new Date())}` };
        else
            out[k] = Array.isArray(v) ? [...v] : v;
    }
    return out;
}
const TRASH_DIR = `${APP.workspaceDir}/trash`;
const HISTORY_DIR = `${APP.workspaceDir}/history`;
/** pages and entries are kept (not settings, schemas or views) */
const keepable = (path) => /\.md$/i.test(path) && !/^(\.workspace|comments)\//.test(path);
/** a deleted database's own files go to the trash too (with its entries, restored together) */
const trashable = (path) => /(^|\/)(database|views)\.json$/.test(path) && !path.startsWith('.workspace/');
const slugPath = (path) => path.replace(/\.md$/, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(-120);
const historyFile = (path) => `${HISTORY_DIR}/${slugPath(path)}.json`;
/** the file a Dropbox conflicted copy belongs to ("x (Alex's conflicted copy 2026-10-30).md" → "x.md"), or null */
function conflictOriginal(path) {
    // "Name (Nico's conflicted copy 2026-10-30).md", "Name (… in Konflikt stehende Kopie 2026-10-30).md": always with a date –
    // a name like "Kurzfilm (Konflikt ohne Dialog)" is not one
    const m = path.match(/^(.*?)\s*\(([^()]*)\)(\.[a-z0-9]+)$/i);
    if (!m || !/conflict|konflikt|conflit|conflicto|conflitto/i.test(m[2]) || !/\d{4}-\d{2}-\d{2}/.test(m[2]))
        return null;
    return `${m[1]}${m[3]}`;
}
/** settings written by older versions: the greeting is gone, its date and time became the start page's clock */
function upgradeSettings(s) {
    const o = s;
    if (o.greeting !== undefined) {
        if (o.greeting && o.greetClock !== false)
            o.homeClock = true;
    }
    delete o.greeting;
    delete o.greetText;
    delete o.greetName;
    delete o.greetClock;
    delete o.userName;
    return s;
}
/** every file below the workspace folder, by walking it (storages that can't list everything at once) */
async function walkAll(storage) {
    const out = [];
    const walk = async (dir, depth) => {
        const items = await storage.list(dir).catch(() => []);
        await Promise.all(items.map(async (e) => {
            const p = dir ? `${dir}/${e.name}` : e.name;
            if (e.kind === 'dir') {
                if (depth < 12 && !/^\.workspace\/(history|trash|unused-files|fetched)$/.test(p) && e.name !== 'node_modules' && e.name !== '.git')
                    await walk(p, depth + 1);
            }
            else if (!e.name.endsWith('.nook-tmp') && e.name !== '.DS_Store')
                out.push(p);
        }));
    };
    await walk('', 0);
    return out;
}
async function readJsonAt(read, p) {
    const t = await read(p);
    try {
        return t == null ? null : JSON.parse(t);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=workspace.js.map