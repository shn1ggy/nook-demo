// Import CSV into an existing database: each column of the file is matched to a property (by name, as a
// guess), and you decide where each one goes – a property, a new property, or nowhere.
import { h } from '../util.js';
import { dialog, menu, menuIcon } from './pop.js';
import { renderValue, typeIcon } from '../views/cells.js';
import { convertValue, inferProp } from '../importer/notion.js';
export function mapCsv(db, file, t, go) {
    const props = db.schema.properties.filter((p) => !['created_time', 'last_edited_time', 'formula', 'rollup', 'button'].includes(p.type));
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
    const used = new Set();
    // a guess: same name; else a column of dates → the date property, the first text column → the title
    const map = t.header.map((hd) => {
        const p = props.find((q) => norm(q.name) === norm(hd) && !used.has(q.name));
        if (p) {
            used.add(p.name);
            return p.name;
        }
        return null;
    });
    t.header.forEach((hd, i) => {
        if (map[i] != null)
            return;
        const kind = inferProp(hd, i + 1, t.rows).type;
        const p = kind === 'date' ? props.find((q) => q.type === 'date' && !used.has(q.name)) : null;
        if (p) {
            used.add(p.name);
            map[i] = p.name;
        }
    });
    const sample = (i) => t.rows.map((r) => (r[i] ?? '').trim()).find(Boolean) ?? '';
    const body = h('div', { class: 'csvm-list' });
    const count = h('span', { class: 'csvm-count' });
    const draw = () => {
        body.replaceChildren(...t.header.map((hd, i) => {
            const target = map[i] === undefined ? null : map[i];
            const p = target ? props.find((q) => q.name === target) : null;
            const raw = sample(i);
            const conv = p ? convertValue(p, raw) : null;
            const bad = !!p && !!raw && (conv === null || conv === '');
            const shown = !raw ? h('span', { class: 'csvm-empty' }, 'empty') : p && !bad ? renderValue(db, p, conv) : raw;
            const btn = h('button', {
                class: 'csvm-pick' + (target == null ? ' skip' : ''),
                onclick: () => {
                    const r = btn.getBoundingClientRect();
                    const items = [
                        { label: 'Leave out', icon: menuIcon('x'), hint: target == null ? '✓' : undefined, run: () => { map[i] = null; draw(); } },
                        { label: `New property “${hd}”`, icon: menuIcon('plus'), hint: target === '' ? '✓' : undefined, run: () => { map[i] = ''; draw(); } },
                        { section: 'Properties' },
                        ...props.map((q) => ({
                            label: q.name, icon: typeIcon(q.type, q.icon),
                            hint: target === q.name ? '✓' : map.some((m, j) => j !== i && m === q.name) ? 'in use' : undefined,
                            run: () => { map.forEach((m, j) => { if (m === q.name)
                                map[j] = null; }); map[i] = q.name; draw(); },
                        })),
                    ];
                    menu({ x: r.left, y: r.bottom }, items);
                },
            }, target == null ? 'Leave out' : target === '' ? `New: ${hd}` : h('span', { class: 'csvm-t' }, typeIcon(p.type, p.icon), p.name), h('span', { class: 'csvm-chev' }, '⌄'));
            return h('div', { class: 'csvm-row' + (target == null ? ' off' : '') }, h('div', { class: 'csvm-col' }, h('b', null, hd), h('span', { class: 'csvm-ex' + (bad ? ' bad' : '') }, shown, bad ? h('span', { class: 'csvm-warn' }, ' – can’t be read as ' + p.type.replace('_', '-')) : null)), h('span', { class: 'csvm-arrow' }, '→'), btn);
        }));
        const n = map.filter((m) => m != null).length;
        count.textContent = `${t.rows.length} rows · ${n} of ${t.header.length} columns`;
        ok.disabled = !n;
    };
    const ok = h('button', { class: 'btn-new', onclick: () => { close(); go(map.map((m) => m ?? null)); } }, 'Import');
    const close = dialog(h('div', { class: 'bwindow csvm' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px', flex: 1 } }, `Import “${file}” into “${db.schema.name}”`)), body, h('div', { class: 'bfooter' }, count, h('span', { style: { flex: 1 } }), h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), ok)), { wide: true });
    draw();
}
//# sourceMappingURL=csvmap.js.map