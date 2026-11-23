import { h, svgIcon, ICONS } from '../util.js';
import { iconSvg } from '../ui/icons.js';
import { menu, menuIcon, prompt, toast } from '../ui/pop.js';
import { folderOf, setFolder, uploadFiles, newFolder, refreshFileInfo, parentOf, moveInside, buildRows, saveSidecar } from '../filedb.js';
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
/** "Musik › 2026 › Mixes": each part goes back up; only inside a subfolder */
export function fileCrumb(ctx, db) {
    const cur = folderOf(db);
    if (!cur)
        return null;
    const parts = cur.split('/');
    const el = h('div', { class: 'fdb-crumb' });
    const add = (label, rel, last) => {
        const b = h('button', { class: 'fdb-crumb-b' + (last ? ' cur' : ''), onclick: () => go(ctx, db, rel) }, label);
        if (!last)
            dropTarget(ctx, db, b, rel);
        el.append(b);
    };
    add(db.schema.name, '', false);
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
async function moveTo(ctx, db, rels, folder) {
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
    root.addEventListener('dragover', (e) => { if (!hasFiles(e))
        return; e.preventDefault(); root.classList.add('fdb-drop'); });
    root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget))
        root.classList.remove('fdb-drop'); });
    root.addEventListener('drop', (e) => {
        root.classList.remove('fdb-drop');
        if (!hasFiles(e))
            return;
        e.preventDefault();
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
    return h('div', { class: 'fdb-actions' }, row.isDir ? null : btn('download', 'Download', () => void import('../ui/viewer.js').then((m) => m.downloadMedia(ctx, row.file))), ctx.ws.storage.reveal ? btn('folder', ctx.ws.storage.remote ? 'Show in Dropbox' : 'Show in folder', () => void ctx.ws.storage.reveal(row.file).catch((e) => toast(e.message))) : null);
}
//# sourceMappingURL=fileview.js.map