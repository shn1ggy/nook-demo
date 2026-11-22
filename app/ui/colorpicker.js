// Nook's own colour picker (instead of the system window): a field for saturation and brightness,
// a hue bar, a HEX field, the pipette where the browser has one, Nook's colours and "Original".
// Every change applies at once; a click outside or Esc closes it.
import { h, COLORS, builtinColor, tagOfColor } from '../util.js';
import { openPop } from './pop.js';
const pipette = () => { const n = 'http://www.w3.org/2000/svg'; const e = document.createElementNS(n, 'svg'); e.setAttribute('viewBox', '0 0 20 20'); e.setAttribute('width', '15'); e.setAttribute('height', '15'); e.innerHTML = '<path d="M13.5 3.5l3 3-2 2-3-3zM11.5 5.5l-7 7-1 4 4-1 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'; return e; };
const NOOK = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const hexRe = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
const norm = (t) => { const m = t.trim().match(hexRe); if (!m)
    return null; const x = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]; return `#${x.toLowerCase()}`; };
const toRgb = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
const toHex = (r) => '#' + r.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
function toHsv([r, g, b]) {
    r /= 255;
    g /= 255;
    b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hue = 0;
    if (d) {
        hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        hue *= 60;
        if (hue < 0)
            hue += 360;
    }
    return [hue, mx ? d / mx : 0, mx];
}
const fromHsv = (hh, s, v) => { const f = (n) => { const k = (n + hh / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return toHex([f(5), f(3), f(1)].map((x) => x * 255)); };
/** opens the picker at an element */
export function openColorPicker(anchor, o) {
    let [hu, s, v] = toHsv(toRgb(norm(o.value) ?? '#888888'));
    const knob = () => h('span', { class: 'ncp-knob' });
    const svk = knob(), huk = knob();
    const sv = h('div', { class: 'ncp-sv' }, svk);
    const hue = h('div', { class: 'ncp-hue' }, huk);
    const cur = h('span', { class: 'ncp-cur' });
    const inp = h('input', { class: 'ncp-hexin', maxlength: '7', spellcheck: 'false', 'aria-label': 'HEX color' });
    const hexBox = h('label', { class: 'ncp-hex' }, h('span', null, '#'), inp);
    const swc = (c) => o.tagSwatches ? tagOfColor(builtinColor(c).text) : COLORS[c].text;
    const swatches = NOOK.map((c) => h('button', { type: 'button', class: 'ncp-sw', title: c[0].toUpperCase() + c.slice(1), 'data-c': swc(c), style: { background: swc(c) } }));
    const Eye = window.EyeDropper;
    const paint = (fromHex = false, emit = true) => {
        const c = fromHsv(hu, s, v);
        sv.style.backgroundColor = `hsl(${hu} 100% 50%)`;
        svk.style.left = `${s * 100}%`;
        svk.style.top = `${(1 - v) * 100}%`;
        svk.style.background = c;
        huk.style.left = `${(hu / 360) * 100}%`;
        huk.style.background = `hsl(${hu} 100% 50%)`;
        cur.style.background = c;
        if (!fromHex)
            inp.value = c.slice(1).toUpperCase();
        hexBox.classList.remove('bad');
        for (const b of swatches)
            b.classList.toggle('on', (b.dataset.c ?? '').toLowerCase() === c);
        if (emit)
            o.onInput(c);
    };
    const set = (x) => { [hu, s, v] = toHsv(toRgb(x)); paint(); };
    const drag = (area, fn) => area.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        area.setPointerCapture(e.pointerId);
        const move = (ev) => { const b = area.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)), Math.max(0, Math.min(1, (ev.clientY - b.top) / b.height))); paint(); };
        move(e);
        area.onpointermove = move;
        area.onpointerup = () => { area.onpointermove = null; };
    });
    drag(sv, (x, y) => { s = x; v = 1 - y; });
    drag(hue, (x) => { hu = x * 360; });
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') {
        const n = norm(inp.value);
        if (n)
            set(n);
        else
            hexBox.classList.add('bad');
    } if (e.key === 'Escape')
        close(); });
    inp.addEventListener('input', () => { const n = norm(inp.value); if (n) {
        [hu, s, v] = toHsv(toRgb(n));
        paint(true);
    }
    else
        hexBox.classList.toggle('bad', inp.value.replace('#', '').length >= 6); });
    for (const b of swatches)
        b.addEventListener('click', () => set((b.dataset.c ?? '').toLowerCase()));
    const box = h('div', { class: 'ncp' }, sv, hue, o.preview ? h('div', { class: 'ncp-preview' }, h('div', { class: 'ncp-cap' }, 'How it looks'), o.preview()) : null, h('div', { class: 'ncp-line' }, cur, hexBox, Eye ? h('button', { type: 'button', class: 'ncp-eye', title: 'Pick from the screen', 'aria-label': 'Pick from the screen', onclick: async () => { try {
            const r = await new Eye().open();
            set(r.sRGBHex.toLowerCase());
        }
        catch { /* cancelled */ } } }, pipette()) : null), h('div', null, h('div', { class: 'ncp-cap' }, 'Nook colors'), h('div', { class: 'ncp-sws' }, swatches)), 
    // changes apply at once: Done only closes; Original sits on the left, away from it
    h('div', { class: 'ncp-foot' }, o.original ? h('button', { type: 'button', class: 'set-btn', title: 'Back to this color’s default', onclick: () => set(norm(o.original) ?? '#888888') }, 'Original') : h('span'), h('button', { type: 'button', class: 'set-btn primary', onclick: () => close() }, 'Done')));
    const close = openPop(anchor, box, () => o.onDone?.());
    paint(false, false);
}
/** a "Change color" button with the colour in it; opens the picker */
export function colorButton(o) {
    const dot = h('span', { class: 'ncp-dot', style: { background: o.value } });
    if (o.dot === false)
        dot.hidden = true;
    const b = h('button', { type: 'button', class: 'set-btn ncp-btn', 'aria-label': o.label ? `Change ${o.label}` : 'Change color', onclick: (e) => {
            e.stopPropagation();
            openColorPicker(b, { ...o, onInput: (c) => { dot.style.background = c; b.closest('.set-row')?.querySelector('.set-ico-swatch')?.style.setProperty('background', c); o.onInput(c); } });
        } }, dot, o.text ?? 'Change color');
    return b;
}
//# sourceMappingURL=colorpicker.js.map