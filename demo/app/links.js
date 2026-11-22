export function rowTarget(db, id) {
    return `row:${encodeURIComponent(db)}:${encodeURIComponent(id)}`;
}
export function parseRowTarget(target) {
    const m = /^row:([^:]+):([^:]+)$/.exec(target);
    if (!m)
        return null;
    try {
        return { db: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) };
    }
    catch {
        return null;
    }
}
export function resolveRowTarget(ws, target) {
    const ref = parseRowTarget(target);
    if (!ref)
        return null;
    const db = ws.dbs.get(ref.db), row = db?.rows.find((r) => r.id === ref.id);
    if (db && row)
        return { db, row };
    // A copied link can outlive a database rename. Only accept an unambiguous row ID.
    if (!db) {
        const matches = [...ws.dbs.values()].flatMap((d) => d.rows.filter((r) => r.id === ref.id).map((r) => ({ db: d, row: r })));
        if (matches.length === 1)
            return matches[0];
    }
    return null;
}
/** Internal links pasted into formatted text; external URLs remain external. */
export function targetFromHref(href) {
    if (href.startsWith('nook:remind:'))
        return null;
    if (href.startsWith('nook:')) {
        const target = href.slice(5);
        if (target.startsWith('row:'))
            return target;
        try {
            return decodeURIComponent(target);
        }
        catch {
            return null;
        }
    }
    // Nook's own address (a copied link): its part after # names the page or entry
    if (/^https?:/.test(href)) {
        try {
            const u = new URL(href);
            if (u.origin !== location.origin || u.pathname !== location.pathname || !u.hash)
                return null;
            href = u.hash;
        }
        catch {
            return null;
        }
    }
    if (!href.startsWith('#'))
        return null;
    const q = new URLSearchParams(href.slice(1));
    if (q.get('p'))
        return q.get('p');
    const row = q.get('row');
    if (row) {
        const i = row.indexOf('/');
        if (i > 0 && i < row.length - 1)
            return rowTarget(row.slice(0, i), row.slice(i + 1));
    }
    return null;
}
//# sourceMappingURL=links.js.map