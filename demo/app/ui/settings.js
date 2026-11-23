// The settings window (as in Notion): sections in a sidebar with a search field, each setting a
// row with its name and description on the left and the control on the right. New settings are
// just new items in a section, so the window grows with the app.
import { h, svgIcon, ICONS } from '../util.js';
import { iconSvg } from './icons.js';
import { dialog, menu, menuIcon } from './pop.js';
// the coloured tile of each settings page in the phone's list (as on iOS)
// one hue per page, all about equally bright, so no two neighbours look alike and none is grey
const TILE = { general: '#4b78c8', notifications: '#e5534b', behaviour: '#3d8fe6', appearance: '#8a63d2', colors: '#d4558c', dates: '#e48a2f',
    widgets: '#3aa577', shortcuts: '#5b5fc7', 'custom-shortcuts': '#e0a930', import: '#4b78c8', export: '#4f9a6b', files: '#7d8590', switchws: '#8a63d2',
    calendars: '#e0a930', sources: '#2fa3b5', about: '#4b78c8' };
// a page without its own colour still gets one (never a grey square by accident)
const TILE_FALLBACK = ['#3d8fe6', '#529e72', '#9d68d3', '#e97d2f', '#d15796', '#3fa5a0', '#e9b949'];
const tileColor = (id) => TILE[id] ?? TILE_FALLBACK[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % TILE_FALLBACK.length];
function rowEl(it) {
    if ('heading' in it)
        return h('div', { class: 'set-heading' }, h('h3', null, it.heading), it.control ? h('span', { class: 'set-heading-ctl' }, it.control) : null);
    if ('action' in it) {
        const b = h('button', { class: 'set-add', onclick: () => it.run(b) }, h('span', { class: 'set-add-ico' }, svgIcon(ICONS.plus, 13)), h('span', null, it.action));
        return b;
    }
    const icon = it.icon ? h('span', { class: 'set-ico' }, typeof it.icon === 'string' ? iconSvg(it.icon, 16) : it.icon) : null;
    const tap = !!it.open && document.documentElement.classList.contains('phone');
    return h('div', { class: 'set-row' + (it.wide ? ' wide' : '') + (tap ? ' tap' : ''), onclick: tap ? (e) => { if (!e.target.closest('button, input, a'))
            it.open(); } : undefined }, icon, h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, it.title), it.desc ? h('div', { class: 'set-desc' }, it.desc) : null), it.value ? h('span', { class: 'set-value' }, it.value) : null, it.control ? h('div', { class: 'set-control' }, it.control) : null, it.wide ? h('div', { class: 'set-wide' }, it.wide) : null, tap ? h('span', { class: 'set-chev' }, svgIcon(ICONS.chevronR, 13)) : null);
}
/** every group is a card under its heading; rows before the first heading get a card of their own */
function cards(into, items) {
    let card = null;
    for (const it of items) {
        if ('heading' in it) {
            const sec = h('section', { class: 'set-sec' }, rowEl(it));
            card = h('div', { class: 'set-card' });
            sec.append(card);
            into.append(sec);
            continue;
        }
        if (!card) {
            card = h('div', { class: 'set-card' });
            into.append(h('section', { class: 'set-sec' }, card));
        }
        card.append(rowEl(it));
    }
}
export function openSettingsWindow(sections, start) {
    if (document.documentElement.classList.contains('phone'))
        return phoneSettings(sections, start);
    let current = sections.find((s) => s.id === start) ?? sections[0];
    let query = '';
    const list = h('div', { class: 'set-nav-list' });
    const main = h('div', { class: 'set-main' });
    // the search field stays in place while the list below it is redrawn, so typing keeps focus
    const search = h('input', { class: 'set-search', placeholder: 'Search settings', 'aria-label': 'Search settings' });
    const clear = h('button', { class: 'set-search-clear', 'aria-label': 'Clear search', title: 'Clear search (Esc)', tabindex: '-1', hidden: true }, svgIcon(ICONS.close, 12));
    const setQuery = (v) => { search.value = v; query = v.trim().toLowerCase(); clear.hidden = !v; draw(); };
    search.addEventListener('input', () => setQuery(search.value));
    // Esc clears the search first; with an empty field it closes the window as usual
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) {
        e.preventDefault();
        e.stopPropagation();
        setQuery('');
    } });
    clear.addEventListener('mousedown', (e) => e.preventDefault());
    clear.addEventListener('click', () => { setQuery(''); search.focus(); });
    const nav = h('nav', { class: 'set-nav', 'aria-label': 'Settings sections' }, h('div', { class: 'set-search-wrap' }, svgIcon(ICONS.search, 14), search, clear), list);
    const text = (x) => (x instanceof Node ? x.textContent ?? '' : String(x ?? ''));
    const matches = (it) => !query || ('title' in it ? `${text(it.title)} ${text(it.desc)} ${it.keywords ?? ''}` : 'action' in it ? `${it.action} ${it.keywords ?? ''}` : '').toLowerCase().includes(query);
    const searchable = (it) => !('heading' in it) && matches(it);
    const draw = () => {
        const keepScroll = main.scrollTop;
        list.textContent = '';
        let group = '';
        for (const s of sections) {
            // a section without a group (About) sits on its own at the end, after a gap
            if (s.group !== group) {
                group = s.group;
                list.appendChild(group ? h('div', { class: 'set-group' }, group) : h('div', { class: 'set-group-gap' }));
            }
            const hits = query ? s.items().filter(searchable).length : 0;
            list.appendChild(h('button', {
                class: 'set-nav-item' + (!query && s === current ? ' on' : '') + (query && !hits ? ' dim' : ''),
                onclick: () => { current = s; setQuery(''); main.scrollTop = 0; },
            }, menuIcon(s.icon), h('span', null, s.label), query && hits ? h('span', { class: 'set-hits' }, String(hits)) : null));
        }
        main.textContent = '';
        const inner = h('div', { class: 'set-inner' });
        if (query) {
            inner.appendChild(h('div', { class: 'set-head' }, h('h2', null, 'Search results')));
            let any = false;
            for (const s of sections) {
                const items = s.items().filter(searchable);
                if (!items.length)
                    continue;
                any = true;
                cards(inner, [{ heading: s.label }, ...items]);
            }
            if (!any)
                inner.appendChild(h('p', { class: 'set-desc' }, `Nothing found for “${search.value}”.`));
        }
        else {
            inner.appendChild(h('div', { class: 'set-head' }, h('h2', null, current.title ?? current.label), current.subtitle ? h('p', { class: 'set-subtitle' }, current.subtitle) : null));
            cards(inner, current.items());
        }
        main.appendChild(inner);
        // after the content is back: the window stays where it was (a change never jumps to the top)
        if (!query)
            main.scrollTop = keepScroll;
    };
    draw();
    const box = h('div', { class: 'set-window' }, nav, main, h('button', { class: 'icon-btn set-close', 'aria-label': 'Close settings', onclick: () => close() }, svgIcon(ICONS.close, 16)));
    const close = dialog(box, { wide: true });
    box.closest('.dialog')?.classList.add('settings-dialog');
    box.closest('.overlay')?.classList.add('phone-page');
    requestAnimationFrame(() => search.focus({ preventScroll: true }));
    return { close, refresh: draw };
}
/**
 * Settings on a phone, as on iOS: a list of the settings pages (grouped, with coloured tiles and
 * their current value), each opening as its own screen with "‹ Settings" to go back.
 */
function phoneSettings(sections, start) {
    let page = sections.find((s) => s.id === start) ?? null;
    let query = '';
    const body = h('div', { class: 'pset-body' });
    const search = h('input', { class: 'pset-search-in', type: 'text', autocomplete: 'off', placeholder: 'Search', 'aria-label': 'Search settings', enterkeyhint: 'search' });
    const clear = h('button', { class: 'pset-search-clear', 'aria-label': 'Clear search', hidden: true }, svgIcon(ICONS.close, 11));
    const searchBox = h('label', { class: 'pset-search' }, svgIcon(ICONS.search, 16), search, clear);
    search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); clear.hidden = !search.value; draw(); });
    clear.addEventListener('click', (e) => { e.preventDefault(); search.value = ''; query = ''; clear.hidden = true; draw(); search.focus(); });
    const text = (x) => (x instanceof Node ? x.textContent ?? '' : String(x ?? ''));
    const hit = (it) => !('heading' in it) && ('title' in it ? `${text(it.title)} ${text(it.desc)} ${it.keywords ?? ''}` : `${it.action} ${it.keywords ?? ''}`).toLowerCase().includes(query);
    const chev = () => h('span', { class: 'pset-chev' }, svgIcon(ICONS.chevron, 13));
    const go = (s) => {
        const fwd = !!s;
        last = s ?? page ?? last;
        page = s;
        body.scrollTop = 0;
        draw();
        box.classList.remove('pset-in', 'pset-out');
        void box.offsetWidth;
        box.classList.add(fwd ? 'pset-in' : 'pset-out');
    };
    const bar = h('div', { class: 'pset-bar' });
    const draw = () => {
        const keep = body.scrollTop;
        // the search box is put back into the new list: it must keep the keyboard while you type
        const typing = document.activeElement === search;
        body.textContent = '';
        if (page) {
            const p = page;
            bar.replaceChildren(h('button', { class: 'pset-back', onclick: () => go(null) }, svgIcon(ICONS.chevron, 15), 'Settings'), h('span', { class: 'pset-title' }, p.label), h('span'));
            const inner = h('div', { class: 'set-inner pset-page' });
            cards(inner, p.items());
            body.append(inner);
            body.scrollTop = keep;
            return;
        }
        bar.replaceChildren(h('span'), h('span', { class: 'pset-title faded' }, 'Settings'), h('span'));
        const inner = h('div', { class: 'set-inner pset-home' }, h('h1', { class: 'pset-big' }, 'Settings'), searchBox);
        if (typing)
            queueMicrotask(() => { if (document.activeElement !== search)
                search.focus({ preventScroll: true }); });
        if (query) {
            let any = false;
            for (const s of sections) {
                const items = s.items().filter(hit);
                if (!items.length)
                    continue;
                any = true;
                cards(inner, [{ heading: s.label }, ...items]);
            }
            if (!any)
                inner.append(h('p', { class: 'pset-none' }, `No settings for “${search.value}”`));
        }
        else {
            let group = null;
            let card = null;
            // the workspace as a card on top: its name and where it is saved; tapping it opens its page
            const top = sections.find((x) => x.card);
            if (top)
                inner.append(h('button', { class: 'pset-ws', onclick: () => go(top) }, h('span', { class: 'pset-ws-ico' }, (top.summary?.() || 'N').trim().charAt(0).toUpperCase()), h('span', { class: 'pset-ws-text' }, h('b', null, top.summary?.() || top.label), h('small', null, h('i', { class: 'pset-ok' }), top.card())), chev()));
            for (const s of sections) {
                if (s === top || s.desktopOnly)
                    continue;
                if (s.group !== group || !card) {
                    group = s.group;
                    card = h('div', { class: 'set-card pset-list' });
                    inner.append(h('section', { class: 'set-sec' }, group ? h('div', { class: 'set-heading' }, h('h3', null, group)) : null, card));
                }
                const v = s.summary?.() ?? '';
                card.append(h('button', { class: 'pset-row', onclick: () => (s.run ? s.run() : go(s)) }, h('span', { class: 'pset-tile', style: { background: tileColor(s.id) } }, iconSvg(s.icon, 17)), h('span', { class: 'pset-label' }, s.label), v ? h('span', { class: 'pset-val' }, v) : null, chev()));
            }
        }
        body.append(inner);
        body.scrollTop = keep;
    };
    const box = h('div', { class: 'set-window pset' }, bar, body);
    // swipe from the left edge: back to the list; from the right edge: forward to the page you came back from
    let last = page;
    let sx = 0, sy = 0, edge = null;
    box.addEventListener('touchstart', (e) => { const t = e.touches[0]; const w = box.clientWidth; sx = t.clientX; sy = t.clientY; edge = sx < 24 ? 'l' : sx > w - 24 ? 'r' : null; }, { passive: true });
    box.addEventListener('touchend', (e) => {
        if (!edge)
            return;
        const t = e.changedTouches[0], dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
        if (Math.abs(dx) < 60 || dy > Math.abs(dx) * 0.6)
            return;
        if (edge === 'l' && dx > 0 && page)
            go(null);
        else if (edge === 'r' && dx < 0 && !page && last)
            go(last);
        edge = null;
    });
    draw();
    const close = dialog(box, { wide: true });
    box.closest('.dialog')?.classList.add('settings-dialog');
    box.closest('.overlay')?.classList.add('phone-page');
    return { close, refresh: draw };
}
/** a toggle switch control */
export function switchControl(on, change, label) {
    const el = h('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': label }, h('span'));
    el.addEventListener('click', () => { on = !on; el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on)); change(on); });
    return el;
}
/** a dropdown control (Nook's menu, never the system list) */
export function selectControl(options, value, change, label) {
    const show = h('span', { class: 'picker-label' });
    const btn = h('button', { type: 'button', class: 'set-select picker', 'aria-label': label }, h('span', { class: 'picker-value' }, show), h('span', { class: 'picker-caret' }, svgIcon(ICONS.chevron, 12)));
    const draw = () => { show.textContent = options.find(([v]) => v === value)?.[1] ?? '—'; };
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu(btn, options.map(([v, l]) => ({ label: l, hint: v === value ? '✓' : undefined, run: () => { value = v; draw(); change(v); } })));
    });
    draw();
    return btn;
}
/** ⋯ on a row: the actions of one thing in a list */
export function moreControl(entries, label = 'More') {
    const b = h('button', { class: 'icon-btn set-more', 'aria-label': label, title: label, onclick: (e) => { e.stopPropagation(); menu(b, entries()); } }, svgIcon(ICONS.more, 15, { fill: true }));
    return b;
}
//# sourceMappingURL=settings.js.map