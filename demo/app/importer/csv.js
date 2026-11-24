// A CSV file as a database – a new one, or more entries for an existing one. The columns' types are
// recognised from their values (dates, numbers, email, phone, links, choices …), empty columns are
// left out, and the name of an entry is a "Name" column or first and last name together (contacts).
import { parseCsv, inferProp, convertValue } from './notion.js';
/** the separator of a CSV: comma, semicolon or tab – whichever splits the first line most (outside quotes) */
function separator(text) {
    const first = text.split(/\r?\n/, 1)[0] ?? '';
    const count = (c) => { let n = 0, q = false; for (const ch of first) {
        if (ch === '"')
            q = !q;
        else if (!q && ch === c)
            n++;
    } return n; };
    return [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
}
const NAME = /^(name|full ?name|display ?name|anzeigename|titel|title|vollständiger name)$/i;
const FIRST = /^(first ?name|given ?name|vorname)$/i;
const LAST = /^(last ?name|family ?name|surname|nachname|name, nachname)$/i;
/** reads a CSV: header and rows, without columns that are empty in every row; the name comes first */
export function readCsv(text) {
    const all = parseCsv(text.replace(/^﻿/, ''), separator(text));
    const head = (all.shift() ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
    const rows = all.filter((r) => r.some((c) => c.trim()));
    const keep = head.map((_, i) => rows.some((r) => (r[i] ?? '').trim())).map((k, i) => (k && head[i] ? i : -1)).filter((i) => i >= 0);
    let header = keep.map((i) => head[i]);
    let data = rows.map((r) => keep.map((i) => (r[i] ?? '').trim()));
    // the entries' name: a name column, or first + last name (put first)
    let ni = header.findIndex((h) => NAME.test(h));
    if (ni < 0) {
        const f = header.findIndex((h) => FIRST.test(h)), l = header.findIndex((h) => LAST.test(h));
        if (f >= 0 || l >= 0) {
            header = ['Name', ...header];
            data = data.map((r) => [[f >= 0 ? r[f] : '', l >= 0 ? r[l] : ''].filter(Boolean).join(' '), ...r]);
            ni = 0;
        }
    }
    if (ni > 0) {
        header = [header[ni], ...header.filter((_, i) => i !== ni)];
        data = data.map((r) => [r[ni], ...r.filter((_, i) => i !== ni)]);
    }
    return { header, rows: data };
}
/** the CSV as a new database named after the file (or into `into`: its columns become properties when missing) */
/** `map` (into a database): per column the property it goes to, '' for a new property, null to leave it out */
export async function importCsv(ws, file, into, map, table) {
    if (into && map)
        return importMapped(ws, table ?? readCsv(await file.text()), into, map);
    const { header, rows } = table ?? readCsv(await file.text());
    if (!header.length)
        throw new Error('This file has no columns.');
    const props = header.map((h, i) => inferProp(h, i, rows));
    // choices only where values really repeat (names, companies, notes of contacts are text)
    props.forEach((p, i) => {
        if (p.type !== 'select' && p.type !== 'multi_select')
            return;
        const vals = rows.map((r) => (r[i] ?? '').trim()).filter(Boolean);
        if (/name|vorname|nachname|firma|company|organi[sz]ation|note|notiz|adresse|address|street|straße/i.test(p.name) || new Set(vals).size > vals.length * 0.5) {
            p.type = 'text';
            delete p.options;
        }
    });
    let db = into;
    if (!db) {
        const base = file.name.replace(/\.(csv|tsv|txt)$/i, '').trim() || 'Imported';
        db = await ws.createDatabase(base[0].toUpperCase() + base.slice(1));
        db.schema.properties = props;
        db.views = db.views.map((v) => ({ ...v, props: props.slice(0, 8).map((p) => p.name) }));
    }
    else {
        // columns that match a property (by name, any case) go there; the others become new properties
        props.forEach((p, i) => {
            const hit = db.schema.properties.find((q) => q.name.toLowerCase() === p.name.toLowerCase());
            if (hit)
                props[i] = hit;
            else if (p.type === 'title') {
                props[i] = db.schema.properties.find((q) => q.type === 'title');
            }
            else
                db.schema.properties.push(p);
        });
    }
    ws.boundary();
    await ws.saveSchema(db);
    await ws.saveViews(db);
    for (const r of rows) {
        const values = {};
        props.forEach((p, i) => { const v = convertValue(p, r[i] ?? ''); if (v !== null && v !== '')
            values[p.name] = v; });
        await ws.addRow(db, values, '');
    }
    return { db, added: rows.length };
}
async function importMapped(ws, t, db, map) {
    const targets = t.header.map((h, i) => {
        const m = map[i];
        if (m == null)
            return null;
        if (m === '') {
            const p = inferProp(h, i, t.rows);
            if (p.type === 'title')
                p.type = 'text';
            let n = h, k = 2;
            while (db.schema.properties.some((q) => q.name.toLowerCase() === n.toLowerCase()))
                n = `${h} ${k++}`;
            p.name = n;
            db.schema.properties.push(p);
            return p;
        }
        return db.schema.properties.find((q) => q.name === m) ?? null;
    });
    ws.boundary();
    await ws.saveSchema(db);
    // a date column that is the database's date: rows where it can't be read are left out (sums, notes …)
    const dateCol = targets.findIndex((p) => p?.type === 'date');
    let added = 0;
    for (const r of t.rows) {
        const values = {};
        targets.forEach((p, i) => { if (!p)
            return; const v = convertValue(p, r[i] ?? ''); if (v !== null && v !== '')
            values[p.name] = v; });
        if (!Object.keys(values).length)
            continue;
        if (dateCol >= 0 && (r[dateCol] ?? '').trim() && values[targets[dateCol].name] == null)
            continue;
        await ws.addRow(db, values, '');
        added++;
    }
    return { db, added };
}
//# sourceMappingURL=csv.js.map