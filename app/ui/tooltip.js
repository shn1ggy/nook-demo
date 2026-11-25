// Tooltips in Nook's own look (desktop): every `title` in the app is shown as a small popup with the same surface,
// edge and shadow as the menus – and a shortcut at its end ("Search (⌘F)") in the menus' grey on the right.
// The browser's own tooltip is held back by moving `title` to `data-tip` while the pointer is on the element.
const KEY = /\(((?:[⌘⌥⇧⌃]|Ctrl|Alt|Shift|Cmd|F\d{1,2}|Esc|Tab|Enter|Space|[←→↑↓↵⌫])[^()]*)\)\s*$/;
let tip = null;
let shownAt = 0, timer = 0, hideTimer = 0;
let cur = null;
function el() {
    if (!tip) {
        tip = document.createElement('div');
        tip.className = 'ntip';
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);
    }
    return tip;
}
function textOf(t) { return t.dataset.tip ?? ''; }
function show(t) {
    const raw = textOf(t).trim();
    if (!raw || !t.isConnected)
        return;
    const m = raw.match(KEY);
    const name = m ? raw.slice(0, m.index).trim() : raw;
    const box = el();
    box.textContent = name;
    if (m) {
        const k = document.createElement('span');
        k.className = 'ntip-k';
        k.textContent = m[1];
        box.appendChild(k);
    }
    box.style.left = '0px';
    box.style.top = '0px';
    box.classList.add('measure');
    const r = t.getBoundingClientRect(), w = box.offsetWidth, hgt = box.offsetHeight;
    box.classList.remove('measure');
    let top = r.bottom + 6;
    if (top + hgt > innerHeight - 6)
        top = r.top - hgt - 6; // no room below: above
    box.style.left = `${Math.round(Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)))}px`;
    box.style.top = `${Math.round(top)}px`;
    requestAnimationFrame(() => box.classList.add('on'));
    shownAt = Date.now();
}
function hide() { tip?.classList.remove('on'); }
function release(t) {
    if (!t)
        return;
    // the title goes back (other code may read it), unless the element changed it meanwhile
    if (t.dataset.tip != null && !t.hasAttribute('title'))
        t.setAttribute('title', t.dataset.tip);
    delete t.dataset.tip;
}
export function initTooltips() {
    if (matchMedia('(hover: none)').matches)
        return; // phones and tablets: no hover
    document.addEventListener('pointerover', (e) => {
        if (e.pointerType === 'touch')
            return;
        const t = e.target.closest('[title], [data-tip]');
        if (t === cur)
            return;
        clearTimeout(timer);
        clearTimeout(hideTimer);
        release(cur);
        cur = t;
        if (!t) {
            hideTimer = window.setTimeout(hide, 60);
            return;
        }
        const title = t.getAttribute('title');
        if (title != null) {
            t.dataset.tip = title;
            t.removeAttribute('title');
        }
        if (!textOf(t).trim()) {
            hide();
            return;
        }
        // the first after a short pause; while one shows (or just did), the next at once
        const quick = tip?.classList.contains('on') || Date.now() - shownAt < 400;
        hide();
        timer = window.setTimeout(() => { if (cur === t)
            show(t); }, quick ? 0 : 500);
    }, true);
    const away = () => { clearTimeout(timer); hide(); release(cur); cur = null; };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', away, true);
    document.addEventListener('scroll', away, true);
    window.addEventListener('blur', away);
}
//# sourceMappingURL=tooltip.js.map