import { parsePage } from '../format/page.js';
import { ZipStorage } from '../importer/zipwrite.js';
import { asDate } from '../util.js';
/** a file or folder name that every system accepts */
export function safeName(s) {
    const t = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 80).trim();
    return t || 'Untitled';
}
const rel = (from, to) => {
    const a = from.split('/').slice(0, -1), b = to.split('/');
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i])
        i++;
    return [...a.slice(i).map(() => '..'), ...b.slice(i)].map(encodeURIComponent).join('/');
};
/** where everything ends up in the export: pages, databases and entries by their place in the tree */
class Plan {
    ws;
    pages = new Map(); // page id → "Folder/Title.md"
    dbs = new Map(); // database key → "Name.csv"
    rows = new Map(); // "db/rowId" → "Name/Entry.md"
    taken = new Set();
    constructor(ws) {
        this.ws = ws;
    }
    free(path, ext) {
        let p = `${path}${ext}`, n = 2;
        while (this.taken.has(p.toLowerCase()))
            p = `${path} ${n++}${ext}`;
        this.taken.add(p.toLowerCase());
        return p;
    }
    addPage(p, dir, deep) {
        if (this.pages.has(p.id))
            return;
        const file = this.free(dir + safeName(p.title || 'Untitled'), '.md');
        this.pages.set(p.id, file);
        if (!deep)
            return;
        const kids = [...this.ws.pages.values()].filter((c) => c.parent === p.id).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.title.localeCompare(b.title));
        for (const c of kids)
            this.addPage(c, file.slice(0, -3) + '/', true);
    }
    addDb(db, dir) {
        if (this.dbs.has(db.key))
            return;
        const file = this.free(dir + safeName(db.schema.name || 'Database'), '.csv');
        this.dbs.set(db.key, file);
        for (const r of db.rows)
            this.rows.set(`${db.key}/${r.id}`, this.free(`${file.slice(0, -4)}/${safeName(db.rowLabel(r))}`, '.md'));
    }
}
// ---------- values ----------
/** a property's value as plain text (CSV cells, the property lines of an entry) */
function valueText(db, row, prop) {
    const def = db.prop(prop);
    const v = db.value(row, prop);
    if (v === null || v === undefined || v === '')
        return '';
    if (def?.type === 'relation') {
        const l = db.linked(row, prop);
        return l ? l.rows.map((r) => l.db.rowLabel(r)).join(', ') : '';
    }
    if (typeof v === 'boolean')
        return v ? 'Yes' : 'No';
    if (Array.isArray(v))
        return v.join(', ');
    if (typeof v === 'object') {
        const d = asDate(v);
        return d ? (d.end ? `${d.start} → ${d.end}` : d.start).replace(/T/g, ' ') : '';
    }
    return String(v);
}
const csvCell = (s) => {
    // a cell that a spreadsheet would run as a formula is written as text
    const t = /^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export function databaseCsv(db) {
    const props = [db.titleProp, ...db.schema.properties.map((p) => p.name).filter((n) => n !== db.titleProp)];
    const lines = [props.map(csvCell).join(',')];
    for (const r of db.rows)
        lines.push(props.map((p) => csvCell(valueText(db, r, p))).join(','));
    return '﻿' + lines.join('\r\n') + '\r\n'; // the mark makes Excel read umlauts
}
/** Nook's inline text → plain Markdown: colours, underline and comment marks have no Markdown and are dropped */
function inline(ctx, md) {
    return md
        .replace(/<\/?(span|mark)\b[^>]*>/g, '')
        .replace(/<\/?u>/g, '')
        .replace(/\[([^\]]+)\]\((nook:[^)\s]+)\)/g, (_m, text, href) => { const to = target(ctx, href.slice(5)); return to ? `[${text}](${to})` : text; });
}
/** an internal link → the exported file it points at (relative), if that is part of this export */
function target(ctx, t) {
    let key = t;
    try {
        key = decodeURIComponent(t);
    }
    catch { /* as it is */ }
    if (key.startsWith('row:')) {
        const f = ctx.plan.rows.get(key.slice(4));
        return f ? rel(ctx.file, f) : null;
    }
    const page = ctx.plan.pages.get(key);
    if (page)
        return rel(ctx.file, page);
    const db = ctx.plan.dbs.get(key);
    return db ? rel(ctx.file, db) : null;
}
/** a file of the workspace (assets/…) → copied next to the export, linked relatively */
function asset(ctx, src) {
    if (!src)
        return '';
    if (/^(https?:|data:|blob:)/i.test(src))
        return src;
    const clean = src.replace(/^\.?\//, '');
    let out = ctx.assets.get(clean);
    if (!out) {
        out = `files/${clean.split('/').map(safeName).join('/').replace(/^assets\//, '')}`;
        ctx.assets.set(clean, out);
    }
    return rel(ctx.file, out);
}
function blocksToMd(ctx, blocks, indent = '') {
    const out = [];
    let n = 0;
    let prevList = false;
    for (const b of blocks) {
        const text = inline(ctx, b.text ?? '');
        const list = b.type === 'bullet' || b.type === 'numbered' || b.type === 'todo';
        if (b.type !== 'numbered')
            n = 0;
        if (!(list && prevList) && out.length)
            out.push('');
        prevList = list;
        const kids = () => (b.children?.length ? blocksToMd(ctx, b.children, indent) : '');
        switch (b.type) {
            case 'paragraph':
                out.push(indent + text.replace(/\n/g, `  \n${indent}`));
                break;
            case 'heading':
                out.push(`${indent}${'#'.repeat(Math.min(3, Math.max(1, b.level ?? 1)))} ${text.replace(/\n/g, ' ')}`);
                break;
            case 'quote':
                out.push(text.split('\n').map((l) => `${indent}> ${l}`).join('\n'));
                break;
            case 'divider':
                out.push(`${indent}---`);
                break;
            case 'code':
                out.push(`${indent}\`\`\`${b.lang ?? ''}`, ...(b.text ?? '').split('\n').map((l) => indent + l), `${indent}\`\`\``);
                break;
            case 'bullet':
            case 'numbered':
            case 'todo': {
                const mark = b.type === 'bullet' ? '- ' : b.type === 'numbered' ? `${++n}. ` : `- [${b.checked ? 'x' : ' '}] `;
                out.push(indent + mark + text.replace(/\n/g, ' '));
                if (b.children?.length)
                    out.push(blocksToMd(ctx, b.children, indent + '    '));
                break;
            }
            case 'toggle': {
                const lvl = b.level ?? 0;
                if (lvl > 0) {
                    out.push(`${indent}${'#'.repeat(Math.min(3, lvl))} ${text.replace(/\n/g, ' ')}`);
                    const k = kids();
                    if (k)
                        out.push('', k);
                }
                else
                    out.push(`${indent}<details>`, `${indent}<summary>${text.replace(/\n/g, ' ')}</summary>`, '', kids(), '', `${indent}</details>`);
                break;
            }
            // an emoji icon goes along; Nook's own icon names mean nothing elsewhere
            case 'callout':
                out.push(`${indent}<aside>`, `${b.icon && !/^[\x00-\x7f]+$/.test(b.icon) ? b.icon + ' ' : ''}${kids()}`.trim(), `${indent}</aside>`);
                break;
            case 'columns':
            case 'column': {
                const k = kids();
                if (k)
                    out.push(k);
                else
                    out.pop();
                break;
            }
            case 'image':
                out.push(`${indent}![${text.replace(/[[\]\n]/g, ' ')}](${asset(ctx, b.src)})`);
                break;
            case 'pdf':
            case 'audio':
            case 'video':
            case 'file': {
                const name = text || decodeURIComponent((b.src ?? '').split('/').pop() ?? 'File');
                out.push(`${indent}[${name.replace(/[[\]\n]/g, ' ')}](${asset(ctx, b.src)})`);
                break;
            }
            case 'embed':
                if (b.src)
                    out.push(`${indent}[${text || b.src}](${b.src})`);
                else
                    out.pop();
                break;
            case 'pagelink': {
                const p = b.target ? ctx.ws.pages.get(b.target) : undefined;
                const db = b.target ? ctx.ws.dbs.get(b.target) : undefined;
                const title = p?.title ?? db?.schema.name ?? text ?? '';
                const to = b.target ? target(ctx, b.target) : null;
                if (!title) {
                    out.pop();
                    break;
                }
                out.push(indent + (to ? `[${title}](${to})` : title));
                break;
            }
            case 'view': {
                const db = b.db ? ctx.ws.dbs.get(b.db) : undefined;
                const to = b.db ? target(ctx, b.db) : null;
                if (!db) {
                    out.pop();
                    break;
                }
                out.push(indent + (to ? `[${db.schema.name}](${to})` : db.schema.name));
                break;
            }
            case 'table': {
                const rows = b.rows?.length ? b.rows : [['']];
                const cell = (c) => ` ${inline(ctx, c ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>')} `;
                const width = Math.max(...rows.map((r) => r.length));
                const line = (r) => `${indent}|${Array.from({ length: width }, (_x, i) => cell(r[i] ?? '')).join('|')}|`;
                const sep = `${indent}|${Array.from({ length: width }, () => ' --- ').join('|')}|`;
                // Markdown tables need a head row: without one, an empty head
                if (b.header)
                    out.push(line(rows[0]), sep, ...rows.slice(1).map(line));
                else
                    out.push(line([]), sep, ...rows.map(line));
                break;
            }
            default: out.pop(); // buttons do nothing outside Nook
        }
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
function pageMd(ctx, title, blocks, props = []) {
    const head = [`# ${title || 'Untitled'}`, ''];
    if (props.length)
        head.push(...props.map(([k, v]) => `${k}: ${v.replace(/\n/g, ' ')}`), '');
    return (head.join('\n') + '\n' + blocksToMd(ctx, blocks)).trimEnd() + '\n';
}
async function build(ws, plan, name) {
    const zip = new ZipStorage(name);
    const assets = new Map();
    for (const [id, file] of plan.pages) {
        const p = ws.pages.get(id);
        await zip.write(file, pageMd({ ws, plan, file, assets }, p.title, p.blocks));
    }
    for (const [key, file] of plan.dbs) {
        const db = ws.dbs.get(key);
        await zip.write(file, databaseCsv(db));
        for (const r of db.rows) {
            const f = plan.rows.get(`${key}/${r.id}`);
            const props = db.schema.properties.filter((p) => p.name !== db.titleProp).map((p) => [p.name, valueText(db, r, p.name)]).filter(([, v]) => v !== '');
            await zip.write(f, pageMd({ ws, plan, file: f, assets }, db.rowLabel(r), r.body ? parsePage(r.body) : [], props));
        }
    }
    // the images and files the exported pages use
    for (const [src, out] of assets) {
        try {
            const url = await ws.storage.assetUrl?.(src);
            if (!url)
                continue;
            const res = await fetch(url);
            if (res.ok)
                await zip.writeBinary(out, new Uint8Array(await res.arrayBuffer()));
        }
        catch { /* a missing file: its link stays, the file is left out */ }
    }
    const files = zip.files.size;
    // one Markdown file alone is handed over as it is
    if (files === 1) {
        const [path, data] = [...zip.files.entries()][0];
        return { name: path.split('/').pop(), blob: new Blob([data], { type: path.endsWith('.csv') ? 'text/csv' : 'text/markdown' }), files };
    }
    return { name: `${safeName(name)}.zip`, blob: zip.toBlob(safeName(name)), files };
}
// ---------- one page as a web page ----------
const escHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** inline Markdown → HTML (text is escaped first; only http(s) and mail links become links) */
function inlineHtml(md) {
    let t = escHtml(md.replace(/<\/?(span|mark|u)\b[^>]*>/g, ''));
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/~~([^~]+)~~/g, '<s>$1</s>');
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) => (/^(https?:|mailto:)/i.test(href) ? `<a href="${href}">${text}</a>` : text));
    return t.replace(/\n/g, '<br>');
}
async function dataUrl(ws, src) {
    if (!src)
        return '';
    if (/^(https?:|data:)/i.test(src))
        return src;
    try {
        const url = await ws.storage.assetUrl?.(src.replace(/^\.?\//, ''));
        const res = url ? await fetch(url) : null;
        if (!res?.ok)
            return '';
        const blob = await res.blob();
        if (blob.size > 8e6)
            return ''; // too big to carry inside the page
        return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ok(''); r.readAsDataURL(blob); });
    }
    catch {
        return '';
    }
}
async function blocksToHtml(ws, blocks) {
    const out = [];
    let open = null;
    const close = () => { if (open) {
        out.push(`</${open}>`);
        open = null;
    } };
    for (const b of blocks) {
        const t = inlineHtml(b.text ?? '');
        const kids = async () => (b.children?.length ? await blocksToHtml(ws, b.children) : '');
        const want = b.type === 'numbered' ? 'ol' : b.type === 'bullet' || b.type === 'todo' ? 'ul' : null;
        if (want !== open) {
            close();
            if (want) {
                out.push(`<${want}${b.type === 'todo' ? ' class="todo"' : ''}>`);
                open = want;
            }
        }
        switch (b.type) {
            case 'paragraph':
                out.push(`<p>${t || '&nbsp;'}</p>`);
                break;
            case 'heading': {
                const l = Math.min(3, Math.max(1, b.level ?? 1)) + 1;
                out.push(`<h${l}>${t}</h${l}>`);
                break;
            }
            case 'quote':
                out.push(`<blockquote>${t}</blockquote>`);
                break;
            case 'divider':
                out.push('<hr>');
                break;
            case 'code':
                out.push(`<pre><code>${escHtml(b.text ?? '')}</code></pre>`);
                break;
            case 'bullet':
            case 'numbered':
                out.push(`<li>${t}${await kids()}</li>`);
                break;
            case 'todo':
                out.push(`<li><input type="checkbox" disabled${b.checked ? ' checked' : ''}> ${t}${await kids()}</li>`);
                break;
            case 'toggle':
                out.push(`<details open><summary>${t}</summary>${await kids()}</details>`);
                break;
            case 'callout':
                out.push(`<aside>${await kids()}</aside>`);
                break;
            case 'columns':
                out.push(`<div class="cols">${await kids()}</div>`);
                break;
            case 'column':
                out.push(`<div>${await kids()}</div>`);
                break;
            case 'image': {
                const u = await dataUrl(ws, b.src);
                if (u)
                    out.push(`<figure><img src="${escHtml(u)}" alt="${escHtml(b.text ?? '')}">${t ? `<figcaption>${t}</figcaption>` : ''}</figure>`);
                break;
            }
            case 'embed':
                if (b.src && /^https?:/i.test(b.src))
                    out.push(`<p><a href="${escHtml(b.src)}">${t || escHtml(b.src)}</a></p>`);
                break;
            case 'pdf':
            case 'audio':
            case 'video':
            case 'file':
                out.push(`<p class="file">${t || escHtml(decodeURIComponent((b.src ?? '').split('/').pop() ?? 'File'))}</p>`);
                break;
            case 'pagelink': {
                const title = (b.target && (ws.pages.get(b.target)?.title ?? ws.dbs.get(b.target)?.schema.name)) || '';
                if (title)
                    out.push(`<p class="file">${escHtml(title)}</p>`);
                break;
            }
            case 'view': {
                const db = b.db ? ws.dbs.get(b.db) : undefined;
                if (db)
                    out.push(`<p class="file">${escHtml(db.schema.name)}</p>`);
                break;
            }
            case 'table': {
                const rows = b.rows ?? [];
                out.push('<table>' + rows.map((r, k) => `<tr>${r.map((c) => (k === 0 && b.header ? `<th>${inlineHtml(c ?? '')}</th>` : `<td>${inlineHtml(c ?? '')}</td>`)).join('')}</tr>`).join('') + '</table>');
                break;
            }
            default: break;
        }
    }
    close();
    return out.join('\n');
}
const HTML_STYLE = 'body{font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1c1e;max-width:760px;margin:48px auto;padding:0 24px}h1{font-size:2.1em;line-height:1.2;margin:0 0 .6em}h2{font-size:1.5em;margin:1.4em 0 .4em}h3{font-size:1.25em;margin:1.2em 0 .3em}h4{font-size:1.08em;margin:1em 0 .3em}p{margin:.4em 0}a{color:#2563eb}blockquote{margin:.6em 0;padding-left:14px;border-left:3px solid #c7c7cc;color:#48484a}aside{background:#f2f2f7;border-radius:10px;padding:12px 16px;margin:.7em 0}pre{background:#f2f2f7;border-radius:8px;padding:12px 14px;overflow:auto;font-size:14px}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em}hr{border:0;border-top:1px solid #d1d1d6;margin:1.4em 0}table{border-collapse:collapse;margin:.8em 0}td,th{border:1px solid #d1d1d6;padding:6px 10px;text-align:left;vertical-align:top}th{background:#f2f2f7}img{max-width:100%;border-radius:6px}figure{margin:.8em 0}figcaption{color:#6e6e73;font-size:.9em}ul.todo{list-style:none;padding-left:4px}.cols{display:flex;gap:28px}.cols>div{flex:1;min-width:0}.props{color:#48484a;margin:0 0 1.2em}.props td{border:0;padding:2px 16px 2px 0}.file{color:#48484a}@media(max-width:640px){.cols{display:block}}';
export async function exportHtml(ws, title, blocks, props = []) {
    const body = await blocksToHtml(ws, blocks);
    const table = props.length ? `<table class="props">${props.map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${escHtml(v)}</td></tr>`).join('')}</table>` : '';
    const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escHtml(title || 'Untitled')}</title>\n<style>${HTML_STYLE}</style>\n</head>\n<body>\n<h1>${escHtml(title || 'Untitled')}</h1>\n${table}\n${body}\n</body>\n</html>\n`;
    return { name: `${safeName(title || 'Untitled')}.html`, blob: new Blob([html], { type: 'text/html' }), files: 1 };
}
export const entryProps = (db, row) => db.schema.properties.filter((p) => p.name !== db.titleProp).map((p) => [p.name, valueText(db, row, p.name)]).filter(([, v]) => v !== '');
/** the databases a set of pages shows (their views), so the links in the export lead somewhere */
function shownDbs(ws, pages) {
    const keys = new Set();
    const walk = (bs) => { for (const b of bs) {
        if (b.type === 'view' && b.db)
            keys.add(b.db);
        if (b.children)
            walk(b.children);
    } };
    for (const id of pages) {
        const p = ws.pages.get(id);
        if (p)
            walk(p.blocks);
    }
    return [...keys].map((k) => ws.dbs.get(k)).filter(Boolean);
}
export async function exportPage(ws, page, opts = {}) {
    const plan = new Plan(ws);
    plan.addPage(page, '', !!opts.subpages);
    if (opts.databases)
        for (const db of shownDbs(ws, plan.pages.keys()))
            plan.addDb(db, '');
    return build(ws, plan, page.title || 'Page');
}
export async function exportDatabase(ws, db) {
    const plan = new Plan(ws);
    plan.addDb(db, '');
    return build(ws, plan, db.schema.name || 'Database');
}
/** one entry: its properties and its page */
export async function exportEntry(ws, db, row) {
    const plan = new Plan(ws);
    const file = `${safeName(db.rowLabel(row) || 'Untitled')}.md`;
    plan.rows.set(`${db.key}/${row.id}`, file);
    const zip = new ZipStorage('entry');
    const assets = new Map();
    const props = db.schema.properties.filter((p) => p.name !== db.titleProp).map((p) => [p.name, valueText(db, row, p.name)]).filter(([, v]) => v !== '');
    const md = pageMd({ ws, plan, file, assets }, db.rowLabel(row), row.body ? parsePage(row.body) : [], props);
    if (!assets.size)
        return { name: file, blob: new Blob([md], { type: 'text/markdown' }), files: 1 };
    await zip.write(file, md);
    for (const [src, out] of assets) {
        try {
            const url = await ws.storage.assetUrl?.(src);
            const res = url ? await fetch(url) : null;
            if (res?.ok)
                await zip.writeBinary(out, new Uint8Array(await res.arrayBuffer()));
        }
        catch { /* left out */ }
    }
    return { name: `${file.slice(0, -3)}.zip`, blob: zip.toBlob(file.slice(0, -3)), files: zip.files.size };
}
export async function exportWorkspace(ws) {
    const plan = new Plan(ws);
    const roots = [...ws.pages.values()].filter((p) => !p.parent || !ws.pages.has(p.parent)).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.title.localeCompare(b.title));
    for (const p of roots)
        plan.addPage(p, '', true);
    for (const db of [...ws.dbs.values()].sort((a, b) => a.schema.name.localeCompare(b.schema.name)))
        plan.addDb(db, '');
    return build(ws, plan, ws.meta.name || 'Nook');
}
/** every file of the workspace folder exactly as it is (a backup that Nook opens again) */
export async function exportRaw(ws, onProgress) {
    const zip = new ZipStorage('raw');
    let done = 0;
    const walk = async (dir) => {
        for (const e of await ws.storage.list(dir)) {
            const path = dir ? `${dir}/${e.name}` : e.name;
            if (e.kind === 'dir') {
                if (e.name !== 'node_modules')
                    await walk(path);
                continue;
            }
            // passwords never leave the device (they are not in the folder anyway); cache files are left out
            if (/(^|\/)\.DS_Store$|(^|\/)Thumbs\.db$/.test(path))
                continue;
            try {
                if (/\.(md|json|txt|csv|ics|css|html?|svg|ya?ml)$/i.test(e.name))
                    await zip.write(path, await ws.storage.read(path));
                else {
                    const url = await ws.storage.assetUrl?.(path);
                    const res = url ? await fetch(url) : null;
                    if (res?.ok)
                        await zip.writeBinary(path, new Uint8Array(await res.arrayBuffer()));
                }
            }
            catch { /* a file that cannot be read is left out */ }
            onProgress?.(++done);
        }
    };
    await walk('');
    const name = safeName(ws.meta.name || 'Nook');
    return { name: `${name} (Nook backup).zip`, blob: zip.toBlob(name), files: zip.files.size };
}
/** hand a file to the browser's download (on a phone: the share sheet, where "Save to Files" is) */
export async function saveFile(x) {
    const file = new File([x.blob], x.name, { type: x.blob.type || 'application/octet-stream' });
    const nav = navigator;
    if (document.documentElement.classList.contains('touch') && nav.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return;
        }
        catch (e) {
            if (e.name === 'AbortError')
                return; /* else: download */
        }
    }
    const url = URL.createObjectURL(x.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = x.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
//# sourceMappingURL=export.js.map