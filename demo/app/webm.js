// Recordings in WebM (what some browsers make) don't say how long they are: players then can't jump in them.
// This writes the length into the file's header (Segment › Info › Duration), as other tools do.
function vint(b, p) {
    const first = b[p];
    let len = 1, mask = 0x80;
    while (len <= 8 && !(first & mask)) {
        len++;
        mask >>= 1;
    }
    if (len > 8)
        throw new Error('bad vint');
    let val = first & (mask - 1), allOnes = val === mask - 1;
    for (let i = 1; i < len; i++) {
        val = val * 256 + b[p + i];
        if (b[p + i] !== 0xff)
            allOnes = false;
    }
    return { len, val, unknown: allOnes };
}
function idLen(b, p) { const x = b[p]; return x & 0x80 ? 1 : x & 0x40 ? 2 : x & 0x20 ? 3 : 4; }
function readId(b, p) { let v = 0; for (let i = 0; i < idLen(b, p); i++)
    v = v * 256 + b[p + i]; return v; }
function encSize(val, len) {
    const out = [];
    for (let i = len - 1; i >= 0; i--) {
        out[i] = val & 0xff;
        val = Math.floor(val / 256);
    }
    out[0] |= 0x80 >> (len - 1);
    return out;
}
/** a copy of `buf` that knows its length (`ms`); the original when it is not WebM or already knows */
export function withWebmDuration(buf, ms) {
    try {
        if (readId(buf, 0) !== 0x1a45dfa3)
            return buf;
        const h = vint(buf, 4);
        let p = 4 + h.len + h.val;
        if (readId(buf, p) !== 0x18538067)
            return buf;
        const segId = p, segSize = vint(buf, p + 4), segData = p + 4 + segSize.len;
        p = segData;
        while (p < buf.length) {
            const id = readId(buf, p), il = idLen(buf, p), sz = vint(buf, p + il), data = p + il + sz.len;
            if (id === 0x1549a966) {
                // Info: TimecodeScale (default 1 ms) and Duration
                let scale = 1e6, dur = -1, q = data;
                while (q < data + sz.val) {
                    const cid = readId(buf, q), cl = idLen(buf, q), cs = vint(buf, q + cl), cd = q + cl + cs.len;
                    if (cid === 0x2ad7b1) {
                        scale = 0;
                        for (let i = 0; i < cs.val; i++)
                            scale = scale * 256 + buf[cd + i];
                    }
                    if (cid === 0x4489)
                        dur = q;
                    q = cd + cs.val;
                }
                const value = (ms * 1e6) / scale;
                if (dur >= 0) {
                    const out = buf.slice(), cl = idLen(out, dur), cs = vint(out, dur + cl), cd = dur + cl + cs.len;
                    const view = new DataView(out.buffer, out.byteOffset);
                    if (cs.val === 8)
                        view.setFloat64(cd, value);
                    else if (cs.val === 4)
                        view.setFloat32(cd, value);
                    else
                        return buf;
                    return out;
                }
                // no Duration yet: add one (11 bytes) at the end of Info, and grow Info (and Segment, if it has a size)
                const el = new Uint8Array(11);
                el.set([0x44, 0x89, 0x88]);
                new DataView(el.buffer).setFloat64(3, value);
                const infoSize = encSize(sz.val + 11, sz.len);
                if (sz.val + 11 >= 2 ** (7 * sz.len) - 1)
                    return buf;
                const parts = [];
                if (segSize.unknown)
                    parts.push(buf.subarray(0, p));
                else {
                    if (segSize.val + 11 >= 2 ** (7 * segSize.len) - 1)
                        return buf;
                    parts.push(buf.subarray(0, segId + 4), Uint8Array.from(encSize(segSize.val + 11, segSize.len)), buf.subarray(segData, p));
                }
                parts.push(buf.subarray(p, p + il), Uint8Array.from(infoSize), buf.subarray(data, data + sz.val), el, buf.subarray(data + sz.val));
                const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
                let o = 0;
                for (const x of parts) {
                    out.set(x, o);
                    o += x.length;
                }
                return out;
            }
            if (sz.unknown)
                return buf;
            p = data + sz.val;
        }
    }
    catch { /* not what we expect: leave it */ }
    return buf;
}
//# sourceMappingURL=webm.js.map