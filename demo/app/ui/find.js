// Find on this page: a small bar that marks every match in the open page (or entry) and steps
// through them. The matches are painted with the browser's highlight feature – the page itself is
// not changed, so typing, saving and undo are untouched.
import { h, svgIcon, ICONS } from '../util.js';
import { iconSvg } from './icons.js';
const registry = () => (typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null);
const HighlightCtor = () => globalThis.Highlight ?? null;
let bar = null;
export function closeFind() {
    bar?.remove();
    bar = null;
    registry()?.delete('nook-find');
    registry()?.delete('nook-find-current');
}
/** the scope to search: the open entry / dialog if there is one, else the page */
const scope = () => [...document.querySelectorAll('.overlay .dialog')].pop() ?? document.querySelector('.main > .scroll');
export function openFind() {
    if (bar) {
        bar.querySelector('input')?.focus();
        return;
    }
    const reg = registry(), Hl = HighlightCtor();
    const input = h('input', { class: 'find-input', type: 'search', placeholder: 'Find on this page', 'aria-label': 'Find on this page', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const count = h('span', { class: 'find-count' }, '');
    let ranges = [], at = -1;
    const show = () => {
        count.textContent = ranges.length ? `${at + 1} / ${ranges.length}` : input.value ? 'No match' : '';
        if (!reg || !Hl)
            return;
        reg.delete('nook-find');
        reg.delete('nook-find-current');
        if (!ranges.length)
            return;
        reg.set('nook-find', new Hl(...ranges));
        if (at >= 0)
            reg.set('nook-find-current', new Hl(ranges[at]));
    };
    const go = (step) => {
        if (!ranges.length)
            return;
        at = (at + step + ranges.length) % ranges.length;
        const r = ranges[at];
        // a match inside a closed toggle: nothing to scroll to
        const el = r.startContainer.parentElement;
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        show();
    };
    const search = () => {
        ranges = [];
        at = -1;
        const q = input.value.toLowerCase();
        const root = scope();
        if (q && root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
                    const p = n.parentElement;
                    return !p || p.closest('.find-bar, script, style, .pop, [hidden]') || !p.getClientRects().length ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
                } });
            for (let n = walker.nextNode(); n && ranges.length < 2000; n = walker.nextNode()) {
                const text = (n.textContent ?? '').toLowerCase();
                for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
                    const r = document.createRange();
                    r.setStart(n, i);
                    r.setEnd(n, i + q.length);
                    ranges.push(r);
                }
            }
        }
        if (ranges.length)
            go(1);
        else
            show();
    };
    input.addEventListener('input', search);
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            closeFind();
        }
    });
    bar = h('div', { class: 'find-bar', role: 'search' }, iconSvg('search', 15), input, count, h('button', { class: 'icon-btn', 'aria-label': 'Previous match', title: 'Previous (Shift+Enter)', onclick: () => go(-1) }, (() => { const u = svgIcon(ICONS.chevron, 15); u.style.transform = 'rotate(180deg)'; return u; })()), h('button', { class: 'icon-btn', 'aria-label': 'Next match', title: 'Next (Enter)', onclick: () => go(1) }, svgIcon(ICONS.chevron, 15)), h('button', { class: 'icon-btn', 'aria-label': 'Close', title: 'Close (Esc)', onclick: closeFind }, svgIcon(ICONS.close, 14)));
    document.body.appendChild(bar);
    // a real tap or shortcut opened it: the field may take the keyboard
    HTMLElement.prototype.focus.call(input);
}
//# sourceMappingURL=find.js.map