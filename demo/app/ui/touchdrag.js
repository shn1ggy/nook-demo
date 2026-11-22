// Phone: press and hold something that can be dragged with the mouse (an entry in a list, board or
// calendar, a table card, a page in the sidebar, a column, an option …) to lift it, then move the
// finger. The lifted element follows; lifting it and letting go without moving opens its menu.
// It drives the same drag events the mouse does, so every drop target works as on a computer.
import { haptic } from '../util.js';
const HOSTS = '.list-row, .t-card, .card, .g-card, .ev, .side-item, .opt-row, .prop-row, .rule-row';
const HOLD_MS = 380;
class Carried {
    data = new Map();
    effectAllowed = 'all';
    dropEffect = 'move';
    files = [];
    items = [];
    get types() { return [...this.data.keys()]; }
    setData(k, v) { this.data.set(k, v); }
    getData(k) { return this.data.get(k) ?? ''; }
    clearData() { this.data.clear(); }
    setDragImage() { }
}
function fire(type, target, x, y, dt) {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    return !target.dispatchEvent(ev); // true: a handler took it (preventDefault)
}
/** the element that starts the drag for what was touched (itself, or its grip) */
function sourceOf(t) {
    if (t.closest('input, textarea, select, [contenteditable="true"], .resizer, .ev-edge'))
        return null;
    const host = t.closest(HOSTS);
    const own = t.closest('[draggable="true"]');
    if (own && (!host || host.contains(own)))
        return { src: own, host: host ?? own };
    if (!host)
        return null;
    if (host.draggable)
        return { src: host, host };
    const grip = host.querySelector('[draggable="true"]');
    return grip ? { src: grip, host } : null;
}
export function installTouchDrag() {
    const root = document.documentElement;
    let touching = false;
    // iOS has a drag of its own for draggable elements; this one replaces it while a finger is down
    document.addEventListener('dragstart', (e) => { if (e.isTrusted && touching) {
        e.preventDefault();
        e.stopPropagation();
    } }, true);
    document.addEventListener('touchend', () => { setTimeout(() => { touching = false; }, 50); }, true);
    document.addEventListener('touchcancel', () => { touching = false; }, true);
    document.addEventListener('touchstart', (e) => {
        touching = true;
        if (!root.matches('.phone, .touch') || e.touches.length !== 1)
            return;
        const found = sourceOf(e.target);
        if (!found)
            return;
        const { src, host } = found;
        const x0 = e.touches[0].clientX, y0 = e.touches[0].clientY;
        let x = x0, y = y0, lifted = false, moved = false, over = null, accepted = false;
        let ghost = null, raf = 0;
        const dt = new Carried();
        const box = host.getBoundingClientRect();
        const timer = setTimeout(() => {
            if (!host.isConnected)
                return stop();
            if (fire('dragstart', src, x0, y0, dt) || !dt.types.length)
                return stop(); // refused, or nothing to carry
            lifted = true;
            root.classList.add('touch-dragging');
            getSelection()?.removeAllRanges();
            haptic();
            ghost = host.cloneNode(true);
            ghost.classList.add('touch-ghost');
            ghost.style.cssText += `;position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;margin:0;`;
            document.body.appendChild(ghost);
            host.classList.add('touch-lifted');
            scrollEdges();
        }, HOLD_MS);
        // near the top or bottom edge the page scrolls along (a board also sideways)
        const scrollEdges = () => {
            raf = requestAnimationFrame(scrollEdges);
            if (!moved)
                return;
            const sc = document.querySelector('.main > .scroll');
            const edge = 70;
            if (sc) {
                const r = sc.getBoundingClientRect();
                if (y < r.top + edge)
                    sc.scrollTop -= 9;
                else if (y > r.bottom - edge)
                    sc.scrollTop += 9;
            }
            const side = (over ?? host).closest('.board, .board-scroll');
            if (side) {
                if (x < 36)
                    side.scrollLeft -= 9;
                else if (x > innerWidth - 36)
                    side.scrollLeft += 9;
            }
        };
        const move = (ev) => {
            const t = ev.touches[0];
            x = t.clientX;
            y = t.clientY;
            if (!lifted) {
                if (Math.hypot(x - x0, y - y0) > 8)
                    stop();
                return;
            }
            ev.preventDefault();
            if (Math.hypot(x - x0, y - y0) > 6)
                moved = true;
            if (ghost)
                ghost.style.transform = `translate(${x - x0}px, ${y - y0}px) scale(1.03)`;
            const el = document.elementFromPoint(x, y);
            if (el !== over) {
                if (over)
                    fire('dragleave', over, x, y, dt);
                over = el;
                if (el)
                    fire('dragenter', el, x, y, dt);
            }
            accepted = !!el && fire('dragover', el, x, y, dt);
        };
        function stop() {
            clearTimeout(timer);
            cancelAnimationFrame(raf);
            document.removeEventListener('touchmove', move);
            document.removeEventListener('touchend', end);
            document.removeEventListener('touchcancel', cancel);
            ghost?.remove();
            host.classList.remove('touch-lifted');
            root.classList.remove('touch-dragging');
        }
        const cancel = () => { if (lifted) {
            if (over)
                fire('dragleave', over, x, y, dt);
            fire('dragend', src, x, y, dt);
        } stop(); };
        const end = (ev) => {
            if (!lifted)
                return stop();
            ev.preventDefault(); // no click after a hold
            if (moved && over && accepted) {
                fire('drop', over, x, y, dt);
                haptic();
            }
            else if (over)
                fire('dragleave', over, x, y, dt);
            fire('dragend', src, x, y, dt);
            stop();
            // held and let go in place: its menu (what a right-click opens on a computer)
            if (!moved && host.isConnected)
                host.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x0, clientY: y0, view: window }));
        };
        document.addEventListener('touchmove', move, { passive: false });
        document.addEventListener('touchend', end, { passive: false });
        document.addEventListener('touchcancel', cancel);
    }, { passive: true });
}
//# sourceMappingURL=touchdrag.js.map