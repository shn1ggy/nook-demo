// Settings → Data sources: Letterboxd, Goodreads, any CSV or feed – into a normal database, and from
// there into logs. What a source reads is a recipe (see sync/sources.ts); this is only the window.
import { wcard, wrow } from './win.js';
import { h, svgIcon, ICONS, fmtDate, shortId } from '../util.js';
import { iconSvg } from './icons.js';
import { dialog, toast } from './pop.js';
import { selectControl, switchControl, moreControl } from './settings.js';
import { BUILTIN, loadSources, saveSources, recipeOf, parseRecipe, ensureDatabase, upsert, readCsvItems, readFeedItems, syncSource, enrichAll, enrichState, tmdbStats, lastFetched } from '../sync/sources.js';
import { dayConfig } from '../views/days.js';
import { phoneActions } from './calsettings.js';
const TYPE_LABEL = { title: ['Title', 'type'], text: ['Text', 'align-left'], number: ['Number', 'hash'], date: ['Date', 'calendar'], checkbox: ['Checkbox', 'check-square'], url: ['Link', 'link'], image: ['Picture', 'image'], select: ['Select', 'chevron-down'] };
const formatOf = (t) => (typeof t === 'object' ? t.format : undefined);
const typeName = (t) => (typeof t === 'string' ? t : t.type);
function win(title, body, actions) {
    return dialog(h('div', { class: 'bwindow cal-form src-win' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px' } }, title)), h('div', { class: 'dialog-body' }, body), h('div', { class: 'bfooter' }, ...actions)));
}
const logsOf = (ws) => [...ws.dbs.values()].filter((d) => d.views.some((v) => v.type === 'day'));
/** put a source's database into a log (timeline, On this day, photos) */
function addToLog(ws, log, db, recipe) {
    const cfg = dayConfig(log);
    if (cfg.sources.some((s) => s.db === db.key))
        return;
    const l = recipe.log;
    const date = l?.date && db.prop(l.date) ? l.date : db.schema.properties.find((p) => p.type === 'date')?.name;
    if (!date)
        return;
    cfg.sources.push({ db: db.key, prop: date, props: (l?.show ?? []).filter((p) => db.prop(p)), image: l?.image, avg: l?.avg, sum: l?.sum });
    void ws.saveSchema(log);
}
/** the picture search with a progress pill at the bottom (ring, count, Stop) until it is done */
async function findPictures(ws, cfg) {
    document.querySelector('.prog-toast')?.remove();
    const R = 9, C = 2 * Math.PI * R;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('width', '22');
    ring.setAttribute('height', '22');
    ring.setAttribute('viewBox', '0 0 22 22');
    ring.setAttribute('class', 'prog-ring');
    ring.innerHTML = `<circle cx="11" cy="11" r="${R}" class="bg"/><circle cx="11" cy="11" r="${R}" class="fg" stroke-dasharray="${C}" stroke-dashoffset="${C}"/>`;
    const text = h('span', null, 'Looking for pictures…');
    const pill = h('div', { class: 'toast prog-toast', role: 'status' }, ring, text, h('button', { class: 'toast-action', onclick: () => { enrichState.stop = true; } }, 'Stop'));
    document.body.append(pill);
    const tick = () => {
        const { done, total, found } = enrichState;
        const f = total ? done / total : 0;
        ring.querySelector('.fg').setAttribute('stroke-dashoffset', String(C * (1 - f)));
        text.textContent = total ? `Pictures: ${done.toLocaleString()} of ${total.toLocaleString()} checked · ${found.toLocaleString()} found` : 'Looking for pictures…';
    };
    const t = setInterval(tick, 300);
    try {
        await enrichAll(ws, cfg, true);
    }
    finally {
        clearInterval(t);
        tick();
        pill.remove();
    }
    const { found, total, stop, error } = enrichState;
    const noKey = cfg.sources.some((x) => recipeOf(cfg, x.recipe)?.enrich?.tmdb && !x.vars?.tmdb);
    if (error) {
        toast(error, 5000);
        return;
    }
    if (!found && total && noKey) {
        toast('Letterboxd refuses Nook – add a free TMDB key in the source (Edit…) to get posters', 6000);
        return;
    }
    const why = tmdbStats.http ? ` · TMDB refused ${tmdbStats.http}× (${tmdbStats.lastStatus})` : tmdbStats.noMatch ? ` · ${tmdbStats.noMatch} without a clear match` : '';
    toast((stop ? `Stopped · ${found} pictures found` : found ? `${found.toLocaleString()} pictures found` : total ? `No pictures found for ${total.toLocaleString()} entries` : 'Every entry has a picture') + why, 7000);
}
export function sourcesSection(ws, redraw, closeWin = () => { }) {
    let cfg = { sources: [], recipes: [] };
    let loaded = false;
    const load = async () => { cfg = await loadSources(ws()); loaded = true; redraw(); };
    const persist = async () => { await saveSources(ws(), cfg); redraw(); };
    // ----- 1 · pick a source -----
    const pick = () => {
        const tile = (r) => h('button', { class: 'src-tile', onclick: () => { close(); setup(r); } }, iconSvg(r.icon ?? 'database', 18), h('div', null, h('b', null, r.name), h('span', null, r.desc ?? '')));
        const ready = [...BUILTIN.filter((r) => r.id !== 'csv' && r.id !== 'feed'), ...cfg.recipes];
        const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
        fileIn.addEventListener('change', async () => {
            const f = fileIn.files?.[0];
            if (!f)
                return;
            try {
                const r = parseRecipe(await f.text());
                cfg.recipes = [...cfg.recipes.filter((x) => x.id !== r.id), r];
                await persist();
                close();
                setup(r);
            }
            catch (e) {
                toast(e.message);
            }
        });
        const body = h('div', { class: 'bwin' }, wcard('Ready-made', h('div', { class: 'src-grid' }, ...ready.map(tile))), wcard('Your own', h('div', { class: 'src-grid' }, tile(BUILTIN.find((r) => r.id === 'csv')), tile(BUILTIN.find((r) => r.id === 'feed')), h('button', { class: 'src-tile', onclick: () => fileIn.click() }, iconSvg('download', 18), h('div', null, h('b', null, 'Recipe file'), h('span', null, 'A source someone shared'))), fileIn)));
        const close = win('Add a data source', body, [h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel')]);
    };
    // ----- 2 · set it up -----
    const setup = (base, conn) => {
        const recipe = JSON.parse(JSON.stringify(base));
        const custom = recipe.id === 'csv';
        let items = [];
        let file = null;
        const vars = { ...(conn?.vars ?? {}) };
        let sync = conn?.sync ?? !!recipe.feed;
        const logs = logsOf(ws());
        const toLogs = new Set(conn ? [] : logs.slice(0, 1).map((l) => l.key));
        const status = h('div', { class: 'bfield-hint' });
        const fileName = h('span', { class: 'set-desc' }, recipe.csv?.file ? `${recipe.csv.file}, or the whole export (.zip)` : 'A .csv file');
        const mapBox = h('div', { class: 'src-map' });
        const go = h('button', { class: 'btn-new' }, conn ? 'Save' : 'Add');
        const label = () => { go.textContent = items.length ? `Import ${items.length.toLocaleString()} entries` : conn ? 'Save' : 'Add'; };
        const drawMap = (headers = []) => {
            mapBox.textContent = '';
            if (custom) {
                // any CSV: which column is the name and which the date; the other columns come along as text
                if (!headers.length)
                    return;
                const cols = recipe.csv.columns;
                const name = Object.keys(cols).length ? cols.Name : headers[0];
                const date = cols.Date ?? headers.find((x) => /date|datum|day|tag/i.test(x)) ?? '';
                const set = (n, d) => {
                    recipe.csv.columns = {};
                    recipe.database.properties = {};
                    for (const col of headers) {
                        const prop = col === n ? 'Name' : col === d ? 'Date' : col.trim() || 'Column';
                        recipe.csv.columns[prop] = col;
                        recipe.database.properties[prop] = col === n ? 'title' : col === d ? 'date' : 'text';
                    }
                    recipe.same = d ? ['Name', 'Date'] : ['Name'];
                    recipe.log = d ? { date: 'Date' } : undefined;
                };
                set(name, date);
                const opts = headers.map((x) => [x, x]);
                mapBox.append(wrow('Name', selectControl(opts, name, (v) => { set(v, recipe.csv.columns.Date ?? ''); drawMap(headers); }, 'Name column')), wrow('Date', selectControl([['', 'None'], ...opts], date, (v) => { set(recipe.csv.columns.Name, v); drawMap(headers); }, 'Date column')), wrow('Other columns', null, `${Math.max(0, headers.length - (date ? 2 : 1))} more, as text`));
                return;
            }
            for (const [prop, t] of Object.entries(recipe.database.properties)) {
                const from = recipe.csv?.columns[prop] ?? recipe.feed?.fields[prop];
                if (!from)
                    continue;
                const [lab, ico] = TYPE_LABEL[typeName(t)] ?? ['Text', 'align-left'];
                mapBox.append(h('div', { class: 'src-maprow' }, h('span', { class: 'src-col' }, from ?? '—'), svgIcon(ICONS.chevronR, 12), h('span', { class: 'src-prop' }, prop), h('span', { class: 'src-type' }, formatOf(t) === 'stars' ? h('span', { class: 'stars' }, '★★★½') : [iconSvg(ico, 13), lab])));
            }
        };
        drawMap();
        const fileIn = h('input', { type: 'file', accept: '.csv,.zip,text/csv,application/zip', hidden: true });
        fileIn.addEventListener('change', async () => {
            file = fileIn.files?.[0] ?? null;
            if (!file)
                return;
            fileName.textContent = 'Reading…';
            try {
                if (custom) {
                    const first = await readCsvItems(recipe, file, {});
                    drawMap(first.headers);
                }
                const res = await readCsvItems(recipe, file);
                items = res.items;
                const dates = items.map((x) => x[recipe.log?.date ?? '']).filter(Boolean).sort();
                fileName.textContent = `${res.name} · ${items.length.toLocaleString()} entries${dates.length ? ` · ${dates[0].slice(0, 4)} – ${dates[dates.length - 1].slice(0, 4)}` : ''}`;
                status.textContent = '';
            }
            catch (e) {
                fileName.textContent = e.message;
                items = [];
            }
            label();
        });
        const cards = [];
        if (recipe.csv)
            cards.push(wcard(recipe.feed ? 'History – once' : 'File', wrow(conn ? 'Import again' : 'Export file', h('button', { class: 'set-btn', onclick: () => fileIn.click() }, 'Choose file…'), fileName), fileIn));
        if (recipe.feed)
            cards.push(wcard(recipe.csv ? 'New entries – kept in sync' : 'Feed', ...Object.entries(recipe.feed.vars ?? {}).map(([k, lab]) => { const inp = h('input', { class: 'set-input', type: k === 'tmdb' ? 'password' : 'text', value: vars[k] ?? '', placeholder: k === 'tmdb' ? 'themoviedb.org → Settings → API' : lab, autocapitalize: 'off', spellcheck: 'false' }); inp.addEventListener('input', () => { vars[k] = inp.value.trim(); }); inp.addEventListener('keydown', (e) => e.stopPropagation()); return wrow(lab, inp); }), wrow('Keep in sync', switchControl(sync, (v) => { sync = v; }, 'Keep in sync'), 'Checks every hour while Nook is open')));
        cards.push(wcard(conn ? `In “${ws().dbs.get(conn.db)?.schema.name ?? recipe.database.name}”` : `Into a new database “${recipe.database.name}”`, mapBox));
        if (logs.length && !conn)
            cards.push(wcard('Show in', ...logs.map((l) => wrow(l.schema.name, switchControl(toLogs.has(l.key), (v) => { if (v)
                toLogs.add(l.key);
            else
                toLogs.delete(l.key); }, l.schema.name), 'Log: timeline and On this day'))));
        const bodyEl = h('div', { class: 'bwin' }, ...cards, status);
        const close = win(conn ? recipe.name : `Add ${recipe.name}`, bodyEl, [h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), go]);
        if (conn) {
            const db = ws().dbs.get(conn.db);
            phoneActions(bodyEl, [
                ...(recipe.feed && conn.sync ? [{ label: 'Sync now', run: async () => { close(); toast(`${recipe.name}: ${await syncSource(ws(), cfg, conn)}`); ws().emit(); redraw(); } }] : []),
                ...(db ? [{ label: 'Open database', run: () => { close(); closeWin(); window.nook?.openDb(db.key); } }] : []),
                { label: 'Remove source', danger: true, run: async () => { cfg.sources = cfg.sources.filter((x) => x !== conn); close(); await persist(); toast('The database and its entries stay'); } },
            ]);
        }
        go.addEventListener('click', async () => {
            if (recipe.feed && sync && Object.keys(recipe.feed.vars ?? {}).some((k) => k !== 'tmdb' && !vars[k])) {
                status.textContent = `Enter the ${Object.values(recipe.feed.vars ?? {})[0]}, or turn off Keep in sync.`;
                status.style.color = 'var(--danger)';
                return;
            }
            if (!recipe.feed && !items.length && !conn) {
                status.textContent = 'Choose the file first.';
                status.style.color = 'var(--danger)';
                return;
            }
            go.disabled = true;
            status.style.color = '';
            status.textContent = 'Working…';
            try {
                if (custom && recipe.database.name === 'Imported' && file)
                    recipe.database.name = file.name.replace(/\.(csv|zip)$/i, '');
                const db = await ensureDatabase(ws(), recipe, conn?.db);
                const c = conn ?? { id: shortId(), recipe: recipe.id, db: db.key };
                c.db = db.key;
                c.vars = vars;
                c.sync = !!recipe.feed && sync;
                if (custom) {
                    cfg.recipes = [...cfg.recipes.filter((r) => r.id !== `csv-${c.id}`), { ...recipe, id: `csv-${c.id}`, name: db.schema.name }];
                    c.recipe = `csv-${c.id}`;
                }
                if (!conn)
                    cfg.sources.push(c);
                let added = 0;
                if (items.length)
                    added += (await upsert(ws(), db, recipe, items)).added;
                if (c.sync) {
                    try {
                        added += (await upsert(ws(), db, recipe, await readFeedItems(recipe, vars))).added;
                        c.fetched = new Date().toISOString().slice(0, 19);
                        delete c.error;
                    }
                    catch (e) {
                        c.error = e.message;
                    }
                }
                for (const k of toLogs) {
                    const log = ws().dbs.get(k);
                    if (log)
                        addToLog(ws(), log, db, recipe);
                }
                await persist();
                ws().emit();
                void findPictures(ws(), cfg);
                toast(c.error ? `${db.schema.name}: ${added} added · feed: ${c.error}` : `${db.schema.name}: ${added.toLocaleString()} added`);
                close();
            }
            catch (e) {
                status.textContent = e.message;
                status.style.color = 'var(--danger)';
                go.disabled = false;
            }
        });
    };
    const items = () => {
        if (!loaded) {
            void load();
            return [{ heading: 'Data sources' }];
        }
        const out = [{ heading: 'Data sources' }];
        for (const s of cfg.sources) {
            const r = recipeOf(cfg, s.recipe), db = ws().dbs.get(s.db);
            const st = s.error ? h('span', { class: 'cal-status err' }, h('i'), s.error) : lastFetched(s) ? h('span', { class: 'cal-status ok' }, h('i'), `Synced ${fmtDate({ start: lastFetched(s).slice(0, 10) })}`) : null;
            out.push({
                icon: r?.icon ?? 'database', title: r?.name ?? s.recipe, open: () => r && setup(r, s), keywords: `source import ${r?.name}`,
                desc: h('span', { class: 'set-lines' }, h('span', { class: 'cal-meta' }, db ? `${db.schema.name} · ${db.rows.length.toLocaleString()} entries` : 'Database removed'), st),
                control: h('div', { class: 'set-actions' }, r?.feed && s.sync ? h('button', { class: 'set-btn', onclick: async () => { toast(`${r.name}: ${await syncSource(ws(), cfg, s)}`); ws().emit(); redraw(); } }, 'Sync') : null, moreControl(() => [
                    { label: 'Edit…', run: () => r && setup(r, s) },
                    ...(r?.enrich ? [{ label: 'Find missing pictures', run: () => void findPictures(ws(), cfg) }] : []),
                    ...(db ? [{ label: 'Open database', run: () => { closeWin(); window.nook?.openDb(db.key); } }] : []),
                    ...(db && r?.enrich && db.prop(r.enrich.image) ? [{ label: `Without ${r.enrich.image.toLowerCase()} (${db.rows.filter((x) => !x.values[r.enrich.image]).length})`, run: async () => {
                                // a table of the entries that have no picture yet, to add one by hand
                                const img = r.enrich.image;
                                if (!db.views.some((v) => v.id === 'nopic')) {
                                    db.views.push({ id: 'nopic', name: `Without ${img.toLowerCase()}`, type: 'table', filter: { mode: 'and', rules: [{ prop: img, op: 'empty' }] } });
                                    await ws().saveViews(db);
                                }
                                closeWin();
                                window.nook?.openDb(db.key, 'nopic');
                            } }] : []),
                    'sep',
                    { label: 'Remove source', danger: true, run: async () => { cfg.sources = cfg.sources.filter((x) => x !== s); await persist(); toast('The database and its entries stay'); } },
                ])),
            });
        }
        if (!cfg.sources.length)
            out.push({ title: 'No sources yet', desc: 'Letterboxd, Goodreads, any CSV export or feed' });
        out.push({ action: 'Add a data source…', run: () => pick(), keywords: 'letterboxd goodreads csv rss feed import' });
        return out;
    };
    return { id: 'sources', group: 'Content', label: 'Data sources', icon: 'download', summary: () => (cfg.sources.length ? String(cfg.sources.length) : ''), subtitle: 'Other services’ data in your databases – once from an export, or kept in sync.', items };
}
//# sourceMappingURL=sourcesettings.js.map