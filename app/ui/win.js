// small builders for windows in the settings look: a card of rows, one row, a summary line
import { h } from '../util.js';
export const wrow = (title, control, desc, cls = '') => h('div', { class: 'set-row' + (cls ? ' ' + cls : '') }, h('div', { class: 'set-text' }, h('div', { class: 'set-title' }, title), desc ? h('div', { class: 'set-desc' }, desc) : null), control ? h('div', { class: 'set-control' }, control) : null);
export const wcard = (heading, ...rows) => h('section', { class: 'set-sec' }, heading ? h('div', { class: 'set-heading' }, h('h3', null, heading)) : null, h('div', { class: 'set-card' }, ...rows));
export const wsum = (text, ...right) => h('div', { class: 'win-sum' }, h('span', null, text), h('span', { class: 'win-sum-r' }, ...right));
//# sourceMappingURL=win.js.map