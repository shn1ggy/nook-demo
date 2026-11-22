import { rowTarget } from '../links.js';
import { asDate, h, svgIcon, ICONS } from '../util.js';
import { dialog, panel } from '../ui/pop.js';
import { renderValue, typeIcon } from './cells.js';
import { switchControl } from '../ui/settings.js';
/** the sort of the drill-down, kept while Nook is open (per chart view) */
const SORT = new Map();
export function openDrill(env, title, sub, rows, color) {
    const again = () => openDrill(env, title, sub, rows, color);
    const db = env.db;
    const tv = db.views.find((v) => v.type === 'table') ?? env.view;
    const allCols = db.schema.properties.map((p) => p.name);
    const defaults = db.tableProperties(tv).filter((n) => db.prop(n)).slice(0, 6);
    const colsOf = () => (env.view.chart?.drillCols ?? defaults).filter((n) => db.prop(n));
    const dateProp = db.schema.properties.find((p) => p.type === 'date')?.name;
    const numeric = (n) => ['number', 'formula', 'rollup'].includes(db.prop(n).type);
    const sortKey = (v) => {
        if (v == null)
            return '';
        if (typeof v === 'number')
            return v;
        if (typeof v === 'boolean')
            return v ? 1 : 0;
        const d = asDate(v);
        if (d?.start)
            return d.start;
        if (Array.isArray(v))
            return v.join(', ').toLowerCase();
        return String(v).toLowerCase();
    };
    let sort = SORT.get(env.view.id) ?? (dateProp ? { col: dateProp, dir: -1 } : null);
    const open = (r) => { close(); env.ctx.openRow(db, r, { back: again, backLabel: title }); };
    const body = h('div', { class: 'dialog-body drill-body' });
    const draw = () => {
        const cols = colsOf();
        let list = rows;
        if (sort && db.prop(sort.col)) {
            const { col, dir } = sort;
            list = [...rows].sort((a, b) => {
                const x = sortKey(db.value(a, col)), y = sortKey(db.value(b, col));
                // empty values last, whatever the direction
                if (x === '' && y !== '')
                    return 1;
                if (y === '' && x !== '')
                    return -1;
                return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
            });
        }
        const th = (n) => {
            const on = sort?.col === n;
            return h('th', { class: (numeric(n) ? 'num' : '') + (on ? ' sorted' : ''), title: on ? (sort.dir === 1 ? 'Sorted ascending – click for descending' : 'Sorted descending – click for ascending') : 'Sort by ' + n,
                onclick: () => { sort = on ? { col: n, dir: sort.dir === 1 ? -1 : 1 } : { col: n, dir: numeric(n) || db.prop(n).type === 'date' ? -1 : 1 }; SORT.set(env.view.id, sort); draw(); } }, h('span', { class: 'drill-th' }, n, h('span', { class: 'drill-arrow' }, on ? (sort.dir === 1 ? '↑' : '↓') : '')));
        };
        body.replaceChildren(rows.length ? h('table', { class: 'drill-table' }, h('thead', null, h('tr', null, cols.map(th))), h('tbody', null, list.map((r) => h('tr', { tabindex: 0, onclick: () => open(r), onmousedown: (e) => { if (e.button === 1)
                e.preventDefault(); }, onauxclick: (e) => { if (e.button !== 1)
                return; const u = env.ctx.pageUrl?.(rowTarget(db.key, r.id)); if (u)
                window.open(u, '_blank'); }, onkeydown: (e) => { if (e.key === 'Enter')
                open(r); } }, cols.map((n, i) => h('td', { class: (numeric(n) ? 'num' : '') + (i === 0 ? ' first' : '') }, renderValue(db, db.prop(n), db.value(r, n)))))))) : h('div', { class: 'keep-empty' }, 'No entries.'));
    };
    // ⋯: the columns – switch them on and off, drag them into order
    const colBtn = h('button', { class: 'icon-btn', 'aria-label': 'Columns', title: 'Columns', onclick: () => panel(colBtn, { title: 'Columns', rows: (nav) => {
                const cur = colsOf();
                const order = [...cur, ...allCols.filter((n) => !cur.includes(n))];
                const save = (next) => { if (!next.length)
                    return; env.view.chart.drillCols = next; env.saveView(); draw(); nav.refresh(); };
                let dragged = null;
                const list = h('div', { class: 'drill-cols' }, order.map((n) => {
                    const def = db.prop(n);
                    const row = h('div', { class: 'drill-col' + (cur.includes(n) ? '' : ' off'), draggable: 'true', 'data-col': n }, h('span', { class: 'drill-grip prop-grip', 'aria-hidden': 'true' }, svgIcon(ICONS.grip, 14, { fill: true })), typeIcon(def.type, def.icon), h('span', { class: 'drill-col-name' }, n), switchControl(cur.includes(n), (on) => save(on ? order.filter((x) => cur.includes(x) || x === n) : cur.filter((x) => x !== n)), `Show ${n}`));
                    row.addEventListener('dragstart', (e) => { dragged = n; e.dataTransfer?.setData('text/plain', n); row.classList.add('dragging'); });
                    row.addEventListener('dragend', () => { row.classList.remove('dragging'); list.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
                    row.addEventListener('dragover', (e) => {
                        if (!dragged || dragged === n)
                            return;
                        e.preventDefault();
                        const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
                        row.classList.toggle('drop-after', after);
                        row.classList.toggle('drop-before', !after);
                    });
                    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
                    row.addEventListener('drop', (e) => {
                        e.preventDefault();
                        if (!dragged || dragged === n)
                            return;
                        const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
                        const rest = order.filter((x) => x !== dragged);
                        rest.splice(rest.indexOf(n) + (after ? 1 : 0), 0, dragged);
                        save(rest.filter((x) => cur.includes(x)));
                    });
                    return row;
                }));
                return [{ el: list }, 'sep', { el: h('button', { class: 'drill-reset', onclick: () => { delete env.view.chart.drillCols; env.saveView(); draw(); nav.refresh(); } }, 'Reset to default') }];
            } }) }, svgIcon(ICONS.more, 16, { fill: true }));
    // one line, like an entry window: title, then the figures, the close button in the same place
    const head = h('div', { class: 'dialog-head drill-head' }, h('span', { class: 'drill-titles' }, color ? h('span', { class: 'drill-sw', style: { background: color } }) : null, h('strong', null, title), h('span', { class: 'muted' }, sub)), env.view.chart ? colBtn : null, h('button', { class: 'icon-btn', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => close() }, svgIcon(ICONS.close)));
    draw();
    const close = dialog(h('div', { class: 'bwindow drill-window' }, head, body), { wide: true });
}
//# sourceMappingURL=drill.js.map