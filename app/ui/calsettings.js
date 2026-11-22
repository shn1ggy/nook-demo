import { iconSvg } from './icons.js';
import { wcard, wrow } from './win.js';
// Settings → Calendars: calendar links (.ics) that Nook shows read-only between your entries.
// The list is saved in the workspace.
import { h, svgIcon, ICONS, fmtDate, segmented } from '../util.js';
import { dialog, menu, toast } from './pop.js';
import { selectControl } from './settings.js';
import { calendars, calendarViews, subShownIn } from '../sync/service.js';
import { saveConfig } from '../sync/calsync.js';
import { netMode } from '../sync/net.js';
import { HOLIDAY_SETS, HOLIDAY_URL } from '../sync/holidays.js';
const id = () => Math.random().toString(36).slice(2, 10);
const SUB_COLORS = ['#5e87c9', '#529e72', '#d15796', '#c77d48', '#9d68d3', '#ca9849', '#df5452', '#8a8a8a'];
function input(value, placeholder = '', type = 'text') {
    const el = h('input', { type, class: 'set-input', value, placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    el.addEventListener('keydown', (e) => { if (e.key !== 'Escape')
        e.stopPropagation(); });
    return el;
}
/** phone, editing: the row's other actions at the end of the form (Refresh, Remove …) */
export function phoneActions(body, entries) {
    if (!document.documentElement.classList.contains('phone') || !entries.length)
        return;
    body.append(wcard(null, ...entries.map((e) => h('button', { class: 'set-row set-act' + (e.danger ? ' danger' : ''), onclick: e.run }, e.label))));
}
function formDialog(title, body, actions) {
    const box = h('div', { class: 'bwindow cal-form' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px' } }, title)), h('div', { class: 'dialog-body' }, body), h('div', { class: 'bfooter' }, ...actions));
    return dialog(box);
}
const ago = (iso) => {
    if (!iso)
        return 'never';
    // Nook's timestamps are UTC without a zone mark
    const s = Math.max(0, Math.round((Date.now() - new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime()) / 1000));
    return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : fmtDate({ start: iso.slice(0, 10) });
};
export function calendarSection(ws, redraw) {
    const cfg = () => calendars.cfg;
    const persist = async () => { await saveConfig(ws(), cfg()); await calendars.reconfigure(); redraw(); };
    const fail = (el, msg) => { el.textContent = msg; el.style.color = 'var(--danger)'; };
    /** "Show in": one dropdown per view, "+" for another */
    const viewPicker = (picks) => {
        const views = calendarViews(ws());
        if (!picks.length && views.length)
            picks.push(views[0].key);
        const box = h('div', { class: 'showin-picks' });
        const draw = () => {
            box.textContent = '';
            if (!views.length) {
                box.appendChild(h('div', { class: 'bfield-hint' }, 'No database has a calendar or list view yet. Add one, then choose it here.'));
                return;
            }
            picks.forEach((k, i) => {
                const opts = views.filter((v) => v.key === k || !picks.includes(v.key)).map((v) => [v.key, v.label]);
                box.appendChild(h('div', { class: 'showin-row' }, selectControl(opts, k, (v) => { picks[i] = v; draw(); }, 'View'), picks.length > 1 ? h('button', { class: 'icon-btn', 'aria-label': 'Remove', title: 'Remove', onclick: (e) => { e.preventDefault(); picks.splice(i, 1); draw(); } }, svgIcon(ICONS.close, 13)) : null));
            });
            const free = views.filter((v) => !picks.includes(v.key));
            if (free.length)
                box.appendChild(h('button', { class: 'set-btn with-icon showin-add', onclick: (e) => { e.preventDefault(); picks.push(free[0].key); draw(); } }, svgIcon(ICONS.plus, 13), h('span', null, 'Show in another view')));
        };
        draw();
        return { el: box, has: views.length > 0 };
    };
    const colorPicker = (get, set) => {
        const row = h('div', { class: 'accent-row' });
        const draw = () => { row.textContent = ''; for (const c of SUB_COLORS)
            row.appendChild(h('button', { class: 'accent-swatch' + (c === get() ? ' on' : ''), style: { background: c }, 'aria-label': `Color ${c}`, onclick: (e) => { e.preventDefault(); set(c); draw(); } })); };
        draw();
        return row;
    };
    // ----- a calendar link (.ics) -----
    /** the actions of a calendar besides editing: on the phone they sit at the end of its form */
    const extras = (sub, close) => !sub ? [] : [
        ...(sub.url === HOLIDAY_URL || sub.url === 'nook:db' ? [] : [{ label: 'Refresh now', run: () => { close(); void calendars.refreshSub(sub); } }]),
        { label: 'Remove calendar', danger: true, run: async () => { cfg().subscriptions = cfg().subscriptions.filter((x) => x !== sub); close(); await persist(); } },
    ];
    const subForm = (sub) => {
        const name = input(sub?.name ?? '', 'e.g. Work (Outlook)');
        const url = input(sub?.url ?? '', 'https://…/calendar.ics');
        let color = sub?.color ?? SUB_COLORS[cfg().subscriptions.length % SUB_COLORS.length];
        const picks = sub ? calendarViews(ws()).map((v) => v.key).filter((k) => subShownIn(sub, k)) : [];
        const showIn = viewPicker(picks);
        const status = h('div', { class: 'bfield-hint' });
        const save = h('button', { class: 'btn-new' }, sub ? 'Save' : 'Add calendar');
        const body = h('div', { class: 'bwin' }, wcard(null, wrow('Name', name), wrow('Link', url, 'iCloud: public calendar link · Google: “Secret address in iCal format” · Outlook: Publish a calendar → ICS', 'stack')), wcard('Color', h('div', { class: 'set-row' }, colorPicker(() => color, (c) => { color = c; }))), wcard('Show in', h('div', { class: 'set-row set-wide-row' }, showIn.el)), status);
        const close = formDialog(sub ? 'Edit calendar' : 'New calendar', body, [h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), save]);
        phoneActions(body, extras(sub, close));
        save.addEventListener('click', async () => {
            const s = { ...(sub ?? {}), id: sub?.id ?? id(), name: name.value.trim() || 'Calendar', url: url.value.trim(), color, showIn: [...new Set(picks)] };
            delete s.hiddenIn;
            if (!/^(https|webcal):\/\//i.test(s.url))
                return fail(status, 'Paste the calendar’s link (starting with https:// or webcal://).');
            if (showIn.has && !picks.length)
                return fail(status, 'Choose at least one view to show it in.');
            save.disabled = true;
            status.textContent = 'Loading…';
            status.style.color = '';
            if (sub)
                Object.assign(sub, s);
            else
                cfg().subscriptions.push(s);
            if (sub)
                delete sub.hiddenIn;
            await persist();
            const added = cfg().subscriptions.find((x) => x.id === s.id);
            await calendars.refreshSub(added);
            // a first answer can fail while the server still sets the link up: one more try before an error shows
            if (calendars.subs.get(s.id)?.error) {
                await new Promise((r) => setTimeout(r, 1500));
                await calendars.refreshSub(added);
            }
            const st = calendars.subs.get(s.id);
            if (st?.error) {
                fail(status, st.error);
                save.disabled = false;
                return;
            }
            toast(`${s.name}: ${st?.events.length ?? 0} events`);
            close();
        });
    };
    // ----- public holidays, worked out locally -----
    const holidayForm = (sub) => {
        const first = HOLIDAY_SETS[0];
        let setId = sub ? (HOLIDAY_SETS.find((x) => x.rules === sub.rules)?.id ?? 'custom') : first.id;
        const name = input(sub?.name ?? first.name, 'e.g. Feiertage NRW');
        const rules = h('textarea', { class: 'set-input hol-rules', rows: 8, spellcheck: 'false' });
        rules.value = sub?.rules ?? first.rules;
        rules.addEventListener('keydown', (e) => e.stopPropagation());
        let color = sub?.color ?? SUB_COLORS[(cfg().subscriptions.length + 4) % SUB_COLORS.length];
        const picks = sub ? calendarViews(ws()).map((v) => v.key).filter((k) => subShownIn(sub, k)) : [];
        const showIn = viewPicker(picks);
        const status = h('div', { class: 'bfield-hint' });
        const choose = selectControl(HOLIDAY_SETS.map((x) => [x.id, x.name]), setId, (v) => {
            const prev = HOLIDAY_SETS.find((x) => x.id === setId);
            setId = v;
            const set = HOLIDAY_SETS.find((x) => x.id === v);
            if (!name.value.trim() || name.value === prev?.name)
                name.value = set.id === 'custom' ? 'Holidays' : set.name;
            rules.value = set.rules;
        }, 'Country');
        const save = h('button', { class: 'btn-new' }, sub ? 'Save' : 'Add holidays');
        const body = h('div', { class: 'bwin' }, wcard(null, wrow('Country or region', choose, null, 'stack'), wrow('Name', name, null, 'stack')), wcard('Days', h('div', { class: 'set-row set-wide-row stack' }, rules), h('div', { class: 'bfield-hint hol-hint' }, 'One per line: date and name. 12-24 = a fixed date · easter+1 = days after Easter · 11-thu4 = 4th Thursday of November · 05-mon-1 = last Monday of May. Edit or add your own.')), wcard('Color', h('div', { class: 'set-row' }, colorPicker(() => color, (c) => { color = c; }))), wcard('Show in', h('div', { class: 'set-row set-wide-row' }, showIn.el)), status);
        const close = formDialog(sub ? 'Edit holidays' : 'Public holidays', body, [h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), save]);
        phoneActions(body, extras(sub, close));
        save.addEventListener('click', async () => {
            if (showIn.has && !picks.length)
                return fail(status, 'Choose at least one view to show it in.');
            const s = { ...(sub ?? {}), id: sub?.id ?? id(), name: name.value.trim() || 'Holidays', url: HOLIDAY_URL, rules: rules.value, color, showIn: [...new Set(picks)] };
            if (sub)
                Object.assign(sub, s);
            else
                cfg().subscriptions.push(s);
            await persist();
            await calendars.refreshSub(cfg().subscriptions.find((x) => x.id === s.id));
            toast(`${s.name}: ${calendars.subs.get(s.id)?.events.length ?? 0} days (±5 years)`);
            close();
        });
    };
    // ----- a database as a calendar (birthdays from contacts …): read live, every year when chosen -----
    const dbForm = (sub) => {
        const dbs = [...ws().dbs.values()].filter((d) => d.schema.properties.some((p) => p.type === 'date')).sort((a, b) => a.schema.name.localeCompare(b.schema.name));
        if (!dbs.length) {
            toast('No database has a date property yet');
            return;
        }
        let dbKey = sub?.db && ws().dbs.get(sub.db) ? sub.db : dbs[0].key;
        const dateProps = () => ws().dbs.get(dbKey).schema.properties.filter((p) => p.type === 'date').map((p) => [p.name, p.name]);
        const guess = () => (dateProps().find(([n]) => /birth|geburt/i.test(n)) ?? dateProps()[0])[0];
        let prop = sub?.prop ?? guess();
        let yearly = sub?.yearly ?? /birth|geburt|anniv|jahrestag/i.test(prop);
        const name = input(sub?.name ?? (yearly ? 'Birthdays' : ws().dbs.get(dbKey).schema.name), 'e.g. Birthdays');
        let color = sub?.color ?? SUB_COLORS[(cfg().subscriptions.length + 2) % SUB_COLORS.length];
        const picks = sub ? calendarViews(ws()).map((v) => v.key).filter((k) => subShownIn(sub, k)) : [];
        const showIn = viewPicker(picks);
        const status = h('div', { class: 'bfield-hint' });
        const propBox = h('div');
        const drawProp = () => propBox.replaceChildren(selectControl(dateProps(), prop, (v) => { prop = v; }, 'Date'));
        drawProp();
        const pickDb = selectControl(dbs.map((d) => [d.key, d.schema.name]), dbKey, (v) => { dbKey = v; prop = guess(); drawProp(); }, 'Database');
        let icon = sub?.icon ?? (/birth|geburt/i.test(prop) ? 'cake' : '');
        let label = sub?.label ?? 'age';
        const labelRow = wrow('After the name', segmented([['name', 'Nothing'], ['age', 'Age'], ['year', 'Year born']], label, (v) => { label = v; }, 'After the name'), null, 'stack');
        const repeat = segmented([['yearly', 'Every year'], ['once', 'Once']], yearly ? 'yearly' : 'once', (v) => { yearly = v === 'yearly'; labelRow.hidden = !yearly; }, 'Repeat');
        labelRow.hidden = !yearly;
        // the icon before each entry: none (a dot, like other calendars) or one of a few
        const ICON_CHOICES = ['', 'cake', 'gift', 'heart', 'star', 'user'];
        const iconRow = h('div', { class: 'ico-choices', role: 'radiogroup', 'aria-label': 'Icon' });
        const drawIcons = () => iconRow.replaceChildren(...ICON_CHOICES.map((n) => h('button', { class: 'ico-choice' + (n === icon ? ' on' : ''), role: 'radio', 'aria-checked': String(n === icon), title: n || 'Dot', onclick: (e) => { e.preventDefault(); icon = n; drawIcons(); } }, n ? iconSvg(n, 16) : h('span', { class: 'ico-dot', style: { background: color } }))));
        drawIcons();
        const save = h('button', { class: 'btn-new' }, sub ? 'Save' : 'Add calendar');
        const body = h('div', { class: 'bwin' }, wcard(null, wrow('Database', pickDb), wrow('Date', propBox), wrow('Repeat', repeat), wrow('Name', name)), wcard('Entries', wrow('Icon', iconRow, null, 'stack'), labelRow), wcard('Color', h('div', { class: 'set-row' }, colorPicker(() => color, (c) => { color = c; drawIcons(); }))), wcard('Show in', h('div', { class: 'set-row set-wide-row' }, showIn.el)), status);
        const close = formDialog('Database calendar', body, [h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), save]);
        phoneActions(body, extras(sub, close));
        save.addEventListener('click', async () => {
            if (showIn.has && !picks.length)
                return fail(status, 'Choose at least one view to show it in.');
            const s = { ...(sub ?? {}), id: sub?.id ?? id(), name: name.value.trim() || 'Birthdays', url: 'nook:db', db: dbKey, prop, yearly, icon: icon || undefined, label, color, showIn: [...new Set(picks)] };
            if (sub)
                Object.assign(sub, s);
            else
                cfg().subscriptions.push(s);
            await persist();
            close();
        });
    };
    const items = () => {
        const c = cfg();
        const out = [];
        const more = (entries) => h('button', { class: 'icon-btn set-more', title: 'More', 'aria-label': 'More', onclick: (e) => menu(e.currentTarget, entries) }, svgIcon(ICONS.more, 14, { fill: true }));
        const status = (txt, kind) => h('span', { class: `cal-status ${kind}` }, h('i'), txt);
        const swatchTitle = (color, text) => h('span', { class: 'set-title-swatch' }, h('span', { class: 'sub-swatch', style: { background: color } }), text);
        const mode = netMode();
        out.push({ heading: 'Calendars' });
        for (const s of c.subscriptions) {
            const st = calendars.subs.get(s.id);
            const live = s.url === 'nook:db';
            const st2 = live ? status(`${ws().dbs.get(s.db ?? '')?.schema.name ?? 'Database gone'} · ${s.prop ?? ''}${s.yearly ? ' · every year' : ''}`, ws().dbs.get(s.db ?? '') ? 'ok' : 'err') : st?.running ? status('Loading…', 'busy') : st?.error ? status(st.error, 'err') : st?.fetched ? status(`${st.events.length} events · updated ${ago(st.fetched)}`, 'ok') : status('Not loaded yet', 'off');
            const where = calendarViews(ws()).filter((v) => subShownIn(s, v.key)).map((v) => v.label);
            out.push({
                title: swatchTitle(s.color, s.name), open: () => (s.url === HOLIDAY_URL ? holidayForm(s) : live ? dbForm(s) : subForm(s)),
                desc: h('span', { class: 'set-lines' }, h('span', { class: 'cal-meta' }, `Shown in ${where.length ? where.join(', ') : 'no view yet – Edit to choose'}`), st2), keywords: `calendar ics exchange outlook google icloud ${s.name}`,
                control: h('div', { class: 'set-actions' }, s.url === HOLIDAY_URL || live ? null : h('button', { class: 'set-btn', disabled: !!st?.running, onclick: () => calendars.refreshSub(s) }, 'Refresh'), more([
                    { label: 'Edit…', run: () => (s.url === HOLIDAY_URL ? holidayForm(s) : live ? dbForm(s) : subForm(s)) },
                    'sep',
                    { label: 'Remove', danger: true, run: async () => { c.subscriptions = c.subscriptions.filter((x) => x !== s); await persist(); } },
                ])),
            });
        }
        if (!c.subscriptions.length)
            out.push({ title: 'No calendars yet', desc: 'A link (.ics) from iCloud, Google, Outlook …' });
        out.push({ action: 'Add a calendar link (.ics)…', run: () => subForm(), keywords: 'ics webcal exchange outlook google icloud subscription' });
        out.push({ action: 'Add public holidays…', run: () => holidayForm(), keywords: 'holidays feiertage public bank holiday country' });
        out.push({ action: 'Add a database (birthdays …)…', run: () => dbForm(), keywords: 'birthdays contacts geburtstage database anniversary' });
        out.push({ heading: 'Fetching' });
        out.push(mode === 'server'
            ? { title: 'Fetched by', desc: 'Nook’s local server on this computer', value: 'This computer', keywords: 'connection' }
            : mode === 'dropbox'
                ? { title: 'Fetched by', desc: 'Nothing to set up', value: 'Dropbox', keywords: 'connection dropbox' }
                : { title: 'Fetched by', desc: 'Most calendars refuse this – open Nook from Dropbox or its start file', value: 'This website', keywords: 'connection cors' });
        return out;
    };
    return { id: 'calendars', group: 'Content', label: 'Calendars', icon: 'calendar-days', summary: () => { const n = cfg().subscriptions.length; return n ? String(n) : ''; }, subtitle: 'Other calendars shown between your entries, read-only.', items };
}
//# sourceMappingURL=calsettings.js.map