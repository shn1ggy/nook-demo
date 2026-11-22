// Trash (deleted pages and entries, 30 days) and history (earlier versions of a page or entry).
import { moreControl } from './settings.js';
import { iconSvg } from './icons.js';
import { h, svgIcon, ICONS, fmtDate, fmtTime, isoOfDate, segmented } from '../util.js';
import { plainText } from '../format/inline.js';
import { confirmDialog, dialog, toast } from './pop.js';
import { renderIcon } from './icons.js';
/** a window's top: its name, and Close (on the phone: name in the middle, “Done” on the right) */
/** the large title at the top of a phone window (as in Settings) */
export function bigTitle(title) { return h('h1', { class: 'win-big' }, title); }
/** a coloured icon tile, as in the Settings list */
export function tileIcon(icon, color) { return h('span', { class: 'win-tile', style: { background: color } }, icon); }
export function sheetHead(title, close) {
    return h('div', { class: 'dialog-head sheet-head' }, h('span', { class: 'sheet-left' }), h('strong', { class: 'sheet-title' }, title), h('button', { class: 'icon-btn sheet-close', 'aria-label': 'Close', onclick: () => close() }, svgIcon(ICONS.close), h('span', { class: 'sheet-done' }, 'Done')));
}
/** nothing to show: an icon and one line, in the middle */
function emptyState(icon, text) {
    return h('div', { class: 'empty-state' }, h('span', { class: 'empty-ico' }, iconSvg(icon, 28)), h('span', null, text));
}
import { Editor } from './editor.js';
import { input } from './comments.js';
import { parsePage } from '../format/page.js';
import { alignStamps, diff3 } from '../storage/merge.js';
import { formatRow, parsePageFile, parseRow } from '../workspace.js';
import { renderValue } from '../views/cells.js';
/** "3 min ago", "yesterday 14:20", "12.10.2026 09:15" for a UTC timestamp without zone */
export function when(t) {
    const d = new Date(/Z$/.test(t) ? t : t + 'Z');
    const s = (Date.now() - d.getTime()) / 1000;
    const time = fmtTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`); // in the workspace's time format
    if (s < 60)
        return 'just now';
    if (s < 3600)
        return `${Math.round(s / 60)} min ago`;
    const today = new Date();
    const y = new Date();
    y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString())
        return `today ${time}`;
    if (d.toDateString() === y.toDateString())
        return `yesterday ${time}`;
    return `${fmtDate({ start: isoOfDate(d) })} ${time}`;
}
/** what a kept file is: a page, or an entry of a database */
function describe(ws, path, content) {
    const w = ws.whatIs(path);
    if (w?.kind === 'page') {
        try {
            const p = parsePageFile(content, path);
            const parent = p.parent ? ws.pages.get(p.parent)?.title : undefined;
            return { title: p.title || 'Untitled', icon: renderIcon(p.icon, 16, 'file'), where: parent ? `in ${parent}` : 'Page' };
        }
        catch { /* fall through */ }
    }
    if (w?.kind === 'schema') {
        try {
            const sc = JSON.parse(content);
            return { title: sc.name || 'Database', icon: renderIcon(sc.icon, 16, 'database'), where: 'Database' };
        }
        catch { /* fall through */ }
    }
    const db = w?.kind === 'row' ? w.db : undefined;
    if (db) {
        try {
            const r = parseRow(content, path.split('/').pop());
            return { title: plainText(String(r.values[db.titleProp] ?? '')) || 'Untitled', icon: renderIcon(r.icon ?? db.schema.icon, 16, 'file-text'), where: db.schema.name, db };
        }
        catch { /* fall through */ }
    }
    return { title: path.split('/').pop().replace(/\.md$/, ''), icon: renderIcon(undefined, 16, 'file'), where: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' };
}
// ---------- trash ----------
export async function openTrash(ws, onRestored) {
    // open at once; the list fills in when the trash has been read
    let items = [];
    let loading = true;
    let q = '';
    const list = h('div', { class: 'keep-list' });
    const search = h('input', { class: 'pset-search-in', placeholder: 'Search the trash', 'aria-label': 'Search the trash', autocomplete: 'off' });
    const searchBox = h('label', { class: 'pset-search win-searchbox' }, svgIcon(ICONS.search, 16), search);
    search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); draw(); });
    search.addEventListener('keydown', (e) => { if (e.key !== 'Escape')
        e.stopPropagation(); });
    const empty = h('button', { class: 'set-btn danger win-text-btn', onclick: () => {
            if (!items.length)
                return;
            confirmDialog({ title: `Empty the trash?`, lines: [`${items.length} item${items.length === 1 ? '' : 's'} will be deleted for good.`], ok: 'Empty trash', danger: true, onOk: async () => { for (const it of items)
                    await ws.deleteForever(it); items = []; draw(); } });
        } }, 'Empty trash');
    const summary = h('span', null);
    const draw = () => {
        list.textContent = '';
        // a page deleted together with its subpages is one line
        const seen = new Set();
        const pageOf = (it) => { try {
            return ws.whatIs(it.path)?.kind === 'page' ? parsePageFile(it.content, it.path) : null;
        }
        catch {
            return null;
        } };
        const top = (it) => {
            const group = items.filter((x) => x.batch === it.batch);
            const ids = new Set(group.map((x) => pageOf(x)?.id));
            const dbItem = group.find((x) => /\/database\.json$/.test(x.path));
            if (dbItem)
                return dbItem;
            return group.find((x) => { const pg = pageOf(x); return !pg?.parent || !ids.has(pg.parent); }) ?? it;
        };
        const shown = items.filter((it) => { if (!it.batch)
            return true; if (seen.has(it.batch))
            return false; seen.add(it.batch); return true; }).map((it) => (it.batch ? top(it) : it))
            .map((it) => ({ it, d: describe(ws, it.path, it.content), more: it.batch ? items.filter((x) => x.batch === it.batch).length - 1 : 0 }))
            .filter((x) => !q || `${x.d.title} ${x.d.where}`.toLowerCase().includes(q));
        summary.textContent = `Kept for 30 days · ${shown.length} item${shown.length === 1 ? '' : 's'}`;
        if (!shown.length) {
            list.appendChild(loading ? h('div', { class: 'keep-empty' }, 'Loading…') : emptyState(items.length ? 'search' : 'trash', items.length ? 'Nothing found' : 'The trash is empty'));
            empty.toggleAttribute('disabled', !items.length);
            return;
        }
        // grouped by time, newest first: this week, earlier
        const weekAgo = Date.now() - 7 * 864e5;
        const t = (it) => new Date(it.deleted).getTime() || 0;
        for (const [title, part] of [['This week', shown.filter((x) => t(x.it) >= weekAgo)], ['Earlier', shown.filter((x) => t(x.it) < weekAgo)]]) {
            if (!part.length)
                continue;
            const card = h('div', { class: 'set-card' });
            for (const { it, d, more } of part) {
                const restore = async () => { const n = await ws.restore(it, items); items = items.filter((x) => (it.batch ? x.batch !== it.batch : x !== it)); draw(); onRestored(); toast(n > 1 ? `Restored “${d.title}” and ${n - 1} more` : `Restored “${d.title}”`); };
                const forever = async () => { const group = it.batch ? items.filter((x) => x.batch === it.batch) : [it]; for (const x of group)
                    await ws.deleteForever(x); items = items.filter((x) => !group.includes(x)); draw(); };
                card.appendChild(h('div', { class: 'set-row' }, h('span', { class: 'win-tile neutral' }, d.icon), h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, d.title), h('div', { class: 'set-desc' }, `${d.where}${more ? (/\/database\.json$/.test(it.path) ? ` · with ${Math.max(0, more - 1)} entr${more - 1 === 1 ? 'y' : 'ies'}` : ` · with ${more} subpage${more > 1 ? 's' : ''}`) : ''} · deleted ${when(it.deleted)}`)), h('div', { class: 'set-control' }, h('button', { class: 'set-btn win-text-btn', onclick: restore }, 'Restore'), moreControl(() => [{ label: 'Restore', run: restore }, 'sep', { label: 'Delete for good', danger: true, run: () => confirmDialog({ title: `Delete “${d.title}” for good?`, lines: ['It can’t be restored afterwards.'], ok: 'Delete', danger: true, onOk: forever }) }]))));
            }
            list.append(h('section', { class: 'set-sec' }, h('div', { class: 'set-heading' }, h('h3', null, title)), card));
        }
        empty.toggleAttribute('disabled', !items.length);
    };
    draw();
    const close = dialog(h('div', { class: 'bwindow keep-window' }, sheetHead('Trash', () => close()), h('div', { class: 'dialog-body bwin pset' }, bigTitle('Trash'), searchBox, h('div', { class: 'win-sum' }, summary, empty), list)));
    if (!document.documentElement.classList.contains('phone'))
        requestAnimationFrame(() => search.focus());
    items = await ws.trash();
    loading = false;
    draw();
}
// ---------- history ----------
export async function openHistory(ws, ctx, path, onRestored) {
    const versions = await ws.versions(path);
    const current = await ws.readExtra(path);
    const d = describe(ws, path, current ?? '');
    const list = h('div', { class: 'hist-list' });
    const preview = h('div', { class: 'hist-preview' });
    const restoreBtn = h('button', { class: 'btn-new' }, 'Restore this version');
    let picked = null;
    const show = (content) => {
        preview.textContent = '';
        if (ws.whatIs(path)?.kind === 'page') {
            const p = parsePageFile(content, path);
            preview.append(h('h1', { class: 'hist-title' }, p.title || 'Untitled'), new Editor(p.blocks, ctx, () => { }, true).el);
            return;
        }
        if (!d.db) {
            preview.appendChild(h('pre', null, content));
            return;
        }
        const db = d.db;
        const r = parseRow(content, path.split('/').pop());
        preview.appendChild(h('h1', { class: 'hist-title' }, plainText(String(r.values[db.titleProp] ?? '')) || 'Untitled'));
        const props = h('div', { class: 'hist-props' });
        for (const p of db.schema.properties) {
            if (p.type === 'title')
                continue;
            const v = r.values[p.name];
            if (v == null || v === '' || (Array.isArray(v) && !v.length))
                continue;
            props.append(h('span', { class: 'hist-prop' }, p.name), h('span', null, renderValue(db, p, v)));
        }
        preview.appendChild(props);
        if (r.body.trim())
            preview.appendChild(new Editor(parsePage(r.body), ctx, () => { }, true).el);
    };
    const pick = (v, el) => {
        picked = v;
        list.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
        el.classList.add('on');
        show(v ? v.content : current ?? '');
        restoreBtn.disabled = !v;
    };
    const cur = h('button', { class: 'hist-item', onclick: () => pick(null, cur) }, h('span', { class: 'hist-when' }, 'Now'), h('span', { class: 'keep-meta' }, 'Current version · the last 50 are kept'));
    list.appendChild(cur);
    for (const v of versions) {
        const el = h('button', { class: 'hist-item', onclick: () => pick(v, el) }, h('span', { class: 'hist-when' }, when(v.t)), h('span', { class: 'keep-meta' }, `${Math.max(1, Math.round(v.content.length / 100) / 10)} kB`));
        list.appendChild(el);
    }
    if (!versions.length)
        list.appendChild(h('div', { class: 'keep-empty' }, 'No earlier versions yet. A version is kept at most every 10 minutes while you edit.'));
    restoreBtn.addEventListener('click', async () => {
        if (!picked)
            return;
        await ws.restoreVersion(path, picked.content);
        close();
        onRestored();
        toast(`Restored the version from ${when(picked.t)} · undo with Ctrl+Z`);
    });
    const close = dialog(h('div', { class: 'bwindow hist-window' }, h('div', { class: 'dialog-head' }, h('span', { class: 'keep-ico' }, d.icon), h('strong', { style: { padding: '0 6px', flex: 1 } }, `History of “${d.title}”`), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, svgIcon(ICONS.close))), h('div', { class: 'hist-body' }, list, preview), h('div', { class: 'bfooter' }, h('button', { class: 'set-btn', onclick: () => close() }, 'Close'), restoreBtn)), { wide: true });
    pick(versions[0] ?? null, list.children[versions.length ? 1 : 0]);
}
// ---------- Dropbox conflicts ----------
export async function openConflicts(ws, ctx, onDone) {
    // copies that are the same as the file (only saved twice) never need a decision
    if (await ws.tidyConflicts())
        onDone();
    const body = h('div', { class: 'conf-body' });
    const draw = async () => {
        body.textContent = '';
        if (!ws.conflicts.length) {
            body.appendChild(h('div', { class: 'keep-empty' }, 'No conflicts left.'));
            return;
        }
        const c = ws.conflicts[0];
        const mine = (await ws.readExtra(c.original, true)) ?? '';
        const theirs = (await ws.conflictText(c)) ?? '';
        const d = describe(ws, c.original, mine || theirs);
        // edit times aside (they always differ), then the file part by part: each change is chosen on its own
        const [ma, mb] = alignStamps([mine, theirs]);
        const a = ma.split('\n'), b = mb.split('\n');
        const hunks = diff3(a, a, b);
        const changes = hunks.filter((x) => !('same' in x));
        const pick = new Map(changes.map((x) => [x, 'mine']));
        // when each version was saved (from its "edited" line)
        const when = (t) => t.match(/^_?edited:\s*"?([0-9T:.\-]+Z?)/m)?.[1] ?? '';
        const shown = (v) => { if (!v)
            return ''; const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : v + 'Z'); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
        const wa = when(mine), wb = when(theirs);
        const lines = (l) => h('pre', { class: 'conf-text' }, ...(l.length ? l : ['']).map((x) => h('div', { class: 'conf-line' }, x || ' ')));
        const list = h('div', { class: 'conf-hunks' });
        const drawList = () => {
            list.textContent = '';
            for (const hk of hunks) {
                if ('same' in hk) {
                    const l = hk.same;
                    if (l.length <= 4)
                        list.append(h('div', { class: 'conf-same' }, lines(l)));
                    else
                        list.append(h('div', { class: 'conf-same' }, lines(l.slice(0, 2)), h('div', { class: 'conf-skip' }, `${l.length - 4} lines the same`), lines(l.slice(-2))));
                    continue;
                }
                const cur = pick.get(hk);
                const side = (k, title, l) => h('button', { type: 'button', class: 'conf-side' + (cur === k || cur === 'both' ? ' on' : ''), onclick: () => { pick.set(hk, k); drawList(); } }, h('span', { class: 'conf-side-head' }, title), l.length ? lines(l) : h('span', { class: 'conf-gone' }, 'Not in this version'));
                list.append(h('div', { class: 'conf-hunk' }, h('div', { class: 'conf-pair' }, side('mine', 'In Nook', hk.mine), side('theirs', 'Other copy', hk.theirs)), h('div', { class: 'conf-hunk-foot' }, h('button', { type: 'button', class: 'set-btn' + (cur === 'both' ? ' on' : ''), onclick: () => { pick.set(hk, cur === 'both' ? 'mine' : 'both'); drawList(); } }, 'Keep both parts'))));
            }
        };
        drawList();
        const combined = () => hunks.flatMap((hk) => 'same' in hk ? hk.same : pick.get(hk) === 'theirs' ? hk.theirs : pick.get(hk) === 'both' ? [...hk.mine, ...hk.theirs] : hk.mine).join('\n');
        const all = (k) => h('button', { class: 'set-btn', onclick: () => { for (const x of changes)
                pick.set(x, k); drawList(); } }, k === 'mine' ? 'All from Nook' : 'All from the other copy');
        body.append(h('div', { class: 'conf-what' }, h('span', { class: 'keep-ico' }, d.icon), h('strong', null, d.title), h('span', { class: 'keep-meta' }, `${d.where} · ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}${ws.conflicts.length > 1 ? ` · 1 of ${ws.conflicts.length}` : ''}`)), ...((wa || wb) ? [h('div', { class: 'conf-when' }, `In Nook: ${shown(wa) || '–'}`, h('span', { class: 'sepd' }), `Other copy: ${shown(wb) || '–'}`, wa !== wb ? h('span', { class: 'conf-newer' }, `${wa > wb ? 'Nook' : 'other copy'} is newer`) : null)] : []), list, h('div', { class: 'conf-actions' }, all('mine'), all('theirs'), ws.whatIs(c.original)?.kind === 'page' || ws.whatIs(c.original)?.kind === 'row' ? h('button', { class: 'set-btn', onclick: async () => { await ws.resolveConflict(c, 'both'); onDone(); draw(); } }, 'Keep as two pages') : null, h('button', { class: 'btn-new', onclick: async () => { await ws.resolveConflictWith(c, combined()); onDone(); draw(); } }, 'Save')));
    };
    await draw();
    const close = dialog(h('div', { class: 'bwindow hist-window' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px', flex: 1 } }, 'Dropbox conflicts'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, svgIcon(ICONS.close))), body, h('div', { class: 'bfooter' }, h('span', { class: 'bfield-hint' }, 'Two devices changed the same part before Dropbox could sync. Pick a side for each change; Save writes the result and removes the copy.'))), { wide: true });
    void ctx;
}
// ---------- all comments ----------
/** every open comment of the workspace, to jump to its page or entry */
let showDoneComments = false;
export async function openAllComments(ws, openPath) {
    const all = await ws.allComments();
    let showDone = showDoneComments;
    const list = h('div', { class: 'keep-list' });
    // open or done, as two segments at the top
    const seg = segmented([['open', 'Open'], ['done', 'Done']], showDone ? 'done' : 'open', (v) => { showDone = showDoneComments = v === 'done'; draw(); }, 'Which comments');
    const draw = () => {
        list.textContent = '';
        let n = 0;
        for (const f of all) {
            // the page or entry it belongs to (gone: skip)
            const page = [...ws.pages.values()].find((x) => x.file === f.path);
            const hit = ws.rowAt(f.path);
            const rowDb = hit?.db, row = hit?.row;
            if (!page && !row)
                continue;
            const current = ws.readExtraSync(f.path) ?? (page ? `---\nid: ${page.id}\ntitle: ${JSON.stringify(page.title)}\n---\n` : rowDb && row ? formatRow(rowDb, row) : '');
            const cs = f.comments.filter((c) => (showDone ? c.done : !c.done));
            if (!cs.length)
                continue;
            const d = describe(ws, f.path, current);
            // one card per page or entry, its comments as rows
            const card = h('div', { class: 'set-card' });
            for (const c of cs) {
                n++;
                // open it; closing what opened (Esc) comes back to this list
                const open = () => { close(); openPath(f.path, () => void openAllComments(ws, openPath)); };
                // the same actions as on the page: Edit, Resolve (open ones), Delete – resolving and deleting
                // also take the highlight out of the text, as they do there
                const unmark = async () => {
                    const re = new RegExp(`<mark comment="${c.id}">([\\s\\S]*?)</mark>`, 'g');
                    if (row && rowDb) {
                        if (re.test(row.body ?? '')) {
                            row.body = (row.body ?? '').replace(re, '$1');
                            await ws.saveRow(rowDb, row);
                        }
                        return;
                    }
                    const text = ws.readExtraSync(f.path) ?? await ws.storage.read(f.path).catch(() => null);
                    if (text && re.test(text))
                        await ws.write(f.path, text.replace(re, '$1'));
                };
                const del = async () => { await unmark(); f.comments = f.comments.filter((x) => x !== c); await ws.saveComments(f.path, f.comments); draw(); };
                const resolve = async () => { await unmark(); c.done = true; c.edited = new Date().toISOString(); await ws.saveComments(f.path, f.comments); draw(); };
                const edit = () => {
                    const ta = input(c.text, 'Edit comment', async (t) => { if (t && t !== c.text) {
                        c.text = t;
                        c.edited = new Date().toISOString();
                        await ws.saveComments(f.path, f.comments);
                    } draw(); }, () => draw());
                    title.replaceWith(ta);
                    ta.addEventListener('click', (e) => e.stopPropagation());
                };
                const title = h('div', { class: 'set-title' }, c.text);
                const r = h('div', { class: 'set-row comment-row' + (c.done ? ' done' : ''), role: 'button', tabindex: 0, onclick: open }, h('div', { class: 'set-text' }, title, c.quote ? h('div', { class: 'win-quote' }, `„${c.quote.length > 70 ? c.quote.slice(0, 70) + '…' : c.quote}“`) : null), h('span', { class: 'set-value win-age' }, when(c.created)), h('span', { class: 'cmt-actions', onclick: (e) => e.stopPropagation() }, h('button', { class: 'icon-btn', 'aria-label': 'Edit comment', title: 'Edit', onclick: edit }, iconSvg('pencil', 14)), c.done ? null : h('button', { class: 'icon-btn', 'aria-label': 'Resolve comment', title: 'Resolve (removes the highlight, keeps the comment under Done)', onclick: resolve }, iconSvg('check-circle', 15)), h('button', { class: 'icon-btn', 'aria-label': 'Delete comment', title: 'Delete', onclick: del }, svgIcon(ICONS.trash, 14))));
                r.addEventListener('keydown', (e) => { if (e.key === 'Enter')
                    open(); });
                card.appendChild(r);
            }
            list.appendChild(h('section', { class: 'set-sec' }, h('div', { class: 'set-heading' }, h('h3', { class: 'with-ico' }, h('span', { class: 'head-ico' }, d.icon), `${d.title}${d.where ? ` · ${d.where}` : ''}`)), card));
        }
        if (!n)
            list.appendChild(emptyState('message', showDone ? 'No done comments' : 'No open comments'));
    };
    draw();
    const close = dialog(h('div', { class: 'bwindow keep-window' }, sheetHead('Comments', () => close()), h('div', { class: 'dialog-body bwin pset' }, bigTitle('Comments'), h('div', { class: 'win-seg' }, seg), list)));
}
//# sourceMappingURL=keep.js.map