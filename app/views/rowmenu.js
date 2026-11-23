import { remindMenu, remindAtMenu, remindDateProp } from '../ui/reminders.js';
import { rowTarget } from '../links.js';
import { menu, toast, prompt, colorDot, menuIcon } from '../ui/pop.js';
import { asDate } from '../util.js';
import { repeatMenu } from './repeat.js';
import { repeatOn, typeIcon } from './cells.js';
import { fileRowMenu } from './fileview.js';
import { selectedRows, deleteSelected, openSubItems, startSelectMode } from './rowselect.js';
export function rowMenu(ctx, db, row, at, after, extra = [], afterOpen = []) {
    const ws = ctx.ws;
    const promptCopy = (link) => prompt(at, 'Copy this link', link, () => { });
    // right-click on one of several selected entries: changes apply to all of them
    const picked = selectedRows();
    const many = picked && picked.env.db === db && picked.rows.length > 1 && picked.rows.includes(row) ? picked.rows : [row];
    // a database of files has its own, shorter menu
    if (db.schema.files) {
        fileRowMenu(ctx, db, row, many, at, after);
        return;
    }
    const set = async (prop, v) => {
        ws.boundary();
        for (const r of many) {
            if (v == null)
                delete r.values[prop];
            else
                r.values[prop] = v;
            await ws.saveRow(db, r);
        }
        after();
    };
    // the same order as every menu: open · edit · arrange · share · delete
    const entries = [...extra];
    if (many.length === 1)
        entries.push({ label: 'Open', hint: '↵', run: () => ctx.openRow(db, row) }, { label: 'Open as full page', run: () => ctx.openRowPage(db, row) }, ...afterOpen, { label: 'Remind me…', icon: menuIcon('bell'), run: () => { const p = remindDateProp(db); const d = p ? asDate(row.values[p]) : null; if (p && d)
                remindMenu(ws, db, row, p, at, after);
            else
                remindAtMenu(ws, { row, db }, at, after); } });
    // touch: no ⇧ or ⌘ to select several – "Select" starts picking with this entry
    if (many.length === 1 && document.documentElement.classList.contains('touch'))
        entries.push({ label: 'Select', run: () => startSelectMode(row.id) });
    const selects = db.schema.properties.filter((p) => p.type === 'select' && p.options?.length);
    const checks = db.schema.properties.filter((p) => p.type === 'checkbox');
    if (selects.length || checks.length)
        entries.push({ section: 'Edit' });
    for (const p of selects) {
        // the value shown is the entries' common value (none when they differ)
        const vals = new Set(many.map((r) => r.values[p.name]));
        const cur = vals.size === 1 ? row.values[p.name] : undefined;
        entries.push({
            label: p.name, icon: typeIcon(p.type, p.icon), hint: typeof cur === 'string' ? cur : undefined,
            sub: () => [
                ...p.options.map((o) => ({
                    label: (o.name === cur ? '✓ ' : '   ') + o.name,
                    icon: colorDot(o.color),
                    run: () => set(p.name, o.name),
                })),
                'sep',
                { label: 'Clear', run: () => set(p.name, null) },
            ],
        });
    }
    for (const p of checks) {
        const on = many.every((r) => r.values[p.name] === true);
        entries.push({ label: p.name, icon: typeIcon(p.type, p.icon), toggle: on, onToggle: (v) => void set(p.name, v) });
    }
    // sub-items: a new one below this entry, or move entries under another one / back to the top level
    const si = db.schema.subItems;
    if (si) {
        const hasParent = many.some((r) => ws.parentOf(db, r));
        const below = (r, ancestor) => { for (let x = r, n = 0; x && n < 50; x = ws.parentOf(db, x), n++)
            if (x.id === ancestor.id)
                return true; return false; };
        entries.push({ section: 'Arrange' });
        if (many.length === 1)
            entries.push({ label: 'Add sub-item', run: async () => {
                    ws.boundary();
                    const c = await ws.addSubItem(db, row);
                    openSubItems.add(`${db.key}:${row.id}`);
                    after();
                    if (c)
                        ctx.openRow(db, c, { isNew: true });
                } });
        entries.push({ label: many.length > 1 ? `Make ${many.length} sub-items of…` : 'Make sub-item of…', run: () => {
                const cands = db.rows.filter((r) => !many.some((m) => below(r, m))).slice(0, 400);
                menu(at, cands.map((r) => ({ label: db.rowLabel(r), run: async () => {
                        ws.boundary();
                        for (const m of many)
                            await ws.setRelation(db, m, si.parent, [r.id]);
                        openSubItems.add(`${db.key}:${r.id}`);
                        after();
                    } })), { filter: true });
            } });
        if (hasParent)
            entries.push({ label: 'Move to top level', run: async () => { ws.boundary(); for (const m of many)
                    await ws.setRelation(db, m, si.parent, []); after(); } });
    }
    if (!si)
        entries.push({ section: 'Arrange' });
    if (repeatOn(db) && many.length === 1)
        entries.push({ label: 'Repeat…', hint: row.repeat ? 'On' : 'Off', run: () => repeatMenu(ws, db, row, at, after) });
    const dup = async (r) => { await ws.duplicateRow(db, r); };
    entries.push({ label: many.length > 1 ? `Duplicate ${many.length}` : 'Duplicate', hint: '⌘D', run: async () => { ws.boundary(); for (const r of many)
            await dup(r); after(); } });
    if (many.length === 1)
        entries.push({ section: 'Share' }, { label: 'Copy link', run: async () => {
                // a real address: it opens the entry in a browser, and pasted into a page it becomes a link to it
                const link = ctx.pageUrl ? new URL(ctx.pageUrl(rowTarget(db.key, row.id)), location.href).href : `nook:${rowTarget(db.key, row.id)}`;
                try {
                    await navigator.clipboard.writeText(link);
                    toast('Link copied');
                }
                catch {
                    promptCopy(link);
                }
            } });
    entries.push('sep', many.length > 1
        ? { label: `Delete ${many.length} entries`, danger: true, run: async () => { await deleteSelected(); after(); } }
        : { label: row.repeat ? 'Delete all dates' : 'Delete', danger: true, run: async () => { ws.boundary(); await ws.deleteRow(db, row); after(); } });
    menu(at, entries, { title: many.length > 1 ? `${many.length} entries` : undefined });
}
//# sourceMappingURL=rowmenu.js.map