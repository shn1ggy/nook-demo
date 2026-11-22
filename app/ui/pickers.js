// One way to choose a page or a database everywhere in the app: a searchable list, sorted by name, with
// icons (and the parent page as a hint, so pages with the same name can be told apart). Used by the "/"
// menu, button settings, "Move to…", shortcuts and other forms.
import { h, svgIcon, ICONS } from '../util.js';
import { renderIcon } from './icons.js';
import { menu } from './pop.js';
import { rowTarget } from '../links.js';
const byName = (list, name) => list.slice().sort((a, b) => name(a).localeCompare(name(b)));
/** the pages of the workspace as pick items (sorted; `skip`: pages not offered) */
export function pageItems(ws, skip) {
    return byName([...ws.pages.values()].filter((p) => !skip?.(p)), (p) => p.title).map((p) => ({
        value: p.id, label: p.title || 'Untitled', icon: renderIcon(p.icon, 16, 'file'), hint: p.parent ? ws.pages.get(p.parent)?.title : undefined,
    }));
}
/** Link/open destinations include entries; parent and move pickers still use pageItems. */
export function linkItems(ws, skip) {
    return byName([...pageItems(ws, skip), ...[...ws.dbs.values()].flatMap((db) => db.rows.map((row) => ({
            value: rowTarget(db.key, row.id), label: db.rowLabel(row),
            icon: renderIcon(row.icon, 16, 'file'), hint: db.schema.name,
        })))], (item) => item.label);
}
/** the databases of the workspace as pick items (sorted) */
export function dbItems(ws, skip) {
    return byName([...ws.dbs.values()].filter((d) => !skip?.(d)), (d) => d.schema.name).map((d) => ({
        value: d.key, label: d.schema.name, icon: renderIcon(d.schema.icon, 16, 'database'), hint: d.views.length > 1 ? `${d.views.length} views` : undefined,
    }));
}
/** pick items as menu entries (for a submenu with `subFilter: true`, or `menu(…, { filter: true })`) */
export function pickEntries(items, pick, current) {
    return items.map((it) => ({ label: it.label, icon: it.icon ?? undefined, hint: it.value === current ? '✓' : it.hint, run: () => pick(it.value) }));
}
/** opens the searchable list at an element */
export function openPicker(anchor, items, pick, current, extra = []) {
    menu(anchor, [...extra, ...(extra.length ? ['sep'] : []), ...pickEntries(items, pick, current)], { filter: true });
}
/**
 * A form control that looks like a dropdown and opens the searchable list. `items` is read each time it
 * opens, so new pages and databases are always there.
 */
export function pickerControl(o) {
    let value = o.value;
    const show = h('span', { class: 'picker-value' });
    const btn = h('button', { type: 'button', class: 'set-select picker', 'aria-label': o.label ?? o.placeholder ?? 'Choose' }, show, h('span', { class: 'picker-caret' }, svgIcon(ICONS.chevron, 12)));
    const draw = () => {
        const it = o.items().find((x) => x.value === value);
        show.replaceChildren(...(it ? [it.icon ?? '', h('span', { class: 'picker-label' }, it.label)] : [h('span', { class: 'picker-label muted' }, o.placeholder ?? 'Choose…')]));
    };
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPicker(btn, o.items(), (v) => { value = v; draw(); o.change(v); }, value);
    });
    draw();
    return btn;
}
//# sourceMappingURL=pickers.js.map