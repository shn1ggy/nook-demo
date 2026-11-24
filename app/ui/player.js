// The music player: one for the whole app, so a song keeps playing while you go anywhere in Nook.
// Opening a song shows the full player (phone: full screen; desktop: a window with the song on the left and the
// folder as "Up next" on the right). Closed, it stays as the phone's bottom bar turned player (the round button
// switches, the bar turns like a cube) and on the desktop as a small pill in the top bar.
import { h } from '../util.js';
import { closePop, menu, menuIcon, toast } from './pop.js';
import { P, pi, fileName, downloadMedia } from './viewer.js';
void P;
const phone = () => document.documentElement.classList.contains('phone');
const dur = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
const pi2 = pi;
void pi2;
const titleOf = (p) => fileName(p).replace(/\.[^.]+$/, '');
// ---------- the engine ----------
const MODE = 'nook:play-mode';
export const playMode = (() => { try {
    return { shuffle: false, repeat: 'off', rate: 1, vol: 1, ...JSON.parse(localStorage.getItem(MODE) ?? '{}') };
}
catch {
    return { shuffle: false, repeat: 'off', rate: 1, vol: 1 };
} })();
const saveMode = () => { try {
    localStorage.setItem(MODE, JSON.stringify(playMode));
}
catch { /* only a convenience */ } };
const audio = document.createElement('audio');
audio.preload = 'auto';
audio.setAttribute('playsinline', '');
// in the page (hidden): the iPhone's lock screen and Control Center follow an element that is part of the page
audio.style.cssText = 'position:fixed;width:1px;height:1px;left:-10px;bottom:0;opacity:0;pointer-events:none';
document.body.append(audio);
audio.volume = playMode.vol;
let ctx = null;
let queue = [];
let cur = -1;
/** songs played before (newest last), shown dimmed above Up next */
let played = [];
let order = [];
/** the playing song as a file (for Share), once fetched */
let songFile = null;
const listeners = new Set();
const emit = (kind) => listeners.forEach((f) => f(kind));
export const onPlayer = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const nowPlaying = () => (cur >= 0 ? queue[cur] ?? null : null);
function makeOrder() {
    order = queue.map((_, k) => k);
    if (playMode.shuffle) {
        const rest = order.filter((k) => k !== cur);
        for (let x = rest.length - 1; x > 0; x--) {
            const y = Math.floor(Math.random() * (x + 1));
            [rest[x], rest[y]] = [rest[y], rest[x]];
        }
        order = [cur, ...rest];
    }
}
async function load(k, play = true) {
    if (cur >= 0 && cur !== k) {
        played = [...played.filter((x) => x !== cur && x !== k), cur].slice(-10);
    }
    cur = k;
    const it = queue[k];
    if (!it || !ctx)
        return;
    emit('song');
    try {
        const u = await ctx.assetUrl(it.path);
        if (queue[cur] !== it)
            return;
        audio.src = u;
        audio.playbackRate = playMode.rate;
        session();
        // the song as a file, fetched alongside: Share can then hand it over right on the tap (the iPhone allows
        // sharing only in the moment of a tap – waiting for a download first was why it did nothing)
        songFile = null;
        const ext = (fileName(it.path).split('.').pop() ?? '').toLowerCase();
        void fetch(u).then((r) => (r.ok ? r.blob() : null)).then((b) => { if (b && queue[cur] === it) {
            songFile = new File([b], fileName(it.path), { type: MIME[ext] ?? 'application/octet-stream' });
            emit('state');
        } }).catch(() => { });
        if (play)
            await audio.play().catch(() => { });
    }
    catch (e) {
        toast(e.message);
    }
}
/** play these songs, starting with one of them (the folder they're in is the queue) */
export function playSongs(c, songs, at) {
    ctx = c;
    const same = queue.length === songs.length && queue.every((x, k) => x.path === songs[k].path);
    if (same && cur === at && audio.src) {
        if (audio.paused)
            void audio.play();
        return;
    }
    queue = songs;
    played = [];
    makeOrder();
    cur = at;
    makeOrder();
    void load(at);
}
/** next / previous in the playing order; `auto`: the song ended (repeat and the end of the list count) */
export function stepSong(dir, auto = false) {
    if (cur < 0)
        return false;
    if (auto && playMode.repeat === 'one') {
        audio.currentTime = 0;
        void audio.play();
        return true;
    }
    if (!auto && dir < 0 && audio.currentTime > 3) {
        audio.currentTime = 0;
        return true;
    }
    if (!order.includes(cur))
        makeOrder();
    let k = order.indexOf(cur) + dir;
    if (k >= order.length || k < 0) {
        if (!auto || playMode.repeat === 'all')
            k = (k + order.length) % order.length;
        else
            return false;
    }
    void load(order[k]);
    return true;
}
export function playAt(k) { void load(k); }
export function togglePlay() { if (audio.paused)
    void audio.play();
else
    audio.pause(); }
export function stopPlayer() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    queue = [];
    cur = -1;
    order = [];
    played = [];
    try {
        const m = navigator.mediaSession;
        if (m) {
            m.metadata = null;
            for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'])
                m.setActionHandler(a, null);
        }
    }
    catch { /* fine */ }
    emit('song');
}
audio.addEventListener('ended', () => { if (!stepSong(1, true)) {
    audio.currentTime = 0;
    emit('state');
} });
for (const ev of ['play', 'pause', 'ratechange'])
    audio.addEventListener(ev, () => { emit('state'); try {
        if (navigator.mediaSession)
            navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
    }
    catch { /* fine */ } });
audio.addEventListener('loadedmetadata', () => { emit('state'); position(); });
// iOS takes the lock-screen details once the sound really plays: (again) then
audio.addEventListener('playing', () => { session(); position(); });
audio.addEventListener('seeked', () => position());
/** the lock screen and Control Center: title, play / pause, previous / next, seeking */
function session() {
    const m = navigator.mediaSession, it = nowPlaying();
    if (!m || !it)
        return;
    try {
        m.metadata = new MediaMetadata({ title: titleOf(it.path), artist: it.place || 'Nook', album: (it.place ?? '').split(' › ').pop() ?? '', artwork: [{ src: new URL('apple-touch-icon.png', location.href).href, sizes: '180x180', type: 'image/png' }, { src: new URL('icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }] });
        m.setActionHandler('play', () => { void audio.play(); });
        m.setActionHandler('pause', () => audio.pause());
        m.setActionHandler('previoustrack', () => { stepSong(-1); });
        m.setActionHandler('nexttrack', queue.length > 1 ? () => { stepSong(1); } : null);
        m.setActionHandler('seekto', (d) => { if (d.seekTime != null)
            audio.currentTime = d.seekTime; });
    }
    catch { /* an older system: play / pause only */ }
}
function position() { try {
    if (navigator.mediaSession && audio.duration)
        navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: audio.playbackRate });
}
catch { /* fine */ } }
// ---------- parts used by every view ----------
/** volume (desktop: the iPhone lets only its own buttons change it) */
function volBar() {
    const fill = h('i'), track = h('div', { class: 'spl-vtrack' }, fill);
    const paint = () => { fill.style.width = `${audio.volume * 100}%`; };
    const set = (e) => { const r = track.getBoundingClientRect(); audio.volume = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); playMode.vol = audio.volume; paint(); };
    track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); set(e); const mv = (ev) => set(ev); track.addEventListener('pointermove', mv); track.addEventListener('pointerup', () => { track.removeEventListener('pointermove', mv); saveMode(); }, { once: true }); });
    track.addEventListener('wheel', (e) => { e.preventDefault(); audio.volume = Math.max(0, Math.min(1, audio.volume - Math.sign(e.deltaY) * 0.05)); playMode.vol = audio.volume; saveMode(); paint(); }, { passive: false });
    paint();
    // one button mutes (and unmutes); the slider does the rest
    const mute = h('button', { class: 'spl-vb', 'aria-label': 'Mute', title: 'Mute', onclick: () => { audio.muted = !audio.muted; paintMute(); } });
    const paintMute = () => { mute.replaceChildren(pi(audio.muted || audio.volume === 0 ? 'mute' : 'vol', 16)); mute.classList.toggle('on', audio.muted); track.classList.toggle('muted', audio.muted); };
    track.addEventListener('pointerdown', () => { if (audio.muted) {
        audio.muted = false;
        paintMute();
    } });
    paintMute();
    return h('div', { class: 'spl-vol', title: 'Volume' }, mute, track);
}
function seekBar() {
    const fill = h('i'), track = h('div', { class: 'mvp-track' }, fill), a = h('span'), b = h('span');
    const paint = () => { const d = audio.duration || 0; fill.style.width = `${d ? (audio.currentTime / d) * 100 : 0}%`; a.textContent = dur(audio.currentTime); b.textContent = `−${dur(Math.max(0, d - audio.currentTime))}`; };
    const seek = (e) => { const r = track.getBoundingClientRect(); if (audio.duration)
        audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration; paint(); };
    track.addEventListener('pointerdown', (e) => { e.stopPropagation(); track.setPointerCapture(e.pointerId); seek(e); const mv = (ev) => seek(ev); track.addEventListener('pointermove', mv); track.addEventListener('pointerup', () => track.removeEventListener('pointermove', mv), { once: true }); });
    track.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    return { el: h('div', { class: 'mvp-seek2' }, track, h('div', { class: 'mvp-times' }, a, b)), paint };
}
function controls(big) {
    const play = h('button', { class: 'mvp-play', 'aria-label': 'Play or pause', onclick: togglePlay });
    const shuf = h('button', { class: 'mvp-mode', 'aria-label': 'Shuffle', onclick: () => { playMode.shuffle = !playMode.shuffle; saveMode(); makeOrder(); paint(); emit('state'); toast(playMode.shuffle ? 'Shuffle on' : 'Shuffle off', 1200); } });
    const rep = h('button', { class: 'mvp-mode', 'aria-label': 'Repeat', onclick: () => { playMode.repeat = playMode.repeat === 'off' ? 'all' : playMode.repeat === 'all' ? 'one' : 'off'; saveMode(); paint(); toast(playMode.repeat === 'off' ? 'Repeat off' : playMode.repeat === 'all' ? 'Repeat the folder' : 'Repeat this song', 1200); } });
    const paint = () => {
        play.replaceChildren(pi(audio.paused ? 'play' : 'pause', big));
        shuf.replaceChildren(pi('shuffle', 22));
        shuf.classList.toggle('on', playMode.shuffle);
        rep.replaceChildren(pi(playMode.repeat === 'one' ? 'repeat1' : 'repeat', 22));
        rep.classList.toggle('on', playMode.repeat !== 'off');
    };
    paint();
    return { el: h('div', { class: 'mvp-ctl2' }, shuf, h('button', { class: 'mvp-skip', 'aria-label': 'Previous', onclick: () => stepSong(-1) }, pi('prev', big)), play, h('button', { class: 'mvp-skip', 'aria-label': 'Next', onclick: () => { if (queue.length > 1)
                stepSong(1); } }, pi('next', big)), rep), paint };
}
const chip = (icon, label, run) => { const b = h('button', { class: 'mvp-chip' }, pi(icon, 16), h('span', null, label)); b.addEventListener('click', () => run(b)); return b; };
function speedChip() {
    const rates = [1, 1.25, 1.5, 2, 0.75];
    const b = chip('speed', `${playMode.rate}×`.replace('.', ','), (el) => { playMode.rate = rates[(rates.indexOf(playMode.rate) + 1) % rates.length]; audio.playbackRate = playMode.rate; saveMode(); el.lastElementChild.textContent = `${playMode.rate}×`.replace('.', ','); el.classList.toggle('on', playMode.rate !== 1); });
    b.classList.toggle('on', playMode.rate !== 1);
    return b;
}
/** Share: the iPhone shares only right on the tap – the first tap fetches the song, the second shares it */
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', aif: 'audio/aiff', aiff: 'audio/aiff', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg' };
function shareChip(it) {
    const b = chip('share', 'Share', () => {
        if (!ctx)
            return;
        if (!navigator.share) {
            void downloadMedia(ctx, it.path);
            return;
        }
        const f = nowPlaying() === it ? songFile : null;
        if (!f) {
            toast('The song is still loading – tap Share again in a moment', 2500);
            return;
        }
        void navigator.share({ files: [f] }).catch((e) => { if (e.name !== 'AbortError')
            toast(`Could not share: ${e.message}`, 4000); });
    });
    return b;
}
const upNextOrder = () => { if (!order.includes(cur))
    makeOrder(); const from = order.indexOf(cur); return [...order.slice(from), ...order.slice(0, from)]; };
function upNextMenu(at) {
    const r = at.getBoundingClientRect();
    menu({ x: r.left, y: r.top }, [{ section: playMode.shuffle ? 'Up next · shuffled' : 'Up next' }, ...upNextOrder().map((k) => ({ label: titleOf(queue[k].path), icon: menuIcon('music'), checked: k === cur, run: () => playAt(k) }))]);
}
function moreMenu(at, close) {
    const it = nowPlaying();
    if (!it || !ctx)
        return;
    const r = at.getBoundingClientRect();
    menu({ x: r.right, y: r.bottom }, [
        ...(it.open ? [{ label: it.entryName ? `Info · ${it.entryName}` : 'Info', icon: menuIcon('info'), run: () => { close(); it.open(); } }] : []),
        { label: 'Download', icon: menuIcon('download'), run: () => void downloadMedia(ctx, it.path) },
        'sep',
        { label: 'Stop', icon: menuIcon('square'), danger: true, run: () => { close(); stopPlayer(); } },
    ]);
}
// ---------- the full player ----------
/** when a finger last touched a menu (pulling a menu down must not close the player under it) */
let lastMenuTouch = 0;
document.addEventListener('touchstart', (e) => { if (e.target.closest?.('.pop'))
    lastMenuTouch = Date.now(); }, { capture: true, passive: true });
document.addEventListener('touchend', (e) => { if (e.target.closest?.('.pop') || !e.target.isConnected)
    lastMenuTouch = Date.now(); }, { capture: true, passive: true });
let openView = null;
export function openFullPlayer() {
    if (!nowPlaying())
        return;
    openView?.remove();
    if (phone())
        phoneFull();
    else
        desktopFull();
}
function phoneFull() {
    const name = h('span', { class: 'mvp-name' });
    const stage = h('div', { class: 'mvp-stage' });
    const more = h('button', { class: 'mvp-rb', 'aria-label': 'More' }, pi('more'));
    const box = h('div', { class: 'overlay mv mvp audio' }, stage, h('div', { class: 'mvp-top' }, h('button', { class: 'mvp-rb', 'aria-label': 'Close', onclick: () => close() }, pi('down')), h('div', { class: 'mvp-title' }, name), more));
    let wasOpen = false;
    more.addEventListener('pointerdown', () => { wasOpen = !!document.querySelector('.pop:not(.pop-closing)'); }, true);
    more.addEventListener('click', () => { if (wasOpen || document.querySelector('.pop:not(.pop-closing)')) {
        wasOpen = false;
        closePop();
        return;
    } moreMenu(more, close); });
    let seek = null, ctl = null;
    const draw = () => {
        const it = nowPlaying();
        if (!it) {
            close();
            return;
        }
        const place = it.place ?? '', ext = (fileName(it.path).split('.').pop() ?? '').toLowerCase();
        name.textContent = place;
        seek = seekBar();
        ctl = controls(30);
        stage.replaceChildren(h('div', { class: 'mvp-cover' }, pi('music', 64)), h('div', { class: 'mvp-atitle' }, titleOf(it.path), h('small', null, [ext, queue.length > 1 ? `${cur + 1} of ${queue.length}${place ? ` in ${place.split(' › ').pop()}` : ''}` : ''].filter(Boolean).join(' · '))), h('div', { class: 'mvp-song-ctl' }, seek.el, ctl.el, h('div', { class: 'mvp-chips' }, speedChip(), chip('list', 'Up next', (b) => upNextMenu(b)), shareChip(it))));
        seek.paint();
    };
    const tick = () => seek?.paint();
    const off = onPlayer((k) => { if (k === 'song')
        draw();
    else {
        ctl?.paint();
        seek?.paint();
    } });
    audio.addEventListener('timeupdate', tick);
    // pull down to close (the music goes on)
    // (only a gesture that began here: the seek bar keeps its touches for itself)
    let y0 = null, x0 = 0;
    stage.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchmove', (e) => { if (y0 == null)
        return; const d = e.touches[0].clientY - y0; if (d > 0 && d > Math.abs(e.touches[0].clientX - x0)) {
        box.style.transform = `translateY(${d}px)`;
    } }, { passive: true });
    stage.addEventListener('touchend', (e) => { if (y0 == null)
        return; const d = e.changedTouches[0].clientY - y0; y0 = null; box.style.transform = ''; if (Date.now() - lastMenuTouch < 900)
        return; if (d > 110)
        close();
    else if (Math.abs(e.changedTouches[0].clientX - x0) > 70 && Math.abs(d) < 40 && queue.length > 1)
        stepSong(e.changedTouches[0].clientX < x0 ? 1 : -1); });
    const key = (e) => { if (e.key === 'Escape' && !document.querySelector('.pop') && Date.now() - lastMenuTouch > 900) {
        e.preventDefault();
        e.stopPropagation();
        close();
    } };
    document.addEventListener('keydown', key, true);
    function close() { off(); audio.removeEventListener('timeupdate', tick); document.removeEventListener('keydown', key, true); box.classList.add('mvp-leaving'); setTimeout(() => box.remove(), 220); if (openView === box)
        openView = null; emit('state'); }
    document.body.append(box);
    openView = box;
    draw();
}
function desktopFull() {
    const left = h('div', { class: 'spl-left' }), list = h('div', { class: 'spl-list' }), head = h('span', { class: 'spl-place' });
    const more = h('button', { class: 'icon-btn', 'aria-label': 'More', title: 'More' }, pi('more', 18));
    let wasOpenD = false;
    more.addEventListener('pointerdown', () => { wasOpenD = !!document.querySelector('.pop:not(.pop-closing)'); }, true);
    more.addEventListener('click', () => { if (wasOpenD || document.querySelector('.pop:not(.pop-closing)')) {
        wasOpenD = false;
        closePop();
        return;
    } moreMenu(more, close); });
    const win = h('div', { class: 'spl-win', role: 'dialog', 'aria-label': 'Player' }, h('div', { class: 'spl-head' }, pi('music', 15), head, h('span', { style: { flex: '1' } }), volBar(), more, h('button', { class: 'icon-btn', 'aria-label': 'Shrink to the small player', title: 'Shrink (the music goes on)', onclick: () => close() }, pi('down', 18))), h('div', { class: 'spl-body' }, left, h('div', { class: 'spl-right' }, h('div', { class: 'spl-rh' }, h('span', { class: 'spl-rt' }), h('span', { class: 'spl-n' })), list)));
    const box = h('div', { class: 'overlay spl', onclick: (e) => { if (e.target === box)
            close(); } }, win);
    let seek = null, ctl = null;
    const drawList = () => {
        win.querySelector('.spl-rt').textContent = playMode.shuffle ? 'UP NEXT · SHUFFLED' : 'UP NEXT';
        win.querySelector('.spl-n').textContent = `${queue.length} song${queue.length === 1 ? '' : 's'}`;
        const prev = played.filter((k) => k !== cur && k < queue.length).map((k) => h('button', { class: 'spl-q played', onclick: () => playAt(k) }, h('span', { class: 'spl-qn' }, pi('prev', 11)), h('span', { class: 'spl-qt' }, titleOf(queue[k].path))));
        const keep = list.scrollTop;
        list.replaceChildren(...prev, ...upNextOrder().map((k, n) => h('button', { class: 'spl-q' + (k === cur ? ' cur' : ''), onclick: () => playAt(k) }, h('span', { class: 'spl-qn' }, k === cur ? pi(audio.paused ? 'play' : 'pause', 12) : String(n + 1)), h('span', { class: 'spl-qt' }, titleOf(queue[k].path)))));
        // the song playing stays at the top; what played before is a scroll up
        const c = list.querySelector('.spl-q.cur');
        if (c && (drawnCur !== cur || !prev.length))
            list.scrollTop = c.offsetTop;
        else
            list.scrollTop = keep;
        drawnCur = cur;
    };
    let drawnCur = -2;
    const draw = () => {
        const it = nowPlaying();
        if (!it) {
            close();
            return;
        }
        const place = it.place ?? '', ext = (fileName(it.path).split('.').pop() ?? '').toLowerCase();
        head.textContent = place || 'Player';
        seek = seekBar();
        ctl = controls(26);
        // the cover's top lines up with Up next's top, the buttons' bottom with its bottom; the song in the middle between
        left.replaceChildren(h('div', { class: 'spl-cover' }, pi('music', 72)), h('div', { class: 'spl-low' }, h('div', { class: 'spl-title' }, titleOf(it.path)), h('div', { class: 'spl-sub' }, [ext, queue.length > 1 ? `${cur + 1} of ${queue.length}${place ? ` in ${place.split(' › ').pop()}` : ''}` : ''].filter(Boolean).join(' · ')), seek.el, ctl.el), h('div', { class: 'mvp-chips' }, speedChip(), chip('save', 'Download', () => void downloadMedia(ctx, it.path))));
        seek.paint();
        drawList();
    };
    const tick = () => seek?.paint();
    const off = onPlayer((k) => { if (k === 'song')
        draw();
    else {
        ctl?.paint();
        seek?.paint();
        drawList();
    } });
    audio.addEventListener('timeupdate', tick);
    const key = (e) => {
        if (document.querySelector('.pop'))
            return;
        if (e.key === 'Escape')
            close();
        else if (e.key === ' ')
            togglePlay();
        else if (e.key === 'ArrowRight' && (e.metaKey || e.ctrlKey))
            stepSong(1);
        else if (e.key === 'ArrowLeft' && (e.metaKey || e.ctrlKey))
            stepSong(-1);
        else
            return;
        e.preventDefault();
        e.stopPropagation();
    };
    document.addEventListener('keydown', key, true);
    function close() { off(); audio.removeEventListener('timeupdate', tick); document.removeEventListener('keydown', key, true); box.remove(); if (openView === box)
        openView = null; emit('state'); }
    document.body.append(box);
    openView = box;
    draw();
}
// ---------- desktop: the pill in the top bar ----------
/** cover, title (opens the full player), play / pause, next, ✕ – only while something plays */
export function playerPill() {
    const t = h('button', { class: 'ppill-t', title: 'Open the player', onclick: openFullPlayer });
    const pp = h('button', { class: 'ppill-pp', 'aria-label': 'Play or pause', onclick: togglePlay });
    const el = h('div', { class: 'ppill' }, h('button', { class: 'ppill-c', 'aria-label': 'Open the player', onclick: openFullPlayer }, pi('music', 14)), t, pp, h('button', { class: 'ppill-b', 'aria-label': 'Next', title: 'Next', onclick: () => stepSong(1) }, pi('next', 15)), h('button', { class: 'ppill-b', 'aria-label': 'Stop', title: 'Stop', onclick: stopPlayer }, pi('x', 14)));
    const paint = () => {
        if (!el.isConnected && el.dataset.drawn) {
            off();
            return;
        }
        el.dataset.drawn = '1';
        const it = nowPlaying();
        el.hidden = !it;
        if (!it)
            return;
        t.textContent = titleOf(it.path);
        pp.replaceChildren(pi(audio.paused ? 'play' : 'pause', 13));
    };
    const off = onPlayer(paint);
    paint();
    return el;
}
// ---------- phone: the bottom bar turns into the player ----------
let flipped = false;
/** the tab bar of the phone: a player face behind the tabs; the round button switches while music plays */
export function mountPhoneBar(nav, onPlus) {
    const pill = nav.querySelector('.tab-pill'), fab = nav.querySelector('.tab-fab');
    if (!pill || !fab)
        return;
    const stage = h('div', { class: 'tb-stage' });
    pill.replaceWith(stage);
    pill.classList.add('tb-face', 'tb-tabs');
    const t = h('span', { class: 'tbp-t' }), sub = h('small', { class: 'tbp-s' });
    const pp = h('button', { class: 'tbp-b tbp-pp', 'aria-label': 'Play or pause', onclick: (e) => { e.stopPropagation(); togglePlay(); } });
    const face = h('div', { class: 'tab-pill tb-face tb-player' }, h('button', { class: 'tbp-b tbp-back', 'aria-label': 'Back to the tabs', onclick: (e) => { e.stopPropagation(); flip(false); } }, pi('up', 18)), h('span', { class: 'tbp-c' }, pi('music', 18)), h('span', { class: 'tbp-tx' }, t, sub), pp, h('button', { class: 'tbp-b', 'aria-label': 'Next', onclick: (e) => { e.stopPropagation(); stepSong(1); } }, pi('next', 22)));
    face.addEventListener('click', () => openFullPlayer());
    // hold: open, back to the tabs, stop
    let timer = 0;
    face.addEventListener('touchstart', () => { timer = window.setTimeout(() => { timer = 0; const it = nowPlaying(); menu(face, [{ section: it ? titleOf(it.path) : 'Player' }, { label: 'Open player', icon: menuIcon('maximize'), run: openFullPlayer }, { label: 'Back to tabs', icon: menuIcon('arrow-up'), run: () => flip(false) }, 'sep', { label: 'Stop', icon: menuIcon('square'), danger: true, run: stopPlayer }]); }, 480); }, { passive: true });
    face.addEventListener('touchend', (e) => { if (timer)
        clearTimeout(timer);
    else
        e.preventDefault(); });
    face.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
    // swipe up on the bar: the other side (a swipe down belongs to the phone itself)
    let y0 = null;
    stage.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', (e) => { if (y0 == null)
        return; const d = e.changedTouches[0].clientY - y0; y0 = null; if (d < -18)
        flip(!flipped); });
    stage.append(pill, face);
    const plus = fab.innerHTML;
    fab.addEventListener('click', (e) => { if (nowPlaying() && !flipped) {
        e.stopImmediatePropagation();
        e.preventDefault();
        flip(true);
    } }, true);
    void onPlus;
    const tick = () => { const d = audio.duration || 0; sub.textContent = `${nowPlaying()?.place?.split(' › ').pop() ?? ''} · ${dur(audio.currentTime)}${d ? ` / ${dur(d)}` : ''}`; };
    const paint = () => {
        if (!nav.isConnected && nav.dataset.drawn) {
            off();
            audio.removeEventListener('timeupdate', tick);
            return;
        }
        nav.dataset.drawn = '1';
        const it = nowPlaying();
        if (!it)
            flipped = false;
        nav.classList.toggle('tb-music', !!it);
        stage.classList.toggle('flipped', !!it && flipped);
        fab.innerHTML = it && !flipped ? '<span class="tb-eq"><i></i><i></i><i></i><i></i></span>' : plus;
        fab.classList.toggle('tb-eq-on', !!it && !flipped);
        nav.querySelector('.tb-eq')?.classList.toggle('paused', audio.paused);
        if (!it)
            return;
        t.textContent = titleOf(it.path);
        pp.replaceChildren(pi(audio.paused ? 'play' : 'pause', 22));
        tick();
    };
    // the bar always turns upwards: back to the tabs, the player rolls up and away and the tabs come from below
    const flip = (to) => {
        if (!nowPlaying())
            return;
        if (!to && flipped) {
            stage.classList.add('tb-snap-tabs');
            void stage.offsetWidth; // the tabs wait below
            stage.classList.remove('tb-snap-tabs');
            stage.classList.add('tb-up-out');
            flipped = false;
            paint();
            setTimeout(() => { stage.classList.add('tb-snap'); stage.classList.remove('tb-up-out'); void stage.offsetWidth; stage.classList.remove('tb-snap'); }, 560);
            return;
        }
        flipped = to;
        paint();
    };
    const off = onPlayer((k) => { if (k === 'song' && nowPlaying() && !openView) { /* a song started from a list: show the player bar */ } paint(); });
    audio.addEventListener('timeupdate', tick);
    paint();
}
/** a song was started: on the phone the bar shows the player once the full player is closed */
export function showPlayerBar() { flipped = true; emit('state'); }
/* ---- now playing in views: the song's row gets moving bars instead of its icon, a tint and its name in accent ---- */
let npQueued = false;
function markNowPlaying() {
    npQueued = false;
    const it = nowPlaying(), path = it?.path ?? '';
    document.documentElement.classList.toggle('np-paused', audio.paused);
    for (const ic of document.querySelectorAll('[data-np]')) {
        const on = !!path && (path === ic.dataset.np || path.endsWith('/files/' + ic.dataset.np));
        if (on === ic.classList.contains('np-on'))
            continue;
        ic.classList.toggle('np-on', on);
        ic.querySelector('.np-eq')?.remove();
        if (on)
            ic.append(Object.assign(document.createElement('span'), { className: 'np-eq', innerHTML: '<i></i><i></i><i></i><i></i>' }));
        ic.closest('tr, .fdb-li, .list-row, .card, .g-card')?.classList.toggle('np-row', on);
    }
}
const queueMark = () => { if (!npQueued) {
    npQueued = true;
    requestAnimationFrame(markNowPlaying);
} };
onPlayer(queueMark);
new MutationObserver(queueMark).observe(document.body, { childList: true, subtree: true });
//# sourceMappingURL=player.js.map