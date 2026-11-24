// ---------- ids ----------
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** ULID: sortable by creation time, unique across machines. */
export function ulid(time = Date.now()) {
    let t = time, ts = '';
    for (let i = 0; i < 10; i++) {
        ts = B32[t % 32] + ts;
        t = Math.floor(t / 32);
    }
    let rnd = '';
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < 16; i++)
        rnd += B32[bytes[i] % 32];
    return ts + rnd;
}
export function slug(s) {
    return s.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'untitled';
}
/** Tiny hyperscript: h('div', {class: 'x', onclick: fn}, 'text', child) */
export function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false)
                continue;
            if (k.startsWith('on') && typeof v === 'function')
                el.addEventListener(k.slice(2), v);
            else if (k === 'style' && typeof v === 'object') {
                for (const [sk, sv] of Object.entries(v)) {
                    if (sk.startsWith('--'))
                        el.style.setProperty(sk, sv);
                    else
                        el.style[sk] = sv;
                }
            }
            else if (k === 'class')
                el.className = String(v);
            else if (k === 'html')
                el.innerHTML = String(v);
            else if (k in el && typeof v !== 'string')
                el[k] = v;
            else
                el.setAttribute(k, v === true ? '' : String(v));
        }
    }
    append(el, children);
    return el;
}
function append(el, children) {
    for (const c of children) {
        if (c == null || c === false)
            continue;
        if (Array.isArray(c))
            append(el, c);
        else
            el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
}
export function svgIcon(path, size = 16, opts = {}) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 16 16');
    if (opts.fill) {
        svg.setAttribute('fill', 'currentColor');
        svg.setAttribute('stroke', 'none');
    }
    else {
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', String(opts.stroke ?? 1.4));
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
    }
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
    return svg;
}
const dot = (x, y) => `M${x - 1.1} ${y}a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0Z`;
export const ICONS = {
    menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
    sidebar: 'M2.5 3.5h11v9h-11zM6.5 3.5v9',
    folder: 'M2 4.5h4.5l1.5 1.5H14v6.5H2z',
    gear: 'M8 5.9a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2zM8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1',
    chevron: 'M5 6.5l3 3 3-3',
    chevronR: 'M6.5 5l3 3-3 3',
    chevronL: 'M9.5 5l-3 3 3 3',
    plus: 'M8 3.5v9M3.5 8h9',
    /** six dots, drawn filled */
    grip: [dot(5.8, 3.8), dot(10.2, 3.8), dot(5.8, 8), dot(10.2, 8), dot(5.8, 12.2), dot(10.2, 12.2)].join(''),
    /** filled triangle pointing right (toggle closed), rotate 90° for open */
    triangle: 'M5.5 4.2l5.2 3.8-5.2 3.8z',
    search: 'M7 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 10l3.5 3.5',
    page: 'M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12',
    table: 'M2 3h12v10H2zM2 6.5h12M6 6.5V13',
    close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
    filter: 'M2.5 4h11M4.5 8h7M6.5 12h3',
    sort: 'M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5',
    group: 'M2.5 3.5h11v3h-11zM2.5 9.5h11v3h-11z',
    more: [dot(3.5, 8), dot(8, 8), dot(12.5, 8)].join(''),
    check: 'M3.5 8.2l3 3 6-6.4',
    trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
    back: 'M9.5 4l-4 4 4 4',
    eye: 'M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z',
    eyeOff: 'M2.5 2.5l11 11M6.4 4a6 6 0 0 1 1.6-.3c3.9 0 6.2 4.3 6.2 4.3a11 11 0 0 1-1.7 2.2M10.6 11.8A6 6 0 0 1 8 12.3C4.1 12.3 1.8 8 1.8 8a11 11 0 0 1 2.4-2.9',
    expand: 'M9.5 2.5h4v4M13.5 2.5L9 7M6.5 13.5h-4v-4M2.5 13.5L7 9',
};
/** a segmented control: 2–5 choices side by side – the one design for settings, menus, panels and view bars.
 *  options: [value, label (text, or icon and text), tooltip?] · cls: 'small' (menus, bars), 'wide' (fills the row) */
export function segmented(options, value, change, label = '', cls = '') {
    const box = h('div', { class: 'seg' + (cls ? ' ' + cls : ''), role: 'radiogroup', 'aria-label': label || undefined });
    const draw = () => box.replaceChildren(...options.map(([v, l, tip]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '', title: tip,
        onclick: (e) => { e.stopPropagation(); if (v === value)
            return; value = v; draw(); change(v); } }, ...(Array.isArray(l) ? l : [l]))));
    draw();
    return box;
}
/** Notion-style checkbox (consistent across browsers). */
export function checkbox(checked, onToggle, label = 'Checkbox') {
    const el = h('span', { class: 'cb' + (checked ? ' on' : ''), role: 'checkbox', 'aria-checked': String(checked), 'aria-label': label, tabindex: onToggle ? 0 : -1 });
    el.appendChild(svgIcon(ICONS.check, 12, { stroke: 2 }));
    if (onToggle) {
        const flip = (e) => { e.stopPropagation(); e.preventDefault(); checked = !checked; el.classList.toggle('on', checked); el.classList.remove('cb-anim'); void el.offsetWidth; if (checked)
            el.classList.add('cb-anim'); el.setAttribute('aria-checked', String(checked)); onToggle(checked); };
        el.addEventListener('click', flip);
        el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter')
            flip(e); });
    }
    return el;
}
// ---------- colours (Notion dark palette) ----------
const DARK_COLORS = {
    default: { tag: '#373737', bg: 'transparent', text: 'rgba(255,255,255,0.81)' },
    gray: { tag: '#474747', bg: '#252525', text: '#6e6e6e' },
    brown: { tag: '#603b2c', bg: '#2c2420', text: '#83482f' },
    orange: { tag: '#854c1d', bg: '#36291f', text: '#e97d2f' },
    yellow: { tag: '#89632a', bg: '#35301f', text: '#d8a046' },
    green: { tag: '#2b593f', bg: '#1f2b23', text: '#4f9c51' },
    blue: { tag: '#28456c', bg: '#1e2a38', text: '#507abe' },
    purple: { tag: '#492f64', bg: '#2a2430', text: '#9d68d3' },
    pink: { tag: '#69314c', bg: '#33232b', text: '#d15796' },
    red: { tag: '#6e3630', bg: '#34221f', text: '#d34b3c' },
};
const DARK_BLOCK = {
    default: 'transparent', gray: '#2f2f2f', brown: '#3d2f28', orange: '#4d3220',
    yellow: '#4a3d22', green: '#233428', blue: '#1f2f40', purple: '#352a42',
    pink: '#40283a', red: '#4a2a27',
};
// Notion's light palette
const LIGHT_COLORS = {
    default: { tag: '#e3e2e0', bg: 'transparent', text: 'rgba(40,38,34,0.92)' },
    gray: { tag: '#e3e2e0', bg: '#f4f4f3', text: '#6e6e6e' },
    brown: { tag: '#eee0da', bg: '#f8f3f1', text: '#83482f' },
    orange: { tag: '#fadec9', bg: '#fcf2ea', text: '#e97d2f' },
    yellow: { tag: '#fdecc8', bg: '#fcf7e6', text: '#d8a046' },
    green: { tag: '#dbeddb', bg: '#f0f6f0', text: '#4f9c51' },
    blue: { tag: '#d3e5ef', bg: '#eef5f9', text: '#507abe' },
    purple: { tag: '#e8deee', bg: '#f6f2f9', text: '#9d68d3' },
    pink: { tag: '#f5e0e9', bg: '#fbf1f6', text: '#d15796' },
    red: { tag: '#ffe2dd', bg: '#fdf0ef', text: '#d34b3c' },
};
const LIGHT_BLOCK = {
    default: 'transparent', gray: '#f1f1ef', brown: '#f4eeee', orange: '#fbecdd',
    yellow: '#fbf3db', green: '#edf3ec', blue: '#e7f3f8', purple: '#f4f0f7',
    pink: '#f9eef3', red: '#fdebec',
};
let BASE_COLORS = DARK_COLORS;
let BASE_BLOCK = DARK_BLOCK;
let themeMode = 'dark';
/** dark or light palette for options, text colours and backgrounds (call applyColors afterwards) */
export function setPalette(mode) { themeMode = mode; BASE_COLORS = mode === 'light' ? LIGHT_COLORS : DARK_COLORS; BASE_BLOCK = mode === 'light' ? LIGHT_BLOCK : DARK_BLOCK; }
const colorTable = structuredClone(BASE_COLORS);
const blockTable = { ...BASE_BLOCK };
const colorNames = {};
/** colour name → tag (option chip), bg (row tint) and text colour. Unknown names fall back to default. */
export const COLORS = new Proxy(colorTable, { get: (t, k) => t[k] ?? t.default });
/** Callout / block background colours (stronger than row tints). */
export const BLOCK_BG = new Proxy(blockTable, { get: (t, k) => t[k] ?? 'transparent' });
/** the name shown for a colour ("Blue", or a custom colour's own name) */
export function colorLabel(c) { return c === 'default' ? 'Default' : colorNames[c] ?? c[0].toUpperCase() + c.slice(1); }
export const BUILTIN_COLORS = Object.keys(DARK_COLORS);
export function builtinColor(c) { return { text: BASE_COLORS[c]?.text ?? '#ffffff', bg: BASE_BLOCK[c] ?? '#2f2f2f' }; }
const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : null);
function mix(a, b, t) {
    const p = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return '#' + x.map((v, i) => Math.round(v * t + y[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
}
const stepTable = {};
/** How a colour's shades are made (from the Nook Color Lab): the share of the colour mixed into the page
 *  for each step, and in light mode extra saturation for the shades (never more than the colour itself). */
const SHADES = {
    dark: { strong: 0.46, soft: 0.19, faint: 0.112, sat: 0 },
    light: { strong: 0.50, soft: 0.25, faint: 0.28, sat: 1.5 },
};
function colorSteps(c, page, contrast = 0) {
    if (!hex(c))
        return { color: c, strong: c, soft: c, faint: c, icon: c };
    const m = SHADES[themeMode], k = 1 + contrast * 0.8;
    const [, sBase] = toHsl(c);
    const step = (t) => {
        const mixed = mix(c, page, Math.min(1, t * k));
        if (!m.sat)
            return mixed;
        const [hh, ss, ll] = toHsl(mixed);
        return fromHsl(hh, Math.min(sBase, ss * (1 + m.sat)), ll);
    };
    // the colour you pick is THE colour: text and icons use it as it is, nothing is more saturated
    return { color: c, strong: step(m.strong), soft: step(m.soft), faint: step(m.faint), icon: c };
}
let lastPage = '#191919', lastK = 0;
/** the tag step of a stored colour (what the picker shows) */
export function tagOfColor(c) { return hex(c) ? colorSteps(c, lastPage, lastK).strong : c; }
/** the steps of a colour name ('red', a custom colour's id, or 'accent') */
export function stepsOf(name) {
    if (name === 'accent') {
        const a = 'var(--accent)';
        return { color: a, strong: `color-mix(in srgb, ${a} 42%, var(--surface))`, soft: `color-mix(in srgb, ${a} 17%, var(--surface))`, faint: `color-mix(in srgb, ${a} 8%, var(--surface))`, icon: a };
    }
    return stepTable[name] ?? stepTable.gray ?? { color: '#9b9b9b', strong: '#474747', soft: '#2c2c2c', faint: '#222', icon: '#9b9b9b' };
}
/** puts a colour's four steps on an element as --tint, --tint-strong, --tint-soft, --tint-faint */
export function tintVars(el, name) {
    for (const v of ['--tint', '--tint-strong', '--tint-soft', '--tint-faint', '--tint-icon'])
        el.style.removeProperty(v);
    if (!name || name === 'default')
        return;
    const st = stepsOf(name);
    el.style.setProperty('--tint', st.color);
    el.style.setProperty('--tint-strong', st.strong);
    el.style.setProperty('--tint-soft', st.soft);
    el.style.setProperty('--tint-faint', st.faint);
    el.style.setProperty('--tint-icon', st.icon);
}
function toHsl(x) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let hh = 0, ss = 0;
    const ll = (mx + mn) / 2;
    if (mx !== mn) {
        const d = mx - mn;
        ss = ll > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        hh *= 60;
    }
    return [hh, ss, ll];
}
function fromHsl(hh, ss, ll) {
    ss = Math.min(1, ss);
    const kk = (n) => (n + hh / 30) % 12, a = ss * Math.min(ll, 1 - ll);
    const f = (n) => ll - a * Math.max(-1, Math.min(kk(n) - 3, Math.min(9 - kk(n), 1)));
    return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
/** the background shade that belongs to a colour (callouts, highlights) – so one colour is all you choose */
export function bgFromColor(c) { return hex(c) ? mix(c, themeMode === 'dark' ? '#191919' : '#ffffff', themeMode === 'dark' ? 0.32 : 0.22) : c; }
/** Use the colours from the workspace settings: changed built-in colours and your own colours. */
/** more saturated colours that stand further from the background (0 = as designed, 1 = strongest) */
function boost(c, k, kind) {
    if (!hex(c) || k <= 0)
        return c;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    let l = (mx + mn) / 2;
    let sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d)
        hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh = (hh * 60 + 360) % 360;
    sat = Math.min(1, sat * (1 + 1.0 * k));
    const away = (kind === 'text' ? 0.1 : 0.06) * k;
    l = Math.max(0, Math.min(1, themeMode === 'light' ? l - away : l + away));
    const C = (1 - Math.abs(2 * l - 1)) * sat, X = C * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - C / 2;
    const [a, bb, cc] = hh < 60 ? [C, X, 0] : hh < 120 ? [X, C, 0] : hh < 180 ? [0, C, X] : hh < 240 ? [0, X, C] : hh < 300 ? [X, 0, C] : [C, 0, X];
    return '#' + [a, bb, cc].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
/** every colour's saturation (×) and lightness (± percentage points), for Settings → Colors */
function tune(c, satMul, dl) {
    if (!hex(c) || (satMul === 1 && !dl))
        return c;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    let l = (mx + mn) / 2;
    let sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d)
        hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh = (hh * 60 + 360) % 360;
    sat = Math.max(0, Math.min(1, sat * satMul));
    l = Math.max(0, Math.min(1, l + dl / 100));
    const C = (1 - Math.abs(2 * l - 1)) * sat, X = C * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - C / 2;
    const [a, bb, cc] = hh < 60 ? [C, X, 0] : hh < 120 ? [X, C, 0] : hh < 180 ? [0, C, X] : hh < 240 ? [0, X, C] : hh < 300 ? [X, 0, C] : [C, 0, X];
    return '#' + [a, bb, cc].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
export function applyColors(cfg, contrast = 0, tuneSat = 0, tuneLight = 0, shade = 0) {
    for (const k of Object.keys(colorTable))
        delete colorTable[k];
    for (const k of Object.keys(blockTable))
        delete blockTable[k];
    for (const k of Object.keys(colorNames))
        delete colorNames[k];
    Object.assign(colorTable, structuredClone(BASE_COLORS));
    Object.assign(blockTable, BASE_BLOCK);
    const css = [];
    const put = (k, text, bg) => {
        const t = text && hex(text), b = bg && hex(bg);
        colorTable[k] ??= { ...BASE_COLORS.gray };
        if (t) {
            colorTable[k].text = t;
            css.push(`[data-color="${k}"]{color:${t}}`);
        }
        if (b) {
            colorTable[k].tag = themeMode === 'light' ? b : mix(b, '#ffffff', 0.85);
            colorTable[k].bg = themeMode === 'light' ? mix(b, '#ffffff', 0.5) : mix(b, '#191919', 0.55);
            blockTable[k] = b;
            css.push(`[data-color="${k}_bg"]{background:${b};border-radius:3px;padding:0 2px}`);
        }
    };
    for (const [k, v] of Object.entries(cfg?.overrides ?? {}))
        if (k in BASE_COLORS && k !== 'default')
            put(k, v.text, v.bg);
    for (const c of cfg?.custom ?? []) {
        if (!/^[a-z0-9-]+$/.test(c.id))
            continue;
        colorNames[c.id] = c.name || 'Custom';
        put(c.id, c.text, c.bg);
    }
    // Settings → Appearance → Contrast: every colour on the page (not the background) gets stronger
    const k = Math.max(0, Math.min(1, contrast / 100));
    if (k > 0) {
        for (const [name, v] of Object.entries(colorTable)) {
            v.tag = boost(v.tag, k, 'fill');
            v.bg = boost(v.bg, k, 'fill');
            v.text = boost(v.text, k, 'text');
            if (name !== 'default')
                css.push(`[data-color="${name}"]{color:${v.text}}`);
        }
        for (const [name, v] of Object.entries(blockTable)) {
            blockTable[name] = boost(v, k, 'fill');
            css.push(`[data-color="${name}_bg"]{background:${blockTable[name]}}`);
        }
    }
    // Settings → Colors: saturation and brightness of all colours at once
    if (tuneSat || tuneLight) {
        const mul = 1 + tuneSat / 100;
        for (const [name, v] of Object.entries(colorTable)) {
            if (name === 'default')
                continue;
            v.tag = tune(v.tag, mul, tuneLight);
            v.bg = tune(v.bg, mul, tuneLight * 0.5);
            v.text = tune(v.text, mul, tuneLight);
            css.push(`[data-color="${name}"]{color:${v.text}}`);
        }
        for (const [name, v] of Object.entries(blockTable)) {
            blockTable[name] = tune(v, mul, tuneLight * 0.5);
            css.push(`[data-color="${name}_bg"]{background:${blockTable[name]}}`);
        }
    }
    // the four steps of every colour, made from its (tuned) colour – see colorSteps
    const page = themeMode === 'dark' ? '#191919' : '#ffffff';
    lastPage = page;
    lastK = k;
    const vars = [];
    for (const [name, v] of Object.entries(colorTable)) {
        if (name === 'default')
            continue;
        const auto = colorSteps(v.text, page, k);
        const st0 = auto;
        // Shades: the fills' opacity – the page shows through them (100 % = solid)
        const op = Math.max(20, Math.min(100, 100 - shade));
        const see = (c) => (op >= 100 ? c : `color-mix(in srgb, ${c} ${op}%, transparent)`);
        const st = { color: st0.color, strong: see(st0.strong), soft: see(st0.soft), faint: see(st0.faint), icon: st0.icon };
        stepTable[name] = st;
        v.tag = st.strong;
        v.bg = st.soft;
        blockTable[name] = st.soft;
        vars.push(`--c-${name}-icon:${st.icon};--c-${name}:${st.color};--c-${name}-strong:${st.strong};--c-${name}-soft:${st.soft};--c-${name}-faint:${st.faint}`);
        css.push(`[data-color="${name}"]{color:${st.color}}`, `[data-color="${name}_bg"]{background:${st.strong};border-radius:3px;padding:0 2px}`);
    }
    css.push(`{${vars.join(';')}}`);
    let style = document.getElementById('nook-colors');
    if (!style) {
        style = document.createElement('style');
        style.id = 'nook-colors';
        document.head.appendChild(style);
    }
    // above the built-in rules (also the light theme's)
    style.textContent = css.map((r) => (r.startsWith('{') ? `:root${r}` : `:root:root:root ${r}`)).join('\n');
}
export function blockColorStyle(color) {
    if (!color || color === 'default')
        return {};
    if (color.endsWith('_bg')) {
        const c = color.slice(0, -3);
        return { background: BLOCK_BG[c] ?? 'transparent' };
    }
    return { color: COLORS[color]?.text };
}
// ---------- dates ----------
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** first day of the week for calendars: 0 = Monday, 6 = Sunday */
let weekStartIdx = 0;
export function setWeekStart(w) { weekStartIdx = w === 'sun' ? 6 : 0; }
export function weekStart() { return weekStartIdx; }
/** '24h' or '12h' – set from the workspace settings. */
let timeFormat = '24h';
export function setTimeFormat(f) { timeFormat = f; }
export const getTimeFormat = () => timeFormat;
export function fmtTime(hhmm) {
    if (timeFormat === '24h')
        return hhmm;
    const [hh, mm] = hhmm.split(':').map(Number);
    return `${((hh + 11) % 12) + 1}:${pad2(mm)} ${hh < 12 ? 'AM' : 'PM'}`;
}
/** Parse what people type as a time: 9, 930, 9:30, 21.15, 9pm → "HH:MM" (24h), or null. */
export function parseTime(s) {
    const t = s.trim().toLowerCase();
    if (!t)
        return null;
    const m = t.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?$/);
    if (!m)
        return null;
    let hh = +m[1];
    const mm = m[2] ? +m[2] : 0;
    if (m[3] === 'pm' && hh < 12)
        hh += 12;
    if (m[3] === 'am' && hh === 12)
        hh = 0;
    if (hh > 23 || mm > 59)
        return null;
    return `${pad2(hh)}:${pad2(mm)}`;
}
/** a date's local day as YYYY-MM-DD */
export function isoOfDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function todayISO() { return isoOfDate(new Date()); }
/** a date's local time as HH:MM */
export function hhmmOfDate(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
export function pad2(n) { return String(n).padStart(2, '0'); }
/** Days since epoch for a YYYY-MM-DD string (UTC, so no DST surprises). */
export function dayNum(iso) { return Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5); }
export function isoFromDay(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
export function addDays(iso, d) { return isoFromDay(dayNum(iso) + d); }
export function asDate(v) {
    if (v == null)
        return null;
    if (typeof v === 'object' && !Array.isArray(v) && 'start' in v)
        return v;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))
        return { start: v };
    return null;
}
/** How dates are shown and typed – set from the workspace settings. */
/** buttons and page links without a size of their own (Settings → Appearance) */
let defaultBlockSize = 'large';
export function setDefaultBlockSize(s) { defaultBlockSize = s ?? 'large'; }
export function isLarge(b) { return b.size ? b.size === 'large' : defaultBlockSize === 'large'; }
let dateFormat = 'DD.MM.YYYY';
export function setDateFormat(f) { dateFormat = f; }
export const DATE_FORMATS = [
    ['DD.MM.YYYY', '28.10.2026'], ['YYYY-MM-DD', '2026-10-28'], ['MM/DD/YYYY', '10/28/2026'], ['DD/MM/YYYY', '28/10/2026'],
    ['D MMM YYYY', '28 Oct 2026'], ['MMM D, YYYY', 'Oct 28, 2026'], ['D. MMMM YYYY', '28. October 2026'], ['relative', 'Today, Tomorrow, 28 Oct 2026'],
];
/** A day (YYYY-MM-DD) in the chosen date format. */
export function fmtDay(iso, f = dateFormat) {
    const y = iso.slice(0, 4), m = iso.slice(5, 7), d = iso.slice(8, 10);
    const mon = MONTHS[+m - 1] ?? '';
    switch (f) {
        case 'YYYY-MM-DD': return `${y}-${m}-${d}`;
        case 'MM/DD/YYYY': return `${m}/${d}/${y}`;
        case 'DD/MM/YYYY': return `${d}/${m}/${y}`;
        case 'D MMM YYYY': return `${+d} ${mon.slice(0, 3)} ${y}`;
        case 'MMM D, YYYY': return `${mon.slice(0, 3)} ${+d}, ${y}`;
        case 'D. MMMM YYYY': return `${+d}. ${mon} ${y}`;
        case 'relative': {
            const diff = dayNum(iso) - dayNum(todayISO());
            if (diff === 0)
                return 'Today';
            if (diff === 1)
                return 'Tomorrow';
            if (diff === -1)
                return 'Yesterday';
            if (diff > 1 && diff < 7)
                return WEEKDAYS_LONG[(new Date(dayNum(iso) * 864e5).getUTCDay() + 6) % 7];
            return `${+d} ${mon.slice(0, 3)} ${y}`;
        }
        default: return `${d}.${m}.${y}`;
    }
}
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function fmtDate(v, format, weekday) {
    if (!v)
        return '';
    const one = (s) => {
        const [d, t] = s.split('T');
        const day = WEEKDAYS_LONG[(new Date(dayNum(d) * 864e5).getUTCDay() + 6) % 7];
        const out = (weekday && day ? `${weekday === 'short' ? day.slice(0, 3) : day}, ` : '') + fmtDay(d, format);
        return t ? `${out} ${fmtTime(t.slice(0, 5))}` : out;
    };
    return v.end && v.end !== v.start ? `${one(v.start)} → ${one(v.end)}` : one(v.start);
}
const MONTH_WORDS = {};
['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].forEach((m, i) => { MONTH_WORDS[m] = i + 1; });
Object.assign(MONTH_WORDS, { mär: 3, mrz: 3, mai: 5, okt: 10, dez: 12, sept: 9 });
/**
 * Read a typed date: the chosen format, ISO, "28.10", "10/28" (US format), "28 Oct", "today",
 * "tomorrow", "+3" (days from today) → YYYY-MM-DD, or null.
 */
export function parseDateInput(text, f = dateFormat) {
    const t = text.trim().toLowerCase();
    if (!t)
        return null;
    const today = todayISO();
    const ok = (y, m, d) => {
        if (y < 100)
            y += 2000;
        if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate())
            return null;
        return `${y}-${pad2(m)}-${pad2(d)}`;
    };
    if (t === 'today' || t === 'heute')
        return today;
    if (t === 'tomorrow' || t === 'morgen')
        return addDays(today, 1);
    if (t === 'yesterday' || t === 'gestern')
        return addDays(today, -1);
    let m = t.match(/^([+-])\s*(\d{1,4})\s*d?$/);
    if (m)
        return addDays(today, (m[1] === '-' ? -1 : 1) * +m[2]);
    m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m)
        return ok(+m[1], +m[2], +m[3]);
    const year = +today.slice(0, 4);
    m = t.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\.?$/);
    if (m) {
        const us = f === 'MM/DD/YYYY' || f === 'MMM D, YYYY';
        const a = +m[1], b = +m[2];
        return us ? ok(m[3] ? +m[3] : year, a, b) : ok(m[3] ? +m[3] : year, b, a);
    }
    m = t.match(/^(\d{1,2})\.?\s+([a-zäöü]+)\.?,?\s*(\d{2,4})?$/);
    if (m && MONTH_WORDS[m[2].slice(0, 3)])
        return ok(m[3] ? +m[3] : year, MONTH_WORDS[m[2].slice(0, 4)] ?? MONTH_WORDS[m[2].slice(0, 3)], +m[1]);
    m = t.match(/^([a-zäöü]+)\.?\s+(\d{1,2}),?\s*(\d{2,4})?$/);
    if (m && MONTH_WORDS[m[1].slice(0, 3)])
        return ok(m[3] ? +m[3] : year, MONTH_WORDS[m[1].slice(0, 3)], +m[2]);
    m = t.match(/^(\d{1,2})$/);
    if (m)
        return ok(year, +today.slice(5, 7), +m[1]);
    return null;
}
// ---------- numbers ----------
/** the language numbers are written in (Settings → Dates & numbers); empty: the computer's */
let numLocale;
export function setNumberLocale(l) { numLocale = l || undefined; }
export function defaultLocale() { try {
    return navigator.language || 'en-US';
}
catch {
    return 'en-US';
} }
const CURRENCY = { euro: 'EUR', dollar: 'USD', pound: 'GBP', franc: 'CHF', yen: 'JPY' };
/** number formats are built once per language and format (building one is slow; tables format thousands of numbers) */
const numFormats = new Map();
function numFormat(loc, key, opts) {
    const k = `${loc ?? ''}|${key}`;
    let f = numFormats.get(k);
    if (!f) {
        try {
            f = new Intl.NumberFormat(loc, opts);
        }
        catch {
            f = new Intl.NumberFormat(undefined, opts);
        }
        numFormats.set(k, f);
    }
    return f;
}
export function fmtNumber(n, format) {
    if (n == null || Number.isNaN(n))
        return '';
    const loc = numLocale;
    if (format && CURRENCY[format])
        return numFormat(loc, format, { style: 'currency', currency: CURRENCY[format] }).format(n);
    if (format === 'stars') {
        const v = Math.max(0, Math.min(5, Math.round(n * 2) / 2));
        return '★'.repeat(Math.floor(v)) + (v % 1 ? '½' : '');
    }
    if (format === 'bytes') {
        const u = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0, v = n;
        while (v >= 1000 && i < u.length - 1) {
            v /= 1024;
            i++;
        }
        return `${numFormat(loc, 'b' + (i > 1 ? 1 : 0), { maximumFractionDigits: i > 1 && v < 100 ? 1 : 0 }).format(v)} ${u[i]}`;
    }
    if (format === 'duration') {
        const t = Math.round(n), hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60;
        return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
    }
    if (format === 'plain_int')
        return String(Math.round(n));
    if (format === 'plain')
        return numFormat(loc, 'plain', { maximumFractionDigits: 2, useGrouping: false }).format(n);
    if (format === 'integer')
        return numFormat(loc, 'integer', {}).format(Math.round(n));
    if (format === 'percent')
        return numFormat(loc, 'percent', { maximumFractionDigits: 1 }).format(n * 100) + ' %';
    return numFormat(loc, 'number', { maximumFractionDigits: 2 }).format(n);
}
/** date, time and week settings that fit a language (for new workspaces) */
export function localeDefaults(locale = defaultLocale()) {
    let h12 = false;
    try {
        h12 = !!new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12;
    }
    catch { /* default */ }
    const region = (locale.split('-')[1] ?? '').toUpperCase();
    const sunday = ['US', 'CA', 'MX', 'BR', 'JP', 'KR', 'IL', 'PH', 'AU', 'IN', 'ZA', 'TW', 'HK', 'SA'].includes(region);
    const lang = locale.split('-')[0].toLowerCase();
    const dateFormat = region === 'US' ? 'MM/DD/YYYY'
        : ['de', 'ru', 'pl', 'cs', 'fi', 'nb', 'no', 'da', 'tr', 'uk', 'sk', 'hu', 'ro'].includes(lang) ? 'DD.MM.YYYY'
            : ['en', 'fr', 'es', 'it', 'pt', 'el', 'nl'].includes(lang) ? 'DD/MM/YYYY'
                : 'YYYY-MM-DD';
    return { dateFormat, timeFormat: h12 ? '12h' : '24h', weekStart: sunday ? 'sun' : 'mon' };
}
/** Parse "12,50", "12.50", "€12.75", "-€8.92", "1.234,56 €". */
export function parseNumber(s) {
    let t = s.replace(/[€$£¥\s\u00a0]/g, '').replace(/^\+/, '').replace(/(CHF|EUR|USD|GBP)/gi, '');
    if (t === '' || t === '-')
        return null;
    if (/,\d{1,2}$/.test(t))
        t = t.replace(/\./g, '').replace(',', '.');
    else
        t = t.replace(/,/g, '');
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}
/** calls waiting in a debounce; run at once when the window is hidden or closed, so no edit is lost */
const pending = new Map();
export function flushPending() { const list = [...pending.values()]; pending.clear(); list.forEach((f) => { try {
    f();
}
catch { /* keep flushing */ } }); }
export function debounce(fn, ms) {
    let t;
    const key = {};
    return ((...a) => {
        clearTimeout(t);
        const run = () => { clearTimeout(t); pending.delete(key); fn(...a); };
        pending.set(key, run);
        t = setTimeout(run, ms);
    });
}
export function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** Text comparison in the reader's language (one shared collator: much faster than localeCompare). */
const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' });
export const compareText = (a, b) => COLLATOR.compare(a, b);
/** "(T)" style hint with the shortcut currently set for a command (the app fills this in) */
let hintFn = () => '';
export function setShortcutHint(f) { hintFn = f; }
export function keyHint(id) { const k = hintFn(id); return k ? ` (${k})` : ''; }
export const DEFAULT_BG = { dark: { h: 240, s: 5, l: 8 }, light: { h: 60, s: 9, l: 98 } };
const clampL = (l) => Math.max(0, Math.min(100, l));
/** every surface colour of the app from one background colour (hue, saturation, lightness) */
export function themeVars(mode, bg) {
    const c = (dl, ds = 0) => `hsl(${bg.h} ${Math.max(0, bg.s + ds)}% ${clampL(bg.l + dl)}%)`;
    if (mode === 'dark')
        return {
            '--bg': c(0), '--bg-side': c(-2.5), '--surface': c(2.5), '--bg-pop': c(4), '--bg-input': c(4),
            '--bg-hover': c(6.5), '--bg-active': c(10), '--border': c(8), '--border-strong': c(11),
            '--fg': 'rgba(255,255,255,0.84)', '--fg-strong': 'rgba(255,255,255,0.94)', '--fg-muted': '#a1a1a6', '--fg-faint': '#808086',
            '--overlay': 'rgba(255,255,255,0.06)', '--overlay-strong': 'rgba(255,255,255,0.1)', 'color-scheme': 'dark',
        };
    // light: cards and menus are lighter than the page (or white), lines darker
    return {
        '--bg': c(0), '--bg-side': c(-2.5, 2), '--surface': c(Math.min(2, 100 - bg.l)), '--bg-pop': 'hsl(0 0% 100%)', '--bg-input': c(-3),
        '--bg-hover': c(-5), '--bg-active': c(-9), '--border': c(-9), '--border-strong': c(-15),
        '--fg': 'rgba(30,29,27,0.88)', '--fg-strong': 'rgba(22,21,19,0.96)', '--fg-muted': '#66655f', '--fg-faint': '#77766f',
        '--overlay': 'rgba(0,0,0,0.04)', '--overlay-strong': 'rgba(0,0,0,0.07)', 'color-scheme': 'light',
    };
}
/** Timed dates first, date-only values next, missing dates last, in either direction. */
export function compareDateStarts(a, b, dir = 'asc') {
    // no date: always last
    if (!a || !b)
        return a === b ? 0 : a ? -1 : 1;
    const sign = dir === 'desc' ? -1 : 1;
    // the day first (it used to put every entry with a time before every entry without one, whatever the day)
    const da = a.slice(0, 10), db = b.slice(0, 10);
    if (da !== db)
        return (da < db ? -1 : 1) * sign;
    // the same day: entries with a time first, in time order; then the ones without
    const ta = /[Tt ]\d{2}:\d{2}/.test(a), tb = /[Tt ]\d{2}:\d{2}/.test(b);
    if (ta !== tb)
        return ta ? -1 : 1;
    return (a === b ? 0 : a < b ? -1 : 1) * sign;
}
/** an address the user or an imported file supplied, as a link target: only web, mail and phone addresses –
    anything else (script addresses above all) leads nowhere */
export function safeHref(url) {
    const t = String(url ?? '').trim();
    if (/^(https?:|mailto:|tel:)/i.test(t))
        return t;
    // "example.com/page" typed without the scheme
    if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}([/:?#]|$)/i.test(t))
        return `https://${t}`;
    return '#';
}
/** files that may be shown in a browser tab; everything else (web pages, SVG drawings, scripts …) could
    run code there with Nook's rights and is downloaded instead */
export const SAFE_TO_VIEW = /\.(png|jpe?g|gif|webp|avif|pdf|mp3|m4a|wav|aac|ogg|mp4|mov|webm|txt)$/i;
/** open a file in a tab if that is safe, else download it under its name */
export function openOrDownload(url, name, download = false) {
    if (SAFE_TO_VIEW.test(name) && !download) {
        window.open(url, '_blank', 'noopener');
        return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
}
/** a short tick under the finger (lifting something, dropping it). Android vibrates; iOS has no vibration
    for websites, but a switch control ticks when it flips – a hidden one is flipped for it. */
let hapticSwitch = null;
export function haptic() {
    try {
        if (typeof navigator.vibrate === 'function') {
            navigator.vibrate(10);
            return;
        }
        if (!hapticSwitch) {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.setAttribute('switch', '');
            input.tabIndex = -1;
            hapticSwitch = document.createElement('label');
            hapticSwitch.setAttribute('aria-hidden', 'true');
            hapticSwitch.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
            hapticSwitch.appendChild(input);
            document.body.appendChild(hapticSwitch);
        }
        hapticSwitch.click();
    }
    catch { /* no tick */ }
}
// ---------- small shared helpers ----------
/** the colours new options take in turn (select, multi-select, status, imports) */
export const TAG_CYCLE = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
export const nextTagColor = (n) => TAG_CYCLE[n % TAG_CYCLE.length];
/** file names that are pictures */
export const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg|heic)$/i;
/** a short random id for settings items (modules, sources) – not for files, which use ulid() */
export const shortId = () => Math.random().toString(36).slice(2, 10);
/** replaces an element by its children */
export function unwrapEl(el) { const p = el.parentNode; if (!p)
    return; while (el.firstChild)
    p.insertBefore(el.firstChild, el); p.removeChild(el); }
/** phone layout: narrow screens; a phone held sideways keeps it (Nook is designed for portrait only – the
 *  iPhone doesn't let a web app lock the screen, so sideways is the same layout, just wider) */
export const PHONE_QUERY = '(max-width: 720px), (pointer: coarse) and (max-height: 500px)';
export const isPhone = () => matchMedia(PHONE_QUERY).matches;
/** opens (once) a browser database of this device with the given stores; `drop` removes old ones */
const idbs = new Map();
export function openIdb(name, version, stores, drop = []) {
    let p = idbs.get(name);
    if (!p) {
        p = new Promise((ok, fail) => {
            // a browser that blocks storage (e.g. a sandboxed frame) may never answer: give up after 2 s
            const t = setTimeout(() => { idbs.delete(name); fail(new Error('Browser storage not available')); }, 2000);
            let r;
            try {
                r = indexedDB.open(name, version);
            }
            catch (e) {
                clearTimeout(t);
                idbs.delete(name);
                fail(e);
                return;
            }
            r.onupgradeneeded = () => { const db = r.result; for (const n of drop)
                if (db.objectStoreNames.contains(n))
                    db.deleteObjectStore(n); for (const n of stores)
                if (!db.objectStoreNames.contains(n))
                    db.createObjectStore(n); };
            r.onsuccess = () => { clearTimeout(t); ok(r.result); };
            r.onerror = () => { clearTimeout(t); idbs.delete(name); fail(r.error); };
        });
        idbs.set(name, p);
    }
    return p;
}
//# sourceMappingURL=util.js.map