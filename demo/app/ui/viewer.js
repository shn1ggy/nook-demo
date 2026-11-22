// The media viewer: photos, videos and PDFs in a window over the page (90 % of the screen, the page behind blurred).
// ← → (and the strip at the bottom) go through all of them; the bar has new tab, download, show in Dropbox, close.
// On the phone it fills the screen and swipes; PDFs open in the system's viewer there (Safari shows only the first
// page of a PDF inside a page).
import { h, svgIcon, ICONS } from '../util.js';
import { iconSvg } from './icons.js';
import { menu, menuIcon, toast } from './pop.js';
import { openPdfFull, pdfUrl } from './pdf.js';
export const mediaType = (p) => /\.(png|jpe?g|gif|webp|avif|svg|heic)$/i.test(p) ? 'image' : /\.(mp4|mov|m4v|webm)$/i.test(p) ? 'video' : /\.pdf$/i.test(p) ? 'pdf' : null;
const fileName = (p) => p.split('/').pop() ?? p;
export const sizeLabel = (n) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const phone = () => document.documentElement.classList.contains('phone');
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
async function blobOf(ctx, p) { const r = await fetch(await ctx.assetUrl(p)); if (!r.ok)
    throw new Error(`Could not load ${fileName(p)}`); return r.blob(); }
export async function downloadMedia(ctx, p) {
    try {
        const b = await blobOf(ctx, p);
        const href = URL.createObjectURL(b);
        const a = h('a', { href, download: fileName(p), style: { display: 'none' } });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 60_000);
    }
    catch (e) {
        toast(e.message);
    }
}
export function openMediaInTab(ctx, p) {
    // the tab opens on the click (else the browser blocks it), the file follows
    const w = window.open('', '_blank');
    void ctx.assetUrl(p).then((u) => mediaType(p) === 'pdf' ? pdfUrl(u) : blobOf(ctx, p).then((b) => URL.createObjectURL(b))).then((u) => { if (w)
        w.location.href = u; }).catch((e) => { w?.close(); toast(e.message); });
}
export function revealMedia(ctx, p) {
    const r = ctx.ws.storage.reveal;
    if (!r) {
        toast('This workspace can’t show files in a folder');
        return;
    }
    void r.call(ctx.ws.storage, p).catch((e) => toast(`Could not show the file: ${e.message}`));
}
const revealLabel = (ctx) => ctx.ws.storage.remote ? 'Show in Dropbox' : /Mac/i.test(navigator.platform) ? 'Show in Finder' : 'Show in folder';
/** right-click (long-press on the phone) on a photo, video or PDF */
export function mediaMenu(ctx, items, i, at) {
    const it = items[i];
    menu(at, [
        { label: 'Open', icon: menuIcon('eye'), hint: phone() ? undefined : 'Space', run: () => openViewer(ctx, items, i) },
        { label: 'Open in new tab', icon: menuIcon('external'), run: () => openMediaInTab(ctx, it.path) },
        { label: 'Download', icon: menuIcon('download'), run: () => void downloadMedia(ctx, it.path) },
        ...(ctx.ws.storage.reveal ? [{ label: revealLabel(ctx), icon: menuIcon('folder'), run: () => revealMedia(ctx, it.path) }] : []),
        ...(it.open ? ['sep', { label: it.entryName ? `Open entry · ${it.entryName}` : 'Open entry', icon: menuIcon('file-text'), run: it.open }] : []),
    ]);
}
/** the viewer over the page */
export function openViewer(ctx, items, at) {
    if (!items.length)
        return;
    // on the phone a PDF goes to the system's viewer
    if (phone() && mediaType(items[at].path) === 'pdf') {
        openPdfFull(() => ctx.assetUrl(items[at].path));
        return;
    }
    let i = Math.max(0, Math.min(at, items.length - 1));
    const name = h('span', { class: 'mv-name' }), meta = h('span', { class: 'mv-meta' });
    const stage = h('div', { class: 'mv-stage' });
    const btn = (icon, label, run) => h('button', { class: 'mv-btn', title: label, 'aria-label': label, onclick: run }, iconSvg(icon, 16));
    const strip = h('div', { class: 'mv-strip' });
    const many = items.length > 1;
    const win = h('div', { class: 'mv-win', role: 'dialog', 'aria-label': 'Viewer' }, h('div', { class: 'mv-bar' }, name, meta, h('span', { class: 'mv-gap' }), btn('external', 'Open in new tab', () => openMediaInTab(ctx, items[i].path)), btn('download', 'Download', () => void downloadMedia(ctx, items[i].path)), ...(ctx.ws.storage.reveal ? [btn('folder', revealLabel(ctx), () => revealMedia(ctx, items[i].path))] : []), h('span', { class: 'mv-sep' }), h('button', { class: 'mv-btn', title: 'Close', 'aria-label': 'Close', onclick: () => close() }, svgIcon(ICONS.close, 16))), h('div', { class: 'mv-body' }, stage, many ? h('button', { class: 'mv-nav l', 'aria-label': 'Previous', onclick: () => step(-1) }, iconSvg('chevron-left', 20)) : null, many ? h('button', { class: 'mv-nav r', 'aria-label': 'Next', onclick: () => step(1) }, iconSvg('chevron-right', 20)) : null), many ? strip : null);
    const box = h('div', { class: 'overlay mv', onclick: (e) => { if (e.target === box)
            close(); } }, win);
    const show = () => {
        const it = items[i], t = mediaType(it.path);
        stage.textContent = '';
        stage.className = `mv-stage ${t ?? ''}`;
        name.textContent = fileName(it.path);
        const label = t === 'image' ? 'Photo' : t === 'video' ? 'Video' : t === 'pdf' ? 'PDF' : 'File';
        meta.textContent = label;
        strip.querySelectorAll('.mv-th').forEach((x, k) => x.classList.toggle('cur', k === i));
        void (async () => {
            try {
                const u = await ctx.assetUrl(it.path);
                if (items[i] !== it)
                    return;
                if (t === 'pdf')
                    stage.append(h('iframe', { class: 'mv-pdf', src: await pdfUrl(u), title: fileName(it.path) }));
                else if (t === 'video') {
                    const v = h('video', { class: 'mv-media', src: u, controls: true, autoplay: true, playsInline: true });
                    v.addEventListener('loadedmetadata', () => { if (items[i] === it && Number.isFinite(v.duration))
                        meta.textContent = [meta.textContent, dur(v.duration)].join(' · '); });
                    stage.append(v);
                }
                else
                    stage.append(h('img', { class: 'mv-media', src: u, alt: '' }));
                // the size, when it can be found out (not needed to show the file)
                void fetch(u).then((r) => r.ok ? r.blob() : null).then((b) => { if (b && items[i] === it)
                    meta.textContent = `${meta.textContent} · ${sizeLabel(b.size)}`; }).catch(() => { });
            }
            catch (e) {
                stage.append(h('div', { class: 'mv-err' }, `Could not load ${fileName(it.path)}`));
                void e;
            }
        })();
    };
    const step = (n) => { const next = (i + n + items.length) % items.length; if (phone() && mediaType(items[next].path) === 'pdf' && items.some((x) => mediaType(x.path) !== 'pdf')) {
        i = next;
        step(n);
        return;
    } i = next; show(); };
    items.forEach((it, k) => {
        const t = mediaType(it.path);
        const th = h('button', { class: 'mv-th' + (t === 'pdf' ? ' doc' : ''), 'aria-label': fileName(it.path), onclick: () => { i = k; show(); } });
        if (t === 'pdf')
            th.append(iconSvg('file-text', 16));
        else {
            const el = t === 'video' ? h('video', { muted: true, preload: 'metadata', playsInline: true }) : h('img', { alt: '', loading: 'lazy' });
            void ctx.assetUrl(it.path).then((u) => { el.src = t === 'video' ? `${u}#t=0.1` : u; }).catch(() => { });
            th.append(el);
        }
        strip.append(th);
    });
    const key = (e) => {
        if (e.key === 'Escape')
            close();
        else if (e.key === 'ArrowLeft' && many)
            step(-1);
        else if (e.key === 'ArrowRight' && many)
            step(1);
        else if (e.key === ' ' && !e.target?.closest?.('video, iframe'))
            close();
        else
            return;
        e.preventDefault();
        e.stopPropagation();
    };
    // phone: swipe sideways for the next one, down to close
    let sx = 0, sy = 0;
    win.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    win.addEventListener('touchend', (e) => { const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && many)
        step(dx < 0 ? 1 : -1);
    else if (dy > 100 && dy > Math.abs(dx) * 1.5)
        close(); });
    function close() { box.remove(); document.removeEventListener('keydown', key, true); }
    document.body.append(box);
    document.addEventListener('keydown', key, true);
    show();
}
//# sourceMappingURL=viewer.js.map