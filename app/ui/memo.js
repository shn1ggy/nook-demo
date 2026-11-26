// Voice memos: record in a page (an audio block of kind "memo"), play it back, write it down on this device.
// One sound at a time: recording or playing a memo pauses the music, and the music pauses a memo.
// The phone's bottom bar (and the desktop's top bar pill) show the recording or the memo that plays.
import { h } from '../util.js';
import { iconSvg } from './icons.js';
import { menu, menuIcon, toast } from './pop.js';
import { pi } from './viewer.js';
import { onPlayer, pauseMusic, musicPlaying, setBarOverride, setPillOverride } from './player.js';
const phone = () => document.documentElement.classList.contains('phone');
const fmt = (s) => { s = Math.max(0, Math.round(s)); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const mb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const memoName = (b) => b.text || 'Voice memo';
const changed = () => document.dispatchEvent(new CustomEvent('nook-memo'));
let rec = null;
export const recordingBlock = () => rec?.block ?? null;
const elapsed = () => (rec ? rec.acc + (rec.paused ? 0 : Date.now() - rec.t0) : 0);
/** M4A (AAC, mono, 48 kbps) where the browser can – it plays everywhere; else what the browser records */
function pickMime() {
    for (const m of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'])
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m))
            return m;
    return '';
}
export async function startRecording(block, host) {
    if (rec) {
        toast('A memo is already being recorded');
        return;
    }
    stopMemo();
    pauseMusic();
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    }
    catch {
        toast('Nook may not use the microphone – allow it in the browser’s settings');
        return;
    }
    const mime = pickMime();
    const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48000 });
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(an);
    rec = { mr, stream, chunks: [], t0: Date.now(), acc: 0, paused: false, block, host, an, ac, mime: mr.mimeType || mime };
    mr.ondataavailable = (e) => { if (e.data.size)
        rec?.chunks.push(e.data); };
    mr.start(1000);
    showRecBars();
    changed();
}
export function pauseRecording() {
    if (!rec)
        return;
    if (rec.paused) {
        rec.mr.resume();
        rec.t0 = Date.now();
        rec.paused = false;
    }
    else {
        rec.mr.pause();
        rec.acc += Date.now() - rec.t0;
        rec.paused = true;
    }
    changed();
}
function endRec() { if (!rec)
    return; rec.stream.getTracks().forEach((t) => t.stop()); void rec.ac.close().catch(() => { }); rec = null; setBarOverride(null); setPillOverride(null); changed(); }
export function cancelRecording() { if (!rec)
    return; rec.mr.onstop = null; try {
    rec.mr.stop();
}
catch { /* stopped */ } endRec(); }
export function stopRecording() {
    if (!rec)
        return;
    const r = rec, dur = elapsed() / 1000;
    r.mr.onstop = async () => {
        const ext = /mp4|aac/.test(r.mime) ? 'm4a' : 'webm';
        const blob = new Blob(r.chunks, { type: r.mime.split(';')[0] || 'audio/mp4' });
        endRec();
        const d = new Date(), p = (n) => String(n).padStart(2, '0');
        const name = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())} Memo.${ext}`;
        try {
            const path = r.host.ctx.ws.newFilePath(r.host.file, name);
            await r.host.ctx.ws.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
            r.block.src = path;
            r.block.text = `Memo ${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`;
            r.block.data = { ...(r.block.data ?? {}), dur: Math.round(dur), size: blob.size };
            r.host.save();
            changed();
        }
        catch (e) {
            toast(`Could not save the memo: ${e.message}`);
        }
    };
    r.mr.stop();
}
function level() {
    if (!rec || rec.paused)
        return 0;
    const a = new Uint8Array(rec.an.fftSize);
    rec.an.getByteTimeDomainData(a);
    let s = 0;
    for (const v of a) {
        const x = (v - 128) / 128;
        s += x * x;
    }
    return Math.min(1, Math.sqrt(s / a.length) * 4);
}
function levelBars(n = 5) {
    const el = h('span', { class: 'memo-lvl' }, ...Array.from({ length: n }, () => h('i')));
    const tick = () => { if (!el.isConnected && el.dataset.on)
        return; el.dataset.on = '1'; const l = level(); [...el.children].forEach((c, i) => { c.style.height = `${Math.max(3, Math.round((0.35 + 0.65 * Math.abs(Math.sin(Date.now() / 140 + i * 1.7))) * l * 20))}px`; }); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    return el;
}
/** the bars while recording: phone (instead of the tabs) and desktop (a pill in the top bar) */
function showRecBars() {
    const time = (cls) => { const t = h('span', { class: cls }); const run = () => { if (!rec)
        return; t.textContent = fmt(elapsed() / 1000); setTimeout(run, 250); }; run(); return t; };
    const pp = () => { const b = h('button', { class: 'memo-bb', 'aria-label': 'Pause', onclick: (e) => { e.stopPropagation(); pauseRecording(); } }, pi('pause', 20)); document.addEventListener('nook-memo', () => b.replaceChildren(pi(rec?.paused ? 'play' : 'pause', 20))); return b; };
    const stop = () => h('button', { class: 'memo-stop', 'aria-label': 'Stop and save', onclick: (e) => { e.stopPropagation(); stopRecording(); } }, h('i'));
    const where = rec?.host.pageId ? rec.host.ctx.ws.pages.get(rec.host.pageId)?.title ?? '' : '';
    setBarOverride(h('div', { class: 'memo-bar' }, h('button', { class: 'memo-bb dim', 'aria-label': 'Discard', onclick: (e) => { e.stopPropagation(); cancelRecording(); } }, pi('x', 16)), h('span', { class: 'memo-bt' }, h('b', null, h('span', { class: 'memo-dot' }), time('')), h('small', null, where ? `into ${where}` : 'Recording')), levelBars(), pp(), stop()));
    setPillOverride(h('span', { class: 'memo-pill' }, h('span', { class: 'memo-dot' }), time('memo-pt'), where ? h('span', { class: 'memo-pw' }, where) : null, h('button', { class: 'ppill-pp', 'aria-label': 'Pause', onclick: () => pauseRecording() }, pi('pause', 13)), h('button', { class: 'memo-pstop', 'aria-label': 'Stop and save', title: 'Stop and save', onclick: () => stopRecording() }, h('i'))));
}
// ---------- playing ----------
const audio = document.createElement('audio');
audio.preload = 'metadata';
let playing = null;
export const playingBlock = () => playing?.block ?? null;
audio.addEventListener('play', () => { pauseMusic(); changed(); });
audio.addEventListener('pause', changed);
audio.addEventListener('ended', () => { audio.currentTime = 0; changed(); });
audio.addEventListener('timeupdate', () => document.dispatchEvent(new CustomEvent('nook-memo-time')));
onPlayer(() => { if (musicPlaying() && !audio.paused)
    audio.pause(); });
async function playMemo(block, host, at) {
    if (rec) {
        toast('Stop the recording first');
        return;
    }
    if (playing?.block !== block) {
        try {
            audio.src = await host.ctx.assetUrl(block.src ?? '');
        }
        catch {
            toast('The memo’s audio file is missing');
            return;
        }
        playing = { block, host };
        showMemoBars();
    }
    if (at != null)
        audio.currentTime = at;
    await audio.play().catch(() => { });
}
function toggleMemo() { if (audio.paused)
    void audio.play();
else
    audio.pause(); }
export function stopMemo() { if (!playing)
    return; audio.pause(); playing = null; setBarOverride(null); setPillOverride(null); changed(); }
function goBack() {
    const p = playing;
    if (!p?.host.pageId)
        return;
    p.host.ctx.openPage(p.host.pageId);
    setTimeout(() => document.querySelector(`[data-id="${p.block.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
}
function showMemoBars() {
    const p = playing;
    const where = p.host.pageId ? p.host.ctx.ws.pages.get(p.host.pageId)?.title ?? '' : '';
    const sub = h('small'), pt = h('span', { class: 'memo-pw' });
    const tick = () => { sub.textContent = `${where ? `${where} · ` : ''}${fmt(audio.currentTime)}`; pt.textContent = fmt(audio.currentTime); };
    document.addEventListener('nook-memo-time', tick);
    tick();
    const ppb = (n, cls) => { const b = h('button', { class: cls, 'aria-label': 'Play or pause', onclick: (e) => { e.stopPropagation(); toggleMemo(); } }); const d = () => b.replaceChildren(pi(audio.paused ? 'play' : 'pause', n)); d(); document.addEventListener('nook-memo', d); return b; };
    const bar = h('div', { class: 'memo-bar', onclick: goBack }, h('span', { class: 'memo-ico' }, iconSvg('mic', 18)), h('span', { class: 'memo-bt' }, h('b', null, memoName(p.block)), sub), h('button', { class: 'memo-bb', 'aria-label': '15 seconds back', onclick: (e) => { e.stopPropagation(); audio.currentTime = Math.max(0, audio.currentTime - 15); } }, pi('back', 19)), ppb(20, 'memo-bb'), h('button', { class: 'memo-bb dim', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); stopMemo(); } }, pi('x', 16)));
    setBarOverride(bar);
    setPillOverride(h('span', { class: 'memo-pill' }, h('button', { class: 'memo-pname', title: 'Back to the memo', onclick: goBack }, iconSvg('mic', 13), memoName(p.block)), pt, ppb(13, 'ppill-pp'), h('button', { class: 'ppill-b', 'aria-label': 'Close', title: 'Close', onclick: stopMemo }, pi('x', 13))));
}
// ---------- writing it down (on this device, free: Whisper in the browser) ----------
/** writing memos down needs the page's security rules (web/index.html) to allow the speech library from cdn.jsdelivr.net
 *  and WebAssembly ('wasm-unsafe-eval'); it turns itself on once they do */
export const TX_ENABLED = (() => { const c = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? ''; return /script-src[^;]*cdn\.jsdelivr\.net/.test(c) && /wasm-unsafe-eval/.test(c); })();
const TX_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
let asr = null;
const jobs = new Map();
export const txSettings = (ctx) => ({ model: ctx.ws.settings.memoModel === 'base' ? 'base' : 'small', lang: ctx.ws.settings.memoLang ?? 'auto' });
function loadAsr(model, onNote) {
    if (asr)
        return asr;
    asr = (async () => {
        onNote('Loading the speech model (once)…');
        const lib = await import(/* @vite-ignore */ TX_LIB);
        lib.env.allowLocalModels = false;
        return lib.pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}`, {
            dtype: 'q8', device: 'wasm',
            progress_callback: (p) => { if (p.status === 'progress' && p.progress != null)
                onNote(`Loading the speech model (once)… ${Math.round(p.progress)} %`); },
        });
    })();
    asr.catch(() => { asr = null; });
    return asr;
}
async function pcm16k(url) {
    const buf = await (await fetch(url)).arrayBuffer();
    const ac = new AudioContext();
    const dec = await ac.decodeAudioData(buf);
    void ac.close();
    const off = new OfflineAudioContext(1, Math.ceil(dec.duration * 16000), 16000);
    const src = off.createBufferSource();
    src.buffer = dec;
    src.connect(off.destination);
    src.start();
    return (await off.startRendering()).getChannelData(0);
}
/** in pieces of 30 s, each saved at once – a memo stopped half-way goes on from there */
async function writeDown(block, host, again = false) {
    if (jobs.has(block.id))
        return;
    const d = (block.data ??= {});
    if (again) {
        d.tx = [];
        d.txNext = 0;
        d.txDone = false;
    }
    const job = { pct: 0, note: 'Getting ready…' };
    jobs.set(block.id, job);
    changed();
    try {
        const { model, lang } = txSettings(host.ctx);
        const run = await loadAsr(model, (s) => { job.note = s; changed(); });
        job.note = 'Writing it down';
        changed();
        const pcm = await pcm16k(await host.ctx.assetUrl(block.src ?? ''));
        const step = 30 * 16000, n = Math.ceil(pcm.length / step);
        d.tx ??= [];
        for (let i = d.txNext ?? 0; i < n; i++) {
            const piece = pcm.subarray(i * step, Math.min(pcm.length, (i + 1) * step));
            const r = await run(piece, { task: 'transcribe', ...(lang === 'de' ? { language: 'german' } : lang === 'en' ? { language: 'english' } : {}) });
            const text = (r.text ?? '').trim();
            if (text)
                d.tx.push({ t: i * 30, text });
            d.txNext = i + 1;
            job.pct = Math.round(((i + 1) / n) * 100);
            host.save();
            changed();
        }
        d.txDone = true;
        delete d.txNext;
        host.save();
    }
    catch (e) {
        toast(`Could not write it down: ${e.message}`);
    }
    finally {
        jobs.delete(block.id);
        changed();
    }
}
// ---------- the block ----------
export function memoBlock(b, host, readonly = false) {
    const box = h('div', { class: 'memo' });
    let open = false;
    const draw = () => {
        if (!box.isConnected && box.dataset.drawn) {
            document.removeEventListener('nook-memo', draw);
            return;
        }
        box.dataset.drawn = '1';
        const d = (b.data ?? {});
        box.replaceChildren();
        // recording here
        if (rec?.block === b) {
            const t = h('small', null, 'Recording');
            box.append(h('div', { class: 'memo-row' }, h('span', { class: 'memo-pb rec' }, iconSvg('mic', 16)), h('span', { class: 'memo-t' }, h('b', null, h('span', { class: 'memo-dot' }), h('span', { class: 'memo-time' }, fmt(elapsed() / 1000))), t), ...(phone() ? [] : [levelBars(),
                h('button', { class: 'memo-btn', onclick: () => pauseRecording() }, pi(rec.paused ? 'play' : 'pause', 13), rec.paused ? 'Go on' : 'Pause'),
                h('button', { class: 'memo-btn strong', onclick: () => stopRecording() }, 'Stop')])));
            const tm = box.querySelector('.memo-time');
            const run = () => { if (rec?.block !== b)
                return; tm.textContent = fmt(elapsed() / 1000); t.textContent = rec.paused ? 'Paused' : 'Recording'; setTimeout(run, 250); };
            run();
            return;
        }
        // nothing yet
        if (!b.src) {
            const file = h('input', { type: 'file', accept: 'audio/*', style: { display: 'none' } });
            file.addEventListener('change', async () => {
                const f = file.files?.[0];
                if (!f)
                    return;
                const path = host.ctx.ws.newFilePath(host.file, f.name || 'audio.m4a');
                await host.ctx.ws.writeFile(path, new Uint8Array(await f.arrayBuffer()));
                b.src = path;
                b.text = f.name.replace(/\.[^.]+$/, '');
                b.data = { size: f.size };
                host.save();
                changed();
            });
            box.append(h('div', { class: 'memo-row' }, h('span', { class: 'memo-pb rec' }, iconSvg('mic', 16)), h('span', { class: 'memo-t' }, h('b', null, 'Voice memo'), h('small', null, 'Nothing recorded yet')), ...(readonly ? [] : [h('button', { class: 'memo-btn', onclick: () => file.click() }, iconSvg('upload', 14), 'Add a file'),
                h('button', { class: 'memo-btn red', onclick: () => void startRecording(b, host) }, 'Record')]), file));
            return;
        }
        // saved
        const mine = playing?.block === b, on = mine && !audio.paused;
        const pb = h('button', { class: 'memo-pb', 'aria-label': on ? 'Pause' : 'Play', onclick: () => (mine ? toggleMemo() : void playMemo(b, host)) }, pi(on ? 'pause' : 'play', 15));
        const sub = [d.dur ? fmt(d.dur) : '', d.txDone && d.tx?.length ? (d.lang ?? '') : d.size ? mb(d.size) : ''].filter(Boolean).join(' · ');
        const more = h('button', { class: 'memo-more', 'aria-label': 'More' }, pi('more', 18));
        more.addEventListener('click', () => {
            const text = (d.tx ?? []).map((x) => x.text).join('\n\n');
            menu(more, [
                ...(text ? [
                    { label: 'Copy text', icon: menuIcon('clipboard'), run: () => { void navigator.clipboard.writeText(text).then(() => toast('Copied')); } },
                    ...(host.insertAfter && !readonly ? [{ label: 'Turn into page text', icon: menuIcon('align-left'), run: () => host.insertAfter((d.tx ?? []).map((x) => ({ id: crypto.randomUUID().replace(/-/g, '').slice(0, 20), type: 'paragraph', text: x.text }))) }] : []),
                    ...(!readonly ? [{ label: 'Write it down again', icon: menuIcon('refresh'), run: () => void writeDown(b, host, true) }] : []),
                ] : []),
                { label: 'Download audio', icon: menuIcon('download'), run: async () => { const a = h('a', { href: await host.ctx.assetUrl(b.src ?? ''), download: (b.src ?? '').split('/').pop() ?? 'memo.m4a' }); document.body.appendChild(a); a.click(); a.remove(); } },
                ...(host.remove && !readonly ? ['sep', { label: 'Delete', icon: menuIcon('trash'), danger: true, run: () => { if (playing?.block === b)
                            stopMemo(); host.remove(); } }] : []),
            ]);
        });
        const seek = h('div', { class: 'memo-seek' }, h('i'));
        const paint = () => { const dd = (mine && audio.duration) || d.dur || 0; seek.firstChild.style.width = `${mine && dd ? (audio.currentTime / dd) * 100 : 0}%`; };
        seek.addEventListener('click', (e) => { const r = seek.getBoundingClientRect(), x = (e.clientX - r.left) / r.width; void playMemo(b, host, x * (audio.duration || d.dur || 0)); });
        document.addEventListener('nook-memo-time', function t() { if (!seek.isConnected) {
            document.removeEventListener('nook-memo-time', t);
            return;
        } paint(); });
        paint();
        box.append(h('div', { class: 'memo-row' }, pb, h('span', { class: 'memo-t' }, h('b', null, memoName(b)), h('small', null, sub)), more), seek);
        // the text
        const job = jobs.get(b.id);
        if (job)
            box.append(h('div', { class: 'memo-prog' }, h('span', null, job.note), h('span', { class: 'memo-pbar' }, h('i', { style: { width: `${job.pct}%` } })), h('span', null, `${job.pct} %`)));
        if (d.tx?.length) {
            const paras = d.tx.map((x) => h('div', { class: 'memo-para' }, h('button', { class: 'memo-ts', title: 'Play from here', onclick: () => void playMemo(b, host, x.t) }, fmt(x.t)), h('span', null, x.text)));
            const long = paras.length > 3 || d.tx.reduce((n, x) => n + x.text.length, 0) > 600;
            box.append(h('div', { class: 'memo-tx' + (long && !open ? ' folded' : '') }, ...paras));
            if (long)
                box.append(h('button', { class: 'memo-btn', onclick: () => { open = !open; draw(); } }, open ? 'Show less' : 'Show all'));
        }
        if (TX_ENABLED && !job && !d.txDone && !readonly) {
            const partly = !!d.tx?.length;
            box.append(h('div', { class: 'memo-wd' }, h('button', { class: 'memo-btn', onclick: () => void writeDown(b, host) }, iconSvg('pen', 14), partly ? 'Go on writing it down' : 'Write it down'), phone() && (d.dur ?? 0) > 120 ? h('span', { class: 'memo-hint' }, 'quicker on a computer') : null));
        }
    };
    document.addEventListener('nook-memo', draw);
    draw();
    return box;
}
/** a new, empty memo block */
export const newMemo = (id) => ({ id, type: 'audio', kind: 'memo', data: {} });
export const isMemo = (b) => b.type === 'audio' && b.kind === 'memo';
//# sourceMappingURL=memo.js.map