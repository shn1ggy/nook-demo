// Voice memos: record in a page (an audio block of kind "memo"), play it back, write it down on this device.
// One sound at a time: recording or playing a memo pauses the music, and the music pauses a memo.
// The phone's bottom bar (and the desktop's top bar pill) show the recording or the memo that plays.
import { h } from '../util.js';
import { iconSvg } from './icons.js';
import { menu, menuIcon, toast } from './pop.js';
import { pi } from './viewer.js';
import { onPlayer, pauseMusic, musicPlaying, setBarOverride, setPillOverride } from './player.js';
import { withWebmDuration } from '../webm.js';
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
    an.fftSize = 256;
    an.smoothingTimeConstant = 0.15;
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
        // name and file: full date and time (a file name can't hold ":", so the file has "-" there)
        const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        const name = `Memo ${stamp.replace(/:/g, '-')}.${ext}`;
        try {
            const path = r.host.ctx.ws.newFilePath(r.host.file, name);
            await r.host.ctx.ws.writeFile(path, ext === 'webm' ? withWebmDuration(new Uint8Array(await blob.arrayBuffer()), dur * 1000) : new Uint8Array(await blob.arrayBuffer()));
            r.block.src = path;
            r.block.text = `Memo ${stamp}`;
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
/** the bars follow the voice directly: each one a band of the speech range, every frame */
function bands(n) {
    if (!rec || rec.paused)
        return Array(n).fill(0);
    const f = new Uint8Array(rec.an.frequencyBinCount);
    rec.an.getByteFrequencyData(f);
    // ~100 Hz – 4 kHz at 48 kHz: bins 1…22 of 128
    const lo = 1, hi = 22, out = [];
    for (let i = 0; i < n; i++) {
        const a = Math.floor(lo + ((hi - lo) * i) / n), b = Math.max(a + 1, Math.floor(lo + ((hi - lo) * (i + 1)) / n));
        let m = 0;
        for (let k = a; k < b; k++)
            m = Math.max(m, f[k]);
        out.push(Math.min(1, Math.max(0, (m - 60) / 150)));
    }
    return out;
}
function levelBars(n = 5) {
    const el = h('span', { class: 'memo-lvl' }, ...Array.from({ length: n }, () => h('i')));
    const tick = () => { if (!el.isConnected && el.dataset.on)
        return; el.dataset.on = '1'; const v = bands(n); [...el.children].forEach((c, i) => { c.style.height = `${Math.max(3, Math.round(3 + v[i] * 19))}px`; }); requestAnimationFrame(tick); };
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
window.nookMemoAudio = audio; // for tests
let playing = null;
let memoUrl = '';
function audioType(path, bytes) {
    // what the file is, by its first bytes (else by its name)
    if (bytes && bytes[0] === 0x1a && bytes[1] === 0x45)
        return 'audio/webm';
    if (bytes && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67)
        return 'audio/ogg';
    const e = path.toLowerCase().split('.').pop() ?? '';
    return { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac', caf: 'audio/x-caf' }[e] ?? 'audio/mp4';
}
export const playingBlock = () => playing?.block ?? null;
audio.addEventListener('play', () => { pauseMusic(); changed(); });
audio.addEventListener('pause', changed);
audio.addEventListener('ended', () => { audio.currentTime = 0; changed(); });
audio.addEventListener('timeupdate', () => document.dispatchEvent(new CustomEvent('nook-memo-time')));
onPlayer(() => { if (musicPlaying() && !audio.paused)
    audio.pause(); });
/** the memo being fetched (one at a time – a second click while it loads changes nothing) */
let loading = null;
export const loadingBlock = () => loading;
const metadata = () => audio.readyState >= 1 ? Promise.resolve() : new Promise((r) => { audio.addEventListener('loadedmetadata', () => r(), { once: true }); audio.addEventListener('error', () => r(), { once: true }); });
async function playMemo(block, host, at) {
    if (rec) {
        toast('Stop the recording first');
        return;
    }
    if (playing?.block !== block) {
        if (loading)
            return;
        loading = block;
        changed();
        try {
            // the whole file, with its type, and – for WebM recordings – its length written in: jumping then works
            let url;
            try {
                url = await host.ctx.assetUrl(block.src ?? '');
            }
            catch {
                toast('The memo’s audio file is missing');
                return;
            }
            let bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
            const d = (block.data ?? {});
            if (d.dur)
                bytes = withWebmDuration(bytes, d.dur * 1000);
            const blobUrl = URL.createObjectURL(new Blob([bytes], { type: audioType(block.src ?? '', bytes) }));
            if (memoUrl)
                URL.revokeObjectURL(memoUrl);
            memoUrl = blobUrl;
            audio.pause();
            audio.src = blobUrl;
            playing = { block, host };
            await metadata();
            showMemoBars();
        }
        catch (e) {
            toast(`Could not play the memo: ${e.message}`);
            return;
        }
        finally {
            loading = null;
            changed();
        }
    }
    if (at != null) {
        await metadata();
        audio.currentTime = at;
    }
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
/** the model runs in a worker of its own: the page stays responsive (no "this page slows down the browser")
 *  and the progress can move. Where a worker can't run it, it runs in the page as before. */
const WORKER = `import { pipeline, env } from '${TX_LIB}';
env.allowLocalModels = false;
let pipe = null, cur = '';
self.onmessage = async (e) => {
  const { id, model, audio, opts } = e.data;
  try {
    if (!pipe || cur !== model) {
      pipe = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-' + model, { dtype: 'q8', device: 'wasm',
        progress_callback: (p) => { if (p.status === 'progress' && p.progress != null) self.postMessage({ id, load: Math.round(p.progress) }); } });
      cur = model;
    }
    self.postMessage({ id, ready: true });
    if (audio) self.postMessage({ id, done: await pipe(audio, opts) });
  } catch (err) { self.postMessage({ id, error: String((err && err.message) || err) }); }
};`;
let worker = null, workerFailed = false, seq = 0;
const waiting = new Map();
function talk(msg, note) {
    if (!worker) {
        worker = new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })), { type: 'module' });
        worker.onmessage = (e) => {
            const w = waiting.get(e.data.id);
            if (!w)
                return;
            if (e.data.load != null)
                w.note?.(`Loading the speech model (once)… ${e.data.load} %`);
            else if (e.data.error) {
                waiting.delete(e.data.id);
                w.no(new Error(e.data.error));
            }
            else if (e.data.done !== undefined) {
                waiting.delete(e.data.id);
                w.ok(e.data.done);
            }
            else if (e.data.ready && w.init) {
                waiting.delete(e.data.id);
                w.ok(true);
            }
        };
        worker.onerror = () => { workerFailed = true; for (const w of waiting.values())
            w.no(new Error('worker')); waiting.clear(); worker?.terminate(); worker = null; };
    }
    const id = ++seq;
    return new Promise((ok, no) => { waiting.set(id, { ok, no, note, init: !msg.audio }); worker.postMessage({ id, ...msg }); });
}
function loadAsr(model, onNote) {
    if (asr)
        return asr;
    asr = (async () => {
        onNote('Loading the speech model (once)…');
        if (!workerFailed && typeof Worker !== 'undefined') {
            try {
                await talk({ model }, onNote);
                return ((audio, opts) => talk({ model, audio, opts }));
            }
            catch {
                workerFailed = true;
                worker?.terminate();
                worker = null;
            }
        }
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
/** where to cut near `at` (in samples): the quietest half second within ±5 s – so no word is split */
function quietCut(pcm, at) {
    if (at >= pcm.length)
        return pcm.length;
    const win = 8000, from = Math.max(0, at - 5 * 16000), to = Math.min(pcm.length - win, at + 5 * 16000);
    let best = at, low = Infinity;
    for (let s = from; s < to; s += 1600) {
        let e = 0;
        for (let k = s; k < s + win; k += 4)
            e += pcm[k] * pcm[k];
        if (e < low) {
            low = e;
            best = s + win / 2;
        }
    }
    return Math.round(best);
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
async function writeDown(block, host, again = false, choose) {
    if (jobs.has(block.id))
        return;
    const d = (block.data ??= {});
    if (again) {
        d.tx = [];
        delete d.txNext;
        delete d.txAt;
        d.txDone = false;
    }
    const job = { pct: 0, note: 'Getting ready…' };
    jobs.set(block.id, job);
    changed();
    try {
        const { model } = txSettings(host.ctx);
        // always say which language: left to itself, the model tends to answer in English (it translates)
        const lang = choose ?? (d.lang === 'English' ? 'en' : d.lang === 'German' ? 'de' : txSettings(host.ctx).lang === 'en' ? 'en' : 'de');
        d.lang = lang === 'en' ? 'English' : 'German';
        const run = await loadAsr(model, (s) => { job.note = s; changed(); });
        job.note = 'Transcribing';
        changed();
        const pcm = await pcm16k(await host.ctx.assetUrl(block.src ?? ''));
        // pieces of about a minute, cut where it is quiet, each saved at once (a stop half-way goes on from there);
        // inside a piece the model walks in overlapping 30-second windows with time stamps
        const total = pcm.length;
        let from = d.txAt != null ? Math.round(d.txAt * 16000) : d.txNext ? d.txNext * 300 * 16000 : 0;
        d.tx ??= [];
        let rate = model === 'base' ? 0.15 : 0.4; // seconds of work per second of audio – measured as it goes
        while (from < total) {
            const to = quietCut(pcm, from + 60 * 16000), secs = (to - from) / 16000, t0 = Date.now(), base = from;
            const tick = window.setInterval(() => { job.pct = Math.min(99, Math.round(((base + Math.min(0.95, (Date.now() - t0) / 1000 / (secs * rate)) * (to - base)) / total) * 100)); changed(); }, 500);
            let r;
            try {
                r = await run(pcm.slice(from, to), { task: 'transcribe', language: lang === 'en' ? 'english' : 'german', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
            }
            finally {
                clearInterval(tick);
            }
            rate = rate * 0.4 + ((Date.now() - t0) / 1000 / Math.max(1, secs)) * 0.6;
            // paragraphs of about 30 seconds, each with the time it starts
            const parts = r.chunks?.length ? r.chunks : [{ timestamp: [0, null], text: r.text ?? '' }];
            const start = from / 16000;
            let para = null;
            for (const c of parts) {
                const at = start + (c.timestamp?.[0] ?? 0), text = (c.text ?? '').trim();
                if (!text)
                    continue;
                if (!para || at - para.t >= 30) {
                    if (para)
                        d.tx.push(para);
                    para = { t: Math.round(at), text };
                }
                else
                    para.text += ` ${text}`;
            }
            if (para)
                d.tx.push(para);
            from = to;
            d.txAt = from / 16000;
            delete d.txNext;
            job.pct = Math.round((from / total) * 100);
            host.save();
            changed();
        }
        d.txDone = true;
        delete d.txNext;
        delete d.txAt;
        host.save();
    }
    catch (e) {
        toast(`Could not transcribe: ${e.message}`);
    }
    finally {
        jobs.delete(block.id);
        changed();
    }
}
/** "Write it down": German or English – asked when the settings leave it open (and the memo has none yet) */
function askLang(at, b, host, again) {
    const d = (b.data ?? {}), set = txSettings(host.ctx).lang;
    if (d.lang || set !== 'auto') {
        void writeDown(b, host, again);
        return;
    }
    menu(at, [{ section: 'Spoken in' }, { label: 'German', run: () => void writeDown(b, host, again, 'de') }, { label: 'English', run: () => void writeDown(b, host, again, 'en') }]);
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
        const mine = playing?.block === b, on = mine && !audio.paused, wait = loading === b;
        const pb = h('button', { class: 'memo-pb' + (wait ? ' wait' : ''), 'aria-label': wait ? 'Loading' : on ? 'Pause' : 'Play', onclick: () => (wait ? undefined : mine ? toggleMemo() : void playMemo(b, host)) }, wait ? h('span', { class: 'memo-spin' }) : pi(on ? 'pause' : 'play', 15));
        const sub = wait ? 'Loading…' : [d.dur ? fmt(d.dur) : '', d.txDone && d.tx?.length ? (d.lang ?? '') : d.size ? mb(d.size) : ''].filter(Boolean).join(' · ');
        const more = h('button', { class: 'memo-more', 'aria-label': 'More' }, pi('more', 18));
        more.addEventListener('click', () => {
            const text = (d.tx ?? []).map((x) => x.text).join('\n\n');
            menu(more, [
                ...(text ? [
                    { label: 'Copy text', icon: menuIcon('clipboard'), run: () => { void navigator.clipboard.writeText(text).then(() => toast('Copied')); } },
                    ...(host.insertAfter && !readonly ? [{ label: 'Turn into page text', icon: menuIcon('align-left'), run: () => host.insertAfter((d.tx ?? []).map((x) => ({ id: crypto.randomUUID().replace(/-/g, '').slice(0, 20), type: 'paragraph', text: x.text }))) }] : []),
                    ...(!readonly ? [{ label: 'Transcribe again in German', icon: menuIcon('refresh'), run: () => void writeDown(b, host, true, 'de') }, { label: 'Transcribe again in English', icon: menuIcon('refresh'), run: () => void writeDown(b, host, true, 'en') }] : []),
                ] : []),
                { label: 'Download audio', icon: menuIcon('download'), run: async () => { const a = h('a', { href: await host.ctx.assetUrl(b.src ?? ''), download: (b.src ?? '').split('/').pop() ?? 'memo.m4a' }); document.body.appendChild(a); a.click(); a.remove(); } },
                ...(host.remove && !readonly ? ['sep', { label: 'Delete', icon: menuIcon('trash'), danger: true, run: () => { if (playing?.block === b)
                            stopMemo(); host.remove(); } }] : []),
            ]);
        });
        // the seek bar: current time · track with its knob (drag or tap) · length
        const fill = h('i'), knob = h('b'), cur = h('span', { class: 'memo-st' }), total = h('span', { class: 'memo-st' });
        const track = h('div', { class: 'memo-track' }, fill, knob);
        const seek = h('div', { class: 'memo-seekrow' }, cur, track, total);
        const len = () => (mine && Number.isFinite(audio.duration) && audio.duration) || d.dur || 0;
        let drag = null;
        const show = (f) => { const pc = `${Math.max(0, Math.min(1, f)) * 100}%`; fill.style.width = pc; knob.style.left = pc; cur.textContent = fmt(f * len()); };
        const paint = () => { total.textContent = fmt(len()); if (drag == null)
            show(mine && len() ? audio.currentTime / len() : 0); };
        const at = (e) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
        seek.addEventListener('pointerdown', (e) => { if (e.button)
            return; e.preventDefault(); seek.setPointerCapture(e.pointerId); drag = at(e); seek.classList.add('drag'); show(drag); });
        seek.addEventListener('pointermove', (e) => { if (drag == null)
            return; drag = at(e); show(drag); });
        const end = () => {
            if (drag == null)
                return;
            const f = drag;
            drag = null;
            seek.classList.remove('drag');
            if (mine)
                audio.currentTime = f * len();
            else
                void playMemo(b, host, f * len());
        };
        seek.addEventListener('pointerup', end);
        seek.addEventListener('pointercancel', () => { drag = null; seek.classList.remove('drag'); paint(); });
        document.addEventListener('nook-memo-time', function t() { if (!seek.isConnected) {
            document.removeEventListener('nook-memo-time', t);
            return;
        } paint(); });
        paint();
        box.append(h('div', { class: 'memo-row memo-main' }, pb, h('span', { class: 'memo-t' }, h('b', null, memoName(b)), h('small', null, sub)), seek, more));
        // the text
        const job = jobs.get(b.id);
        if (job)
            box.append(h('div', { class: 'memo-prog' }, h('span', null, job.note), h('span', { class: 'memo-pbar busy' }, h('i', { style: { width: `${job.pct}%` } })), h('span', null, `${job.pct} %`)));
        if (d.tx?.length) {
            const paras = d.tx.map((x) => h('div', { class: 'memo-para' }, h('button', { class: 'memo-ts', title: 'Play from here', onclick: () => void playMemo(b, host, x.t) }, fmt(x.t)), h('span', null, x.text)));
            const long = paras.length > 3 || d.tx.reduce((n, x) => n + x.text.length, 0) > 600;
            box.append(h('div', { class: 'memo-tx' + (long && !open ? ' folded' : '') }, ...paras));
            if (long)
                box.append(h('button', { class: 'memo-btn', onclick: () => { open = !open; draw(); } }, open ? 'Show less' : 'Show all'));
        }
        if (TX_ENABLED && !job && !d.txDone && !readonly) {
            const partly = !!d.tx?.length;
            box.append(h('div', { class: 'memo-wd' }, h('button', { class: 'memo-btn', onclick: (e) => askLang(e.currentTarget, b, host, false) }, iconSvg('pen', 14), partly ? 'Continue transcribing' : 'Transcribe'), phone() && (d.dur ?? 0) > 120 ? h('span', { class: 'memo-hint' }, 'quicker on a computer') : null));
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