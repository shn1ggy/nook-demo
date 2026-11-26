import { ulid } from '../util.js';
import { plainText } from './inline.js';
const CONTAINERS = new Set(['columns', 'column', 'callout', 'capture', 'toggle', 'tabs', 'tab']);
const LEAF_TAGS = new Set(['view', 'image', 'pdf', 'embed', 'pagelink', 'divider', 'audio', 'video', 'file', 'toc', 'widget']);
function attrs(src) {
    const out = {};
    const re = /([a-zA-Z_-]+)(?:="([^"]*)")?/g;
    let m;
    while ((m = re.exec(src)))
        out[m[1]] = m[2] === undefined ? 'true' : unesc(m[2]);
    return out;
}
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** buttons read so far on this page: a button without an id gets one made from the page's content, so every
 *  device gives it the same id (random ones made two devices write different files → Dropbox conflicts) */
let buttonSeq = 0;
const stableId = (seed) => { let x = 2166136261; for (let i = 0; i < seed.length; i++) {
    x ^= seed.charCodeAt(i);
    x = Math.imul(x, 16777619);
} return 'b' + (x >>> 0).toString(36).padStart(7, '0'); };
function blockFromAttrs(type, a) {
    // buttons keep their id in the file (shortcuts point at them)
    const b = { id: type === 'button' ? (a.id && /^[\w-]{6,}$/.test(a.id) ? a.id : stableId(`${buttonSeq++}|${JSON.stringify(a)}`)) : ulid(), type };
    if (a.color)
        b.color = a.color;
    if (a.tcolor)
        b.tcolor = a.tcolor;
    if (type === 'capture') {
        try {
            b.data = a.data ? JSON.parse(a.data) : {};
        }
        catch {
            b.data = {};
        }
    }
    if (type === 'audio' && a.kind) {
        b.kind = a.kind;
        try {
            b.data = a.data ? JSON.parse(a.data) : {};
        }
        catch {
            b.data = {};
        }
    }
    if (type === 'widget') {
        b.kind = a.kind || 'note';
        try {
            b.data = a.data ? JSON.parse(a.data) : {};
        }
        catch {
            b.data = {};
        }
    }
    if (a.align === 'center' || a.align === 'right')
        b.align = a.align;
    if (a.icon)
        b.icon = a.icon;
    if (a.width)
        b.width = Number(a.width);
    if (a.fixed && +a.fixed > 0)
        b.fixed = Math.round(Number(a.fixed));
    if (a.phonefirst)
        b.phonefirst = 1;
    if (a.level)
        b.level = Number(a.level);
    if (a.open)
        b.open = a.open !== 'false';
    if (a.active && +a.active >= 0)
        b.active = Math.round(+a.active);
    if (a.title !== undefined)
        b.text = a.title;
    if (a.steps) {
        try {
            b.steps = JSON.parse(a.steps);
        }
        catch { /* keep the button usable */ }
    }
    if (a.confirm)
        b.confirm = a.confirm !== 'false';
    if (a.size === 'large' || a.size === 'normal')
        b.size = a.size;
    if (a.colorstyle === 'outline')
        b.colorStyle = 'outline';
    if (a.collapsible)
        b.collapsible = a.collapsible !== 'false';
    if (a.collapsed)
        b.collapsed = a.collapsed !== 'false';
    if (a.layout === 'side')
        b.layout = 'side';
    if (a.perrow && +a.perrow >= 1 && +a.perrow <= 4)
        b.perRow = +a.perrow;
    if (a.db)
        b.db = a.db;
    if (a.view)
        b.view = a.view;
    if (a.tabs)
        b.tabs = a.tabs;
    if (a.tabstyle === 'icon' || a.tabstyle === 'name' || a.tabstyle === 'both')
        b.tabstyle = a.tabstyle;
    if (a.src)
        b.src = a.src;
    if (a.action)
        b.action = a.action;
    if (a.target)
        b.target = a.target;
    if (a.checked)
        b.checked = a.checked === 'true';
    if (a.display === 'frame')
        b.display = 'frame';
    return b;
}
export function parsePage(body) {
    buttonSeq = 0;
    const root = { id: 'root', type: 'column', children: [] };
    const stack = [root];
    const lines = body.replace(/\r\n/g, '\n').split('\n');
    let para = [];
    // last list item per depth within the current container
    let listStack = [];
    /** column widths of the next table (from a <!-- table colw="…" --> line) */
    let tableColw;
    const container = () => stack[stack.length - 1];
    const flushPara = () => {
        if (para.length) {
            container().children.push({ id: ulid(), type: 'paragraph', text: para.join('\n') });
            para = [];
        }
    };
    const push = (b) => { flushPara(); listStack = []; container().children.push(b); };
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trimEnd();
        const t = line.trim();
        if (t === '') {
            flushPara();
            continue;
        }
        // code fence
        if (t.startsWith('```')) {
            flushPara();
            const code = [];
            const lang = t.slice(3).trim();
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('```'))
                code.push(lines[i++]);
            push({ id: ulid(), type: 'code', text: code.join('\n'), lang: lang || undefined });
            continue;
        }
        let m;
        // closing container tag
        if ((m = t.match(/^<\/([a-z]+)>$/)) && CONTAINERS.has(m[1])) {
            flushPara();
            listStack = [];
            if (stack.length > 1)
                stack.pop();
            continue;
        }
        // opening container tag
        if ((m = t.match(/^<([a-z]+)((?:\s+[^>]*)?)>$/)) && CONTAINERS.has(m[1])) {
            const b = blockFromAttrs(m[1], attrs(m[2] ?? ''));
            b.children = [];
            push(b);
            stack.push(b);
            continue;
        }
        // self-closing leaf tag
        if ((m = t.match(/^<([a-z]+)((?:\s+[^>]*)?)\/>$/)) && LEAF_TAGS.has(m[1])) {
            push(blockFromAttrs(m[1], attrs(m[2] ?? '')));
            continue;
        }
        // single-line tag with text: <button ...>x</button>, <p color="red">x</p>, <h2 ...>x</h2>
        if ((m = t.match(/^<(button|p|h[1-3]|todo|quote)((?:\s+[^>]*)?)>(.*)<\/\1>$/))) {
            const tag = m[1];
            const a = attrs(m[2] ?? '');
            const type = tag === 'button' ? 'button' : tag === 'p' ? 'paragraph' : tag === 'todo' ? 'todo' : tag === 'quote' ? 'quote' : 'heading';
            const b = blockFromAttrs(type, a);
            b.text = unesc(m[3]);
            if (type === 'heading')
                b.level = Number(tag[1]);
            push(b);
            continue;
        }
        if ((m = t.match(/^<!-- table colw="([\d.,]+)" -->$/))) {
            tableColw = m[1].split(',').map(Number).filter((n) => n > 0);
            continue;
        }
        // tables (Markdown): consecutive "| a | b |" lines; a "| --- |" line after the first row marks a header
        if (/^\|.*\|$/.test(t)) {
            const rowsRaw = [];
            while (i < lines.length && /^\|.*\|$/.test(lines[i].trim()))
                rowsRaw.push(lines[i++].trim());
            i--;
            const cells = (r) => r.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|').replace(/<br\s*\/?>/g, '\n'));
            const isSep = (r) => /^\|(\s*:?-{3,}:?\s*\|)+$/.test(r);
            const header = rowsRaw.length > 1 && isSep(rowsRaw[1]);
            const rows = rowsRaw.filter((r) => !isSep(r)).map(cells);
            const width = Math.max(...rows.map((r) => r.length));
            push({ id: ulid(), type: 'table', header, rows: rows.map((r) => [...r, ...Array(width - r.length).fill('')]), ...(tableColw?.length === width ? { colw: tableColw } : {}) });
            tableColw = undefined;
            continue;
        }
        // headings (#### and deeper become level 3)
        if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
            push({ id: ulid(), type: 'heading', level: Math.min(3, m[1].length), text: m[2] });
            continue;
        }
        if (t === '---' || t === '***') {
            push({ id: ulid(), type: 'divider' });
            continue;
        }
        if ((m = t.match(/^>\s?(.*)$/))) {
            push({ id: ulid(), type: 'quote', text: m[1] });
            continue;
        }
        if ((m = t.match(/^!\[([^\]]*)\]\(([^)]+)\)$/))) {
            push({ id: ulid(), type: 'image', src: m[2], text: m[1] });
            continue;
        }
        // list items (with nesting by indentation)
        const indent = raw.length - raw.trimStart().length;
        let item = null;
        if ((m = t.match(/^[-*]\s+\[( |x|X)\]\s?(.*)$/)))
            item = { id: ulid(), type: 'todo', checked: m[1] !== ' ', text: m[2] };
        else if ((m = t.match(/^[-*]\s+(.*)$/)))
            item = { id: ulid(), type: 'bullet', text: m[1] };
        else if ((m = t.match(/^\d+[.)]\s+(.*)$/)))
            item = { id: ulid(), type: 'numbered', text: m[1] };
        if (item) {
            flushPara();
            const depth = Math.floor(indent / 2);
            const parent = depth > 0 ? listStack[Math.min(depth, listStack.length) - 1] : undefined;
            if (parent)
                (parent.children ??= []).push(item);
            else
                container().children.push(item);
            listStack = listStack.slice(0, depth);
            listStack[depth] = item;
            continue;
        }
        listStack = [];
        para.push(t);
    }
    flushPara();
    return root.children;
}
// ---------- serialise ----------
function attrStr(b, keys) {
    let s = '';
    for (const k of keys) {
        const v = b[k];
        if (v === undefined || v === null || v === '')
            continue;
        if (v === true)
            s += ` ${k}`;
        else if (v === false)
            continue;
        else
            s += ` ${k}="${esc(String(v))}"`;
    }
    return s;
}
export function serializePage(blocks) {
    const out = [];
    write(blocks, out, '');
    return out.join('\n').replace(/\n{3,}/g, '\n\n')
        .replace(/(<(?:columns|column|callout|toggle|tabs|tab)\b[^>]*>)\n\n/g, '$1\n')
        .replace(/\n\n(<\/(?:columns|column|callout|toggle|tabs|tab)>)/g, '\n$1')
        .trim() + '\n';
}
function write(blocks, out, indent) {
    let prevList = false;
    for (const b of blocks) {
        const isList = b.type === 'bullet' || b.type === 'numbered' || b.type === 'todo';
        if (!(isList && prevList))
            out.push('');
        prevList = isList;
        const text = (b.text ?? '');
        switch (b.type) {
            case 'paragraph':
                out.push(b.color || b.align ? `<p${attrStr(b, ['color', 'align'])}>${esc(text)}</p>` : text.trim() === '' ? '<p></p>' : text);
                break;
            case 'heading': {
                const lvl = Math.min(3, Math.max(1, b.level ?? 1));
                out.push(b.color || b.align ? `<h${lvl}${attrStr(b, ['color', 'align'])}>${esc(text)}</h${lvl}>` : `${'#'.repeat(lvl)} ${text}`);
                break;
            }
            case 'quote':
                out.push(b.color || b.align ? `<quote${attrStr(b, ['color', 'align'])}>${esc(text)}</quote>` : `> ${text}`);
                break;
            case 'divider':
                out.push('---');
                break;
            case 'toc':
                out.push('<toc/>');
                break;
            // a widget: its kind and its own small state (JSON)
            case 'widget':
                out.push(`<widget kind="${esc(b.kind ?? 'note')}"${b.data && Object.keys(b.data).length ? ` data="${esc(JSON.stringify(b.data))}"` : ''}/>`);
                break;
            case 'code':
                out.push('```' + (b.lang ?? ''), text, '```');
                break;
            case 'bullet':
            case 'numbered':
            case 'todo': {
                const marker = b.type === 'bullet' ? '- ' : b.type === 'numbered' ? '1. ' : `- [${b.checked ? 'x' : ' '}] `;
                out.push(indent + marker + text.replace(/\n/g, ' '));
                if (b.children?.length) {
                    const sub = [];
                    write(b.children, sub, indent + '  ');
                    out.push(...sub.filter((l) => l !== ''));
                }
                break;
            }
            case 'image':
                out.push(`![${text}](${b.src ?? ''})`);
                break;
            case 'view':
            case 'pdf':
            case 'embed':
            case 'pagelink':
                out.push(`<${b.type}${attrStr(b, ['db', 'view', 'tabs', 'tabstyle', 'src', 'target', 'color', 'display', 'size'])}${b.perRow ? ` perrow="${b.perRow}"` : ''}${b.colorStyle ? ` colorstyle="${b.colorStyle}"` : ''}${b.type === 'embed' && b.text ? ` title="${esc(b.text)}"` : ''}/>`);
                break;
            case 'table': {
                const rows = b.rows?.length ? b.rows : [['']];
                if (b.colw?.length)
                    out.push(`${indent}<!-- table colw="${b.colw.map((n) => +n.toFixed(1)).join(',')}" -->`);
                const cell = (c) => ` ${(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>')} `;
                rows.forEach((r, k) => {
                    out.push(indent + '|' + r.map(cell).join('|') + '|');
                    if (k === 0 && b.header)
                        out.push(indent + '|' + r.map(() => ' --- ').join('|') + '|');
                });
                break;
            }
            case 'audio':
            case 'video':
            case 'file':
                // a voice memo: its kind and its own data (length, the text written down)
                out.push(`<${b.type}${attrStr(b, ['src'])}${text ? ` title="${esc(text)}"` : ''}${b.type === 'audio' && b.kind ? ` kind="${esc(b.kind)}"${b.data && Object.keys(b.data).length ? ` data="${esc(JSON.stringify(b.data))}"` : ''}` : ''}/>`);
                break;
            case 'button':
                out.push(`<button id="${b.id}"${attrStr(b, ['action', 'target', 'icon', 'color', 'size', 'confirm'])}${b.perRow ? ` perrow="${b.perRow}"` : ''}${b.colorStyle ? ` colorstyle="${b.colorStyle}"` : ''}${b.steps?.length ? ` steps="${esc(JSON.stringify(b.steps))}"` : ''}>${esc(text)}</button>`);
                break;
            case 'columns':
            case 'column':
            case 'callout':
            case 'capture':
            case 'toggle':
            case 'tabs':
            case 'tab': {
                const keys = b.type === 'column' ? ['width', 'fixed', 'phonefirst'] : b.type === 'callout' ? ['icon', 'color', 'tcolor', 'layout', 'collapsible', 'collapsed'] : b.type === 'toggle' ? ['level', 'open', 'color', 'align'] : b.type === 'tabs' ? ['active'] : b.type === 'tab' ? ['icon'] : [];
                let a = attrStr(b, keys);
                if (b.type === 'toggle' || b.type === 'tab')
                    a += ` title="${esc(text)}"`;
                if (b.type === 'capture')
                    a += ` data="${esc(JSON.stringify(b.data ?? {}))}"`;
                out.push(`<${b.type}${a}>`);
                write(b.children ?? [], out, '');
                out.push('', `</${b.type}>`);
                break;
            }
        }
    }
}
/**
 * A page body as readable plain text (e.g. the notes of a calendar event or task): no markup or
 * tags – links and files become their address, lists keep their marks, database views and buttons
 * are left out.
 */
export function pageToText(body) {
    if (!body.trim())
        return '';
    const out = [];
    const walk = (blocks, indent) => {
        let n = 0;
        for (const b of blocks) {
            const t = plainText(b.text ?? '').trim();
            n = b.type === 'numbered' ? n + 1 : 0;
            switch (b.type) {
                case 'bullet':
                    out.push(`${indent}• ${t}`);
                    break;
                case 'numbered':
                    out.push(`${indent}${n}. ${t}`);
                    break;
                case 'todo':
                    out.push(`${indent}${b.checked ? '☑' : '☐'} ${t}`);
                    break;
                case 'divider':
                    out.push(`${indent}———`);
                    break;
                case 'embed':
                case 'image':
                case 'pdf':
                case 'audio':
                case 'video':
                case 'file': {
                    const src = b.src ?? '';
                    const where = /^https?:/i.test(src) ? src : src.split('/').pop() ?? '';
                    out.push(indent + (t && t !== where ? `${t}: ${where}` : where));
                    break;
                }
                case 'table':
                    for (const r of b.rows ?? [])
                        out.push(indent + r.map((c) => plainText(c).trim()).join(' | '));
                    break;
                case 'view':
                case 'button':
                case 'pagelink':
                case 'column':
                case 'columns':
                case 'tabs':
                case 'widget': break;
                default: if (t || b.type === 'paragraph')
                    out.push(indent + t);
            }
            if (b.children?.length)
                walk(b.children, b.type === 'columns' || b.type === 'column' || b.type === 'callout' || b.type === 'capture' ? indent : indent + '  ');
        }
    };
    walk(parsePage(body), '');
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** the files a page shows (images, videos, PDFs, files), in order – from its blocks, so paths with spaces work too */
export function mediaInBody(body) {
    const out = [];
    const walk = (bs) => { for (const b of bs) {
        if (b.src && ['image', 'video', 'pdf', 'audio', 'file'].includes(b.type))
            out.push({ type: b.type, src: b.src });
        if (b.children)
            walk(b.children);
    } };
    try {
        walk(parsePage(body));
    }
    catch { /* unreadable text */ }
    return out;
}
//# sourceMappingURL=page.js.map