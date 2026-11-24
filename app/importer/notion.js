import { Workspace, Database, defaultView, formatRow } from '../workspace.js';
import { formatDoc } from '../format/frontmatter.js';
import { parsePage, serializePage } from '../format/page.js';
import { defaultLocale, parseNumber, pad2, slug, ulid, nextTagColor } from '../util.js';
import { APP } from '../config.js';
import { embedUrl } from '../format/embed.js';
const dec = new TextDecoder();
const text = (b) => dec.decode(b).replace(/^﻿/, '');
const NOTION_ID = /\s[0-9a-f]{32}$/;
const stripId = (s) => s.replace(NOTION_ID, '').trim();
const base = (p) => p.split('/').pop();
const dir = (p) => p.split('/').slice(0, -1).join('/');
const noExt = (s) => s.replace(/\.[^.]+$/, '');
// ---------- zip ----------
export async function readZip(buf, onProgress) {
    const v = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--)
        if (v.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    if (eocd < 0)
        throw new Error('Not a valid zip file');
    let count = v.getUint16(eocd + 10, true);
    let cd = v.getUint32(eocd + 16, true);
    // zip64
    if (cd === 0xffffffff || count === 0xffff) {
        const loc = eocd - 20;
        if (v.getUint32(loc, true) === 0x07064b50) {
            const z64 = Number(v.getBigUint64(loc + 8, true));
            count = Number(v.getBigUint64(z64 + 32, true));
            cd = Number(v.getBigUint64(z64 + 48, true));
        }
    }
    const out = new Map();
    const nested = [];
    const jobs = [];
    for (let n = 0; n < count; n++) {
        if (v.getUint32(cd, true) !== 0x02014b50)
            break;
        const method = v.getUint16(cd + 10, true);
        let csize = v.getUint32(cd + 20, true);
        const nameLen = v.getUint16(cd + 28, true), extraLen = v.getUint16(cd + 30, true), commentLen = v.getUint16(cd + 32, true);
        let local = v.getUint32(cd + 42, true);
        const name = dec.decode(u8.subarray(cd + 46, cd + 46 + nameLen));
        // zip64 extra field
        if (csize === 0xffffffff || local === 0xffffffff) {
            let e = cd + 46 + nameLen;
            const end = e + extraLen;
            while (e < end) {
                const id = v.getUint16(e, true), size = v.getUint16(e + 2, true);
                if (id === 1) {
                    let q = e + 4;
                    if (v.getUint32(cd + 24, true) === 0xffffffff)
                        q += 8;
                    if (csize === 0xffffffff) {
                        csize = Number(v.getBigUint64(q, true));
                        q += 8;
                    }
                    if (local === 0xffffffff)
                        local = Number(v.getBigUint64(q, true));
                }
                e += 4 + size;
            }
        }
        cd += 46 + nameLen + extraLen + commentLen;
        if (name.endsWith('/'))
            continue;
        const lNameLen = v.getUint16(local + 26, true), lExtra = v.getUint16(local + 28, true);
        const start = local + 30 + lNameLen + lExtra;
        const data = u8.subarray(start, start + csize);
        jobs.push({ name, method, data });
    }
    // inflate in small batches: steady memory use and a progress bar for big exports
    let done = 0;
    for (let i = 0; i < jobs.length; i += 64) {
        await Promise.all(jobs.slice(i, i + 64).map(async ({ name, method, data }) => {
            const bytes = method === 0 ? data.slice() : await inflate(data);
            // Notion sometimes wraps the export in a second zip
            if (name.toLowerCase().endsWith('.zip')) {
                const inner = await readZip(bytes.buffer);
                inner.forEach((b, k) => out.set(k, b));
            }
            else
                out.set(name, bytes);
            done++;
        }));
        onProgress?.(done, jobs.length);
    }
    void nested;
    return out;
}
async function inflate(data) {
    const ds = new globalThis.DecompressionStream('deflate-raw');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
// ---------- csv ----------
export function parseCsv(src, sep = ',') {
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (q) {
            if (c === '"') {
                if (src[i + 1] === '"') {
                    field += '"';
                    i++;
                }
                else
                    q = false;
            }
            else
                field += c;
        }
        else if (c === '"')
            q = true;
        else if (c === sep) {
            row.push(field);
            field = '';
        }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && src[i + 1] === '\n')
                i++;
            row.push(field);
            field = '';
            if (row.length > 1 || row[0] !== '')
                rows.push(row);
            row = [];
        }
        else
            field += c;
    }
    if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}
// ---------- values ----------
const MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    januar: 1, februar: 2, märz: 3, mai: 5, juni: 6, juli: 7, oktober: 10, dezember: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12,
};
function parseOneDate(s) {
    s = s.trim();
    if (!s)
        return null;
    // "Dienstag, 07.04.2026", "Sun, 15.11.2026": the weekday goes
    s = s.replace(/^[A-Za-zäöüÄÖÜ]{2,}\.?,\s*(?=\d|[A-Za-zäöüÄÖÜ]+\s+\d)/, '');
    // two-digit years (07.04.26) and dd-mm-yyyy
    s = s.replace(/^(\d{1,2})\.(\d{1,2})\.(\d{2})(?!\d)/, (_, d, mo, y) => `${d}.${mo}.${+y < 70 ? 2000 + +y : 1900 + +y}`);
    s = s.replace(/^(\d{1,2})-(\d{1,2})-(\d{4})/, '$1.$2.$3');
    let m;
    let date = null, rest = '';
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(.*)$/))) {
        date = `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
        rest = m[4];
    }
    else if ((m = s.match(/^([A-Za-zäöüÄÖÜ.]+)\s+(\d{1,2}),?\s+(\d{4})(.*)$/))) {
        const mo = MONTHS[m[1].toLowerCase().replace('.', '')];
        if (mo) {
            date = `${m[3]}-${pad2(mo)}-${pad2(+m[2])}`;
            rest = m[4];
        }
    }
    else if ((m = s.match(/^(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\.?\s+(\d{4})(.*)$/))) {
        const mo = MONTHS[m[2].toLowerCase()];
        if (mo) {
            date = `${m[3]}-${pad2(mo)}-${pad2(+m[1])}`;
            rest = m[4];
        }
    }
    else if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(.*)$/))) {
        date = `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
        rest = m[4];
    }
    else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/))) {
        const dayFirst = +m[1] > 12;
        date = `${m[3]}-${pad2(+(dayFirst ? m[2] : m[1]))}-${pad2(+(dayFirst ? m[1] : m[2]))}`;
        rest = m[4];
    }
    else if ((m = s.match(/^(\d{1,2})\s+([A-Za-zäöüÄÖÜ]+)\.?,?\s+(\d{4})(.*)$/))) {
        const mo = MONTHS[m[2].toLowerCase()];
        if (mo) {
            date = `${m[3]}-${pad2(mo)}-${pad2(+m[1])}`;
            rest = m[4];
        }
    }
    if (!date)
        return null;
    const [yy, mm, dd] = date.split('-').map(Number);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || new Date(yy, mm - 1, dd).getDate() !== dd)
        return null;
    const t = rest.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (t) {
        let hh = +t[1];
        if (t[3]) {
            if (t[3].toUpperCase() === 'PM' && hh < 12)
                hh += 12;
            if (t[3].toUpperCase() === 'AM' && hh === 12)
                hh = 0;
        }
        return `${date}T${pad2(hh)}:${t[2]}`;
    }
    return date;
}
export function parseNotionDate(s) {
    const parts = s.split(/\s*→\s*/);
    const start = parseOneDate(parts[0]);
    if (!start)
        return null;
    const end = parts[1] ? parseOneDate(parts[1]) : null;
    return end && end !== start ? { start, end: end.slice(0, 10) } : { start };
}
export function convertValue(def, raw) {
    const s = raw.trim();
    if (!s)
        return null;
    switch (def.type) {
        case 'number': return parseNumber(s);
        case 'checkbox': return /^(yes|true|ja|✓|__yes__)$/i.test(s);
        case 'date':
        case 'created_time':
        case 'last_edited_time': return parseNotionDate(s);
        case 'multi_select': return s.split(/,\s+/).filter(Boolean);
        case 'phone':
        case 'email': return s.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim() || null;
        default: return s;
    }
}
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[a-z]{2,}$/i;
/** invisible direction marks etc. that sneak in when numbers are pasted */
const clean = (v) => v.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim();
const PHONE = /^\+?[\d][\d\s()/.-]{5,}\d$/;
/** Guess one column's type from its values (the export doesn't carry property types). */
export function inferProp(col, i, rows) {
    const vals = rows.map((r) => clean(r[i] ?? '')).filter(Boolean);
    let type = i === 0 ? 'title' : 'text';
    const all = (re) => vals.every((v) => (typeof re === 'function' ? re(v) : re.test(v)));
    // a column named "Phone" / "Mail" may hold the odd placeholder ("???", "-")
    const most = (re) => vals.filter((v) => re.test(v)).length >= Math.max(1, vals.length * 0.6);
    if (i > 0 && vals.length) {
        if (all(/^(Yes|No)$/))
            type = 'checkbox';
        else if (all(EMAIL) || (/mail/i.test(col) && most(EMAIL)))
            type = 'email';
        // phone numbers before numbers: "0172 4848224", "+49 …" (or the column is called so)
        else if ((all(PHONE) && (/handy|phone|tel|mobil|fon/i.test(col) || vals.some((v) => /^(\+|0\d)/.test(v) && v.replace(/\D/g, '').length >= 8))) || (/handy|phone|telefon|mobil/i.test(col) && most(PHONE)))
            type = 'phone';
        else if (all((v) => parseNumber(v) !== null && /\d/.test(v) && !/[a-z]{3}/i.test(v)))
            type = 'number';
        else if (all((v) => !!parseNotionDate(v)))
            type = 'date';
        else if (all(/^https?:\/\/\S+$/))
            type = 'url';
        else {
            // Notion writes several choices of a multi-select as "A, B"
            const tokens = vals.flatMap((v) => v.split(/,\s+/));
            const distinctTokens = new Set(tokens);
            const withComma = vals.filter((v) => /,\s/.test(v)).length;
            const distinct = new Set(vals);
            const shortish = (xs) => [...xs].every((v) => v.length < 40 && !v.includes('\n'));
            if (withComma && withComma >= vals.length * 0.08 && shortish(distinctTokens) && distinctTokens.size <= Math.max(14, tokens.length / 2) && [...distinctTokens].some((t) => tokens.filter((x) => x === t).length > 1))
                type = 'multi_select';
            else if (distinct.size <= Math.max(12, vals.length / 5) && shortish(distinct))
                type = 'select';
        }
    }
    const def = { name: col, type };
    if (type === 'number') {
        if (vals.some((v) => v.includes('€')))
            def.format = 'euro';
        else if (vals.some((v) => v.includes('$')))
            def.format = 'dollar';
        else if (vals.some((v) => v.includes('£')))
            def.format = 'pound';
        else if (vals.some((v) => v.includes('%')))
            def.format = 'percent';
    }
    if (type === 'select')
        def.options = [...new Set(vals)].map((n, k) => ({ name: n, color: nextTagColor(k) }));
    if (type === 'multi_select')
        def.options = [...new Set(vals.flatMap((v) => v.split(/,\s+/)))].map((n, k) => ({ name: n, color: nextTagColor(k) }));
    return def;
}
function inferSchema(name, header, rows) {
    return { name, properties: header.map((h, i) => inferProp(h, i, rows)) };
}
/**
 * Views for a database the hints don't know: a board for to-do boards, a calendar for
 * calendars, a gallery for collections of pictures; always a table as well.
 */
function inferViews(name, schema, imageShare) {
    const table = defaultView(schema);
    const sel = schema.properties.find((p) => p.type === 'select' && /status|stand|phase|group/i.test(p.name)) ?? schema.properties.find((p) => p.type === 'select');
    const date = schema.properties.find((p) => p.type === 'date');
    const id = () => ulid().slice(-8).toLowerCase();
    const all = schema.properties.map((p) => p.name);
    if (/board|kanban|to ?do/i.test(name) && sel)
        return [{ id: id(), name: 'Board', type: 'board', props: all, groupBy: { prop: sel.name, hideEmpty: false } }, { ...table, id: id() }];
    if (/kalender|calendar|termine|zeitplan|drehtage|drehplan/i.test(name) && date)
        return [{ id: id(), name: 'Calendar', type: 'calendar', props: all, dateProp: date.name, colorBy: sel?.name }, { ...table, id: id() }];
    if (imageShare >= 0.5)
        return [{ id: id(), name: 'Gallery', type: 'gallery', props: all, cardSize: 'm', cover: 'content' }, { ...table, id: id() }];
    return [table];
}
// ---------- markdown pages ----------
/** Notion's own icons (callouts) → Nook icon names */
const NOTION_ICON = {
    'playback-fast-forward': 'chevrons-right', link: 'link', stopwatch: 'clock', calculator: 'calculator', clock: 'clock', alarm: 'alarm',
    calendar: 'calendar', 'calendar-day': 'calendar-days', checkmark: 'check-circle', 'checkmark-square': 'check-square', bookmark: 'bookmark',
    'light-bulb': 'lightbulb', lightbulb: 'lightbulb', star: 'star', heart: 'heart', home: 'home', document: 'file-text', page: 'file',
    folder: 'folder', camera: 'camera', 'video-camera': 'video', movie: 'film', music: 'music', 'warning': 'alert', info: 'info',
    question: 'help', pin: 'pin', flag: 'flag', 'shopping-cart': 'shopping-cart', money: 'wallet', wallet: 'wallet', briefcase: 'briefcase',
    graduate: 'graduation-cap', book: 'book', 'book-open': 'book-open', person: 'user', people: 'users', globe: 'globe', mail: 'mail',
};
const NOTION_COLOR = { gray: 'gray', lightgray: 'gray', brown: 'brown', orange: 'orange', yellow: 'yellow', green: 'green', blue: 'blue', purple: 'purple', pink: 'pink', red: 'red' };
function notionIcon(src) {
    const m = src.match(/icons\/([a-z0-9-]+?)(?:_([a-z]+))?\.svg/);
    if (!m)
        return null;
    const name = NOTION_ICON[m[1]] ?? m[1];
    const color = m[2] && m[2] !== 'gray' ? NOTION_COLOR[m[2]] : undefined;
    return `i:${name}${color ? ':' + color : ''}`;
}
/** Notion's export Markdown → Nook page body. */
/** Notion writes line breaks inside table cells as real line breaks; put such rows back on one
 *  line (the breaks become <br>) so the table stays a table. */
function joinTableRows(lines) {
    const pipes = (x) => (x.match(/(?<!\\)\|/g) ?? []).length;
    const isSep = (x) => /^\|(\s*:?-{3,}:?\s*\|)+$/.test(x.trim());
    const out = [];
    let cols = 0;
    for (let i = 0; i < lines.length; i++) {
        let l = lines[i];
        if (!cols && /^\s*\|.*\|\s*$/.test(l) && isSep(lines[i + 1] ?? '')) {
            cols = pipes(l);
            out.push(l);
            continue;
        }
        if (cols) {
            if (!l.trim().startsWith('|')) {
                cols = 0;
                out.push(l);
                continue;
            }
            while (pipes(l) < cols && i + 1 < lines.length && !isSep(lines[i + 1]))
                l += '<br>' + lines[++i];
            const t = l.trim();
            const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split(/(?<!\\)\|/).map((c) => c.trim().replace(/^(<br>\s*)+|(\s*<br>)+$/g, '').trim());
            out.push('| ' + cells.join(' | ') + ' |');
            continue;
        }
        out.push(l);
    }
    return out;
}
function convertNotionMd(md, ctx) {
    const lines = joinTableRows(md.replace(/\r\n/g, '\n').split('\n'));
    if (/^#\s/.test(lines[0] ?? ''))
        lines.shift();
    const out = [];
    let lastHeading = '';
    for (let i = 0; i < lines.length; i++) {
        let l = lines[i];
        const t = l.trim();
        let m;
        if ((m = t.match(/^#{1,3}\s+(.*)$/)))
            lastHeading = m[1];
        if (t === '<aside>') {
            // the callout's icon: an emoji or one of Notion's icons at the start of the first line
            let icon = '💡';
            const next = lines[i + 1]?.trim() ?? '';
            const img = next.match(/^<img\s[^>]*src="([^"]+)"[^>]*\/?>\s*(.*)$/);
            const em = next.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
            if (img) {
                icon = notionIcon(img[1]) ?? icon;
                lines[i + 1] = img[2];
            }
            else if (em) {
                icon = em[1];
                lines[i + 1] = em[2];
            }
            out.push(`<callout icon="${icon}" color="gray_bg">`);
            continue;
        }
        if (t === '</aside>') {
            out.push('', '</callout>');
            continue;
        }
        if ((m = t.match(/^<details>\s*<summary>(.*?)<\/summary>$/))) {
            out.push(`<toggle open title="${m[1].replace(/"/g, '&quot;')}">`);
            continue;
        }
        if (t === '<details>') {
            const s2 = (lines[i + 1] ?? '').match(/<summary>(.*?)<\/summary>/);
            if (s2) {
                i++;
                out.push(`<toggle open title="${s2[1].replace(/"/g, '&quot;')}">`);
                continue;
            }
        }
        if (t === '</details>') {
            out.push('', '</toggle>');
            continue;
        }
        // an embedded database: a link to its CSV, or to the database's own page (.md next to the CSV)
        if ((m = t.match(/^\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+\.(csv|md))\)$/))) {
            const link = decodeURIComponent(m[2]);
            const key = m[3] === 'csv' ? ctx.csvKey(link) : ctx.pageLink(link) ? null : ctx.csvKey(link.replace(/\.md$/, '_all.csv')) ?? ctx.csvKey(link.replace(/\.md$/, '.csv'));
            if (key) {
                // the export writes the view's settings as text below the link: "filters:", "sort:" …
                let j = i + 1;
                while (j < lines.length && lines[j].trim() === '')
                    j++;
                const sorts = [];
                if (/^(filters|sort|sorts|group by|groups?):/i.test(lines[j]?.trim() ?? '')) {
                    let section = '';
                    for (; j < lines.length && lines[j].trim() !== ''; j++) {
                        const x = lines[j].trim();
                        const sec = x.match(/^(filters|sort|sorts|group by|groups?):\s*$/i);
                        if (sec) {
                            section = sec[1].toLowerCase();
                            continue;
                        }
                        const so = x.match(/^(.+):\s*(ascending|descending)$/i);
                        if (section.startsWith('sort') && so)
                            sorts.push({ prop: so[1].trim(), dir: so[2].toLowerCase() === 'descending' ? 'desc' : 'asc' });
                    }
                    i = j - 1;
                }
                const view = sorts.length && ctx.viewFor ? ctx.viewFor(key, sorts, lastHeading) : undefined;
                out.push(view ? `<view db="${key}" view="${view}"/>` : `<view db="${key}"/>`);
                continue;
            }
            if (m[3] === 'md') {
                const id = ctx.pageLink(link);
                if (id) {
                    out.push(`<pagelink target="${id}"/>`);
                    continue;
                }
            }
        }
        if ((m = t.match(/^!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))+)\)$/)) && !/^https?:/.test(m[2])) {
            const a2 = ctx.asset(decodeURIComponent(m[2]));
            if (a2) {
                out.push(`![${m[1]}](${a2})`);
                continue;
            }
        }
        // a file link on its own line: PDF viewer, audio / video player or a file card
        if ((m = t.match(/^\[([^\]]+)\]\(((?:[^()]|\([^()]*\))+\.([a-z0-9]{2,5}))\)$/i)) && !/^https?:/.test(m[2]) && !/^(md|csv)$/i.test(m[3])) {
            const a2 = ctx.asset(decodeURIComponent(m[2]));
            if (a2) {
                const ext = m[3].toLowerCase();
                const tagName = ext === 'pdf' ? 'pdf' : /^(mp3|m4a|wav|aac|ogg|flac|aif|aiff)$/.test(ext) ? 'audio' : /^(mp4|mov|webm|m4v)$/.test(ext) ? 'video' : /^(png|jpe?g|gif|webp|svg|heic)$/.test(ext) ? 'image' : 'file';
                out.push(tagName === 'image' ? `![${m[1]}](${a2})` : tagName === 'pdf' ? `<pdf src="${a2}"/>` : `<${tagName} src="${a2}" title="${m[1].replace(/"/g, '&quot;')}"/>`);
                continue;
            }
        }
        // a link alone on its line was a bookmark or an embed in Notion
        if ((m = t.match(/^\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)$/)) || (m = t.match(/^()(https?:\/\/\S+)$/))) {
            const url = m[2];
            const title = m[1] && m[1] !== url ? ` title="${m[1].replace(/"/g, '&quot;')}"` : '';
            out.push(`<embed src="${url.replace(/"/g, '%22')}"${embedUrl(url) ? ' display="frame"' : ''}${title}/>`);
            continue;
        }
        // Notion's icon images inside text are dropped; other inline HTML noise is stripped
        l = l.replace(/<img\s[^>]*app\.notion\.com\/icons[^>]*\/?>\s*/g, '').replace(/<\/?(span|mark)[^>]*>/g, '');
        out.push(l);
    }
    return out.join('\n');
}
/** Row page bodies: "# Title", blank, "Prop: value" lines, blank, content. */
function rowBody(md, props) {
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    if (/^#\s/.test(lines[0] ?? ''))
        i = 1;
    while (i < lines.length && lines[i].trim() === '')
        i++;
    while (i < lines.length && lines[i].includes(':') && props.has(lines[i].split(':')[0].trim()))
        i++;
    return lines.slice(i).join('\n').trim();
}
// ---------- import ----------
/** values in a CSV column that point at exported files ("../attachments/<id>/x.pdf") */
const FILE_REF = /(^|\/)attachments\/[^/]+\/[^/]+$|^(\.\.\/)+.+\.[a-z0-9]{2,5}$/i;
const splitFiles = (s) => s.split(/,\s*(?=(?:\.\.\/|attachments\/|https?:))/).map((x) => x.trim()).filter(Boolean);
const tick = () => new Promise((r) => setTimeout(r, 0));
export async function importNotion(files, dest, workspaceName, onProgress, opts = {}) {
    const report = { pages: 0, databases: 0, rows: 0, assets: 0, warnings: [] };
    const paths = [...files.keys()].filter((p) => !p.startsWith('__MACOSX') && !/(^|\/)\.DS_Store$/.test(p));
    const pathSet = new Set(paths);
    const resolveRel = (from, link) => {
        const parts = (dir(from) ? dir(from).split('/') : []).concat(link.split('/'));
        const outp = [];
        for (const x of parts) {
            if (x === '..')
                outp.pop();
            else if (x !== '.' && x !== '')
                outp.push(x);
        }
        return outp.join('/');
    };
    // files copied into assets/ (source path → workspace path), shared by pages, entries and file columns
    const assetsToCopy = new Map();
    const assetFor = (src) => {
        if (!pathSet.has(src))
            return null;
        let to = assetsToCopy.get(src);
        if (!to) {
            // keep the original file name (shown in Nook), with a short prefix so names never collide
            const b0 = base(src).replace(/[\\/:*?"<>|#%]+/g, '-').trim() || 'file';
            to = `assets/${ulid().slice(-6).toLowerCase()}-${b0}`;
            assetsToCopy.set(src, to);
        }
        return to;
    };
    // --- databases: read every CSV first ---
    onProgress?.('Reading databases…');
    const csvs = paths.filter((p) => p.endsWith('.csv'));
    const byBase = new Map(); // base name (dir + name w/o id) → best csv path
    for (const p of csvs) {
        const b = noExt(p).replace(/_all$/, '');
        if (!byBase.has(b) || p.endsWith('_all.csv'))
            byBase.set(b, p);
    }
    const tables = [...byBase].map(([b, p]) => {
        const table = parseCsv(text(files.get(p)));
        return { b, p, name: stripId(base(b)), table };
    }).filter((x) => x.table.length);
    // database folder names: unique, and (importing into a workspace) not taken there
    const usedKeys = new Set(opts.into?.takenKeys ?? []);
    const csvToKey = new Map();
    const rowFolders = new Set();
    const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    // folders by parent folder, and folders that belong to a page (its subpages)
    const dirsByParent = new Map();
    for (const p of paths)
        for (let d = dir(p); d; d = dir(d)) {
            const up = dir(d);
            if (!dirsByParent.has(up))
                dirsByParent.set(up, new Set());
            dirsByParent.get(up).add(d);
        }
    const mdsByDir = new Map();
    for (const p of paths)
        if (p.endsWith('.md')) {
            const d = dir(p);
            if (!mdsByDir.has(d))
                mdsByDir.set(d, []);
            mdsByDir.get(d).push(p);
        }
    const pageFolders = new Set();
    for (const p of paths)
        if (p.endsWith('.md')) {
            pageFolders.add(noExt(p));
            pageFolders.add(`${dir(p) ? dir(p) + '/' : ''}${stripId(noExt(base(p)))}`);
        }
    const dbs = [];
    const dbRowMds = [];
    const rebuiltFor = new Map(); // folder → key of a database rebuilt from its pages
    for (const t of tables) {
        const { b, p, name, table } = t;
        onProgress?.(`Database ${name}…`);
        const header = table[0].map((x) => x.trim());
        const data = table.slice(1);
        let key = slug(name) || 'database';
        while (usedKeys.has(key))
            key += '-2';
        usedKeys.add(key);
        const schema = inferSchema(name, header, data);
        header.forEach((col, i) => { if (!schema.properties.some((x) => x.name === col))
            schema.properties.push(inferProp(col, i, data)); });
        // columns that hold exported files become "Files & media"
        header.forEach((col, i) => {
            const def = schema.properties.find((x) => x.name === col);
            if (def.type === 'title' || def.type === 'formula')
                return;
            const vals = data.map((r) => (r[i] ?? '').trim()).filter(Boolean);
            if (vals.length && vals.every((v) => splitFiles(v).every((f) => FILE_REF.test(f) || /^https?:/.test(f))) && vals.some((v) => /attachments\//.test(v))) {
                def.type = 'files';
                delete def.options;
            }
        });
        const db = new Database(key, schema, []);
        const props = new Set(header);
        const folder = b;
        const folderAlt = `${dir(b) ? dir(b) + '/' : ''}${stripId(base(b))}`;
        let rowMds = [...(mdsByDir.get(folder) ?? []), ...(folderAlt !== folder ? mdsByDir.get(folderAlt) ?? [] : [])];
        rowFolders.add(folder);
        rowFolders.add(folderAlt);
        // Notion sometimes names the folder of the entries differently from the CSV ("Untitled" next to
        // "Untitled Database …csv"): take the sibling folder whose pages carry this database's titles
        if (!rowMds.length && data.length) {
            const titles = new Set(data.map((r) => norm(r[0] ?? '') || 'untitled'));
            let best = null;
            for (const d of dirsByParent.get(dir(b)) ?? []) {
                if (rowFolders.has(d) || pageFolders.has(d))
                    continue;
                const mds = mdsByDir.get(d) ?? [];
                if (!mds.length)
                    continue;
                const hit = mds.filter((m) => titles.has(norm(stripId(noExt(base(m)))))).length / mds.length;
                if (hit >= 0.6 && (!best || hit > best.score))
                    best = { d, score: hit };
            }
            if (best) {
                rowMds = mdsByDir.get(best.d) ?? [];
                rowFolders.add(best.d);
            }
        }
        // entry pages are matched by title; file names lose some characters (. : / …), so compare
        // letters and digits only; entries without a name are exported as "Untitled"
        const mdByTitle = new Map();
        for (const m of rowMds) {
            const tt = norm(stripId(noExt(base(m))));
            if (!mdByTitle.has(tt))
                mdByTitle.set(tt, []);
            mdByTitle.get(tt).push(m);
        }
        const pending = [];
        const now = new Date().toISOString().slice(0, 19);
        for (const r of data) {
            const values = {};
            let created = now, edited = now;
            header.forEach((col, i) => {
                const def = schema.properties.find((x) => x.name === col);
                const raw = r[i] ?? '';
                if (def.type === 'formula')
                    return;
                if (def.type === 'files') {
                    const list = splitFiles(raw).map((f) => (/^https?:/.test(f) ? f : assetFor(resolveRel(p, decodeURIComponent(f))) ?? f));
                    if (list.length)
                        values[col] = list;
                    return;
                }
                const v = convertValue(def, raw);
                if (def.type === 'created_time' || def.type === 'last_edited_time') {
                    const d = v;
                    if (d) {
                        if (def.type === 'created_time')
                            created = d.start.length === 10 ? d.start + 'T00:00:00' : d.start + ':00';
                        else
                            edited = d.start.length === 10 ? d.start + 'T00:00:00' : d.start + ':00';
                    }
                    return;
                }
                if (v !== null)
                    values[col] = v;
            });
            const title = String(values[db.titleProp] ?? '');
            const row = { id: ulid(Date.parse(created) || Date.now()), values, body: '', created, edited: edited < created ? created : edited };
            const cands = mdByTitle.get(norm(title) || 'untitled');
            if (cands?.length) {
                // several pages with the same title (a parent and its sub-item, say): the one whose
                // "Property: value" lines agree with this row
                let k = 0;
                if (cands.length > 1) {
                    const score = (md) => { const t = text(files.get(md)); return header.reduce((n, col, ci) => n + (ci && (r[ci] ?? '').trim() && t.includes(`\n${col}: ${(r[ci] ?? '').trim()}`) ? 1 : 0), 0); };
                    let best = -1;
                    cands.forEach((md, ci) => { const sc = score(md); if (sc > best) {
                        best = sc;
                        k = ci;
                    } });
                }
                pending.push({ row, md: cands.splice(k, 1)[0] });
            }
            db.rows.push(row);
        }
        if (!db.views.length) {
            const withImage = pending.filter(({ md }) => /!\[[^\]]*\]\(/.test(text(files.get(md)))).length;
            db.views = inferViews(name, schema, data.length ? withImage / data.length : 0);
        }
        csvToKey.set(p, key);
        csvToKey.set(b + '.csv', key);
        csvToKey.set(b + '_all.csv', key);
        dbs.push(db);
        dbRowMds.push({ db, csv: p, props, pending, header, raw: data });
        await tick();
    }
    // --- databases Notion exported without a CSV: rebuild them from their entry pages ---
    // (a folder whose pages all start with the same "Property: value" lines)
    const propLines = (md) => {
        const lines = md.replace(/\r\n/g, '\n').split('\n');
        let i = /^#\s/.test(lines[0] ?? '') ? 1 : 0;
        while (i < lines.length && lines[i].trim() === '')
            i++;
        const props = [];
        while (i < lines.length && /^[^\s:#>|\-*][^:\n]{0,40}: /.test(lines[i])) {
            const k = lines[i].indexOf(': ');
            props.push([lines[i].slice(0, k).trim(), lines[i].slice(k + 2).trim()]);
            i++;
        }
        return { props, title: (lines[0] ?? '').replace(/^#\s+/, '').trim(), rest: lines.slice(i).join('\n').trim() };
    };
    for (const [d, mds] of mdsByDir) {
        if (!d || rowFolders.has(d) || mds.length < 2)
            continue;
        const parsed = mds.map((m) => ({ m, ...propLines(text(files.get(m))) }));
        const withProps = parsed.filter((x) => x.props.length);
        if (withProps.length < Math.max(2, mds.length * 0.6))
            continue;
        const keyCount = new Map();
        for (const x of withProps)
            for (const [k] of x.props)
                keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
        const keys = [...keyCount].filter(([, n]) => n >= withProps.length * 0.5).map(([k]) => k);
        if (!keys.length)
            continue;
        const header = ['Name', ...keys.filter((k) => k !== 'Name')];
        const data = parsed.map((x) => [x.title, ...header.slice(1).map((k) => x.props.find(([pk]) => pk === k)?.[1] ?? '')]);
        const name = stripId(base(d));
        onProgress?.(`Database ${name} (rebuilt from its pages)…`);
        const schema = inferSchema(name, header, data);
        let key = slug(name) || 'database';
        while (usedKeys.has(key))
            key += '-2';
        usedKeys.add(key);
        const db = new Database(key, schema, []);
        const now = new Date().toISOString().slice(0, 19);
        const pending = [];
        data.forEach((r, k) => {
            const values = {};
            header.forEach((col, i) => { const def = schema.properties[i]; const v = def.type === 'title' ? r[i] : convertValue(def, r[i] ?? ''); if (v !== null && v !== '')
                values[col] = v; });
            const row = { id: ulid(), values, body: '', created: now, edited: now };
            db.rows.push(row);
            pending.push({ row, md: parsed[k].m });
        });
        const withImage = parsed.filter((x) => /!\[[^\]]*\]\(/.test(x.rest)).length;
        db.views = inferViews(name, schema, withImage / parsed.length);
        rowFolders.add(d);
        dbs.push(db);
        dbRowMds.push({ db, csv: d + '.csv', props: new Set(header), pending, header, raw: data });
        // the folder's own page shows the database (Notion's export only left a link to itself there)
        rebuiltFor.set(d, key);
        report.warnings.push(`"${name}" had no CSV in the export – rebuilt from its ${parsed.length} pages`);
    }
    // --- links between entries: "Title (path/Title 32-hex-id.md), …" columns become relations ---
    // Notion exports relations (also its sub-items: "Parent item" / "Sub-item") as the linked pages' titles
    // and file paths. Every entry page carries Notion's id in its file name, so the links can be restored.
    const rowByNotionId = new Map();
    for (const { db, pending } of dbRowMds)
        for (const { row, md } of pending) {
            const m = base(md).match(/([0-9a-f]{32})\.md$/i);
            if (m)
                rowByNotionId.set(m[1].toLowerCase(), { db, row });
        }
    // a value like "A (x/A 1234….md), B (x/B 5678….md)": every item ends with ".md)", titles and paths may
    // contain commas and brackets themselves
    const linksIn = (v) => {
        const t = v.trim();
        if (!t)
            return [];
        if (!/\.md\)\s*$/i.test(t))
            return null;
        const out = [];
        for (const part of t.split(/(?<=\.md\))\s*,\s*/i)) {
            const k = part.lastIndexOf(' (');
            if (k < 0 || !/\.md\)$/i.test(part))
                return null;
            let path = part.slice(k + 2, -1);
            try {
                path = decodeURIComponent(path);
            }
            catch { /* keep as it is */ }
            out.push({ title: part.slice(0, k).trim(), id: path.match(/([0-9a-f]{32})\.md$/i)?.[1].toLowerCase() });
        }
        return out;
    };
    // entries by title, for links without a usable id
    const byTitleIn = new Map();
    const titleIndex = (db) => {
        let m = byTitleIn.get(db);
        if (!m) {
            m = new Map();
            for (const r of db.rows) {
                const k = norm(String(r.values[db.titleProp] ?? ''));
                (m.get(k) ?? m.set(k, []).get(k)).push(r);
            }
            byTitleIn.set(db, m);
        }
        return m;
    };
    const resolve = (l, prefer) => {
        if (l.id && rowByNotionId.has(l.id))
            return rowByNotionId.get(l.id);
        const k = norm(l.title);
        const own = titleIndex(prefer).get(k);
        if (own?.length === 1)
            return { db: prefer, row: own[0] };
        for (const d of dbs) {
            const hit = titleIndex(d).get(k);
            if (hit?.length === 1)
                return { db: d, row: hit[0] };
        }
        return undefined;
    };
    for (const { db, header, raw } of dbRowMds) {
        header.forEach((col, i) => {
            const def = db.prop(col);
            if (!def || def.type === 'title' || def.type === 'formula' || def.type === 'files')
                return;
            const vals = raw.map((r) => r[i] ?? '');
            if (!vals.some((v) => v.trim()))
                return;
            const parsed = vals.map(linksIn);
            if (parsed.some((x) => x === null))
                return;
            const resolved = parsed.map((ls) => ls.map((l) => resolve(l, db)));
            // the database most links point into
            const count = new Map();
            for (const rs of resolved)
                for (const x of rs)
                    if (x)
                        count.set(x.db, (count.get(x.db) ?? 0) + 1);
            const target = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
            const total = parsed.reduce((n, ls) => n + ls.length, 0);
            if (!target) {
                report.warnings.push(`"${db.schema.name}" · ${col}: ${total} links to pages that are not in the export (kept as text)`);
                return;
            }
            const lost = resolved.reduce((n, rs) => n + rs.filter((x) => !x || x.db !== target).length, 0);
            if (lost)
                report.warnings.push(`"${db.schema.name}" · ${col}: ${lost} of ${total} links could not be matched`);
            def.type = 'relation';
            delete def.options;
            delete def.format;
            def.relation = { db: target.key };
            db.rows.forEach((row, k) => {
                const ids = [...new Set((resolved[k] ?? []).filter((x) => x && x.db === target).map((x) => x.row.id))];
                if (ids.length)
                    row.values[col] = ids;
                else
                    delete row.values[col];
            });
        });
        // Notion's sub-items: a relation to itself with at most one link per entry ("Parent item"), usually with
        // its mirror ("Sub-item"). Links the export lost on one side are taken from the other.
        const self = db.schema.properties.filter((p) => p.type === 'relation' && p.relation?.db === db.key && !p.relation.reverse);
        const links = (r, prop) => (Array.isArray(r.values[prop]) ? r.values[prop] : []);
        const singles = self.filter((p) => db.rows.some((r) => links(r, p.name).length) && db.rows.every((r) => links(r, p.name).length <= 1))
            .sort((a, b) => Number(/parent|übergeordnet|parent/i.test(b.name)) - Number(/parent|übergeordnet/i.test(a.name)));
        const parent = singles[0];
        if (parent) {
            // the mirror: the other relation to itself that agrees most with the parent links
            const agree = (c) => db.rows.reduce((n, r) => n + links(r, parent.name).filter((pid) => links(db.byId(pid) ?? r, c.name).includes(r.id)).length, 0);
            const mirror = self.filter((c) => c !== parent).sort((a, b) => agree(b) - agree(a))[0];
            let children = mirror?.name;
            if (!children) {
                children = 'Sub-items';
                let n = 2;
                while (db.prop(children))
                    children = `Sub-items ${n++}`;
                db.schema.properties.push({ name: children, type: 'relation', relation: { db: db.key } });
            }
            // one truth: the parent links; the sub-item lists follow from them (Notion's own order where it had one)
            for (const r of db.rows) {
                const want = db.rows.filter((c) => links(c, parent.name)[0] === r.id).map((c) => c.id);
                const had = links(r, children).filter((id) => want.includes(id));
                const list = [...had, ...want.filter((id) => !had.includes(id))];
                if (list.length)
                    r.values[children] = list;
                else
                    delete r.values[children];
            }
            parent.relation.reverse = children;
            db.prop(children).relation.reverse = parent.name;
            db.schema.subItems = { parent: parent.name, children };
        }
    }
    // --- pages ---
    const inRowFolder = (p) => { for (let d = dir(p); d; d = dir(d))
        if (rowFolders.has(d))
            return true; return false; };
    const directRow = (p) => rowFolders.has(dir(p));
    const mdPages = paths.filter((p) => p.endsWith('.md') && !directRow(p));
    const pageIdByPath = new Map();
    for (const p of mdPages)
        pageIdByPath.set(p, ulid());
    const pageByFolder = new Map(); // folder of a page's subpages → page path
    for (const p of mdPages) {
        pageByFolder.set(noExt(p), p);
        pageByFolder.set(`${dir(p) ? dir(p) + '/' : ''}${stripId(noExt(base(p)))}`, p);
    }
    /** nearest page above a file (subpages inside entries hang under the page that holds the database) */
    const parentPageOf = (p) => { for (let d = dir(p); d; d = dir(d)) {
        const q = pageByFolder.get(d);
        if (q && q !== p)
            return q;
    } return undefined; };
    const dbByKey = new Map(dbs.map((d) => [d.key, d]));
    const viewFor = (key, sorts, title) => {
        const db = dbByKey.get(key);
        if (!db)
            return undefined;
        const ok = sorts.filter((x) => db.prop(x.prop));
        if (!ok.length)
            return undefined;
        const same = db.views.find((v) => JSON.stringify(v.sorts ?? []) === JSON.stringify(ok));
        if (same)
            return same.id;
        const v = { ...structuredClone(db.views[0]), id: ulid().slice(-8).toLowerCase(), name: title?.slice(0, 40) || 'Sorted', sorts: ok };
        db.views.push(v);
        return v.id;
    };
    const mdCtx = (from) => ({
        csvKey: (link) => { const r = resolveRel(from, link); return csvToKey.get(r) ?? csvToKey.get(r.replace(/\.csv$/, '_all.csv')) ?? null; },
        pageLink: (link) => pageIdByPath.get(resolveRel(from, link)) ?? null,
        asset: (link) => assetFor(resolveRel(from, link)),
        viewFor,
    });
    const pages = [];
    for (const [n, p] of mdPages.entries()) {
        if (n % 50 === 0) {
            onProgress?.(`Pages ${n} / ${mdPages.length}…`);
            await tick();
        }
        const md = text(files.get(p));
        let title = (md.match(/^#\s+(.+)$/m)?.[1] ?? stripId(noExt(base(p)))).trim();
        if (title === 'Untitled' && stripId(noExt(base(p))) !== 'Untitled')
            title = stripId(noExt(base(p)));
        const parentPath = parentPageOf(p);
        let body = convertNotionMd(md, mdCtx(p));
        const rebuilt = rebuiltFor.get(noExt(p)) ?? rebuiltFor.get(`${dir(p) ? dir(p) + '/' : ''}${stripId(noExt(base(p)))}`);
        if (rebuilt) {
            const self = new RegExp(`^<pagelink target="${pageIdByPath.get(p)}"\\/>$|^\\[[^\\]]*\\]\\(${encodeURI(base(p)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`, 'm');
            body = self.test(body) ? body.replace(self, `<view db="${rebuilt}"/>`) : `<view db="${rebuilt}"/>\n\n${body}`;
        }
        const id = pageIdByPath.get(p);
        pages.push({ id, title, parent: parentPath ? pageIdByPath.get(parentPath) : undefined, body, file: `pages/${slug(title) || 'page'}-${id}.md` });
    }
    void inRowFolder;
    // entry pages: same conversion (images, files, embedded databases, links) relative to their file
    for (const { pending, props } of dbRowMds) {
        for (const { row, md } of pending)
            row.body = convertNotionMd(rowBody(text(files.get(md)), props), mdCtx(md));
    }
    // resolve "@Title" placeholders from the layouts
    const byTitle = new Map(pages.map((x) => [x.title.toLowerCase(), x.id]));
    const dbByName = new Map(dbs.map((d) => [d.schema.name.toLowerCase(), d.key]));
    for (const pg of pages) {
        pg.body = pg.body.replace(/<button action="open" target="@([^"]+)">/g, (_m, t) => {
            const id = byTitle.get(t.toLowerCase());
            if (id)
                return `<button action="open" target="${id}">`;
            const key = dbByName.get(t.toLowerCase());
            if (key)
                return `<button action="opendb" target="${key}">`;
            report.warnings.push(`Button "${t}": no page or database with that name in the export`);
            return '<button action="open" target="">';
        }).replace(/<pagelink target="@([^"]+)"\/>/g, (_m, t) => {
            const id = byTitle.get(t.toLowerCase());
            return id ? `<pagelink target="${id}"/>` : `<p>${t}</p>`;
        });
    }
    // --- write ---
    onProgress?.('Writing pages…');
    if (opts.into) {
        // everything below one new page; its links to the top pages are added by Nook when it loads
        const id = ulid();
        for (const pg of pages)
            if (!pg.parent)
                pg.parent = id;
        pages.unshift({ id, title: opts.into.title, icon: undefined, parent: opts.into.parent, body: '', file: `pages/${slug(opts.into.title) || 'import'}-${id}.md` });
        report.root = id;
    }
    if (opts.keepIcons === false)
        for (const pg of pages)
            delete pg.icon;
    const home = pages.find((x) => !x.parent);
    const meta = { name: workspaceName, formatVersion: APP.formatVersion, home: home?.id, locale: defaultLocale() };
    if (!opts.into)
        await dest.write(`${APP.workspaceDir}/workspace.json`, JSON.stringify(meta, null, 2) + '\n');
    for (const [n, pg] of pages.entries()) {
        const blocks = parsePage(pg.body);
        await dest.write(pg.file, formatDoc({ id: pg.id, title: pg.title, icon: pg.icon ?? null, parent: pg.parent ?? null }, serializePage(blocks)));
        report.pages++;
        if (n % 50 === 0) {
            onProgress?.(`Writing pages ${n} / ${pages.length}…`);
            await tick();
        }
    }
    const totalRows = dbs.reduce((s2, d) => s2 + d.rows.length, 0);
    let written = 0;
    for (const db of dbs) {
        await dest.write(`databases/${db.key}/database.json`, JSON.stringify(db.schema, null, 2) + '\n');
        await dest.write(`databases/${db.key}/views.json`, JSON.stringify(db.views, null, 2) + '\n');
        // a few files at a time: much faster on folders and through the local server
        for (let i = 0; i < db.rows.length; i += 16) {
            await Promise.all(db.rows.slice(i, i + 16).map((r) => dest.write(`databases/${db.key}/rows/${r.id}.md`, formatRow(db, r))));
            written += Math.min(16, db.rows.length - i);
            if (i % 160 === 0) {
                onProgress?.(`Writing entries ${written} / ${totalRows} (${db.schema.name})…`);
                await tick();
            }
        }
        report.databases++;
        report.rows += db.rows.length;
    }
    let a = 0;
    for (const [src, to] of assetsToCopy) {
        const bytes = files.get(src);
        if (dest.writeBinary) {
            await dest.writeBinary(to, bytes);
            report.assets++;
        }
        if (++a % 10 === 0) {
            onProgress?.(`Copying files ${a} / ${assetsToCopy.size}…`);
            await tick();
        }
    }
    const unused = paths.filter((p) => /(^|\/)attachments\//.test(p) && !assetsToCopy.has(p)).length;
    if (unused)
        report.warnings.push(`${unused} attachment${unused === 1 ? '' : 's'} not used by any page or entry (not copied)`);
    return report;
}
export { Workspace };
//# sourceMappingURL=notion.js.map