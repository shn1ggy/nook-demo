// Fetching a calendar link. A website may not fetch from other servers unless they allow it, so the
// request goes, in this order of preference:
//   1. through Nook's local server (started with the start file): scripts/serve.mjs → /api/net
//   2. through Dropbox, when the workspace is opened from Dropbox: Dropbox fetches the address into a
//      short-lived file that Nook reads (the hosted site, the phone)
//   3. straight from the browser – works only with the few calendar servers that allow websites
// Tests pass their own function.
import { ServerStorage } from '../storage/storage.js';
/** set while a Dropbox workspace is open: Dropbox fetches addresses for Nook */
let storageFetch = null;
export function setStorageFetch(fn) { storageFetch = fn; }
/** how requests leave this Nook */
export function netMode() { return ServerStorage.available() ? 'server' : storageFetch ? 'dropbox' : 'direct'; }
export const browserNet = async (req) => {
    const url = req.url.replace(/^webcal:/i, 'https:');
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i.test(url))
        throw new Error('Only https addresses can be used.');
    const key = ServerStorage.key();
    if (key) {
        let r;
        try {
            r = await fetch('/api/net', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nook-key': key }, body: JSON.stringify({ ...req, url }) });
        }
        catch {
            throw new Error('Nook’s local server could not be reached.');
        }
        if (!r.ok)
            throw new Error(`Nook’s local server refused the request (${r.status}).`);
        const out = await r.json();
        if (out.status === 0)
            throw new Error(`Could not reach ${new URL(url).host}: ${out.error ?? 'no connection'}`);
        return out;
    }
    if (storageFetch)
        return { status: 200, headers: {}, body: await storageFetch(url) };
    let r;
    try {
        r = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'follow', cache: 'no-store' });
    }
    catch {
        throw new Error(`${new URL(url).host} does not allow requests from a website. Open the workspace from Dropbox, or open Nook with its start file on a computer – both can fetch calendar links.`);
    }
    return { status: r.status, headers: {}, body: await r.text() };
};
//# sourceMappingURL=net.js.map