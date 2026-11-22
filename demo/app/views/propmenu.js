import { Database } from '../workspace.js';
import { DATE_FORMATS, nextTagColor, fmtNumber } from '../util.js';
import { pickIcon } from '../ui/iconpicker.js';
import { menu, prompt, toast, menuIcon, colorEntries, colorDot } from '../ui/pop.js';
import { typeIcon, TYPE_LABEL } from './cells.js';
const ADDABLE = ['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'email', 'phone', 'files', 'relation', 'rollup', 'formula', 'created_time', 'last_edited_time'];
/** number formats in three groups, named alike; each shows an example on the right */
const NUMBER_GROUPS = [
    ['Number', [['number', 'Number'], ['integer', 'Whole number'], ['plain', 'Number, no separators'], ['plain_int', 'Whole number, no separators']]],
    ['Currency', [['euro', 'Euro'], ['dollar', 'US dollar'], ['pound', 'British pound'], ['franc', 'Swiss franc'], ['yen', 'Japanese yen']]],
    ['Other', [['percent', 'Percent'], ['stars', 'Stars']]],
];
const NUMBER_FORMATS = NUMBER_GROUPS.flatMap(([, l]) => l);
const formatExample = (f) => f === 'stars' ? '★★★½' : f === 'percent' ? fmtNumber(0.42, f) : fmtNumber(f === 'yen' ? 1235 : 1234.5, f);
function numberFormatEntries(cur, pick, like) {
    return [
        ...(like ? [{ label: `${cur === '' ? '✓' : '   '} Like the property`, run: () => pick('') }, 'sep'] : []),
        ...NUMBER_GROUPS.flatMap(([title, list]) => [{ section: title }, ...list.map(([f, l]) => ({ label: `${cur === f ? '✓' : '   '} ${l}`, hint: formatExample(f), run: () => pick(f) }))]),
    ];
}
function uniqueName(db, base) {
    let n = base, i = 2;
    while (db.prop(n))
        n = `${base} ${i++}`;
    return n;
}
/** "+" in a table header or "Add a property" on an entry page. `index` inserts at a position. */
export function addPropertyMenu(ws, db, anchor, done, index) {
    menu(anchor, [
        { section: 'Property type' },
        ...ADDABLE.map((t) => ({
            label: TYPE_LABEL[t], icon: typeIcon(t),
            run: () => prompt(anchor, `Name of the new ${TYPE_LABEL[t].toLowerCase()} property`, uniqueName(db, TYPE_LABEL[t]), async (name) => {
                name = name.trim();
                if (!name)
                    return;
                if (db.prop(name)) {
                    toast(`There is already a property called "${name}"`);
                    return;
                }
                const def = { name, type: t };
                if (t === 'select' || t === 'multi_select')
                    def.options = [];
                if (t === 'formula')
                    def.formula = '';
                if (t === 'number')
                    def.format = 'number';
                const add = async () => {
                    if (index === undefined)
                        db.schema.properties.push(def);
                    else
                        db.schema.properties.splice(index, 0, def);
                    ws.boundary();
                    await ws.saveSchema(db);
                    done(def);
                };
                // relations and rollups first ask what they connect to
                if (t === 'relation')
                    return chooseRelationTarget(ws, db, def, anchor, async (twoWay) => {
                        if (index === undefined)
                            db.schema.properties.push(def);
                        else
                            db.schema.properties.splice(index, 0, def);
                        ws.boundary();
                        if (twoWay)
                            await ws.makeTwoWay(db, def);
                        else
                            await ws.saveSchema(db);
                        done(def);
                    });
                if (t === 'rollup')
                    return chooseRollup(db, def, anchor, add);
                await add();
            }),
        })),
    ], { filter: true });
}
/** Settings of one property that are the same wherever it is shown. */
export function propertyEntries(ws, db, p, anchor, redraw) {
    const save = async () => { ws.boundary(); await ws.saveSchema(db); redraw(); };
    const out = [
        { section: 'Edit' },
        { label: 'Rename', icon: menuIcon('pencil'), run: () => prompt(anchor, 'Property name', p.name, async (v) => {
                v = v.trim();
                if (!v || v === p.name)
                    return;
                if (db.prop(v)) {
                    toast(`There is already a property called "${v}"`);
                    return;
                }
                ws.boundary();
                await ws.renameProp(db, p.name, v);
                redraw();
            }) },
        { label: 'Icon', icon: typeIcon(p.type, p.icon), run: () => pickIcon(anchor, p.icon, async (value) => { if (value)
                p.icon = value;
            else
                delete p.icon; await save(); }) },
    ];
    if (p.type !== 'title')
        out.push({ label: 'Type', icon: typeIcon(p.type), hint: TYPE_LABEL[p.type], sub: () => ADDABLE.map((t) => ({
                label: `${p.type === t ? '✓' : '   '} ${TYPE_LABEL[t]}`, icon: typeIcon(t),
                run: async () => {
                    if (t === p.type)
                        return;
                    p.type = t;
                    if ((t === 'select' || t === 'multi_select') && !p.options) {
                        // keep existing values as options
                        const names = new Set();
                        for (const r of db.rows) {
                            const v = r.values[p.name];
                            if (Array.isArray(v))
                                v.forEach((x) => names.add(String(x)));
                            else if (v != null && v !== '' && typeof v !== 'object')
                                names.add(String(v));
                        }
                        p.options = [...names].map((n, i) => ({ name: n, color: nextTagColor(i) }));
                    }
                    if (t === 'formula' && p.formula === undefined)
                        p.formula = '';
                    if (t === 'relation') {
                        p.type = 'text';
                        chooseRelationTarget(ws, db, { ...p, type: 'relation' }, anchor, async (twoWay, chosen) => { p.type = 'relation'; p.relation = chosen.relation; await save(); if (twoWay) {
                            await ws.makeTwoWay(db, p);
                            redraw();
                        } });
                        return;
                    }
                    if (t === 'rollup') {
                        p.type = 'text';
                        chooseRollup(db, { ...p, type: 'rollup' }, anchor, async (chosen) => { p.type = 'rollup'; p.rollup = chosen.rollup; await save(); });
                        return;
                    }
                    await save();
                },
            })) });
    if (p.type === 'formula')
        out.push({ label: 'Edit formula…', icon: menuIcon('sigma'), run: () => prompt(anchor, `Formula for ${p.name} (⌘↵ to save). Refer to properties as [Name] or prop("Name"), e.g. if([Type] == "Income", [Amount], 0)`, p.formula ?? '', async (v) => { p.formula = v; await save(); }, true) });
    if (p.type === 'number' || p.type === 'formula')
        out.push({ label: 'Number format', icon: menuIcon('hash'), hint: NUMBER_FORMATS.find((f) => f[0] === (p.format ?? 'number'))?.[1], sub: () => numberFormatEntries(p.format ?? 'number', async (f) => { p.format = f; await save(); }) });
    if (['date', 'created_time', 'last_edited_time'].includes(p.type))
        out.push({ label: 'Date format', icon: menuIcon('calendar'), hint: p.dateFormat ?? 'Workspace default', sub: () => [
                { label: `${!p.dateFormat ? '✓ ' : ''}Workspace default`, run: async () => { delete p.dateFormat; await save(); } },
                ...DATE_FORMATS.map(([format, example]) => ({ label: `${p.dateFormat === format ? '✓ ' : ''}${example}`, run: async () => { p.dateFormat = format; await save(); } })),
            ] }, { label: 'Weekday', icon: menuIcon('calendar'), seg: { options: [['', 'Off'], ['short', 'Short'], ['long', 'Full']], value: p.weekday ?? '', pick: async (v) => { if (v)
                    p.weekday = v;
                else
                    delete p.weekday; await save(); } } });
    if (p.type === 'relation' && p.relation) {
        const target = ws.dbs.get(p.relation.db);
        const two = !!p.relation.reverse && !!target?.prop(p.relation.reverse);
        out.push({ label: 'Linked database', icon: menuIcon('database'), hint: target?.schema.name ?? '(deleted)', run: () => { } }, { label: two ? `Two-way: shown in ${target?.schema.name} as “${p.relation.reverse}”` : 'Show in the linked database too', icon: menuIcon('repeat'), run: async () => { ws.boundary(); if (two)
                await ws.makeOneWay(db, p);
            else
                await ws.makeTwoWay(db, p); redraw(); toast(two ? 'The relation is one-way now' : `“${p.relation?.reverse}” added to ${target?.schema.name}`); } });
    }
    if (p.type === 'rollup')
        out.push({ label: 'Rollup settings…', icon: menuIcon('search'), hint: p.rollup ? `${ROLLUP_LABEL[p.rollup.fn]}${p.rollup.fn === 'count' ? '' : ` of ${p.rollup.prop}`}` : 'not set', run: () => chooseRollup(db, p, anchor, async (chosen) => { p.rollup = chosen.rollup; await save(); }) });
    if (p.type === 'rollup' && p.rollup && ['sum', 'avg', 'min', 'max'].includes(p.rollup.fn))
        out.push({ label: 'Number format', icon: menuIcon('hash'), hint: p.format ? NUMBER_FORMATS.find((f) => f[0] === p.format)?.[1] : 'Like the property', sub: () => numberFormatEntries(p.format ?? '', async (f) => { if (f)
                p.format = f;
            else
                delete p.format; await save(); }, true) });
    if (p.type === 'select' || p.type === 'multi_select')
        out.push({ label: 'Options', icon: menuIcon('tags'), hint: String(p.options?.length ?? 0), sub: () => optionEntries(ws, db, p, anchor, redraw) });
    out.push({ section: 'Display' }, { label: 'On entry pages', icon: menuIcon('file-text'), seg: { options: [['', 'Show'], ['empty', 'If filled'], ['always', 'Hide']], value: p.pageHidden ?? '', pick: async (v) => { if (v)
                p.pageHidden = v;
            else
                delete p.pageHidden; await save(); } } });
    if (p.type !== 'title')
        out.push({ section: 'Arrange' }, { label: 'Duplicate property', icon: menuIcon('layers'), run: async () => {
                const copy = { ...structuredClone(p), name: uniqueName(db, `${p.name} (copy)`) };
                db.schema.properties.splice(db.schema.properties.indexOf(p) + 1, 0, copy);
                ws.boundary();
                for (const r of db.rows)
                    if (r.values[p.name] !== undefined) {
                        r.values[copy.name] = structuredClone(r.values[p.name]);
                        await ws.saveRow(db, r);
                    }
                await save();
            } });
    if (p.type !== 'title')
        out.push('sep', { label: 'Delete property', icon: menuIcon('trash'), danger: true, run: async () => {
                db.schema.properties = db.schema.properties.filter((x) => x !== p);
                // the property disappears from every view: columns, sorts, filters, grouping, colors …
                let filters = 0;
                for (const v of db.views)
                    removePropFromView(v, p.name, () => filters++);
                ws.boundary();
                await ws.saveSchema(db);
                await ws.saveViews(db);
                toast(`Property "${p.name}" deleted${filters ? ` and ${filters} filter${filters > 1 ? 's' : ''} removed` : ''} · values stay in the entry files`);
                redraw();
            } });
    return out;
}
function optionEntries(ws, db, p, anchor, redraw) {
    const save = async () => { ws.boundary(); await ws.saveSchema(db); redraw(); };
    const opts = p.options ?? [];
    return [
        { label: 'Add option…', icon: menuIcon('plus'), run: () => prompt(anchor, 'New option', '', async (name) => {
                name = name.trim();
                if (!name || opts.some((o) => o.name === name))
                    return;
                (p.options ??= []).push({ name, color: nextTagColor(opts.length) });
                await save();
            }) },
        ...(opts.length ? ['sep'] : []),
        ...opts.map((o) => ({
            label: o.name, icon: colorDot(o.color),
            sub: () => singleOptionEntries(ws, db, p, o, anchor, redraw),
        })),
    ];
}
/** Rename / colour / reorder / delete one option (from property settings or the value picker's ⋯). */
export function singleOptionEntries(ws, db, p, o, anchor, redraw) {
    const opts = p.options ?? [];
    const i = opts.indexOf(o);
    const save = async () => { ws.boundary(); await ws.saveSchema(db); redraw(); ws.emit(); };
    return [
        { label: 'Rename…', run: () => prompt(anchor, 'Option', o.name, async (v) => { if (await renameOption(ws, db, p, o, v)) {
                redraw();
                ws.emit();
            } }) },
        ...(i > 0 ? [{ label: 'Move up', run: async () => { [opts[i - 1], opts[i]] = [opts[i], opts[i - 1]]; await save(); } }] : []),
        ...(i >= 0 && i < opts.length - 1 ? [{ label: 'Move down', run: async () => { [opts[i + 1], opts[i]] = [opts[i], opts[i + 1]]; await save(); } }] : []),
        'sep',
        { section: 'Color' },
        ...colorEntries(o.color, async (c) => { o.color = c; await save(); }, { none: 'Default' }),
        'sep',
        { label: 'Delete option', danger: true, run: async () => {
                // as in Notion: the option disappears from every entry that used it (undo brings it back)
                ws.boundary();
                p.options = opts.filter((x) => x !== o);
                let n = 0;
                for (const r of db.rows) {
                    const cur = r.values[p.name];
                    if (cur === o.name) {
                        delete r.values[p.name];
                        await ws.saveRow(db, r);
                        n++;
                    }
                    else if (Array.isArray(cur) && cur.includes(o.name)) {
                        r.values[p.name] = cur.filter((x) => x !== o.name);
                        await ws.saveRow(db, r);
                        n++;
                    }
                }
                await ws.saveSchema(db);
                if (n)
                    toast(`Option "${o.name}" deleted and removed from ${n} ${n === 1 ? 'entry' : 'entries'}`);
                redraw();
                ws.emit();
            } },
    ];
}
/** Rename a select option everywhere: schema, every entry, filters and grouping of views. */
export async function renameOption(ws, db, p, o, to) {
    const v = to.trim();
    if (!v || v === o.name)
        return false;
    if ((p.options ?? []).some((x) => x.name === v)) {
        toast(`"${v}" already exists`);
        return false;
    }
    const old = o.name;
    o.name = v;
    ws.boundary();
    for (const r of db.rows) {
        const cur = r.values[p.name];
        if (cur === old) {
            r.values[p.name] = v;
            await ws.saveRow(db, r);
        }
        else if (Array.isArray(cur) && cur.includes(old)) {
            r.values[p.name] = cur.map((x) => (x === old ? v : x));
            await ws.saveRow(db, r);
        }
    }
    // keep view filters that used the old name working
    let views = false;
    const fix = (rules) => { for (const r of rules) {
        if (r.rules)
            fix(r.rules);
        else if (r.prop === p.name) {
            if (r.value === old) {
                r.value = v;
                views = true;
            }
            else if (Array.isArray(r.value) && r.value.includes(old)) {
                r.value = r.value.map((x) => (x === old ? v : x));
                views = true;
            }
        }
    } };
    for (const view of db.views) {
        if (view.filter)
            fix(view.filter.rules);
        // colour rules use the option's name too; so do folded groups
        for (const cr of view.colorRules ?? [])
            fix(cr.filter.rules);
        for (const g of [view.groupBy, view.subGroupBy])
            if (g?.prop === p.name && g.closed?.includes(old)) {
                g.closed = g.closed.map((x) => (x === old ? v : x));
                views = true;
            }
    }
    await ws.saveSchema(db);
    if (views)
        await ws.saveViews(db);
    return true;
}
/** Remove every use of a property from a view (after the property was deleted). */
export function removePropFromView(v, name, onFilter = () => { }) {
    v.props = v.props?.filter((x) => x !== name);
    v.sorts = v.sorts?.filter((s) => s.prop !== name);
    if (v.sorts && !v.sorts.length)
        delete v.sorts;
    const strip = (g) => ({ ...g, rules: g.rules.flatMap((r) => {
            if ('rules' in r) {
                const inner = strip(r);
                return inner.rules.length ? [inner] : [];
            }
            if (r.prop === name) {
                onFilter();
                return [];
            }
            return [r];
        }) });
    if (v.filter) {
        v.filter = strip(v.filter);
        if (!v.filter.rules.length)
            delete v.filter;
    }
    if (v.groupBy?.prop === name)
        delete v.groupBy;
    if (v.colorBy === name)
        delete v.colorBy;
    if (v.timeProp === name)
        delete v.timeProp;
    if (v.period?.prop === name)
        delete v.period;
    if (v.dateProp === name)
        delete v.dateProp;
    if (v.cover === name)
        v.cover = 'content';
    if (v.chart?.groupBy === name || v.chart?.prop === name)
        delete v.chart;
    if (v.widths)
        delete v.widths[name];
    if (v.aggregates)
        delete v.aggregates[name];
    v.wrap = v.wrap?.filter((x) => x !== name);
    if (v.wrap && !v.wrap.length)
        delete v.wrap;
}
// ---------- relations and rollups ----------
const ROLLUP_LABEL = {
    count: 'Count entries', count_values: 'Count values', sum: 'Sum', avg: 'Average', min: 'Minimum', max: 'Maximum',
    earliest: 'Earliest date', latest: 'Latest date', show: 'Show values', percent_checked: 'Percent checked',
};
/** a relation: which database it links to, and whether the link shows on the other side too */
function chooseRelationTarget(ws, db, def, anchor, done) {
    menu(anchor, [
        ...[...ws.dbs.values()].sort((a, b) => a.schema.name.localeCompare(b.schema.name)).map((t) => ({
            label: t === db ? `${t.schema.name} (this database)` : t.schema.name, icon: menuIcon('database'),
            run: () => {
                def.relation = { db: t.key };
                menu(anchor, [
                    { section: `Show the links in ${t.schema.name} too?` },
                    { label: `Yes – add “${t === db ? `${def.name} (back)` : db.schema.name}” to ${t.schema.name}`, run: () => done(true, def) },
                    { label: `No – only in ${db.schema.name}`, run: () => done(false, def) },
                ]);
            },
        })),
    ], { filter: true });
}
/** a rollup: through which relation, which property of the linked entries, and what to calculate */
function chooseRollup(db, def, anchor, done) {
    const rels = db.schema.properties.filter((p) => p.type === 'relation' && p.relation);
    if (!rels.length) {
        toast('Add a relation first – a rollup calculates over the entries a relation links to');
        return;
    }
    const pickRel = (rel) => {
        const target = Database.lookup(rel.relation.db);
        if (!target) {
            toast('The linked database no longer exists');
            return;
        }
        menu(anchor, [
            { section: `Count the linked entries` },
            { label: ROLLUP_LABEL.count, run: () => { def.rollup = { relation: rel.name, prop: target.titleProp, fn: 'count' }; done(def); } },
            { section: `Or use a property of ${target.schema.name}` },
            ...target.schema.properties.filter((p) => p.type !== 'relation' && p.type !== 'rollup').map((tp) => ({
                label: tp.name, icon: typeIcon(tp.type),
                sub: () => fnsFor(tp.type).map((fn) => ({ label: ROLLUP_LABEL[fn], run: () => { def.rollup = { relation: rel.name, prop: tp.name, fn }; done(def); } })),
            })),
        ], { filter: true });
    };
    if (rels.length === 1) {
        pickRel(rels[0]);
        return;
    }
    menu(anchor, [{ section: 'Through which relation?' }, ...rels.map((r) => ({ label: r.name, icon: typeIcon('relation'), run: () => pickRel(r) }))]);
}
/** what can be calculated from a property */
function fnsFor(t) {
    if (t === 'number' || t === 'formula')
        return ['sum', 'avg', 'min', 'max', 'show', 'count_values'];
    if (t === 'date' || t === 'created_time' || t === 'last_edited_time')
        return ['earliest', 'latest', 'show', 'count_values'];
    if (t === 'checkbox')
        return ['percent_checked', 'count_values'];
    return ['show', 'count_values'];
}
//# sourceMappingURL=propmenu.js.map