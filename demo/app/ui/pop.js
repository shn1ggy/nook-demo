// Popover menus, dialogs and toasts.
import { h, svgIcon, ICONS, segmented, COLORS, colorLabel } from '../util.js';
import { iconSvg } from './icons.js';
/** a menu row's icon: a library icon (16 px), with an optional small badge (the heading level) */
/** a colour's dot (any colour name, custom ones too; 'default' is the empty one) */
export function colorDot(c, step = 'tag') {
    return h('span', { class: 'swatch', style: { background: !c || c === 'default' ? 'var(--bg-hover)' : COLORS[c][step] } });
}
/** a dot of any CSS colour */
export function cssDot(css) { return h('span', { class: 'swatch', style: { background: css } }); }
/** the colours to pick from in a menu – built-in and own colours, each with its dot, ✓ on the current one.
 *  `none` names the 'default' choice (left out without it) */
export function colorEntries(cur, pick, o = {}) {
    return Object.keys(COLORS).filter((c) => o.none || c !== 'default').map((c) => ({
        label: `${(cur ?? 'default') === c ? '✓' : '   '} ${c === 'default' ? o.none : colorLabel(c)}`, icon: c === 'default' && o.noneCss ? cssDot(o.noneCss) : colorDot(c, o.step), run: () => pick(c)
    }));
}
export function menuIcon(name, badge) {
    const s = h('span', { class: 'menu-ico' }, iconSvg(name, 16));
    if (badge)
        s.appendChild(h('span', { class: 'menu-ico-badge' }, String(badge)));
    return s;
}
/** open popovers, parent first; a submenu is a child of the menu it came from */
const stack = [];
let lastRect = { left: innerWidth / 2 - 120, top: 120, bottom: 120, right: innerWidth / 2 };
/** set while a menu item runs: anything it opens appears where that menu was */
let follow = null;
/** after a menu or panel changed its content: keep it in the window, and keep the bottom edge of one that opened upwards */
function keepPlace(pop) {
    if (!pop)
        return;
    // layout sizes (not the on-screen box, which is smaller while the open animation scales it)
    const hgt = pop.offsetHeight, w = pop.offsetWidth, top = parseFloat(pop.style.top) || 0, left = parseFloat(pop.style.left) || 0;
    if (pop.dataset.bottom)
        pop.style.top = `${Math.max(8, Number(pop.dataset.bottom) - hgt)}px`;
    else if (top + hgt > innerHeight - 8)
        pop.style.top = `${Math.max(8, innerHeight - 8 - hgt)}px`;
    if (left + w > innerWidth - 8)
        pop.style.left = `${Math.max(8, innerWidth - 8 - w)}px`;
}
/** four or more choices are too tight for a row: they become a page (current value on the right, ✓ on the chosen one) */
const segOpts = (sg) => sg.options.map((o) => (Array.isArray(o) ? o : [o, o]));
function segToMenu(e) {
    if (!e.seg || e.seg.options.length <= 3)
        return e;
    const sg = e.seg, opts = segOpts(sg);
    return { label: e.label, icon: e.icon, hint: opts.find(([v]) => v === sg.value)?.[1], sub: () => opts.map(([v, t]) => ({ label: `${v === sg.value ? '✓' : '   '} ${t}`, run: () => sg.pick(v) })) };
}
function segToPanel(r) {
    if (!r.seg || r.seg.options.length <= 3)
        return r;
    const sg = r.seg, opts = segOpts(sg);
    return { label: r.label, icon: r.icon, hint: opts.find(([v]) => v === sg.value)?.[1], go: () => ({ title: r.label, rows: () => opts.map(([v, t]) => ({ label: t, checked: v === sg.value, pick: () => { sg.value = v; sg.pick(v); }, back: true })) }) };
}
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function closePop() { while (stack.length)
    stack[stack.length - 1].close(); }
function closeAbove(depth) { while (stack.length > depth)
    stack[stack.length - 1].close(); }
/** the button whose popover was just closed by pressing it again: the click that follows must not reopen it */
let toggledOff = null;
document.addEventListener('mousedown', (e) => {
    if (!stack.length)
        return;
    if (!stack.some((p) => p.el.contains(e.target))) {
        const hit = stack.find((p) => p.anchor && p.anchor.contains(e.target));
        if (hit?.anchor)
            toggledOff = { el: hit.anchor, at: Date.now() };
        closePop();
    }
}, true);
document.addEventListener('keydown', (e) => {
    // Esc, or ⌘/Ctrl+Enter ("done"), closes the topmost panel
    if ((e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) && stack.length) {
        e.stopPropagation();
        e.preventDefault();
        stack[stack.length - 1].close();
    }
}, true);
const dialogBoxes = new Map();
/** closes every centre peek (a link inside one opened something else) */
/** closes every window except full-screen pages (Settings, Notifications) – a bottom-bar tab leaves them */
export function closeSheets() { for (const [c, b] of [...dialogBoxes])
    if (!b.closest('.overlay.phone-page'))
        c(); }
export function closePeeks() { for (const [c, b] of [...dialogBoxes])
    if (b.querySelector(':scope > .peek'))
        c(); }
/** Position of an anchor. A detached anchor (removed by a redraw) reuses the last known position. */
function anchorRect(anchor) {
    if (!(anchor instanceof Element))
        return { left: anchor.x, top: anchor.y, bottom: anchor.y, right: anchor.x };
    const b = anchor.getBoundingClientRect();
    if (!anchor.isConnected || (b.width === 0 && b.height === 0 && b.left === 0 && b.top === 0))
        return lastRect;
    return { left: b.left, top: b.top, bottom: b.bottom, right: b.right };
}
const toRect = (a) => ('left' in a && 'bottom' in a ? a : anchorRect(a));
/** a popover opened from inside another one (e.g. right-clicking an entry in a "N more" list)
    stacks on top of it instead of closing it */
function autoDepth(anchor) {
    if (!stack.length)
        return 0;
    let el = null;
    if (anchor instanceof Element)
        el = anchor.isConnected ? anchor : null;
    else if ('x' in anchor)
        el = document.elementFromPoint(anchor.x, anchor.y);
    if (!el)
        return 0;
    for (let i = stack.length - 1; i >= 0; i--)
        if (stack[i].el.contains(el))
            return i + 1;
    return 0;
}
export function openPop(anchor, content, onClose, opts = {}) {
    // pressing the button that opened this popover again closes it (and doesn't reopen it)
    if (anchor instanceof Element && toggledOff && Date.now() - toggledOff.at < 600 && (toggledOff.el === anchor || toggledOff.el.contains(anchor) || anchor.contains(toggledOff.el))) {
        toggledOff = null;
        return () => { };
    }
    let r = toRect(anchor);
    if (follow && !opts.side) {
        r = follow;
        follow = null;
    }
    lastRect = r;
    closeAbove(opts.depth ?? autoDepth(anchor));
    const el = h('div', { class: 'pop' }, content);
    document.body.appendChild(el);
    const w = el.offsetWidth, hgt = el.offsetHeight;
    let x, y;
    if (opts.side) {
        // submenu: to the right of the parent menu, top aligned with the item; flips left if needed
        x = opts.side.menu.right + 2;
        y = opts.side.item.top - 5;
        if (x + w > innerWidth - 8)
            x = Math.max(8, opts.side.menu.left - w - 2);
        if (y + hgt > innerHeight - 8)
            y = Math.max(8, innerHeight - hgt - 8);
    }
    else {
        x = r.left;
        y = opts.over != null ? r.top - opts.over : r.bottom + 4;
        if (opts.over != null)
            x = r.left - opts.over;
        if (x + w > innerWidth - 8)
            x = Math.max(8, innerWidth - w - 8);
        if (y + hgt > innerHeight - 8)
            y = Math.max(8, r.top - hgt - 4);
        if (y < 8)
            y = Math.max(8, innerHeight - hgt - 8);
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    // opened upwards (no room below the button): its bottom edge stays put when it changes height
    if (!opts.side && y < r.top)
        el.dataset.bottom = String(y + hgt);
    let closed = false;
    const pop = { el, close, anchor: anchor instanceof Element ? anchor : undefined };
    function close() {
        if (closed)
            return;
        closed = true;
        const i = stack.indexOf(pop);
        if (i >= 0) {
            closeAbove(i + 1);
            stack.splice(i, 1);
        }
        // phone: a sheet slides down before it goes (however it was closed – ✕, a tap outside, its button again)
        if (document.documentElement.classList.contains('phone') && !reduceMotion() && el.isConnected && !el.dataset.gone && getComputedStyle(el).visibility !== 'hidden') {
            // (a sheet already swiped off the screen just goes – no second slide)
            el.classList.add('pop-closing');
            el.style.pointerEvents = 'none';
            setTimeout(() => el.remove(), 260);
        }
        else
            el.remove();
        onClose?.();
    }
    stack.push(pop);
    return close;
}
/** the usual icon of a common action, so first-level menus show one on every row without each menu listing them */
/** deeper levels show a hint only when it is a short value (a count, ".zip", a key) or the current value of a row that opens more; explanations are left out */
const shortHint = (hint, sub) => (!hint ? undefined : !sub || hint.length <= 12 ? hint : undefined);
const STANDARD_ICONS = [
    [/^open in new tab/i, 'external'], [/^open( |$)/i, 'arrow-right'], [/^rename/i, 'pencil'], [/^(change|choose) icon/i, 'sparkles'],
    [/^duplicate/i, 'layers'], [/^new (subpage|page)/i, 'file-plus'], [/^move to/i, 'folder'], [/^page width/i, 'columns'],
    [/^cover image/i, 'image'], [/favorites$/i, 'star'], [/start page/i, 'home'], [/^find on/i, 'search'], [/^linked from/i, 'link'], [/^backlinks/i, 'link'], [/^find duplicates/i, 'layers'],
    [/^used on pages/i, 'link'], [/history/i, 'clock'], [/^export/i, 'download'], [/^settings/i, 'settings'], [/^show in (finder|folder)/i, 'folder'],
    [/^delete|^remove/i, 'trash'], [/^undo/i, 'arrow-left'], [/^move up/i, 'arrow-up'], [/^move down/i, 'arrow-down'], [/from list$/i, 'trash'], [/^restore/i, 'restore'], [/^redo/i, 'arrow-right'], [/^\d[\d.,]* words?$/i, 'type'], [/^copy link/i, 'link'],
    [/^view settings/i, 'sliders'], [/^repeat/i, 'repeat'], [/sub-item/i, 'list'], [/^move to top level/i, 'arrow-up'], [/^select$/i, 'check-square'], [/^copy/i, 'clipboard'], [/^(edit|properties)/i, 'pencil'],
];
/** settings rows (widgets and other panels) that come without an icon: one by what they set */
const NONE_LIKE = /^(off|none|no |nothing|automatic|default)/i;
const SETTING_ICONS = [
    [/^shape/i, 'circle'], [/^show weeks/i, 'calendar-days'], [/checkbox colou?r/i, 'palette'],
    [/^open (the|in|entries)/i, 'external'], [/^stay here/i, 'pencil'], [/^at the (top|bottom)|^top and bottom/i, 'rows'], [/^show the switcher/i, 'calendar'], [/^templates?/i, 'file-text'],
    [/^days ahead|^day$|^days a week|^date$|^from$|^to$|^counting from|^week|^month|^year/i, 'calendar'], [/^unit/i, 'thermometer'], [/wind/i, 'wind'], [/high and low/i, 'arrow-up-down'],
    [/^background|^look|^colou?r/i, 'palette'], [/^place|^address/i, 'map-pin'], [/^time format|^seconds|^clocks|^time zone|^your own time|^time left/i, 'clock'],
    [/^show (count|bar|weeks|names|source)/i, 'eye'], [/^hide done/i, 'check-square'], [/^tile size|^quote size|size$/i, 'maximize'], [/^name$|^text$|^heading/i, 'type'],
    [/^goal|^current value|^numbers/i, 'target'], [/^habit/i, 'repeat'], [/^links|^web address/i, 'link'], [/^quotes?$/i, 'quote'], [/^behaviou?r|^own periods|^by$/i, 'sliders'],
    [/^icon$/i, 'sparkles'], [/^fixed|flexible/i, 'columns'], [/^show$/i, 'eye'],
];
export function settingIcon(label) {
    const hit = SETTING_ICONS.find(([re]) => re.test(label.trim())) ?? STANDARD_ICONS.find(([re]) => re.test(label));
    return hit ? menuIcon(hit[1]) : undefined;
}
function standardIcon(label) {
    const hit = STANDARD_ICONS.find(([re]) => re.test(label));
    return hit ? menuIcon(hit[1]) : undefined;
}
export function menu(anchor, entries, opts = {}) {
    entries = forPhone(entries).map((e) => (typeof e === 'object' && 'label' in e ? segToMenu(e) : e));
    const box = h('div', { class: 'mpanel' + (entries.some(e => typeof e === 'object' && 'section' in e && e.section === 'Column width') ? ' column-width-menu' : '') });
    const head = h('div', { class: 'mhead' });
    const body = h('div', { class: 'mbody' });
    let list = h('div', { class: 'mlist' });
    const depth = opts.depth ?? (opts.side ? 0 : autoDepth(anchor));
    const base = opts.base ?? (opts.sub ? 0 : depth);
    let hi = 0;
    let input = null;
    const items = () => [...list.querySelectorAll('.pop-item')];
    const rectOf = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, bottom: b.bottom, right: b.right }; };
    const pages = [{ entries, title: opts.title, filter: !!opts.filter, sub: !!opts.sub }];
    const cur = () => pages[pages.length - 1];
    const iconOf = (e, sub) => {
        const ic = e.icon ?? (sub ? undefined : standardIcon(e.label));
        if (ic == null)
            return null;
        return typeof ic === 'string' ? h('span', { class: 'menu-ico menu-ico-text' }, ic) : ic;
    };
    const close = () => { if (opts.keepBelow)
        closeAbove(depth);
    else if (base > 0)
        closeAbove(base);
    else
        closePop(); };
    const go = (p, dir) => {
        if (p) {
            cur().hi = hi;
            pages.push(p);
        }
        else if (pages.length > 1)
            pages.pop();
        else
            return;
        show(dir);
    };
    const render = (q = '') => {
        const pg = cur();
        pg.q = q;
        list.textContent = '';
        // icons: every row of a group (between lines / headings) has one, or none has – never a mix with gaps
        const icons = new Map();
        const groups = [[]];
        for (const e of pg.entries) {
            if (e === 'sep' || (typeof e === 'object' && 'section' in e))
                groups.push([]);
            else if (!('el' in e))
                groups[groups.length - 1].push(e);
        }
        for (const g of groups) {
            for (const e of g)
                icons.set(e, iconOf(e, pg.sub) ?? (pg.sub ? null : settingIcon(e.label) ?? null));
            if (g.every((e) => icons.get(e)))
                continue;
            for (const e of g)
                if (!icons.get(e))
                    icons.set(e, settingIcon(e.label) ?? (NONE_LIKE.test(e.label) ? menuIcon('minus') : null));
            if (g.every((e) => icons.get(e)))
                continue;
            // top level: a plain dot where nothing fits; lists of choices further in drop their icons instead
            // still gaps: this group shows no icons (never placeholder dots)
            for (const e of g)
                icons.set(e, null);
        }
        let grp = null;
        const group = () => { if (!grp) {
            grp = h('div', { class: 'mgrp' });
            list.appendChild(grp);
        } return grp; };
        const creators = [];
        for (const e0 of [...pg.entries, ...(q ? ['__create'] : [])]) {
            if (e0 === '__create') {
                for (const c of creators)
                    group().appendChild(h('button', { class: 'pop-item', onclick: (ev) => { ev.stopPropagation(); close(); c.create(q.trim()); } }, icons.get(c) ?? null, h('span', null, `Create “${q.trim()}”`)));
                continue;
            }
            const e = e0;
            if (q && typeof e === 'object' && 'label' in e && e.create) {
                creators.push(e);
                continue;
            }
            if (e === 'sep') {
                if (!q)
                    grp = null;
                continue;
            }
            if ('el' in e) {
                if (!q)
                    group().appendChild(h('div', { class: 'mrow-el menu-el' }, e.el));
                continue;
            }
            if ('section' in e) {
                if (!q) {
                    grp = null;
                    list.appendChild(h('div', { class: 'pop-label' }, e.section));
                }
                continue;
            }
            if (q && !e.label.toLowerCase().includes(q.toLowerCase()))
                continue;
            const mk = /^(✓\s*|\s+)(?=\S)/.exec(e.label);
            const label = mk ? e.label.slice(mk[0].length) : e.label;
            const checkMark = mk ? h('span', { class: 'chk panel-check', 'aria-hidden': 'true' }, mk[1].startsWith('✓') ? '✓' : '') : null;
            let right = null;
            if (e.toggle !== undefined)
                right = h('span', { class: 'switch' + (e.toggle ? ' on' : '') }, h('span'));
            else if (e.seg) {
                const sg = e.seg;
                right = segmented(sg.options.map((o) => (Array.isArray(o) ? o : [o, o])), sg.value, (v) => { sg.value = v; sg.pick(v); render(input?.value ?? ''); }, e.label, 'small');
            }
            const hint = e.hint && shortHint(e.hint, pg.sub && !e.sub) && !keysOnly(e.hint) ? h('span', { class: 'hint' + (e.sub ? ' val' : '') }, e.hint) : null;
            const btn = h('button', {
                class: 'pop-item' + (e.danger ? ' danger' : '') + (e.sub ? ' has-sub' : '') + (e.seg ? ' has-seg' : ''),
                onclick: (ev) => {
                    ev.stopPropagation();
                    if (e.sub) {
                        go({ entries: forPhone(e.sub()).map((x) => (typeof x === 'object' && 'label' in x ? segToMenu(x) : x)), title: label, filter: !!e.subFilter, sub: true }, 1);
                        return;
                    }
                    if (e.toggle !== undefined) {
                        e.toggle = !e.toggle;
                        (e.onToggle ?? (() => e.run?.()))(e.toggle);
                        render(input?.value ?? '');
                        return;
                    }
                    if (e.seg)
                        return;
                    follow = rectOf(box.parentElement);
                    follow = { ...follow, bottom: follow.top - 4 };
                    close();
                    try {
                        e.run?.();
                    }
                    finally {
                        setTimeout(() => { follow = null; });
                    }
                },
            }, e.reorder ? dragHandle(e.reorder) : null, icons.get(e) ?? null, ...labelParts(label), right ? null : hint, right, checkMark, e.sub ? h('span', { class: 'sub-arrow' }, '›') : null);
            if (e.reorder) {
                reorderRow(btn, e.reorder);
                btn.classList.add('reorderable');
            }
            group().appendChild(btn);
        }
        hi = Math.min(pg.hi ?? 0, Math.max(0, items().length - 1));
        pg.hi = undefined;
        mark();
    };
    const mark = () => items().forEach((b, i) => b.classList.toggle('hi', i === hi));
    const show = (dir) => {
        const pg = cur();
        const old = list;
        list = h('div', { class: 'mlist' });
        head.textContent = '';
        if (pages.length > 1 || pg.title) {
            if (pages.length > 1)
                head.append(h('button', { class: 'mback', 'aria-label': 'Back', onclick: (ev) => { ev.stopPropagation(); go(null, -1); } }, iconSvg('chevron-left', 16)));
            head.append(h('span', { class: 'mtitle' }, pg.title ?? ''));
            head.hidden = false;
        }
        else
            head.hidden = true;
        input = null;
        if (pg.filter) {
            input = h('input', { class: 'pop-input', placeholder: 'Search…' });
            input.value = pg.q ?? '';
            input.addEventListener('input', () => render(input.value));
        }
        body.textContent = '';
        if (input)
            body.appendChild(h('div', { class: 'msearch' }, input));
        body.appendChild(list);
        render(pg.q ?? '');
        if (pg.filter) {
            list.style.maxHeight = '360px';
            list.style.overflowY = 'auto';
        }
        if (dir) {
            const pop = box.parentElement;
            // the panel keeps its place; the new page slides in from the side it comes from
            if (pop) {
                pop.style.minWidth = `${Math.min(pop.offsetWidth, 340)}px`;
            }
            body.classList.remove('slide-in', 'slide-back');
            void body.offsetWidth;
            body.classList.add(dir > 0 ? 'slide-in' : 'slide-back');
            keepPlace(pop ?? null);
        }
        void old;
        if (input && kbFocusOk())
            input.focus();
        else if (!input)
            (items()[hi] ?? box).focus();
    };
    box.append(head, body);
    box.tabIndex = -1;
    box.addEventListener('keydown', (e) => {
        const list = items();
        const typing = e.target instanceof HTMLInputElement;
        if (e.key === 'ArrowDown') {
            hi = Math.min(list.length - 1, hi + 1);
            mark();
            list[hi]?.focus();
            list[hi]?.scrollIntoView({ block: 'nearest' });
            e.preventDefault();
        }
        else if (e.key === 'ArrowUp') {
            hi = Math.max(0, hi - 1);
            mark();
            list[hi]?.focus();
            list[hi]?.scrollIntoView({ block: 'nearest' });
            e.preventDefault();
        }
        else if (e.key === 'Enter' || (e.key === 'ArrowRight' && list[hi]?.classList.contains('has-sub'))) {
            list[hi]?.click();
            e.preventDefault();
        }
        else if (e.key === 'ArrowLeft' && pages.length > 1 && !(typing && e.target.value)) {
            go(null, -1);
            e.preventDefault();
        }
        else if (e.key === 'Backspace' && pages.length > 1 && !(typing && e.target.value)) {
            go(null, -1);
            e.preventDefault();
            e.stopPropagation();
        }
        else if ((e.metaKey || e.ctrlKey) && ['c', 'x'].includes(e.key.toLowerCase()) && (e.key.toLowerCase() === 'c' ? opts.onCopy : opts.onCut) && !(typing && e.target.selectionStart !== e.target.selectionEnd)) {
            e.preventDefault();
            e.stopPropagation();
            closePop();
            (e.key.toLowerCase() === 'c' ? opts.onCopy : opts.onCut)();
        }
        else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && opts.onDuplicate) {
            e.preventDefault();
            e.stopPropagation();
            closePop();
            opts.onDuplicate();
        }
        else if ((e.key === 'Backspace' || e.key === 'Delete') && opts.onDelete && pages.length === 1 && !(typing && e.target.value)) {
            e.preventDefault();
            e.stopPropagation();
            closePop();
            opts.onDelete();
        }
    });
    show(0);
    openPop(anchor, box, undefined, { side: opts.side, depth });
    const pop = box.parentElement;
    if (pop) {
        pop.classList.add('pop-menu');
        keepPlace(pop);
        if (pop.dataset.bottom) {
            const r = toRect(anchor);
            pop.style.top = `${Math.max(8, Math.min(Number(pop.dataset.bottom), r.top) - pop.offsetHeight)}px`;
            pop.dataset.bottom = String(parseFloat(pop.style.top) + pop.offsetHeight);
        }
    }
    const above = !!pop && !opts.side && pop.getBoundingClientRect().top < toRect(anchor).top;
    if (pop && opts.filter && !above && !document.documentElement.classList.contains('phone')) {
        const room = Math.floor(innerHeight - list.getBoundingClientRect().top - 14);
        if (room > 360) {
            list.style.maxHeight = `${Math.min(room, 620)}px`;
            pop.style.maxHeight = `${innerHeight - 16}px`;
        }
    }
    if (pop && above) {
        const ro = new ResizeObserver(() => { if (!pop.isConnected) {
            ro.disconnect();
            return;
        } keepPlace(pop); });
        ro.observe(pop);
    }
    {
        const inp = input;
        if (inp && kbFocusOk()) {
            inp.focus();
            if (document.documentElement.classList.contains('phone')) {
                // the phone: the editor may take the focus back right after "/" – keep handing it to the search field
                const again = () => { if (inp.isConnected && document.activeElement !== inp)
                    inp.focus(); };
                requestAnimationFrame(again);
                setTimeout(again, 60);
                setTimeout(again, 250);
                const keep = () => { if (inp.isConnected && !inp.value)
                    setTimeout(again, 0); };
                document.addEventListener('focusin', function f(e) { if (!inp.isConnected) {
                    document.removeEventListener('focusin', f);
                    return;
                } if (e.target !== inp && e.target.isContentEditable)
                    keep(); });
            }
        }
        else if (!inp)
            items()[0]?.focus();
    }
}
/** "✓ Name" / "   Name" labels get a fixed-width check column so items line up */
function labelParts(label) {
    const m = /^(✓|\s{3}) (.*)$/s.exec(label);
    if (!m)
        return [h('span', null, label)];
    return [h('span', { class: 'chk' }, m[1] === '✓' ? '✓' : ''), h('span', null, m[2])];
}
export function prompt(anchor, label, value, onOk, multiline = false) {
    const field = multiline ? h('textarea', null) : h('input', { class: 'pop-input' });
    field.value = value;
    const ok = () => { close(); onOk(field.value); };
    field.addEventListener('keydown', (e) => {
        const ke = e;
        if (ke.key === 'Enter' && (!multiline || ke.metaKey || ke.ctrlKey)) {
            ke.preventDefault();
            ok();
        }
    });
    const box = h('div', { class: 'pop-prompt', style: { padding: '4px', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '280px' } }, h('div', { class: 'pop-label' }, label), field, h('button', { class: 'btn-new', onclick: ok }, 'OK'));
    const close = openPop(anchor, box);
    field.focus();
    field.select?.();
}
/** last focused element that can be found again after a redraw (data-focus-key) */
let lastFocusKey;
document.addEventListener('focusin', (e) => { lastFocusKey = e.target?.dataset?.focusKey; });
/** open dialogs, newest last: Esc only closes the top one (e.g. a form opened from the settings) */
const dialogs = [];
/** a short question before something big (deleting …): title, a few lines, Cancel and the action */
export function confirmDialog(o) {
    let done = false;
    const okBtn = h('button', { class: 'btn-new' + (o.danger ? ' danger-btn' : '') }, o.ok);
    const close = dialog(h('div', { class: 'confirm-box' }, h('div', { class: 'confirm-title' }, o.title), ...o.lines.map((t) => h('p', { class: 'confirm-text' }, t)), h('div', { class: 'confirm-actions' }, h('button', { class: 'set-btn', onclick: () => close() }, o.cancel ?? 'Cancel'), okBtn)), { onClose: () => { if (!done)
            o.onCancel?.(); } });
    okBtn.addEventListener('click', () => { done = true; close(); o.onOk(); });
    requestAnimationFrame(() => okBtn.focus());
}
export function dialog(content, opts = {}) {
    const box = h('div', { class: 'dialog' + (opts.wide ? ' wide' : ''), role: 'dialog' }, content);
    const tryClose = () => { if (!opts.beforeClose || opts.beforeClose())
        close(); };
    const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov)
            tryClose(); } }, box);
    const onKey = (e) => { if ((e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) && !stack.length && dialogs[dialogs.length - 1] === tryClose && !e.defaultPrevented) {
        e.preventDefault();
        e.stopImmediatePropagation();
        tryClose();
    } };
    dialogs.push(tryClose);
    dialogBoxes.set(close, box);
    document.addEventListener('keydown', onKey);
    // remember where focus was, to give it back when the dialog closes (e.g. the selected calendar day)
    const prev = document.activeElement;
    const prevKey = prev?.dataset?.focusKey ?? (!prev || prev === document.body ? lastFocusKey : undefined);
    document.body.appendChild(ov);
    if (document.documentElement.classList.contains('phone'))
        phoneFormHead(content);
    let closed = false;
    function close() {
        if (closed)
            return;
        closed = true;
        dialogBoxes.delete(close);
        document.removeEventListener('keydown', onKey);
        const i = dialogs.indexOf(tryClose);
        if (i >= 0)
            dialogs.splice(i, 1);
        // phone: the sheet slides back down (as on iOS) – unless a swipe already took it off the screen
        const sheetEl = ov.querySelector(':scope > .dialog');
        if (document.documentElement.classList.contains('phone') && sheetEl && !sheetEl.dataset.gone && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
            ov.classList.add('closing');
            ov.style.pointerEvents = 'none';
            setTimeout(() => ov.remove(), 300);
        }
        else
            ov.remove();
        opts.onClose?.();
        const back = prev?.isConnected && prev !== document.body ? prev : prevKey ? document.querySelector(`[data-focus-key="${CSS.escape(prevKey)}"]`) : null;
        back?.focus({ preventScroll: true });
    }
    return close;
}
export function toast(msg, ms = 2400) {
    // one message at a time: a newer one takes the place of the one still showing
    document.querySelectorAll('.toast:not(.pick-note):not(.open-note):not(.prog-toast)').forEach((x) => x.remove());
    // "… · ⌘Z to undo": where there is no keyboard, the message gets an Undo button instead
    const m = /^(.*) · \S+ to undo$/.exec(msg);
    const touch = document.documentElement.classList.contains('phone') || document.documentElement.classList.contains('touch');
    const el = m && touch
        ? h('div', { class: 'toast has-action', role: 'status' }, m[1], h('button', { class: 'toast-action', onclick: () => { el.remove(); document.dispatchEvent(new CustomEvent('nook:undo')); } }, 'Undo'))
        : h('div', { class: 'toast', role: 'status' }, msg);
    if (m && touch)
        ms = 5000;
    // what kind of message: a small sign on its left (✓ done · i info · ! problem · ! offline)
    const t = msg.toLowerCase();
    el.dataset.kind = /not saved|failed|couldn|can.t |cannot|error|problem|gone|refus/.test(t) ? 'err'
        : /offline|wait/.test(t) ? 'warn'
            : /^(deleted|restored|copied|added|saved|moved|cut|removed|duplicated|imported|exported|created|renamed|archived|everything is up to date|done|updated|sent|pasted)/.test(t) || / changes? from your other devices/.test(t) ? 'ok' : 'info';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
}
/**
 * A settings panel. Its sub-pages open inside the same panel (‹ back), like the menus:
 * the panel keeps its place, the new page slides in.
 */
export function panel(anchor, root) {
    const pages = [{ page: root }];
    const box = h('div', { class: 'vpanel mpanel' });
    let closed = false;
    let close = () => { };
    const cur = () => pages[pages.length - 1];
    const nav = {
        back: (n = 1) => { if (pages.length <= 1) {
            close();
            return;
        } for (let i = 0; i < n && pages.length > 1; i++)
            pages.pop(); render(-1); },
        refresh: () => render(0),
        close: () => close(),
        go: (p) => { cur().scroll = box.querySelector('.vpanel-rows')?.scrollTop; pages.push({ page: p }); render(1); },
    };
    const render = (dir) => {
        if (closed)
            return;
        const { page } = cur();
        const keepScroll = dir === 0 ? box.querySelector('.vpanel-rows')?.scrollTop ?? 0 : dir < 0 ? cur().scroll ?? 0 : 0;
        const act = document.activeElement;
        const focusIdx = dir === 0 && act && box.contains(act) ? [...box.querySelectorAll('.pop-item')].indexOf(act) : -1;
        box.textContent = '';
        box.appendChild(h('div', { class: 'mhead vpanel-head' }, pages.length > 1 ? h('button', { class: 'mback', 'aria-label': 'Back', onclick: (e) => { e.stopPropagation(); nav.back(); } }, iconSvg('chevron-left', 16)) : null, h('span', { class: 'mtitle vpanel-title' }, page.title), h('button', { class: 'icon-btn mclose', 'aria-label': 'Close', onclick: () => close() }, svgClose())));
        const body = h('div', { class: 'mbody' + (dir > 0 ? ' slide-in' : dir < 0 ? ' slide-back' : '') });
        const top = page.top?.(nav);
        if (top)
            body.appendChild(h('div', { class: 'msearch' }, top));
        const list = h('div', { class: 'vpanel-rows mlist' });
        let grp = null;
        const group = () => { if (!grp) {
            grp = h('div', { class: 'mgrp' });
            list.appendChild(grp);
        } return grp; };
        const rows = page.rows(nav).map((r) => (typeof r === 'object' && 'label' in r ? segToPanel(r) : r));
        // icons: every row of a group has one, or none has – never a mix with gaps
        const iconFor = new Map();
        const rgroups = [[]];
        for (const r of rows) {
            if (r === 'sep' || 'section' in r)
                rgroups.push([]);
            else if ('label' in r)
                rgroups[rgroups.length - 1].push(r);
        }
        for (const g of rgroups) {
            for (const r of g)
                iconFor.set(r, r.icon ?? settingIcon(r.label) ?? (NONE_LIKE.test(r.label) ? menuIcon('minus') : null));
            const vals = g.map((r) => iconFor.get(r));
            if (vals.every((x) => x) || !vals.some((x) => x))
                continue;
            // first page: a dot where nothing fits; deeper pages: no icons in a mixed group
            for (const r of g)
                iconFor.set(r, null);
        }
        for (const r of rows) {
            if (r === 'sep') {
                grp = null;
                continue;
            }
            if ('section' in r) {
                grp = null;
                list.appendChild(h('div', { class: 'pop-label' }, r.section));
                continue;
            }
            // a ready-made row (a button in the look of the others) joins the group as it is: one hover, one layout
            if ('el' in r) {
                group().appendChild(r.el.classList.contains('pop-item') ? r.el : h('div', { class: 'mrow-el' }, r.el));
                continue;
            }
            const sw = r.toggle !== undefined ? h('span', { class: 'switch' + (r.toggle ? ' on' : ''), 'aria-hidden': 'true' }, h('span')) : null;
            let seg = null;
            if (r.seg) {
                const sg = r.seg;
                seg = segmented(sg.options.map((o) => (Array.isArray(o) ? o : [o, o])), sg.value, (v) => { sg.pick(v); render(0); }, r.label, 'small');
            }
            const btn = h('button', {
                disabled: r.disabled || undefined,
                class: 'pop-item' + (r.disabled ? ' is-disabled' : '') + (r.danger ? ' danger' : '') + (r.go ? ' has-sub' : '') + (seg ? ' has-seg' : ''),
                role: r.toggle !== undefined ? 'switch' : undefined, 'aria-checked': r.toggle !== undefined ? String(r.toggle) : undefined,
                onclick: (e) => {
                    e.stopPropagation();
                    if (r.disabled || seg)
                        return;
                    if (r.go) {
                        nav.go(r.go());
                        return;
                    }
                    if (r.onToggle) {
                        r.onToggle();
                        render(0);
                        return;
                    }
                    if (r.pick) {
                        r.pick();
                        const n = r.back === true ? 1 : r.back || 0;
                        if (n && pages.length > 1)
                            nav.back(n);
                        else
                            render(0);
                        return;
                    }
                    if (r.run) {
                        close();
                        r.run();
                    }
                },
            }, r.reorder ? dragHandle(r.reorder) : null, iconFor.get(r) ?? null, h('span', null, r.label), !seg && shortHint(r.hint, pages.length > 1 && !r.go) ? h('span', { class: 'hint' + (r.go ? ' val' : '') }, r.hint) : null, r.checked !== undefined ? h('span', { class: 'chk panel-check', 'aria-hidden': 'true' }, r.checked ? '✓' : '') : null, sw, seg, r.go ? h('span', { class: 'sub-arrow' }, '›') : null);
            if (r.reorder) {
                reorderRow(btn, r.reorder);
                btn.classList.add('reorderable');
            }
            group().appendChild(btn);
        }
        body.appendChild(list);
        box.appendChild(body);
        list.scrollTop = keepScroll;
        const items = [...box.querySelectorAll('.pop-item')];
        if (focusIdx >= 0)
            items[focusIdx]?.focus({ preventScroll: true });
        else if (dir !== 0)
            (box.querySelector('.msearch input') ?? items[0])?.focus({ preventScroll: true });
        const pop = box.parentElement;
        // a wider page (filters) or a longer one: the panel moves back into the window
        keepPlace(pop);
    };
    box.addEventListener('keydown', (e) => {
        const items = [...box.querySelectorAll('.pop-item')];
        const i = items.indexOf(document.activeElement);
        const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if (e.key === 'ArrowDown' && !(e.target instanceof HTMLTextAreaElement)) {
            items[Math.min(items.length - 1, i + 1)]?.focus();
            e.preventDefault();
        }
        else if (e.key === 'ArrowUp' && !(e.target instanceof HTMLTextAreaElement)) {
            items[Math.max(0, i - 1)]?.focus();
            e.preventDefault();
        }
        else if (e.key === 'ArrowRight' && document.activeElement?.classList.contains('has-sub')) {
            document.activeElement.click();
            e.preventDefault();
        }
        else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && pages.length > 1 && !typing) {
            e.preventDefault();
            e.stopPropagation();
            nav.back();
        }
    });
    render(0);
    close = openPop(anchor, box, () => { closed = true; });
    box.parentElement?.classList.add('pop-menu', 'pop-panel');
    keepPlace(box.parentElement);
    {
        const pop = box.parentElement;
        if (pop?.dataset.bottom) {
            pop.style.top = `${Math.max(8, Number(pop.dataset.bottom) - pop.offsetHeight)}px`;
            pop.dataset.bottom = String(parseFloat(pop.style.top) + pop.offsetHeight);
        }
    }
    {
        const pop = box.parentElement;
        if (pop?.dataset.bottom) {
            const ro = new ResizeObserver(() => { if (!pop.isConnected) {
                ro.disconnect();
                return;
            } keepPlace(pop); });
            ro.observe(pop);
        }
    }
    (box.querySelector('.msearch input') ?? box.querySelector('.pop-item'))?.focus({ preventScroll: true });
    return { refresh: () => render(0), close: () => close(), go: (p) => nav.go(p) };
}
const svgPath = (d) => { const ns = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.4'); s.setAttribute('stroke-linecap', 'round'); const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.appendChild(p); return s; };
export const svgClose = () => svgPath('M4.5 4.5l7 7M11.5 4.5l-7 7');
// ---------- search fields: an ✕ at the end clears them ----------
const SEARCH_FIELD = 'input.pop-input, input.palette-input, input.vsearch, input[type="search"]';
const isSearch = (el) => el instanceof HTMLInputElement && el.matches(SEARCH_FIELD) && /search/i.test(el.placeholder) && !el.closest('.clearable') && !el.classList.contains('set-search');
/** wraps a search field so a small ✕ shows at its end while it has text; a click empties it (as if typed) */
function makeClearable(input) {
    if (!input.isConnected)
        return;
    const cs = getComputedStyle(input);
    const inline = cs.display.startsWith('inline') || input.classList.contains('vsearch');
    const wrap = h('span', { class: 'clearable' + (inline ? ' inline' : '') });
    wrap.style.margin = cs.margin;
    if (cs.flexGrow !== '0')
        wrap.style.flex = cs.flex;
    input.style.margin = '0';
    const btn = h('button', { class: 'clear-x', type: 'button', tabindex: '-1', 'aria-label': 'Clear', title: 'Clear' });
    btn.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    // moving a field takes its focus away: give it back, caret where it was
    const focused = document.activeElement === input;
    const [a, b] = [input.selectionStart, input.selectionEnd];
    input.replaceWith(wrap);
    wrap.append(input, btn);
    if (focused) {
        input.focus({ preventScroll: true });
        try {
            input.setSelectionRange(a, b);
        }
        catch { /* not a text field */ }
    }
    const sync = () => wrap.classList.toggle('has-text', !!input.value);
    for (const ev of ['input', 'change', 'keyup', 'focus'])
        input.addEventListener(ev, sync);
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // the field keeps the focus
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sync();
        input.focus();
    });
    sync();
}
let clearInstalled = false;
/** once at start: every search field in the app (menus, palette, views, dialogs) gets the ✕ */
export function installClearButtons() {
    if (clearInstalled)
        return;
    clearInstalled = true;
    const scan = (root) => { root.querySelectorAll(SEARCH_FIELD).forEach((el) => { if (isSearch(el) && el.isConnected)
        makeClearable(el); }); };
    new MutationObserver((records) => {
        for (const r of records)
            for (const n of r.addedNodes) {
                if (n instanceof HTMLInputElement) {
                    if (isSearch(n) && n.isConnected)
                        makeClearable(n);
                }
                else if (n instanceof Element)
                    scan(n);
            }
    }).observe(document.body, { childList: true, subtree: true });
    scan(document);
}
/** a hint that is only a keyboard shortcut says nothing on a phone */
export function keysOnly(hint) {
    return document.documentElement.classList.contains('phone') && /^(Ctrl|Cmd|Alt|Shift|Esc|Del|Enter|Tab|F\d+)([+ ]|$)|^[⌘⌥⇧⌃↵⌫⎋]/.test(hint.trim());
}
/** things a phone cannot use: no window to size, no second tab, no side-by-side columns */
const NOT_ON_PHONE = new Set(['Page width…', 'Open in new tab', 'Open in new window', 'Put in columns', '2 columns', '3 columns', 'Add column', 'Width']);
function forPhone(entries) {
    if (!document.documentElement.classList.contains('phone'))
        return entries;
    const kept = entries.filter((e) => !(typeof e === 'object' && 'label' in e && NOT_ON_PHONE.has(e.label)));
    // no separator first, last or twice in a row
    return kept.filter((e, i) => e !== 'sep' || (i > 0 && i < kept.length - 1 && kept[i - 1] !== 'sep'));
}
/** a reorderable menu row: dragged like the property lists (grip on the left, a line where it lands) */
function dragHandle(_r) {
    return h('span', { class: 'prop-grip mdrag', title: 'Drag to reorder', 'aria-hidden': 'true' }, svgIcon(ICONS.grip, 14, { fill: true }));
}
const MROW = 'text/x-nook-mrow';
const rowR = new WeakMap();
function reorderRow(row, r) {
    row.draggable = true;
    row.dataset.rk = r.key;
    rowR.set(row, r);
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData(MROW, `${r.key}\n${r.index}`); e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => { if (!e.dataTransfer?.types.includes(MROW))
        return; e.preventDefault(); const b = row.getBoundingClientRect(); const after = e.clientY >= b.top + b.height / 2; row.classList.toggle('drop-before', !after); row.classList.toggle('drop-after', after); });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
        const [key, i] = (e.dataTransfer?.getData(MROW) ?? '').split('\n');
        const after = row.classList.contains('drop-after');
        row.classList.remove('drop-before', 'drop-after');
        if (key !== r.key)
            return;
        e.preventDefault();
        e.stopPropagation();
        const from = Number(i);
        let to = r.index + (after ? 1 : 0);
        if (from < to)
            to--;
        if (from === to)
            return;
        r.move(from, to);
        // move the row in the open menu too, so more drags follow the new order
        const rows = [...row.parentElement.querySelectorAll(`.pop-item[data-rk="${CSS.escape(key)}"]`)];
        const moved = rows.find((x) => rowR.get(x)?.index === from);
        if (moved) {
            if (after)
                row.after(moved);
            else
                row.before(moved);
        }
        [...row.parentElement.querySelectorAll(`.pop-item[data-rk="${CSS.escape(key)}"]`)].forEach((x, k) => { const rr = rowR.get(x); if (rr)
            rr.index = k; });
    });
}
/** a menu's entries as rows of a panel page (sub-menus become pages with ‹ back) */
export function menuToPanel(entries) {
    return entries.map((e) => {
        if (e === 'sep' || 'section' in e)
            return e;
        if ('el' in e)
            return { el: e.el };
        const icon = typeof e.icon === 'string' ? undefined : e.icon;
        if (e.sub) {
            const sub = e.sub;
            return { label: e.label, icon, hint: e.hint, reorder: e.reorder, go: () => ({ title: e.label, rows: () => menuToPanel(sub()) }) };
        }
        if (e.toggle !== undefined)
            return { label: e.label, icon, hint: e.hint, toggle: e.toggle, onToggle: () => { e.toggle = !e.toggle; e.onToggle?.(e.toggle); } };
        if (e.seg)
            return { label: e.label, icon, seg: e.seg };
        // "✓ name" lists of the menus: a checked row
        const m = e.label.match(/^(✓|\s{3}) (.*)$/);
        if (m)
            return { label: m[2], icon, hint: e.hint, checked: m[1] === '✓', pick: () => e.run?.(), back: true };
        return { label: e.label, icon, hint: e.hint, danger: e.danger, reorder: e.reorder, pick: () => e.run?.(), back: e.danger ? true : undefined };
    });
}
/** phone: a settings form's Cancel and main button move up into its header (as in iOS sheets) */
function phoneFormHead(box) {
    if (!box.matches('.bwindow'))
        return;
    const head = box.querySelector(':scope > .dialog-head');
    if (!head || head.matches('.sheet-head'))
        return;
    const foot = box.querySelector(':scope > .bfooter');
    const btns = foot ? [...foot.querySelectorAll(':scope > button')] : [];
    if (btns.length !== 2 || !btns[0].matches('.set-btn') || !btns[1].matches('.btn-new')) {
        // only looking (history, conflicts …): a Done button where the close button was
        const x = head.querySelector('.icon-btn[aria-label="Close"]');
        if (!x)
            return;
        // a choice window (Compressed / Original): tapping an option is the answer, no Done
        if (box.matches('.cmp-window')) {
            x.hidden = true;
            return;
        }
        head.classList.add('form-head');
        head.querySelectorAll(':scope > :not(strong)').forEach((el) => { if (el !== x)
            el.hidden = true; });
        head.prepend(h('span'));
        head.append(h('button', { class: 'set-btn head-done', onclick: () => x.click() }, 'Done'));
        return;
    }
    if (/^Add\b/.test(btns[1].textContent ?? ''))
        btns[1].textContent = 'Add';
    if (/^Continue/.test(btns[1].textContent ?? ''))
        btns[1].textContent = 'Next';
    head.classList.add('form-head');
    head.prepend(btns[0]);
    head.append(btns[1]);
    if (!foot.children.length)
        foot.hidden = true;
}
/** filter fields take the focus on desktop, and on the phone when the keyboard is already up (typing "/") */
function kbFocusOk() {
    const r = document.documentElement, a = document.activeElement;
    return !r.classList.contains('phone') || r.classList.contains('kb-open') || !!a?.isContentEditable || a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
}
//# sourceMappingURL=pop.js.map