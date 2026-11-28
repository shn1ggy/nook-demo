// Keyboard diagnostics (temporary): a small readout at the top of the screen with what iOS reports and
// what Nook does in response, plus a running log of the moments that matter. Off unless turned on in
// Settings → About → This screen. Nothing leaves the device.
const KEY = 'nook.kbdebug';
let box = null, logEl = null, raf = 0;
const lines = [];
const t0 = performance.now();
export const kbDebugOn = () => { try {
    return localStorage.getItem(KEY) === '1';
}
catch {
    return false;
} };
export function setKbDebug(on) { try {
    if (on)
        localStorage.setItem(KEY, '1');
    else
        localStorage.removeItem(KEY);
}
catch { /* private */ } if (on)
    startKbDebug();
else
    stopKbDebug(); }
/** one line in the log ("focus", "scrollTo(0,0)", "keepCaret +120") – cheap when the readout is off */
export function kbLog(what) {
    if (!box)
        return;
    lines.push(`${((performance.now() - t0) / 1000).toFixed(2)} ${what}`);
    if (lines.length > 14)
        lines.shift();
    if (logEl)
        logEl.textContent = lines.join('\n');
}
const n = (v) => String(Math.round(v));
function frame() {
    raf = requestAnimationFrame(frame);
    if (!box)
        return;
    const r = document.documentElement, vv = window.visualViewport, cs = getComputedStyle(r);
    const a = document.activeElement;
    const sheet = document.querySelector('.overlay > .dialog, .pop');
    const sr = sheet?.getBoundingClientRect();
    const sc = a?.closest('.peek-body, .dialog-body, .set-main, .vpanel, .main > .scroll');
    let caret = '';
    const sel = getSelection();
    if (sel?.rangeCount) {
        const cr = sel.getRangeAt(0).getBoundingClientRect();
        caret = `${n(cr.top)}–${n(cr.bottom)}`;
    }
    const cls = ['kb-open', 'touch', 'phone'].filter((c) => r.classList.contains(c)).join(' ');
    box.firstChild.textContent =
        `inner ${n(innerWidth)}×${n(innerHeight)}  screen ${screen.width}×${screen.height}  body ${n(document.body.offsetHeight)}\n` +
            `vv h${n(vv?.height ?? 0)} top${n(vv?.offsetTop ?? 0)} pageTop${n(vv?.pageTop ?? 0)} scale${(vv?.scale ?? 1).toFixed(2)}  scrollY ${n(scrollY)}\n` +
            `--full-h ${cs.getPropertyValue('--full-h').trim()} --kb-h ${cs.getPropertyValue('--kb-h').trim()} --sheet-top ${cs.getPropertyValue('--sheet-top').trim()} --sheet-h ${cs.getPropertyValue('--sheet-h').trim()}\n` +
            `class: ${cls}\n` +
            `focus: ${a ? (a.tagName.toLowerCase() + '.' + String(a.className).split(' ')[0]) : '-'}  caret ${caret || '-'}\n` +
            `sheet: ${sr ? `${n(sr.top)}–${n(sr.bottom)} h${n(sr.height)}` : '-'}  scroller: ${sc ? `${sc.className.split(' ')[0]} top${n(sc.scrollTop)} h${n(sc.clientHeight)}/${n(sc.scrollHeight)} pb${getComputedStyle(sc).paddingBottom}` : '-'}`;
}
/** jumps of the page's scroll position (not from a finger): logged with where they went */
let lastTop = -1, touching = false;
document.addEventListener('touchstart', () => { touching = true; }, true);
document.addEventListener('touchend', () => { setTimeout(() => { touching = false; }, 600); }, true);
document.addEventListener('scroll', (e) => {
    if (!box)
        return;
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.matches('.scroll'))
        return;
    if (lastTop >= 0 && Math.abs(t.scrollTop - lastTop) > 8 && !touching)
        kbLog(`JUMP ${n(lastTop)}→${n(t.scrollTop)} h${n(t.scrollHeight)} act:${document.activeElement?.className?.toString().slice(0, 20) ?? '-'}`);
    lastTop = t.scrollTop;
}, true);
/** who moves the page: scrollIntoView, focus and scrollTop on the page – logged with the element (diagnostics only) */
let patched = false;
function patchMovers() {
    if (patched)
        return;
    patched = true;
    const name = (e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 2).join('.')}`.slice(0, 32);
    const sIV = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...a) { kbLog(`scrollIntoView ${name(this)}`); return sIV.apply(this, a); };
    const foc = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (o) { kbLog(`focus() ${name(this)}${o?.preventScroll ? ' (no scroll)' : ''}`); return foc.call(this, o); };
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get: d.get, set(v) { if (this.matches?.('.scroll'))
            kbLog(`scrollTop=${Math.round(v)}`); d.set.call(this, v); } });
}
export function startKbDebug() {
    patchMovers();
    if (box)
        return;
    box = document.createElement('div');
    box.className = 'kbdebug';
    box.append(document.createElement('pre'), logEl = document.createElement('pre'));
    logEl.className = 'kbdebug-log';
    document.body.appendChild(box);
    const on = (target, ev, label) => target?.addEventListener(ev, (e) => kbLog(label(e)), true);
    on(window.visualViewport ?? undefined, 'resize', () => `vv resize h${n(window.visualViewport.height)} top${n(window.visualViewport.offsetTop)}`);
    on(window.visualViewport ?? undefined, 'scroll', () => `vv scroll top${n(window.visualViewport.offsetTop)}`);
    // the window itself only (every scroll of the page went through here and filled the log)
    window.addEventListener('scroll', (e) => {
        if (e.target === document)
            kbLog(`window scroll Y${n(scrollY)}`);
    }, true);
    on(document, 'focusin', (e) => `focusin ${e.target.tagName?.toLowerCase()}.${String(e.target.className).split(' ')[0]}`);
    on(document, 'focusout', () => 'focusout');
    on(document, 'touchend', () => 'touchend');
    frame();
}
export function stopKbDebug() { cancelAnimationFrame(raf); box?.remove(); box = null; logEl = null; lines.length = 0; }
//# sourceMappingURL=kbdebug.js.map