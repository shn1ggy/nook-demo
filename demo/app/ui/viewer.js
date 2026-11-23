// The media viewer: photos, videos and PDFs in a window over the page (90 % of the screen, the page behind blurred).
// ← → (and the strip at the bottom) go through all of them; the bar has new tab, download, show in Dropbox, close.
// On the phone it fills the screen and swipes; PDFs open in the system's viewer there (Safari shows only the first
// page of a PDF inside a page).
import { h, svgIcon, ICONS } from '../util.js';
import { iconSvg } from './icons.js';
import { closePop, menu, menuIcon, toast } from './pop.js';
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
    down: '<path d="M6 9l6 6 6-6"/>', list: '<path d="M4 6h16M4 12h10M4 18h7M17 15v6l4-3z"/>',
    shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>', repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    repeat1: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/><path d="M11 10h1v5"/>',
    prev: '<path d="M19 5L9 12l10 7z" fill="currentColor"/><path d="M5 5v14"/>', next: '<path d="M5 5l10 7-10 7z" fill="currentColor"/><path d="M19 5v14"/>',
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
    const closeBtn = h('button', { class: 'mvp-rb', 'aria-label': 'Close', onclick: () => close() }, pi('x'));
    // songs: one sound element for all of them (the next one may start by itself), the order they play in
    const song = new Audio();
    song.preload = 'metadata';
    const songs = items.map((x, k) => (mediaType(x.path) === 'audio' ? k : -1)).filter((k) => k >= 0);
    let order = [];
    const box = h('div', { class: 'overlay mv mvp' }, stage, extra, h('div', { class: 'mvp-top' }, closeBtn, h('div', { class: 'mvp-title' }, name, meta), more), dots, bar);
    let cleanup = null;
    const act = (k, label, run) => { const b = h('button', { class: 'mvp-act', onclick: run }, pi(k), h('span', null, label)); return b; };
    // a second tap closes the menu (the tap outside it already closes it on touch-down: then it must not open again)
    let wasOpen = false;
    more.addEventListener('pointerdown', () => { wasOpen = !!document.querySelector('.pop:not(.pop-closing)'); }, true);
    more.addEventListener('click', () => {
        if (wasOpen || document.querySelector('.pop:not(.pop-closing)')) {
            wasOpen = false;
            closePop();
            return;
        }
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
        closeBtn.replaceChildren(pi(t === 'audio' ? 'down' : 'x'));
        if (t !== 'audio')
            song.pause();
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
                audioView(it, u);
            }
            else {
                // PDFs and other files: Safari can only show the first page of a PDF inside a page, so it opens full screen
                const pdf = t === 'pdf';
                const ext = (fileName(it.path).split('.').pop() ?? '').toUpperCase().slice(0, 4);
                stage.append(h('div', { class: 'mvp-file' }, h('div', { class: 'mvp-fic' }, ext || 'FILE'), h('div', { class: 'mvp-ft' }, fileName(it.path), h('small', { class: 'mvp-fs' }, pdf ? 'PDF' : 'File')), h('button', { class: 'mvp-fopen', onclick: () => pdf ? openPdfFull(() => ctx.assetUrl(it.path)) : void shareMedia(ctx, it.path) }, pdf ? 'Open full screen' : 'Open in another app')));
                bar.append(share, save, ...(folder ? [folder] : []));
            }
            if (t !== 'audio' && t !== 'video')
                void fetch(u).then((r) => r.ok ? r.blob() : null).then((b) => { if (!b || items[i] !== it)
                    return; meta.textContent = `${meta.textContent ? meta.textContent + ' · ' : ''}${sizeLabel(b.size)}`; const fs = stage.querySelector('.mvp-fs'); if (fs)
                    fs.textContent = `${fs.textContent} · ${sizeLabel(b.size)}`; }).catch(() => { });
        })();
    };
    /** the order songs play in: as in the folder, or shuffled (the one playing first) */
    const makeOrder = () => { order = [...songs]; if (playMode.shuffle) {
        const rest = order.filter((k) => k !== i);
        for (let x = rest.length - 1; x > 0; x--) {
            const y = Math.floor(Math.random() * (x + 1));
            [rest[x], rest[y]] = [rest[y], rest[x]];
        }
        order = [i, ...rest];
    } };
    const nextSong = (dir, auto = false) => {
        if (!order.includes(i))
            makeOrder();
        if (auto && playMode.repeat === 'one') {
            song.currentTime = 0;
            void song.play();
            return true;
        }
        let k = order.indexOf(i) + dir;
        if (k >= order.length || k < 0) {
            if (!auto || playMode.repeat === 'all')
                k = (k + order.length) % order.length;
            else
                return false;
        }
        i = order[k];
        show();
        return true;
    };
    song.addEventListener('ended', () => { if (!nextSong(1, true)) {
        song.currentTime = 0;
    } });
    const audioView = (it, u) => {
        const title = fileName(it.path).replace(/\.[^.]+$/, ''), ext = (fileName(it.path).split('.').pop() ?? '').toLowerCase();
        const place = it.place ?? '';
        name.textContent = place;
        meta.textContent = '';
        const nth = songs.indexOf(i) + 1;
        stage.append(h('div', { class: 'mvp-cover' }, pi('music', 64)), h('div', { class: 'mvp-atitle' }, title, h('small', null, [ext, songs.length > 1 ? `${nth} of ${songs.length}${place ? ` in ${place.split(' › ').pop()}` : ''}` : ''].filter(Boolean).join(' · '))));
        if (song.src !== u) {
            song.src = u;
            song.playbackRate = playMode.rate;
        }
        void song.play().catch(() => { });
        // the seek bar: tap or drag to go there
        const fill = h('i'), track = h('div', { class: 'mvp-track' }, fill);
        const cur = h('span'), left = h('span');
        const paint = () => {
            const d = song.duration || 0;
            fill.style.width = `${d ? (song.currentTime / d) * 100 : 0}%`;
            cur.textContent = dur(song.currentTime || 0);
            left.textContent = `−${dur(Math.max(0, d - (song.currentTime || 0)))}`;
        };
        const seek = (e) => { const r = track.getBoundingClientRect(); if (song.duration)
            song.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * song.duration; paint(); };
        track.addEventListener('pointerdown', (e) => { e.stopPropagation(); track.setPointerCapture(e.pointerId); seek(e); const mv = (ev) => seek(ev); track.addEventListener('pointermove', mv); track.addEventListener('pointerup', () => track.removeEventListener('pointermove', mv), { once: true }); });
        track.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        const play = h('button', { class: 'mvp-play', 'aria-label': 'Play or pause' });
        const paintPlay = () => play.replaceChildren(pi(song.paused ? 'play' : 'pause', 30));
        play.addEventListener('click', () => { if (song.paused)
            void song.play();
        else
            song.pause(); });
        const shuf = h('button', { class: 'mvp-mode' + (playMode.shuffle ? ' on' : ''), 'aria-label': 'Shuffle', onclick: () => { playMode.shuffle = !playMode.shuffle; saveMode(); makeOrder(); shuf.classList.toggle('on', playMode.shuffle); toast(playMode.shuffle ? 'Shuffle on' : 'Shuffle off', 1200); } }, pi('shuffle', 22));
        const rep = h('button', { class: 'mvp-mode' + (playMode.repeat !== 'off' ? ' on' : ''), 'aria-label': 'Repeat' });
        const paintRep = () => { rep.classList.toggle('on', playMode.repeat !== 'off'); rep.replaceChildren(pi(playMode.repeat === 'one' ? 'repeat1' : 'repeat', 22)); };
        rep.addEventListener('click', () => { playMode.repeat = playMode.repeat === 'off' ? 'all' : playMode.repeat === 'all' ? 'one' : 'off'; saveMode(); paintRep(); toast(playMode.repeat === 'off' ? 'Repeat off' : playMode.repeat === 'all' ? 'Repeat the folder' : 'Repeat this song', 1200); });
        paintRep();
        const prev = h('button', { class: 'mvp-skip', 'aria-label': 'Previous', onclick: () => { if (song.currentTime > 3 || songs.length < 2) {
                song.currentTime = 0;
                return;
            } nextSong(-1); } }, pi('prev', 30));
        const next = h('button', { class: 'mvp-skip', 'aria-label': 'Next', onclick: () => { if (songs.length > 1)
                nextSong(1); } }, pi('next', 30));
        const rates = [1, 1.25, 1.5, 2, 0.75];
        const chip = (icon, label, run) => { const b = h('button', { class: 'mvp-chip' }, pi(icon, 16), h('span', null, label)); b.addEventListener('click', () => run(b)); return b; };
        const speed = chip('speed', `${playMode.rate}×`.replace('.', ','), (b) => { playMode.rate = rates[(rates.indexOf(playMode.rate) + 1) % rates.length]; song.playbackRate = playMode.rate; saveMode(); b.lastElementChild.textContent = `${playMode.rate}×`.replace('.', ','); b.classList.toggle('on', playMode.rate !== 1); });
        speed.classList.toggle('on', playMode.rate !== 1);
        const upNext = chip('list', 'Up next', (b) => {
            if (!order.includes(i))
                makeOrder();
            const from = order.indexOf(i);
            const list = [...order.slice(from), ...order.slice(0, from)];
            const r = b.getBoundingClientRect();
            menu({ x: r.left, y: r.top }, [{ section: playMode.shuffle ? 'Up next · shuffled' : 'Up next' }, ...list.map((k) => ({ label: fileName(items[k].path).replace(/\.[^.]+$/, ''), icon: menuIcon('music'), checked: k === i, run: () => { i = k; show(); } }))]);
        });
        // the iPhone shares only right on the tap: the first tap fetches the song, the second shares it
        let ready = null;
        const share = chip('share', 'Share', (b) => {
            if (ready) {
                void navigator.share({ files: [ready], title: ready.name }).catch(() => { });
                return;
            }
            const lab = b.lastElementChild;
            lab.textContent = 'Preparing…';
            void blobOf(ctx, it.path).then((bl) => {
                ready = new File([bl], fileName(it.path), { type: bl.type || 'audio/mpeg' });
                if (!navigator.canShare?.({ files: [ready] })) {
                    lab.textContent = 'Share';
                    void downloadMedia(ctx, it.path);
                    ready = null;
                    return;
                }
                lab.textContent = 'Tap to share';
                b.classList.add('on');
            }).catch((e) => { lab.textContent = 'Share'; toast(e.message); });
        });
        stage.append(h('div', { class: 'mvp-song-ctl' }, h('div', { class: 'mvp-seek2' }, track, h('div', { class: 'mvp-times' }, cur, left)), h('div', { class: 'mvp-ctl2' }, shuf, prev, play, next, rep), h('div', { class: 'mvp-chips' }, speed, upNext, share)));
        // the lock screen and Control Center: title, play / pause, previous / next, seeking
        const ms = navigator.mediaSession;
        if (ms) {
            try {
                ms.metadata = new MediaMetadata({ title, artist: place || 'Nook', album: place.split(' › ').pop() ?? '', artwork: [{ src: new URL('icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }] });
                ms.setActionHandler('play', () => void song.play());
                ms.setActionHandler('pause', () => song.pause());
                ms.setActionHandler('previoustrack', () => { if (song.currentTime > 3 || songs.length < 2)
                    song.currentTime = 0;
                else
                    nextSong(-1); });
                ms.setActionHandler('nexttrack', songs.length > 1 ? () => nextSong(1) : null);
                ms.setActionHandler('seekto', (d) => { if (d.seekTime != null)
                    song.currentTime = d.seekTime; });
                ms.setActionHandler('seekbackward', null);
                ms.setActionHandler('seekforward', null);
            }
            catch { /* an older iOS: only play / pause */ }
        }
        const pos = () => { try {
            if (ms && song.duration)
                ms.setPositionState({ duration: song.duration, position: Math.min(song.currentTime, song.duration), playbackRate: song.playbackRate });
        }
        catch { /* fine */ } };
        song.addEventListener('loadedmetadata', pos);
        song.addEventListener('seeked', pos);
        song.addEventListener('ratechange', pos);
        const on = () => { paint(); paintPlay(); };
        song.addEventListener('timeupdate', paint);
        song.addEventListener('play', paintPlay);
        song.addEventListener('pause', paintPlay);
        song.addEventListener('loadedmetadata', paint);
        on();
        cleanup = () => { song.removeEventListener('timeupdate', paint); song.removeEventListener('play', paintPlay); song.removeEventListener('pause', paintPlay); song.removeEventListener('loadedmetadata', paint); };
    };
    const step = (n) => { if (mediaType(items[i].path) === 'audio' && songs.length > 1) {
        nextSong(n > 0 ? 1 : -1);
        return;
    } i = (i + n + items.length) % items.length; show(); };
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
            if (!e.target.closest('video') && !box.classList.contains('audio'))
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
        if (document.querySelector('.pop'))
            return; /* a menu over it (pulled down) closes, not the player */
        e.preventDefault();
        e.stopPropagation();
        close();
    } };
    function close() { cleanup?.(); song.pause(); song.removeAttribute('src'); try {
        const m = navigator.mediaSession;
        if (m) {
            m.metadata = null;
            for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'])
                m.setActionHandler(a, null);
        }
    }
    catch { /* fine */ } box.remove(); document.removeEventListener('keydown', key, true); }
    document.body.append(box);
    document.addEventListener('keydown', key, true);
    show();
}
// ---------- songs: shuffle, repeat and speed stay as you left them; the waveform of each song once ----------
const MODE = 'nook:play-mode';
const playMode = (() => { try {
    return { shuffle: false, repeat: 'off', rate: 1, ...JSON.parse(localStorage.getItem(MODE) ?? '{}') };
}
catch {
    return { shuffle: false, repeat: 'off', rate: 1 };
} })();
const saveMode = () => { try {
    localStorage.setItem(MODE, JSON.stringify(playMode));
}
catch { /* only a convenience */ } };
//# sourceMappingURL=viewer.js.map