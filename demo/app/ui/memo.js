// Voice memos: record in a page (an audio block of kind "memo"), play it back, write it down on this device.
// One sound at a time: recording or playing a memo pauses the music, and the music pauses a memo.
// The phone's bottom bar (and the desktop's top bar pill) show the recording or the memo that plays.
import { kbLog } from './kbdebug.js';
import { h } from '../util.js';
import { iconSvg } from './icons.js';
import { ICONS, svgIcon } from '../util.js';
import { menu, menuIcon, toast } from './pop.js';
import { pi } from './viewer.js';
import { onPlayer, pauseMusic, musicPlaying, setBarOverride, setPillOverride } from './player.js';
import { withWebmDuration } from '../webm.js';
const dataOf = (b) => (b.data ?? {});
const phone = () => document.documentElement.classList.contains('phone');
const fmt = (s) => {
    s = Math.max(0, Math.round(s));
    const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const mb = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
/** the memo's name: its file's name, as in Dropbox (without the type) */
const memoName = (b) => (b.src ? decodeURIComponent(b.src.split('/').pop() ?? '').replace(/\.[^.]+$/, '').replace(/^[0-9a-z]{6}-(?=.)/, '') : '') || b.text || 'Voice memo';
const changed = () => {
    const sc = document.querySelector('.main > .scroll');
    kbLog(`memo update top${Math.round(sc?.scrollTop ?? -1)} h${sc?.scrollHeight ?? -1}`);
    document.dispatchEvent(new CustomEvent('nook-memo'));
};
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
/** the bars must not hold focus when they go away – Safari would then scroll the page to the editor's caret */
function dropBarFocus() {
    const a = document.activeElement;
    if (a?.closest('.memo-bar, .memo-pill'))
        a.blur();
}
document.addEventListener('mousedown', (e) => { if (e.target.closest?.('.memo-bar, .memo-pill'))
    e.preventDefault(); }, true);
function endRec() {
    dropBarFocus();
    if (!rec)
        return;
    rec.stream.getTracks().forEach((t) => t.stop());
    void rec.ac.close().catch(() => { });
    rec = null;
    setBarOverride(null);
    setPillOverride(null);
    changed();
}
export function cancelRecording() {
    if (!rec)
        return;
    rec.mr.onstop = null;
    try {
        rec.mr.stop();
    }
    catch { /* stopped */ }
    endRec();
}
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
            const bytes = new Uint8Array(await blob.arrayBuffer());
            await r.host.ctx.ws.writeFile(path, ext === 'webm' ? withWebmDuration(bytes, dur * 1000) : bytes);
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
    const tick = () => {
        if (!el.isConnected && el.dataset.on)
            return;
        el.dataset.on = '1';
        const v = bands(n);
        [...el.children].forEach((c, i) => { c.style.height = `${Math.max(3, Math.round(3 + v[i] * 19))}px`; });
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return el;
}
/** the bars while recording: phone (instead of the tabs) and desktop (a pill in the top bar) */
function showRecBars() {
    const time = (cls) => {
        const t = h('span', { class: cls });
        const run = () => { if (!rec)
            return; t.textContent = fmt(elapsed() / 1000); setTimeout(run, 250); };
        run();
        return t;
    };
    const pp = () => {
        const b = h('button', { class: 'memo-bb', 'aria-label': 'Pause', onclick: (e) => { e.stopPropagation(); pauseRecording(); } }, pi('pause', 20));
        document.addEventListener('nook-memo', () => b.replaceChildren(pi(rec?.paused ? 'play' : 'pause', 20)));
        return b;
    };
    const stop = () => h('button', { class: 'memo-stop', 'aria-label': 'Stop and save', onclick: (e) => { e.stopPropagation(); stopRecording(); } }, h('i'));
    const where = rec?.host.pageId ? rec.host.ctx.ws.pages.get(rec.host.pageId)?.title ?? '' : '';
    setBarOverride(h('div', { class: 'memo-bar' }, h('button', { class: 'memo-bb dim', 'aria-label': 'Discard', onclick: (e) => { e.stopPropagation(); cancelRecording(); } }, pi('x', 16)), h('span', { class: 'memo-bt' }, h('b', null, h('span', { class: 'memo-dot' }), time('')), h('small', null, where ? `into ${where}` : 'Recording')), levelBars(), pp(), stop()), 'rec');
    setPillOverride(h('span', { class: 'memo-pill' }, h('span', { class: 'memo-dot' }), time('memo-pt'), where ? h('span', { class: 'memo-pw' }, where) : null, h('button', { class: 'ppill-pp', 'aria-label': 'Pause', onclick: () => pauseRecording() }, pi('pause', 13)), h('button', { class: 'memo-pstop', 'aria-label': 'Stop and save', title: 'Stop and save', onclick: () => stopRecording() }, h('i'))));
}
// ---------- playing ----------
const audio = document.createElement('audio');
audio.preload = 'metadata';
window.nookMemoAudio = audio; // for tests
let playing = null;
let memoUrl = '';
/** what the file is, by its first bytes (else by its name) */
function audioType(path, bytes) {
    if (bytes && bytes[0] === 0x1a && bytes[1] === 0x45)
        return 'audio/webm';
    if (bytes && bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67)
        return 'audio/ogg';
    const e = path.toLowerCase().split('.').pop() ?? '';
    const types = { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac', caf: 'audio/x-caf' };
    return types[e] ?? 'audio/mp4';
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
const metadata = () => audio.readyState >= 1 ? Promise.resolve() : new Promise((r) => {
    audio.addEventListener('loadedmetadata', () => r(), { once: true });
    audio.addEventListener('error', () => r(), { once: true });
});
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
            const d = dataOf(block);
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
export function stopMemo() {
    if (!playing)
        return;
    dropBarFocus();
    audio.pause();
    playing = null;
    setBarOverride(null);
    setPillOverride(null);
    changed();
}
/** back to the memo: on its page already – just bring it into view (only if it isn't); else open the page first */
function goBack() {
    const p = playing;
    if (!p?.host.pageId)
        return;
    const find = () => document.querySelector(`[data-id="${p.block.id}"]`);
    const show = (el) => {
        if (!el)
            return;
        const r = el.getBoundingClientRect();
        if (r.top < 60 || r.bottom > innerHeight - 110)
            el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    const here = find();
    if (here) {
        show(here);
        return;
    }
    p.host.ctx.openPage(p.host.pageId);
    setTimeout(() => show(find()), 350);
}
function showMemoBars() {
    const p = playing;
    const where = p.host.pageId ? p.host.ctx.ws.pages.get(p.host.pageId)?.title ?? '' : '';
    const sub = h('small'), pt = h('span', { class: 'memo-pw' });
    const tick = () => { sub.textContent = `${where ? `${where} · ` : ''}${fmt(audio.currentTime)}`; pt.textContent = fmt(audio.currentTime); };
    document.addEventListener('nook-memo-time', tick);
    tick();
    const ppb = (n, cls) => {
        const b = h('button', { class: cls, 'aria-label': 'Play or pause', onclick: (e) => { e.stopPropagation(); toggleMemo(); } });
        const d = () => b.replaceChildren(pi(audio.paused ? 'play' : 'pause', n));
        d();
        document.addEventListener('nook-memo', d);
        return b;
    };
    const bar = h('div', { class: 'memo-bar' }, h('span', { class: 'memo-ico', onclick: goBack }, iconSvg('mic', 18)), h('span', { class: 'memo-bt', onclick: goBack }, h('b', null, memoName(p.block)), sub), h('button', { class: 'memo-bb', 'aria-label': '15 seconds back', onclick: (e) => { e.stopPropagation(); audio.currentTime = Math.max(0, audio.currentTime - 15); } }, pi('back', 19)), ppb(20, 'memo-bb'), h('button', { class: 'memo-bb dim', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); stopMemo(); } }, pi('x', 16)));
    setBarOverride(bar);
    setPillOverride(h('span', { class: 'memo-pill' }, h('button', { class: 'memo-pname', title: 'Back to the memo', onclick: goBack }, iconSvg('mic', 13), memoName(p.block)), pt, ppb(13, 'ppill-pp'), h('button', { class: 'ppill-b', 'aria-label': 'Close', title: 'Close', onclick: stopMemo }, pi('x', 13))));
}
// ---------- writing it down (on this device, free: Whisper in the browser) ----------
/** writing memos down needs the page's security rules (web/index.html) to allow the speech library from cdn.jsdelivr.net
 *  and WebAssembly ('wasm-unsafe-eval'); it turns itself on once they do */
export const TX_ENABLED = (() => {
    const c = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '';
    return /script-src[^;]*cdn\.jsdelivr\.net/.test(c) && /wasm-unsafe-eval/.test(c);
})();
const TX_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
let asr = null;
const jobs = new Map();
/** always Whisper Base (Small gave worse results here and needs more memory than a phone gives a web page) */
export const txSettings = (ctx) => ({ model: 'base', lang: ctx.ws.settings.memoLang ?? 'auto' });
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
        worker.onerror = () => {
            workerFailed = true;
            for (const w of waiting.values())
                w.no(new Error('worker'));
            waiting.clear();
            worker?.terminate();
            worker = null;
        };
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
/** in pieces, each saved at once – a memo stopped half-way goes on from there */
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
        const tx = (d.tx ??= []);
        // seconds of work per second of audio: measured, and remembered on this device for next time
        const RATE_KEY = `nook:tx-rate:${model}`;
        let rate = (() => { try {
            return Number(localStorage.getItem(RATE_KEY)) || 0.3;
        }
        catch {
            return 0.3;
        } })();
        while (from < total) {
            const to = quietCut(pcm, from + 60 * 16000), secs = (to - from) / 16000, t0 = Date.now(), base = from;
            // steady up to the expected end; if it takes longer, it keeps creeping on (slower and slower) instead of stopping
            const frac = () => { const x = (Date.now() - t0) / 1000 / Math.max(0.5, secs * rate); return x < 0.9 ? x : 0.9 + 0.09 * (1 - Math.exp(-(x - 0.9) * 2)); };
            const tick = window.setInterval(() => { job.pct = Math.min(99, Math.round(((base + frac() * (to - base)) / total) * 100)); changed(); }, 300);
            let r;
            try {
                r = await run(pcm.slice(from, to), { task: 'transcribe', language: lang === 'en' ? 'english' : 'german', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
            }
            finally {
                clearInterval(tick);
            }
            rate = rate * 0.3 + ((Date.now() - t0) / 1000 / Math.max(1, secs)) * 0.7;
            try {
                localStorage.setItem(RATE_KEY, String(rate));
            }
            catch { /* not kept */ }
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
                        tx.push(para);
                    para = { t: Math.round(at), text };
                }
                else
                    para.text += ` ${text}`;
            }
            if (para)
                tx.push(para);
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
/** "Transcribe": German or English – asked when the settings leave it open (and the memo has none yet) */
function askLang(at, b, host, again) {
    const d = dataOf(b), set = txSettings(host.ctx).lang;
    if (d.lang || set !== 'auto') {
        void writeDown(b, host, again);
        return;
    }
    menu(at, [{ section: 'Spoken in' }, { label: 'German', run: () => void writeDown(b, host, again, 'de') }, { label: 'English', run: () => void writeDown(b, host, again, 'en') }]);
}
// ---------- the block ----------
export function memoBlock(b, host, readonly = false) {
    // contenteditable="false": taps in the memo stay in the memo – the editor neither puts a caret nearby
    // nor scrolls to one (that made the page jump on every tap on the phone)
    const box = h('div', { class: 'memo', contenteditable: 'false' });
    for (const ev of ['mousedown', 'touchstart', 'touchend', 'click'])
        box.addEventListener(ev, (e) => e.stopPropagation());
    // no focus moves on a tap: on the iPhone a tap here otherwise focused the editor around it, and Safari
    // scrolled the page to its caret (the jump on every play, stop and transcribe)
    box.addEventListener('mousedown', (e) => { if (!e.target.closest('input, textarea'))
        e.preventDefault(); });
    let open = false;
    // the memo is built once per kind (nothing yet · recording · recorded); after that, changes are made in place:
    // the play button, the seek bar, the progress, new paragraphs of text – nothing is rebuilt, nothing on the page moves
    let mode = '', update = null;
    const draw = () => {
        if (!box.isConnected && box.dataset.drawn) {
            document.removeEventListener('nook-memo', draw);
            return;
        }
        const m = rec?.block === b ? 'rec' : !b.src ? 'empty' : 'saved';
        if (m === mode) {
            update?.();
            return;
        }
        mode = m;
        update = null;
        box.dataset.drawn = '1';
        box.replaceChildren();
        if (m === 'rec') {
            const t = h('small', null, 'Recording'), tm = h('span', { class: 'memo-time' }, fmt(elapsed() / 1000));
            const pauseBtn = h('button', { class: 'memo-btn', onclick: () => pauseRecording() });
            box.append(h('div', { class: 'memo-row' }, h('span', { class: 'memo-pb rec' }, iconSvg('mic', 16)), h('span', { class: 'memo-t' }, h('b', null, h('span', { class: 'memo-dot' }), tm), t), ...(phone() ? [] : [levelBars(), pauseBtn, h('button', { class: 'memo-btn strong', onclick: () => stopRecording() }, 'Stop')])));
            update = () => { pauseBtn.replaceChildren(pi(rec?.paused ? 'play' : 'pause', 13), rec?.paused ? 'Go on' : 'Pause'); };
            update();
            const run = () => { if (rec?.block !== b)
                return; tm.textContent = fmt(elapsed() / 1000); t.textContent = rec.paused ? 'Paused' : 'Recording'; setTimeout(run, 250); };
            run();
            return;
        }
        if (m === 'empty') {
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
            box.append(h('div', { class: 'memo-row' }, h('span', { class: 'memo-pb rec' }, iconSvg('mic', 16)), h('span', { class: 'memo-t' }, h('b', null, 'Voice memo'), h('small', null, 'Nothing recorded yet')), ...(readonly ? [] : [
                h('button', { class: 'memo-btn', onclick: () => file.click() }, iconSvg('upload', 14), 'Add a file'),
                h('button', { class: 'memo-btn red', onclick: () => void startRecording(b, host) }, 'Record')
            ]), file));
            return;
        }
        // recorded
        const dd = () => dataOf(b);
        const mine = () => playing?.block === b;
        const pb = h('button', { class: 'memo-pb', onclick: () => { if (loading === b)
                return; if (mine())
                toggleMemo();
            else
                void playMemo(b, host); } });
        const subEl = h('small');
        // the same ⋯ as on widgets
        const more = h('button', { class: 'icon-btn memo-more', 'aria-label': 'More', title: 'More' }, svgIcon(ICONS.more, 16, { fill: true }));
        more.addEventListener('click', () => {
            const d = dd(), text = (d.tx ?? []).map((x) => x.text).join('\n\n');
            const entries = [
                ...(text ? [
                    { label: 'Copy text', icon: menuIcon('clipboard'), run: () => { void navigator.clipboard.writeText(text).then(() => toast('Copied')); } },
                    ...(host.insertAfter && !readonly ? [{ label: 'Turn into page text', icon: menuIcon('align-left'), run: () => host.insertAfter((d.tx ?? []).map((x) => ({ id: crypto.randomUUID().replace(/-/g, '').slice(0, 20), type: 'paragraph', text: x.text }))) }] : []),
                    ...(!readonly ? [
                        { label: 'Transcribe again in German', icon: menuIcon('refresh'), run: () => void writeDown(b, host, true, 'de') },
                        { label: 'Transcribe again in English', icon: menuIcon('refresh'), run: () => void writeDown(b, host, true, 'en') }
                    ] : []),
                ] : []),
                { label: 'Download audio', icon: menuIcon('download'), run: async () => { const a = h('a', { href: await host.ctx.assetUrl(b.src ?? ''), download: (b.src ?? '').split('/').pop() ?? 'memo.m4a' }); document.body.appendChild(a); a.click(); a.remove(); } },
                ...(host.remove && !readonly ? ['sep', { label: 'Delete', icon: menuIcon('trash'), danger: true, run: () => { if (mine())
                            stopMemo(); host.remove(); } }] : []),
            ];
            menu(more, entries);
        });
        // the seek bar: current time · track with its knob (drag or tap) · length
        const fill = h('i'), knob = h('b'), cur = h('span', { class: 'memo-st' }), total = h('span', { class: 'memo-st' });
        const track = h('div', { class: 'memo-track' }, fill, knob);
        const seek = h('div', { class: 'memo-seekrow' }, cur, track, total);
        const len = () => (mine() && Number.isFinite(audio.duration) && audio.duration) || dd().dur || 0;
        let drag = null;
        const show = (f) => { const pc = `${Math.max(0, Math.min(1, f)) * 100}%`; fill.style.width = pc; knob.style.left = pc; cur.textContent = fmt(f * len()); };
        const paint = () => { total.textContent = fmt(len()); if (drag == null)
            show(mine() && len() ? audio.currentTime / len() : 0); };
        const at = (e) => { const r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
        seek.addEventListener('pointerdown', (e) => { if (e.button)
            return; e.preventDefault(); seek.setPointerCapture(e.pointerId); drag = at(e); seek.classList.add('drag'); show(drag); });
        seek.addEventListener('pointermove', (e) => { if (drag == null)
            return; drag = at(e); show(drag); });
        seek.addEventListener('pointerup', () => {
            if (drag == null)
                return;
            const f = drag;
            drag = null;
            seek.classList.remove('drag');
            if (mine())
                audio.currentTime = f * len();
            else
                void playMemo(b, host, f * len());
        });
        seek.addEventListener('pointercancel', () => { drag = null; seek.classList.remove('drag'); paint(); });
        document.addEventListener('nook-memo-time', function t() { if (!seek.isConnected) {
            document.removeEventListener('nook-memo-time', t);
            return;
        } paint(); });
        // the parts below: progress, text (paragraphs only ever added), "Show all", "Transcribe"
        const prog = h('div', { class: 'memo-prog' }), progLabel = h('span'), progFill = h('i'), progPct = h('span');
        prog.append(progLabel, h('span', { class: 'memo-pbar' + (workerFailed ? ' busy' : '') }, progFill), progPct);
        const tx = h('div', { class: 'memo-tx' });
        const toggle = h('button', { class: 'memo-btn', onclick: () => { open = !open; update?.(); } });
        const wdBtn = h('button', { class: 'memo-btn', onclick: (e) => askLang(e.currentTarget, b, host, false) });
        const wd = h('div', { class: 'memo-wd' }, wdBtn, phone() && (dd().dur ?? 0) > 120 ? h('span', { class: 'memo-hint' }, 'quicker on a computer') : null);
        box.append(h('div', { class: 'memo-row memo-main' }, pb, h('span', { class: 'memo-t' }, h('b', null, memoName(b)), subEl), seek, more), prog, tx, toggle, wd);
        let shown = [];
        update = () => {
            const d = dd(), isOn = mine() && !audio.paused, isWait = loading === b, job = jobs.get(b.id);
            pb.classList.toggle('wait', isWait);
            pb.setAttribute('aria-label', isWait ? 'Loading' : isOn ? 'Pause' : 'Play');
            const icon = isWait ? 'wait' : isOn ? 'pause' : 'play';
            if (pb.dataset.icon !== icon) {
                pb.dataset.icon = icon;
                pb.replaceChildren(isWait ? h('span', { class: 'memo-spin' }) : pi(isOn ? 'pause' : 'play', 15));
            }
            subEl.textContent = isWait ? 'Loading…' : [d.dur ? fmt(d.dur) : '', d.txDone && d.tx?.length ? (d.lang ?? '') : d.size ? mb(d.size) : ''].filter(Boolean).join(' · ');
            paint();
            prog.hidden = !job;
            if (job) {
                progLabel.textContent = job.note;
                progFill.style.width = `${job.pct}%`;
                progPct.textContent = `${job.pct} %`;
            }
            // text: new paragraphs are added; started over ("Transcribe again"): emptied first
            const list = d.tx ?? [];
            if (list.length < shown.length || shown.some((x, k) => list[k] !== x)) {
                tx.replaceChildren();
                shown = [];
            }
            for (const x of list.slice(shown.length))
                tx.append(h('div', { class: 'memo-para' }, h('button', { class: 'memo-ts', title: 'Play from here', onclick: () => void playMemo(b, host, x.t) }, fmt(x.t)), h('span', null, x.text)));
            shown = [...list];
            tx.hidden = !list.length;
            const long = list.length > 3 || list.reduce((n, x) => n + x.text.length, 0) > 600;
            tx.classList.toggle('folded', long && !open);
            toggle.hidden = !long;
            toggle.textContent = open ? 'Show less' : 'Show all';
            wd.hidden = !(TX_ENABLED && !job && !d.txDone && !readonly);
            wdBtn.replaceChildren(iconSvg('pen', 14), d.tx?.length ? 'Continue transcribing' : 'Transcribe');
        };
        update();
    };
    document.addEventListener('nook-memo', draw);
    draw();
    return box;
}
/** a new, empty memo block */
export const newMemo = (id) => ({ id, type: 'audio', kind: 'memo', data: {} });
export const isMemo = (b) => b.type === 'audio' && b.kind === 'memo';
//# sourceMappingURL=memo.js.map