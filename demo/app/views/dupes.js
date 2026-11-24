import { asDate, h, svgIcon, ICONS } from '../util.js';
import { confirmDialog, dialog, panel, toast } from '../ui/pop.js';
import { renderValue, typeIcon } from './cells.js';
import { moreControl, switchControl } from '../ui/settings.js';
import { prettyKey } from '../ui/commands.js';
/** the compared properties, remembered per database while Nook is open */
const PICKED = new Map();
const norm = (v) => {
    if (v == null || v === '' || (Array.isArray(v) && !v.length))
        return '';
    if (typeof v === 'number')
        return String(Math.round(v * 100) / 100);
    const d = asDate(v);
    if (d?.start)
        return d.start.slice(0, 10);
    if (Array.isArray(v))
        return [...v].map(String).sort().join('|').toLowerCase();
    return String(v).toLowerCase().replace(/\s+/g, ' ').trim();
};
export function openDuplicates(ctx, db) {
    const props = db.schema.properties;
    const defaults = () => {
        const out = [db.titleProp];
        const date = props.find((p) => p.type === 'date');
        if (date)
            out.push(date.name);
        const num = props.find((p) => p.type === 'number');
        if (num)
            out.push(num.name);
        return out;
    };
    let picked = (PICKED.get(db.key) ?? defaults()).filter((n) => db.prop(n));
    if (!picked.length)
        picked = [db.titleProp];
    const groups = () => {
        const map = new Map();
        for (const r of db.rows) {
            const parts = picked.map((n) => norm(db.value(r, n)));
            if (parts.every((x) => !x))
                continue; // entries that are empty in every compared property aren't duplicates of each other
            const k = parts.join('\u0001');
            const g = map.get(k);
            if (g)
                g.push(r);
            else
                map.set(k, [r]);
        }
        return [...map.values()].filter((g) => g.length > 1);
    };
    const sub = h('span', { class: 'muted' });
    // all groups at once: the oldest entry of each stays, the others go (to the trash – undo works)
    const keepAll = h('button', { class: 'set-btn', title: 'Keep the oldest entry of every group, delete the others', onclick: () => {
            const gs = groups();
            if (!gs.length)
                return;
            const extra = gs.flatMap((g) => [...g].sort((a, b) => String(a.created ?? '').localeCompare(String(b.created ?? ''))).slice(1));
            confirmDialog({ title: `Delete ${extra.length} duplicate${extra.length === 1 ? '' : 's'}?`, lines: [`Of each of the ${gs.length} group${gs.length === 1 ? '' : 's'}, the oldest entry is kept and the others are deleted.`, `They go to the trash · ${prettyKey('Mod+Z')} to undo.`], ok: `Delete ${extra.length}`, danger: true, onOk: async () => {
                    ctx.ws.boundary();
                    for (const r of extra)
                        await ctx.ws.deleteRow(db, r);
                    toast(`Deleted ${extra.length} duplicate${extra.length === 1 ? '' : 's'} · ${prettyKey('Mod+Z')} to undo`);
                    ctx.refresh();
                    draw();
                } });
        } }, 'Keep one of each');
    const body = h('div', { class: 'dialog-body bwin dupe-body' });
    const cols = () => [db.titleProp, ...picked.filter((n) => n !== db.titleProp)];
    const draw = () => {
        const gs = groups();
        sub.textContent = gs.length ? `${gs.length} group${gs.length === 1 ? '' : 's'} · ${gs.reduce((s, g) => s + g.length, 0)} entries · compared by ${picked.join(', ')}` : `No duplicates · compared by ${picked.join(', ')}`;
        keepAll.hidden = !gs.length;
        if (!gs.length) {
            body.replaceChildren(h('div', { class: 'keep-empty' }, 'No entries share the same values.'));
            return;
        }
        // one card per group, titled with what makes them the same; one row per entry
        const del = async (rs) => {
            ctx.ws.boundary();
            for (const r of rs)
                await ctx.ws.deleteRow(db, r);
            toast(`Deleted ${rs.length === 1 ? `“${db.rowLabel(rs[0])}”` : `${rs.length} entries`} · ${prettyKey('Mod+Z')} to undo`);
            ctx.refresh();
            draw();
        };
        const open = (r) => { close(); ctx.openRow(db, r, { back: () => openDuplicates(ctx, db), backLabel: 'Duplicates' }); };
        const others = cols().filter((n) => n !== db.titleProp);
        body.replaceChildren(...gs.map((g) => {
            const label = [db.rowLabel(g[0]), ...picked.filter((n) => n !== db.titleProp).map((n) => { const v = db.value(g[0], n); const el = renderValue(db, db.prop(n), v); return typeof el === 'string' ? el : el.textContent ?? ''; })].filter(Boolean).join(' · ');
            return h('section', { class: 'set-sec' }, h('div', { class: 'set-heading' }, h('h3', null, label)), h('div', { class: 'set-card' }, g.map((r) => h('div', { class: 'set-row dupe-row', role: 'button', tabindex: 0, onclick: () => open(r) }, h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, db.rowLabel(r) || 'Untitled'), h('div', { class: 'set-desc' }, [`created ${r.created ? new Date(r.created).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–'}`, ...others.filter((n) => !picked.includes(n))].join(' · '))), h('div', { class: 'set-control', onclick: (e) => e.stopPropagation() }, h('button', { class: 'set-btn', title: 'Keep this entry, delete the others of this group', onclick: () => void del(g.filter((x) => x !== r)) }, 'Keep'), moreControl(() => [{ label: 'Open', run: () => open(r) }, 'sep', { label: 'Delete', danger: true, run: () => void del([r]) }]))))));
        }));
    };
    const cmpBtn = h('button', { class: 'set-btn dupe-cmp', 'aria-label': 'Compare by', title: 'Which properties to compare', onclick: () => panel(cmpBtn, { title: 'Compare by', rows: (nav) => [
                { el: h('div', { class: 'drill-cols' }, props.map((p) => h('div', { class: 'drill-col', style: { cursor: 'default' } }, typeIcon(p.type, p.icon), h('span', { class: 'drill-col-name' }, p.name), switchControl(picked.includes(p.name), (on) => {
                        const next = on ? props.map((x) => x.name).filter((n) => picked.includes(n) || n === p.name) : picked.filter((n) => n !== p.name);
                        if (!next.length) {
                            nav.refresh();
                            return;
                        }
                        picked = next;
                        PICKED.set(db.key, picked);
                        draw();
                        nav.refresh();
                    }, `Compare ${p.name}`)))) },
            ] }) }, 'Compare by', svgIcon(ICONS.chevron, 11));
    const head = h('div', { class: 'dialog-head drill-head' }, h('span', { class: 'drill-titles' }, h('strong', null, `Duplicates in ${db.schema.name}`), sub), keepAll, cmpBtn, h('button', { class: 'icon-btn', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => close() }, svgIcon(ICONS.close, 15)));
    draw();
    const close = dialog(h('div', { class: 'bwindow drill-window' }, head, body), { wide: true });
}
//# sourceMappingURL=dupes.js.map