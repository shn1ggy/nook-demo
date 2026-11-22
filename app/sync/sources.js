import { parseCsv, readZip } from '../importer/notion.js';
import { browserNet } from './net.js';
export const BUILTIN = [
    {
        id: 'letterboxd', name: 'Letterboxd', icon: 'film', desc: 'Diary: films, dates, ratings',
        database: { name: 'Films', icon: '🎬', properties: { Name: 'title', Watched: 'date', Year: { type: 'number', format: 'plain_int' }, Rating: { type: 'number', format: 'stars' }, Rewatch: 'checkbox', Review: 'text', Poster: 'image', Link: 'url' } },
        csv: { file: 'diary.csv', columns: { Name: 'Name', Watched: 'Watched Date', Year: 'Year', Rating: 'Rating', Rewatch: 'Rewatch', Link: 'Letterboxd URI' } },
        feed: { url: 'https://letterboxd.com/{username}/rss/', vars: { username: 'Letterboxd username', tmdb: 'TMDB key (optional, for posters)' }, fields: { Name: 'letterboxd:filmTitle', Watched: 'letterboxd:watchedDate', Year: 'letterboxd:filmYear', Rating: 'letterboxd:memberRating', Rewatch: 'letterboxd:rewatch', Poster: 'description img@src', Link: 'link' } },
        same: ['Name', 'Watched'],
        enrich: { image: 'Poster', page: 'Link', guess: 'https://letterboxd.com/film/{slug:Name}/', check: 'Year', tmdb: { title: 'Name', year: 'Year' } },
        log: { date: 'Watched', show: ['Rating'], image: 'Poster', avg: 'Rating' },
    },
    {
        id: 'goodreads', name: 'Goodreads', icon: 'book-open', desc: 'Books read, ratings',
        database: { name: 'Books', icon: '📚', properties: { Name: 'title', Author: 'text', Finished: 'date', Rating: { type: 'number', format: 'stars' }, Cover: 'image', Link: 'url' } },
        csv: { file: 'goodreads_library_export.csv', columns: { Name: 'Title', Author: 'Author', Finished: 'Date Read', Rating: 'My Rating' } },
        feed: { url: 'https://www.goodreads.com/review/list_rss/{user}?shelf=read', vars: { user: 'Goodreads user number' }, fields: { Name: 'title', Author: 'author_name', Finished: 'user_read_at', Rating: 'user_rating', Cover: 'book_medium_image_url', Link: 'link' } },
        same: ['Name', 'Author'],
        log: { date: 'Finished', show: ['Author', 'Rating'], image: 'Cover', avg: 'Rating' },
    },
    {
        id: 'csv', name: 'CSV file', icon: 'file-text', desc: 'Any export, once',
        database: { name: 'Imported', properties: { Name: 'title', Date: 'date' } }, csv: { columns: {} }, same: ['Name', 'Date'], log: { date: 'Date' },
    },
    {
        id: 'feed', name: 'Feed (RSS / Atom)', icon: 'rss', desc: 'New entries, kept in sync',
        database: { name: 'Feed', properties: { Name: 'title', Date: 'date', Image: 'image', Link: 'url' } },
        feed: { url: '{url}', vars: { url: 'Feed address (https://…)' }, fields: { Name: 'title', Date: 'pubDate', Image: 'description img@src', Link: 'link' } },
        same: ['Link'], log: { date: 'Date', image: 'Image' },
    },
];
const SOURCES_PATH = '.workspace/sources.json';
export async function loadSources(ws) {
    try {
        const raw = JSON.parse(await ws.storage.read(SOURCES_PATH));
        return { sources: raw.sources ?? [], recipes: raw.recipes ?? [] };
    }
    catch {
        return { sources: [], recipes: [] };
    }
}
export async function saveSources(ws, c) { await ws.write(SOURCES_PATH, JSON.stringify(c, null, 2) + '\n', false); }
export const recipeOf = (c, id) => c.recipes.find((r) => r.id === id) ?? BUILTIN.find((r) => r.id === id);
/** a recipe someone shared: checked, never run */
export function parseRecipe(text) {
    const r = JSON.parse(text);
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string' || !r.database?.properties || !Array.isArray(r.same))
        throw new Error('This is not a Nook source recipe.');
    if (r.feed && !/^https:\/\//.test(r.feed.url.replace(/\{[^}]+\}/g, 'x')))
        throw new Error('A recipe’s feed must be an https address.');
    return r;
}
const typeOf = (t) => (typeof t === 'string' ? t : t.type);
/** the recipe's database: made on first use, missing properties added later */
export async function ensureDatabase(ws, recipe, key) {
    let db = key ? ws.dbs.get(key) : undefined;
    if (!db) {
        db = await ws.createDatabase(recipe.database.name);
        db.schema.properties = db.schema.properties.filter((p) => p.type === 'title');
        if (recipe.database.icon)
            db.schema.icon = recipe.database.icon;
    }
    for (const [name, t] of Object.entries(recipe.database.properties)) {
        const type = typeOf(t);
        if (type === 'title') {
            const tp = db.schema.properties.find((p) => p.type === 'title');
            if (tp && tp.name !== name && !db.prop(name))
                tp.name = name;
            continue;
        }
        if (db.prop(name)) {
            const d = db.prop(name);
            if (typeof t === 'object' && t.format && !d.format)
                d.format = t.format;
            continue;
        }
        const def = { name, type: type === 'image' ? 'url' : type };
        if (typeof t === 'object' && t.format)
            def.format = t.format;
        db.schema.properties.push(def);
    }
    if (!db.views.some((v) => v.type === 'gallery') && Object.values(recipe.database.properties).some((t) => typeOf(t) === 'image')) {
        const img = Object.entries(recipe.database.properties).find(([, t]) => typeOf(t) === 'image')[0];
        db.views.push({ id: 'covers', name: 'Covers', type: 'gallery', cover: img, coverShape: '2:3' });
    }
    await ws.saveSchema(db);
    await ws.saveViews(db);
    return db;
}
const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function toDate(s) {
    const t = s.trim();
    if (!t)
        return null;
    let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m)
        return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = t.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (m && MONTHS[m[2].toLowerCase()])
        return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
    m = t.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && MONTHS[m[1].toLowerCase()])
        return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, '0')}`;
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
/** text from a CSV cell or feed field → a Nook value of the property's type */
function convert(type, raw) {
    const s = (raw ?? '').trim();
    if (!s)
        return type === 'checkbox' ? false : null;
    switch (type) {
        case 'number': {
            const n = Number(s.replace(',', '.'));
            return Number.isFinite(n) ? n : null;
        }
        case 'date': {
            const d = toDate(s);
            return d ? { start: d } : null;
        }
        case 'checkbox': return /^(yes|true|1|x)$/i.test(s);
        default: return s;
    }
}
const norm = (v) => (v == null ? '' : typeof v === 'object' && 'start' in v ? v.start : String(v)).trim().toLowerCase();
/** add new entries, update the ones already there (same = the recipe's key properties) */
export async function upsert(ws, db, recipe, items) {
    const props = recipe.database.properties;
    const keyOf = (vals) => recipe.same.map((k) => norm(vals[k] ?? null)).join('\u0001');
    const have = new Map();
    for (const r of db.rows)
        have.set(keyOf(r.values), r);
    let added = 0, updated = 0;
    ws.boundary();
    for (const it of items) {
        const vals = {};
        for (const [name, t] of Object.entries(props))
            if (name in it)
                vals[name] = convert(typeOf(t), it[name]);
        if (!recipe.same.every((k) => norm(vals[k] ?? null)))
            continue;
        // a rating of 0 means “not rated” in exports
        for (const [name, t] of Object.entries(props))
            if (typeof t === 'object' && t.format === 'stars' && vals[name] === 0)
                vals[name] = null;
        const k = keyOf(vals), row = have.get(k);
        if (row) {
            let changed = false;
            for (const [name, v] of Object.entries(vals)) {
                const empty = (x) => x == null || x === '' || x === false;
                if (empty(v) && empty(row.values[name]))
                    continue;
                if (v != null && v !== '' && JSON.stringify(row.values[name] ?? null) !== JSON.stringify(v)) {
                    row.values[name] = v;
                    changed = true;
                }
            }
            if (changed) {
                await ws.saveRow(db, row);
                updated++;
            }
        }
        else {
            const r = await ws.addRow(db, vals);
            have.set(k, r);
            added++;
        }
    }
    return { added, updated };
}
/** rows of a CSV file (or the recipe's file inside a .zip), as property → text */
export async function readCsvItems(recipe, file, columns = recipe.csv?.columns ?? {}) {
    let text, name = file.name;
    if (/\.zip$/i.test(file.name)) {
        const files = await readZip(await file.arrayBuffer());
        const want = (recipe.csv?.file ?? '').toLowerCase();
        const hit = [...files.keys()].find((k) => want && k.toLowerCase().split('/').pop() === want) ?? [...files.keys()].find((k) => k.toLowerCase().endsWith('.csv'));
        if (!hit)
            throw new Error(`No ${recipe.csv?.file ?? 'CSV'} in this zip.`);
        text = new TextDecoder().decode(files.get(hit));
        name = hit.split('/').pop();
    }
    else
        text = await file.text();
    const rows = parseCsv(text.replace(/^﻿/, ''));
    const headers = rows.shift() ?? [];
    const idx = (col) => headers.findIndex((h) => h.trim().toLowerCase() === col.trim().toLowerCase());
    const items = rows.filter((r) => r.some((c) => c.trim())).map((r) => {
        const o = {};
        for (const [prop, col] of Object.entries(columns)) {
            const i = idx(col);
            if (i >= 0)
                o[prop] = r[i] ?? '';
        }
        return o;
    });
    return { items, headers, name };
}
/** the feed's items, as property → text */
export async function readFeedItems(recipe, vars = {}) {
    if (!recipe.feed)
        return [];
    const url = recipe.feed.url.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] ?? '').replace(/%3A/gi, ':').replace(/%2F/gi, '/'));
    const r = await browserNet({ method: 'GET', url });
    if (r.status === 404)
        throw new Error('The feed was not found – check the name.');
    if (r.status >= 300)
        throw new Error(`The feed answered ${r.status}.`);
    const doc = new DOMParser().parseFromString(r.body, 'application/xml');
    if (doc.querySelector('parsererror'))
        throw new Error('This address is not a feed.');
    const items = [...doc.getElementsByTagName('item'), ...doc.getElementsByTagName('entry')];
    const text = (el, field) => {
        const [path, attr] = field.split('@');
        const parts = path.trim().split(/\s+/);
        const child = [...el.children].find((c) => c.nodeName.toLowerCase() === parts[0].toLowerCase() || c.localName.toLowerCase() === parts[0].toLowerCase());
        if (!child)
            return '';
        if (parts.length > 1) {
            // inside an HTML field (e.g. "description img@src")
            const html = new DOMParser().parseFromString(child.textContent ?? '', 'text/html');
            const inner = html.querySelector(parts.slice(1).join(' '));
            return (attr ? inner?.getAttribute(attr) : inner?.textContent) ?? '';
        }
        if (attr)
            return child.getAttribute(attr) ?? '';
        return (child.textContent || child.getAttribute('href') || '').trim();
    };
    return items.map((it) => { const o = {}; for (const [prop, field] of Object.entries(recipe.feed.fields))
        o[prop] = text(it, field); return o; });
}
/** when a source was last fetched: on this device, or (from another device) in the file */
export function lastFetched(s) {
    let local = null;
    try {
        local = localStorage.getItem(`nook:fetched:${s.id}`);
    }
    catch { /* private mode */ }
    return [local ?? '', s.fetched ?? ''].sort().pop() || undefined;
}
/** fetch a source's feed and merge it into its database */
export async function syncSource(ws, cfg, s) {
    const recipe = recipeOf(cfg, s.recipe);
    if (!recipe?.feed)
        return '';
    // the shared file is only written when something changed (new entries, an error that came or went):
    // two devices writing "fetched just now" at the same time is what made Dropbox conflicts
    const before = JSON.stringify([s.db, s.error ?? '', s.added ?? 0]);
    try {
        const db = await ensureDatabase(ws, recipe, s.db);
        s.db = db.key;
        const res = await upsert(ws, db, recipe, await readFeedItems(recipe, s.vars));
        delete s.error;
        if (res.added)
            s.added = (s.added ?? 0) + res.added;
        return res.added ? `${res.added} new` : 'Up to date';
    }
    catch (e) {
        s.error = e.message;
        return s.error;
    }
    finally {
        // when it was fetched: kept on this device (shown in Settings), written to the file only with other changes
        const now = new Date().toISOString().slice(0, 19);
        try {
            localStorage.setItem(`nook:fetched:${s.id}`, now);
        }
        catch { /* private mode */ }
        if (JSON.stringify([s.db, s.error ?? '', s.added ?? 0]) !== before) {
            s.fetched = now;
            await saveSources(ws, cfg).catch(() => { });
        }
    }
}
/** while a workspace is open: synced sources are checked now and every hour */
let timer = null;
export function attachSources(ws) {
    if (timer)
        clearInterval(timer);
    const run = async () => { const cfg = await loadSources(ws); for (const s of cfg.sources)
        if (s.sync && !(lastFetched(s) && Date.now() - new Date(lastFetched(s) + 'Z').getTime() < 50 * 60_000))
            await syncSource(ws, cfg, s); if (cfg.sources.some((s) => s.sync))
        ws.emit(); void enrichAll(ws, cfg); };
    void ws.whenFresh().then(() => setTimeout(() => void run(), 2000));
    timer = setInterval(() => void run(), 60 * 60_000);
}
// ---------- missing pictures (e.g. posters: Letterboxd's export has none) ----------
const slug = (t) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' ').replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ogImage = (html) => html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i)?.[1] ?? '';
/** a poster from The Movie Database (where Letterboxd's posters come from) – only for an exact title and year */
const normT = (t) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
export const tmdbStats = { noMatch: 0, http: 0, lastStatus: 0 };
async function tmdbGet(key, path, params) {
    const q = new URLSearchParams({ include_adult: 'false', ...params });
    const bearer = key.length > 40;
    if (!bearer)
        q.set('api_key', key);
    const r = await fetch(`https://api.themoviedb.org/3/${path}?${q}`, { credentials: 'omit', headers: bearer ? { Authorization: `Bearer ${key}` } : {} });
    if (r.status === 401)
        throw new Error('The TMDB key was not accepted.');
    if (!r.ok) {
        tmdbStats.http++;
        tmdbStats.lastStatus = r.status;
        return null;
    }
    return r.json();
}
const bare = (t) => normT(t.replace(/^(the|a|an|der|die|das|le|la|les)\s+/i, ''));
/** a poster from The Movie Database (where Letterboxd's posters come from): same title, the same year (or one off), the best known if several */
async function tmdbPoster(key, title, year) {
    const y = Number(year) || 0;
    const pick = (list, nameKeys, dateKey, want) => {
        const yr = (x) => Number(String(x[dateKey] ?? '').slice(0, 4)) || 0;
        const byPop = (l) => [...l].sort((p, q) => Number(q.popularity ?? 0) - Number(p.popularity ?? 0));
        const clear = (c) => { if (!c.length)
            return ''; const [first, second] = byPop(c); return second && Number(first.popularity ?? 0) < Number(second.popularity ?? 0) * 2 ? '' : `https://image.tmdb.org/t/p/w342${first.poster_path}`; };
        const withPic = list.filter((x) => x.poster_path);
        const names = (x) => nameKeys.map((k) => bare(String(x[k] ?? '')));
        // 1. the same title – same year, else one year off
        const same = withPic.filter((x) => names(x).includes(bare(want)));
        let c = y ? same.filter((x) => yr(x) === y) : same;
        if (!c.length && y)
            c = same.filter((x) => Math.abs(yr(x) - y) <= 1);
        if (c.length)
            return clear(c);
        // 2. a longer official title ("… Part One", "…: A Knives Out Mystery") – only with the same year
        if (!y || bare(want).length < 4)
            return '';
        const longer = withPic.filter((x) => names(x).some((n) => n.startsWith(bare(want))) && Math.abs(yr(x) - y) <= 1);
        return clear(longer);
    };
    const m = await tmdbGet(key, 'search/movie', { query: title });
    let img = m ? pick(m.results ?? [], ['title', 'original_title'], 'release_date', title) : '';
    if (img)
        return img;
    // series and miniseries (Letterboxd lists them too): the whole title, then the series of "Series: Episode" / "Series - Episode"
    for (const q0 of [...new Set([title, title.split(/: | [-–] /)[0]])]) {
        const t = await tmdbGet(key, 'search/tv', { query: q0 });
        if (!t)
            continue;
        img = pick(t.results ?? [], ['name', 'original_name'], 'first_air_date', q0);
        if (!img && q0 !== title) {
            const l = (t.results ?? []).filter((x) => x.poster_path && bare(String(x.name ?? '')) === bare(q0));
            if (l.length === 1)
                img = `https://image.tmdb.org/t/p/w342${l[0].poster_path}`;
        }
        if (img)
            break;
    }
    if (!img)
        tmdbStats.noMatch++;
    return img;
}
let enriching = false;
/** sites that refused us this session (e.g. bot protection): straight to Wikipedia */
const blocked = new Set();
const tried = new Set();
/** one by one, slowly, in the background: entries without a picture get it from their page */
export const enrichState = { running: false, done: 0, total: 0, found: 0, stop: false, error: '' };
let current = null;
export function enrichAll(ws, cfg, again = false) {
    if (current)
        return current;
    if (again)
        tried.clear();
    current = enrichRun(ws, cfg).finally(() => { current = null; });
    return current;
}
/** this device, so two devices don't search pictures at the same time (both would save the same entries → Dropbox conflicts) */
const deviceId = (() => { try {
    let v = localStorage.getItem('nook:device');
    if (!v) {
        v = Math.random().toString(36).slice(2, 10);
        localStorage.setItem('nook:device', v);
    }
    return v;
}
catch {
    return 'x';
} })();
async function takeLease(ws) {
    const fresh = await loadSources(ws);
    if (fresh.lease && fresh.lease.device !== deviceId && fresh.lease.until > Date.now())
        return false;
    fresh.lease = { device: deviceId, until: Date.now() + 5 * 60_000 };
    await saveSources(ws, fresh);
    return true;
}
async function enrichRun(ws, cfg) {
    if (enriching)
        return 0;
    // nothing to look for: no lease (and no write)
    const anyTodo = cfg.sources.some((s) => { const e = recipeOf(cfg, s.recipe)?.enrich, db = ws.dbs.get(s.db); return !!e && !!db && db.rows.some((r) => !r.values[e.image] && !tried.has(r.id)); });
    if (!anyTodo)
        return 0;
    if (!(await takeLease(ws))) {
        Object.assign(enrichState, { running: false, done: 0, total: 0, found: 0, error: 'Another device is looking for pictures right now' });
        return 0;
    }
    let leased = Date.now();
    let found = 0;
    Object.assign(enrichState, { running: true, done: 0, total: 0, found: 0, stop: false, error: '' });
    Object.assign(tmdbStats, { noMatch: 0, http: 0, lastStatus: 0 });
    enriching = true;
    try {
        for (const s of cfg.sources) {
            const recipe = recipeOf(cfg, s.recipe), e = recipe?.enrich, db = ws.dbs.get(s.db);
            if (!e || !db || !db.prop(e.image))
                continue;
            for (const r of db.rows)
                if (typeof r.values[e.image] === 'string' && /wikimedia\.org|wikipedia\.org/.test(String(r.values[e.image]))) {
                    r.values[e.image] = null;
                    await ws.saveRow(db, r);
                }
            const todo = db.rows.filter((r) => !r.values[e.image] && !tried.has(r.id));
            enrichState.total += todo.length;
            for (const r of todo) {
                if (enrichState.stop)
                    break;
                if (Date.now() - leased > 3 * 60_000) {
                    if (!(await takeLease(ws)))
                        break;
                    leased = Date.now();
                }
                enrichState.done++;
                let page = typeof r.values[e.page] === 'string' ? String(r.values[e.page]) : '';
                const tries = page ? [page] : e.guess ? (() => { const g = e.guess.replace(/\{slug:(\w+)\}/g, (_, k) => slug(String(r.values[k] ?? ''))); const y = e.check ? r.values[e.check] : null; return y ? [g, g.replace(/\/$/, `-${y}/`)] : [g]; })() : [];
                let img = '';
                const tk = s.vars?.tmdb;
                if (!img && e.tmdb && tk) {
                    try {
                        img = await tmdbPoster(tk, String(r.values[e.tmdb.title] ?? ''), String(r.values[e.tmdb.year] ?? ''));
                    }
                    catch (err) {
                        enrichState.error = err.message;
                        enrichState.stop = true;
                    }
                }
                for (const url of img ? [] : tries) {
                    if (blocked.has(new URL(url).host))
                        break;
                    try {
                        let res = await browserNet({ method: 'GET', url });
                        for (let hop = 0; hop < 4 && [301, 302, 303, 307, 308].includes(res.status) && res.headers.location; hop++)
                            res = await browserNet({ method: 'GET', url: new URL(res.headers.location, url).toString() });
                        if (res.status === 403 || res.status === 429 || res.status === 503) {
                            blocked.add(new URL(url).host);
                            break;
                        }
                        if (res.status !== 200)
                            continue;
                        // a guessed page must be the right film (same year)
                        if (!page && e.check && r.values[e.check] && !res.body.includes(String(r.values[e.check])))
                            continue;
                        img = ogImage(res.body);
                        if (img) {
                            if (!page) {
                                page = url;
                                if (db.prop(e.page))
                                    r.values[e.page] = url;
                            }
                            break;
                        }
                    }
                    catch { /* refused (e.g. the site blocks programs): Wikipedia below */
                        blocked.add(new URL(url).host);
                        break;
                    }
                }
                if (!img) {
                    tried.add(r.id);
                    continue;
                }
                r.values[e.image] = img;
                found++;
                enrichState.found = found;
                await ws.saveRow(db, r);
                ws.emit();
                await new Promise((ok) => setTimeout(ok, 300));
            }
        }
    }
    finally {
        enriching = false;
        enrichState.running = false;
    }
    return found;
}
//# sourceMappingURL=sources.js.map