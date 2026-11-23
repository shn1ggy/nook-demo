// The media viewer: photos, videos and PDFs in a window over the page (90 % of the screen, the page behind blurred).
// ← → (and the strip at the bottom) go through all of them; the bar has new tab, download, show in Dropbox, close.
// On the phone it fills the screen and swipes; PDFs open in the system's viewer there (Safari shows only the first
// page of a PDF inside a page).
import { h, svgIcon, ICONS } from '../util.js';
import { iconSvg } from './icons.js';
import { menu, menuIcon, toast } from './pop.js';
import { openPdfFull, pdfUrl } from './pdf.js';
export const mediaType = (p) => /\.(png|jpe?g|gif|webp|avif|svg|heic)$/i.test(p) ? 'image' : /\.(mp4|mov|m4v|webm)$/i.test(p) ? 'video' : /\.pdf$/i.test(p) ? 'pdf' : /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(p) ? 'audio' : null;
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
    if (phone()) {
        phoneViewer(ctx, items, at);
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
        const label = t === 'image' ? 'Photo' : t === 'video' ? 'Video' : t === 'pdf' ? 'PDF' : t === 'audio' ? 'Audio' : 'File';
        meta.textContent = label;
        strip.querySelectorAll('.mv-th').forEach((x, k) => x.classList.toggle('cur', k === i));
        void (async () => {
            try {
                const u = await ctx.assetUrl(it.path);
                if (items[i] !== it)
                    return;
                if (t === 'pdf')
                    stage.append(h('iframe', { class: 'mv-pdf', src: await pdfUrl(u), title: fileName(it.path) }));
                else if (t === 'audio')
                    stage.append(h('div', { class: 'mv-audio' }, iconSvg('music', 48), h('audio', { src: u, controls: true, autoplay: true })));
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
        const th = h('button', { class: 'mv-th' + (t === 'pdf' || t === 'audio' ? ' doc' : ''), 'aria-label': fileName(it.path), onclick: () => { i = k; show(); } });
        if (t === 'pdf' || t === 'audio')
            th.append(iconSvg(t === 'pdf' ? 'file-text' : 'music', 16));
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
// ---------- the phone viewer: full screen over everything (the tab bar too), round buttons on top, the actions in
// one floating bar at the bottom; photos zoom with two fingers or a double tap, one tap hides the bars ----------
const P = {
    x: '<path d="M6 6l12 12M18 6L6 18"/>', more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>', save: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', open: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    vol: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/>', mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 10l4 4M21 10l-4 4"/>',
    pip: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1"/>',
    back: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', fwd: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    speed: '<path d="M12 21a9 9 0 1 1 9-9"/><path d="M12 12l4-4"/>', play: '<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>', pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
};
const pi = (k, n = 21) => { const t = document.createElement('template'); t.innerHTML = `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[k]}</svg>`; return t.content.firstChild; };
export async function shareMedia(ctx, p) {
    try {
        const b = await blobOf(ctx, p);
        const f = new File([b], fileName(p), { type: b.type || (mediaType(p) === 'pdf' ? 'application/pdf' : '') });
        if (navigator.canShare?.({ files: [f] })) {
            try {
                await navigator.share({ files: [f], title: f.name });
                return;
            }
            catch (e) {
                if (e.name === 'AbortError')
                    return;
            }
        }
        void downloadMedia(ctx, p);
    }
    catch (e) {
        toast(e.message);
    }
}
function phoneViewer(ctx, items, at) {
    let i = Math.max(0, Math.min(at, items.length - 1));
    const many = items.length > 1;
    const name = h('span', { class: 'mvp-name' }), meta = h('small', { class: 'mvp-meta' });
    const stage = h('div', { class: 'mvp-stage' });
    const bar = h('div', { class: 'mvp-bar' });
    const dots = h('div', { class: 'mvp-dots' });
    const extra = h('div', { class: 'mvp-extra' }); // play controls and the seek bar (video, audio)
    const more = h('button', { class: 'mvp-rb', 'aria-label': 'More' }, pi('more'));
    const box = h('div', { class: 'overlay mv mvp' }, stage, extra, h('div', { class: 'mvp-top' }, h('button', { class: 'mvp-rb', 'aria-label': 'Close', onclick: () => close() }, pi('x')), h('div', { class: 'mvp-title' }, name, meta), more), dots, bar);
    let cleanup = null;
    const act = (k, label, run) => { const b = h('button', { class: 'mvp-act', onclick: run }, pi(k), h('span', null, label)); return b; };
    more.addEventListener('click', () => {
        const it = items[i];
        const r = more.getBoundingClientRect();
        menu({ x: r.right, y: r.bottom }, [
            { label: 'Open in Safari', icon: menuIcon('external'), run: () => mediaType(it.path) === 'pdf' ? openPdfFull(() => ctx.assetUrl(it.path)) : openMediaInTab(ctx, it.path) },
            ...(ctx.ws.storage.reveal ? [{ label: revealLabel(ctx), icon: menuIcon('folder'), run: () => revealMedia(ctx, it.path) }] : []),
            ...(it.open ? ['sep', { label: it.entryName ? `Open entry · ${it.entryName}` : 'Open entry', icon: menuIcon('file-text'), run: () => { close(); it.open(); } }] : []),
        ]);
    });
    // zoom state of the current photo
    let zoomEl = null, z = 1, tx = 0, ty = 0;
    const applyZoom = (anim = false) => { if (!zoomEl)
        return; zoomEl.style.transition = anim ? 'transform .22s ease' : 'none'; zoomEl.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`; box.classList.toggle('zoomed', z > 1.01); };
    const clampPan = () => {
        if (!zoomEl)
            return;
        const w = zoomEl.offsetWidth, hh = zoomEl.offsetHeight, W = stage.clientWidth, H = stage.clientHeight;
        const mx = Math.max(0, (w * z - W) / 2), my = Math.max(0, (hh * z - H) / 2);
        tx = Math.max(-mx, Math.min(mx, tx));
        ty = Math.max(-my, Math.min(my, ty));
    };
    const time = (s) => Number.isFinite(s) ? dur(s) : '0:00';
    const player = (m, audio) => {
        const play = h('button', { class: 'mvp-play', 'aria-label': 'Play' }, pi('play', 26));
        const paint = () => { play.textContent = ''; play.append(pi(m.paused ? 'play' : 'pause', 26)); };
        play.addEventListener('click', () => { if (m.paused)
            void m.play();
        else
            m.pause(); });
        m.addEventListener('play', paint);
        m.addEventListener('pause', paint);
        const fill = h('i'), track = h('div', { class: 'mvp-track' }, fill), cur = h('span'), left = h('span');
        const upd = () => { const d = m.duration || 0; fill.style.width = `${d ? (m.currentTime / d) * 100 : 0}%`; cur.textContent = time(m.currentTime); left.textContent = `−${time(Math.max(0, d - m.currentTime))}`; };
        m.addEventListener('timeupdate', upd);
        m.addEventListener('loadedmetadata', upd);
        const seek = (e) => { const r = track.getBoundingClientRect(); if (m.duration)
            m.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * m.duration; upd(); };
        track.addEventListener('pointerdown', (e) => { e.stopPropagation(); track.setPointerCapture(e.pointerId); seek(e); const mv = (ev) => seek(ev); track.addEventListener('pointermove', mv); track.addEventListener('pointerup', () => track.removeEventListener('pointermove', mv), { once: true }); });
        extra.append(h('div', { class: 'mvp-ctl' + (audio ? ' audio' : '') }, h('button', { class: 'mvp-skip', 'aria-label': 'Back 15 seconds', onclick: () => { m.currentTime = Math.max(0, m.currentTime - 15); } }, pi('back', 24)), play, h('button', { class: 'mvp-skip', 'aria-label': 'Forward 15 seconds', onclick: () => { m.currentTime = Math.min(m.duration || 0, m.currentTime + 15); } }, pi('fwd', 24))), h('div', { class: 'mvp-seek' }, track, h('div', { class: 'mvp-times' }, cur, left)));
        upd();
        paint();
    };
    const show = () => {
        cleanup?.();
        cleanup = null;
        const it = items[i], t = mediaType(it.path);
        stage.textContent = '';
        extra.textContent = '';
        bar.textContent = '';
        box.className = `overlay mv mvp ${t ?? 'file'}`;
        zoomEl = null;
        z = 1;
        tx = 0;
        ty = 0;
        name.textContent = fileName(it.path);
        const pos = many ? `${i + 1} of ${items.length}` : '';
        meta.textContent = [pos, t === 'image' ? '' : t === 'video' ? 'Video' : t === 'audio' ? 'Audio' : t === 'pdf' ? 'PDF' : 'File'].filter(Boolean).join(' · ');
        dots.textContent = '';
        if (many && items.length <= 12)
            items.forEach((_, k) => dots.append(h('i', { class: k === i ? 'on' : '' })));
        const share = act('share', 'Share', () => void shareMedia(ctx, it.path)), save = act('save', 'Save', () => void downloadMedia(ctx, it.path));
        const folder = ctx.ws.storage.reveal ? act('folder', 'In folder', () => revealMedia(ctx, it.path)) : null;
        void (async () => {
            let u;
            try {
                u = await ctx.assetUrl(it.path);
            }
            catch {
                stage.append(h('div', { class: 'mvp-err' }, `Could not load ${fileName(it.path)}`));
                return;
            }
            if (items[i] !== it)
                return;
            if (t === 'image') {
                const img = h('img', { class: 'mvp-img', src: u, alt: '', draggable: 'false' });
                stage.append(img);
                zoomEl = img;
                bar.append(share, save, ...(folder ? [folder] : []));
            }
            else if (t === 'video') {
                const v = h('video', { class: 'mvp-img', src: u, autoplay: true, playsInline: true, preload: 'metadata' });
                v.addEventListener('click', () => { if (v.paused)
                    void v.play();
                else
                    v.pause(); });
                stage.append(v);
                player(v, false);
                const snd = act('vol', 'Sound', () => { v.muted = !v.muted; snd.replaceChild(pi(v.muted ? 'mute' : 'vol'), snd.firstChild); });
                const pip = document.pictureInPictureEnabled || 'webkitSetPresentationMode' in v
                    ? act('pip', 'Picture', () => { const w = v; if (v.requestPictureInPicture)
                        void v.requestPictureInPicture().catch(() => w.webkitSetPresentationMode?.('picture-in-picture'));
                    else
                        w.webkitSetPresentationMode?.('picture-in-picture'); }) : null;
                bar.append(snd, ...(pip ? [pip] : []), share, save);
                v.addEventListener('loadedmetadata', () => { if (items[i] === it)
                    meta.textContent = [pos, 'Video', dur(v.duration)].filter(Boolean).join(' · '); });
                cleanup = () => v.pause();
            }
            else if (t === 'audio') {
                const a = h('audio', { src: u, preload: 'metadata' });
                stage.append(h('div', { class: 'mvp-cover' }, pi('music', 64)), h('div', { class: 'mvp-atitle' }, fileName(it.path).replace(/\.[^.]+$/, ''), h('small', null, fileName(it.path).split('.').pop().toLowerCase())), a);
                player(a, true);
                const rates = [1, 1.25, 1.5, 2, 0.75];
                const sp = act('speed', '1×', () => { a.playbackRate = rates[(rates.indexOf(a.playbackRate) + 1) % rates.length]; sp.lastElementChild.textContent = `${a.playbackRate}×`.replace('.', ','); });
                bar.append(sp, share, save, ...(folder ? [folder] : []));
                a.addEventListener('loadedmetadata', () => { if (items[i] === it)
                    meta.textContent = [pos, 'Audio', dur(a.duration)].filter(Boolean).join(' · '); });
                cleanup = () => a.pause();
            }
            else {
                // PDFs and other files: Safari can only show the first page of a PDF inside a page, so it opens full screen
                const pdf = t === 'pdf';
                const ext = (fileName(it.path).split('.').pop() ?? '').toUpperCase().slice(0, 4);
                stage.append(h('div', { class: 'mvp-file' }, h('div', { class: 'mvp-fic' }, ext || 'FILE'), h('div', { class: 'mvp-ft' }, fileName(it.path), h('small', { class: 'mvp-fs' }, pdf ? 'PDF' : 'File')), h('button', { class: 'mvp-fopen', onclick: () => pdf ? openPdfFull(() => ctx.assetUrl(it.path)) : void shareMedia(ctx, it.path) }, pdf ? 'Open full screen' : 'Open in another app')));
                bar.append(share, save, ...(folder ? [folder] : []));
            }
            void fetch(u).then((r) => r.ok ? r.blob() : null).then((b) => { if (!b || items[i] !== it)
                return; meta.textContent = `${meta.textContent ? meta.textContent + ' · ' : ''}${sizeLabel(b.size)}`; const fs = stage.querySelector('.mvp-fs'); if (fs)
                fs.textContent = `${fs.textContent} · ${sizeLabel(b.size)}`; }).catch(() => { });
        })();
    };
    const step = (n) => { i = (i + n + items.length) % items.length; show(); };
    // touch: pinch / pan / double tap on photos, swipe sideways for the next one, down to close, tap for the bars
    let start = null, pinch = null;
    let pan = null, lastTap = 0, moved = false, tapTimer = 0;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    stage.addEventListener('touchstart', (e) => {
        moved = false;
        if (e.touches.length === 2 && zoomEl) {
            const [a, b] = [e.touches[0], e.touches[1]], r = stage.getBoundingClientRect();
            pinch = { d: dist(a, b), z, cx: (a.clientX + b.clientX) / 2 - r.left - r.width / 2, cy: (a.clientY + b.clientY) / 2 - r.top - r.height / 2, tx, ty };
            start = null;
            pan = null;
            e.preventDefault();
            return;
        }
        if (e.touches.length === 1) {
            const t = e.touches[0];
            start = { x: t.clientX, y: t.clientY, t: Date.now() };
            pan = z > 1.01 ? { x: t.clientX, y: t.clientY, tx, ty } : null;
        }
    }, { passive: false });
    stage.addEventListener('touchmove', (e) => {
        if (pinch && e.touches.length === 2) {
            e.preventDefault();
            moved = true;
            const nz = Math.max(1, Math.min(6, pinch.z * dist(e.touches[0], e.touches[1]) / pinch.d));
            // keep the point between the fingers where it is
            tx = pinch.cx - (pinch.cx - pinch.tx) * (nz / pinch.z);
            ty = pinch.cy - (pinch.cy - pinch.ty) * (nz / pinch.z);
            z = nz;
            applyZoom();
            return;
        }
        if (pan && e.touches.length === 1) {
            e.preventDefault();
            moved = true;
            tx = pan.tx + e.touches[0].clientX - pan.x;
            ty = pan.ty + e.touches[0].clientY - pan.y;
            applyZoom();
            return;
        }
        if (start && e.touches.length === 1) {
            const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
            if (Math.abs(dx) > 8 || Math.abs(dy) > 8)
                moved = true;
            if (dy > 0 && dy > Math.abs(dx)) {
                e.preventDefault();
                box.style.setProperty('--pull', `${dy}px`);
                box.classList.add('pulling');
            }
        }
    }, { passive: false });
    stage.addEventListener('touchend', (e) => {
        if (pinch) {
            if (e.touches.length < 2) {
                pinch = null;
                if (z < 1.05) {
                    z = 1;
                    tx = 0;
                    ty = 0;
                }
                clampPan();
                applyZoom(true);
            }
            return;
        }
        if (pan) {
            pan = null;
            clampPan();
            applyZoom(true);
        }
        const s = start;
        start = null;
        box.classList.remove('pulling');
        if (!s)
            return;
        const t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y;
        if (!moved) {
            // a tap: two quick ones zoom the photo, one shows or hides the bars
            const now = Date.now();
            if (zoomEl && now - lastTap < 300) {
                clearTimeout(tapTimer);
                lastTap = 0;
                if (z > 1.01) {
                    z = 1;
                    tx = 0;
                    ty = 0;
                }
                else {
                    const r = stage.getBoundingClientRect();
                    z = 2.5;
                    tx = -(t.clientX - r.left - r.width / 2) * 1.5;
                    ty = -(t.clientY - r.top - r.height / 2) * 1.5;
                    clampPan();
                }
                applyZoom(true);
                e.preventDefault();
                return;
            }
            lastTap = now;
            if (!e.target.closest('video'))
                tapTimer = window.setTimeout(() => box.classList.toggle('bare'), zoomEl ? 300 : 0);
            return;
        }
        if (z > 1.01)
            return;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && many)
            step(dx < 0 ? 1 : -1);
        else if (dy > 110 && dy > Math.abs(dx) * 1.5)
            close();
    });
    const key = (e) => { if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
    } };
    function close() { cleanup?.(); box.remove(); document.removeEventListener('keydown', key, true); }
    document.body.append(box);
    document.addEventListener('keydown', key, true);
    show();
}
//# sourceMappingURL=viewer.js.map