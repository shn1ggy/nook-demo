// Gallery: entries as cards with a cover image – the first image on the entry's page, or an
// image from a Files & media property – as in Notion's gallery view.
import { ruleColors } from '../workspace.js';
import { h, COLORS, IMAGE_RE } from '../util.js';
import { mediaInBody } from '../format/page.js';
import { plainText } from '../format/inline.js';
import { entryIcon, renderValue, titleEl } from './cells.js';
import { rowMenu } from './rowmenu.js';
import { reorderable, selectable } from './rowselect.js';
import { loadMoreBar } from './view.js';
import { dropTarget, renameByPrompt } from './fileview.js';
/** the picture a card shows, or null */
function coverOf(env, row) {
    const { db, view } = env;
    const mode = view.cover ?? 'content';
    if (mode === 'none')
        return null;
    // a database of files: the picture itself
    if (row.rel != null)
        return !row.isDir && row.file && IMAGE_RE.test(row.file) ? row.file : null;
    if (mode !== 'content') {
        const v = row.values[mode];
        const list = Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
        return list.find((f) => IMAGE_RE.test(f) || /^https?:.*\.(png|jpe?g|gif|webp)/i.test(f)) ?? null;
    }
    // the first picture on the page (any block, also inside columns or toggles)
    if (row.body.includes('](') || row.body.includes('src=')) {
        const m = mediaInBody(row.body).find((x) => x.type === 'image' || (x.type === 'file' && IMAGE_RE.test(x.src)));
        if (m)
            return m.src;
    }
    // no picture on the page: the first image file in any files property
    for (const p of db.schema.properties)
        if (p.type === 'files') {
            const v = row.values[p.name];
            const f = (Array.isArray(v) ? v : []).map(String).find((x) => IMAGE_RE.test(x));
            if (f)
                return f;
        }
    return null;
}
export function renderGallery(env, res) {
    const { db, view, ctx } = env;
    const props = (view.props ?? db.schema.properties.map((p) => p.name)).filter((p) => p !== db.titleProp).slice(0, 5);
    const mkGrid = () => { const g = h('div', { class: `gallery size-${view.cardSize ?? 'm'}${view.fitImage ? ' fit' : ''}${view.wrapCards ? ' wrap' : ''}` }); g.style.setProperty('--g-ratio', (view.coverShape ?? '16:9').replace(':', ' / ')); return g; };
    let grid = mkGrid();
    const rows = res.groups ? res.groups.flatMap((g) => g.rows) : res.rows;
    const lim = env.state.limit || 100;
    // grouped: one heading and grid per group
    const out = res.groups?.length ? h('div', { class: 'gallery-groups' }) : null;
    const groupOf = new Map();
    if (res.groups)
        for (const g of res.groups)
            for (const r of g.rows)
                groupOf.set(r, g.key);
    let curGroup = null;
    for (const r of rows.slice(0, lim)) {
        if (out && groupOf.get(r) !== curGroup) {
            curGroup = groupOf.get(r) ?? '';
            const n = rows.filter((x) => groupOf.get(x) === curGroup).length;
            grid = mkGrid();
            out.append(h('div', { class: 'g-group-head' }, h('span', null, curGroup || 'No value'), h('span', { class: 'g-count' }, String(n))), grid);
        }
        const src = coverOf(env, r);
        const cover = h('div', { class: 'g-cover' + (src ? '' : ' empty') });
        if (src) {
            const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
            (/^(https?:|data:|blob:)/.test(src) ? Promise.resolve(src) : ctx.assetUrl(src)).then((u) => { img.src = u; }).catch(() => cover.classList.add('empty'));
            cover.appendChild(img);
        }
        else if (r.rel != null) {
            cover.classList.add('fdb-cover');
            const ic = entryIcon(r, 34);
            if (ic)
                cover.appendChild(ic);
        }
        else if (r.body.trim()) {
            // no picture: a preview of the page's first lines, like Notion
            cover.appendChild(h('div', { class: 'g-text' }, plainText(r.body.replace(/<[^>]+>/g, '').replace(/^[#>\-*\s[\]x]+/gm, '')).slice(0, 220)));
        }
        if (view.cover === 'none')
            cover.style.display = 'none';
        const card = h('div', { class: 'g-card', tabindex: 0 }, cover, h('div', { class: 'g-body' }, h('div', { class: 'g-title' }, !view.hideIcons ? entryIcon(r, 15) : null, titleEl(db, r)), props.map((p) => { const v = db.value(r, p); return v == null || v === '' || (Array.isArray(v) && !v.length) ? null : h('div', { class: 'g-prop' }, renderValue(db, db.prop(p), v)); })));
        const tint = ruleColors(db, view, r).row ?? (view.colorBy ? (() => { const cv = db.value(r, view.colorBy); return typeof cv === 'string' && cv ? db.optionColor(view.colorBy, cv) : undefined; })() : undefined);
        if (tint)
            card.style.setProperty('background', COLORS[tint]?.bg ?? '');
        selectable(card, env, r);
        reorderable(card, env, r);
        if (r.isDir)
            dropTarget(ctx, db, card, r.rel);
        if (r.rel != null)
            card.addEventListener('nook-rename', () => renameByPrompt(ctx, db, r, card));
        card.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); rowMenu(ctx, db, r, { x: e.clientX, y: e.clientY }, () => env.redraw()); });
        grid.appendChild(card);
    }
    const newCard = () => h('button', { class: 'g-card g-new', onclick: () => env.newRow({}, true) }, '+ New');
    if ((env.fullPage || !view.simplified) && view.newAt)
        grid.insertBefore(newCard(), grid.firstChild);
    if ((env.fullPage || !view.simplified) && view.newAt !== 'top')
        grid.appendChild(newCard());
    const body = out ?? grid;
    if (rows.length > lim)
        return h('div', null, body, loadMoreBar(env, rows.length, lim));
    return body;
}
//# sourceMappingURL=gallery.js.map