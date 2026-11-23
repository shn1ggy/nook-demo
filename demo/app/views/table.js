import { rowTarget } from '../links.js';
// Table view: inline editing, resizable columns, grouping with sums, column totals,
// keyboard navigation, and incremental rendering for large databases.
import { dropTarget } from './fileview.js';
import { aggregate, countRoots, nestRows, ruleColors, takeRoots } from '../workspace.js';
import { stepsOf, COLORS, fmtNumber, h, svgIcon, ICONS } from '../util.js';
import { rowMenu } from './rowmenu.js';
import { gripEl, groupDrop, reorderable, selectable, isRowSelected, selectAll, subOpen, toggleSub } from './rowselect.js';
import { menu, closePop, menuIcon } from '../ui/pop.js';
import { editValue, entryIcon, renderValue, titleEl, typeIcon } from './cells.js';
import { filterOpsFor } from './view.js';
import { addPropertyMenu, propertyEntries } from './propmenu.js';
import { groupBatch, groupHeading, groupOpen, toggleGroupOpen } from './board.js';
/** rows shown per group (grows with "show more") */
/** Initial widths for fixed columns; fill columns use the available space instead. */
const DEFAULT_W = { title: 260, date: 120, number: 110, checkbox: 80, select: 150, formula: 110, text: 200 };
/**
 * On a phone a table shows as cards: the name on top, below it the table's shown properties in
 * column order (whatever this database is for – nothing is guessed), tinted like the rows.
 */
function renderCards(env, res) {
    const { db, view, ctx } = env;
    const props = (view.props ?? db.schema.properties.map((p) => p.name)).filter((n) => n !== db.dateLabel && (n !== db.titleProp || (db.dateLabel && db.schema.showNameWithDate)) && db.prop(n));
    const box = h('div', { class: 't-cards' });
    const lim = env.state.limit || 100;
    const card = (r, gkey) => {
        const vals = props.map((p) => { const v = db.value(r, p); return v == null || v === '' || (Array.isArray(v) && !v.length) || v === false ? null : h('span', { class: 'tc-val' }, renderValue(db, db.prop(p), v)); }).filter(Boolean);
        const el = h('div', { class: 't-card', tabindex: 0, oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); rowMenu(ctx, db, r, { x: e.clientX, y: e.clientY }, () => env.redraw()); } }, h('div', { class: 'tc-title' }, !view.hideIcons ? entryIcon(r, 15) : null, titleEl(db, r)), vals.length ? h('div', { class: 'tc-props' }, vals) : null);
        const tint = ruleColors(db, view, r).row ?? (view.colorBy ? (() => { const cv = db.value(r, view.colorBy); return typeof cv === 'string' && cv ? db.optionColor(view.colorBy, cv) : undefined; })() : undefined);
        if (tint && tint !== 'default')
            el.style.setProperty('background', stepsOf(tint).soft);
        selectable(el, env, r);
        reorderable(el, env, r, { onDropExtra: groupDrop(env, gkey) });
        return el;
    };
    const groups = res.groups ?? [{ key: '', rows: res.rows }];
    for (const g of groups) {
        if (res.groups) {
            const open = groupOpen(env, g.key);
            const toggle = () => toggleGroupOpen(env, g.key);
            box.appendChild(h('div', { class: 'list-group-head', onclick: toggle }, ...groupHeading(env, g.key, g.rows.length, open, toggle)));
            if (!open)
                continue;
        }
        for (const r of g.rows.slice(0, lim))
            box.appendChild(card(r, res.groups ? g.key : undefined));
    }
    box.appendChild(h('button', { class: 'list-new t-cards-new', onclick: () => env.newRow({}, true) }, '+ New'));
    return box;
}
export function renderTable(env, res) {
    if (document.documentElement.classList.contains('phone'))
        return renderCards(env, res);
    const { db, view, state, ctx } = env;
    const props = db.tableProperties(view).map((n) => db.prop(n));
    const table = h('table', { class: 'grid' + (view.colLines ? ' col-lines' : '') + (view.groupBy ? ' grouped' : ''), tabindex: 0 });
    // Fixed columns retain their saved widths; fill columns share the remaining space.
    const MIN = 48;
    const widthOf = (p) => view.widths?.[p.name] ?? DEFAULT_W[p.type] ?? 160;
    // Saved widths are restored when switching back to Fixed, but must not prevent
    // fill columns from shrinking on a narrower screen.
    const fill = new Set((view.fill ?? []).filter((n) => props.some((p) => p.name === n)));
    const widths = props.map(widthOf);
    const cg = h('colgroup');
    cg.appendChild(h('col', { class: 'col-grip' }));
    const cols = props.map((p, i) => h('col', fill.has(p.name) ? { class: 'col-fill' } : { style: { width: `${widths[i]}px` } }));
    cg.append(...cols);
    cg.appendChild(h('col', { style: { width: '60px' } }));
    table.appendChild(cg);
    const sizeTable = () => {
        // Only fixed widths constrain the table; reserve a usable minimum for each fill column.
        const px = 60 + widths.reduce((sum, w, i) => sum + (fill.has(props[i].name) ? MIN : w), 0);
        if (fill.size) {
            table.style.width = '100%';
            table.style.minWidth = `calc(var(--bleed) + ${px}px)`;
            table.classList.add('fills');
        }
        else
            table.style.width = `calc(var(--bleed) + ${px}px)`;
    };
    sizeTable();
    // ----- header -----
    const tr = h('tr');
    tr.appendChild(h('th', { class: 'th-grip' }));
    props.forEach((p, i) => {
        const th = h('th', { class: alignClass(view, p), title: p.formula ? `= ${p.formula}` : p.name, draggable: true }, typeIcon(p.type, p.icon), h('span', { class: 'th-name' }, p.name));
        // drag a column header onto another to move the column there (this view's order)
        th.addEventListener('dragstart', (e) => { if (e.target.closest('.resizer')) {
            e.preventDefault();
            return;
        } e.dataTransfer.setData('text/x-nook-col', p.name); e.dataTransfer.effectAllowed = 'move'; th.classList.add('col-dragging'); });
        th.addEventListener('dragend', () => { th.classList.remove('col-dragging'); table.querySelectorAll('.col-drop-l, .col-drop-r').forEach((x) => x.classList.remove('col-drop-l', 'col-drop-r')); });
        th.addEventListener('dragover', (e) => {
            if (!e.dataTransfer?.types.includes('text/x-nook-col'))
                return;
            e.preventDefault();
            const r = th.getBoundingClientRect();
            const right = e.clientX > r.left + r.width / 2;
            table.querySelectorAll('.col-drop-l, .col-drop-r').forEach((x) => x !== th && x.classList.remove('col-drop-l', 'col-drop-r'));
            th.classList.toggle('col-drop-r', right);
            th.classList.toggle('col-drop-l', !right);
        });
        th.addEventListener('dragleave', () => th.classList.remove('col-drop-l', 'col-drop-r'));
        th.addEventListener('drop', (e) => {
            const from = e.dataTransfer?.getData('text/x-nook-col');
            const right = th.classList.contains('col-drop-r');
            th.classList.remove('col-drop-l', 'col-drop-r');
            if (!from || from === p.name)
                return;
            e.preventDefault();
            const order = (view.props ?? db.schema.properties.map((x) => x.name)).filter((n) => n !== from);
            order.splice(order.indexOf(p.name) + (right ? 1 : 0), 0, from);
            view.props = order;
            env.saveView();
            env.redraw();
        });
        th.addEventListener('click', () => columnMenu(env, p, th));
        th.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); columnMenu(env, p, th); });
        const rz = h('span', { class: 'resizer' });
        // a filling column is sized by the column to its right: dragging its edge resizes that one
        const fixedAt = (k) => k < props.length && !fill.has(props[k].name);
        const target = fill.has(p.name) ? (fixedAt(i + 1) ? i + 1 : -1) : i;
        const dir = target === i ? 1 : -1;
        if (target < 0)
            rz.classList.add('off');
        rz.title = target < 0 ? 'Fills the remaining width' : target === i ? 'Drag to resize · double-click to fit' : 'Drag to resize (the next column changes)';
        const setW = (k, w) => { widths[k] = w; cols[k].style.width = `${w}px`; sizeTable(); };
        const store = (k, w) => { (view.widths ??= {})[props[k].name] = Math.round(w); env.saveView(); };
        rz.addEventListener('click', (e) => e.stopPropagation());
        // the line runs down the whole table while hovering / dragging
        rz.addEventListener('mouseenter', () => { rz.style.height = `${table.offsetHeight}px`; });
        rz.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || target < 0)
                return;
            e.preventDefault();
            e.stopPropagation();
            const w0 = widths[target], x0 = e.clientX;
            let w = w0;
            table.classList.add('resizing');
            rz.classList.add('active');
            rz.style.height = `${table.offsetHeight}px`;
            const move = (ev) => { w = Math.max(MIN, Math.round(w0 + dir * (ev.clientX - x0))); setW(target, w); };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                table.classList.remove('resizing');
                rz.classList.remove('active');
                if (w !== w0)
                    store(target, w);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
        // double-click: as wide as the widest content of the column
        rz.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const idx = i + 1;
            let need = th.querySelector('.th-name').scrollWidth + 44;
            table.querySelectorAll('tbody tr.row').forEach((r) => {
                const td = r.children[idx];
                if (!td)
                    return;
                const clone = td.cloneNode(true);
                clone.style.cssText = 'position:absolute;visibility:hidden;width:auto;white-space:nowrap;max-width:none;';
                document.body.appendChild(clone);
                need = Math.max(need, clone.scrollWidth + 4);
                clone.remove();
            });
            if (target !== i)
                return;
            const w = Math.min(640, Math.max(MIN, need));
            setW(i, w);
            store(i, w);
        });
        th.appendChild(rz);
        tr.appendChild(th);
    });
    // + adds a property, ⋯ shows and hides them (the view's property list)
    tr.appendChild(h('th', { class: 'th-add' }, h('span', { class: 'th-tools' }, h('button', { class: 'th-tool', title: 'Add property', 'aria-label': 'Add property', onclick: (e) => addProperty(env, e.currentTarget) }, svgIcon(ICONS.plus, 14)), env.openSettings ? h('button', { class: 'th-tool', title: 'Show and hide properties', 'aria-label': 'Show and hide properties', onclick: (e) => env.openSettings(e.currentTarget, 'properties') }, svgIcon(ICONS.more, 15, { fill: true })) : null)));
    table.appendChild(h('thead', null, tr));
    // ----- body -----
    const tbody = h('tbody');
    table.appendChild(tbody);
    const colorBy = view.colorBy;
    let rendered = 0;
    let loadBar = null;
    const limit = state.limit || 100; // shown now
    const chunk = view.limit || 100; // "Load more" adds this many
    // sub-items: each entry followed by its sub-items (open ones), indented under it
    const sub = db.schema.subItems || db.schema.files;
    /** a database of files: when each name was last clicked (a slow second click renames) */
    const fileClick = new Map();
    let renameTimer;
    const info = new Map();
    const tree = (rows) => { const t = nestRows(db, rows, (id, ghost) => subOpen(`${db.key}:${id}`, ghost), true); for (const n of t)
        if (!n.add)
            info.set(n.row.id, n); return t; };
    const subToggle = (row) => {
        if (!sub)
            return null;
        const n = info.get(row.id) ?? { row, depth: 0, kids: 0 };
        const key = `${db.key}:${row.id}`;
        const open = subOpen(key, !!n.ghost);
        const pad = h('span', { class: 'sub-indent', style: { width: `${n.depth * 24}px` } });
        const btn = n.kids
            ? h('button', { class: 'sub-toggle' + (open ? ' open' : ''), 'aria-label': db.schema.files ? (open ? 'Close folder' : `Show ${n.kids} items`) : open ? 'Hide sub-items' : `Show ${n.kids} sub-items`, title: db.schema.files ? (open ? 'Close folder' : `${n.kids} item${n.kids === 1 ? '' : 's'}`) : open ? 'Hide sub-items' : `${n.kids} sub-item${n.kids === 1 ? '' : 's'}`, onclick: (e) => { e.stopPropagation(); toggleSub(key, !!n.ghost); env.redraw(); } }, h('span', { class: 'sub-tri' }))
            : h('span', { class: 'sub-toggle none' });
        return h('span', { class: 'sub-lead' }, pad, btn);
    };
    /** "+ New sub-item" below the sub-items of an open entry */
    const addSubEl = (it) => h('tr', { class: 'newrow sub-add', onclick: async (e) => {
            if (!e.target.closest('td.title'))
                return;
            ctx.ws.boundary();
            const c = await ctx.ws.addSubItem(db, it.row);
            env.redraw();
            if (c)
                ctx.openRow(db, c, { isNew: true });
        } }, h('td'), ...props.map((pp) => h('td', { class: pp.name === db.labelProp ? 'title' : '' }, pp.name === db.labelProp ? [h('span', { class: 'sub-indent', style: { width: `${it.depth * 24 + 20}px` } }), '+ New sub-item'] : null)), h('td'));
    const itemEl = (it) => (it.add ? addSubEl(it) : rowEl(it.row));
    const rowEl = (row) => {
        const r = h('tr', { class: 'row' + ((info.get(row.id)?.depth ?? 0) > 0 ? ' sub-row' : '') + (info.get(row.id)?.ghost ? ' ghost-row' : ''), 'data-id': row.id, 'data-row': row.id });
        const grip = gripEl();
        const gtd = h('td', { class: 'td-grip' }, grip);
        selectable(grip, env, row);
        // middle-click on the row: the entry in a new tab
        r.addEventListener('mousedown', (e) => { if (e.button === 1)
            e.preventDefault(); });
        r.addEventListener('auxclick', (e) => {
            if (e.button !== 1 || e.target.closest('a, input, textarea'))
                return;
            const u = ctx.pageUrl?.(rowTarget(db.key, row.id));
            if (u) {
                e.preventDefault();
                window.open(u, '_blank');
            }
        });
        reorderable(r, env, row, { handle: grip, nest: true });
        if (row.isDir)
            dropTarget(ctx, db, r, row.rel);
        r.appendChild(gtd);
        if (isRowSelected(env, row.id))
            r.classList.add('is-selected');
        // the colour goes on the cells, not the row: the grip column (outside the table's edge) stays clear
        const rc = ruleColors(db, view, row);
        const cv = colorBy ? db.value(row, colorBy) : null;
        const rowColor = rc.row ?? (typeof cv === 'string' && cv ? db.optionColor(colorBy, cv) : undefined);
        if (rowColor && rowColor !== 'default') {
            r.classList.add('tinted');
            r.style.setProperty('--row-bg', stepsOf(rowColor).faint);
        }
        for (const p of props) {
            const v = db.value(row, p.name);
            const td = h('td', { class: (p.name === db.labelProp ? 'title ' : '') + alignClass(view, p) + (view.wrap?.includes(p.name) ? ' wrap' : ''), 'data-prop': p.name });
            if (p.type === 'formula' && db.formulaError(p.name)) {
                td.classList.add('err');
                td.textContent = '⚠';
                td.title = db.formulaError(p.name);
            }
            else {
                if (p.name === db.labelProp) {
                    const lead = subToggle(row);
                    if (lead)
                        td.append(lead);
                }
                if (p.name === db.labelProp && !view.hideIcons) {
                    const ic = entryIcon(row, 15);
                    if (ic)
                        td.append(ic, ' ');
                }
                if (p.name === db.labelProp && !db.dateLabel && !String(v ?? '').trim())
                    td.append(titleEl(db, row));
                else
                    td.append(renderValue(db, p, v));
            }
            const cc = rc.cells?.[p.name];
            if (cc) {
                td.classList.add('cell-tint');
                td.style.setProperty('--cell-bg', COLORS[cc]?.bg ?? 'transparent');
            }
            if (p.name === db.labelProp)
                td.appendChild(h('button', { class: 'open-btn', onclick: (e) => { e.stopPropagation(); ctx.openRow(db, row); } }, 'Open'));
            // ⇧ / ⌘ / Ctrl-click selects rows (handled by the row); a plain click edits the cell
            // a database of files, the name: a click selects, a double-click opens, a slow second click renames (as in a file manager)
            if (db.schema.files && p.name === db.labelProp) {
                td.addEventListener('click', (e) => {
                    if (td.querySelector('.cell-edit') || e.target.closest('button'))
                        return;
                    e.stopPropagation();
                    if (e.shiftKey || e.metaKey || e.ctrlKey) {
                        grip.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }));
                        return;
                    }
                    const now = Date.now(), last = fileClick.get(row.id) ?? 0;
                    if (isRowSelected(env, row.id) && now - last > 500 && now - last < 4000) {
                        clearTimeout(renameTimer);
                        renameTimer = setTimeout(() => startEdit(td, row, p), 450);
                        fileClick.set(row.id, 0);
                        return;
                    }
                    // the frame of a name just renamed goes (only the selection shows)
                    table.querySelectorAll('td.sel').forEach((x) => x.classList.remove('sel'));
                    grip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    fileClick.set(row.id, now);
                });
                td.addEventListener('dblclick', () => { clearTimeout(renameTimer); if (td.querySelector('.cell-edit'))
                    return; ctx.openRow(db, row); });
                td.addEventListener('nook-rename', (e) => { e.stopPropagation(); if (!td.querySelector('.cell-edit'))
                    startEdit(td, row, p); });
                r.appendChild(td);
                continue;
            }
            td.addEventListener('click', (e) => { if (td.querySelector('.cell-edit'))
                return; if (e.shiftKey || e.metaKey || e.ctrlKey) {
                grip.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }));
                return;
            } startEdit(td, row, p); });
            td.addEventListener('dblclick', () => { if (td.querySelector('.cell-edit'))
                return; if (p.name === db.labelProp)
                ctx.openRow(db, row); });
            r.appendChild(td);
        }
        r.appendChild(h('td'));
        r.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); rowMenu(ctx, db, row, { x: e.clientX, y: e.clientY }, () => env.redraw()); });
        return r;
    };
    const startEdit = (td, row, p, initial) => {
        table.querySelectorAll('td.sel').forEach((x) => x.classList.remove('sel'));
        td.classList.add('sel');
        editValue(ctx.ws, db, row, p.name, td, () => {
            // a value the view sorts, filters or groups by: draw the view again so the entry moves to
            // its place right away; the selected cell comes along (and the keys stay with the table)
            const affects = view.sorts?.some((x) => x.prop === p.name) || view.groupBy?.prop === p.name || JSON.stringify(view.filter ?? '').includes(JSON.stringify(p.name)) || view.period?.prop === p.name;
            if (affects) {
                if (!db.schema.files)
                    state.cell = { row: row.id, prop: p.name };
                env.redraw();
                return;
            }
            // otherwise: update just this row in place (keeps scroll and selection); found by its id, since a
            // picker that saves while open (dates) may call this several times
            const fresh = rowEl(row);
            (table.querySelector(`tr.row[data-id="${CSS.escape(row.id)}"]`) ?? td.closest('tr'))?.replaceWith(fresh);
            updateFooter();
            // a database of files: after a rename the file stays selected as a whole (arrows go on from it), no cell frame
            if (db.schema.files) {
                table.querySelectorAll('td.sel').forEach((x) => x.classList.remove('sel'));
                fresh.querySelector('.td-grip .grip, .td-grip > *')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                return;
            }
            fresh.querySelector(`td[data-prop="${CSS.escape(p.name)}"]`)?.classList.add('sel');
            // the keys stay with the table (arrows, Enter, Tab, typing)
            if (!document.querySelector('.pop:not(.pop-closing)'))
                table.focus({ preventScroll: true });
        }, { initial, onMove: (d) => { const t = liveTable(); if (t === table)
                moveSel(d);
            else
                t?.dispatchEvent(new CustomEvent('nook-move', { detail: d })); } });
    };
    /** after a redraw the view has a new table: the one on the page now */
    const liveTable = () => (table.isConnected ? table : document.querySelector(`.grid[data-view="${CSS.escape(view.id)}"]`));
    table.dataset.view = view.id;
    let pendingMove = null;
    table.addEventListener('nook-move', (e) => { const d = e.detail; if (table.querySelector('td.sel'))
        moveSel(d);
    else
        pendingMove = d; });
    // a cell that was selected before a redraw is selected again
    if (state.cell) {
        const want = state.cell;
        delete state.cell;
        requestAnimationFrame(() => {
            const td = table.querySelector(`tr.row[data-id="${CSS.escape(want.row)}"] td[data-prop="${CSS.escape(want.prop)}"]`);
            if (!td)
                return;
            td.classList.add('sel');
            td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            if (!document.querySelector('.pop:not(.pop-closing)'))
                table.focus({ preventScroll: true });
            if (pendingMove) {
                const d = pendingMove;
                pendingMove = null;
                moveSel(d);
            }
        });
    }
    /** spreadsheet moves: ↵ down, ⇥ right (to the next row at the end), ⇧ the other way */
    const moveSel = (d) => {
        const sel = table.querySelector('td.sel');
        if (!sel)
            return;
        const tr = sel.parentElement;
        const cells = (r) => (r ? [...r.children].filter((c) => c.dataset.prop) : []);
        const idx = [...tr.children].indexOf(sel);
        let target;
        if (d === 'down' || d === 'up')
            target = nextRow(tr, d === 'down' ? 1 : -1)?.children[idx];
        else {
            const row = cells(tr);
            const i = row.indexOf(sel);
            target = d === 'right' ? row[i + 1] ?? cells(nextRow(tr, 1))[0] : row[i - 1] ?? cells(nextRow(tr, -1)).slice(-1)[0];
        }
        if (!target?.dataset.prop)
            return;
        sel.classList.remove('sel');
        target.classList.add('sel');
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        table.focus({ preventScroll: true });
    };
    const sums = (rows) => {
        const parts = [];
        for (const p of props) {
            const agg = view.aggregates?.[p.name];
            if (!agg || agg === 'none' || agg === 'count')
                continue;
            const v = aggregate(db, rows, p.name, agg);
            if (v != null)
                parts.push(h('span', { class: 'gsum' }, `${p.name}: ${fmtNumber(v, numFormat(p))}`));
        }
        return parts;
    };
    if (res.groups) {
        for (const g of res.groups) {
            const key = `${view.id}:${g.key}`;
            const open = groupOpen(env, g.key);
            const toggleGroup = () => toggleGroupOpen(env, g.key);
            const head = h('tr', { class: 'group', onclick: toggleGroup }, 
            // the grip column stays empty, so the group's line starts where the rows do
            h('td', { class: 'td-grip' }), h('td', { colspan: props.length + 1 }, ...groupHeading(env, g.key, g.rows.length, open, toggleGroup), ...sums(g.rows)));
            tbody.appendChild(head);
            if (open) {
                const t = groupBatch(env, key, tree(g.rows));
                for (const it of t.items)
                    tbody.appendChild(itemEl(it));
                if (t.more)
                    tbody.appendChild(h('tr', null, h('td', { colspan: props.length + 2 }, t.more)));
            }
        }
    }
    else {
        const all = tree(res.rows);
        let shownRoots = 0;
        const more = (before) => {
            const t = takeRoots(all, rendered, limit);
            for (const it of t.items)
                tbody.insertBefore(itemEl(it), before);
            rendered = t.end;
            shownRoots += t.roots;
        };
        more(null);
        if (rendered < all.length) {
            const moreBtn = h('button', { class: 'loadmore', onclick: () => step() });
            const allBtn = h('button', { class: 'loadmore', title: 'Show every entry now (the load limit stays for next time)', onclick: () => step(Infinity) });
            const label = () => { const left = countRoots(all, rendered); moreBtn.textContent = `Load ${Math.min(chunk, left)} more`; allBtn.textContent = `Load all ${left}`; allBtn.hidden = left <= chunk; };
            // below the table (under the sums), so it never breaks the column lines
            loadBar = h('div', { class: 'loadmore-bar table-more' }, moreBtn, allBtn);
            const step = (n = chunk) => {
                const t = takeRoots(all, rendered, n);
                // new rows go above the bottom "+ New" row
                const last = tbody.lastElementChild;
                const before = view.newAt !== 'top' && last?.classList.contains('newrow') ? last : null;
                for (const it of t.items)
                    tbody.insertBefore(itemEl(it), before);
                rendered = t.end;
                shownRoots += t.roots;
                state.limit = Math.max(state.limit || 0, shownRoots); // a redraw keeps what was loaded
                if (rendered < all.length)
                    label();
                else
                    loadBar?.remove();
            };
            label();
            // with a load limit set in the view, more rows come only on click (as in Notion); otherwise
            // they are added while scrolling (keeps the first paint instant on 2,500+ rows)
            if (!view.limit) {
                const bar = loadBar;
                const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting) && bar.isConnected)
                    step();
                else if (!bar.isConnected)
                    io.disconnect(); });
                requestAnimationFrame(() => io.observe(bar));
            }
        }
    }
    // one cell per column, so the column lines run through; the whole row is the button
    const newRow = () => h('tr', { class: 'newrow', onclick: (e) => { if (e.target.closest('td:not(:first-child)'))
            env.newRow(undefined, true); } }, h('td'), ...props.map((_, i) => h('td', null, i === 0 ? '+ New' : null)), h('td'));
    // the table's own "+ New" rows stay with a simplified toolbar too (top / bottom as set)
    if (view.newAt === 'top' || view.newAt === 'both')
        tbody.insertBefore(newRow(), tbody.firstChild);
    if (view.newAt !== 'top')
        tbody.appendChild(newRow());
    // ----- footer: aggregates -----
    const tfoot = h('tfoot');
    const updateFooter = () => {
        tfoot.textContent = '';
        const fr = h('tr');
        fr.appendChild(h('td'));
        for (const p of props) {
            const agg = view.aggregates?.[p.name] ?? 'none';
            const v = aggregate(db, res.rows, p.name, agg);
            const td = h('td', { class: alignClass(view, p), title: agg === 'none' ? 'Calculate' : `${AGG_NAME[agg]} ${p.name}` }, agg !== 'none' ? h('span', { class: 'agg-label' }, AGG_LABEL[agg]) : '', v != null ? (agg === 'count' ? String(v) : fmtNumber(v, numFormat(p))) : '');
            td.addEventListener('click', () => aggMenu(env, p, td));
            td.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); aggMenu(env, p, td); });
            fr.appendChild(td);
        }
        fr.appendChild(h('td'));
        tfoot.appendChild(fr);
    };
    updateFooter();
    if (!view.noCalcRow)
        table.appendChild(tfoot);
    // ----- keyboard navigation -----
    table.addEventListener('keydown', (e) => {
        const sel = table.querySelector('td.sel');
        if (!sel || e.target.tagName === 'INPUT')
            return;
        const rowEl2 = sel.parentElement;
        const idx = [...rowEl2.children].indexOf(sel);
        let target = null;
        const id0 = rowEl2.dataset.id;
        const row0 = db.rows.find((r) => r.id === id0);
        const p0 = sel.dataset.prop ? db.prop(sel.dataset.prop) : undefined;
        if (e.key === 'ArrowDown')
            target = nextRow(rowEl2, 1)?.children[idx];
        else if (e.key === 'ArrowUp')
            target = nextRow(rowEl2, -1)?.children[idx];
        else if (e.key === 'ArrowRight')
            target = sel.nextElementSibling;
        else if (e.key === 'ArrowLeft')
            target = sel.previousElementSibling;
        else if (e.key.toLowerCase() === 'a' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
            e.preventDefault();
            selectAll(table, env);
            return;
        }
        else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            env.newRow();
            return;
        }
        // like a spreadsheet: ↵ goes down, ⇥ goes right; F2 (or a click, or typing) edits
        else if (e.key === 'Enter') {
            e.preventDefault();
            moveSel(e.shiftKey ? 'up' : 'down');
            return;
        }
        else if (e.key === 'Tab') {
            e.preventDefault();
            moveSel(e.shiftKey ? 'left' : 'right');
            return;
        }
        else if (e.key === 'F2') {
            e.preventDefault();
            sel.click();
            return;
        }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && row0 && p0 && !['formula', 'created_time', 'last_edited_time', 'rollup'].includes(p0.type)) {
            // clear the cell
            e.preventDefault();
            if (p0.type === 'title')
                row0.values[p0.name] = '';
            else
                delete row0.values[p0.name];
            void ctx.ws.saveRow(db, row0).then(() => { const fresh = rowEl(row0); rowEl2.replaceWith(fresh); fresh.children[idx]?.classList.add('sel'); updateFooter(); table.focus({ preventScroll: true }); });
            return;
        }
        else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== ' ' && row0 && p0) {
            // typing on a selected cell starts editing it with what was typed (text, numbers …); other kinds open their picker
            e.preventDefault();
            if (['title', 'text', 'number', 'url', 'email', 'phone'].includes(p0.type))
                startEdit(sel, row0, p0, e.key);
            else
                sel.click();
            return;
        }
        else if (e.key === ' ') {
            const id = rowEl2.dataset.id;
            const row = db.rows.find((r) => r.id === id);
            if (row) {
                e.preventDefault();
                ctx.openRow(db, row);
            }
            return;
        }
        if (target && target.dataset.prop) {
            e.preventDefault();
            sel.classList.remove('sel');
            target.classList.add('sel');
            target.scrollIntoView({ block: 'nearest' });
        }
    });
    return h('div', { class: 'tablewrap' }, table, loadBar);
}
function nextRow(tr, dir) {
    let n = (dir > 0 ? tr.nextElementSibling : tr.previousElementSibling);
    while (n && !n.classList.contains('row'))
        n = (dir > 0 ? n.nextElementSibling : n.previousElementSibling);
    return n;
}
const isNum = (p) => p.type === 'number' || p.type === 'formula';
/** a column's alignment: its own setting, else numbers right and everything else left */
const alignOf = (view, p) => view.align?.[p.name] ?? (isNum(p) ? 'right' : 'left');
const alignClass = (view, p) => { const a = alignOf(view, p); return a === 'right' ? 'num' : a === 'center' ? 'center' : ''; };
const numFormat = (p) => p.format;
const AGG_LABEL = { none: '', sum: '', count: 'Count', avg: 'Avg', min: 'Min', max: 'Max' };
const AGG_NAME = { none: 'None', sum: 'Sum', count: 'Count', avg: 'Average', min: 'Minimum', max: 'Maximum' };
function aggEntries(env, p) {
    const numeric = p.type === 'number' || p.type === 'formula';
    const aggs = numeric ? ['none', 'sum', 'avg', 'min', 'max', 'count'] : ['none', 'count'];
    const cur = env.view.aggregates?.[p.name] ?? 'none';
    return aggs.map((a) => ({ label: `${cur === a ? '✓' : '   '} ${AGG_NAME[a]}`, run: () => { (env.view.aggregates ??= {})[p.name] = a; env.saveView(); env.redraw(); } }));
}
function aggMenu(env, p, anchor) { menu(anchor, aggEntries(env, p)); }
function filterFor(env, p, anchor) { menu(anchor, filterOpsFor(env, p, anchor)); }
/** add a property; `near` places it left or right of an existing column (schema and this view) */
function addProperty(env, anchor, near) {
    const { db, view, ctx } = env;
    const si = near ? db.schema.properties.findIndex((p) => p.name === near.prop) + (near.side === 'right' ? 1 : 0) : undefined;
    addPropertyMenu(ctx.ws, db, anchor, (def) => {
        const cur = (view.props ?? db.schema.properties.map((p) => p.name)).filter((n) => n !== def.name);
        const vi = near ? cur.indexOf(near.prop) + (near.side === 'right' ? 1 : 0) : cur.length;
        cur.splice(vi < 0 ? cur.length : vi, 0, def.name);
        view.props = cur;
        env.saveView();
        env.redraw();
    }, si);
}
function columnMenu(env, p, anchor) {
    const { db, view, ctx } = env;
    const shown = view.props ?? db.schema.properties.map((x) => x.name);
    const entries = [
        { label: 'Sort ascending', icon: menuIcon('arrow-up'), run: () => { view.sorts = [{ prop: p.name, dir: 'asc' }]; env.saveView(); env.redraw(); } },
        { label: 'Sort descending', icon: menuIcon('arrow-down'), run: () => { view.sorts = [{ prop: p.name, dir: 'desc' }]; env.saveView(); env.redraw(); } },
        'sep',
        { label: 'Filter by this', icon: menuIcon('filter'), run: () => filterFor(env, p, anchor) },
        { label: 'Calculate', icon: menuIcon('sigma'), hint: AGG_NAME[view.aggregates?.[p.name] ?? 'none'], sub: () => aggEntries(env, p) },
    ];
    // the property itself (for every view), then how this view shows it; delete last
    const propEntries = propertyEntries(ctx.ws, db, p, anchor, () => env.redraw());
    const del = propEntries.filter((e) => typeof e === 'object' && 'label' in e && e.label === 'Delete property');
    const own = propEntries.filter((e) => !del.includes(e));
    while (own.length && own[own.length - 1] === 'sep')
        own.pop();
    const viewEntries = [];
    const wrapped = view.wrap?.includes(p.name);
    const fills = !!view.fill?.includes(p.name);
    const al = alignOf(view, p);
    const sv = () => { env.saveView(); env.redraw(); };
    viewEntries.push({ label: 'Align', icon: menuIcon(al === 'right' ? 'align-right' : al === 'center' ? 'align-center' : 'align-left'), seg: { options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], value: al, pick: (a) => {
                const def = isNum(p) ? 'right' : 'left';
                if (a === def) {
                    if (view.align)
                        delete view.align[p.name];
                    if (view.align && !Object.keys(view.align).length)
                        delete view.align;
                }
                else
                    (view.align ??= {})[p.name] = a;
                sv();
            } } });
    viewEntries.push({ label: 'Width', icon: menuIcon('columns'), seg: { options: [['fixed', 'Fixed'], ['fill', 'Fill']], value: fills ? 'fill' : 'fixed', pick: (v) => {
                view.fill = (view.fill ?? []).filter((x) => x !== p.name);
                if (v === 'fill')
                    view.fill.push(p.name);
                if (!view.fill.length)
                    delete view.fill;
                sv();
            } } });
    viewEntries.push({ label: 'Wrap text', icon: menuIcon('align-left'), toggle: !!wrapped, onToggle: (on) => { view.wrap = (view.wrap ?? []).filter((x) => x !== p.name); if (on)
            view.wrap.push(p.name); if (!view.wrap.length)
            delete view.wrap; sv(); } });
    if (p.type === 'select')
        viewEntries.push({ label: 'Color rows', icon: menuIcon('palette'), toggle: view.colorBy === p.name, onToggle: (on) => { view.colorBy = on ? p.name : undefined; sv(); } });
    if (p.name !== db.labelProp && shown.includes(p.name))
        viewEntries.push({ label: 'Hide in this view', icon: menuIcon('minus'), run: () => { view.props = shown.filter((x) => x !== p.name); sv(); } });
    const dup = own.filter((e) => typeof e === 'object' && 'label' in e && e.label === 'Duplicate property');
    const edit = own.filter((e) => !dup.includes(e) && !(typeof e === 'object' && 'section' in e && e.section === 'Arrange'));
    // compact: the everyday actions first; the property's own settings and how this column looks each on their own page
    const named = (arr, l) => arr.find((e) => typeof e === 'object' && 'label' in e && e.label === l);
    const sortDir = view.sorts?.length === 1 && view.sorts[0].prop === p.name ? view.sorts[0].dir : '';
    const hide = named(viewEntries, 'Hide in this view');
    const typeRow = named(edit, 'Type');
    const final = [
        ...(named(edit, 'Rename') ? [named(edit, 'Rename')] : []),
        { label: 'Sort', icon: menuIcon('arrow-down'), seg: { options: [['', 'Off'], ['asc', '↑'], ['desc', '↓']], value: sortDir, pick: (v) => { view.sorts = v ? [{ prop: p.name, dir: v }] : (view.sorts ?? []).filter((x) => x.prop !== p.name); if (!view.sorts.length)
                    delete view.sorts; env.saveView(); env.redraw(); } } },
        named(entries, 'Filter by this'),
        ...(hide ? [hide] : []),
        'sep',
        { label: 'Property', icon: menuIcon('settings'), hint: typeRow?.hint, sub: () => [...edit.filter((e) => !(typeof e === 'object' && 'label' in e && e.label === 'Rename')), ...dup] },
        { label: 'Column', icon: menuIcon('columns'), hint: 'In this view', sub: () => [named(entries, 'Calculate'), ...viewEntries.filter((e) => e !== hide)] },
        { label: 'Insert', icon: menuIcon('plus-circle'), seg: { options: [['left', 'Left'], ['right', 'Right']], value: '', pick: (v) => { closePop(); addProperty(env, anchor, { prop: p.name, side: v }); } } },
        ...(del.length ? ['sep', ...del] : []),
    ];
    menu(anchor, final, { title: p.name });
}
//# sourceMappingURL=table.js.map