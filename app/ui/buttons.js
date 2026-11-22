import { resolveDate } from '../workspace.js';
import { safeHref, COLORS, tintVars, WEEKDAYS_LONG, colorLabel, fmtDay, fmtTime, h, svgIcon, ICONS, todayISO, ulid, dayNum, parseTime, isLarge, segmented } from '../util.js';
import { dialog, menu, toast, menuIcon } from './pop.js';
import { dbItems, pageItems, linkItems, pickerControl } from './pickers.js';
import { renderIcon, iconSvg } from './icons.js';
import { pickIcon } from './iconpicker.js';
import { switchControl, selectControl } from './settings.js';
import { typeIcon } from '../views/cells.js';
import { parsePage, serializePage } from '../format/page.js';
import { Editor } from './editor.js';
import { eventToKey, prettyKey } from './commands.js';
const STEP_TYPES = [
    { type: 'add', label: 'Add entry to a database', icon: 'plus-circle', desc: 'With preset properties and content – a template for new entries' },
    { type: 'page', label: 'Create a page', icon: 'file-plus', desc: 'A subpage of this page (or elsewhere), optionally copied from a template page' },
    { type: 'insert', label: 'Insert blocks', icon: 'list', desc: 'Add text, to-dos, headings … next to the button' },
    { type: 'edit', label: 'Edit entries', icon: 'pencil', desc: 'Set properties on entries of a database (e.g. archive everything that is done)' },
    { type: 'open', label: 'Open a page or database', icon: 'external', desc: '' },
    { type: 'url', label: 'Open a link', icon: 'link', desc: '' },
];
/** steps of a button; old buttons (action/target) become one step */
export function stepsOf(b) {
    if (b.steps)
        return b.steps;
    if (b.action === 'add' && b.target)
        return [{ type: 'add', db: b.target, open: 'peek' }];
    if (b.action === 'open' && b.target)
        return [{ type: 'open', target: b.target }];
    if (b.action === 'opendb' && b.target)
        return [{ type: 'open', target: `db:${b.target}` }];
    if (b.action === 'url' && b.target)
        return [{ type: 'url', href: b.target }];
    return [];
}
/** {{date}} {{time}} {{weekday}} {{page}} in texts */
/** the short to-do form people type in templates ("[] Milch", "[x] Brot") → Markdown to-dos */
const todoLines = (s) => s.replace(/^(\s*)\[( |x|X)?\]\s+/gm, (_m, ind, x) => `${ind}- [${x && x.trim() ? 'x' : ' '}] `);
function fillVars(s, pageTitle = '') {
    const now = new Date();
    const today = todayISO();
    return s.replace(/\{\{\s*(date|today|time|weekday|page)\s*\}\}/gi, (_m, k) => {
        switch (k.toLowerCase()) {
            case 'date':
            case 'today': return fmtDay(today);
            case 'time': return fmtTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
            case 'weekday': return WEEKDAYS_LONG[(dayNum(today) + 3) % 7];
            default: return pageTitle;
        }
    });
}
/** preset values → real values (dates from tokens, variables in texts) */
function resolveValues(db, values, pageTitle) {
    const out = {};
    for (const [k, v] of Object.entries(values ?? {})) {
        const def = db.prop(k);
        if (!def || v == null || v === '')
            continue;
        if (def.type === 'date') {
            const raw = typeof v === 'object' && !Array.isArray(v) ? v.start : String(v);
            const pad = (n) => String(n).padStart(2, '0'), now = new Date();
            const [day, time] = raw.split(' ');
            out[k] = { start: day === 'now' || day === '@now' ? `${todayISO()}T${pad(now.getHours())}:${pad(now.getMinutes())}` : resolveDate(day) + (time ? `T${time}` : '') };
        }
        else if (typeof v === 'string')
            out[k] = fillVars(v, pageTitle);
        else
            out[k] = v;
    }
    return out;
}
const deepClone = (b) => ({ ...structuredClone(b), id: ulid(), children: b.children?.map(deepClone) });
export async function runButton(b, host, anchor) {
    const steps = stepsOf(b);
    if (!steps.length) {
        toast('This button does nothing yet – open its settings to add steps');
        return;
    }
    if (b.confirm && anchor) {
        menu(anchor, [{ section: `Run “${b.text || 'Button'}”?` }, { label: 'Run', icon: menuIcon('play'), run: () => run(steps, host) }, { label: 'Cancel', run: () => { } }]);
        return;
    }
    await run(steps, host);
}
async function run(steps, host) {
    const { ctx } = host;
    const ws = ctx.ws;
    const pageTitle = host.pageId ? ws.pages.get(host.pageId)?.title ?? '' : '';
    ws.boundary();
    let openLater = null;
    for (const s of steps) {
        try {
            switch (s.type) {
                case 'add': {
                    const db = ws.dbs.get(s.db);
                    if (!db) {
                        toast(`Database not found (${s.db})`);
                        break;
                    }
                    const row = await ws.addRow(db, resolveValues(db, s.values, pageTitle), s.template || undefined);
                    if (s.body?.trim()) {
                        row.body = [row.body, fillVars(s.body, pageTitle)].filter((x) => x.trim()).join('\n\n');
                        await ws.saveRow(db, row);
                    }
                    if (s.open !== 'none')
                        openLater = () => (s.open === 'page' ? ctx.openRowPage(db, row) : ctx.openRow(db, row, { isNew: true }));
                    else
                        toast(`Added to ${db.schema.name}`);
                    break;
                }
                case 'page': {
                    const parent = !s.parent || s.parent === 'here' ? host.pageId : s.parent === 'top' ? undefined : s.parent;
                    const tpl = s.template ? ws.pages.get(s.template) : undefined;
                    const p = await ws.createPage(fillVars(s.title || 'Untitled', pageTitle), parent);
                    if (tpl) {
                        p.blocks = tpl.blocks.map(deepClone);
                        p.icon = tpl.icon;
                        await ws.savePage(p);
                    }
                    if (s.open !== false)
                        openLater = () => ctx.openPage(p.id);
                    else
                        toast(`Page “${p.title}” created`);
                    break;
                }
                case 'insert': {
                    const blocks = parsePage(todoLines(fillVars(s.text ?? '', pageTitle)));
                    if (blocks.length)
                        host.insert(blocks, s.where ?? 'below');
                    break;
                }
                case 'edit': {
                    const db = ws.dbs.get(s.db);
                    if (!db)
                        break;
                    const vals = resolveValues(db, s.values, pageTitle);
                    const match = db.rows.filter((r) => {
                        if (!s.prop)
                            return true;
                        const v = db.value(r, s.prop);
                        const want = s.equals ?? '';
                        if (want === '')
                            return v == null || v === '' || (Array.isArray(v) && !v.length) || v === false;
                        if (want === 'true' || want === 'false')
                            return String(v === true) === want;
                        return Array.isArray(v) ? v.includes(want) : String(v ?? '') === want;
                    });
                    for (const r of match) {
                        Object.assign(r.values, vals);
                        await ws.saveRow(db, r);
                    }
                    toast(`${match.length} ${match.length === 1 ? 'entry' : 'entries'} changed in ${db.schema.name}`);
                    ws.emit();
                    break;
                }
                case 'open':
                    openLater = () => { if (s.target.startsWith('db:'))
                        ctx.openDb(s.target.slice(3));
                    else if (s.peek && ctx.peekPage)
                        ctx.peekPage(s.target);
                    else
                        ctx.openPage(s.target); };
                    break;
                case 'url':
                    if (s.href && safeHref(s.href) !== '#')
                        window.open(safeHref(s.href), '_blank', 'noopener');
                    break;
            }
        }
        catch (e) {
            toast(`A step failed: ${e.message}`);
        }
    }
    ws.emit();
    openLater?.();
}
// ---------- settings window ----------
/** a small page to write a template in – the same editor (and styling) as every page; stored as text */
function richField(ctx, text, change, placeholder = 'Write the template…') {
    const blocks = text.trim() ? parsePage(todoLines(text)) : [{ id: ulid(), type: 'paragraph', text: '' }];
    const ed = new Editor(blocks, ctx, () => change(serializePage(blocks).trim()));
    const box = h('div', { class: 'brich', 'data-placeholder': placeholder }, ed.el);
    // every change is kept at once (the editor itself saves a moment later)
    for (const ev of ['input', 'click', 'keyup'])
        box.addEventListener(ev, () => setTimeout(() => change(serializePage(blocks).trim()), 0));
    // keys stay in the editor (Esc still closes the window)
    box.addEventListener('keydown', (e) => { if (e.key !== 'Escape' && !((e.metaKey || e.ctrlKey) && e.key === 'Enter'))
        e.stopPropagation(); });
    return box;
}
/** one row of the settings: name (and a short hint) left, its control right – as in the Settings window */
const field = (label, ...el) => h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, label)), h('div', { class: 'set-control' }, ...el));
/** a row whose control needs the full width (a template, a list of properties) */
const wfield = (label, el, hint) => h('div', { class: 'set-row wide' }, h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, label), hint ? h('div', { class: 'set-desc' }, hint) : null), h('div', { class: 'set-wide' }, el));
/** a group: small heading and a card of rows */
const group = (title, ...rows) => h('section', { class: 'set-sec' }, h('div', { class: 'set-heading' }, h('h3', null, title)), h('div', { class: 'set-card' }, ...rows));
/** chips that put a variable into a text field at the caret */
function varChips(target, after) {
    return h('div', { class: 'bvars' }, [['date', 'Date'], ['time', 'Time'], ['weekday', 'Weekday'], ['page', 'Page name']].map(([k, l]) => h('button', { type: 'button', class: 'bvar', onclick: () => {
            const inp = target();
            if (!inp)
                return;
            const a = inp.selectionStart ?? inp.value.length, z = inp.selectionEnd ?? a, tok = `{{${k}}}`;
            inp.value = inp.value.slice(0, a) + tok + inp.value.slice(z);
            inp.focus();
            inp.setSelectionRange(a + tok.length, a + tok.length);
            inp.dispatchEvent(new Event('input'));
            after();
        } }, `+ ${l}`)));
}
/** properties of a step, folded into one line ("Date: Today · Status: Offen"); a click opens the list */
function foldedValues(db, values, toggle) {
    const txt = Object.entries(values).filter(([k]) => db?.prop(k)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v === true ? '✓' : v === false ? '–' : typeof v === 'object' && v ? v.start : String(v ?? '')}`).join(' · ');
    return h('button', { type: 'button', class: 'set-btn bfold', onclick: toggle }, h('span', { class: 'bfold-t' }, txt || 'None'), svgIcon(ICONS.chevron, 11));
}
function input(value, change, placeholder = '', multiline = false) {
    const el = (multiline ? h('textarea', { class: 'set-input', rows: 4, placeholder }) : h('input', { type: 'text', class: 'set-input', placeholder }));
    el.value = value;
    el.addEventListener('input', () => change(el.value));
    el.addEventListener('keydown', (e) => { if (e.key !== 'Escape')
        e.stopPropagation(); });
    return el;
}
/** Nook's dropdown (never the system list) */
function select(opts, value, change) {
    return selectControl(opts, value, change, 'Choose');
}
const DATE_TOKENS = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['yesterday', 'Yesterday'], ['+7d', 'In a week'], ['+30d', 'In 30 days']];
/** editor for one preset property value */
function valueField(def, v, change) {
    switch (def.type) {
        case 'checkbox': return select([['true', 'Checked'], ['false', 'Unchecked']], v === false ? 'false' : 'true', (x) => change(x === 'true'));
        case 'select': return select((def.options ?? []).map((o) => [o.name, o.name]), String(v ?? def.options?.[0]?.name ?? ''), change);
        case 'multi_select': {
            const cur = new Set(Array.isArray(v) ? v.map(String) : []);
            const box = h('div', { class: 'bchips' });
            for (const o of def.options ?? []) {
                const chip = h('button', { type: 'button', class: 'bchip' + (cur.has(o.name) ? ' on' : ''), style: { background: cur.has(o.name) ? COLORS[o.color].tag : '' } }, o.name);
                chip.addEventListener('click', (e) => { e.preventDefault(); if (cur.has(o.name))
                    cur.delete(o.name);
                else
                    cur.add(o.name); chip.classList.toggle('on'); chip.style.background = cur.has(o.name) ? COLORS[o.color].tag : ''; change([...cur]); });
                box.appendChild(chip);
            }
            return box;
        }
        case 'date': {
            // stored as "<day>" or "<day> HH:MM" ("today", "+7d", "2026-11-03 09:30"), or "now"
            const raw = typeof v === 'object' && v && !Array.isArray(v) ? v.start : String(v ?? 'today');
            const [day0, time0 = ''] = raw.split(' ');
            let day = day0, time = time0;
            const known = day === 'now' || DATE_TOKENS.some(([t]) => t === day);
            const wrap = h('div', { class: 'bfield-row' });
            const custom = input(known ? '' : day, (x) => { day = x.trim(); emit(); }, 'YYYY-MM-DD or +3d');
            custom.style.display = known ? 'none' : '';
            const timeIn = input(time, (x) => { const t = parseTime(x); time = t ?? ''; emit(); }, 'Time (optional)');
            timeIn.classList.add('btime');
            timeIn.disabled = day === 'now'; // "Now" brings its own time: greyed out, not gone
            const emit = () => change(day === 'now' ? 'now' : time ? `${day} ${time}` : day);
            wrap.append(select([['now', 'Now (date and time)'], ...DATE_TOKENS, ['custom', 'Other date…']], known ? day : 'custom', (x) => {
                custom.style.display = x === 'custom' ? '' : 'none';
                timeIn.disabled = x === 'now';
                if (x !== 'custom') {
                    day = x;
                    emit();
                }
            }), custom, timeIn);
            return wrap;
        }
        case 'number': return input(v == null ? '' : String(v), (x) => change(x.trim() === '' ? null : Number(x.replace(',', '.'))), '0');
        default: {
            // text: the same {{date}} / {{time}} / … chips as in the capture block's name pattern
            const inp = input(v == null ? '' : String(v), change, def.type === 'title' ? 'Name, e.g. Entry from {{date}}' : '');
            if (def.type !== 'title' && def.type !== 'text' && def.type !== 'url')
                return inp;
            return h('div', { class: 'bvar-field' }, inp, varChips(() => inp, () => { }));
        }
    }
}
/** "Set properties" list (for add / edit steps) */
function valuesEditor(db, values, change, redraw) {
    const box = h('div', { class: 'bvalues' });
    if (!db)
        return box;
    for (const [k, v] of Object.entries(values)) {
        const def = db.prop(k);
        if (!def)
            continue;
        box.appendChild(h('div', { class: 'bvalue' }, h('span', { class: 'bvalue-name' }, typeIcon(def.type), k), valueField(def, v, (x) => { values[k] = x; change(); }), h('button', { type: 'button', class: 'icon-btn rule-x', 'aria-label': `Remove ${k}`, title: 'Remove', onclick: () => { delete values[k]; change(); redraw(); } }, iconSvg('trash', 14))));
    }
    const can = db.schema.properties.filter((p) => !(p.name in values) && !['formula', 'created_time', 'last_edited_time', 'files'].includes(p.type));
    if (can.length) {
        const add = h('button', { type: 'button', class: 'set-btn small' }, '+ Set a property');
        add.addEventListener('click', () => menu(add, can.map((p) => ({ label: p.name, icon: typeIcon(p.type), run: () => {
                values[p.name] = p.type === 'checkbox' ? true : p.type === 'date' ? 'today' : p.type === 'select' ? p.options?.[0]?.name ?? '' : p.type === 'multi_select' ? [] : '';
                change();
                redraw();
            } }))));
        box.appendChild(add);
    }
    return box;
}
export function buttonSettings(ctx, target, onChange, pageId, groupPerRow) {
    const ws = ctx.ws;
    // changes go to a copy; "Save" puts them on the button, Esc asks what to do with them
    const b = { id: target.id, type: 'button', text: target.text, icon: target.icon, color: target.color, colorStyle: target.colorStyle, size: target.size, perRow: groupPerRow?.() ?? target.perRow, confirm: target.confirm, steps: stepsOf(target).map((s) => structuredClone(s)) };
    const snapshot = () => JSON.stringify([jumpKey, b.text ?? '', b.icon ?? '', b.color ?? '', b.colorStyle ?? '', b.size ?? '', b.perRow ?? 0, !!b.confirm, b.steps]);
    // the button's keyboard shortcut (shared with Settings → Custom shortcuts)
    const jumpOf = () => (ws.settings.jumps ?? []).find((j) => !!j.button && j.button.page === pageId && (j.button.block === target.id || (!!j.button.label && j.button.label === (target.text ?? ''))));
    let jumpKey = jumpOf()?.key ?? '';
    // taken after the first draw: drawing fills in defaults (e.g. empty value lists) that are not changes
    let initial = '';
    const dirty = () => snapshot() !== initial;
    const body = h('div', { class: 'bsettings bwin' });
    const save = () => { if (previewEl) {
        previewEl.textContent = '';
        previewEl.appendChild(buttonEl(b, () => { }));
    } };
    let previewEl = null;
    let dragFrom = -1;
    /** steps whose property list is open */
    const openVals = new Set();
    const stepCard = (s, i) => {
        const meta = STEP_TYPES.find((t) => t.type === s.type);
        const steps = b.steps;
        const card = h('div', { class: 'set-card bstep' });
        const grip = h('span', { class: 'rule-grip bstep-grip', title: 'Drag to move' }, svgIcon(ICONS.grip, 14, { fill: true }));
        const moreBtn = h('button', { type: 'button', class: 'icon-btn set-more', 'aria-label': 'Step menu', onclick: (e) => {
                e.stopPropagation();
                menu(moreBtn, [
                    ...(i > 0 ? [{ label: 'Move up', icon: iconSvg('arrow-up', 16), run: () => { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; save(); draw(); } }] : []),
                    ...(i < steps.length - 1 ? [{ label: 'Move down', icon: iconSvg('arrow-down', 16), run: () => { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; save(); draw(); } }] : []),
                    ...(steps.length > 1 ? ['sep'] : []),
                    { label: 'Remove step', danger: true, run: () => { steps.splice(i, 1); save(); draw(); } },
                ]);
            } }, svgIcon(ICONS.more, 15, { fill: true }));
        card.appendChild(h('div', { class: 'bstep-head' }, grip, h('span', { class: 'bstep-num' }, String(i + 1)), h('strong', null, meta.label), moreBtn));
        // drag the grip to reorder the steps
        grip.addEventListener('mousedown', () => { card.draggable = true; });
        card.addEventListener('dragstart', (e) => { dragFrom = i; e.dataTransfer?.setData('text/plain', String(i)); card.classList.add('dragging'); });
        card.addEventListener('dragend', () => { card.draggable = false; card.classList.remove('dragging'); });
        card.addEventListener('dragover', (e) => { if (dragFrom < 0)
            return; e.preventDefault(); card.classList.add('drop-target'); });
        card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
        card.addEventListener('drop', (e) => { e.preventDefault(); if (dragFrom < 0 || dragFrom === i) {
            dragFrom = -1;
            return;
        } const [it] = steps.splice(dragFrom, 1); steps.splice(i, 0, it); dragFrom = -1; save(); draw(); });
        const f = h('div', { class: 'bstep-body' });
        void meta;
        switch (s.type) {
            case 'add': {
                const db = ws.dbs.get(s.db);
                f.append(field('Database', pickerControl({ value: s.db, items: () => dbItems(ws), change: (v) => { s.db = v; s.values = {}; delete s.template; save(); draw(); }, placeholder: 'Choose a database…' })), ...(db?.schema.templates?.length ? [field('Database template', select([['', 'None'], ...db.schema.templates.map((t) => [t.name, t.name])], s.template ?? '', (v) => { if (v)
                        s.template = v;
                    else
                        delete s.template; save(); }))] : []), (openVals.has(s) ? wfield('Properties', valuesEditor(db, (s.values ??= {}), save, draw)) : field('Properties', foldedValues(db, (s.values ??= {}), () => { openVals.add(s); draw(); }))), wfield('Content', richField(ctx, s.body ?? '', (v) => { s.body = v; save(); }), 'Written like a page'), field('Open the new entry', segmented([['none', 'No'], ['peek', 'Center peek'], ['page', 'Full page']], s.open ?? 'peek', (v) => { s.open = v; save(); }, 'Open the new entry')));
                break;
            }
            case 'page':
                f.append(field('Title', (() => { const inp = input(s.title ?? '', (v) => { s.title = v; save(); }, 'e.g. Meeting {{date}}'); return h('div', { class: 'bvar-field' }, inp, varChips(() => inp, () => { })); })()), field('Where', pickerControl({ value: s.parent ?? 'here', items: () => [{ value: 'here', label: 'Inside this page' }, { value: 'top', label: 'Top level' }, ...pageItems(ws).map((x) => ({ ...x, label: `Inside “${x.label}”` }))], change: (v) => { s.parent = v; save(); } })), field('Template page', pickerControl({ value: s.template ?? '', items: () => [{ value: '', label: 'None – start empty' }, ...pageItems(ws, (p) => p.id === pageId)], change: (v) => { if (v)
                        s.template = v;
                    else
                        delete s.template; save(); } }), h('span', { class: 'bfield-hint' }, 'Its content and icon are copied into the new page.')), field('Open the new page', segmented([['stay', 'No'], ['open', 'Yes']], s.open === false ? 'stay' : 'open', (v) => { s.open = v === 'open'; save(); }, 'Open the new page')));
                break;
            case 'insert':
                f.append(wfield('Blocks', richField(ctx, s.text ?? '', (v) => { s.text = v; save(); }), 'Written like a page'), field('Where', segmented([['above', 'Above the button'], ['below', 'Below the button']], s.where ?? 'below', (v) => { s.where = v; save(); }, 'Where')));
                break;
            case 'edit': {
                const db = ws.dbs.get(s.db);
                const props = db?.schema.properties ?? [];
                const cond = s.prop ? db?.prop(s.prop) : undefined;
                f.append(field('Database', pickerControl({ value: s.db, items: () => dbItems(ws), change: (v) => { s.db = v; s.values = {}; delete s.prop; delete s.equals; save(); draw(); }, placeholder: 'Choose a database…' })), field('Which entries', h('div', { class: 'bfield-row' }, select([['', 'All entries'], ...props.filter((p) => ['select', 'multi_select', 'checkbox', 'text', 'title'].includes(p.type)).map((p) => [p.name, `Where ${p.name} is…`])], s.prop ?? '', (v) => { if (v)
                    s.prop = v;
                else
                    delete s.prop; s.equals = ''; save(); draw(); }), cond ? (cond.type === 'checkbox' ? select([['true', 'checked'], ['false', 'unchecked']], s.equals || 'true', (v) => { s.equals = v; save(); })
                    : cond.options ? select([['', '(empty)'], ...cond.options.map((o) => [o.name, o.name])], s.equals ?? '', (v) => { s.equals = v; save(); })
                        : input(s.equals ?? '', (v) => { s.equals = v; save(); }, 'value (empty = empty)')) : null)), (openVals.has(s) ? wfield('Set', valuesEditor(db, (s.values ??= {}), save, draw)) : field('Set', foldedValues(db, (s.values ??= {}), () => { openVals.add(s); draw(); }))));
                break;
            }
            case 'open':
                f.append(field('Open', pickerControl({ value: s.target, items: () => [...linkItems(ws), ...dbItems(ws).map((x) => ({ ...x, value: `db:${x.value}`, hint: 'Database' }))], change: (v) => { s.target = v; save(); draw(); }, placeholder: 'Choose a page or database…' })));
                // pages can open in the centre peek (databases always open as a page)
                if (!s.target.startsWith('db:'))
                    f.append(field('Open in center peek', switchControl(!!s.peek, (v) => { if (v)
                        s.peek = true;
                    else
                        delete s.peek; save(); }, 'Open in center peek')));
                break;
            case 'url':
                f.append(field('Link', input(s.href ?? '', (v) => { s.href = v; save(); }, 'https://')));
                break;
        }
        card.appendChild(f);
        return card;
    };
    const newStep = (t) => {
        const db = [...ws.dbs.keys()][0] ?? '';
        switch (t) {
            case 'add': return { type: 'add', db, values: {}, open: 'peek' };
            case 'page': return { type: 'page', title: 'New page', parent: 'here', open: true };
            case 'insert': return { type: 'insert', text: '', where: 'below' };
            case 'edit': return { type: 'edit', db, values: {} };
            case 'open': return { type: 'open', target: [...ws.pages.keys()][0] ?? '' };
            case 'url': return { type: 'url', href: 'https://' };
        }
    };
    const draw = () => {
        const keep = body.parentElement?.scrollTop ?? 0;
        body.textContent = '';
        // appearance
        const label = input(b.text ?? '', (v) => { b.text = v; save(); }, 'Button label');
        const iconBtn = h('button', { type: 'button', class: 'set-btn icon-pick-btn' + (b.icon ? '' : ' empty'), title: b.icon ? 'Change icon' : 'Add an icon', 'aria-label': 'Button icon' }, b.icon ? renderIcon(b.icon, 16) : iconSvg('sparkles', 16));
        iconBtn.addEventListener('click', () => pickIcon(iconBtn, b.icon, (v) => { if (v)
            b.icon = v;
        else
            delete b.icon; save(); draw(); }));
        const shortcut = (() => {
            if (!pageId)
                return h('span', { class: 'set-value' }, 'Only on pages');
            const kb = h('button', { type: 'button', class: 'key-btn', title: 'Click, then press keys (Esc or Backspace: none)' }, prettyKey(jumpKey) || 'None');
            kb.addEventListener('click', () => {
                kb.classList.add('rec');
                kb.textContent = 'Press keys…';
                const rec = (e) => { e.preventDefault(); e.stopPropagation(); const k = eventToKey(e); if (!k)
                    return; document.removeEventListener('keydown', rec, true); jumpKey = k === 'Escape' || k === 'Backspace' ? '' : k; kb.classList.remove('rec'); kb.textContent = prettyKey(jumpKey) || 'None'; };
                document.addEventListener('keydown', rec, true);
            });
            return kb;
        })();
        body.append(group('Button', field('Label', iconBtn, label), field('Color', tintRow(b, () => { save(); draw(); })), ...(b.color ? [field('Style', segmented([['fill', 'Filled'], ['outline', 'Outline']], b.colorStyle === 'outline' ? 'outline' : 'fill', (v) => { if (v === 'outline')
                b.colorStyle = 'outline';
            else
                delete b.colorStyle; save(); }, 'Style'))] : []), field('Size', segmented([['normal', 'Normal'], ['large', 'Large']], isLarge(b) ? 'large' : 'normal', (v) => { b.size = v; save(); draw(); }, 'Size')), h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, 'Per row'), h('div', { class: 'set-desc' }, 'When several buttons follow each other')), h('div', { class: 'set-control' }, segmented([['', 'Auto'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], b.perRow ? String(b.perRow) : '', (v) => { if (v)
            b.perRow = +v;
        else
            delete b.perRow; save(); }, 'Per row'))), field('Ask before running', switchControl(!!b.confirm, (v) => { if (v)
            b.confirm = true;
        else
            delete b.confirm; save(); }, 'Ask before running')), field('Shortcut', shortcut)));
        body.append(h('section', { class: 'set-sec' }, h('div', { class: 'set-heading' }, h('h3', null, 'When clicked'))));
        const steps = b.steps;
        steps.forEach((s, i) => body.appendChild(stepCard(s, i)));
        const add = h('button', { type: 'button', class: 'set-add' }, h('span', { class: 'set-add-ico' }, svgIcon(ICONS.plus, 13)), h('span', null, steps.length ? 'Add a step' : 'Add a step – they run one after another'));
        add.addEventListener('click', () => menu(add, STEP_TYPES.map((t) => ({ label: t.label, hint: '', icon: menuIcon(t.icon), run: () => { steps.push(newStep(t.type)); save(); draw(); } }))));
        body.append(h('div', { class: 'set-card' }, add));
        requestAnimationFrame(() => { if (body.parentElement)
            body.parentElement.scrollTop = keep; });
    };
    const preview = () => { previewEl = h('span', { class: 'b-button-preview' }, buttonEl(b, () => { })); return previewEl; };
    draw();
    initial = snapshot();
    const commit = () => {
        target.text = b.text;
        target.icon = b.icon;
        target.color = b.color;
        target.steps = b.steps;
        if (b.size)
            target.size = b.size;
        else
            delete target.size;
        if (b.colorStyle)
            target.colorStyle = b.colorStyle;
        else
            delete target.colorStyle;
        if (pageId) {
            const cur = jumpOf();
            const changed = (cur?.key ?? '') !== jumpKey;
            if (jumpKey && cur) {
                cur.key = jumpKey;
                cur.button = { page: pageId, block: target.id, label: b.text ?? '' };
            }
            else if (jumpKey)
                (ws.settings.jumps ??= []).push({ id: Math.random().toString(36).slice(2, 8), key: jumpKey, button: { page: pageId, block: target.id, label: b.text ?? '' } });
            else if (cur) {
                ws.settings.jumps = ws.settings.jumps.filter((j) => j !== cur);
                if (!ws.settings.jumps.length)
                    delete ws.settings.jumps;
            }
            if (changed || cur) {
                void ws.saveSettings();
                ctx.registerActions?.();
            }
        }
        if (b.perRow)
            target.perRow = b.perRow;
        else
            delete target.perRow;
        if (b.confirm)
            target.confirm = true;
        else
            delete target.confirm;
        for (const k of ['icon', 'color'])
            if (!target[k])
                delete target[k];
        delete target.action;
        delete target.target;
        onChange();
    };
    const box = h('div', { class: 'bwindow' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px' } }, 'Button settings'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => ask() }, svgIcon(ICONS.close, 15))), h('div', { class: 'bprev-top' }, preview()), h('div', { class: 'dialog-body pset bset-phone' }, body), h('div', { class: 'bfooter' }, h('button', { class: 'set-btn', onclick: () => ask() }, 'Cancel'), h('button', { class: 'btn-new', onclick: () => { commit(); close(); } }, 'Save')));
    /** closing with unsaved changes: keep editing, save or discard */
    const ask = () => {
        if (!dirty()) {
            close();
            return true;
        }
        const r = box.getBoundingClientRect();
        menu({ x: r.left + r.width / 2 - 120, y: r.top + 60 }, [
            { section: 'You have unsaved changes' },
            { label: 'Keep editing', hint: 'Esc', run: () => { } },
            { label: 'Save', run: () => { commit(); close(); } },
            'sep',
            { label: 'Discard changes', danger: true, run: () => close() },
        ]);
        return false;
    };
    const close = dialog(box, { wide: true, beforeClose: () => ask() });
    // ⌘/Ctrl+Enter saves and closes
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        document.activeElement?.blur();
        setTimeout(() => { commit(); close(); }, 0);
    } }, true);
}
/** colour of a button or page link: a soft fill with a brighter border (like callouts), or only the border */
export function tintStyle(el, b) {
    const c = b.color?.replace(/_bg$/, '');
    el.classList.remove('tinted', 'fill', 'outline');
    tintVars(el, undefined);
    if (!c || c === 'default')
        return;
    tintVars(el, c);
    el.classList.add('tinted', b.colorStyle === 'outline' ? 'outline' : 'fill');
}
/** a colour dot (custom property set properly, so the colour shows) */
function tintVar(el, c) { if (c)
    el.style.setProperty('--tint', c === 'accent' ? 'var(--accent)' : COLORS[c]?.text ?? 'var(--accent)'); return el; }
/** colours as a row of dots plus Fill / Outline (Button settings) */
export function tintRow(b, changed) {
    const cur = b.color?.replace(/_bg$/, '');
    const dot = (c, label) => {
        const el = tintVar(h('button', { type: 'button', class: 'tint-dot' + (c ? '' : ' none') + ((cur ?? undefined) === c ? ' on' : ''), title: label, 'aria-label': label, 'aria-pressed': String((cur ?? undefined) === c) }), c);
        el.addEventListener('click', () => { if (c)
            b.color = c;
        else {
            delete b.color;
            delete b.colorStyle;
        } changed(); });
        return el;
    };
    const row = h('div', { class: 'tint-row' }, dot(undefined, 'Default'), dot('accent', 'Accent'), ...Object.keys(COLORS).filter((c) => c !== 'default').map((c) => dot(c, colorLabel(c))));
    // Fill / Outline is always there (greyed out without a colour), so nothing moves when you pick
    const style = segmented([['fill', 'Fill', 'Soft fill with a brighter border'], ['outline', 'Outline', 'Only the border']], b.colorStyle === 'outline' ? 'outline' : 'fill', (v) => { if (v === 'outline')
        b.colorStyle = 'outline';
    else
        delete b.colorStyle; changed(); }, 'Style', 'small tint-style' + (cur ? '' : ' off'));
    if (!cur)
        style.title = 'Choose a color first';
    row.append(style);
    return row;
}
/** the colours a button or page link can have, with a swatch each */
export function tintMenuEntries(b, set) {
    const sw = (c) => tintVar(h('span', { class: 'swatch tint-swatch' }), c);
    const cur = b.color?.replace(/_bg$/, '');
    return [
        { section: 'Color' },
        { label: `${!cur ? '✓' : '   '} Default`, icon: h('span', { class: 'swatch swatch-none' }), run: () => set(undefined, b.colorStyle) },
        { label: `${cur === 'accent' ? '✓' : '   '} Accent`, icon: sw('accent'), run: () => set('accent', b.colorStyle) },
        ...Object.keys(COLORS).filter((c) => c !== 'default').map((c) => ({ label: `${cur === c ? '✓' : '   '} ${colorLabel(c)}`, icon: sw(c), run: () => set(c, b.colorStyle) })),
        { section: 'Style' },
        { label: `${b.colorStyle !== 'outline' ? '✓' : '   '} Fill`, icon: menuIcon('square-fill'), run: () => set(b.color, undefined) },
        { label: `${b.colorStyle === 'outline' ? '✓' : '   '} Outline`, icon: menuIcon('square'), run: () => set(b.color, 'outline') },
    ];
}
/** the button as shown on the page (also used for the preview) */
export function buttonEl(b, onClick) {
    const el = h('button', { class: 'nbutton' + (isLarge(b) ? ' large' : ''), type: 'button', onclick: onClick }, b.icon ? renderIcon(b.icon, 15) : null, h('span', null, b.text || 'Button'));
    tintStyle(el, b);
    return el;
}
export const captureCfg = (b) => (b.data ??= { name: 'pattern', pattern: '{{page}} {{date}}', after: 'clear', open: 'none' });
const isBlank = (bs) => bs.every((x) => !(x.text ?? '').trim() && (!x.children || isBlank(x.children)) && !['image', 'file', 'pdf', 'embed', 'divider', 'view', 'pagelink'].includes(x.type));
/** the blocks a capture block starts with (after "Add", or when it's new) */
export function captureStart(b, pageTitle) {
    const cfg = captureCfg(b);
    const t = cfg.template?.trim() ? parsePage(todoLines(fillVars(cfg.template, pageTitle))) : [];
    if (cfg.name === 'first' && (!t.length || !['paragraph', 'heading'].includes(t[0].type)))
        t.unshift({ id: ulid(), type: 'paragraph', text: '' });
    return t.length ? t : [{ id: ulid(), type: 'paragraph', text: '' }];
}
/** "Add": a new entry from the content, then clear / template / keep */
export async function runCapture(ctx, b, pageTitle, serialize, changed) {
    const cfg = captureCfg(b);
    const ws = ctx.ws;
    const db = cfg.db ? ws.dbs.get(cfg.db) : undefined;
    if (!db) {
        toast('Choose a database first (⋯ → Capture settings)');
        return;
    }
    const kids = b.children ?? [];
    if (isBlank(kids)) {
        toast('Nothing to add yet');
        return;
    }
    let body = kids, name;
    if (cfg.name === 'first') {
        name = (kids[0]?.text ?? '').replace(/<[^>]+>/g, '').trim();
        body = kids.slice(1);
    }
    else
        name = fillVars(cfg.pattern?.trim() || '{{page}} {{date}}', pageTitle);
    const values = resolveValues(db, cfg.values, pageTitle);
    if (!db.dateLabel && name)
        values[db.titleProp] = name;
    const row = await ws.addRow(db, values);
    const text = serialize(body).trim();
    if (text) {
        row.body = text;
        await ws.saveRow(db, row);
    }
    if (cfg.after !== 'keep')
        b.children = cfg.after === 'template' ? captureStart(b, pageTitle) : captureStart({ ...b, data: { ...cfg, template: '' } }, pageTitle);
    changed();
    if (cfg.open === 'peek')
        ctx.openRow(db, row, { isNew: true });
    else if (cfg.open === 'page')
        ctx.openRowPage(db, row);
    else
        toast(`Added to ${db.schema.name}`);
}
/** the capture block's settings – the same window and fields as the button settings */
export function captureSettings(ctx, target, onChange) {
    const ws = ctx.ws;
    const cfg = structuredClone(captureCfg(target));
    const initial = JSON.stringify(cfg);
    const body = h('div', { class: 'bsettings bwin' });
    const save = () => { };
    const draw = () => {
        body.textContent = '';
        const db = cfg.db ? ws.dbs.get(cfg.db) : undefined;
        let patternIn = null;
        const pattern = cfg.name === 'first' ? null : (() => { const el = input(cfg.pattern ?? '{{page}} {{date}}', (v) => { cfg.pattern = v; }, 'e.g. Einkauf {{date}}'); el.classList.add('bpattern'); patternIn = el; return el; })();
        body.append(group('Add to', field('Database', pickerControl({ value: cfg.db ?? '', items: () => dbItems(ws), change: (v) => { cfg.db = v; cfg.values = {}; draw(); }, placeholder: 'Choose a database…' })), field('Button label', input(cfg.label ?? '', (v) => { if (v.trim())
            cfg.label = v;
        else
            delete cfg.label; }, 'Add')), h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, 'Name of the entry'), h('div', { class: 'set-desc' }, cfg.name === 'first' ? 'The first line of the block – shown in bold' : 'A pattern; the date and more fill in by themselves')), h('div', { class: 'set-control' }, segmented([['pattern', 'Pattern'], ['first', 'First line']], cfg.name ?? 'pattern', (v) => { cfg.name = v; draw(); }, 'Name of the entry'))), ...(pattern ? [h('div', { class: 'set-row wide bpattern-row' }, h('div', { class: 'set-wide' }, pattern, varChips(() => patternIn, () => { })))] : [])), group('Properties of the new entry', h('div', { class: 'set-row wide' }, h('div', { class: 'set-wide' }, db ? valuesEditor(db, (cfg.values ??= {}), save, draw) : h('span', { class: 'set-desc' }, 'Choose a database first')))), group('After “Add”', field('The block', segmented([['clear', 'Empty'], ['template', 'Template'], ['keep', 'Keep']], cfg.after ?? 'clear', (v) => { cfg.after = v; draw(); }, 'The block')), ...(cfg.after === 'template' ? [wfield('Template', richField(ctx, cfg.template ?? '', (v) => { cfg.template = v; }), 'Written like a page – {{date}} and the others work here too')] : []), field('Open the new entry', segmented([['none', 'No'], ['peek', 'Center peek'], ['page', 'Full page']], cfg.open ?? 'none', (v) => { cfg.open = v; }, 'Open the new entry'))));
    };
    draw();
    const commit = () => { target.data = { ...cfg }; onChange(); };
    const box = h('div', { class: 'bwindow' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px' } }, 'Capture settings'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => ask() }, svgIcon(ICONS.close, 15))), h('div', { class: 'dialog-body pset bset-phone' }, body), h('div', { class: 'bfooter' }, h('button', { class: 'set-btn', onclick: () => ask() }, 'Cancel'), h('button', { class: 'btn-new', onclick: () => { commit(); close(); } }, 'Save')));
    const ask = () => {
        if (JSON.stringify(cfg) === initial) {
            close();
            return true;
        }
        const r = box.getBoundingClientRect();
        menu({ x: r.left + r.width / 2 - 120, y: r.top + 60 }, [
            { section: 'You have unsaved changes' },
            { label: 'Keep editing', hint: 'Esc', run: () => { } },
            { label: 'Save', run: () => { commit(); close(); } },
            'sep',
            { label: 'Discard changes', danger: true, run: () => close() },
        ]);
        return false;
    };
    const close = dialog(box, { wide: true, beforeClose: () => ask() });
    // ⌘/Ctrl+Enter saves and closes
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        document.activeElement?.blur();
        setTimeout(() => { commit(); close(); }, 0);
    } }, true);
}
//# sourceMappingURL=buttons.js.map