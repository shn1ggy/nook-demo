// The workspace folder arranged like the sidebar (format "layout 2"):
//
//   <workspace>/
//     Pages/Home/Home.md                    a page is a folder with its file inside, named after it
//     Pages/Studium/Seminar Plan.pdf        files added on a page sit next to it
//     Pages/Studium/Notizen/Notizen.md      a sub-page: a folder inside its page's folder
//     Databases/Kontakte/database.json      a database: a folder with database.json and views.json …
//     Databases/Kontakte/Anna.md            … and one file per entry, named after it
//     Databases/Kontakte/Anna/              files added on an entry (only when there are any)
//     Unused files/                         files nothing shows (from the old assets/)
//     .workspace/                           settings, history, trash, comments
//
// Pages, entries and databases are known by the id inside their file, never by where it is – so names and
// folders can change (in Nook or in Finder) without breaking any link.
/** a name that works as a file or folder name everywhere (Mac, Windows, Dropbox) */
export function safeName(s) {
    let n = s.replace(/[\\/:*?"<>|#%\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');
    if (n.length > 80) {
        const cut = n.slice(0, 80);
        const sp = cut.lastIndexOf(' ');
        n = (sp > 40 ? cut.slice(0, sp) : cut).trim();
    }
    // names Windows keeps for itself (CON, PRN, AUX, NUL, COM1 …, LPT1 …) can't be files there
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(n))
        n = `${n}_`;
    return n || 'Untitled';
}
export const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
export const stemOf = (p) => baseOf(p).replace(/\.[^.]+$/, '');
export const join = (dir, name) => (dir ? `${dir}/${name}` : name);
export const under = (p, dir) => !dir || p === dir || p.startsWith(dir + '/');
/** the folder of a page whose file is "<folder>/<name>/<name>.md"; null for other files */
export function pageFolder(file) {
    const d = dirOf(file);
    return d && baseOf(d).toLowerCase() === stemOf(file).toLowerCase() ? d : null;
}
/** `base`, or "base (2)", "base (3)" … – the first not taken (names compared without case, as on a Mac) */
export function uniqueName(base, taken, ext = '', keep) {
    if (keep && keep.toLowerCase().endsWith(ext.toLowerCase()) && !taken.has(keep.toLowerCase())) {
        // the current name still fits (same name, maybe with its number): it stays, so names don't shuffle
        const m = keep.slice(0, keep.length - ext.length).match(/^(.*?)(?: \((\d+)\))?$/);
        if (m && m[1].toLowerCase() === base.toLowerCase())
            return keep;
    }
    for (let i = 1;; i++) {
        const n = (i === 1 ? base : `${base} (${i})`) + ext;
        if (!taken.has(n.toLowerCase()))
            return n;
    }
}
/** the names inside a folder, from a list of every file's path */
export function namesIn(dir, paths) {
    const out = new Set();
    const pre = dir ? dir + '/' : '';
    for (const p of paths)
        if (p.startsWith(pre))
            out.add(p.slice(pre.length).split('/')[0].toLowerCase());
    return out;
}
/** the top folders */
export const PAGES = 'Pages', DATABASES = 'Databases', UNUSED = 'Unused files';
/** text files Nook never reads as pages or entries */
export const NOT_CONTENT = /^(\.workspace\/|comments\/|assets\/|unused files\/)/i;
//# sourceMappingURL=layout.js.map