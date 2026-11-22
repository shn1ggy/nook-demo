// Images and videos can go into the workspace as they are or made smaller first.
//   Images: longest side at most 2560 px (sharp on a Retina screen), JPEG at 82 % – a 4–6 MB phone photo
//   becomes ~0.4–0.8 MB. Small files (< 500 KB), pictures with transparency and anything that would not get
//   smaller stay as they are.
//   Videos: at most 1080p, ~5 Mbit/s with the sound. The browser re-records the video while it plays, so it
//   takes as long as the video (a progress bar shows; Cancel keeps the original).
import { h, svgIcon, ICONS } from '../util.js';
import { dialog, toast } from './pop.js';
import { iconSvg } from './icons.js';
const MAX_SIDE = 2560, QUALITY = 0.82, SMALL = 500 * 1024;
const VIDEO_SIDE = 1920, VIDEO_BPS = 5_000_000, AUDIO_BPS = 128_000;
const isImage = (f) => /^image\/(jpeg|png|heic|heif|webp)$/i.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name);
const isVideo = (f) => /^video\//i.test(f.type) || /\.(mov|mp4|m4v|webm)$/i.test(f.name);
export const compressible = (f) => (isImage(f) && f.size > SMALL) || (isVideo(f) && f.size > 8 * 1024 * 1024);
export const mb = (n) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
/** the picture, smaller – or the same file when that would not help */
export async function compressImage(f) {
    if (!isImage(f) || f.size <= SMALL)
        return f;
    let bmp;
    try {
        bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    }
    catch {
        return f;
    } // a format this browser can't read
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), hgt = Math.round(bmp.height * k);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, w, hgt);
    bmp.close();
    // transparent parts would turn black in a JPEG: such pictures stay as they are
    if (/png|webp/i.test(f.type) && hasAlpha(g, w, hgt))
        return f;
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= f.size * 0.9)
        return f;
    return new File([blob], f.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg', { type: 'image/jpeg', lastModified: f.lastModified });
}
function hasAlpha(g, w, hgt) {
    const step = Math.max(1, Math.floor(Math.sqrt((w * hgt) / 40000)));
    const d = g.getImageData(0, 0, w, hgt).data;
    for (let y = 0; y < hgt; y += step)
        for (let x = 0; x < w; x += step)
            if (d[(y * w + x) * 4 + 3] < 250)
                return true;
    return false;
}
/** can this browser re-record a video? */
function videoSupport() {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream)
        return null;
    for (const t of ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'])
        if (MediaRecorder.isTypeSupported(t))
            return t;
    return null;
}
/** the video, smaller (1080p, ~5 Mbit/s) – plays once in the background while it is recorded */
export async function compressVideo(f, progress, cancelled) {
    const type = videoSupport();
    if (!type)
        return f;
    const url = URL.createObjectURL(f);
    const v = document.createElement('video');
    v.src = url;
    v.playsInline = true;
    v.preload = 'auto';
    v.muted = false;
    v.crossOrigin = 'anonymous';
    try {
        await new Promise((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(new Error('Could not read the video')); });
        const k = Math.min(1, VIDEO_SIDE / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * k / 2) * 2, hgt = Math.round(v.videoHeight * k / 2) * 2;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = hgt;
        const g = c.getContext('2d');
        const stream = c.captureStream(30);
        // the sound goes into the recording, not to the speakers
        let ac = null;
        try {
            ac = new AudioContext();
            const src = ac.createMediaElementSource(v), dest = ac.createMediaStreamDestination();
            src.connect(dest);
            for (const t of dest.stream.getAudioTracks())
                stream.addTrack(t);
        }
        catch { /* no sound track */ }
        const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS });
        const parts = [];
        rec.ondataavailable = (e) => { if (e.data.size)
            parts.push(e.data); };
        const stopped = new Promise((r) => { rec.onstop = () => r(); });
        let live = true;
        const draw = () => { if (!live)
            return; g.drawImage(v, 0, 0, w, hgt); progress(v.duration ? v.currentTime / v.duration : 0); if (cancelled()) {
            v.pause();
            live = false;
            rec.stop();
            return;
        } requestAnimationFrame(draw); };
        rec.start(1000);
        await v.play();
        draw();
        await new Promise((r) => { v.onended = () => r(); const t = setInterval(() => { if (!live) {
            clearInterval(t);
            r();
        } }, 200); });
        live = false;
        if (rec.state !== 'inactive')
            rec.stop();
        await stopped;
        void ac?.close();
        if (cancelled())
            return f;
        const blob = new Blob(parts, { type: 'video/mp4' });
        if (!blob.size || blob.size >= f.size * 0.9)
            return f;
        return new File([blob], f.name.replace(/\.[a-z0-9]+$/i, '') + '.mp4', { type: 'video/mp4', lastModified: f.lastModified });
    }
    catch {
        return f;
    }
    finally {
        URL.revokeObjectURL(url);
        v.removeAttribute('src');
    }
}
/** a rough size for a compressed video (to show before choosing) */
async function videoEstimate(f) {
    const url = URL.createObjectURL(f);
    try {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.src = url;
        await new Promise((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(); setTimeout(bad, 4000); });
        return Math.min(f.size, Math.round(v.duration * (VIDEO_BPS + AUDIO_BPS) / 8));
    }
    catch {
        return f.size;
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
const LAST = 'nook:compress-last';
const remembered = () => { try {
    return localStorage.getItem(LAST) === 'original' ? 'original' : 'compressed';
}
catch {
    return 'compressed';
} };
/** the "Original or compressed?" sheet with real sizes; null when closed */
async function ask(files, images) {
    const orig = files.reduce((s, f) => s + f.size, 0);
    let small = 0;
    for (const f of files)
        small += images.get(f)?.size ?? (isVideo(f) && compressible(f) ? await videoEstimate(f) : f.size);
    const video = files.some((f) => isVideo(f) && compressible(f));
    const last = remembered();
    return new Promise((done) => {
        let picked = null;
        const choose = (k) => { picked = k; try {
            localStorage.setItem(LAST, k);
        }
        catch { /* only a convenience */ } close(); };
        const opt = (k, icon, title, size) => h('button', { class: 'cmp-opt' + (k === last ? ' on' : ''), onclick: () => choose(k) }, iconSvg(icon, 18), h('span', { class: 'cmp-t' }, title), h('span', { class: 'cmp-s' }, size));
        const close = dialog(h('div', { class: 'bwindow cmp-window' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px', flex: 1 } }, files.length === 1 ? files[0].name : `${files.length} files`), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, svgIcon(ICONS.close))), h('div', { class: 'cmp-opts' }, opt('compressed', 'minimize', 'Compressed', `${video ? '≈ ' : ''}${mb(small)}`), opt('original', 'file', 'Original', mb(orig)))), { onClose: () => done(picked) });
    });
}
/** a progress window while videos are re-recorded; Cancel keeps the originals */
function videoProgress() {
    let stop = false;
    const bar = h('div', { class: 'cmp-bar' }, h('i'));
    const label = h('span', { class: 'cmp-plabel' }, 'Compressing video…');
    const close = dialog(h('div', { class: 'bwindow cmp-window' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px', flex: 1 } }, 'Compressing')), h('div', { class: 'cmp-prog' }, label, bar, h('button', { class: 'set-btn', onclick: () => { stop = true; } }, 'Cancel – upload the original'))), { beforeClose: () => { stop = true; return true; } });
    return {
        set: (i, n, p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; label.textContent = `Compressing video${n > 1 ? ` ${i + 1} of ${n}` : ''}… ${Math.round(p * 100)} %`; },
        cancelled: () => stop,
        close,
    };
}
/**
 * Files on their way into the workspace: as they are, compressed, or – with 'ask' – as chosen in a small
 * window that shows both sizes. Returns null when the window was closed (nothing is added then).
 */
export async function prepareUpload(files, mode) {
    const m = mode ?? 'ask';
    if (m === 'original' || !files.some(compressible))
        return files;
    // pictures are quick: done first, so the window can show the real size
    const images = new Map();
    for (const f of files)
        if (isImage(f) && compressible(f))
            images.set(f, await compressImage(f));
    if (m === 'ask') {
        const k = await ask(files, images);
        if (!k)
            return null;
        if (k === 'original')
            return files;
    }
    const videos = files.filter((f) => isVideo(f) && compressible(f));
    const done = new Map();
    if (videos.length) {
        if (!videoSupport())
            toast('This browser can’t compress videos – they are added as they are', 4000);
        else {
            const pr = videoProgress();
            for (let i = 0; i < videos.length && !pr.cancelled(); i++)
                done.set(videos[i], await compressVideo(videos[i], (p) => pr.set(i, videos.length, p), pr.cancelled));
            pr.close();
        }
    }
    return files.map((f) => images.get(f) ?? done.get(f) ?? f);
}
/** one stored file, compressed (⋯ → Compress); null when it would not get smaller */
export async function compressStored(blob, name) {
    const f = new File([blob], name, { type: blob.type || (/\.(mov|mp4|m4v)$/i.test(name) ? 'video/mp4' : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg') });
    if (!compressible(f))
        return null;
    let out;
    if (isImage(f))
        out = await compressImage(f);
    else {
        if (!videoSupport()) {
            toast('This browser can’t compress videos');
            return null;
        }
        const pr = videoProgress();
        out = await compressVideo(f, (p) => pr.set(0, 1, p), pr.cancelled);
        pr.close();
    }
    return out === f ? null : out;
}
//# sourceMappingURL=compress.js.map