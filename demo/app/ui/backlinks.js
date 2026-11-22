import { walkBlocks } from '../workspace.js';
import { parsePage } from '../format/page.js';
import { plainText } from '../format/inline.js';
import { rowTarget } from '../links.js';
import { h, svgIcon, ICONS } from '../util.js';
import { renderIcon } from './icons.js';
/** a short line around the link: the text of the block that holds it */
const snippetOf = (b, id) => {
    if (b.type === 'pagelink')
        return '';
    const raw = b.text ?? '';
    const text = plainText(raw).replace(/\s+/g, ' ').trim();
    if (!text)
        return '';
    // centre the cut on the link's label
    const m = raw.match(new RegExp(`\\[([^\\]]+)\\]\\(nook:[^)]*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    const at = m ? text.indexOf(m[1]) : 0;
    const from = Math.max(0, at - 50);
    return (from > 0 ? '… ' : '') + text.slice(from, from + 130) + (text.length > from + 130 ? ' …' : '');
};
/** every page and entry whose content mentions `target` (a page id, or row:db:id for an entry) */
function findBacklinks(ws, target, self) {
    // an entry is linked as row:db:id (with the parts encoded) – look for its plain id as well
    const m = target.match(/^row:[^:]+:(.+)$/);
    const needle = m ? decodeURIComponent(m[1]) : target;
    // a database also counts as linked from every page that shows it (an embedded view)
    const dbKey = target.startsWith('db:') ? target.slice(3) : null;
    const out = [];
    const hit = (blocks) => {
        let found = null;
        walkBlocks(blocks, (b) => {
            if (found !== null)
                return;
            if (dbKey && b.type === 'view' && b.db === dbKey) {
                found = 'Shows this database';
                return;
            }
            const own = JSON.stringify({ ...b, children: undefined });
            if (own.includes(needle))
                found = snippetOf(b, needle);
        });
        return found;
    };
    for (const p of ws.pages.values()) {
        if (p.id === self.page)
            continue;
        // a page's own parent lists it as a subpage: that is not a link
        const s = hit(p.blocks.filter((b) => !(b.type === 'pagelink' && b.target === target && ws.pages.get(target)?.parent === p.id)));
        if (s !== null)
            out.push({ kind: 'page', page: p, snippet: s });
    }
    for (const db of ws.dbs.values())
        for (const r of db.rows) {
            if (!r.body || r.id === self.row || (!r.body.includes(needle) && !(dbKey && r.body.includes(dbKey))))
                continue;
            const s = hit(parsePage(r.body));
            if (s !== null)
                out.push({ kind: 'row', db, row: r, snippet: s });
        }
    return out.sort((a, b) => label(a).localeCompare(label(b)));
}
const label = (b) => b.kind === 'page' ? b.page.title || 'Untitled' : b.db.rowLabel(b.row);
/** the "Backlinks" section; empty (nothing rendered) when no page links here or it is switched off */
export function backlinksSection(ws, target, self, mode, open) {
    const box = h('div', { class: 'backlinks' });
    if (mode === 'off')
        return box;
    // looked up after the page has drawn (it reads every page and entry)
    const fill = () => {
        const list = findBacklinks(ws, target, self);
        if (!list.length)
            return;
        let shown = mode === 'expanded';
        const items = h('div', { class: 'bl-items' });
        const head = h('button', { class: 'bl-head', 'aria-expanded': String(shown), onclick: () => { shown = !shown; draw(); } }, h('span', { class: 'bl-tri' }, svgIcon(ICONS.chevronR, 12)), `${list.length} backlink${list.length === 1 ? '' : 's'}`);
        const draw = () => {
            head.setAttribute('aria-expanded', String(shown));
            box.classList.toggle('open', shown);
            items.replaceChildren(...(shown ? list.map((b) => {
                const el = h('button', { class: 'bl-item', onclick: () => b.kind === 'page' ? open.page(b.page.id) : open.row(b.db, b.row) }, h('span', { class: 'bl-title' }, b.kind === 'page' ? renderIcon(b.page.icon, 15, 'file') : renderIcon(b.row.icon ?? b.db.schema.icon, 15, 'database'), h('span', null, label(b)), b.kind === 'row' ? h('span', { class: 'bl-db' }, b.db.schema.name) : null), b.snippet ? h('span', { class: 'bl-snip' }, b.snippet) : null);
                open.linkTo(el, b.kind === 'page' ? b.page.id : rowTarget(b.db.key, b.row.id));
                return el;
            }) : []));
        };
        box.append(head, items);
        draw();
    };
    (window.requestIdleCallback ?? ((f) => setTimeout(f, 30)))(() => fill());
    return box;
}
//# sourceMappingURL=backlinks.js.map