const enc = new TextEncoder();
let CRC = null;
function crc32(data) {
    if (!CRC) {
        CRC = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++)
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            CRC[n] = c >>> 0;
        }
    }
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++)
        c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
export class ZipStorage {
    label;
    writable = true;
    files = new Map();
    constructor(label) {
        this.label = label;
    }
    async list(d) {
        const prefix = d ? d.replace(/\/+$/, '') + '/' : '';
        const seen = new Map();
        for (const k of this.files.keys()) {
            if (!k.startsWith(prefix))
                continue;
            const [first, ...more] = k.slice(prefix.length).split('/');
            if (!seen.has(first))
                seen.set(first, { name: first, kind: more.length ? 'dir' : 'file' });
        }
        return [...seen.values()];
    }
    async read(p) { const b = this.files.get(p); if (!b)
        throw new Error(`Not found: ${p}`); return new TextDecoder().decode(b); }
    async write(p, data) { this.files.set(p, enc.encode(data)); }
    async writeBinary(p, data) { this.files.set(p, data); }
    async remove(p) { for (const k of [...this.files.keys()])
        if (k === p || k.startsWith(p + '/'))
            this.files.delete(k); }
    async exists(p) { for (const k of this.files.keys())
        if (k === p || k.startsWith(p + '/'))
            return true; return false; }
    /** All files as a zip, inside one folder named after the workspace. */
    toBlob(folder) {
        const parts = [];
        const central = [];
        let offset = 0;
        const now = new Date();
        const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        for (const [path, data] of this.files) {
            const name = enc.encode(`${folder}/${path}`);
            const crc = crc32(data);
            const local = new Uint8Array(30 + name.length);
            const lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true);
            lv.setUint16(6, 0x0800, true); // UTF-8 names
            lv.setUint16(8, 0, true);
            lv.setUint16(10, dosTime, true);
            lv.setUint16(12, dosDate, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, data.length, true);
            lv.setUint32(22, data.length, true);
            lv.setUint16(26, name.length, true);
            lv.setUint16(28, 0, true);
            local.set(name, 30);
            const cd = new Uint8Array(46 + name.length);
            const cv = new DataView(cd.buffer);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint16(8, 0x0800, true);
            cv.setUint16(10, 0, true);
            cv.setUint16(12, dosTime, true);
            cv.setUint16(14, dosDate, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, data.length, true);
            cv.setUint32(24, data.length, true);
            cv.setUint16(28, name.length, true);
            cv.setUint32(42, offset, true);
            cd.set(name, 46);
            parts.push(local, data);
            central.push(cd);
            offset += local.length + data.length;
        }
        const cdSize = central.reduce((s, c) => s + c.length, 0);
        const end = new Uint8Array(22);
        const ev = new DataView(end.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(8, this.files.size, true);
        ev.setUint16(10, this.files.size, true);
        ev.setUint32(12, cdSize, true);
        ev.setUint32(16, offset, true);
        return new Blob([...parts, ...central, end], { type: 'application/zip' });
    }
}
//# sourceMappingURL=zipwrite.js.map