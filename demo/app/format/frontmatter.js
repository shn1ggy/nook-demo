const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
export function parseValue(raw) {
    const s = raw.trim();
    if (s === '' || s === '~' || s === 'null')
        return null;
    if (s === 'true')
        return true;
    if (s === 'false')
        return false;
    if (s.startsWith('"') || s.startsWith('[') || s.startsWith('{')) {
        try {
            return JSON.parse(s);
        }
        catch {
            return s;
        }
    }
    if (/^-?\d+(\.\d+)?$/.test(s))
        return Number(s);
    const range = s.split('/');
    if (range.length === 2 && DATE_RE.test(range[0]) && DATE_RE.test(range[1]))
        return { start: range[0], end: range[1] };
    if (DATE_RE.test(s))
        return { start: s };
    return s;
}
function formatValue(v) {
    if (v == null)
        return '';
    if (typeof v === 'boolean' || typeof v === 'number')
        return String(v);
    if (Array.isArray(v))
        return JSON.stringify(v);
    if (typeof v === 'object')
        return v.end && v.end !== v.start ? `${v.start}/${v.end}` : v.start;
    // plain strings are written bare unless they would be read back as something else
    const reread = parseValue(v);
    const safe = typeof reread === 'string' && reread === v && !/[\n:#]|^\s|\s$/.test(v);
    return safe ? v : JSON.stringify(v);
}
function formatKey(k) {
    return /^[^\s"':#][^:"]*$/.test(k) && !/\s$/.test(k) ? k : JSON.stringify(k);
}
export function parseDoc(text) {
    const meta = {};
    const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    if (!src.startsWith('---\n'))
        return { meta, body: src };
    const end = src.indexOf('\n---', 4);
    if (end < 0)
        return { meta, body: src };
    for (const line of src.slice(4, end).split('\n')) {
        if (!line.trim())
            continue;
        let key, rest;
        if (line.startsWith('"')) {
            const close = findJsonStringEnd(line);
            key = JSON.parse(line.slice(0, close + 1));
            rest = line.slice(close + 1).replace(/^\s*:/, '');
        }
        else {
            const i = line.indexOf(':');
            if (i < 0)
                continue;
            key = line.slice(0, i).trim();
            rest = line.slice(i + 1);
        }
        meta[key] = parseValue(rest);
    }
    const after = src.slice(end + 4);
    return { meta, body: after.replace(/^\n/, '') };
}
function findJsonStringEnd(s) {
    for (let i = 1; i < s.length; i++) {
        if (s[i] === '\\') {
            i++;
            continue;
        }
        if (s[i] === '"')
            return i;
    }
    return s.length - 1;
}
export function formatDoc(meta, body) {
    const lines = ['---'];
    for (const [k, v] of Object.entries(meta)) {
        if (v == null || v === '' || (Array.isArray(v) && v.length === 0))
            continue;
        lines.push(`${formatKey(k)}: ${formatValue(v)}`);
    }
    lines.push('---');
    return lines.join('\n') + '\n' + (body ? body.replace(/\n*$/, '\n') : '');
}
//# sourceMappingURL=frontmatter.js.map