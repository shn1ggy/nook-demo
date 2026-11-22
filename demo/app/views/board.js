// Board: one column per option of the group property; drag cards between columns.
import { countRoots, ruleColors, takeRoots } from '../workspace.js';
import { h, svgIcon, ICONS, tintVars } from '../util.js';
import { menu, prompt } from '../ui/pop.js';
import { renameOption, singleOptionEntries } from './propmenu.js';
import { entryIcon, moveOption, renderValue, tag, titleEl } from './cells.js';
import { rowMenu } from './rowmenu.js';
import { dragRows, dropEffect, isCopyDrop, reorderable, selectable } from './rowselect.js';
/** Shared table/list group controls, including editable option labels. */
/** whether a group of a list, table or compact calendar is unfolded (saved with the view) */
/** a group's entries shown so far (50 at first, 200 more per click) – the same in lists and tables */
const groupLimit = new Map();
export function groupBatch(env, key, tree) {
    const limit = groupLimit.get(key) ?? 50;
    const t = takeRoots(tree, 0, limit);
    return { items: t.items, more: t.end < tree.length ? h('button', { class: 'loadmore', onclick: () => { groupLimit.set(key, limit + 200); env.redraw(); } }, `Show ${countRoots(tree, t.end)} more`) : null };
}
export function groupOpen(env, key) { return !(env.view.groupBy?.closed ?? []).includes(key); }
/** folds or unfolds a group and saves it, so it stays that way after a restart */
export function toggleGroupOpen(env, key) {
    const g = env.view.groupBy;
    if (!g)
        return;
    const closed = new Set(g.closed ?? []);
    if (closed.has(key))
        closed.delete(key);
    else
        closed.add(key);
    if (closed.size)
        g.closed = [...closed];
    else
        delete g.closed;
    env.saveView();
    env.redraw();
}
export function groupHeading(env, key, count, open, toggleGroup) {
    const prop = env.view.groupBy.prop;
    const def = env.db.prop(prop);
    const label = key === '' ? h('span', { class: 'muted' }, `No ${prop}`)
        : def?.type === 'select' || def?.type === 'multi_select' ? groupLabel(env, prop, key) : h('span', null, key);
    const toggle = h('button', { type: 'button', class: 'sub-toggle' + (open ? ' open' : ''),
        'aria-label': `${open ? 'Collapse' : 'Expand'} group ${key || `No ${prop}`}`,
        'aria-expanded': String(open), title: open ? 'Collapse group' : 'Expand group',
        onclick: (e) => { e.stopPropagation(); toggleGroup(); } }, h('span', { class: 'sub-tri' }));
    return [h('span', { class: 'sub-lead' }, toggle), label,
        ...(env.view.groupBy?.hideCount ? [] : [h('span', { class: 'gcount' }, String(count))])];
}
/** A group's name: click to rename it in place, right-click for colour, order and delete. */
function groupLabel(env, prop, key) {
    const { db, ctx } = env;
    const def = db.prop(prop);
    const opt = def?.options?.find((o) => o.name === key);
    const el = tag(key, db.optionColor(prop, key));
    if (!def || !opt)
        return el;
    el.classList.add('editable-tag');
    el.title = 'Click to rename · right-click for more';
    el.addEventListener('click', (e) => {
        e.stopPropagation();
        const input = h('input', { class: 'tag-edit', value: key, 'aria-label': 'Option name' });
        input.style.width = `${Math.max(60, el.offsetWidth + 24)}px`;
        el.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = async (save) => {
            if (done)
                return;
            done = true;
            if (save && input.value.trim() && input.value.trim() !== key) {
                await renameOption(ctx.ws, db, def, opt, input.value);
                ctx.ws.emit();
            }
            env.redraw();
        };
        input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') {
            ev.preventDefault();
            finish(true);
        }
        else if (ev.key === 'Escape') {
            ev.preventDefault();
            finish(false);
        } });
        input.addEventListener('blur', () => finish(true));
        input.addEventListener('click', (ev) => ev.stopPropagation());
    });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menu({ x: e.clientX, y: e.clientY }, singleOptionEntries(ctx.ws, db, def, opt, { x: e.clientX, y: e.clientY }, () => env.redraw())); });
    return el;
}
/** "⋯" next to a group name */
function groupMore(env, prop, key) {
    const def = env.db.prop(prop);
    const opt = def?.options?.find((o) => o.name === key);
    if (!def || !opt)
        return null;
    return h('button', { class: 'icon-btn bcol-more', 'aria-label': `Options for ${key}`, title: 'Rename, color, delete', onclick: (e) => { e.stopPropagation(); const a = e.currentTarget; menu(a, singleOptionEntries(env.ctx.ws, env.db, def, opt, a, () => env.redraw())); } }, svgIcon(ICONS.more, 14, { fill: true }));
}
/** cards shown per column before "Show more" (big boards stay fast, as in Notion) */
const CHUNK = 50;
const shown = new Map();
export function renderBoard(env, res) {
    const { db, view, ctx } = env;
    const gprop = view.groupBy?.prop ?? db.schema.properties.find((p) => p.type === 'select')?.name;
    if (!gprop)
        return h('div', { class: 'muted small' }, 'A board needs a select property.');
    if (!view.groupBy)
        view.groupBy = { prop: gprop, hideEmpty: false };
    const groups = res.groups ?? [];
    const cardProps = (view.props ?? []).filter((p) => p !== db.titleProp && p !== gprop).slice(0, 3);
    // sub-groups: rows across the columns (Notion's "Sub-group"); each row a board of its own below one header row
    const sprop = view.subGroupBy?.prop && db.prop(view.subGroupBy.prop) && view.subGroupBy.prop !== gprop ? view.subGroupBy.prop : undefined;
    const keysOf = (r, p) => { const v = db.value(r, p); return Array.isArray(v) ? (v.length ? v.map(String) : ['']) : typeof v === 'boolean' ? [v ? 'Yes' : 'No'] : [v == null ? '' : String(v)]; };
    const buildBoard = (sub, heads) => {
        const board = h('div', { class: 'board' + (sprop ? ' board-lane' : '') + (sprop && heads ? ' board-heads' : '') + (view.cardSize && view.cardSize !== 'm' ? ' board-' + view.cardSize : '') });
        for (const g0 of groups) {
            const g = sub ? { key: g0.key, rows: g0.rows.filter((r) => keysOf(r, sprop).includes(sub.key)) } : sprop ? { key: g0.key, rows: [] } : g0;
            const extra = sub && sub.key ? { [sprop]: db.prop(sprop)?.type === 'checkbox' ? sub.key === 'Yes' : db.prop(sprop)?.type === 'multi_select' ? [sub.key] : sub.key } : {};
            const color = g.key ? db.optionColor(gprop, g.key) : 'default';
            const col = h('div', { class: 'bcol' + (view.plainColumns ? ' plain' : color === 'default' ? ' untinted' : ' tinted'), style: {}, 'data-key': g.key }, h('div', { class: 'bcol-head' }, g.key ? groupLabel(env, gprop, g.key) : h('span', { class: 'muted' }, `No ${gprop}`), view.groupBy?.hideCount ? null : h('span', { class: 'muted small' }, String(sprop ? g0.rows.length : g.rows.length)), g.key ? groupMore(env, gprop, g.key) : null));
            if (sprop && !heads)
                col.querySelector('.bcol-head').classList.add('lane-hidden');
            if (!view.plainColumns && color !== 'default')
                tintVars(col, color);
            const limKey = `${db.key}/${view.id}/${sub ? sub.key + '/' : ''}${g.key}`;
            const lim = shown.get(limKey) ?? (view.limit || CHUNK);
            for (const r of g.rows.slice(0, lim)) {
                const card = h('div', { class: 'card', tabindex: 0 }, h('div', { class: 'ct' }, !view.hideIcons ? entryIcon(r, 15) : null, titleEl(db, r)), cardProps.map((p) => { const v = db.value(r, p); return v == null || v === '' ? null : h('div', { class: 'cp' }, renderValue(db, db.prop(p), v)); }));
                const tint = ruleColors(db, view, r).row;
                // a rule's color: the card's own tint (same look as a colored column: soft fill, outline, hover)
                if (tint) {
                    tintVars(card, tint);
                    card.classList.add('tinted');
                }
                selectable(card, env, r);
                // drop on a card: move into this column (if needed) and to this position
                reorderable(card, env, r, { onDropExtra: async (dragged) => {
                        const cur = db.value(dragged, gprop);
                        if ((cur ?? '') !== g.key || sub) {
                            ctx.ws.boundary();
                            if (g.key)
                                dragged.values[gprop] = g.key;
                            else
                                delete dragged.values[gprop];
                            if (sub) {
                                if (sub.key)
                                    Object.assign(dragged.values, extra);
                                else
                                    delete dragged.values[sprop];
                            }
                            await ctx.ws.saveRow(db, dragged);
                        }
                    } });
                card.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); rowMenu(ctx, db, r, { x: e.clientX, y: e.clientY }, () => env.redraw()); });
                col.appendChild(card);
            }
            if (g.rows.length > lim) {
                const step = view.limit || CHUNK;
                col.appendChild(h('div', { class: 'loadmore-bar' }, h('button', { class: 'loadmore', onclick: () => { shown.set(limKey, lim + step); env.redraw(); } }, `Load ${Math.min(step, g.rows.length - lim)} more`), g.rows.length - lim > step ? h('button', { class: 'loadmore', title: 'Show every entry now (the load limit stays for next time)', onclick: () => { shown.set(limKey, Infinity); env.redraw(); } }, `Load all ${g.rows.length - lim}`) : null));
            }
            const newBtn = () => h('button', { class: 'loadmore', onclick: () => env.newRow({ ...(g.key ? { [gprop]: g.key } : {}), ...extra }, true) }, '+ New');
            if (!(sprop && heads)) {
                if (view.newAt)
                    col.querySelector('.bcol-head').after(newBtn());
                if (view.newAt !== 'top')
                    col.appendChild(newBtn());
            }
            // drag a column by its header to change the order of the options (all views follow)
            const head = col.querySelector('.bcol-head');
            const gdef = db.prop(gprop);
            if (g.key && gdef?.options?.some((o) => o.name === g.key)) {
                head.draggable = true;
                head.title = 'Drag to move this group';
                head.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-nook-option', g.key); e.dataTransfer.effectAllowed = 'move'; col.classList.add('dragging'); });
                head.addEventListener('dragend', () => col.classList.remove('dragging'));
            }
            col.addEventListener('dragover', (e) => {
                if (e.dataTransfer?.types.includes('text/x-nook-option') && g.key) {
                    e.preventDefault();
                    const r = col.getBoundingClientRect();
                    col.classList.toggle('drop-left', e.clientX < r.left + r.width / 2);
                    col.classList.toggle('drop-right', e.clientX >= r.left + r.width / 2);
                }
            });
            col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget))
                col.classList.remove('drop-left', 'drop-right'); });
            col.addEventListener('drop', async (e) => {
                const from = e.dataTransfer?.getData('text/x-nook-option');
                const after = col.classList.contains('drop-right');
                col.classList.remove('drop-left', 'drop-right');
                if (!from || !gdef || !g.key)
                    return;
                e.preventDefault();
                await moveOption(ctx.ws, db, gdef, from, g.key, after);
                env.redraw();
            });
            col.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('text/x-nook-row')) {
                e.preventDefault();
                dropEffect(e);
                col.classList.add('drop');
            } });
            col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget))
                col.classList.remove('drop'); });
            col.addEventListener('drop', async (e) => {
                col.classList.remove('drop');
                const row = db.rows.find((x) => x.id === e.dataTransfer?.getData('text/x-nook-row'));
                if (!row)
                    return;
                e.preventDefault();
                ctx.ws.boundary();
                // the whole selection moves along; with Alt the entries are copied into this column
                const copy = isCopyDrop(e);
                for (const r0 of dragRows(env, row)) {
                    const r = copy ? await ctx.ws.duplicateRow(db, r0) : r0;
                    if (g.key)
                        r.values[gprop] = g.key;
                    else
                        delete r.values[gprop];
                    if (sub) {
                        if (sub.key)
                            Object.assign(r.values, extra);
                        else
                            delete r.values[sprop];
                    }
                    await ctx.ws.saveRow(db, r);
                }
                env.redraw();
            });
            board.appendChild(col);
        }
        if (sprop && !heads)
            return board;
        // as in Notion: add another group (a new option of the grouping property)
        const def = db.prop(gprop);
        if (def && (def.type === 'select' || def.type === 'multi_select')) {
            board.appendChild(h('button', { class: 'bcol-add', onclick: (e) => prompt(e.currentTarget, `New ${gprop} option`, '', async (name) => {
                    name = name.trim();
                    if (!name || def.options?.some((o) => o.name === name))
                        return;
                    (def.options ??= []).push({ name, color: ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'][(def.options.length) % 9] });
                    if (view.groupBy)
                        view.groupBy.hideEmpty = false;
                    ctx.ws.boundary();
                    await ctx.ws.saveSchema(db);
                    env.saveView();
                    env.redraw();
                }) }, '+ Add a group'));
        }
        // ⋯ at the end of the columns: which properties the cards show
        if (env.openSettings)
            board.appendChild(h('button', { class: 'th-tool board-props', title: 'Show and hide properties', 'aria-label': 'Show and hide properties', onclick: (e) => env.openSettings(e.currentTarget, 'properties') }, svgIcon(ICONS.more, 16, { fill: true })));
        return board;
    };
    if (!sprop)
        return buildBoard(null, true);
    // header row, then one foldable row per sub-group (in the option order; "No …" last)
    const sdef = db.prop(sprop);
    const subKeys = sdef.type === 'checkbox' ? ['Yes', 'No'] : [...(sdef.options ?? []).map((o) => o.name), ''];
    const all = groups.flatMap((g) => g.rows);
    const wrap = h('div', { class: 'board-subwrap' }, buildBoard(null, true));
    const closed = new Set(view.subGroupBy.closed ?? []);
    for (const k of subKeys) {
        const n = new Set(all.filter((r) => keysOf(r, sprop).includes(k)).map((r) => r.id)).size;
        if (!n && view.subGroupBy.hideEmpty !== false)
            continue;
        const open = !closed.has(k);
        const toggle = () => { if (open)
            closed.add(k);
        else
            closed.delete(k); view.subGroupBy.closed = [...closed]; env.saveView(); env.redraw(); };
        wrap.appendChild(h('div', { class: 'lane-head' }, 
        // the same triangle as group headings (size, turn, hover)
        h('span', { class: 'sub-lead' }, h('button', { type: 'button', class: 'sub-toggle' + (open ? ' open' : ''), 'aria-label': `${open ? 'Collapse' : 'Expand'} ${k || `No ${sprop}`}`, 'aria-expanded': String(open), title: open ? 'Collapse group' : 'Expand group', onclick: (e) => { e.stopPropagation(); toggle(); } }, h('span', { class: 'sub-tri' }))), k ? (sdef.type === 'checkbox' ? h('span', null, `${sprop}: ${k}`) : groupLabel(env, sprop, k)) : h('span', { class: 'muted' }, `No ${sprop}`), view.groupBy?.hideCount ? null : h('span', { class: 'gcount' }, String(n))));
        if (open)
            wrap.appendChild(buildBoard({ key: k }, false));
    }
    // the rows are exactly as wide as what they show: nothing invisible can widen the scroll area
    const fit = () => {
        if (!wrap.isConnected)
            return;
        const origin = wrap.getBoundingClientRect().left - wrap.scrollLeft;
        let right = 0;
        wrap.querySelectorAll(':scope > .board > .bcol, :scope > .board > .bcol-add, :scope > .board > .board-props').forEach((e) => { right = Math.max(right, e.getBoundingClientRect().right - origin); });
        if (!right)
            return;
        const w = Math.ceil(right) + 4;
        wrap.querySelectorAll(':scope > .board').forEach((b) => { b.style.minWidth = '0'; b.style.width = `${w}px`; });
    };
    requestAnimationFrame(() => requestAnimationFrame(fit));
    return wrap;
}
/** Boosts HSL saturation (×1.75) and lightness (+5) of a hex colour (board tints). Non-hex values pass through. */
//# sourceMappingURL=board.js.map