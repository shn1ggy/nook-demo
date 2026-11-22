// Two versions of the same file, changed on two devices before Dropbox could sync: merged
// automatically when nothing really contradicts – only real contradictions become a conflict.
//   · JSON: keys only one side has are kept; lists of things with an "id" are combined by id;
//     bookkeeping (when something was fetched, edit times, counters) takes the later value; a
//     lease (which device fetches pictures) takes the one that lasts longer.
//   · Markdown (pages, entries): equal apart from the edit time → this device's version.
// Returns the merged text, or null for a real conflict.
/** values that are bookkeeping, not content: the later (larger) one is right */
const LATER = new Set(['fetched', 'until', 'lastChecked', 'checked', 'updated', 'edited', '_edited', 'modified', 'added', 'seen', 'synced', 'at']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function mergeJson(a, b, key = '') {
    if (same(a, b))
        return { ok: true, v: a };
    if (a === undefined)
        return { ok: true, v: b };
    if (b === undefined)
        return { ok: true, v: a };
    // which device fetches: the lease that lasts longer
    if (key === 'lease' && isObj(a) && isObj(b))
        return { ok: true, v: Number(a.until ?? 0) >= Number(b.until ?? 0) ? a : b };
    if (LATER.has(key) && (typeof a === typeof b) && (typeof a === 'string' || typeof a === 'number'))
        return { ok: true, v: a >= b ? a : b };
    if (isObj(a) && isObj(b)) {
        const out = {};
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const m = mergeJson(a[k], b[k], k);
            if (!m.ok)
                return m;
            if (m.v !== undefined)
                out[k] = m.v;
        }
        return { ok: true, v: out };
    }
    // lists of things with ids (sources, recipes, calendars …): by id, in this device's order, new ones after
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((x) => isObj(x) && typeof x.id === 'string')) {
        const byId = new Map(b.map((x) => [x.id, x]));
        const out = [];
        for (const x of a) {
            const m = mergeJson(x, byId.get(x.id));
            if (!m.ok)
                return m;
            out.push(m.v);
            byId.delete(x.id);
        }
        out.push(...byId.values());
        return { ok: true, v: out };
    }
    return { ok: false };
}
/** frontmatter edit times don't make a page or entry different */
const withoutStamps = (t) => t.replace(/^(_edited|edited|updated|last_edited_time):.*$/gm, '').replace(/\s+$/gm, '').trim();
export function autoMerge(path, mine, theirs) {
    if (mine === theirs || mine.trim() === theirs.trim())
        return mine;
    if (/\.json$/i.test(path)) {
        let a, b;
        try {
            a = JSON.parse(mine);
            b = JSON.parse(theirs);
        }
        catch {
            return null;
        }
        const m = mergeJson(a, b);
        return m.ok ? JSON.stringify(m.v, null, 2) + (mine.endsWith('\n') ? '\n' : '') : null;
    }
    if (/\.(md|txt)$/i.test(path) && withoutStamps(mine) === withoutStamps(theirs))
        return mine;
    return null;
}
// ---------- three-way: with the version both sides started from ----------
// Two devices changed the same file. Knowing the version both started from, every change is kept where
// the other side left that part alone; only a part changed differently on both sides is a real conflict.
/** for each line of a: the index of the same line in b (longest common subsequence), or -1 */
export function matchLines(a, b) {
    const map = new Int32Array(a.length).fill(-1);
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) {
        map[s] = s;
        s++;
    }
    let ea = a.length, eb = b.length;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
        ea--;
        eb--;
        map[ea] = eb;
    }
    const n = ea - s, m = eb - s;
    if (!n || !m)
        return map;
    if (n * m > 25_000_000) { // too large to compare closely: equal lines at the same place only
        for (let i = 0; i < Math.min(n, m); i++)
            if (a[s + i] === b[s + i])
                map[s + i] = s + i;
        return map;
    }
    const w = m + 1, dp = new Int32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
            dp[i * w + j] = a[s + i] === b[s + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
        if (a[s + i] === b[s + j]) {
            map[s + i] = s + j;
            i++;
            j++;
        }
        else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1])
            i++;
        else
            j++;
    }
    return map;
}
/** the files lined up part by part (diff3) */
export function diff3(base, mine, theirs) {
    const ma = matchLines(base, mine), mb = matchLines(base, theirs);
    const out = [];
    let i = 0, j = 0, k = 0;
    const same = (l) => { const last = out[out.length - 1]; if (last && 'same' in last)
        last.same.push(l);
    else
        out.push({ same: [l] }); };
    for (;;) {
        let ib = i;
        while (ib < base.length && !(ma[ib] >= j && mb[ib] >= k))
            ib++;
        const je = ib < base.length ? ma[ib] : mine.length, ke = ib < base.length ? mb[ib] : theirs.length;
        if (ib > i || je > j || ke > k)
            out.push({ base: base.slice(i, ib), mine: mine.slice(j, je), theirs: theirs.slice(k, ke) });
        if (ib >= base.length)
            break;
        same(base[ib]);
        i = ib + 1;
        j = je + 1;
        k = ke + 1;
    }
    return out;
}
const eqL = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
/** lines: merged text, or null when both sides changed the same part differently */
function merge3Lines(base, mine, theirs) {
    const parts = [];
    for (const hk of diff3(base.split('\n'), mine.split('\n'), theirs.split('\n'))) {
        if ('same' in hk) {
            parts.push(...hk.same);
            continue;
        }
        if (eqL(hk.mine, hk.base))
            parts.push(...hk.theirs);
        else if (eqL(hk.theirs, hk.base) || eqL(hk.mine, hk.theirs))
            parts.push(...hk.mine);
        else
            return null;
    }
    return parts.join('\n');
}
/** JSON, three-way: a key only one side changed takes that side's value */
function merge3Json(base, a, b, key = '') {
    if (same(a, b))
        return { ok: true, v: a };
    if (same(a, base))
        return { ok: true, v: b };
    if (same(b, base))
        return { ok: true, v: a };
    if (isObj(a) && isObj(b)) {
        const o = isObj(base) ? base : {};
        const out = {};
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
            const m = merge3Json(o[k], a[k], b[k], k);
            if (!m.ok)
                return m;
            if (m.v !== undefined)
                out[k] = m.v;
        }
        return { ok: true, v: out };
    }
    if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((x) => isObj(x) && typeof x.id === 'string')) {
        const ids = (l) => new Map((Array.isArray(l) ? l : []).filter(isObj).map((x) => [x.id, x]));
        const B = ids(base), A = ids(a), T = ids(b);
        const out = [];
        const order = [...a.map((x) => x.id), ...b.map((x) => x.id).filter((id) => !A.has(id))];
        for (const id of order) {
            const m = merge3Json(B.get(id), A.get(id), T.get(id), '');
            if (!m.ok)
                return m;
            if (m.v !== undefined)
                out.push(m.v);
        }
        return { ok: true, v: out };
    }
    return mergeJson(a, b, key);
}
/** frontmatter edit times: the later one, the same on all three versions (so they never conflict) */
const STAMP = /^(_edited|edited|updated|last_edited_time):(.*)$/gm;
export function alignStamps(texts) {
    const latest = new Map();
    for (const t of texts)
        for (const m of t.matchAll(STAMP)) {
            const v = m[2].trim();
            if (v > (latest.get(m[1]) ?? ''))
                latest.set(m[1], v);
        }
    return texts.map((t) => t.replace(STAMP, (all, k) => latest.has(k) ? `${k}: ${latest.get(k)}` : all));
}
/** merged text, or null for a real conflict; without the starting version: as autoMerge */
export function autoMerge3(path, base, mine, theirs) {
    const two = autoMerge(path, mine, theirs);
    if (two !== null || base === undefined)
        return two;
    if (/\.json$/i.test(path)) {
        let o, a, b;
        try {
            o = JSON.parse(base);
            a = JSON.parse(mine);
            b = JSON.parse(theirs);
        }
        catch {
            return null;
        }
        const m = merge3Json(o, a, b);
        return m.ok ? JSON.stringify(m.v, null, 2) + (mine.endsWith('\n') ? '\n' : '') : null;
    }
    if (/\.(md|txt|csv|ics)$/i.test(path)) {
        const [o, a, b] = alignStamps([base, mine, theirs].map((t) => t.replace(/\r\n?/g, '\n')));
        return merge3Lines(o, a, b);
    }
    return null;
}
//# sourceMappingURL=merge.js.map