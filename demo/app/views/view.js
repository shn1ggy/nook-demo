// A database view embedded in a page: tabs, period switcher, filter/sort/group tools,
// and the view itself (table, calendar, board, list, chart).
import { viewDrag } from './vieworder.js';
import { Database, resolveDate } from '../workspace.js';
import { query, periodRange, weeksOn, walkBlocks } from '../workspace.js';
import { serializePage } from '../format/page.js';
import { prettyKey } from '../ui/commands.js';
import { h, svgIcon, ICONS, fmtDay, parseDateInput, todayISO, ulid, keyHint, segmented } from '../util.js';
import { menu, prompt, toast, openPop, closePop, menuIcon } from '../ui/pop.js';
import { TYPE_LABEL, editValue } from './cells.js';
import { renderTable } from './table.js';
import { renderCalendar } from './calendar.js';
import { renderBoard } from './board.js';
import { renderList } from './list.js';
import { renderChart } from './chart.js';
import { renderGallery } from './gallery.js';
import { removePropFromView } from './propmenu.js';
import { renderDay } from './days.js';
import { renderTrends } from './trends.js';
import { openViewSettings, opsFor, VIEW_TYPES, describeRule } from './viewpanel.js';
import { iconSvg, renderIcon } from '../ui/icons.js';
import { visibleRows, pickUpload, fileInfoOnce, fileCrumb, viewDrop, newFileButton, renderFilePhone, addMenu } from './fileview.js';
const states = new Map();
const lastView = new Map();
function viewState(key) {
    let s = states.get(key);
    if (!s) {
        s = { offset: 0, search: '', searchOpen: false, limit: 100 };
        states.set(key, s);
    }
    return s;
}
export function renderViewBlock(ctx, b, savePage, fullPage = false) {
    const root = h('div', { class: 'dbview' + (fullPage ? ' dbview-full-page' : '') });
    // the load limit starts over each time the block is shown (loaded entries stay through redraws)
    const fresh = new Set();
    let curBar = null;
    let curEnv = null;
    pageDrop(root, ctx, () => curEnv);
    // typing in the view's search: the redraw makes a new field – it takes over focus and caret in the
    // same moment (no frame in between), so the phone's keyboard stays up and nothing below gets the taps
    const draw = () => {
        const act = document.activeElement;
        const typing = act instanceof HTMLInputElement && act.classList.contains('vsearch') && root.contains(act) ? { a: act.selectionStart, z: act.selectionEnd } : null;
        drawAll();
        if (!typing)
            return;
        const inp = root.querySelector('.vsearch');
        if (inp) {
            inp.focus({ preventScroll: true });
            try {
                inp.setSelectionRange(typing.a, typing.z);
            }
            catch { /* fine */ }
        }
    };
    const drawAll = () => {
        // keep keyboard focus (e.g. the calendar with a selected day) across the redraw
        const active = document.activeElement;
        const focusKey = active && root.contains(active) ? active.dataset.focusKey : undefined;
        if (focusKey)
            queueMicrotask(() => { if (document.activeElement && document.activeElement !== document.body)
                return; root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true }); });
        // the page doesn't move when the view is redrawn (a button in it, a shorter month): its scroll
        // position is kept, and the block keeps its height for a moment so nothing below jumps up
        const sc = root.isConnected ? root.closest('.scroll, .peek-body, .dialog-body') : null;
        const keepTopPx = sc?.scrollTop ?? 0;
        if (sc && keepTopPx) {
            root.style.minHeight = `${root.offsetHeight}px`;
            requestAnimationFrame(() => { if (sc.scrollTop !== keepTopPx)
                sc.scrollTop = keepTopPx; setTimeout(() => { root.style.minHeight = ''; }, 400); });
        }
        root.textContent = '';
        const db = b.db ? ctx.ws.dbs.get(b.db) : undefined;
        if (!db) {
            root.appendChild(h('div', { class: 'view-gone muted small' }, `This database was deleted (or isn't here yet). Restore it from the trash to show it again.`));
            return;
        }
        let tabs = db.views;
        const allow = b.tabs ? b.tabs.split(',').map((s) => s.trim()).filter((id) => db.views.some((v) => v.id === id)) : null;
        if (allow?.length)
            tabs = db.views.filter((v) => allow.includes(v.id));
        const view = tabs.find((v) => v.id === b.view) ?? tabs[0];
        if (!view)
            return;
        // filters / sorts / grouping left over from properties deleted earlier are cleaned up
        let cleaned = false;
        for (const v of db.views) {
            const gone = new Set();
            const walk = (rules) => rules.forEach((r) => ('rules' in r ? walk(r.rules) : !db.prop(r.prop) && gone.add(r.prop)));
            walk(v.filter?.rules ?? []);
            v.sorts?.forEach((x) => { if (!db.prop(x.prop))
                gone.add(x.prop); });
            if (v.groupBy && !db.prop(v.groupBy.prop))
                gone.add(v.groupBy.prop);
            for (const n of gone) {
                removePropFromView(v, n);
                cleaned = true;
            }
        }
        if (cleaned)
            ctx.ws.saveViews(db);
        const state = viewState(`${b.id}:${view.id}`);
        const was = lastView.get(b.id);
        if (was && was !== view.id)
            delete viewState(`${b.id}:${was}`).keep;
        lastView.set(b.id, view.id);
        if (view.limit && (!state.limitSet || !fresh.has(view.id))) {
            state.limit = view.limit;
            state.limitSet = true;
        }
        fresh.add(view.id);
        // "Open pages in": center peek (default) or full page
        const vctx = view.openIn === 'page' ? new Proxy(ctx, { get: (t, k) => (k === 'openRow' ? (d, r, o) => (o?.isNew ? t.openRow(d, r, o) : t.openRowPage(d, r)) : Reflect.get(t, k, t)) }) : ctx;
        // a database of files: a song opened here plays this view's entries next (its filter and sorting), whichever
        // other view of the same database was drawn last
        let shownRows = [];
        const fctx = db.schema.files ? new Proxy(vctx, { get: (t, k) => (k === 'openRow' ? (d, r, o) => { if (d === db)
                visibleRows.set(db.key, shownRows); return t.openRow(d, r, o); } : Reflect.get(t, k, t)) }) : vctx;
        const env = {
            ctx: fctx, db, view, state, selectionRoot: root, fullPage,
            redraw: draw,
            saveView: () => { ctx.ws.saveViews(db); },
            newRow: async (extra = {}, open = false, template) => {
                // a database of files: New uploads files
                if (db.schema.files) {
                    if (onPhone())
                        addMenu(ctx, db, root.querySelector('.vbar') ?? root);
                    else
                        pickUpload(ctx, db);
                    return;
                }
                const values = defaultsFor(db, view, state.offset);
                Object.assign(values, extra);
                if (db.dateLabel && !values[db.dateLabel])
                    values[db.dateLabel] = { start: todayISO() };
                ctx.ws.boundary();
                const row = await ctx.ws.addRow(db, values, template);
                (state.keep ??= new Set()).add(row.id);
                draw();
                if (!open)
                    return;
                if (view.newOpens !== 'stay' || onPhone()) {
                    ctx.openRow(db, row, { isNew: true });
                    return;
                }
                nameInPlace(root, ctx, db, row);
            },
            tabs: {
                // read live: the view panel stays open across redraws and must see the latest choice
                get shown() { const ids = b.tabs ? b.tabs.split(',').map((x) => x.trim()).filter((id) => db.views.some((v) => v.id === id)) : []; return ids.length ? ids : null; },
                set: (ids) => { if (ids && ids.length && ids.length < db.views.length)
                    b.tabs = ids.join(',');
                else
                    delete b.tabs; savePage(); draw(); },
                style: () => b.tabstyle ?? 'auto',
                setStyle: (st) => { if (st === 'auto')
                    delete b.tabstyle;
                else
                    b.tabstyle = st; savePage(); draw(); },
            },
        };
        env.openSettings = (at, page) => openViewSettings(env, at, selectTab, page);
        // showing a view (also a new or duplicated one) always makes it a tab of this block
        const selectTab = (id) => {
            const now = env.tabs.shown;
            if (now && !now.includes(id))
                b.tabs = [...now, id].join(',');
            b.view = id;
            savePage();
            draw();
        };
        env.addView = (at) => addViewMenu(env, at, selectTab);
        curEnv = env;
        // Explicit simplification is independent of the automatic narrow toolbar.
        if (curBar)
            fitObserver?.unobserve(curBar);
        curBar = null;
        let bar = null;
        // "Simplified" is always the compact bar (as the normal toolbar looks when narrow), without the view dropdown
        const simple = !fullPage && !!view.simplified;
        {
            // a phone always gets the compact toolbar (the full one would wrap over several lines)
            const phone = onPhone();
            const hideTabs = simple && !view.simpleTabs;
            const shownTabs = hideTabs ? [] : tabs;
            bar = h('div', { class: 'vbar' + (hideTabs ? ' no-tabs' : '') + (phone || simple || (!fullPage && lastCompact.get(b)) ? ' is-compact' : '') }, toolbar(env, shownTabs, selectTab), fullPage && !phone ? null : compactBar(env, shownTabs, selectTab, hideTabs));
            bar.__key = b;
            curBar = bar;
            env.narrow = () => !!bar?.classList.contains('is-compact');
            root.appendChild(bar);
            // simplified: always the compact bar, whatever the width
            if (!fullPage && !phone && !simple)
                fitObserver?.observe(bar);
        }
        root.oncontextmenu = (e) => {
            // Entry, cell and card context menus keep their own behavior.
            if (e.defaultPrevented || !(e.target instanceof Element) ||
                (e.target !== root && !e.target.closest('.simplified-edge')))
                return;
            e.preventDefault();
            e.stopPropagation();
            openViewSettings(env, { x: e.clientX, y: e.clientY }, selectTab);
        };
        if (db.schema.files) {
            fileInfoOnce(ctx, db);
            root.appendChild(fileCrumb(ctx, db));
            if (!root.dataset.fdb) {
                root.dataset.fdb = '1';
                viewDrop(ctx, db, root);
            }
        }
        const res = query(db, view, state.offset, state.search, state.keep);
        if (db.schema.files) {
            shownRows = res.groups ? res.groups.flatMap((g) => g.rows) : res.rows;
            visibleRows.set(db.key, shownRows);
        }
        switch (view.type) {
            case 'daylog':
            case 'table':
                root.appendChild(db.schema.files && onPhone() ? renderFilePhone(env, res.rows) : renderTable(env, res));
                break;
            case 'calendar':
                root.appendChild(renderCalendar(env));
                break;
            case 'board':
                root.appendChild(renderBoard(env, res));
                break;
            case 'list':
                root.appendChild(db.schema.files && onPhone() ? renderFilePhone(env, res.rows) : renderList(env, res));
                break;
            case 'chart':
                root.appendChild(renderChart(env, res));
                break;
            case 'gallery':
                root.appendChild(renderGallery(env, res));
                break;
            case 'day':
                root.appendChild(renderDay(env));
                break;
            case 'trends':
                root.appendChild(renderTrends(env));
                break;
        }
        // tabs and tools below the view (view settings → Toolbar)
        root.classList.toggle('bar-bottom', !fullPage && view.barAt === 'bottom');
        if (!fullPage && view.barAt === 'bottom' && bar)
            root.appendChild(bar);
        // simplified: a "New" row under the entries, if chosen
        if (!fullPage && view.simplified && view.newAt && view.newAt !== 'top' && ['list', 'gallery'].includes(view.type))
            root.appendChild(h('div', { class: 'simplified-edge simplified-bottom' }, newButton(env)));
        // Compact Month's toolbar belongs to the calendar column, not the taller detail list.
        const calendarPane = root.querySelector(':scope > .compact-month > .compact-month-layout > .compact-month-overview');
        if (calendarPane) {
            const controls = [...root.children].filter(el => el.matches('.vbar, .simplified-edge'));
            const bottom = !fullPage && view.barAt === 'bottom';
            calendarPane.classList.toggle('toolbar-bottom', bottom);
            if (bottom)
                controls.forEach(el => calendarPane.appendChild(el));
            else
                calendarPane.prepend(...controls);
        }
    };
    draw();
    // redraw on changes; stop listening once the block is gone (or was never shown)
    let seen = false;
    const born = Date.now();
    let refreshTimer;
    let pending = false;
    const alive = () => {
        if (!root.isConnected) {
            if (seen || Date.now() - born > 3000) {
                off();
                offWrite();
                if (refreshTimer)
                    clearTimeout(refreshTimer);
            }
            return false;
        }
        seen = true;
        return true;
    };
    const off = ctx.ws.onChange(() => { if (alive()) {
        pending = false;
        draw();
    } });
    // Most cell/property saves intentionally update only their originating control. Other copies
    // must also observe persisted changes, including schema, views, additions and deletions.
    // only database and workspace files matter here (relations and rollups can show other databases);
    // typing on the page around this block doesn't redraw it
    const offWrite = ctx.ws.onWrite((paths) => {
        if (!alive())
            return;
        if (paths && ![...paths].some((p) => p.startsWith('.workspace/') || (ctx.ws.whatIs(p)?.kind ?? 'page') !== 'page'))
            return;
        pending = true;
        if (refreshTimer)
            clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            if (!alive() || !pending)
                return;
            // Do not replace an active editor or disturb its caret. Its local save callback updates it;
            // refresh deferred changes when focus leaves this block.
            if (root.contains(document.activeElement))
                return;
            pending = false;
            draw();
        }, 0);
    });
    root.addEventListener('focusout', () => {
        if (!pending)
            return;
        setTimeout(() => { if (alive() && pending && !root.contains(document.activeElement)) {
            pending = false;
            draw();
        } }, 0);
    });
    return root;
}
/** One edge of the minimal toolbar. New-entry placement remains independent. */
/** Values a new row gets so it shows up in the view it was created from. */
function defaultsFor(db, view, offset) {
    const out = {};
    // a new entry gets what the view filters on, so it belongs to the view (only for "all of" rules)
    const rules = view.filter && (view.filter.mode !== 'or' || view.filter.rules.length === 1) ? view.filter.rules : [];
    for (const r of rules) {
        if ('rules' in r)
            continue;
        const def = db.prop(r.prop);
        if (!def)
            continue;
        const vals = (Array.isArray(r.value) ? r.value : r.value == null || r.value === '' ? [] : [r.value]).map(String);
        const pos = r.op === 'is' || r.op === 'in' || r.op === 'contains';
        if (r.op === 'checked')
            out[r.prop] = true;
        else if (!pos || !vals.length)
            continue;
        else if (def.type === 'select')
            out[r.prop] = vals[0];
        else if (def.type === 'multi_select')
            out[r.prop] = [...new Set([...(out[r.prop] ?? []), ...(r.op === 'in' ? vals.slice(0, 1) : vals)])];
        else if (def.type === 'text' || def.type === 'url' || def.type === 'email' || def.type === 'phone')
            out[r.prop] = vals[0];
        else if (def.type === 'number' && r.op === 'is' && Number.isFinite(Number(vals[0])))
            out[r.prop] = Number(vals[0]);
        else if (def.type === 'date' && r.op === 'is')
            out[r.prop] = { start: resolveDate(vals[0]) };
        else if (def.type === 'relation' && def.relation) {
            // filtered by a linked entry's name: link the new entry to it
            const target = Database.lookup(def.relation.db);
            const hit = target?.rows.find((x) => target.rowLabel(x) === vals[0]) ?? target?.rows.find((x) => target.rowLabel(x).toLowerCase().includes(vals[0].toLowerCase()));
            if (hit)
                out[r.prop] = [hit.id];
        }
    }
    if (view.period && view.period.unit !== 'all') {
        const range = periodRange(view.period, offset);
        const t = todayISO();
        out[view.period.prop] = { start: t >= range.start && t < range.end ? t : range.start };
    }
    return out;
}
function toolbar(env, tabs, selectTab) {
    const { view, state } = env;
    const left = h('div', { class: 'vtabs' });
    // view tabs first, so switching Month / Year / All never moves them
    if (tabs.length > 1 || !view.period) {
        for (const t of tabs) {
            // tab label: icon and name (default), only the icon, or only the name (set per view block)
            const style = env.tabs.style();
            const ico = t.icon ? renderIcon(t.icon, 14) : style === 'icon' || style === 'both' ? h('span', { class: 'ico' }, iconSvg(VIEW_TYPES.find((x) => x.type === t.type)?.icon ?? 'table', 14)) : null;
            const tab = h('button', { class: 'vtab' + (t.id === view.id ? ' on' : '') + (style === 'icon' ? ' icon-only' : ''), 'aria-label': t.name, onclick: () => { if (t.id !== view.id)
                    selectTab(t.id); } }, style !== 'name' ? ico : null, style !== 'icon' ? h('span', null, t.name) : null);
            // double-click a tab to rename the view
            tab.addEventListener('dblclick', (e) => {
                e.preventDefault();
                const input = h('input', { class: 'vtab-edit', value: t.name, 'aria-label': 'View name' });
                input.style.width = `${Math.max(60, tab.offsetWidth + 16)}px`;
                tab.replaceWith(input);
                input.focus();
                input.select();
                let done = false;
                const finish = (ok) => { if (done)
                    return; done = true; const v = input.value.trim(); if (ok && v && v !== t.name) {
                    t.name = v;
                    env.saveView();
                } env.redraw(); };
                input.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter')
                    finish(true);
                else if (ev.key === 'Escape')
                    finish(false); });
                input.addEventListener('blur', () => finish(true));
            });
            tab.title = `${style === 'icon' ? t.name + ' · ' : ''}Double-click to rename · drag to reorder · right-click for more`;
            viewDrag(tab, t.id, env.db, () => { env.saveView(); env.redraw(); }, 'x');
            // right-click: rename, and the view's settings (another tab: open it first)
            tab.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const at = { x: e.clientX, y: e.clientY };
                menu(at, [
                    { label: 'Rename', icon: menuIcon('pencil'), run: () => tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })) },
                    t.id === view.id
                        ? { label: 'View settings…', icon: menuIcon('settings'), run: () => openViewSettings(env, at, selectTab) }
                        : { label: 'Open', icon: menuIcon('arrow-right'), run: () => selectTab(t.id) },
                ], { title: t.name });
            });
            springTab(tab, env, () => selectTab(t.id), t.id === view.id);
            left.appendChild(tab);
        }
    }
    if (!env.view.simplified || env.fullPage)
        left.appendChild(h('button', { class: 'vtab', 'aria-label': 'Add view', title: 'Add view', onclick: (e) => addViewMenu(env, e.currentTarget, selectTab) }, svgIcon(ICONS.plus, 14)));
    if (view.period)
        left.appendChild(periodControls(env));
    const right = h('div', { class: 'vtools' });
    const nFilters = view.filter?.rules.length ?? 0;
    const tool = (icon, label, active, onclick, _badge) => h('button', { class: 'icon-btn' + (active ? ' on' : ''), 'aria-label': label, title: label, onclick }, svgIcon(icon, 16));
    // (no count badge: the icon is tinted while a filter or sort is active)
    const settings = (page) => (e) => openViewSettings(env, e.currentTarget, selectTab, page);
    right.append(tool(ICONS.filter, nFilters ? `Filter · ${view.filter.rules.map((r) => ('rules' in r ? 'group' : describeRule(r))).join(', ')}` : 'Filter', nFilters > 0, settings('filter'), nFilters), tool(ICONS.sort, view.sorts?.length ? `Sort · ${view.sorts.map((s) => s.prop).join(', ')}` : 'Sort', !!view.sorts?.length, settings('sort')));
    // grouping is in the ⋯ settings
    if (state.searchOpen)
        right.append(searchInput(env));
    else {
        right.append(tool(ICONS.search, 'Search', false, () => { state.searchOpen = true; env.redraw(); }));
    }
    // open the whole database on its own page (as in Notion); not shown on that page itself
    const onOwnPage = env.ctx.isDbPage?.(env.db.key);
    const full = tool(ICONS.expand, 'Open as full page', false, () => env.ctx.openDb(env.db.key));
    // on the database's own page it is not needed: left out, so no gap remains
    if (onOwnPage)
        full.style.display = 'none';
    right.append(full, h('button', { class: 'icon-btn', 'aria-label': 'View settings', title: 'View settings', onclick: settings() }, iconSvg('sliders', 16)), newEntryButton(env, (at) => openViewSettings(env, at, selectTab, 'templates')));
    return h('div', { class: 'vtoolbar full' }, dbTitle(env), left, right);
}
/** an entry dragged onto another view's tab: after a moment that view opens, so the entry can be dropped there (e.g. from a list onto a calendar day) */
function springTab(tab, env, open, current) {
    if (current)
        return;
    let timer;
    const off = () => { clearTimeout(timer); timer = undefined; tab.classList.remove('drop-spring'); };
    tab.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes(`text/x-nook-db-${env.db.key}`))
            return;
        e.preventDefault();
        if (timer)
            return;
        tab.classList.add('drop-spring');
        timer = setTimeout(() => { off(); open(); }, 450);
    });
    tab.addEventListener('dragleave', off);
    tab.addEventListener('drop', (e) => { e.preventDefault(); off(); open(); });
}
/** the search field of a view (in the full or the compact bar; the one that is shown gets the focus) */
/** tabs + stepper where they fit; the compact ‹ label › (as on the phone) when the bar would wrap */
function periodControls(env) {
    const pill = periodPill(env);
    pill.classList.add('pp-alt');
    const box = h('span', { class: 'period-switch' }, periodFull(env), pill);
    requestAnimationFrame(() => {
        const bar = box.closest('.vtoolbar, .simplified-edge') ?? box.parentElement;
        if (bar && periodObserver) {
            bar.__period = box;
            periodObserver.observe(bar);
            fitPeriod(bar);
        }
    });
    return box;
}
const lines = (el) => {
    // a child that starts below the others' middle has wrapped onto another line
    const kids = [...el.children].filter((c) => c.offsetParent);
    if (kids.length < 2)
        return 1;
    const firstBottom = Math.min(...kids.map((k) => k.offsetTop + k.offsetHeight));
    return kids.some((k) => k.offsetTop >= firstBottom - 2) ? 2 : 1;
};
function fitPeriod(bar) {
    const box = bar.__period;
    if (!box?.isConnected)
        return;
    // try the full one; it stays only when nothing wraps or overflows
    box.classList.remove('tight');
    const parent = box.parentElement;
    const wraps = bar.scrollWidth > bar.clientWidth + 1 || parent.scrollWidth > parent.clientWidth + 1 || lines(bar) > 1 || lines(parent) > 1;
    box.classList.toggle('tight', wraps);
}
const periodObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((es) => { for (const e of es)
    fitPeriod(e.target); });
function periodFull(env) {
    const { view, state } = env;
    const range = periodRange(view.period, state.offset);
    const step = (d) => { state.offset += d; env.redraw(); };
    const unitBtn = (u, label) => h('button', {
        class: 'vtab' + (view.period.unit === u ? ' on' : ''),
        onclick: () => { view.period.unit = u; state.offset = 0; env.saveView(); env.redraw(); },
    }, label);
    // unit switch, then the stepper – the stepper stays in place (disabled for "All") so nothing jumps
    return h('span', { class: 'period' }, h('span', { class: 'sep' }), weeksOn(view.period) ? unitBtn('week', 'Week') : null, unitBtn('month', 'Month'), unitBtn('year', 'Year'), unitBtn('all', 'All'), h('span', { class: 'sep' }), h('button', { class: 'icon-btn', 'aria-label': 'Previous period', title: `Previous${keyHint('period.prev')}`, disabled: !range, onclick: () => step(-1) }, svgIcon(ICONS.chevronL, 16)), h('button', { class: 'label', 'data-action': 'today', title: range ? `Back to the current period${keyHint('view.today')}` : '', disabled: !range, onclick: () => { state.offset = 0; env.redraw(); } }, range ? range.label : 'All time'), h('button', { class: 'icon-btn', 'aria-label': 'Next period', title: `Next${keyHint('period.next')}`, disabled: !range, onclick: () => step(1) }, svgIcon(ICONS.chevronR, 16)));
}
const UNIT_NAMES = { week: 'Week', month: 'Month', year: 'Year', all: 'All' };
/** narrow bars and phones: ‹ label › – the label opens a small panel with Week / Month / Year / All */
function periodPill(env) {
    const { view, state } = env;
    const range = periodRange(view.period, state.offset);
    const step = (d) => { state.offset += d; env.redraw(); };
    const label = h('button', { class: 'label pp-label', 'aria-haspopup': 'dialog', title: 'Choose the period', onclick: () => openPeriodPanel(env, label) }, h('span', { class: 'pp-text' }, range ? range.label : 'All time'), svgIcon(ICONS.chevron, 12));
    return h('span', { class: 'period vc-period period-pill' }, h('button', { class: 'icon-btn', 'aria-label': 'Previous period', disabled: !range, onclick: () => step(-1) }, svgIcon(ICONS.chevronL, 16)), label, h('button', { class: 'icon-btn', 'aria-label': 'Next period', disabled: !range, onclick: () => step(1) }, svgIcon(ICONS.chevronR, 16)));
}
function openPeriodPanel(env, anchor) {
    const { view, state } = env;
    const units = ['week', 'month', 'year', 'all'].filter((u) => u !== 'week' || weeksOn(view.period));
    const box = h('div', { class: 'period-panel' });
    const draw = () => {
        const range = periodRange(view.period, state.offset);
        const step = (d) => { state.offset += d; env.redraw(); draw(); };
        box.replaceChildren(segmented(units.map((u) => [u, UNIT_NAMES[u]]), view.period.unit, (u) => { view.period.unit = u; state.offset = 0; env.saveView(); env.redraw(); draw(); }, 'Period', 'wide pp-seg'), h('div', { class: 'pp-step' }, h('button', { class: 'icon-btn', 'aria-label': 'Previous period', disabled: !range, onclick: () => step(-1) }, svgIcon(ICONS.chevronL, 18)), h('strong', null, range ? range.label : 'All time'), h('button', { class: 'icon-btn', 'aria-label': 'Next period', disabled: !range, onclick: () => step(1) }, svgIcon(ICONS.chevronR, 18))), h('button', { class: 'set-btn pp-today', disabled: !range || state.offset === 0, onclick: () => { state.offset = 0; env.redraw(); closePop(); } }, view.period.unit === 'week' ? 'This week' : view.period.unit === 'year' ? 'This year' : 'This month'));
    };
    draw();
    openPop(anchor, box);
}
function searchInput(env) {
    const { state } = env;
    const inp = h('input', { class: 'vsearch', placeholder: 'Search…', value: state.search, 'aria-label': 'Search in this view' });
    inp.addEventListener('input', () => { state.search = inp.value; env.redraw(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Escape') {
        state.search = '';
        state.searchOpen = false;
        env.redraw();
    } });
    // opened: ready to type at once (on the phone, focusing while still in the tap brings up the keyboard)
    const go = () => { if (!inp.isConnected || document.activeElement === inp)
        return; inp.focus({ preventScroll: true }); try {
        inp.setSelectionRange(inp.value.length, inp.value.length);
    }
    catch { /* fine */ } };
    queueMicrotask(go);
    requestAnimationFrame(go);
    return inp;
}
const viewIcon = (t, size) => t.icon ? renderIcon(t.icon, size) : iconSvg(VIEW_TYPES.find((x) => x.type === t.type)?.icon ?? 'table', size);
/**
 * The toolbar when the view is narrow (a column, a phone): the view as a dropdown, one button for all
 * settings and one to add an entry – everything of the full toolbar is reachable from these.
 */
function compactBar(env, tabs, selectTab, noTabs = false) {
    const { view, state } = env;
    const open = (page) => (at) => openViewSettings(env, at, selectTab, page);
    const style = env.tabs.style();
    // the view as a dropdown, in the look of the tabs
    const sw = h('button', { class: 'vtab on vc-switch', 'aria-label': `View: ${view.name}`, onclick: () => menu(sw, [
            ...tabs.map((t) => ({ label: t.name, icon: h('span', { class: 'menu-ico' }, viewIcon(t, 16)), hint: t.id === view.id ? '✓' : undefined, run: () => { if (t.id !== view.id)
                    selectTab(t.id); } })),
            'sep',
            { label: 'Add view', icon: menuIcon('plus-circle'), run: () => addViewMenu(env, sw, selectTab) },
        ]) }, 
    // like the tabs: name (and own icon), icon and name, only the icon, or only the name
    view.icon || style === 'icon' || style === 'both' ? h('span', { class: 'ico' }, viewIcon(view, 14)) : null, style !== 'icon' ? h('span', { class: 'vc-name' }, view.name) : null, h('span', { class: 'vc-caret' }, svgIcon(ICONS.chevron, 12)));
    if (style === 'icon')
        sw.title = view.name;
    const bar = h('div', { class: 'vtoolbar compact' }, dbTitle(env, noTabs), noTabs ? null : h('div', { class: 'vtabs' }, sw));
    if (view.period) {
        bar.append(periodPill(env));
    }
    // on the phone the search field gets a full-width row of its own under the toolbar
    const phone = onPhone();
    if (state.searchOpen && !phone)
        bar.append(searchInput(env));
    else
        bar.append(h('span', { class: 'vc-gap' }));
    // highlighted only while a filter hides entries (sorting and grouping are the normal state)
    const active = view.filter?.rules.length ?? 0;
    // everything else is in the view settings (with search and "open as full page" while narrow)
    const opts = h('button', { class: 'icon-btn vc-opts', 'data-filtered': active ? '1' : undefined, 'aria-label': 'View settings', title: 'View settings', onclick: () => open()(opts) }, iconSvg('sliders', 16));
    // simplified, if chosen: search stays one click away, left of the view settings
    // – and a database opened on its own on the phone always has it (there is room, and search is always useful)
    const simple = !!view.simplified && !env.fullPage;
    if (((simple && view.simpleSearch) || (phone && env.fullPage)) && !state.searchOpen)
        bar.append(h('button', { class: 'icon-btn vc-search', 'aria-label': 'Search', title: 'Search', onclick: () => { state.searchOpen = true; env.redraw(); } }, svgIcon(ICONS.search, 16)));
    // simplified: the view settings icon only when chosen – else they open with a right-click or a long press on the toolbar
    if (!simple || view.simpleSettings !== false)
        bar.append(opts);
    else {
        bar.addEventListener('contextmenu', (e) => { e.preventDefault(); open()(bar); });
        let t = 0;
        bar.addEventListener('touchstart', () => { t = window.setTimeout(() => open()(bar), 550); }, { passive: true });
        for (const ev of ['touchend', 'touchmove', 'touchcancel'])
            bar.addEventListener(ev, () => clearTimeout(t), { passive: true });
    }
    if (state.searchOpen && phone)
        bar.append(h('div', { class: 'vc-srow' }, searchInput(env), h('button', { class: 'icon-btn', 'aria-label': 'Close search', onclick: () => { state.search = ''; state.searchOpen = false; env.redraw(); } }, svgIcon(ICONS.close, 16))));
    bar.append(h('button', { class: 'icon-btn vc-new', 'aria-label': 'New entry', title: 'New entry', onclick: () => env.newRow({}, true) }, svgIcon(ICONS.plus, 16)));
    return bar;
}
/** full or compact toolbar, whichever fits (measured after layout; the full one stays laid out, hidden, to measure it) */
const fitObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    for (const e of entries)
        fitBar(e.target, e.contentRect.width);
});
const lastCompact = new WeakMap();
const onPhone = () => document.documentElement.classList.contains('phone');
function fitBar(bar, width = bar.clientWidth) {
    const full = bar.querySelector(':scope > .vtoolbar.full');
    if (!full || !width)
        return;
    const need = [...full.children].reduce((n, c) => n + c.offsetWidth, 0) + 12;
    const compact = width < need;
    bar.classList.toggle('is-compact', compact);
    lastCompact.set(bar.__key ?? bar, compact);
}
function addViewMenu(env, anchor, selectTab) {
    menu(anchor, VIEW_TYPES.map((t) => ({
        label: t.label, icon: menuIcon(t.icon),
        run: () => {
            const v = newView(env.db, t.type);
            env.db.views.push(v);
            env.saveView();
            selectTab(v.id);
        },
    })));
}
export function newView(db, type) {
    const dateProp = db.schema.properties.find((p) => p.type === 'date')?.name;
    const selectProp = db.schema.properties.find((p) => p.type === 'select')?.name;
    const numProp = db.schema.properties.find((p) => p.type === 'number')?.name;
    const v = { id: ulid().slice(-8).toLowerCase(), name: VIEW_TYPES.find((t) => t.type === type).label, type, props: db.schema.properties.map((p) => p.name) };
    if (type === 'calendar') {
        v.dateProp = dateProp;
        v.colorBy = selectProp;
    }
    if (type === 'board' && selectProp)
        v.groupBy = { prop: selectProp, hideEmpty: false };
    if (type === 'gallery') {
        v.cardSize = 'm';
        v.cover = 'content';
    }
    if (type === 'chart' && selectProp)
        v.chart = { kind: 'donut', groupBy: selectProp, agg: numProp ? 'sum' : 'count', prop: numProp };
    return v;
}
/** filter conditions for one property (used by the filter menu and a column's "Filter…") */
export function filterOpsFor(env, p, anchor) {
    const { view } = env;
    view.filter ??= { mode: 'and', rules: [] };
    const g = view.filter;
    return opsFor(p).map((o) => ({
        label: o.label,
        run: () => {
            const add = (value) => { g.rules.push({ prop: p.name, op: o.op, value }); env.saveView(); env.redraw(); };
            if (!o.needs)
                return add();
            if (p.type === 'select' || p.type === 'multi_select') {
                menu(anchor, (p.options ?? []).map((opt) => ({ label: opt.name, run: () => add(opt.name) })), { filter: true });
            }
            else if (p.type === 'date' || p.type === 'created_time' || p.type === 'last_edited_time') {
                menu(anchor, [
                    { label: 'Today', run: () => add('today') }, { label: 'Yesterday', run: () => add('yesterday') },
                    { label: 'In 7 days', run: () => add('+7d') }, { label: 'In 30 days', run: () => add('+30d') }, { label: '30 days ago', run: () => add('-30d') },
                    { label: 'Exact date…', run: () => prompt(anchor, 'Date', fmtDay(todayISO()), (v) => { const d = parseDateInput(v); if (d)
                            add(d);
                        else
                            toast('Could not read that date'); }) },
                ]);
            }
            else {
                prompt(anchor, `${p.name} ${o.label}`, '', (v) => add(p.type === 'number' || p.type === 'formula' ? Number(v.replace(',', '.')) : v));
            }
        },
    }));
}
export { TYPE_LABEL, describeRule };
/** "Load 5 more · Load all 495" under a list or gallery (the load limit stays for next time) */
export function loadMoreBar(env, total, shown) {
    const step = env.view.limit || 100;
    const left = total - shown;
    return h('div', { class: 'loadmore-bar' }, h('button', { class: 'loadmore', onclick: () => { env.state.limit = shown + step; env.redraw(); } }, `Load ${Math.min(step, left)} more`), left > step ? h('button', { class: 'loadmore', title: 'Show every entry now (the load limit stays for next time)', onclick: () => { env.state.limit = total; env.redraw(); } }, `Load all ${left}`) : null);
}
/** the "+ New" button of lists */
export function newButton(env) {
    return h('button', { class: 'loadmore list-new', onclick: () => env.newRow(undefined, true) }, '+ New');
}
/** "+ New" that stays in the view: type the name right where the entry appeared */
function nameInPlace(root, ctx, db, row) {
    requestAnimationFrame(() => {
        const id = CSS.escape(row.id);
        if (db.dateLabel) {
            const cell = root.querySelector(`tr[data-row="${id}"] td[data-prop="${CSS.escape(db.dateLabel)}"]`) ?? root;
            cell.scrollIntoView({ block: 'nearest' });
            editValue(ctx.ws, db, row, db.dateLabel, cell, () => ctx.ws.emit());
            return;
        }
        const td = root.querySelector(`tr[data-row="${id}"] td.title`);
        if (td) {
            td.scrollIntoView({ block: 'nearest' });
            td.click();
            return;
        } // tables: edit the name cell
        const el = root.querySelector(`[data-row="${id}"], [data-row^="${id}:"]`) ?? root;
        el.scrollIntoView({ block: 'nearest' });
        prompt(el, 'Name', '', (v) => {
            const name = v.trim();
            if (!name)
                return;
            row.values[db.titleProp] = name;
            ctx.ws.saveRow(db, row).then(() => ctx.ws.emit());
        });
    });
}
/** the blue "New" button with a ▾ that lists the templates and lets you make or edit them (as in Notion) */
function newEntryButton(env, editTemplates) {
    if (env.db.schema.files)
        return newFileButton(env.ctx, env.db);
    // a day log: New asks which of its databases
    const tpls = env.db.schema.templates ?? [];
    const main = h('button', { class: 'btn-new', title: env.db.schema.defaultTemplate ? `New entry from “${env.db.schema.defaultTemplate}”` : 'New entry', onclick: () => env.newRow({}, true) }, 'New');
    const more = h('button', { class: 'btn-new btn-new-more', 'aria-label': 'Templates', title: 'Templates', onclick: (e) => menu(e.currentTarget, tpls.length ? [
            { section: 'New entry from' },
            ...tpls.map((t) => ({ label: t.name, hint: t.name === env.db.schema.defaultTemplate ? 'default' : '', run: () => env.newRow({}, true, t.name) })),
            { label: 'Empty entry', run: () => env.newRow({}, true, '') },
            'sep',
            { label: 'Edit templates…', run: () => editTemplates(more) },
        ] : [
            { label: 'New entry', run: () => env.newRow({}, true) },
            'sep',
            { label: 'New template…', run: () => editTemplates(more) },
        ]) }, svgIcon(ICONS.chevron, 12));
    return h('span', { class: 'btn-new-split' }, main, more);
}
/**
 * A page dragged from the sidebar onto a database view becomes an entry of that database (as in Notion):
 * its title, icon and content move into the new entry, the page goes to the trash (⌘Z brings it back).
 * Dropped on a calendar day, on a board column or into a group, the entry gets that day or option.
 */
function pageDrop(root, ctx, getEnv) {
    const isPage = (e) => !!e.dataTransfer?.types.includes('text/x-nook-page');
    let hot = null;
    const mark = (el) => { if (hot !== el) {
        hot?.classList.remove('page-drop-hot');
        hot = el;
        hot?.classList.add('page-drop-hot');
    } };
    const spot = (e) => e.target?.closest?.('[data-day], .bcol[data-key]') ?? null;
    root.addEventListener('dragover', (e) => {
        if (!isPage(e) || !getEnv())
            return;
        // over the view, the page goes into the database (not between the blocks of the page)
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.drop-before, .drop-after, .drop-line').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-line'));
        root.classList.add('page-drop');
        mark(spot(e));
    }, true);
    root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) {
        root.classList.remove('page-drop');
        mark(null);
    } });
    root.addEventListener('drop', async (e) => {
        if (!isPage(e))
            return;
        const env = getEnv();
        const target = spot(e);
        root.classList.remove('page-drop');
        mark(null);
        const id = e.dataTransfer.getData('text/x-nook-page');
        const ws = ctx.ws, p = ws.pages.get(id);
        if (!env || !p)
            return;
        e.preventDefault();
        e.stopPropagation();
        const { db, view } = env;
        // a page that holds this very view can't go into it
        let holds = false;
        walkBlocks(p.blocks, (x) => { if (x.type === 'view' && x.db === db.key)
            holds = true; });
        if (holds) {
            toast('This page shows this database – it can’t become one of its entries');
            return;
        }
        const values = defaultsFor(db, view, env.state.offset);
        values[db.titleProp] = p.title || 'Untitled';
        const day = target?.getAttribute('data-day');
        const dateProp = db.dateLabel ?? (view.type === 'calendar' ? view.dateProp ?? db.schema.properties.find((x) => x.type === 'date')?.name : undefined);
        if (day && dateProp)
            values[dateProp] = { start: day };
        const key = target?.getAttribute('data-key');
        const gprop = view.groupBy?.prop ?? (view.type === 'board' ? db.schema.properties.find((x) => x.type === 'select')?.name : undefined);
        if (key != null && gprop) {
            const def = db.prop(gprop);
            values[gprop] = key === '' ? null : def?.type === 'multi_select' ? [key] : key;
        }
        ws.boundary();
        const row = await ws.addRow(db, values, '');
        if (p.icon)
            row.icon = p.icon;
        row.body = serializePage(p.blocks);
        await ws.saveRow(db, row);
        // its subpages stay with it
        for (const c of [...ws.pages.values()])
            if (c.parent === p.id) {
                c.parent = `row:${db.key}:${row.id}`;
                await ws.savePage(c);
            }
        await ws.unlinkSubpage(p.parent, p.id);
        // dragged out of a page's content: its block goes away there too
        const from = e.dataTransfer.getData('text/x-nook-from');
        if (from && from !== p.parent)
            await ws.unlinkSubpage(from, p.id);
        ws.holdSubpages.add(p.id);
        await ws.deletePage(p);
        ws.holdSubpages.delete(p.id);
        ctx.refresh();
        toast(`“${p.title || 'Untitled'}” is now an entry in ${db.schema.name} · ${prettyKey('Mod+Z')} to undo`);
    }, true);
}
/** Layout → "Show database title": the database's icon and name at the start of the toolbar
 *  (a thin divider before the tabs). Not on the database's own page, which has its title already. */
function dbTitle(env, noDivider = false) {
    if (!env.view.showTitle || env.fullPage)
        return null;
    const db = env.db;
    const el = h('button', { class: 'vdb-title' + (noDivider ? ' no-sep' : ''), title: `Open ${db.schema.name}`, onclick: () => env.ctx.openDb(db.key) }, renderIcon(db.schema.icon, 15, 'database'), h('span', { class: 'vdb-name' }, db.schema.name));
    env.ctx.linkTo(el, `db:${db.key}`);
    return el;
}
//# sourceMappingURL=view.js.map