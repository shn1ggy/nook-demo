import { dayConfig, logDatabaseEntries } from './days.js';
import { menuToPanel, menuIcon, colorDot } from '../ui/pop.js';
import { removePropFromView } from './propmenu.js';
import { switchControl } from '../ui/settings.js';
import { wcard, wrow } from '../ui/win.js';
import { openDuplicates } from './dupes.js';
// The ⋯ settings of a database view, as in Notion: one panel that stays open while you change
// things, with pages for layout, properties, filter, sort, group and the layout's own options.
import { valueLabel, defaultCombine, defaultCards, cardLabel } from './chart.js';
const COMBINE_LABEL = { sum: 'Add up', avg: 'Average', min: 'Lowest', max: 'Highest' };
import { periodRange, weeksOn } from '../workspace.js';
import { parsePage, serializePage } from '../format/page.js';
import { Editor } from '../ui/editor.js';
import { MONTHS, debounce, fmtDay, todayISO, asDate, h, parseDateInput, ulid, svgIcon, ICONS, COLORS, colorLabel, segmented } from '../util.js';
import { closePop, dialog, menu, panel, prompt, toast } from '../ui/pop.js';
import { iconSvg, renderIcon } from '../ui/icons.js';
import { pickIcon } from '../ui/iconpicker.js';
import { typeIcon, dateEditor } from './cells.js';
import { calendars, calendarViewKeys, overlaysFor, setSubShown, subShownIn } from '../sync/service.js';
import { viewDrag as makeViewDrag } from './vieworder.js';
import { canSwitch, switchFiles } from '../filedb.js';
import { saveConfig } from '../sync/calsync.js';
export const VIEW_TYPES = [
    { type: 'table', label: 'Table', icon: 'table' }, { type: 'board', label: 'Board', icon: 'kanban' },
    { type: 'calendar', label: 'Calendar', icon: 'calendar-days' }, { type: 'list', label: 'List', icon: 'list' },
    { type: 'gallery', label: 'Gallery', icon: 'layout' }, { type: 'chart', label: 'Chart', icon: 'chart-pie' }, { type: 'day', label: 'Log', icon: 'sun' },
];
const OPS = {
    text: [{ op: 'contains', label: 'contains', needs: true }, { op: 'not_contains', label: 'does not contain', needs: true }, { op: 'is', label: 'is', needs: true }, { op: 'starts_with', label: 'starts with', needs: true }, { op: 'empty', label: 'is empty', needs: false }, { op: 'not_empty', label: 'is not empty', needs: false }],
    number: [{ op: 'gt', label: '>', needs: true }, { op: 'lt', label: '<', needs: true }, { op: 'gte', label: '≥', needs: true }, { op: 'lte', label: '≤', needs: true }, { op: 'empty', label: 'is empty', needs: false }, { op: 'not_empty', label: 'is not empty', needs: false }],
    select: [{ op: 'is', label: 'is', needs: true }, { op: 'is_not', label: 'is not', needs: true }, { op: 'empty', label: 'is empty', needs: false }, { op: 'not_empty', label: 'is not empty', needs: false }],
    date: [{ op: 'on_or_after', label: 'on or after', needs: true }, { op: 'on_or_before', label: 'on or before', needs: true }, { op: 'is', label: 'is', needs: true }, { op: 'empty', label: 'is empty', needs: false }, { op: 'not_empty', label: 'is not empty', needs: false }],
    checkbox: [{ op: 'checked', label: 'is checked', needs: false }, { op: 'unchecked', label: 'is not checked', needs: false }],
};
const rollupOps = (p) => { const f = p.rollup?.fn; return f === 'earliest' || f === 'latest' ? OPS.date : f === 'show' ? OPS.text : OPS.number; };
export const opsFor = (p) => p.type === 'rollup' ? rollupOps(p) : OPS[p.type === 'title' || p.type === 'url' || p.type === 'email' || p.type === 'phone' || p.type === 'files' ? 'text' : p.type === 'multi_select' ? 'select' : p.type === 'formula' ? 'number' : p.type === 'created_time' || p.type === 'last_edited_time' ? 'date' : p.type] ?? OPS.text;
export function describeRule(r) {
    const label = Object.values(OPS).flat().find((o) => o.op === r.op)?.label ?? r.op;
    const v = Array.isArray(r.value) ? r.value.join(', ') : r.value ?? '';
    const nice = typeof v === 'string' ? { today: 'today', yesterday: 'yesterday', '+7d': 'in 7 days', '+30d': 'in 30 days', '-30d': '30 days ago' }[v] ?? (/^\d{4}-\d\d-\d\d$/.test(v) ? fmtDay(v) : v) : String(v);
    return `${r.prop} ${label} ${nice}`.trim();
}
export function openViewSettings(env, anchor, selectTab, start) {
    const { db, view } = env;
    const props = () => db.schema.properties;
    const shownNames = () => view.type === 'table' ? db.tableProperties(view) : view.props ?? props().map((p) => p.name);
    const save = () => { env.saveView(); env.redraw(); };
    const isDates = (p) => p.type === 'date' || p.type === 'created_time' || p.type === 'last_edited_time';
    const selects = () => props().filter((p) => p.type === 'select' || p.type === 'multi_select');
    const groupable = () => view.type === 'table' || view.type === 'board' || view.type === 'list' || view.type === 'gallery' || (view.type === 'calendar' && view.monthLayout === 'compact' && !view.calMode);
    // ---------- pages ----------
    const layoutPage = () => ({
        title: 'Layout',
        top: (nav) => h('div', { class: 'layout-grid' }, VIEW_TYPES.filter((t) => (t.type !== 'day' && t.type !== 'trends') || !!env.db.schema.day).map((t) => h('button', {
            class: 'layout-opt' + (view.type === t.type ? ' on' : ''), 'aria-pressed': String(view.type === t.type),
            onclick: () => { setType(t.type); nav.refresh(); },
        }, iconSvg(t.icon, 20), h('span', null, t.label)))),
        rows: () => [
            ...(env.fullPage ? [] : [{ label: 'Show database title', icon: menuIcon('database'), toggle: !!view.showTitle, onToggle: () => { if (view.showTitle)
                        delete view.showTitle;
                    else
                        view.showTitle = true; save(); } }, 'sep']),
            ...typeRows(),
            ...(view.type !== 'chart' ? [{ label: 'Conditional color', icon: menuIcon('palette'), hint: view.colorRules?.length ? `${view.colorRules.length} rule${view.colorRules.length > 1 ? 's' : ''}` : 'None', go: colorRulesPage }] : []),
        ],
    });
    const setType = (t) => {
        view.type = t;
        const dates = props().filter(isDates);
        if (t === 'calendar' && !view.dateProp)
            view.dateProp = dates[0]?.name;
        if (t === 'board' && !view.groupBy && selects()[0])
            view.groupBy = { prop: selects()[0].name, hideEmpty: false };
        if (t === 'chart' && !view.chart) {
            const g = props().find((p) => p.type === 'select' || p.type === 'multi_select' || p.type === 'checkbox');
            view.chart = g ? { kind: 'donut', groupBy: g.name, agg: 'count' } : { kind: 'line', groupBy: '', agg: 'count', x: props().find((p) => p.type === 'date')?.name };
        }
        if (t === 'gallery') {
            view.cardSize ??= 'm';
            view.cover ??= 'content';
        }
        save();
    };
    // a phone shows tables as cards, calendars as the compact month and the views as a dropdown: their desktop-only options are left out
    const phone = document.documentElement.classList.contains('phone');
    const DESKTOP_ONLY = new Set(['Wrap all columns', 'Show vertical lines', 'Month layout', 'Calendar side', 'Entries per day', 'Tabs show']);
    const forDevice = (rows) => {
        if (!phone)
            return rows;
        const kept = rows.filter((r) => !(typeof r === 'object' && 'label' in r && DESKTOP_ONLY.has(r.label)));
        // no separator first, last or twice in a row
        return kept.filter((r, i) => r !== 'sep' || (i > 0 && i < kept.length - 1 && kept[i - 1] !== 'sep' && !(typeof kept[i - 1] === 'object' && 'section' in kept[i - 1])));
    };
    /** options that belong to the current layout */
    const typeRows = () => forDevice(typeRowsAll());
    const typeRowsAll = () => {
        const rows = [];
        const iconsRow = { label: 'Show page icons', icon: menuIcon('sparkles'), toggle: !view.hideIcons, onToggle: () => { if (view.hideIcons)
                delete view.hideIcons;
            else
                view.hideIcons = true; save(); } };
        rows.push({ section: `${VIEW_TYPES.find((t) => t.type === view.type)?.label}` });
        switch (view.type) {
            case 'table': {
                const all = props().map((p) => p.name);
                const wrapAll = all.every((n) => view.wrap?.includes(n));
                rows.push({ label: 'Wrap all columns', icon: menuIcon('align-left'), toggle: wrapAll, onToggle: () => { if (wrapAll)
                        delete view.wrap;
                    else
                        view.wrap = all; save(); } }, { label: 'Show vertical lines', icon: menuIcon('columns'), toggle: !!view.colLines, onToggle: () => { if (view.colLines)
                        delete view.colLines;
                    else
                        view.colLines = true; save(); } }, { label: 'Show calculation row', icon: menuIcon('sigma'), toggle: !view.noCalcRow, onToggle: () => { if (view.noCalcRow)
                        delete view.noCalcRow;
                    else
                        view.noCalcRow = true; save(); } }, 'sep', iconsRow, colorRow());
                break;
            }
            case 'board':
                rows.push({ label: 'Color columns', icon: menuIcon('palette'), toggle: !view.plainColumns, onToggle: () => { if (view.plainColumns)
                        delete view.plainColumns;
                    else
                        view.plainColumns = true; save(); } }, { label: 'Card size', icon: menuIcon('layout'), seg: { options: [['s', 'S'], ['m', 'M'], ['l', 'L']], value: view.cardSize ?? 'm', pick: (k) => { view.cardSize = k; save(); } } }, iconsRow);
                break;
            case 'calendar':
                rows.push({ label: 'Show calendar by', icon: menuIcon('calendar'), hint: view.dateProp ?? '—', go: () => ({ title: 'Show calendar by', rows: () => props().filter(isDates).map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.dateProp === p.name, pick: () => { view.dateProp = p.name; save(); }, back: true })) }) }, { label: 'Month layout', icon: menuIcon('calendar'), seg: { options: [['grid', 'Grid'], ['compact', 'Compact']], value: view.monthLayout === 'compact' ? 'compact' : 'grid', pick: (v) => { if (v === 'compact')
                            view.monthLayout = 'compact';
                        else
                            delete view.monthLayout; save(); } } }, ...(view.monthLayout === 'compact' ? [{ label: 'Calendar side', icon: menuIcon('columns'), seg: { options: [['l', 'Left'], ['r', 'Right']], value: view.compactCalendarRight ? 'r' : 'l', pick: (v) => { if (v === 'r')
                                view.compactCalendarRight = true;
                            else
                                delete view.compactCalendarRight; save(); } } }] : []), { label: 'Entries per day', icon: menuIcon('list'), hint: String(view.perDay ?? 5), go: () => ({ title: 'Entries per day (month)', rows: () => [3, 4, 5, 6, 7, 8, 10].map((n) => ({ label: `${n}${n === 5 ? ' (default)' : ''}`, checked: (view.perDay ?? 5) === n, pick: () => { if (n === 5)
                                delete view.perDay;
                            else
                                view.perDay = n; save(); }, back: true })) }) }, 'sep', colorRow('Color entries by'), iconsRow);
                break;
            case 'gallery': {
                const filesProps = props().filter((p) => p.type === 'files');
                rows.push({ label: 'Card preview', icon: menuIcon('image'), hint: view.cover === 'none' ? 'None' : !view.cover || view.cover === 'content' ? 'Page content' : view.cover, go: () => ({ title: 'Card preview', rows: () => [
                            { label: 'Page content (first image)', checked: !view.cover || view.cover === 'content', pick: () => { view.cover = 'content'; save(); }, back: true },
                            ...filesProps.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.cover === p.name, pick: () => { view.cover = p.name; save(); }, back: true })),
                            { label: 'None', checked: view.cover === 'none', pick: () => { view.cover = 'none'; save(); }, back: true },
                        ] }) }, { label: 'Card size', icon: menuIcon('layout'), seg: { options: [['s', 'S'], ['m', 'M'], ['l', 'L']], value: view.cardSize ?? 'm', pick: (k) => { view.cardSize = k; save(); } } }, { label: 'Shape', icon: menuIcon('square'), hint: view.coverShape ?? '16:9', go: () => ({ title: 'Shape', rows: () => ['16:9', '4:3', '3:2', '2:3', '1:1'].map((k) => ({ label: k, hint: k === '2:3' ? 'Posters' : k === '16:9' ? 'Stills' : undefined, checked: (view.coverShape ?? '16:9') === k, pick: () => { if (k === '16:9')
                                delete view.coverShape;
                            else
                                view.coverShape = k; save(); }, back: true })) }) }, { label: 'Image', icon: menuIcon('minimize'), seg: { options: [['fill', 'Fill'], ['fit', 'Fit']], value: view.fitImage ? 'fit' : 'fill', pick: (v) => { if (v === 'fit')
                            view.fitImage = true;
                        else
                            delete view.fitImage; save(); } } }, 'sep', iconsRow, { label: 'Wrap text', icon: menuIcon('align-left'), toggle: !!view.wrapCards, onToggle: () => { if (view.wrapCards)
                        delete view.wrapCards;
                    else
                        view.wrapCards = true; save(); } }, colorRow('Color cards by'));
                break;
            }
            case 'list':
                {
                    const dates = props().filter((p) => p.type === 'date');
                    rows.push(
                    // "10:00 Meeting": the time of a date property before the name (entries without a time show none)
                    ...(dates.length ? [{ label: 'Show time', icon: menuIcon('clock'), hint: view.timeProp ?? 'Off', go: () => ({ title: 'Show time before the name', rows: () => [
                                    { label: 'Off', checked: !view.timeProp, pick: () => { delete view.timeProp; save(); }, back: true },
                                    ...dates.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.timeProp === p.name, pick: () => { view.timeProp = p.name; save(); }, back: true })),
                                ] }) }] : []), colorRow('Color entries by'), iconsRow);
                    break;
                }
                break;
            case 'chart': {
                const nums = props().filter((p) => p.type === 'number' || p.type === 'formula' || p.type === 'rollup');
                const groupable = props().filter((p) => p.type === 'select' || p.type === 'multi_select' || p.type === 'checkbox' || p.type === 'status');
                const datesX = props().filter((p) => p.type === 'date' || p.type === 'created_time' || p.type === 'last_edited_time');
                const cfg = () => (view.chart ??= { kind: 'donut', groupBy: groupable[0]?.name ?? '', agg: 'count' });
                const c = view.chart;
                const kind = c?.kind ?? 'donut';
                const KINDS = [['cards', 'Number cards', 'Key figures at a glance'], ['donut', 'Donut', 'Parts of a whole'], ['bar', 'Bars', 'Compare groups'], ['line', 'Graph', 'Trend over time'], ['goal', 'Progress', 'Toward a budget or goal']];
                const AGGS = [['sum', 'Sum'], ['avg', 'Average'], ['min', 'Minimum'], ['max', 'Maximum']];
                const BUCKETS = [['auto', 'Auto', 'Follows the period switcher'], ['day', 'Day', ''], ['week', 'Week', ''], ['month', 'Month', ''], ['year', 'Year', '']];
                const valuesPage = (title) => () => ({ title, rows: () => [
                        { label: 'Count of entries', icon: menuIcon('hash'), checked: !view.chart?.prop || view.chart.agg === 'count', pick: () => { cfg().agg = 'count'; delete cfg().prop; save(); }, back: true },
                        ...(nums.length ? [{ section: 'Calculate a number' }] : []),
                        ...nums.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), hint: view.chart?.prop === p.name ? valueLabel(view.chart).split(' of ')[0] : undefined, checked: view.chart?.prop === p.name && view.chart.agg !== 'count', go: () => ({ title: p.name, rows: () => AGGS.map(([a, l]) => ({
                                    label: l, checked: view.chart?.prop === p.name && view.chart.agg === a, pick: () => { cfg().agg = a; cfg().prop = p.name; save(); }, back: true,
                                })) }) })),
                    ] });
                rows.push({ label: 'Chart type', icon: menuIcon(kind === 'cards' ? 'hash' : kind === 'goal' ? 'target' : kind === 'line' ? 'trending-up' : kind === 'bar' ? 'chart-bar' : 'chart-pie'), hint: KINDS.find((k) => k[0] === kind)[1], go: () => ({ title: 'Chart type', rows: () => KINDS.map(([k, l, d]) => ({ label: l, hint: d, checked: kind === k, pick: () => {
                                cfg().kind = k;
                                if (k === 'line' && !cfg().x)
                                    cfg().x = datesX[0]?.name;
                                if (k === 'cards' && !cfg().cards?.length)
                                    cfg().cards = defaultCards(db);
                                if (k === 'goal' && cfg().agg !== 'count' && cfg().agg !== 'sum')
                                    cfg().agg = cfg().prop ? 'sum' : 'count';
                                save();
                            }, back: true })) }) });
                // a number field inside the panel (targets)
                const numField = (value, set, label) => {
                    const el = h('input', { type: 'number', class: 'set-input panel-num', inputmode: 'decimal', step: 'any', value: value ?? '', placeholder: 'None', 'aria-label': label });
                    el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter')
                        el.blur(); });
                    el.addEventListener('change', () => { const n = parseFloat(el.value.replace(',', '.')); set(Number.isFinite(n) && n > 0 ? n : undefined); save(); });
                    return h('label', { class: 'panel-num-row' }, h('span', null, label), el);
                };
                // a date in the panel: a button in the look of the other controls, opening Nook's date picker
                const dateField = (value, set, label, empty = 'Choose…') => {
                    const btn = h('button', { class: 'set-btn panel-date', 'aria-label': label, onclick: (e) => { e.stopPropagation(); dateEditor(value ? { start: value } : null, btn, (v) => { set(asDate(v)?.start?.slice(0, 10)); save(); }, true); } }, value ? fmtDay(value) : empty);
                    return h('div', { class: 'panel-num-row' }, h('span', null, label), btn);
                };
                if (kind === 'cards') {
                    const cards = () => (cfg().cards ??= defaultCards(db));
                    const cardPage = (id) => () => ({ title: cardLabel(cards().find((x) => x.id === id) ?? cards()[0]), rows: (nav) => {
                            const card = cards().find((x) => x.id === id);
                            if (!card)
                                return [];
                            return [
                                { label: 'Value', icon: menuIcon('sigma'), hint: card.prop && card.agg !== 'count' ? card.prop : 'Number of entries', go: () => ({ title: 'Value', rows: () => [
                                            { label: 'Number of entries', icon: menuIcon('hash'), checked: !card.prop || card.agg === 'count', pick: () => { card.agg = 'count'; delete card.prop; save(); }, back: true },
                                            ...nums.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: card.prop === p.name && card.agg !== 'count', pick: () => { if (card.prop !== p.name || card.agg === 'count') {
                                                    card.prop = p.name;
                                                    card.agg = defaultCombine(db, p.name);
                                                } save(); }, back: true })),
                                        ] }) },
                                ...(card.prop && card.agg !== 'count' ? [{ label: 'Calculate', hint: COMBINE_LABEL[card.agg] === 'Add up' ? 'Total' : COMBINE_LABEL[card.agg], go: () => ({ title: 'Calculate', rows: () => ['sum', 'avg', 'min', 'max'].map((a) => ({
                                                label: a === 'sum' ? 'Total' : COMBINE_LABEL[a], checked: card.agg === a, pick: () => { card.agg = a; save(); }, back: true,
                                            })) }) }] : []),
                                { el: (() => {
                                        const f = h('input', { class: 'set-input', value: card.label ?? '', placeholder: cardLabel({ ...card, label: undefined }), 'aria-label': 'Card name' });
                                        f.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter')
                                            f.blur(); });
                                        f.addEventListener('change', () => { const t = f.value.trim(); if (t)
                                            card.label = t;
                                        else
                                            delete card.label; save(); });
                                        return h('label', { class: 'panel-num-row' }, h('span', null, 'Name'), f);
                                    })() },
                                { section: 'With the period switcher' },
                                { label: 'Compare with the period before', toggle: !!card.compare, onToggle: () => { card.compare = !card.compare; save(); } },
                                ...(card.compare ? [{ label: 'Going up is', hint: card.up === 'good' ? 'Good (green)' : card.up === 'bad' ? 'Bad (red)' : 'Neither', go: () => ({ title: 'Going up is', rows: () => [['neutral', 'Neither'], ['good', 'Good (green)'], ['bad', 'Bad (red)']].map(([k, l]) => ({
                                                label: l, hint: k === 'bad' ? 'Spending' : k === 'good' ? 'Savings, income' : undefined, checked: (card.up ?? 'neutral') === k, pick: () => { if (k === 'neutral')
                                                    delete card.up;
                                                else
                                                    card.up = k; save(); }, back: true,
                                            })) }) }] : []),
                                { label: 'Trend line', toggle: !!card.spark, onToggle: () => { card.spark = !card.spark; save(); } },
                                ...(!view.period ? [{ label: 'Add a period switcher (needed for both)', icon: menuIcon('calendar'), run: () => { const d = datesX[0]; if (d) {
                                            view.period = { unit: 'month', prop: d.name };
                                            env.state.offset = 0;
                                            save();
                                        } } }] : []),
                                'sep',
                                { label: 'Remove card', icon: menuIcon('trash'), danger: true, pick: () => { cfg().cards = cards().filter((x) => x.id !== id); save(); nav.back(); } },
                            ];
                        } });
                    rows.push({ section: 'Cards' }, ...cards().map((c2) => ({ label: cardLabel(c2), icon: menuIcon(c2.prop ? 'sigma' : 'hash'), hint: [c2.compare ? 'compared' : '', c2.spark ? 'trend' : ''].filter(Boolean).join(' · ') || undefined, go: cardPage(c2.id) })), { label: 'Add a card', icon: menuIcon('plus-circle'), pick: () => { cards().push({ id: Math.random().toString(36).slice(2, 8), agg: nums[0] ? defaultCombine(db, nums[0].name) : 'count', prop: nums[0]?.name, compare: true }); save(); } });
                }
                else if (kind === 'goal') {
                    const by = c?.groupBy && db.prop(c.groupBy) && groupable.some((p) => p.name === c.groupBy) ? c.groupBy : undefined;
                    rows.push({ label: 'Value', icon: menuIcon('sigma'), hint: c?.prop && c.agg !== 'count' ? c.prop : 'Number of entries', go: () => ({ title: 'Value', rows: () => [
                                { label: 'Number of entries', icon: menuIcon('hash'), checked: !view.chart?.prop || view.chart.agg === 'count', pick: () => { cfg().agg = 'count'; delete cfg().prop; save(); }, back: true },
                                ...nums.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.chart?.prop === p.name && view.chart.agg !== 'count', pick: () => { cfg().prop = p.name; cfg().agg = 'sum'; save(); }, back: true })),
                            ] }) }, { label: 'Kind of goal', hint: (c?.goalType ?? 'limit') === 'limit' ? 'Limit (budget)' : c?.goalType === 'countdown' ? 'Countdown' : 'Target (to reach)', go: () => ({ title: 'Kind of goal', rows: () => [
                                { label: 'Limit', hint: 'Stay below it: budgets', checked: (view.chart?.goalType ?? 'limit') === 'limit', pick: () => { delete cfg().goalType; save(); }, back: true },
                                { label: 'Target', hint: 'Reach it: savings, hours, pages', checked: view.chart?.goalType === 'target', pick: () => { cfg().goalType = 'target'; save(); }, back: true },
                                { label: 'Countdown', checked: view.chart?.goalType === 'countdown', pick: () => { cfg().goalType = 'countdown'; save(); }, back: true },
                            ] }) }, ...((c?.goalType ?? 'limit') === 'countdown' ? [] : [{ el: numField(c?.target, (v) => { if (v)
                                cfg().target = v;
                            else
                                delete cfg().target; }, (c?.goalType ?? 'limit') === 'limit' ? 'Limit' : 'Target') }]), ...((c?.goalType ?? 'limit') === 'countdown' ? [
                        { el: (() => {
                                const f = h('input', { class: 'set-input', value: c?.title ?? '', placeholder: 'Countdown', 'aria-label': 'Name' });
                                f.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter')
                                    f.blur(); });
                                f.addEventListener('change', () => { const t = f.value.trim(); if (t)
                                    cfg().title = t;
                                else
                                    delete cfg().title; save(); });
                                return h('label', { class: 'panel-num-row' }, h('span', null, 'Name'), f);
                            })() },
                        { el: dateField(c?.due, (v) => { if (v) {
                                cfg().due = v;
                                cfg().since ??= todayISO();
                            }
                            else
                                delete cfg().due; }, 'Date') },
                        ...(c?.due ? [{ el: dateField(c?.since, (v) => { if (v)
                                    cfg().since = v;
                                else
                                    delete cfg().since; }, 'Counting from', 'None') }] : []),
                        { section: 'Look' },
                        { label: 'Time gone as', hint: (c?.shape ?? 'bar') === 'ring' ? 'Circle' : 'Bar', go: () => ({ title: 'Time gone as', rows: () => [['bar', 'Bar'], ['ring', 'Circle']].map(([k, l]) => ({ label: l, checked: (view.chart?.shape ?? 'bar') === k, pick: () => { if (k === 'bar')
                                        delete cfg().shape;
                                    else
                                        cfg().shape = k; save(); }, back: true })) }) },
                        { label: 'Color', hint: c?.color ? colorLabel(c.color) : 'Default', go: () => ({ title: 'Color', rows: () => Object.keys(COLORS).map((k) => ({
                                    label: k === 'default' ? 'Default' : colorLabel(k), icon: colorDot(k), checked: (view.chart?.color ?? 'default') === k,
                                    pick: () => { if (k === 'default')
                                        delete cfg().color;
                                    else
                                        cfg().color = k; save(); }, back: true,
                                })) }) },
                    ] : [
                        { section: 'By a date (optional)' },
                        { el: dateField(c?.due, (v) => { if (v)
                                cfg().due = v;
                            else
                                delete cfg().due; }, 'Due date', 'None') },
                        ...(c?.due ? [{ el: dateField(c?.since, (v) => { if (v)
                                    cfg().since = v;
                                else
                                    delete cfg().since; }, 'Counting from', 'First entry') }] : []),
                    ]), { section: 'Per option (optional)' }, { label: 'Bars by', icon: menuIcon('tags'), hint: by ?? 'None', go: () => ({ title: 'Bars by', rows: () => [
                                { label: 'None', checked: !by, pick: () => { cfg().groupBy = ''; save(); }, back: true },
                                ...groupable.filter((p) => p.type !== 'checkbox').map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: by === p.name, pick: () => { cfg().groupBy = p.name; save(); }, back: true })),
                            ] }) }, ...(by ? [{ label: 'Targets per option', hint: `${Object.keys(c?.targets ?? {}).length} set`, go: () => ({ title: `Targets · ${by}`, rows: () => (db.prop(by)?.options ?? []).map((o) => ({ el: numField(view.chart?.targets?.[o.name], (v) => {
                                        const t = (cfg().targets ??= {});
                                        if (v)
                                            t[o.name] = v;
                                        else
                                            delete t[o.name];
                                    }, o.name) })) }) }] : []));
                    // a countdown counts only time: no value, target or bars
                    if ((c?.goalType ?? 'limit') === 'countdown') {
                        const drop = new Set(['Value', 'Bars by', 'Targets per option', 'Per option (optional)']);
                        for (let k = rows.length - 1; k >= 0; k--) {
                            const x = rows[k];
                            if (typeof x === 'object' && (('label' in x && drop.has(x.label)) || ('section' in x && drop.has(x.section))))
                                rows.splice(k, 1);
                        }
                    }
                }
                else if (kind === 'line') {
                    const xName = c?.x && db.prop(c.x) ? c.x : datesX[0]?.name;
                    rows.push({ section: 'Axes' }, { label: 'X axis (time)', icon: menuIcon('calendar'), hint: xName ? `${xName} · ${BUCKETS.find((x) => x[0] === (c?.bucket ?? 'auto'))[1]}` : 'No date', go: () => ({ title: 'X axis (time)', rows: () => [
                                ...(datesX.length ? datesX.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: (view.chart?.x && db.prop(view.chart.x) ? view.chart.x : datesX[0]?.name) === p.name, pick: () => { cfg().x = p.name; save(); } })) : [{ label: 'Add a date property first' }]),
                                { section: view.chart?.points ? 'Date labels per' : 'One point per' },
                                ...BUCKETS.map(([k, l]) => ({ label: l, checked: (view.chart?.bucket ?? 'auto') === k, pick: () => { if (k === 'auto')
                                        delete cfg().bucket;
                                    else
                                        cfg().bucket = k; save(); } })),
                            ] }) }, { label: 'Y axis', icon: menuIcon('sigma'), hint: c?.prop && c.agg !== 'count' ? c.prop : 'Number of entries', go: () => ({ title: 'Y axis', rows: () => [
                                { label: 'Number of entries', icon: menuIcon('hash'), hint: 'How many per step', checked: !view.chart?.prop || view.chart.agg === 'count', pick: () => { cfg().agg = 'count'; delete cfg().prop; delete cfg().points; save(); }, back: true },
                                ...(nums.length ? [{ section: 'A number' }] : []),
                                ...nums.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.chart?.prop === p.name && view.chart.agg !== 'count', pick: () => {
                                        if (cfg().prop !== p.name || cfg().agg === 'count') {
                                            cfg().prop = p.name;
                                            cfg().agg = defaultCombine(db, p.name);
                                        }
                                        save();
                                    }, back: true })),
                            ] }) }, ...(c?.prop && c.agg !== 'count' ? [
                        { label: 'Each entry as its own point', toggle: !!c.points, onToggle: () => { cfg().points = !cfg().points; save(); } },
                        ...(!c.points ? [{ label: 'Several entries on one step', hint: COMBINE_LABEL[c.agg] ?? 'Add up', go: () => ({ title: 'Several entries on one step', rows: () => ['sum', 'avg', 'min', 'max'].map((a) => ({
                                        label: COMBINE_LABEL[a], hint: a === 'sum' ? 'Amounts: spent per day' : a === 'avg' ? 'Measurements: weight per week' : undefined, checked: view.chart?.agg === a, pick: () => { cfg().agg = a; save(); }, back: true,
                                    })) }) }] : []),
                    ] : []), { section: 'Display' }, { label: 'Running total', toggle: !!c?.cumulative, onToggle: () => { cfg().cumulative = !cfg().cumulative; save(); } }, ...(c?.cumulative ? [{ label: 'Counted from', hint: { period: 'Shown period', year: 'Each year', month: 'Each month', week: 'Each week', all: 'Ever' }[c.runFrom ?? 'period'], go: () => ({ title: 'Running total counted from', rows: () => [['period', 'Shown period', 'Starts at 0 where the period switcher starts'], ['year', 'Each year', 'From January 1st'], ['month', 'Each month', 'From the 1st'], ['week', 'Each week', ''], ['all', 'Ever', 'Everything before is counted too']].map(([k, l, d]) => ({
                                    label: l, hint: d || undefined, checked: (view.chart?.runFrom ?? 'period') === k, pick: () => { if (k === 'period')
                                        delete cfg().runFrom;
                                    else
                                        cfg().runFrom = k; save(); }, back: true,
                                })) }) }] : []), { label: 'Lines by', icon: menuIcon('tags'), hint: c?.splitBy ?? 'One line', go: () => ({ title: 'Lines by', rows: () => [
                                { label: 'One line', checked: !view.chart?.splitBy, pick: () => { delete cfg().splitBy; save(); }, back: true },
                                ...groupable.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.chart?.splitBy === p.name, pick: () => { cfg().splitBy = p.name; save(); }, back: true })),
                            ] }) }, ...(c?.points ? [] : [{ label: 'Steps without entries', hint: (c?.gaps ?? (!c?.prop || c.agg === 'count' || c.agg === 'sum' ? 'zero' : 'skip')) === 'zero' ? 'Count as 0' : 'Skip', go: () => ({ title: 'Steps without entries', rows: () => [
                                    { label: 'Count as 0', hint: 'For amounts and counts', checked: (view.chart?.gaps ?? (!view.chart?.prop || view.chart.agg === 'count' || view.chart.agg === 'sum' ? 'zero' : 'skip')) === 'zero', pick: () => { cfg().gaps = 'zero'; save(); }, back: true },
                                    { label: 'Skip (line goes on)', hint: 'For measurements', checked: (view.chart?.gaps ?? (!view.chart?.prop || view.chart.agg === 'count' || view.chart.agg === 'sum' ? 'zero' : 'skip')) === 'skip', pick: () => { cfg().gaps = 'skip'; save(); }, back: true },
                                ] }) }]));
                    if (!view.period && xName)
                        rows.push({ label: 'Add a period switcher to change the time span', icon: menuIcon('calendar'), run: () => { view.period = { unit: 'month', prop: xName ?? '' }; env.state.offset = 0; save(); } });
                }
                else {
                    rows.push({ label: 'Group by', icon: menuIcon('tags'), hint: c?.groupBy || '—', go: () => ({ title: 'Group by', rows: () => groupable.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.chart?.groupBy === p.name, pick: () => { cfg().groupBy = p.name; save(); }, back: true })) }) }, { label: 'Values', icon: menuIcon('sigma'), hint: valueLabel(c), go: valuesPage('Values') });
                    if (kind === 'bar')
                        rows.push({ label: 'Order', hint: c?.sort === 'name' ? 'As the options' : 'Largest first', go: () => ({ title: 'Order', rows: () => [
                                    { label: 'Largest first', checked: view.chart?.sort !== 'name', pick: () => { delete cfg().sort; save(); }, back: true },
                                    { label: 'As the options', checked: view.chart?.sort === 'name', pick: () => { cfg().sort = 'name'; save(); }, back: true },
                                ] }) });
                }
                break;
            }
        }
        return rows;
    };
    const colorRow = (label = 'Color rows by') => ({ label, icon: menuIcon('palette'), hint: view.colorBy ?? 'Off', go: () => ({ title: label, rows: () => [
                { label: 'No color', checked: !view.colorBy, pick: () => { view.colorBy = undefined; save(); }, back: true },
                ...props().filter((p) => p.type === 'select').map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.colorBy === p.name, pick: () => { view.colorBy = p.name; save(); }, back: true })),
            ] }) });
    // how many entries are shown before "Load more" (as Notion's load limit)
    const setLimit = (n) => { if (n)
        view.limit = n;
    else
        delete view.limit; env.state.limit = n ?? 100; env.state.limitSet = true; save(); };
    const loadRow = () => ({ label: 'Load limit', icon: menuIcon('list-ordered'), hint: view.limit ? `${view.limit} entries` : 'Automatic', go: () => ({ title: 'Load limit', rows: (nav) => [
                { label: 'Automatic', checked: !view.limit, pick: () => setLimit(null), back: true },
                'sep',
                ...[5, 10, 25, 50, 100, 200, 500].map((n) => ({ label: `${n} entries`, checked: view.limit === n, pick: () => setLimit(n), back: true })),
                'sep',
                { el: (() => {
                        const inp = h('input', { class: 'pop-input', type: 'number', min: '1', placeholder: 'Other number…', value: view.limit && ![5, 10, 25, 50, 100, 200, 500].includes(view.limit) ? String(view.limit) : '', 'aria-label': 'Number of entries' });
                        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') {
                            const n = Math.round(Number(inp.value));
                            if (n > 0) {
                                setLimit(n);
                                nav.back();
                            }
                        } });
                        return h('div', { class: 'vpanel-input' }, inp);
                    })() },
            ] }) });
    const propertiesPage = () => {
        let q = '';
        return {
            title: 'Properties',
            top: (nav) => {
                const inp = h('input', { class: 'pop-input', placeholder: 'Search for a property…', value: q, 'aria-label': 'Search properties' });
                inp.addEventListener('input', () => { q = inp.value; nav.refresh(); const again = document.querySelector('.vpanel input[aria-label="Search properties"]'); again?.focus(); again?.setSelectionRange(q.length, q.length); });
                return h('div', { class: 'vpanel-top' }, inp);
            },
            rows: (nav) => {
                const shown = shownNames().filter((n) => db.prop(n));
                const locked = (p) => p.name === db.labelProp && view.type === 'table';
                const match = (n) => !q || n.toLowerCase().includes(q.toLowerCase());
                const hidden = props().filter((p) => !shown.includes(p.name));
                const setShown = (list) => {
                    if (db.dateLabel && list.includes(db.titleProp) && !db.schema.showNameWithDate) {
                        db.schema.showNameWithDate = true;
                        void env.ctx.ws.saveSchema(db);
                    }
                    view.props = list;
                    save();
                    nav.refresh();
                };
                const rows = [];
                rows.push({ el: h('div', { class: 'vpanel-sec' }, h('span', null, `Shown in ${view.name}`), shown.some((n) => !locked(db.prop(n))) ? h('button', { class: 'link', onclick: () => setShown(shown.filter((n) => locked(db.prop(n)))) }, 'Hide all') : null) });
                for (const n of shown.filter(match)) {
                    const p = db.prop(n);
                    const row = h('div', { class: 'prop-row', draggable: !q, 'data-name': n }, h('span', { class: 'prop-grip', 'aria-hidden': 'true' }, svgIcon(ICONS.grip, 14, { fill: true })), typeIcon(p.type, p.icon), h('span', { class: 'prop-row-name' }, n), locked(p) ? h('span', { class: 'hint' }, 'Always shown') : h('button', { class: 'icon-btn', 'aria-label': `Hide ${n}`, title: 'Hide', onclick: () => setShown(shown.filter((x) => x !== n)) }, svgIcon(ICONS.eye, 16)));
                    // drag to change the column / field order
                    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-nook-prop', n); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
                    row.addEventListener('dragend', () => row.classList.remove('dragging'));
                    row.addEventListener('dragover', (e) => { if (!e.dataTransfer?.types.includes('text/x-nook-prop'))
                        return; e.preventDefault(); const r = row.getBoundingClientRect(); row.classList.toggle('drop-before', e.clientY < r.top + r.height / 2); row.classList.toggle('drop-after', e.clientY >= r.top + r.height / 2); });
                    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
                    row.addEventListener('drop', (e) => {
                        const from = e.dataTransfer?.getData('text/x-nook-prop');
                        const after = row.classList.contains('drop-after');
                        row.classList.remove('drop-before', 'drop-after');
                        if (!from || from === n)
                            return;
                        e.preventDefault();
                        const list = shown.filter((x) => x !== from);
                        list.splice(list.indexOf(n) + (after ? 1 : 0), 0, from);
                        setShown(list);
                    });
                    rows.push({ el: row });
                }
                if (hidden.length) {
                    rows.push({ el: h('div', { class: 'vpanel-sec' }, h('span', null, 'Hidden'), h('button', { class: 'link', onclick: () => setShown([...shown, ...hidden.map((p) => p.name)]) }, 'Show all')) });
                    for (const p of hidden.filter((x) => match(x.name))) {
                        rows.push({ el: h('div', { class: 'prop-row hidden-prop' }, h('span', { class: 'prop-grip' }), typeIcon(p.type, p.icon), h('span', { class: 'prop-row-name' }, p.name), h('button', { class: 'icon-btn', 'aria-label': `Show ${p.name}`, title: 'Show', onclick: () => setShown([...shown, p.name]) }, svgIcon(ICONS.eyeOff, 16))) });
                    }
                }
                // the same properties (shown, hidden and their order) as another view of this database – any type
                const others = db.views.filter((v) => v !== view);
                if (others.length && !q)
                    rows.push('sep', { label: 'Copy from another view', icon: menuIcon('copy'), go: () => copyPropsPage(others) });
                return rows;
            },
        };
    };
    /** "Copy from another view": its visible properties and their order; between tables also the column widths */
    const copyPropsPage = (others) => ({
        title: 'Copy from',
        rows: () => others.map((o) => {
            const n = (o.type === 'table' ? db.tableProperties(o) : o.props ?? props().map((p) => p.name)).filter((x) => db.prop(x)).length;
            return {
                label: o.name, icon: o.icon ? renderIcon(o.icon, 16) : menuIcon(VIEW_TYPES.find((t) => t.type === o.type)?.icon ?? 'table'), hint: `${n} shown`,
                pick: () => {
                    view.props = [...(o.props ?? props().map((p) => p.name))];
                    if (o.type === 'table' && view.type === 'table' && o.widths)
                        view.widths = { ...o.widths };
                    save();
                    toast(`Properties copied from ${o.name}`);
                }, back: true,
            };
        }),
    });
    /** drag rows of a rule list by their grip to reorder (sorts, filters) */
    const dragRows = (list, nav) => {
        let from = -1;
        return (row, i, grip) => {
            grip.addEventListener('mousedown', () => { row.draggable = true; });
            row.addEventListener('dragstart', (e) => { from = i; row.classList.add('dragging'); e.dataTransfer?.setData('text/plain', String(i)); });
            row.addEventListener('dragend', () => { row.draggable = false; row.classList.remove('dragging'); row.parentElement?.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after')); });
            row.addEventListener('dragover', (e) => { if (from < 0)
                return; e.preventDefault(); const r = row.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; row.classList.toggle('drop-after', after); row.classList.toggle('drop-before', !after); });
            row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                if (from < 0)
                    return;
                const r = row.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                const l = list();
                const [it] = l.splice(from, 1);
                let to = i + (after ? 1 : 0);
                if (from < to)
                    to--;
                l.splice(to, 0, it);
                from = -1;
                save();
                nav.refresh();
            });
        };
    };
    /** a small menu opened from inside the panel (keeps the panel open) */
    const sub = (at, entries) => menu(at, entries, { keepBelow: true });
    const chip = (label, title, onclick, cls = '') => { const b = h('button', { class: 'rule-chip ' + cls, title }, label, svgIcon(ICONS.chevron, 11)); b.addEventListener('click', (e) => { e.stopPropagation(); onclick(b); }); return b; };
    const sortPage = () => ({
        title: 'Sort',
        rows: (nav) => {
            const rows = [];
            const drag = dragRows(() => view.sorts ?? [], nav);
            (view.sorts ?? []).forEach((s, i) => {
                const def = db.prop(s.prop);
                const grip = h('span', { class: 'rule-grip', title: 'Drag to change the order (the top sort wins)' }, svgIcon(ICONS.grip, 14, { fill: true }));
                const row = h('div', { class: 'rule-row sort-row' }, grip, chip(h('span', { class: 'rule-prop' }, typeIcon(def?.type ?? 'text'), s.prop), 'Sort by another property', (el) => sub(el, props().filter((p) => p.name === s.prop || !view.sorts.some((x) => x.prop === p.name)).map((p) => ({ label: `${p.name === s.prop ? '✓' : '   '} ${p.name}`, icon: typeIcon(p.type, p.icon), run: () => { s.prop = p.name; save(); nav.refresh(); } })))), segmented([['asc', [iconSvg('arrow-up', 13), 'Asc'], 'Ascending (A → Z, 1 → 9, old → new)'], ['desc', [iconSvg('arrow-down', 13), 'Desc'], 'Descending (Z → A, 9 → 1, new → old)']], s.dir === 'desc' ? 'desc' : 'asc', (v) => { s.dir = v; save(); nav.refresh(); }, 'Order', 'small'), h('button', { class: 'icon-btn rule-x', 'aria-label': `Remove sort by ${s.prop}`, title: 'Remove', onclick: () => { view.sorts.splice(i, 1); if (!view.sorts.length)
                        delete view.sorts; save(); nav.refresh(); } }, iconSvg('trash', 14)));
                drag(row, i, grip);
                rows.push({ el: row });
            });
            if (!view.sorts?.length)
                rows.push({ el: h('div', { class: 'muted small vpanel-empty' }, view.order?.length ? 'No sort – entries keep the order you dragged them into.' : 'No sort yet – entries show in the order they were added.') });
            rows.push('sep', { label: view.sorts?.length ? 'Add a sort' : 'Add a sort', icon: menuIcon('plus-circle'), go: () => ({
                    title: 'Sort by', rows: () => props().filter((p) => !view.sorts?.some((s) => s.prop === p.name)).map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), pick: () => { view.sorts = [...(view.sorts ?? []), { prop: p.name, dir: 'asc' }]; save(); }, back: true })),
                }) });
            if (view.sorts?.length)
                rows.push({ label: 'Remove all sorts', icon: menuIcon('trash'), danger: true, pick: () => { delete view.sorts; save(); } });
            if (!view.sorts?.length && view.order?.length)
                rows.push({ label: 'Reset manual order', icon: menuIcon('refresh'), pick: () => { delete view.order; save(); } });
            return rows;
        },
    });
    const groupPage = () => ({
        title: 'Group',
        rows: () => {
            const rows = [];
            const can = props().filter((p) => ['select', 'multi_select', 'checkbox', 'text', 'title'].includes(p.type));
            if (view.type !== 'board')
                rows.push({ label: 'No grouping', checked: !view.groupBy, pick: () => { view.groupBy = undefined; save(); } });
            for (const p of can)
                rows.push({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.groupBy?.prop === p.name, pick: () => { view.groupBy = { ...(view.groupBy ?? { hideEmpty: view.type !== 'board' }), prop: p.name }; save(); } });
            if (view.groupBy)
                rows.push('sep', { label: 'Show empty groups', toggle: view.groupBy.hideEmpty === false, onToggle: () => { view.groupBy.hideEmpty = view.groupBy.hideEmpty !== false; save(); } }, { label: 'Show number of entries', toggle: !view.groupBy.hideCount, onToggle: () => { if (view.groupBy.hideCount)
                        delete view.groupBy.hideCount;
                    else
                        view.groupBy.hideCount = true; save(); } });
            return rows;
        },
    });
    const defaultValue = (p, op) => {
        const o = opsFor(p).find((x) => x.op === op);
        if (!o?.needs)
            return undefined;
        if (p.type === 'select' || p.type === 'multi_select')
            return p.options?.[0]?.name ?? '';
        if (isDates(p) || opsFor(p) === OPS.date)
            return 'today';
        return '';
    };
    const RELATIVE = [['today', 'Today'], ['yesterday', 'Yesterday'], ['tomorrow', 'Tomorrow'], ['+7d', 'In 7 days'], ['+30d', 'In 30 days'], ['-7d', '7 days ago'], ['-30d', '30 days ago']];
    /** the value part of a filter row: a chip with a menu, or a small text field */
    const valueControl = (r, p, nav) => {
        const o = opsFor(p).find((x) => x.op === r.op);
        if (!o?.needs)
            return null;
        if (p.type === 'select' || p.type === 'multi_select') {
            return chip(String(r.value ?? '') || 'Choose…', 'Choose a value', (el) => sub(el, (p.options ?? []).map((opt) => ({ label: `${r.value === opt.name ? '✓' : '   '} ${opt.name}`, run: () => { r.value = opt.name; save(); nav.refresh(); } }))), 'rule-val');
        }
        if (opsFor(p) === OPS.date) {
            const nice = (v) => RELATIVE.find(([k]) => k === v)?.[1] ?? (typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) ? fmtDay(v) : String(v ?? ''));
            const wrap = h('span', { class: 'rule-val-wrap' });
            const showChip = () => {
                wrap.textContent = '';
                wrap.append(chip(nice(r.value) || 'Choose…', 'Choose a date', (el) => sub(el, [
                    ...RELATIVE.map(([k, l]) => ({ label: `${r.value === k ? '✓' : '   '} ${l}`, run: () => { r.value = k; save(); nav.refresh(); } })),
                    'sep', { label: 'A specific date…', run: () => showInput() },
                ]), 'rule-val'));
            };
            const showInput = () => {
                wrap.textContent = '';
                const inp = h('input', { class: 'rule-input', placeholder: fmtDay(new Date().toISOString().slice(0, 10)), value: typeof r.value === 'string' && /^\d{4}/.test(r.value) ? fmtDay(r.value) : '' });
                inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') {
                    const d = parseDateInput(inp.value);
                    if (!d) {
                        toast('Could not read that date');
                        return;
                    }
                    r.value = d;
                    save();
                    nav.refresh();
                }
                else if (e.key === 'Escape') {
                    e.preventDefault();
                    showChip();
                } });
                wrap.append(inp);
                requestAnimationFrame(() => inp.focus());
            };
            showChip();
            return wrap;
        }
        const inp = h('input', { class: 'rule-input', value: r.value == null ? '' : String(r.value), placeholder: 'Value' });
        const commit = () => { const v = inp.value; r.value = p.type === 'number' || p.type === 'formula' || opsFor(p) === OPS.number ? Number(v.replace(',', '.')) : v; save(); };
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') {
            e.preventDefault();
            commit();
        } });
        inp.addEventListener('change', commit);
        return inp;
    };
    /** the condition rows of a filter (also used by conditional colours): drag, where / and / or,
        property, condition, value, remove */
    const conditionRows = (holder, nav) => {
        const g = holder.get();
        const rows = [];
        const drag = dragRows(() => holder.get()?.rules ?? [], nav);
        (g?.rules ?? []).forEach((r, i) => {
            const grip = h('span', { class: 'rule-grip', title: 'Drag to move' }, svgIcon(ICONS.grip, 14, { fill: true }));
            // first row: "Where"; the others: and / or for the whole list (click to switch)
            const lead = i === 0 ? h('span', { class: 'rule-lead' }, 'Where')
                : i === 1 ? h('button', { class: 'rule-lead rule-mode', title: 'Switch between all (and) and any (or)', onclick: () => { g.mode = g.mode === 'or' ? 'and' : 'or'; save(); nav.refresh(); } }, g.mode === 'or' ? 'Or' : 'And', svgIcon(ICONS.chevron, 10))
                    : h('span', { class: 'rule-lead' }, g.mode === 'or' ? 'Or' : 'And');
            const x = h('button', { class: 'icon-btn rule-x', 'aria-label': 'Remove filter', title: 'Remove', onclick: () => { g.rules.splice(i, 1); if (!g.rules.length)
                    holder.drop(); save(); nav.refresh(); } }, iconSvg('trash', 14));
            let row;
            if ('rules' in r) {
                row = h('div', { class: 'rule-row filter-row' }, grip, lead, h('span', { class: 'rule-text' }, `${r.rules.length} conditions (${r.mode === 'or' ? 'any' : 'all'})`), x);
            }
            else {
                const p = db.prop(r.prop);
                if (!p) {
                    row = h('div', { class: 'rule-row filter-row' }, grip, lead, h('span', { class: 'rule-text muted' }, `${r.prop} (deleted)`), x);
                }
                else {
                    const ops = opsFor(p);
                    row = h('div', { class: 'rule-row filter-row' }, grip, lead, chip(h('span', { class: 'rule-prop' }, typeIcon(p.type, p.icon), p.name), 'Filter by another property', (el) => sub(el, props().map((q) => ({ label: `${q.name === p.name ? '✓' : '   '} ${q.name}`, icon: typeIcon(q.type), run: () => { r.prop = q.name; r.op = opsFor(q)[0].op; r.value = defaultValue(q, r.op); save(); nav.refresh(); } })))), chip(ops.find((o) => o.op === r.op)?.label ?? r.op, 'Condition', (el) => sub(el, ops.map((o) => ({ label: `${o.op === r.op ? '✓' : '   '} ${o.label}`, run: () => { const had = ops.find((x) => x.op === r.op)?.needs; r.op = o.op; if (!o.needs)
                            delete r.value;
                        else if (!had)
                            r.value = defaultValue(p, o.op); save(); nav.refresh(); } }))), 'rule-op'), valueControl(r, p, nav), x);
                }
            }
            drag(row, i, grip);
            rows.push({ el: row });
        });
        return rows;
    };
    const filterPage = () => ({
        title: 'Filter',
        rows: (nav) => {
            const g = view.filter;
            const rows = conditionRows({ get: () => view.filter, drop: () => { delete view.filter; } }, nav);
            if (!g?.rules.length)
                rows.push({ el: h('div', { class: 'muted small vpanel-empty' }, 'No filters – every entry is shown.') });
            rows.push('sep', { label: 'Add a filter', icon: menuIcon('plus-circle'), go: () => ({
                    title: 'Filter by', rows: () => props().map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), pick: () => { const op = opsFor(p)[0].op; addRule(p, op, defaultValue(p, op)); }, back: true })),
                }) });
            if (g?.rules.length)
                rows.push({ label: 'Remove all filters', icon: menuIcon('trash'), danger: true, pick: () => { delete view.filter; save(); } });
            return rows;
        },
    });
    // ----- conditional colours: rules with conditions, a colour and where it goes -----
    const colorNames = () => Object.keys(COLORS).filter((c) => c !== 'default');
    const dot = (c) => c.startsWith('match:')
        ? h('span', { class: 'rule-dot rule-dot-match', title: `${c.slice(6)} color` })
        : colorDot(c);
    const ruleColorName = (c) => (c.startsWith('match:') ? `${c.slice(6)} color` : colorLabel(c));
    const describeColorRule = (r) => {
        const conds = r.filter.rules.filter((x) => !('rules' in x));
        if (!conds.length)
            return r.color.startsWith('match:') ? `Every entry · ${r.color.slice(6)} color` : 'No conditions yet';
        return conds.map(describeRule).join(r.filter.mode === 'or' ? ' or ' : ' and ');
    };
    const colorRulePage = (rule) => ({
        title: 'Color rule',
        rows: (nav) => {
            const rows = [
                { label: 'Color', icon: h('span', { class: 'menu-ico' }, dot(rule.color)), hint: ruleColorName(rule.color), go: () => ({
                        title: 'Color', rows: () => {
                            const opts = props().filter((p) => p.type === 'select' || p.type === 'multi_select');
                            return [
                                ...(opts.length ? [{ section: 'Match an option' }, ...opts.map((p) => ({ label: `${p.name} color`, icon: typeIcon(p.type, p.icon), checked: rule.color === `match:${p.name}`, pick: () => { rule.color = `match:${p.name}`; save(); }, back: true })), { section: 'One color' }] : []),
                                ...colorNames().map((c) => ({ label: colorLabel(c), icon: h('span', { class: 'menu-ico' }, dot(c)), checked: rule.color === c, pick: () => { rule.color = c; save(); }, back: true })),
                            ];
                        },
                    }) },
                { label: 'Apply to', icon: menuIcon('layout'), hint: rule.target ?? (view.type === 'table' ? 'Whole row' : 'Whole entry'), go: () => ({
                        title: 'Apply to', rows: () => [
                            { label: view.type === 'table' ? 'Whole row' : 'Whole entry', checked: !rule.target, pick: () => { delete rule.target; save(); }, back: true },
                            ...(view.type === 'table' ? [{ section: 'One property' }, ...props().filter((p) => shownNames().includes(p.name)).map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: rule.target === p.name, pick: () => { rule.target = p.name; save(); }, back: true }))] : []),
                        ]
                    }) },
                { section: 'When' },
                ...conditionRows({ get: () => rule.filter, drop: () => { rule.filter = { mode: 'and', rules: [] }; } }, nav),
            ];
            rows.push('sep', { label: 'Add a condition', icon: menuIcon('plus-circle'), go: () => ({
                    title: 'Condition', rows: () => props().map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), pick: () => { const op = opsFor(p)[0].op; rule.filter.rules.push({ prop: p.name, op, value: defaultValue(p, op) }); save(); }, back: true })),
                }) });
            rows.push({ label: 'Delete rule', icon: menuIcon('trash'), danger: true, pick: () => { view.colorRules = (view.colorRules ?? []).filter((x) => x !== rule); if (!view.colorRules.length)
                    delete view.colorRules; save(); nav.back(); } });
            return rows;
        },
    });
    const colorRulesPage = () => ({
        title: 'Conditional color',
        rows: (nav) => {
            const rows = [];
            const list = view.colorRules ?? [];
            const drag = dragRows(() => view.colorRules ?? [], nav);
            list.forEach((r, i) => {
                const grip = h('span', { class: 'rule-grip', title: 'Drag to change the order (the first matching rule wins)' }, svgIcon(ICONS.grip, 14, { fill: true }));
                const row = h('div', { class: 'rule-row color-rule-row', role: 'button', tabindex: 0, title: 'Edit this rule' }, grip, dot(r.color), h('span', { class: 'rule-text' }, describeColorRule(r)), h('span', { class: 'rule-target muted small' }, r.target ?? (view.type === 'table' ? 'Row' : 'Entry')), h('span', { class: 'sub-arrow' }, '›'));
                row.addEventListener('click', (e) => { if (!e.target.closest('.rule-grip'))
                    nav.go(colorRulePage(r)); });
                row.addEventListener('keydown', (e) => { if (e.key === 'Enter') {
                    e.preventDefault();
                    nav.go(colorRulePage(r));
                } });
                drag(row, i, grip);
                rows.push({ el: row });
            });
            rows.push('sep', { label: 'Add a rule', icon: menuIcon('plus-circle'), pick: () => {
                    const used = new Set(list.map((x) => x.color));
                    const rule = { id: ulid(), color: colorNames().find((c) => !used.has(c) && c !== 'gray') ?? 'red', filter: { mode: 'and', rules: [] } };
                    view.colorRules = [...list, rule];
                    save();
                    nav.go(colorRulePage(rule));
                } });
            return rows;
        },
    });
    const addRule = (p, op, value) => {
        view.filter ??= { mode: 'and', rules: [] };
        view.filter.rules.push({ prop: p.name, op, value });
        save();
    };
    const periodPage = () => ({
        title: 'Period switcher',
        rows: () => {
            const set = (fn) => () => { fn(); env.state.offset = 0; save(); };
            const rows = [
                // one switch says what this page does: a Week / Month / Year bar above the view, filtering by a date
                { label: 'Show the switcher', icon: menuIcon('calendar'), toggle: !!view.period, onToggle: set(() => { const d = props().find(isDates); view.period = view.period || !d ? undefined : { unit: 'month', prop: d.name }; }) },
                ...(view.period ? [{ section: 'Filter by date' }] : []),
                ...props().filter(isDates).filter(() => !!view.period).map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.period?.prop === p.name, pick: set(() => { view.period = { unit: 'month', ...view.period, prop: p.name }; }) })),
            ];
            if (view.period) {
                if (!env.fullPage && view.simplified) {
                    const range = periodRange(view.period, env.state.offset);
                    rows.push('sep', { section: range?.label ?? 'All time' }, ...['week', 'month', 'year', 'all'].filter((u) => u !== 'week' || weeksOn(view.period)).map((unit) => ({ label: unit === 'week' ? 'Week' : unit === 'month' ? 'Month' : unit === 'year' ? 'Year' : 'All', checked: view.period.unit === unit,
                        pick: set(() => { view.period.unit = unit; }) })), ...(range ? [
                        { label: 'Previous period', icon: menuIcon('arrow-left'), pick: () => { env.state.offset--; env.redraw(); } },
                        { label: 'Current period', icon: menuIcon('calendar-days'), pick: () => { env.state.offset = 0; env.redraw(); } },
                        { label: 'Next period', icon: menuIcon('arrow-right'), pick: () => { env.state.offset++; env.redraw(); } },
                    ] : []));
                }
                const ys = view.period.yearStart ?? 1;
                rows.push('sep', { label: 'Year starts in', hint: MONTHS[ys - 1], go: () => ({ title: 'Year starts in', rows: () => MONTHS.map((m, i) => ({
                            label: m, checked: ys === i + 1,
                            pick: set(() => { if (i === 0)
                                delete view.period.yearStart;
                            else
                                view.period.yearStart = i + 1; }), back: true,
                        })) }) });
                const per = view.period;
                rows.push({ label: 'Weeks', toggle: weeksOn(per), onToggle: () => {
                        if (weeksOn(per)) {
                            delete per.weeks;
                            if (per.unit === 'week') {
                                per.unit = 'month';
                                env.state.offset = 0;
                            }
                        }
                        else
                            per.weeks = true;
                        save();
                    } });
                if (weeksOn(per)) {
                    const labels = [['kw', 'KW + number'], ['number', 'Week + number'], ['range', 'Date range'], ['start', 'First day']];
                    const cur = periodRange({ ...per, unit: 'week' }, 0);
                    const sample = (how) => { const r0 = periodRange({ ...per, unit: 'week', weekLabel: how }, 0); return r0?.label ?? ''; };
                    rows.push({ label: 'Week shown as', hint: cur?.label, go: () => ({ title: 'Week shown as', rows: () => labels.map(([k, l]) => ({
                                label: l, hint: sample(k), checked: (per.weekLabel ?? 'range') === k, pick: () => { if (k === 'range')
                                    delete per.weekLabel;
                                else
                                    per.weekLabel = k; save(); }, back: true,
                            })) }) });
                }
            }
            return rows;
        },
    });
    const viewDrag = (el, id, after) => makeViewDrag(el, id, db, () => { env.ctx.ws.saveViews(db); env.redraw(); after(); });
    const tabsPage = () => ({
        title: 'Views in this block',
        rows: (nav) => {
            const shown = env.tabs.shown ?? db.views.map((v) => v.id);
            const rows = db.views.map((v) => {
                const on = shown.includes(v.id);
                const toggle = () => {
                    const next = on ? shown.filter((x) => x !== v.id) : db.views.filter((x) => shown.includes(x.id) || x.id === v.id).map((x) => x.id);
                    if (next.length)
                        env.tabs.set(next);
                    else
                        toast('At least one view stays visible');
                    nav.refresh();
                };
                const row = h('div', { class: 'prop-row view-row', draggable: true, role: 'switch', 'aria-checked': String(on), tabindex: '0', title: 'Drag to change the order of the views', onclick: toggle,
                    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle();
                    } } }, h('span', { class: 'prop-grip', 'aria-hidden': 'true' }, svgIcon(ICONS.grip, 14, { fill: true })), menuIcon(VIEW_TYPES.find((t) => t.type === v.type)?.icon ?? 'table'), h('span', { class: 'prop-row-name' }, v.name), h('span', { class: 'switch' + (on ? ' on' : ''), 'aria-hidden': 'true' }, h('span')));
                // drag to change the order of the views (for the whole database, like the tabs)
                viewDrag(row, v.id, () => nav.refresh());
                return { el: row };
            });
            rows.push('sep', { label: 'Show all views', pick: () => env.tabs.set(null) });
            return rows;
        },
    });
    // ---------- template property values ----------
    const DEFAULTABLE = ['date', 'select', 'multi_select', 'checkbox', 'text', 'number', 'url'];
    const describe = (p, v) => {
        if (v === undefined)
            return 'None';
        if (p.type === 'date') {
            const s = v.start;
            return s === '@today' ? 'Today' : s === '@now' ? 'Now (date and time)' : String(s);
        }
        if (p.type === 'checkbox')
            return v ? 'Checked' : 'Not checked';
        if (Array.isArray(v))
            return v.join(', ');
        return String(v);
    };
    /** Pick a template property value. */
    const startValuePage = (p, get, set) => ({
        title: p.name,
        top: ['text', 'number', 'url'].includes(p.type) ? () => {
            const inp = h('input', { class: 'pop-input', type: p.type === 'number' ? 'number' : 'text', placeholder: 'Value (empty = none)', value: get()[p.name] == null ? '' : String(get()[p.name]), 'aria-label': `Value of ${p.name}` });
            inp.addEventListener('change', () => set(p.name, inp.value.trim() === '' ? undefined : p.type === 'number' ? Number(inp.value) : inp.value.trim()));
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter')
                inp.blur(); });
            requestAnimationFrame(() => inp.focus());
            return h('div', { class: 'vpanel-top' }, inp);
        } : undefined,
        rows: (nav) => {
            const cur = get()[p.name];
            if (p.type === 'date')
                return [[undefined, 'None'], ['@today', 'Today'], ['@now', 'Now (date and time)']].map(([k, l]) => ({ label: l, checked: cur?.start === k || (!cur && !k), pick: () => set(p.name, k ? { start: k } : undefined), back: true }));
            if (p.type === 'checkbox')
                return [{ label: 'Checked', toggle: cur === true, onToggle: () => set(p.name, cur === true ? undefined : true) }];
            if (p.type === 'select')
                return [{ label: 'None', checked: cur === undefined, pick: () => set(p.name, undefined), back: true }, ...(p.options ?? []).map((o) => ({ label: o.name, checked: cur === o.name, pick: () => set(p.name, o.name), back: true }))];
            if (p.type === 'multi_select') {
                const list = Array.isArray(cur) ? cur : [];
                return (p.options ?? []).map((o) => ({ label: o.name, toggle: list.includes(o.name), onToggle: () => { set(p.name, list.includes(o.name) ? list.filter((x) => x !== o.name) : [...list, o.name]); nav.refresh(); } }));
            }
            return [{ label: 'Press Enter to keep the value', hint: '' }];
        },
    });
    // ---------- templates: named starting points for new entries (values and page content) ----------
    const tpls = () => db.schema.templates ?? [];
    const saveSchema = () => { env.ctx.ws.boundary(); env.ctx.ws.saveSchema(db).then(() => env.redraw()); };
    const templatePage = (name) => ({
        title: name,
        rows: (nav) => {
            const t = tpls().find((x) => x.name === name);
            if (!t)
                return [{ label: 'This template was deleted', hint: '' }];
            const setValue = (prop, v) => {
                if (v === undefined || v === '' || (Array.isArray(v) && !v.length))
                    delete t.values[prop];
                else
                    t.values[prop] = v;
                saveSchema();
            };
            const isDefault = db.schema.defaultTemplate === t.name;
            const rows = [
                { label: 'Name', icon: menuIcon('type'), hint: t.name, pick: () => {
                        const at = anchor instanceof Element && anchor.isConnected ? anchor : { x: innerWidth / 2 - 150, y: 120 };
                        prompt(at, 'Template name', t.name, (v) => {
                            const n = v.trim();
                            if (!n || n === t.name)
                                return;
                            if (tpls().some((x) => x.name === n)) {
                                toast('A template with this name exists');
                                return;
                            }
                            if (db.schema.defaultTemplate === t.name)
                                db.schema.defaultTemplate = n;
                            t.name = n;
                            saveSchema();
                            nav.back();
                            nav.go(templatePage(n));
                        });
                    } },
                { label: 'Use for every new entry', icon: menuIcon('star'), toggle: isDefault, onToggle: () => { if (isDefault)
                        delete db.schema.defaultTemplate;
                    else
                        db.schema.defaultTemplate = t.name; saveSchema(); nav.refresh(); } },
                { label: 'Page content…', icon: menuIcon('file-text'), hint: t.body?.trim() ? 'Edit' : 'Empty', run: () => editTemplateBody(env, db, t, saveSchema) },
                'sep', { section: 'Values' },
                ...props().filter((x) => DEFAULTABLE.includes(x.type) || x.type === 'title').map((p) => p.type === 'title'
                    ? { label: p.name, icon: typeIcon(p.type, p.icon), hint: String(t.values[p.name] ?? '—'), go: () => startValuePage({ ...p, type: 'text' }, () => t.values, setValue) }
                    : { label: p.name, icon: typeIcon(p.type, p.icon), hint: describe(p, t.values[p.name]), go: () => startValuePage(p, () => t.values, setValue) }),
                'sep',
                { label: 'Duplicate template', icon: menuIcon('file-plus'), pick: () => { let n = `${t.name} (copy)`; while (tpls().some((x) => x.name === n))
                        n += ' '; (db.schema.templates ??= []).push({ ...structuredClone(t), name: n }); saveSchema(); nav.back(); } },
                { label: 'Delete template', icon: menuIcon('trash'), danger: true, pick: () => { db.schema.templates = tpls().filter((x) => x !== t); if (!db.schema.templates.length)
                        delete db.schema.templates; if (db.schema.defaultTemplate === t.name)
                        delete db.schema.defaultTemplate; saveSchema(); nav.back(); } },
            ];
            return rows;
        },
    });
    const templatesPage = () => ({
        title: 'Templates',
        rows: (nav) => [
            ...tpls().map((t) => ({ label: t.name, icon: menuIcon('file-text'), hint: t.name === db.schema.defaultTemplate ? 'default' : '', go: () => templatePage(t.name) })),
            ...(tpls().length ? ['sep'] : []),
            { label: 'New template', icon: menuIcon('plus-circle'), pick: () => {
                    let n = 'New template', i = 2;
                    while (tpls().some((x) => x.name === n))
                        n = `New template ${i++}`;
                    (db.schema.templates ??= []).push({ name: n, values: {} });
                    saveSchema();
                    nav.go(templatePage(n));
                } },
        ],
    });
    const newEntriesRow = () => {
        const hasNewButton = ['table', 'list', 'board', 'gallery'].includes(view.type);
        const where = hasNewButton ? (view.newAt === 'top' ? 'Top' : view.newAt === 'both' ? 'Top + bottom' : 'Bottom') + ' · ' : '';
        return {
            label: 'New entries', icon: menuIcon('plus-circle'), hint: `${where}${view.newOpens === 'stay' && !phone ? 'Stay' : 'Open'}`,
            go: () => ({ title: 'New entries', rows: (nav) => {
                    const rows = [
                        { label: 'Open entries in', icon: menuIcon('maximize'), hint: view.openIn === 'page' ? 'Full page' : 'Center peek', go: () => ({
                                title: 'Open entries in', rows: () => [
                                    { label: 'Center peek', checked: view.openIn !== 'page', pick: () => { delete view.openIn; save(); }, back: true },
                                    { label: 'Full page', checked: view.openIn === 'page', pick: () => { view.openIn = 'page'; save(); }, back: true },
                                ]
                            }) },
                        'sep',
                    ];
                    if (hasNewButton)
                        rows.push({ section: '“New” button' }, ...[[undefined, 'At the bottom'], ['top', 'At the top'], ['both', 'Top and bottom']].map(([k, l]) => ({ label: l, checked: view.newAt === k, pick: () => { if (k)
                                view.newAt = k;
                            else
                                delete view.newAt; save(); nav.refresh(); } })), 'sep');
                    // on a phone a new entry always opens (there is no typing its name in place)
                    if (!phone)
                        rows.push({ section: 'When you click “New”' }, { label: 'Open the new entry', hint: view.openIn === 'page' ? 'as full page' : 'in the center peek', checked: view.newOpens !== 'stay', pick: () => { delete view.newOpens; save(); nav.refresh(); } }, { label: db.dateLabel ? 'Stay here and choose its date' : 'Stay here and type its name', checked: view.newOpens === 'stay', pick: () => { view.newOpens = 'stay'; save(); nav.refresh(); } }, 'sep');
                    rows.push({ section: `Templates of ${db.schema.name}` }, { label: 'Templates', icon: menuIcon('file-text'), hint: tpls().length ? `${tpls().length}${db.schema.defaultTemplate ? ` · default: ${db.schema.defaultTemplate}` : ''}` : 'None', go: templatesPage });
                    // The hidden blue New button and its template picker remain reachable here.
                    if (!env.fullPage && view.simplified)
                        rows.push('sep', { label: 'New entry', icon: menuIcon('plus-circle'), run: () => { env.newRow(undefined, true); } }, { label: 'New from template', icon: menuIcon('file-text'), go: () => ({ title: 'New from template', rows: () => [
                                    { label: 'Empty entry', run: () => { env.newRow(undefined, true, ''); } },
                                    ...tpls().map((t) => ({ label: t.name, run: () => { env.newRow(undefined, true, t.name); } })),
                                ] }) });
                    return rows;
                } }),
        };
    };
    // ---------- view-only calendars shown in this calendar view ----------
    const externalCalsPage = () => ({
        title: 'External calendars',
        rows: () => {
            const key = `${db.key}:${view.id}`;
            return [
                ...calendars.cfg.subscriptions.map((sub) => ({ label: sub.name, icon: h('span', { class: 'menu-ico' }, h('span', { class: 'sub-swatch', style: { background: sub.color } })), toggle: subShownIn(sub, key), onToggle: () => {
                        setSubShown(sub, key, !subShownIn(sub, key), calendarViewKeys(env.ctx.ws));
                        saveConfig(env.ctx.ws, calendars.cfg).then(() => env.ctx.ws.emit());
                    } })),
                'sep', { label: 'Manage calendars…', icon: menuIcon('settings'), run: () => window.dispatchEvent(new CustomEvent('nook-open-settings', { detail: 'calendars' })) },
            ];
        },
    });
    // ---------- main page ----------
    const main = {
        title: view.name || 'View options',
        rows: () => {
            const nShown = shownNames().filter((n) => db.prop(n)).length;
            // 1 View · 2 Entries · 3 Behaviour · 4 Database › · then views, toolbar and this view itself (delete last)
            const rows = [
                { section: 'View' },
                { label: 'Layout', icon: menuIcon('layout'), hint: VIEW_TYPES.find((t) => t.type === view.type)?.label, go: layoutPage },
                { label: 'Properties', icon: menuIcon('list'), hint: `${nShown} shown${props().length > nShown ? `, ${props().length - nShown} hidden` : ''}`, go: propertiesPage },
                { section: 'Entries' },
                { label: 'Filter', icon: menuIcon('filter'), hint: view.filter?.rules.length ? `${view.filter.rules.length} filter${view.filter.rules.length > 1 ? 's' : ''}` : 'None', go: filterPage },
                { label: 'Sort', icon: menuIcon('arrow-down'), hint: view.sorts?.length ? view.sorts.map((s) => s.prop).join(', ') : 'None', go: sortPage },
            ];
            if (groupable())
                rows.push({ label: 'Group', icon: menuIcon('layers'), hint: view.groupBy?.prop ?? 'None', go: groupPage });
            if (view.type === 'board')
                rows.push({ label: 'Sub-group', icon: menuIcon('rows'), hint: view.subGroupBy?.prop ?? 'None', go: () => ({ title: 'Sub-group', rows: () => {
                            const can = props().filter((p) => ['select', 'multi_select', 'checkbox'].includes(p.type) && p.name !== view.groupBy?.prop);
                            return [
                                { label: 'None', checked: !view.subGroupBy, pick: () => { delete view.subGroupBy; save(); } },
                                ...can.map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: view.subGroupBy?.prop === p.name, pick: () => { view.subGroupBy = { ...(view.subGroupBy ?? {}), prop: p.name }; save(); } })),
                                ...(view.subGroupBy ? ['sep', { label: 'Show empty sub-groups', toggle: view.subGroupBy.hideEmpty === false, onToggle: () => { view.subGroupBy.hideEmpty = view.subGroupBy.hideEmpty !== false; save(); } }] : []),
                            ];
                        } }) });
            if (view.type !== 'calendar')
                rows.push({ label: 'Period switcher', icon: menuIcon('calendar-days'), hint: view.period ? view.period.prop : 'Off', go: periodPage });
            if ((view.type === 'calendar' || view.type === 'list') && calendars.cfg.subscriptions.length)
                rows.push({ label: 'External calendars', icon: menuIcon('calendar-days'), hint: `${overlaysFor(`${db.key}:${view.id}`).length} of ${calendars.cfg.subscriptions.length}`, go: externalCalsPage });
            if (view.type === 'day') {
                const c = dayConfig(db);
                rows.push({ label: 'Phone layout', icon: menuIcon('smartphone'), hint: c.phoneFirst === 'record' ? 'Recording first' : 'Timeline first', go: () => ({ title: 'Phone layout', rows: () => [
                            { section: 'On the phone, the two columns are one – first comes' },
                            { label: 'Timeline and what shows things', checked: c.phoneFirst !== 'record', pick: () => { delete c.phoneFirst; void env.ctx.ws.saveSchema(db); env.redraw(); }, back: true },
                            { label: 'Mood, water, habits … (recording)', checked: c.phoneFirst === 'record', pick: () => { c.phoneFirst = 'record'; void env.ctx.ws.saveSchema(db); env.redraw(); }, back: true },
                        ] }) });
                // what the modules store: used ones can be renamed, left-over ones deleted
                const RECORD = ['number', 'checkbox', 'text'];
                const usersOf = (name) => c.modules.filter((m) => m.prop === name || m.props?.includes(name)).map((m) => m.title);
                const stored = () => db.schema.properties.filter((p) => p.name !== db.titleProp && p.name !== c.prop && RECORD.includes(p.type) && !p.name.includes(' · '));
                const unusedN = () => stored().filter((p) => !usersOf(p.name).length).length;
                rows.push({ label: 'Stored values', icon: menuIcon('database'), hint: unusedN() ? `${unusedN()} unused` : String(stored().length), go: () => ({ title: 'Stored values', rows: (nav) => {
                            const count = (p) => db.rows.filter((r) => r.values[p.name] != null && r.values[p.name] !== '' && r.values[p.name] !== false).length;
                            const btn = (icon, label, run) => h('button', { class: 'icon-btn rule-x', 'aria-label': label, title: label, onclick: (e) => { e.stopPropagation(); run(e.currentTarget); } }, iconSvg(icon, 15));
                            const rename = (p, at) => prompt(at, 'Name', p.name, async (v) => {
                                const name = v.trim();
                                if (!name || name === p.name || db.prop(name))
                                    return;
                                const old = p.name;
                                env.ctx.ws.boundary();
                                await env.ctx.ws.renameProp(db, old, name);
                                // modules and Trends follow the new name
                                for (const m of c.modules) {
                                    if (m.prop === old)
                                        m.prop = name;
                                    if (m.props)
                                        m.props = m.props.map((x) => (x === old ? name : x));
                                }
                                for (const t of c.trends ?? []) {
                                    if (t.m === `p:${old}`)
                                        t.m = `p:${name}`;
                                    if (t.b === old)
                                        t.b = name;
                                    if (t.props)
                                        t.props = t.props.map((x) => (x === old ? name : x));
                                }
                                await env.ctx.ws.saveSchema(db);
                                env.redraw();
                                nav.refresh();
                            });
                            const del = async (p) => {
                                db.schema.properties = db.schema.properties.filter((x) => x !== p);
                                for (const v of db.views)
                                    removePropFromView(v, p.name);
                                env.ctx.ws.boundary();
                                await env.ctx.ws.saveSchema(db);
                                await env.ctx.ws.saveViews(db);
                                env.redraw();
                                nav.refresh();
                                toast(`“${p.name}” deleted · ⌘Z to undo`);
                            };
                            const row = (p, used) => {
                                const n = count(p);
                                return { el: h('div', { class: 'prop-row unused-row' }, typeIcon(p.type, p.icon), h('span', { class: 'prop-row-name' }, p.name), h('span', { class: 'hint' }, used.length ? used.join(', ') : n ? `${n} day${n === 1 ? '' : 's'}` : 'empty'), used.length ? btn('pencil', `Rename ${p.name}`, (at) => rename(p, at)) : btn('trash', `Delete ${p.name}`, () => void del(p))) };
                            };
                            const used = stored().filter((p) => usersOf(p.name).length), unused = stored().filter((p) => !usersOf(p.name).length);
                            return [
                                ...(used.length ? [{ section: 'Used by modules' }, ...used.map((p) => row(p, usersOf(p.name)))] : []),
                                ...(unused.length ? [{ section: 'Left over from removed modules' }, ...unused.map((p) => row(p, []))] : []),
                            ];
                        } }) });
            }
            if (view.type === 'day')
                rows.push({ label: 'Databases in this log', icon: menuIcon('database'), hint: String(dayConfig(db).sources.length || 'None'), go: () => ({ title: 'Databases in this log', rows: () => menuToPanel(logDatabaseEntries(env)) }) });
            rows.push({ section: 'Behaviour' }, newEntriesRow(), { label: 'Identify entries by', icon: menuIcon('calendar'), hint: db.dateLabel ?? db.titleProp, go: () => ({
                    title: 'Identify entries by', rows: () => [
                        { section: 'Applies to every view of this database' },
                        { label: db.titleProp + ' (name)', icon: typeIcon('title', db.prop(db.titleProp)?.icon), checked: !db.dateLabel, pick: async () => { delete db.schema.dateLabel; await env.ctx.ws.saveSchema(db); env.ctx.ws.emit(); env.redraw(); }, back: true },
                        ...props().filter((p) => p.type === 'date').map((p) => ({ label: p.name, icon: typeIcon(p.type, p.icon), checked: db.dateLabel === p.name, pick: async () => { db.schema.dateLabel = p.name; await env.ctx.ws.saveSchema(db); env.ctx.ws.emit(); env.redraw(); }, back: true })),
                        ...(db.dateLabel ? [{ label: 'Show optional name field', toggle: !!db.schema.showNameWithDate, onToggle: async () => { db.schema.showNameWithDate = !db.schema.showNameWithDate; await env.ctx.ws.saveSchema(db); env.ctx.ws.emit(); env.redraw(); } }] : []),
                    ],
                }) });
            if (['table', 'list', 'board', 'gallery'].includes(view.type))
                rows.push(loadRow());
            // the simplified toolbar has no search button
            if ((!env.fullPage && view.simplified) || env.narrow?.())
                rows.push({ label: 'Search', icon: menuIcon('search'), run: () => { env.state.searchOpen = true; env.redraw(); } });
            // everything that changes the whole database (every view): one page
            const dbRowsOf = (nav) => {
                const dbRows = [];
                // "Entries are files": only while there's nothing to lose (no entries; or, once on, no files yet); drawn again in place
                {
                    const box = h('div', { class: 'fdb-toggle' });
                    const draw = () => {
                        const sw = canSwitch(db), files = !!db.schema.files;
                        box.className = 'fdb-toggle' + (sw.ok ? '' : ' locked');
                        const why = sw.ok ? null : h('div', { class: 'fdb-why', hidden: true }, h('b', null, sw.why === 'entries' ? 'Already has entries' : 'Holds files'), h('span', null, sw.why === 'entries' ? 'Only an empty database can hold files. To work with files, create a new database.' : 'This database holds files, so it can’t go back to entries. For entries, create a new database.'), h('button', { class: 'set-btn with-icon', onclick: (e) => { e.stopPropagation(); closePop(); env.ctx.newDatabase?.(); } }, iconSvg('plus', 13), 'New database'));
                        box.replaceChildren(h('div', { class: 'fdb-toggle-row', role: 'button', tabindex: 0, onclick: async () => {
                                if (!sw.ok) {
                                    why?.toggleAttribute('hidden');
                                    return;
                                }
                                env.ctx.ws.boundary();
                                await switchFiles(env.ctx.ws, db, !files);
                                toast(files ? 'Entries are pages again' : 'Entries are files now – New uploads files');
                                env.redraw();
                                if (nav)
                                    nav.refresh();
                                else
                                    draw();
                            } }, menuIcon('folder'), h('span', { class: 'fdb-toggle-label' }, 'Entries are files'), sw.ok ? null : iconSvg('lock', 13), switchControl(files, () => { }, 'Entries are files')), h('div', { class: 'fdb-desc' }, files ? `Each file in the folder ${db.dir}/files is an entry, subfolders stay folders.` : 'Each file in the database folder becomes an entry, subfolders stay folders.'), ...(why ? [why] : []));
                    };
                    draw();
                    dbRows.push({ el: box }, 'sep');
                }
                if (!db.schema.files && props().some((p) => p.type === 'date'))
                    dbRows.push({ label: 'Repeating entries', icon: menuIcon('repeat'), toggle: db.schema.repeat !== false, onToggle: () => {
                            if (db.schema.repeat === false)
                                delete db.schema.repeat;
                            else
                                db.schema.repeat = false;
                            env.ctx.ws.boundary();
                            env.ctx.ws.saveSchema(db).then(() => env.ctx.ws.emit());
                        } });
                // sub-items (as in Notion): entries nest under other entries; shown as a tree in tables
                if (!db.schema.files)
                    dbRows.push({ label: 'Sub-items', icon: menuIcon('list'), toggle: !!db.schema.subItems, onToggle: async () => {
                            env.ctx.ws.boundary();
                            if (db.schema.subItems) {
                                delete db.schema.subItems;
                                await env.ctx.ws.saveSchema(db);
                                toast('Sub-items off – the “Parent item” and “Sub-items” properties stay');
                            }
                            else {
                                await env.ctx.ws.enableSubItems(db);
                                toast('Sub-items on – right-click an entry → Add sub-item');
                            }
                            env.redraw();
                        } });
                if (!env.ctx.isDbPage?.(db.key))
                    dbRows.push({ label: 'Open database as full page', icon: menuIcon('maximize'), run: () => env.ctx.openDb(db.key) });
                dbRows.push({ label: 'Find duplicates…', icon: menuIcon('layers'), run: () => openDuplicates(env.ctx, db) });
                if (db.schema.files && env.ctx.openHistory)
                    dbRows.push({ label: 'History of tags & values', icon: menuIcon('clock'), run: () => env.ctx.openHistory(`${db.dir}/files.json`) });
                if (env.ctx.importCsvFile && !db.schema.files)
                    dbRows.push({ label: 'Import CSV…', icon: menuIcon('arrow-down'), run: () => env.ctx.importCsvFile(db) });
                return dbRows;
            };
            rows.push({ section: 'Database' }, { label: db.schema.name, icon: menuIcon('database'), hint: 'All views', go: () => ({ title: db.schema.name, rows: (nav) => [{ section: 'Applies to every view' }, ...dbRowsOf(nav)] }) });
            const viewControls = () => {
                const tabRows = [
                    { label: 'Switch view', icon: menuIcon(VIEW_TYPES.find((t) => t.type === view.type)?.icon ?? 'table'), hint: view.name, go: () => ({
                            title: 'Switch view', rows: () => [
                                ...db.views.map((v) => ({ label: v.name, icon: v.icon ? h('span', { class: 'menu-ico' }, renderIcon(v.icon, 16)) : menuIcon(VIEW_TYPES.find((t) => t.type === v.type)?.icon ?? 'table'),
                                    checked: v.id === view.id, run: () => selectTab(v.id) })),
                                'sep',
                                { label: 'Rename current view', icon: menuIcon('pencil'), run: () => prompt(anchor, 'View name', view.name, (name) => { if (name.trim()) {
                                        view.name = name.trim();
                                        save();
                                    } }) },
                                { label: 'Add view', icon: menuIcon('plus-circle'), run: () => env.addView?.(anchor instanceof Element && !anchor.isConnected ? { x: innerWidth / 2 - 150, y: 120 } : anchor) },
                            ],
                        }) },
                    { label: 'Icon of this view', icon: view.icon ? h('span', { class: 'menu-ico' }, renderIcon(view.icon, 16)) : menuIcon('sparkles'), hint: view.icon ? 'Change' : 'None', run: () => {
                            const at = anchor instanceof Element && anchor.isConnected ? anchor : { x: innerWidth / 2 - 150, y: 120 };
                            pickIcon(at, view.icon, (v) => { if (v)
                                view.icon = v;
                            else
                                delete view.icon; save(); });
                        } },
                    { label: 'Tabs show', icon: menuIcon('columns'), hint: { auto: 'Name (and own icons)', both: 'Icon and name', icon: 'Only icons', name: 'Only names' }[env.tabs.style()], go: () => ({ title: 'Tabs show', rows: () => [['auto', 'Name, plus icons you chose'], ['both', 'Icon and name'], ['icon', 'Only icons'], ['name', 'Only names']].map(([k, l]) => ({ label: l, checked: env.tabs.style() === k, pick: () => env.tabs.setStyle(k), back: true })) }) }
                ];
                if (db.views.length > 1)
                    tabRows.push({ label: 'Views in this block', icon: menuIcon('kanban'), hint: env.tabs.shown ? `${env.tabs.shown.length} of ${db.views.length}` : 'All', go: tabsPage });
                return forDevice(tabRows);
            };
            rows.push('sep', { label: 'Views, tabs & icons', icon: menuIcon('columns'), hint: `${db.views.length} view${db.views.length > 1 ? 's' : ''}`, go: () => ({ title: 'Views, tabs & icons', rows: viewControls }) });
            if (!env.fullPage)
                rows.push({ label: 'Toolbar', icon: menuIcon('layout'), hint: view.barAt === 'bottom' ? 'Bottom' : 'Top', go: () => ({ title: 'Toolbar', rows: () => [
                            { label: 'Top', checked: view.barAt !== 'bottom', pick: () => { delete view.barAt; save(); }, back: true },
                            { label: 'Bottom', checked: view.barAt === 'bottom', pick: () => { view.barAt = 'bottom'; save(); }, back: true },
                            'sep',
                            { label: 'Simplified', toggle: !!view.simplified, onToggle: () => { if (view.simplified)
                                    delete view.simplified;
                                else
                                    view.simplified = true; save(); } },
                            { label: 'Database tabs as a dropdown', toggle: !!view.simpleTabs, disabled: !view.simplified, onToggle: () => { if (view.simpleTabs)
                                    delete view.simpleTabs;
                                else
                                    view.simpleTabs = true; save(); } },
                            { label: 'Search icon', toggle: !!view.simpleSearch, disabled: !view.simplified, onToggle: () => { if (view.simpleSearch)
                                    delete view.simpleSearch;
                                else
                                    view.simpleSearch = true; save(); } },
                            { label: 'Settings icon', toggle: view.simpleSettings !== false, disabled: !view.simplified, onToggle: () => {
                                    if (view.simpleSettings === false)
                                        delete view.simpleSettings;
                                    else
                                        view.simpleSettings = false;
                                    save();
                                } },
                        ] }) });
            rows.push('sep', { label: 'Rename view', icon: menuIcon('pencil'), run: () => prompt(anchor, 'View name', view.name, (name) => { if (name.trim()) {
                    view.name = name.trim();
                    save();
                } }) }, { label: 'Duplicate view', icon: menuIcon('file-plus'), run: () => { const v = { ...structuredClone(view), id: ulid().slice(-8).toLowerCase(), name: `${view.name} (copy)` }; db.views.push(v); env.saveView(); selectTab(v.id); } }, 'sep', { label: 'Delete view', icon: menuIcon('trash'), danger: true, run: () => {
                    if (db.views.length < 2) {
                        toast('A database needs at least one view');
                        return;
                    }
                    db.views = db.views.filter((v) => v !== view);
                    env.saveView();
                    const left = (env.tabs.shown ?? []).filter((id) => id !== view.id && db.views.some((v) => v.id === id));
                    selectTab(left[0] ?? db.views[0].id);
                } });
            return forDevice(rows);
        },
    };
    // a toolbar button (filter, sort …) opens its page directly, the whole settings otherwise
    const first = { properties: propertiesPage, filter: filterPage, sort: sortPage, group: groupPage, layout: layoutPage, templates: templatesPage }[start ?? ''];
    return panel(anchor, first ? first() : main);
}
/** a template's page content, edited like any page */
function editTemplateBody(env, db, t, save) {
    const blocks = parsePage(t.body ?? '');
    if (!blocks.length)
        blocks.push({ id: ulid(), type: 'paragraph', text: '' });
    const store = debounce(() => { const body = serializePage(blocks); if (body.trim())
        t.body = body;
    else
        delete t.body; save(); }, 400);
    const editor = new Editor(blocks, env.ctx, store);
    const nameIn = h('input', { class: 'set-input', value: t.name, onchange: () => { const old = t.name; t.name = nameIn.value.trim() || old; if (db.schema.defaultTemplate === old)
            db.schema.defaultTemplate = t.name; save(); } });
    const close = dialog(h('div', { class: 'bwindow tpl-window' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px', flex: 1 } }, `Template “${t.name}” · ${db.schema.name}`), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, svgIcon(ICONS.close))), h('div', { class: 'dialog-body bwin tpl-body' }, wcard(null, wrow('Name', nameIn), wrow('Use by default', switchControl(db.schema.defaultTemplate === t.name, (on) => { if (on)
        db.schema.defaultTemplate = t.name;
    else
        delete db.schema.defaultTemplate; save(); }, 'Use by default'), 'New entries start from it')), wcard('Content', h('div', { class: 'set-row tpl-ed' }, editor.el))), h('div', { class: 'bfooter' }, h('button', { class: 'btn-new', onclick: () => close() }, 'Done'))), { wide: true, onClose: () => { const body = serializePage(blocks); if (body.trim())
            t.body = body;
        else
            delete t.body; save(); } });
    requestAnimationFrame(() => editor.focus?.(blocks[0].id, 'end'));
}
//# sourceMappingURL=viewpanel.js.map