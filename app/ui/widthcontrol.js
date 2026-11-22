import { h } from '../util.js';
import { selectControl } from './settings.js';
import { menuIcon } from './pop.js';
// Page width on a computer – the same choices and names in Settings → Appearance and in every page's
// and database's ⋯ menu: Normal, Wide, Full, or an own width (field and slider).
export const WIDTH_CHOICES = [['Normal', 960], ['Wide', 1280], ['Full', 'full']];
const MIN = 480, MAX = 2400;
export const widthName = (w, unset = 'Auto') => w === undefined ? unset : WIDTH_CHOICES.find(([, v]) => v === w)?.[0] ?? `${w} px`;
const isChoice = (w) => WIDTH_CHOICES.some(([, v]) => v === w);
/** an own width: a px field and a slider that stay in step; changes apply as you go */
function ownWidth(cur, set) {
    const num = h('input', { class: 'rule-input wd-num', type: 'number', min: MIN, max: MAX, step: 10, value: String(cur), 'aria-label': 'Width in px' });
    const range = h('input', { class: 'wd-range', type: 'range', min: MIN, max: MAX, step: 10, value: String(cur), 'aria-label': 'Width' });
    const apply = (v) => { const n = Math.max(MIN, Math.min(MAX, Math.round(v / 10) * 10)); num.value = range.value = String(n); set(n); };
    range.addEventListener('input', () => apply(Number(range.value)));
    num.addEventListener('change', () => { if (num.value)
        apply(Number(num.value)); });
    num.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter')
        apply(Number(num.value)); });
    return h('div', { class: 'wd-own' }, h('div', { class: 'wd-line' }, num, h('span', { class: 'muted' }, 'px')), range);
}
/** Settings → Appearance → Page width: a dropdown, and the own width below it when chosen */
export function widthControl(current, change) {
    const own = ownWidth(typeof current === 'number' && !isChoice(current) ? current : 1100, change);
    own.hidden = isChoice(current);
    const dd = selectControl([...WIDTH_CHOICES.map(([l, v]) => [String(v), l]), ['own', 'Own width']], isChoice(current) ? String(current) : 'own', (v) => {
        own.hidden = v !== 'own';
        if (v === 'own')
            own.querySelector('input').dispatchEvent(new Event('change'));
        else
            change(v === 'full' ? 'full' : Number(v));
    }, 'Page width');
    return h('div', { class: 'width-control' }, dd, own);
}
/** "Width" in a page's or database's ⋯ menu: Auto (the workspace's) and the choices, then an own width */
export function widthEntry(cur, set) {
    return { label: 'Width', icon: menuIcon('columns'), hint: widthName(cur), sub: () => [
            ...[['Auto', undefined], ...WIDTH_CHOICES].map(([l, v]) => ({ label: `${cur === v ? '✓' : '   '} ${l}`, run: () => set(v) })),
            { section: 'Own width' },
            { el: ownWidth(typeof cur === 'number' && !isChoice(cur) ? cur : 1100, set) },
        ] };
}
//# sourceMappingURL=widthcontrol.js.map