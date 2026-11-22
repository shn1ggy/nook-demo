// Floating format bar for selected text (as in Notion): block type, alignment, bold,
// italic, underline, strikethrough, code, link, text colour / highlight.
import { h, COLORS, BLOCK_BG, colorLabel, unwrapEl } from '../util.js';
import { iconSvg } from './icons.js';
import { menu, prompt, closePop } from './pop.js';
import { isMac } from './commands.js';
const hosts = new WeakMap();
export function registerFormatHost(root, host) { hosts.set(root, host); }
let bar = null;
let saved = null;
let current = null;
let holding = false; // a bar menu is open: keep the bar while focus is elsewhere
const mod = isMac ? '⌘' : 'Ctrl+';
function editableFor(node) {
    const el = (node instanceof HTMLElement ? node : node?.parentElement)?.closest('.txt[contenteditable="true"]');
    if (!el || el.closest('pre'))
        return null; // code blocks stay plain
    return el;
}
function hostFor(el) {
    for (let n = el; n; n = n.parentElement) {
        const hst = hosts.get(n);
        if (hst)
            return hst;
    }
    return undefined;
}
function hideFormatBar() { bar?.remove(); bar = null; current = null; }
function restore() {
    if (!saved || !current)
        return;
    current.el.focus({ preventScroll: true });
    const s = getSelection();
    s?.removeAllRanges();
    s?.addRange(saved);
}
function afterEdit() {
    if (!current)
        return;
    current.host.sync(current.b, current.el);
    const s = getSelection();
    if (s && s.rangeCount)
        saved = s.getRangeAt(0).cloneRange();
    show();
}
function exec(cmd, value) { restore(); document.execCommand(cmd, false, value); afterEdit(); }
function closestIn(tag) {
    const s = getSelection();
    if (!s || !s.rangeCount || !current)
        return null;
    const n = s.getRangeAt(0).commonAncestorContainer;
    const el = (n instanceof HTMLElement ? n : n.parentElement)?.closest(tag);
    return el && current.el.contains(el) ? el : null;
}
/** wrap the selection in a new element, removing the same kind of wrapper inside it */
function wrapSelection(make, clean) {
    restore();
    const s = getSelection();
    if (!s || !s.rangeCount)
        return;
    const r = s.getRangeAt(0);
    const frag = r.extractContents();
    frag.querySelectorAll(clean).forEach(unwrapEl);
    const w = make();
    w.appendChild(frag);
    r.insertNode(w);
    const nr = document.createRange();
    nr.selectNodeContents(w);
    s.removeAllRanges();
    s.addRange(nr);
    afterEdit();
}
/** put a comment on the selected text */
function addComment() {
    if (!current?.host.comment)
        return;
    const { host, b, el } = current;
    const s0 = getSelection();
    if (!saved || saved.collapsed)
        return;
    const mark = document.createElement('mark');
    mark.className = 'cmt';
    mark.dataset.comment = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    wrapSelection(() => mark, 'mark[data-comment]');
    hideFormatBar();
    s0?.removeAllRanges();
    if (mark.isConnected)
        host.comment?.(mark, b, el);
}
function toggleCode() {
    const inCode = closestIn('code');
    if (inCode) {
        restore();
        unwrapEl(inCode);
        afterEdit();
        return;
    }
    wrapSelection(() => document.createElement('code'), 'code,b,i,u,s,strike');
}
const TEXT_SEL = 'span[data-color]:not([data-color$="_bg"])', BG_SEL = 'span[data-color$="_bg"]';
/** a colour, or null to go back to the default (only for that kind: text colour or background) */
function setColor(c, kind = 'text') {
    if (c) {
        const isBg = c.endsWith('_bg');
        wrapSelection(() => { const sp = document.createElement('span'); sp.dataset.color = c; return sp; }, isBg ? BG_SEL : TEXT_SEL);
        return;
    }
    removeColor(kind === 'bg' ? BG_SEL : TEXT_SEL);
}
/** takes one kind of colour off the selected text; a coloured span around it is split, so text outside the selection keeps its colour */
function removeColor(selector) {
    restore();
    const s = getSelection();
    if (!s || !s.rangeCount || !current)
        return;
    const r = s.getRangeAt(0);
    const host = current.el;
    const outer = (() => { let n = r.commonAncestorContainer; let found = null; for (; n && n !== host; n = n.parentNode)
        if (n instanceof HTMLElement && n.matches(selector))
            found = n; return found; })();
    let frag;
    let first, last;
    if (outer) {
        // split the coloured span: [outer: before] [selection, without this colour] [copy of outer: after].
        // Cutting to the span's end keeps the other formatting (e.g. a text colour) on each part.
        const tail = document.createRange();
        tail.setStart(r.endContainer, r.endOffset);
        tail.setEnd(outer, outer.childNodes.length);
        const twin = outer.cloneNode(false);
        twin.appendChild(tail.extractContents());
        const mid = document.createRange();
        mid.setStart(r.startContainer, r.startOffset);
        mid.setEnd(outer, outer.childNodes.length);
        frag = mid.extractContents();
        frag.querySelectorAll(selector).forEach(unwrapEl);
        outer.after(twin);
        first = frag.firstChild;
        last = frag.lastChild;
        outer.after(frag);
    }
    else {
        frag = r.extractContents();
        frag.querySelectorAll(selector).forEach(unwrapEl);
        first = frag.firstChild;
        last = frag.lastChild;
        r.insertNode(frag);
    }
    // parts left without text (e.g. when the whole span was selected) go away
    host.querySelectorAll('span[data-color]').forEach((x) => { if (!x.textContent)
        x.remove(); });
    // neighbours with the same colour become one span again
    host.querySelectorAll('span[data-color]').forEach((x) => {
        for (let n = x.nextSibling; x.isConnected && n instanceof HTMLElement && n.matches('span[data-color]') && n.dataset.color === x.dataset.color; n = x.nextSibling) {
            x.append(...n.childNodes);
            n.remove();
        }
    });
    if (first && last && first.isConnected && last.isConnected) {
        const nr = document.createRange();
        nr.setStartBefore(first);
        nr.setEndAfter(last);
        s.removeAllRanges();
        s.addRange(nr);
    }
    host.querySelectorAll('span:not([data-color])').forEach((x) => unwrapEl(x));
    afterEdit();
}
function linkPrompt(anchor) {
    const a = closestIn('a');
    holding = true;
    prompt(anchor, a ? 'Link (empty removes it)' : 'Link URL', a?.getAttribute('href') ?? 'https://', (v) => {
        holding = false;
        restore();
        const url = v.trim();
        if (a) {
            if (url)
                a.setAttribute('href', url);
            else
                unwrapEl(a);
            afterEdit();
            return;
        }
        if (url && url !== 'https://')
            document.execCommand('createLink', false, /^[a-z]+:/i.test(url) || url.startsWith('#') ? url : `https://${url}`);
        afterEdit();
    });
}
function blockLabel(b, opts) {
    return opts.find((t) => t.type === b.type && (t.level ?? 0) === (b.level ?? 0))?.label ?? 'Text';
}
function show() {
    const s = getSelection();
    if (!current || !s || !s.rangeCount)
        return;
    const rect = s.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height)
        return;
    const { b, host } = current;
    const q = (c) => { try {
        return document.queryCommandState(c);
    }
    catch {
        return false;
    } };
    const btn = (icon, label, on, run) => h('button', { class: 'fb-btn' + (on ? ' on' : ''), title: label, 'aria-label': label, onclick: (e) => run(e) }, icon);
    const letter = (t, style) => h('span', { class: 'fb-letter', style }, t);
    const sel = () => { const r = getSelection(); if (r && r.rangeCount)
        saved = r.getRangeAt(0).cloneRange(); };
    const el = h('div', { class: 'formatbar', role: 'toolbar', 'aria-label': 'Text formatting' }, host.turnOptions.length ? btn(h('span', { class: 'fb-type' }, blockLabel(b, host.turnOptions), iconSvg('arrow-down', 12)), 'Turn into', false, (e) => {
        sel();
        holding = true;
        menu(e.currentTarget, host.turnOptions.map((t) => ({ label: `${t.type === b.type && (t.level ?? 0) === (b.level ?? 0) ? '✓' : '   '} ${t.label}`, run: () => { holding = false; hideFormatBar(); host.turnInto(b, t); } })));
    }) : null, host.turnOptions.length ? h('span', { class: 'fb-sep' }) : null, btn(iconSvg(b.align === 'center' ? 'align-center' : b.align === 'right' ? 'align-right' : 'align-left', 16), 'Align', !!b.align, (e) => {
        sel();
        holding = true;
        const set = (a) => () => { holding = false; hideFormatBar(); host.setAlign(b, a); };
        menu(e.currentTarget, [
            { label: `${!b.align ? '✓' : '   '} Left`, icon: iconSvg('align-left', 16), run: set(undefined) },
            { label: `${b.align === 'center' ? '✓' : '   '} Center`, icon: iconSvg('align-center', 16), run: set('center') },
            { label: `${b.align === 'right' ? '✓' : '   '} Right`, icon: iconSvg('align-right', 16), run: set('right') },
        ]);
    }), h('span', { class: 'fb-sep' }), btn(letter('B', { fontWeight: '700' }), `Bold (${mod}B)`, q('bold'), () => exec('bold')), btn(letter('i', { fontStyle: 'italic', fontFamily: 'Georgia, serif' }), `Italic (${mod}I)`, q('italic'), () => exec('italic')), btn(letter('U', { textDecoration: 'underline' }), `Underline (${mod}U)`, q('underline'), () => exec('underline')), btn(letter('S', { textDecoration: 'line-through' }), `Strikethrough (${mod}⇧S)`, q('strikeThrough'), () => exec('strikeThrough')), btn(iconSvg('code', 16), `Code (${mod}E)`, !!closestIn('code'), () => toggleCode()), btn(iconSvg('link', 16), `Link (${mod}K)`, !!closestIn('a'), (e) => { sel(); linkPrompt(e.currentTarget); }), h('span', { class: 'fb-sep' }), btn(h('span', { class: 'fb-color' }, 'A'), 'Color', !!closestIn('span[data-color]'), (e) => { sel(); holding = true; colorMenu(e.currentTarget); }), host.comment ? h('span', { class: 'fb-sep' }) : null, host.comment ? btn(h('span', { class: 'fb-type' }, iconSvg('message', 15), 'Comment'), `Comment (${mod}${isMac ? '⌥' : 'Alt+'}M)`, false, () => { sel(); addComment(); }) : null);
    el.addEventListener('mousedown', (e) => { e.preventDefault(); }); // keep the text selection
    bar?.remove();
    bar = el;
    document.body.appendChild(el);
    const w = el.offsetWidth, hh = el.offsetHeight;
    let x = rect.left + rect.width / 2 - w / 2;
    x = Math.max(8, Math.min(innerWidth - w - 8, x));
    let y = rect.top - hh - 8;
    if (y < 8)
        y = rect.bottom + 8;
    if (document.documentElement.classList.contains('phone')) {
        // the system's own Copy / Paste menu sits above a selection: this one goes below it, clear of the handles,
        // and never under the keyboard
        const vv = window.visualViewport;
        const bottom = vv ? vv.offsetTop + vv.height : innerHeight;
        y = rect.bottom + 26;
        if (y + hh > bottom - 6)
            y = Math.max(8, Math.min(rect.top - hh - 58, bottom - hh - 6));
        x = 8;
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
}
function colorMenu(anchor) {
    const done = (c, kind = 'text') => () => { holding = false; setColor(c, kind); };
    const entries = [
        { section: 'Text color' },
        ...Object.keys(COLORS).map((c) => ({ label: c === 'default' ? 'Default text' : colorLabel(c),
            icon: h('span', { class: 'swatch', style: { background: 'transparent', color: COLORS[c].text, textAlign: 'center', lineHeight: '18px', fontWeight: '600' } }, 'A'),
            run: done(c === 'default' ? null : c) })),
        { section: 'Background' },
        { label: 'Default background', icon: h('span', { class: 'swatch swatch-none' }), run: done(null, 'bg') },
        ...Object.keys(BLOCK_BG).filter((c) => c !== 'default').map((c) => ({ label: `${colorLabel(c)} background`,
            icon: h('span', { class: 'swatch', style: { background: BLOCK_BG[c] } }), run: done(`${c}_bg`) })),
    ];
    menu(anchor, entries);
}
/** Keyboard shortcuts inside text; returns true when handled. */
export function formatKey(e) {
    const m = e.metaKey || e.ctrlKey;
    if (!m)
        return false;
    const el = editableFor(e.target);
    if (!el)
        return false;
    const host = hostFor(el);
    const b = host?.blockOf(el);
    if (!host || !b)
        return false;
    const k = e.key.toLowerCase();
    const sel = getSelection();
    const has = !!sel && !sel.isCollapsed;
    current = { el, b, host };
    if (sel && sel.rangeCount)
        saved = sel.getRangeAt(0).cloneRange();
    if (k === 'b' && !e.shiftKey) {
        e.preventDefault();
        exec('bold');
        return true;
    }
    if (k === 'i' && !e.shiftKey) {
        e.preventDefault();
        exec('italic');
        return true;
    }
    if (k === 'u' && !e.shiftKey) {
        e.preventDefault();
        exec('underline');
        return true;
    }
    if (k === 's' && e.shiftKey) {
        e.preventDefault();
        exec('strikeThrough');
        return true;
    }
    if (k === 'e' && has) {
        e.preventDefault();
        toggleCode();
        return true;
    }
    if ((k === 'm' || e.code === 'KeyM') && e.altKey && has && host.comment) {
        e.preventDefault();
        e.stopPropagation();
        addComment();
        return true;
    }
    if (k === 'k' && has && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        linkPrompt(bar ?? el);
        return true;
    }
    return false;
}
let installed = false;
export function installFormatBar() {
    if (installed)
        return;
    installed = true;
    document.addEventListener('selectionchange', () => {
        if (holding)
            return;
        const s = getSelection();
        if (!s || s.isCollapsed || !s.rangeCount) {
            if (!document.querySelector('.pop:not(.pop-closing)'))
                hideFormatBar();
            return;
        }
        const el = editableFor(s.anchorNode);
        if (!el || !el.contains(s.focusNode)) {
            hideFormatBar();
            return;
        }
        const host = hostFor(el);
        const b = host?.blockOf(el);
        if (!host || !b) {
            hideFormatBar();
            return;
        }
        current = { el, b, host };
        saved = s.getRangeAt(0).cloneRange();
        clearTimeout(timer);
        // wait for the mouse to settle so the bar doesn't flicker while dragging a selection
        timer = setTimeout(() => { if (!mouseDown)
            show(); }, 60);
    });
    document.addEventListener('mousedown', (e) => { mouseDown = true; if (bar && !bar.contains(e.target) && !e.target.closest('.pop')) {
        holding = false;
        hideFormatBar();
    } }, true);
    document.addEventListener('mouseup', () => { mouseDown = false; setTimeout(() => { const s = getSelection(); if (current && s && !s.isCollapsed && !holding)
        show(); }, 0); }, true);
    window.addEventListener('scroll', (e) => { if (bar && !holding && !(e.target instanceof Node && bar.contains(e.target)))
        hideFormatBar(); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') {
        holding = false;
        if (bar && !document.querySelector('.pop:not(.pop-closing)'))
            hideFormatBar();
    } }, true);
    void closePop;
}
let timer;
let mouseDown = false;
//# sourceMappingURL=formatbar.js.map