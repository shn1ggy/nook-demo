import { nestRows } from '../workspace.js';
import { subOpen, toggleSub, selectable, selectedRows } from './rowselect.js';
import { entryIcon, renderValue } from './cells.js';
import { dirOf } from '../layout.js';
import { h, svgIcon, ICONS, fmtNumber as _fmt } from '../util.js';
import { iconSvg } from '../ui/icons.js';
import { confirmDialog, menu, menuIcon, prompt, toast } from '../ui/pop.js';
import { folderOf, setFolder, uploadFiles, newFolder, refreshFileInfo, parentOf, moveInside, buildRows, saveSidecar, deleteFileRows } from '../filedb.js';
import { openViewer, mediaType } from '../ui/viewer.js';
import { baseOf, join } from '../layout.js';
const refreshed = new WeakSet();
/** sizes, dates and lengths: once per database each time the workspace is opened */
export function fileInfoOnce(ctx, db) {
    if (refreshed.has(db))
        return;
    refreshed.add(db);
    void ctx.ws.whenFresh().then(() => refreshFileInfo(ctx.ws, db, (p) => ctx.assetUrl(p)));
}
export function go(ctx, db, rel) { setFolder(db, rel); ctx.ws.emit(); }
/** the path bar of a database of files: always there (nothing below jumps when a folder opens), like a file
 *  manager's address bar – ↑ goes one folder up, each part of the path opens that folder */
export function fileCrumb(ctx, db) {
    const cur = folderOf(db);
    const parts = cur ? cur.split('/') : [];
    const up = parts.length ? parts.slice(0, -1).join('/') : null;
    const el = h('div', { class: 'fdb-crumb' }, h('button', { class: 'icon-btn fdb-up', 'aria-label': 'Up one folder', title: 'Up one folder', disabled: up == null, onclick: () => { if (up != null)
            go(ctx, db, up); } }, iconSvg('arrow-up', 14)));
    const add = (label, rel, last) => {
        const b = h('button', { class: 'fdb-crumb-b' + (last ? ' cur' : ''), onclick: () => { if (!last)
                go(ctx, db, rel); } }, rel === '' ? iconSvg('folder', 14) : null, label);
        if (!last)
            dropTarget(ctx, db, b, rel);
        el.append(b);
    };
    add(db.schema.name, '', !parts.length);
    parts.forEach((p, i) => { el.append(h('span', { class: 'fdb-sep' }, svgIcon(ICONS.chevron, 11))); add(p, parts.slice(0, i + 1).join('/'), i === parts.length - 1); });
    return el;
}
export function pickUpload(ctx, db) {
    const input = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
    input.addEventListener('change', () => { const fs = [...(input.files ?? [])]; input.remove(); if (fs.length)
        void upload(ctx, db, fs); });
    document.body.append(input);
    input.click();
}
async function upload(ctx, db, files, folder) {
    const t = files.length > 1 ? toast(`Adding ${files.length} files…`, 60000) : null;
    try {
        const n = await uploadFiles(ctx.ws, db, files, folder);
        ctx.ws.emit();
        void refreshFileInfo(ctx.ws, db, (p) => ctx.assetUrl(p));
        toast(n === 1 ? `Added “${files[0].name}”` : `Added ${n} files`);
    }
    catch (e) {
        toast(`Could not add the files: ${e.message}`);
    }
    finally {
        t?.close?.();
    }
}
export function askNewFolder(ctx, db, at) {
    prompt(at, 'Folder name', '', async (v) => {
        try {
            await newFolder(ctx.ws, db, v.trim() || 'New folder');
            ctx.ws.emit();
        }
        catch (e) {
            toast(`Could not make the folder: ${e.message}`);
        }
    });
}
/** the blue New button of a database of files: Upload files… (▾ New folder) */
export function newFileButton(ctx, db) {
    const main = h('button', { class: 'btn-new', title: 'Upload files', onclick: () => pickUpload(ctx, db) }, 'New');
    const more = h('button', { class: 'btn-new btn-new-more', 'aria-label': 'More', title: 'Upload files or make a folder', onclick: () => menu(more, [
            { label: 'Upload files…', icon: menuIcon('upload'), run: () => pickUpload(ctx, db) },
            { label: 'New folder', icon: menuIcon('folder'), run: () => askNewFolder(ctx, db, more) },
        ]) }, svgIcon(ICONS.chevron, 12));
    return h('span', { class: 'btn-new-split' }, main, more);
}
const hasFiles = (e) => !!e.dataTransfer?.types.includes('Files');
const hasRows = (e) => !!e.dataTransfer?.types.includes('text/x-nook-rows');
/** a folder (row, card, path part) that takes files dropped from the computer, and entries dragged onto it (moved there) */
export function dropTarget(ctx, db, el, rel) {
    const on = { capture: true };
    el.addEventListener('dragover', (e) => { if (!hasFiles(e) && !hasRows(e))
        return; e.preventDefault(); e.stopImmediatePropagation(); if (e.dataTransfer)
        e.dataTransfer.dropEffect = 'move'; el.classList.add('fdb-drop-into'); }, on);
    el.addEventListener('dragleave', () => el.classList.remove('fdb-drop-into'), on);
    el.addEventListener('drop', async (e) => {
        el.classList.remove('fdb-drop-into');
        if (hasRows(e)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            let ids = [];
            try {
                ids = JSON.parse(e.dataTransfer.getData('text/x-nook-rows'));
            }
            catch { /* nothing */ }
            const rels = ids.map((id) => db.byId(id)?.rel).filter((x) => x != null);
            await moveTo(ctx, db, rels, rel);
            return;
        }
        if (!hasFiles(e))
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const fs = [...(e.dataTransfer?.files ?? [])];
        if (fs.length)
            await upload(ctx, db, fs, rel);
    }, on);
}
export async function moveTo(ctx, db, rels, folder) {
    let n = 0;
    for (const rel of rels) {
        if (!rel || rel === folder || folder.startsWith(rel + '/') || (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '') === folder)
            continue;
        const name = baseOf(rel);
        if (db.rows.some((r) => r.rel === join(folder, name))) {
            toast(`“${name}” is already there`);
            continue;
        }
        try {
            await moveInside(ctx.ws, db, rel, join(folder, name));
            n++;
        }
        catch (e) {
            toast(`Could not move “${name}”: ${e.message}`);
        }
    }
    if (!n)
        return;
    buildRows(ctx.ws, db);
    await saveSidecar(ctx.ws, db);
    ctx.ws.emit();
    toast(n === 1 ? `Moved to ${folder ? baseOf(folder) : db.schema.name}` : `Moved ${n} items`);
}
/** the whole view takes files dropped from the computer: into the folder it shows */
export function viewDrop(ctx, db, root) {
    // capture: the page around the view must not take the files as well (they'd land in the page's folder)
    root.addEventListener('dragover', (e) => { if (!hasFiles(e))
        return; e.preventDefault(); e.stopPropagation(); root.classList.add('fdb-drop'); });
    root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget))
        root.classList.remove('fdb-drop'); });
    root.addEventListener('drop', (e) => {
        root.classList.remove('fdb-drop');
        if (!hasFiles(e))
            return;
        e.preventDefault();
        e.stopPropagation();
        const fs = [...(e.dataTransfer?.files ?? [])];
        if (fs.length)
            void upload(ctx, db, fs);
    });
}
/** opening an entry: a folder opens in the view, pictures, videos, PDFs and sounds in the viewer; null = the info window */
export function openFileEntry(ctx, db, row) {
    if (row.isDir) {
        go(ctx, db, row.rel);
        return true;
    }
    if (!row.file || !mediaType(row.file))
        return false;
    const here = db.rows.filter((r) => !r.isDir && parentOf(r) === parentOf(row) && r.file && mediaType(r.file)).sort((a, b) => (a.rel ?? '').localeCompare(b.rel ?? ''));
    openViewer(ctx, here.map((r) => ({ path: r.file, open: () => ctx.openRow(db, r, { info: true }), entryName: baseOf(r.rel) })), Math.max(0, here.indexOf(row)));
    return true;
}
/** in an entry's window: what to do with the file */
export function fileActions(ctx, row) {
    const btn = (icon, label, run) => h('button', { class: 'set-btn with-icon', onclick: run }, iconSvg(icon, 14), label);
    const remote = ctx.ws.storage.remote;
    return h('div', { class: 'fdb-actions' }, row.isDir ? null : phone()
        ? btn('upload', 'Share or save', () => void import('../ui/viewer.js').then((m) => m.shareMedia(ctx, row.file)))
        : btn('download', 'Download', () => void import('../ui/viewer.js').then((m) => m.downloadMedia(ctx, row.file))), ctx.ws.storage.reveal ? btn('folder', phone() && remote ? 'Dropbox' : remote ? 'Show in Dropbox' : 'Show in folder', () => void ctx.ws.storage.reveal(row.file).catch((e) => toast(e.message))) : null);
}
/** rename where there's no name cell to type in (gallery, menus): a small field */
export function renameByPrompt(ctx, db, row, at) {
    prompt(at, row.isDir ? 'Folder name' : 'File name', baseOf(row.rel ?? ''), async (v) => {
        const name = v.trim();
        if (!name || name === baseOf(row.rel ?? ''))
            return;
        row.values[db.titleProp] = name;
        ctx.ws.boundary();
        await ctx.ws.saveRow(db, row);
        ctx.ws.emit();
    });
}
const phone = () => document.documentElement.classList.contains('phone');
/** "Move to folder…": every folder of the database (not into itself) */
export function moveToFolderMenu(ctx, db, rows, at) {
    const blocked = (rel) => rows.some((r) => r.isDir && (rel === r.rel || rel.startsWith(r.rel + '/')));
    const dirs = db.rows.filter((r) => r.isDir && !blocked(r.rel)).map((r) => r.rel).sort((a, b) => a.localeCompare(b));
    menu(at, [
        { section: 'Move to' },
        { label: db.schema.name, icon: menuIcon('folder'), run: () => void moveTo(ctx, db, rows.map((r) => r.rel), '') },
        ...dirs.map((d) => ({ label: d.split('/').join(' › '), icon: menuIcon('folder'), run: () => void moveTo(ctx, db, rows.map((r) => r.rel), d) })),
    ], { filter: dirs.length > 8 });
}
/** right-click (long-press on the phone) on a file or folder; with several selected: what applies to all */
export function fileRowMenu(ctx, db, row, many, at, after) {
    const list = many.length ? many : [row];
    const one = list.length === 1;
    const remote = ctx.ws.storage.remote;
    const rename = () => {
        const el = document.querySelector(`.dbview .selectable[data-row="${CSS.escape(row.id)}"]`);
        if (el)
            import('./rowselect.js').then((m) => m.renameAt(el));
        else
            renameByPrompt(ctx, db, row, at);
    };
    const share = async () => { const v = await import('../ui/viewer.js'); for (const r of list.filter((x) => !x.isDir))
        await v.shareMedia(ctx, r.file); };
    menu(at, [
        { section: one ? baseOf(row.rel ?? '') : `${list.length} items` },
        ...(one ? [
            { label: 'Open', icon: menuIcon(row.isDir ? 'folder' : 'eye'), run: () => ctx.openRow(db, row) },
            ...(row.isDir ? [] : [{ label: 'Info', icon: menuIcon('info'), run: () => ctx.openRow(db, row, { info: true }) }]),
            { label: 'Rename', icon: menuIcon('pencil'), hint: phone() ? undefined : 'F2', run: rename },
        ] : []),
        { label: 'Move to folder…', icon: menuIcon('folder'), run: () => moveToFolderMenu(ctx, db, list, at) },
        ...(list.some((r) => !r.isDir) ? [phone()
                ? { label: 'Share or save', icon: menuIcon('upload'), run: () => void share() }
                : { label: one ? 'Download' : 'Download all', icon: menuIcon('download'), run: () => void import('../ui/viewer.js').then(async (m) => { for (const r of list.filter((x) => !x.isDir))
                        await m.downloadMedia(ctx, r.file); }) }] : []),
        ...(one && !phone() && ctx.ws.storage.reveal ? [{ label: remote ? 'Show in Dropbox' : 'Show in folder', icon: menuIcon('folder'), run: () => void ctx.ws.storage.reveal(row.file).catch((e) => toast(e.message)) }] : []),
        ...(one && document.documentElement.classList.contains('touch') ? [{ label: 'Select', icon: menuIcon('check-square'), run: () => void import('./rowselect.js').then((m) => m.startSelectMode(row.id)) }] : []),
        'sep',
        { label: 'Move to Unused files', icon: menuIcon('archive'), run: async () => {
                ctx.ws.boundary();
                for (const r of list)
                    await ctx.ws.deleteRow(db, r);
                toast(one ? `“${baseOf(row.rel ?? '')}” is in Unused files` : `${list.length} items are in Unused files`);
                after();
            } },
        { label: 'Delete permanently…', icon: menuIcon('trash'), danger: true, run: () => {
                const what = one ? `“${baseOf(row.rel ?? '')}”` : `${list.length} items`;
                confirmDialog({ title: `Delete ${what} permanently?`, lines: [list.some((r) => r.isDir) ? 'Folders go with everything in them.' : 'The file is deleted from the workspace folder.', 'This can’t be undone in Nook (Dropbox keeps deleted files for a while).'], ok: 'Delete permanently', danger: true, onOk: async () => {
                        try {
                            await deleteFileRows(ctx.ws, db, list);
                            ctx.ws.emit();
                            toast(`${what} deleted`);
                        }
                        catch (e) {
                            toast(`Could not delete: ${e.message}`);
                        }
                        after();
                    } });
            } },
    ]);
}
/** the phone's ＋: what to add to the folder shown */
export function addMenu(ctx, db, at) {
    const f = folderOf(db);
    const pick = (o) => {
        const input = h('input', { type: 'file', multiple: !o.capture, accept: o.accept, style: { display: 'none' } });
        if (o.capture)
            input.setAttribute('capture', 'environment');
        input.addEventListener('change', () => { const fs = [...(input.files ?? [])]; input.remove(); if (fs.length)
            void upload(ctx, db, fs); });
        document.body.append(input);
        input.click();
    };
    menu(at, [
        { section: `Add to ${f ? baseOf(f) : db.schema.name}` },
        { label: 'Files', icon: menuIcon('upload'), hint: 'iCloud, Dropbox', run: () => pick({}) },
        { label: 'Photos & videos', icon: menuIcon('image'), run: () => pick({ accept: 'image/*,video/*' }) },
        { label: 'Take photo or video', icon: menuIcon('camera'), run: () => pick({ accept: 'image/*,video/*', capture: true }) },
        { label: 'New folder', icon: menuIcon('folder-plus'), run: () => askNewFolder(ctx, db, at) },
    ]);
}
/** the phone: a database of files as a list – folders open in place (▸), a tap opens, holding gives the menu */
export function renderFilePhone(env, rows) {
    const { ctx, db } = env;
    const list = h('div', { class: 'fdb-plist' });
    const items = nestRows(db, rows, (id, ghost) => subOpen(`${db.key}:${id}`, ghost));
    for (const it of items) {
        const r = it.row;
        const key = `${db.key}:${r.id}`;
        const open = it.kids ? subOpen(key, !!it.ghost) : false;
        const tri = r.isDir ? h('button', { class: 'fdb-tri' + (open ? ' open' : ''), 'aria-label': open ? 'Close folder' : 'Show what’s inside', onclick: (e) => { e.stopPropagation(); toggleSub(key, !!it.ghost); env.redraw(); } }, it.kids ? iconSvg('chevron-right', 13) : null) : h('span', { class: 'fdb-tri none' });
        const tags = db.schema.properties.filter((p) => !p.file && p.type !== 'title').flatMap((p) => { const v = r.values[p.name]; return v == null || v === '' || (Array.isArray(v) && !v.length) ? [] : [renderValue(db, p, v)]; });
        const len = db.schema.properties.find((p) => p.file === 'length'), size = db.schema.properties.find((p) => p.file === 'size');
        const n = r.isDir ? db.rows.filter((x) => x.rel && dirOf(x.rel) === r.rel).length : 0;
        const facts = r.isDir ? `${n} item${n === 1 ? '' : 's'}` : [len && r.values[len.name] != null ? _fmt(Number(r.values[len.name]), 'duration') : '', size && r.values[size.name] != null ? _fmt(Number(r.values[size.name]), 'bytes') : ''].filter(Boolean).join(' · ');
        const el = h('div', { class: 'fdb-li', style: { paddingLeft: `${14 + it.depth * 22}px` } }, tri, entryIcon(r, 20), h('div', { class: 'fdb-tx' }, h('div', { class: 'fdb-name' }, baseOf(r.rel ?? '')), h('div', { class: 'fdb-sub' }, ...tags, facts ? h('span', null, facts) : null)));
        selectable(el, env, r, () => ctx.openRow(db, r));
        el.addEventListener('nook-rename', () => renameByPrompt(ctx, db, r, el));
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); const s = selectedRows(); fileRowMenu(ctx, db, r, s && s.env.db === db && s.rows.includes(r) ? s.rows : [r], el, () => env.redraw()); });
        // hold: the menu (as a right-click)
        let t, sx = 0, sy = 0;
        el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; t = setTimeout(() => { el.classList.add('held'); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); setTimeout(() => el.classList.remove('held'), 300); }, 480); }, { passive: true });
        el.addEventListener('touchmove', (e) => { if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 8)
            clearTimeout(t); }, { passive: true });
        el.addEventListener('touchend', () => clearTimeout(t));
        if (r.isDir)
            dropTarget(ctx, db, el, r.rel);
        list.append(el);
    }
    if (!items.length)
        list.append(h('div', { class: 'fdb-empty' }, 'Nothing here yet – ＋ adds files'));
    return list;
}
//# sourceMappingURL=fileview.js.map