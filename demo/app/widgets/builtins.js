import { zoomPicker } from '../ui/zoomcal.js';
import { Database } from '../workspace.js';
import { openPdfFull } from '../ui/pdf.js';
import { dayConfig, dayIndex, habitColor, label as dayLabel } from '../views/days.js';
import { dayNum, isoFromDay } from '../util.js';
import { registerWidget } from './api.js';
import { WEEKDAYS, weekStart, pad2, todayISO, isoOfDate, fmtDay } from '../util.js';
import { zoneCity } from './runtime.js';
import { renderIcon } from '../ui/icons.js';
import { prompt as askText } from '../ui/pop.js';
import { formatKey, registerFormatHost } from '../ui/formatbar.js';
import { htmlToInline, inlineToHtml } from '../format/inline.js';
const dayMs = 86400000;
const bar = (c, pct, color, size = '') => c.h('div', { class: 'w-bar' + (size ? ` ${size}` : '') }, c.h('i', { style: { width: `${Math.max(0, Math.min(100, pct))}%`, background: c.color(color).text } }));
const ring = (c, pct, color, label, thick = 9) => {
    const r = 40, L = 2 * Math.PI * r;
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 100 100');
    s.setAttribute('class', 'w-ring');
    s.innerHTML = `<circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--bg-hover)" stroke-width="${thick}"/>`
        + `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${c.color(color).text}" stroke-width="${thick}" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${L * (1 - Math.max(0, Math.min(1, pct / 100)))}" transform="rotate(-90 50 50)"/>`
        + `<text x="50" y="56" text-anchor="middle" fill="currentColor" font-size="18" font-weight="650" class="w-ring-pct">${label}</text>`;
    return s;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clamp = (n) => Math.max(0, Math.min(100, n));
const COLOR = (key = 'color', label = 'Color') => ({ key, label, type: 'color' });
// ── Countdown (looks like the countdown card of charts) ─────────────────────
registerWidget({
    id: 'countdown', name: 'Countdown', icon: 'hourglass', description: 'Days until a date, with a ring or bar',
    defaults: () => ({ title: 'Deadline', due: isoOfDate(new Date(Date.now() + 30 * dayMs)), since: '', shape: 'ring', color: 'accent', weeks: true }),
    settings: [
        { key: 'title', label: 'Name', type: 'text' },
        { key: '', label: 'Time', type: 'section' },
        { key: 'due', label: 'Date', type: 'date', optional: false },
        { key: 'since', label: 'Counting from', type: 'date' },
        { key: 'weeks', label: 'Show weeks', type: 'toggle' },
        { key: '', label: 'Look', type: 'section' },
        { key: 'shape', label: 'Shape', type: 'select', options: [['ring', 'Ring'], ['bar', 'Bar'], ['none', 'Number']] },
        COLOR(),
    ],
    render(c) {
        const { title, due, since, shape, color } = c.data;
        if (!due)
            return c.h('div', { class: 'w-col' }, c.h('span', { class: 'w-label' }, title || 'Countdown'), c.h('span', { class: 'w-sub' }, 'Choose a date under ⋯'));
        const d = Math.round((new Date(due + 'T00:00').getTime() - new Date(todayISO() + 'T00:00').getTime()) / dayMs);
        const big = d > 0 ? plural(d, 'day') : d === 0 ? 'Today' : `${plural(-d, 'day')} ago`;
        const weeks = Math.floor(Math.abs(d) / 7), rest = Math.abs(d) % 7;
        const sub = `${d >= 0 ? 'until' : 'since'} ${fmtDay(due)}${c.data.weeks !== false && weeks ? ` · ${plural(weeks, 'week')}${rest ? ` and ${plural(rest, 'day')}` : ''}` : ''}`;
        let pct = -1;
        if (since && since < due) {
            const a = new Date(since + 'T00:00').getTime(), b = new Date(due + 'T00:00').getTime();
            pct = clamp(((Date.now() - a) / (b - a)) * 100);
        }
        const lines = [c.h('span', { class: 'w-label' }, title || 'Countdown'), c.h('span', { class: 'w-big' }, big), c.h('span', { class: 'w-sub' }, sub)];
        if (pct < 0 || shape === 'none')
            return c.h('div', { class: 'w-col' }, ...lines);
        if (shape === 'bar')
            return c.h('div', { class: 'w-col' }, ...lines, bar(c, pct, color, 'thick'), c.h('span', { class: 'w-sub' }, `${Math.round(pct)} % of the time gone since ${fmtDay(since)}`));
        return c.h('div', { class: 'w-row w-ringrow' }, ring(c, pct, color, `${Math.round(pct)}%`), c.h('div', { class: 'w-col' }, ...lines, c.h('span', { class: 'w-sub' }, `time gone since ${fmtDay(since)}`)));
    },
});
// ── Timer ───────────────────────────────────────────────────────────────────
/** what people type as a duration: "20" (minutes), "1:30" (h:mm), "90s", "1h" → seconds */
const parseDur = (s) => {
    const t = s.trim().toLowerCase().replace(',', '.');
    let m;
    if ((m = t.match(/^(\d+):(\d{1,2})$/)))
        return (+m[1] * 60 + +m[2]) * 60;
    if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(h|std|hours?)$/)))
        return Math.round(+m[1] * 3600);
    if ((m = t.match(/^(\d+)\s*(s|sec|seconds?)$/)))
        return +m[1];
    if ((m = t.match(/^(\d+(?:\.\d+)?)\s*(m|min|minutes?)?$/)))
        return Math.round(+m[1] * 60);
    return null;
};
const clock = (s) => `${s >= 3600 ? Math.floor(s / 3600) + ':' : ''}${pad2((s % 3600) / 60)}:${pad2(s % 60)}`;
registerWidget({
    id: 'timer', name: 'Timer', icon: 'timer', description: 'A focus or kitchen timer: type a time or change it with − and +',
    defaults: () => ({ title: 'Focus', minutes: 15, step: 5, endAt: 0, left: 15 * 60, total: 15 * 60, color: 'accent', bar: true }),
    settings: [
        { key: 'title', label: 'Name', type: 'text' },
        { key: '', label: 'Look', type: 'section' },
        { key: 'bar', label: 'Show bar', type: 'toggle' },
        COLOR(),
    ],
    render(c) {
        const d = c.data;
        const total = () => Number(d.total) || 15 * 60;
        const left = () => (d.endAt ? Math.max(0, Math.round((d.endAt - Date.now()) / 1000)) : Number(d.left ?? total()));
        const running = !!d.endAt;
        const time = c.h('input', { class: 'w-big w-mono w-time', 'aria-label': 'Time – type minutes, e.g. 20 or 1:30', title: running ? '' : 'Click to type a time (20, 1:30, 90s)', readonly: running || c.readonly });
        const fill = c.h('i', { style: { background: c.color(d.color).text } });
        const show = () => {
            const s = left();
            if (document.activeElement !== time)
                time.value = clock(s);
            fill.style.width = `${clamp(100 - (s / total()) * 100)}%`;
            if (d.endAt && s === 0) {
                c.set({ endAt: 0, left: total() });
                c.notify(`${d.title || 'Timer'}: time is up`);
                c.redraw();
            }
        };
        const setTo = (sec) => { sec = Math.max(0, Math.min(24 * 3600, sec)); if (running)
            c.set({ endAt: Date.now() + sec * 1000, total: Math.max(total(), sec) });
        else
            c.set({ left: sec, total: sec }); c.redraw(); };
        time.addEventListener('focus', () => { if (!running)
            time.select(); });
        time.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter')
            time.blur(); if (e.key === 'Escape') {
            time.value = clock(left());
            time.blur();
        } });
        time.addEventListener('change', () => { const sec = parseDur(time.value); if (sec != null && sec > 0)
            setTo(sec);
        else
            time.value = clock(left()); });
        const step = 60;
        const start = () => { if (typeof Notification !== 'undefined' && Notification.permission === 'default')
            void Notification.requestPermission(); if (left() <= 0)
            return; c.set({ endAt: Date.now() + left() * 1000 }); c.redraw(); };
        const pause = () => { c.set({ left: left(), endAt: 0 }); c.redraw(); };
        const reset = () => { const s = 15 * 60; c.set({ left: s, total: s, endAt: 0 }); c.redraw(); };
        show();
        if (running)
            c.every(250, show);
        const atStart = !running && left() === total();
        return c.h('div', { class: 'w-col w-center w-timer' }, c.h('span', { class: 'w-label' }, d.title || 'Timer'), c.h('div', { class: 'w-row w-timerow' }, c.h('button', { class: 'w-btn round', 'aria-label': '1 minute less', title: '−1 min', onclick: () => setTo(left() - step) }, '−'), time, c.h('button', { class: 'w-btn round', 'aria-label': '1 minute more', title: '+1 min', onclick: () => setTo(left() + step) }, '+')), d.bar !== false ? c.h('div', { class: 'w-bar' }, fill) : null, c.h('div', { class: 'w-row w-btns' }, c.h('button', { class: 'w-btn primary', style: { background: c.color(d.color).tag }, onclick: running ? pause : start }, running ? 'Pause' : atStart ? 'Start' : 'Resume'), atStart ? null : c.h('button', { class: 'w-btn', onclick: reset }, 'Reset')));
    },
});
// ── Time progress ───────────────────────────────────────────────────────────
registerWidget({
    id: 'progress', name: 'Time progress', icon: 'activity', description: 'How much of the year, month, week or your own period is gone',
    defaults: () => ({ year: true, month: true, week: false, day: false, periods: [], color: 'accent', show: 'both', unit: 'auto', look: 'bar', thick: 'normal' }),
    settings: [
        { key: '', label: 'Show', type: 'section' },
        { key: 'year', label: 'Year', type: 'toggle' }, { key: 'month', label: 'Month', type: 'toggle' },
        { key: 'week', label: 'Week', type: 'toggle' }, { key: 'day', label: 'Day', type: 'toggle' },
        { key: 'periods', label: 'Own periods', type: 'list', add: 'Add a period', hint: 'e.g. a semester or a shoot',
            item: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'from', label: 'From', type: 'date' }, { key: 'to', label: 'To', type: 'date' }],
            newItem: () => ({ name: '', from: todayISO(), to: isoOfDate(new Date(Date.now() + 90 * dayMs)) }) },
        { key: '', label: 'Look', type: 'section' },
        { key: 'look', label: 'Look', type: 'select', options: [['bar', 'Bars'], ['ring', 'Rings'], ['number', 'Numbers only']] },
        { key: 'show', label: 'Numbers', type: 'select', options: [['both', 'Percent and time left'], ['percent', 'Percent'], ['left', 'Time left'], ['none', 'None']] },
        { key: 'unit', label: 'Time left in', type: 'select', options: [['auto', 'Automatic'], ['days', 'Days'], ['weeks', 'Weeks']], show: (d) => d.show === 'both' || d.show === 'left' },
        COLOR(),
    ],
    render(c) {
        const d = c.data, now = new Date();
        // older widgets had one own period
        if (d.custom && d.from && d.to && !d.periods?.length)
            c.set({ periods: [{ name: d.custom, from: d.from, to: d.to }], custom: '' });
        const rows = [];
        const span = (label, a, b, hours = false) => rows.push({ label, pct: clamp((now.getTime() - a.getTime()) / (b.getTime() - a.getTime()) * 100), left: (b.getTime() - now.getTime()) / dayMs, hours });
        if (d.year)
            span(String(now.getFullYear()), new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1));
        if (d.month)
            span(now.toLocaleDateString(undefined, { month: 'long' }), new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1));
        if (d.week) {
            const back = (now.getDay() + 6 - weekStart() + 7) % 7;
            const m = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
            span('This week', m, new Date(m.getTime() + 7 * dayMs));
        }
        if (d.day)
            span('Today', new Date(now.getFullYear(), now.getMonth(), now.getDate()), new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), true);
        for (const p of (Array.isArray(d.periods) ? d.periods : []))
            if (p?.from && p?.to && p.to > p.from)
                span(p.name || 'Period', new Date(p.from + 'T00:00'), new Date(p.to + 'T00:00'));
        c.every(60000, () => c.redraw());
        if (!rows.length)
            return c.h('span', { class: 'w-sub' }, 'Nothing chosen – choose under ⋯');
        const show = d.show ?? 'both';
        const leftText = (r) => {
            if (r.hours) {
                const h = Math.max(0, Math.ceil(r.left * 24));
                return `${plural(h, 'hour')} left`;
            }
            const days = Math.max(0, Math.ceil(r.left));
            const weeks = d.unit === 'weeks' || (d.unit !== 'days' && days > 60);
            return weeks ? `${plural(Math.round(days / 7), 'week')} left` : `${plural(days, 'day')} left`;
        };
        const pctText = (r) => `${Math.floor(r.pct)} %`;
        if (d.look === 'ring')
            return c.h('div', { class: 'w-rings' }, rows.map((r) => c.h('div', { class: 'w-col w-center' }, ring(c, r.pct, d.color, show === 'left' || show === 'none' ? '' : `${Math.floor(r.pct)}%`, 8), c.h('span', { class: 'w-label strong' }, r.label), show === 'both' || show === 'left' ? c.h('span', { class: 'w-sub' }, leftText(r)) : null)));
        if (d.look === 'number')
            return c.h('div', { class: 'w-nums' }, rows.map((r) => c.h('div', { class: 'w-col' }, c.h('span', { class: 'w-label' }, r.label), c.h('span', { class: 'w-big' }, show === 'left' ? leftText(r).replace(' left', '') : pctText(r)), show === 'both' ? c.h('span', { class: 'w-sub' }, leftText(r)) : null)));
        return c.h('div', { class: 'w-col w-gap' }, rows.map((r, i) => c.h('div', { class: 'w-col' }, c.h('span', { class: 'w-label strong' + (i === 0 ? ' w-head' : '') }, r.label), bar(c, r.pct, d.color), show === 'none' ? null : c.h('div', { class: 'w-row w-between' }, show !== 'left' ? c.h('span', { class: 'w-sub' }, pctText(r)) : c.h('span'), show === 'both' || show === 'left' ? c.h('span', { class: 'w-sub' }, leftText(r)) : null))));
    },
});
// ── Quote / prompt ──────────────────────────────────────────────────────────
registerWidget({
    id: 'quote', name: 'Quote', icon: 'feather', description: 'A quote or writing prompt from your own list',
    defaults: () => ({ quotes: [{ t: 'Kill your darlings.', by: '' }, { t: 'Show, don’t tell.', by: '' }, { t: 'Every scene needs a turn.', by: '' }], mode: 'day', pick: 0, size: 'm', by: true }),
    settings: [
        { key: '', label: 'Quotes', type: 'section' },
        { key: 'quotes', label: 'Quotes', type: 'list', add: 'Add a quote', hint: 'No quotes yet',
            item: [{ key: 't', label: 'Quote', type: 'text' }, { key: 'by', label: 'By', type: 'text', hint: 'Source', width: 90, show: (d) => d.by !== false }], newItem: () => ({ t: '', by: '' }) },
        { key: '', label: 'Behaviour', type: 'section' },
        { key: 'mode', label: 'A new one', type: 'select', options: [['day', 'Every day'], ['open', 'Each time the page opens'], ['click', 'Only on click']] },
        { key: '', label: 'Look', type: 'section' },
        { key: 'by', label: 'Show source', type: 'toggle' },
        { key: 'size', label: 'Quote size', type: 'select', options: [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] },
    ],
    render(c) {
        const d = c.data;
        // older widgets: one quote per line
        if (Array.isArray(d.lines) && !d.quotes)
            c.set({ quotes: d.lines.map((t) => ({ t, by: d.source || '' })), lines: undefined });
        const qs = (Array.isArray(d.quotes) ? d.quotes : []).filter((q) => q?.t?.trim());
        if (!qs.length)
            return c.h('span', { class: 'w-sub' }, 'No quotes yet – add them under ⋯');
        const day = Math.floor(Date.now() / dayMs);
        const base = d.mode === 'day' ? day : d.mode === 'open' ? (openSeed ??= Math.floor(Math.random() * 1000)) : 0;
        const q = qs[(base + (d.pick ?? 0)) % qs.length];
        return c.h('div', { class: 'w-col' }, c.h('div', { class: `w-quote size-${d.size || 'm'}` }, q.t), c.h('div', { class: 'w-row w-between w-quote-foot' }, c.h('span', { class: 'w-sub' }, q.by && d.by !== false ? `— ${q.by}` : ''), qs.length > 1 ? c.h('button', { class: 'icon-btn w-again', title: 'Another one', 'aria-label': 'Another quote', onclick: () => { c.set({ pick: (d.pick ?? 0) + 1 + Math.floor(Math.random() * Math.max(1, qs.length - 1)) }); c.redraw(); } }, c.icon('refresh', 15)) : null));
    },
});
let openSeed;
// ── Counter ─────────────────────────────────────────────────────────────────
registerWidget({
    id: 'counter', name: 'Counter', icon: 'plus-circle', description: 'Tap to count',
    defaults: () => ({ title: 'Counter', value: 0, step: 1, goal: null, color: 'accent' }),
    settings: [
        { key: 'title', label: 'Name', type: 'text' },
        { key: '', label: 'Count', type: 'section' },
        { key: 'value', label: 'Current value', type: 'number' },
        { key: 'goal', label: 'Goal', type: 'number', hint: 'Optional' },
        { key: '', label: 'Look', type: 'section' },
        COLOR(),
    ],
    render(c) {
        const d = c.data;
        const add = (k) => { c.set({ value: (Number(d.value) || 0) + k }); c.redraw(); };
        return c.h('div', { class: 'w-col w-center' }, c.h('span', { class: 'w-label' }, d.title || 'Counter'), c.h('div', { class: 'w-row w-counter' }, c.h('button', { class: 'w-btn round', 'aria-label': 'Minus', onclick: () => add(-1) }, '−'), c.h('span', { class: 'w-big w-mono' }, String(d.value ?? 0)), c.h('button', { class: 'w-btn round primary', style: { background: c.color(d.color).tag }, 'aria-label': 'Plus', onclick: () => add(1) }, '+')), d.goal ? c.h('div', { class: 'w-col', style: { width: '100%' } }, bar(c, (Number(d.value) / Number(d.goal)) * 100, d.color), c.h('span', { class: 'w-sub' }, `${d.value} of ${d.goal}`)) : null);
    },
});
// ── Quick checklist ─────────────────────────────────────────────────────────
registerWidget({
    id: 'checklist', name: 'Checklist', icon: 'check-square', description: 'Light to-dos without a database',
    defaults: () => ({ title: 'Checklist', items: [], hideDone: false, count: true, color: 'accent' }),
    settings: [
        { key: 'title', label: 'Name', type: 'text' },
        { key: '', label: 'Look', type: 'section' },
        { key: 'hideDone', label: 'Hide done items', type: 'toggle' },
        { key: 'count', label: 'Show count', type: 'toggle' },
        COLOR('color', 'Checkbox color'),
    ],
    render(c) {
        const items = Array.isArray(c.data.items) ? c.data.items : [];
        const save = (next) => { c.set({ items: next }); c.redraw(); };
        const done = items.filter((i) => i.done).length;
        const col = c.color(c.data.color).tag;
        const input = c.h('input', { class: 'w-input', placeholder: 'Add an item…', disabled: c.readonly });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && input.value.trim()) {
                save([...items, { t: input.value.trim() }]);
                requestAnimationFrame(() => c.el.querySelector('.w-input')?.focus());
            }
        });
        return c.h('div', { class: 'w-col' }, c.h('div', { class: 'w-row w-head' }, c.h('span', { class: 'w-label strong' }, c.data.title || 'Checklist', items.length && c.data.count !== false ? c.h('span', { class: 'w-count' }, `${done}/${items.length}`) : null)), ...items.map((it, i) => (c.data.hideDone && it.done ? null : c.h('div', { class: 'w-check' + (it.done ? ' done' : '') }, c.h('button', { class: 'w-box' + (it.done ? ' on' : ''), style: it.done ? { background: col, borderColor: col } : undefined, role: 'checkbox', 'aria-checked': String(!!it.done), onclick: () => save(items.map((x, k) => (k === i ? { ...x, done: !x.done } : x))) }, it.done ? c.icon('check-bold', 11) : null), c.h('span', { class: 'w-check-t' }, it.t), c.h('button', { class: 'icon-btn w-del', 'aria-label': 'Remove', onclick: () => save(items.filter((_, k) => k !== i)) }, c.icon('x-bold', 11))))), c.readonly ? null : input);
    },
});
const NOTE_TURN = [
    { type: 'paragraph', label: 'Text', icon: 'type' },
    { type: 'heading', level: 1, label: 'Heading 1', icon: 'heading' },
    { type: 'heading', level: 2, label: 'Heading 2', icon: 'heading' },
    { type: 'heading', level: 3, label: 'Heading 3', icon: 'heading' },
];
registerWidget({
    id: 'note', name: 'Sticky note', icon: 'sticky-note', description: 'A colored scratch pad', background: 'yellow',
    defaults: () => ({ title: '', lines: [{ t: '' }] }),
    settings: [{ key: 'title', label: 'Name', type: 'text', hint: 'Optional' }],
    render(c) {
        // older notes: one text with line breaks
        if (!Array.isArray(c.data.lines))
            c.set({ lines: String(c.data.text ?? '').split('\n').map((t) => ({ t })), text: undefined });
        const lines = c.data.lines.length ? c.data.lines : [{ t: '' }];
        const save = () => c.set({ lines: lines.map((l) => ({ ...l })) });
        const box = c.h('div', { class: 'w-note-lines' });
        // the page's editor must not treat these lines as its own text
        for (const ev of ['input', 'beforeinput', 'paste', 'cut', 'copy', 'compositionend'])
            box.addEventListener(ev, (e) => e.stopPropagation());
        const els = [];
        const caretOffset = (el) => { const sel = getSelection(); if (!sel?.rangeCount)
            return 0; const r = sel.getRangeAt(0).cloneRange(); r.selectNodeContents(el); r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset); return r.toString().length; };
        const placeCaret = (el, at) => {
            el.focus();
            const sel = getSelection();
            if (!sel)
                return;
            const r = document.createRange();
            if (at === 'start')
                r.setStart(el, 0);
            else if (at === 'end') {
                r.selectNodeContents(el);
                r.collapse(false);
            }
            else { // a character offset inside the text
                let left = at;
                const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                let n;
                let done = false;
                while ((n = walk.nextNode())) {
                    const len = n.textContent?.length ?? 0;
                    if (left <= len) {
                        r.setStart(n, left);
                        done = true;
                        break;
                    }
                    left -= len;
                }
                if (!done) {
                    r.selectNodeContents(el);
                    r.collapse(false);
                }
            }
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
        };
        // after a change of the lines: draw again and put the caret back at once (no keystroke gets lost)
        const again = (line, at) => {
            save();
            c.redraw();
            const all = [...c.el.querySelectorAll('.w-note-line')];
            const el = all[Math.min(line, all.length - 1)];
            if (el)
                placeCaret(el, at);
        };
        const style = (el, l) => {
            el.className = `txt w-note-line ${l.type ?? 'p'}` + (el.textContent ? '' : ' empty');
            el.style.textAlign = l.align ?? '';
        };
        lines.forEach((l, i) => {
            const el = c.h('div', { contenteditable: c.readonly ? 'false' : 'true', spellcheck: 'true', 'data-placeholder': i === 0 && lines.length === 1 ? 'Write something…' : '' });
            el.innerHTML = inlineToHtml(l.t);
            style(el, l);
            els.push(el);
            if (c.readonly) {
                box.append(el);
                return;
            }
            el.addEventListener('input', () => {
                // "# " at the start of a line: a heading (as on pages)
                const m = (el.textContent ?? '').match(/^(#{1,3})\s/);
                if (m) {
                    l.type = (`h${m[1].length}`);
                    l.t = htmlToInline(el).replace(/^#{1,3}\s/, '');
                    el.innerHTML = inlineToHtml(l.t);
                    style(el, l);
                    placeCaret(el, 'end');
                    save();
                    return;
                }
                l.t = htmlToInline(el);
                el.classList.toggle('empty', !el.textContent);
                save();
            });
            el.addEventListener('keydown', (e) => {
                if (formatKey(e)) {
                    e.stopPropagation();
                    return;
                }
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) {
                    // split the line at the caret; the new line is plain text
                    e.preventDefault();
                    const sel = getSelection();
                    if (!sel?.rangeCount)
                        return;
                    const r = sel.getRangeAt(0);
                    r.deleteContents();
                    const tail = document.createRange();
                    tail.setStart(r.startContainer, r.startOffset);
                    tail.setEnd(el, el.childNodes.length);
                    const tmp = document.createElement('div');
                    tmp.append(tail.extractContents());
                    l.t = htmlToInline(el);
                    lines.splice(i + 1, 0, { t: htmlToInline(tmp), align: l.align });
                    again(i + 1, 'start');
                }
                else if (e.key === 'Backspace' && i > 0 && getSelection()?.isCollapsed && caretOffset(el) === 0) {
                    // at the start: join with the line above
                    e.preventDefault();
                    const prev = lines[i - 1], keep = (els[i - 1].textContent ?? '').length;
                    prev.t = prev.t + l.t;
                    lines.splice(i, 1);
                    again(i - 1, keep);
                }
                else if (e.key === 'Backspace' && i === 0 && lines.length === 1 && !el.textContent && l.type && l.type !== 'p') {
                    e.preventDefault();
                    l.type = 'p';
                    again(0, 'start');
                }
                else if (e.key === 'ArrowUp' && i > 0 && caretOffset(el) === 0) {
                    e.preventDefault();
                    placeCaret(els[i - 1], 'end');
                }
                else if (e.key === 'ArrowDown' && i < lines.length - 1 && caretOffset(el) === (el.textContent ?? '').length) {
                    e.preventDefault();
                    placeCaret(els[i + 1], 'start');
                }
            });
            el.addEventListener('paste', (e) => {
                e.preventDefault();
                const text = e.clipboardData?.getData('text/plain') ?? '';
                if (!text.includes('\n')) {
                    document.execCommand('insertText', false, text);
                    return;
                }
                const parts = text.split('\n');
                document.execCommand('insertText', false, parts[0]);
                l.t = htmlToInline(el);
                lines.splice(i + 1, 0, ...parts.slice(1).map((t) => ({ t })));
                again(i + parts.length - 1, 'end');
            });
            box.append(el);
        });
        // the format bar: text style and alignment work per line
        if (!c.readonly)
            registerFormatHost(box, {
                blockOf: (el) => { const i = els.indexOf(el); const l = lines[i]; if (!l)
                    return undefined; return { id: `note-${i}`, type: l.type && l.type !== 'p' ? 'heading' : 'paragraph', level: l.type && l.type !== 'p' ? Number(l.type[1]) : undefined, align: l.align }; },
                sync: (b, el) => { const i = els.indexOf(el); if (lines[i]) {
                    lines[i].t = htmlToInline(el);
                    save();
                } void b; },
                turnInto: (b, t) => { const i = Number(b.id.slice(5)); const l = lines[i]; if (!l)
                    return; l.type = t.type === 'heading' ? `h${t.level ?? 1}` : 'p'; again(i, 'end'); },
                setAlign: (b, a) => { const i = Number(b.id.slice(5)); const l = lines[i]; if (!l)
                    return; if (a === 'center' || a === 'right')
                    l.align = a;
                else
                    delete l.align; style(els[i], l); save(); },
                turnOptions: NOTE_TURN,
            });
        return c.h('div', { class: 'w-col w-note' }, c.data.title ? c.h('span', { class: 'w-label strong w-head' }, c.data.title) : null, box);
    },
});
// ── Clocks ──────────────────────────────────────────────────────────────────
registerWidget({
    id: 'clocks', name: 'Clocks', icon: 'clock', description: 'Your time and other places',
    defaults: () => ({ here: true, clocks: [{ name: '', tz: 'America/Los_Angeles' }, { name: '', tz: 'Asia/Tokyo' }], seconds: false, date: true, format: 'app' }),
    settings: [
        { key: '', label: 'Places', type: 'section' },
        { key: 'here', label: 'Your own time first', type: 'toggle' },
        { key: 'clocks', label: 'Clocks', type: 'list', add: 'Add a clock', hint: 'No other places yet',
            item: [{ key: 'tz', label: 'Time zone', type: 'timezone' }, { key: 'name', label: 'Name', type: 'text', hint: 'Name (optional)' }], newItem: () => ({ name: '', tz: '' }) },
        { key: '', label: 'Look', type: 'section' },
        { key: 'format', label: 'Time format', type: 'select', options: [['app', 'As in Settings'], ['24h', '24-hour'], ['12h', '12-hour (AM/PM)']] },
        { key: 'seconds', label: 'Seconds', type: 'toggle' },
        { key: 'date', label: 'Date', type: 'toggle' },
    ],
    render(c) {
        const d = c.data;
        // older widgets: "Name = Time zone" lines
        if (Array.isArray(d.zones) && !d.clocks)
            c.set({ clocks: d.zones.map((z) => { const [name, tz] = z.includes('=') ? z.split('=').map((s) => s.trim()) : ['', z.trim()]; return { name, tz }; }), zones: undefined, here: false });
        const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const list = [...(d.here !== false ? [{ name: 'Here', tz: here }] : []), ...(Array.isArray(d.clocks) ? d.clocks : []).filter((x) => x?.tz)];
        const h12 = d.format === '12h' || (d.format !== '24h' && c.hour12);
        const cells = list.map((x) => ({ ...x, t: c.h('b', { class: 'w-mono' }), s: c.h('span', { class: 'w-sub' }) }));
        const tick = () => {
            const now = new Date();
            for (const x of cells) {
                try {
                    x.t.textContent = now.toLocaleTimeString(undefined, { timeZone: x.tz, hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', second: d.seconds ? '2-digit' : undefined, hour12: h12 });
                    x.s.textContent = now.toLocaleDateString(undefined, { timeZone: x.tz, weekday: 'short', day: 'numeric', month: 'short' });
                }
                catch {
                    x.t.textContent = '?';
                    x.s.textContent = 'Unknown time zone';
                }
            }
        };
        tick();
        c.every(d.seconds ? 1000 : 10000, tick);
        if (!cells.length)
            return c.h('span', { class: 'w-sub' }, 'No clocks – add them under ⋯');
        return c.h('div', { class: 'w-clocks' }, cells.map((x) => c.h('div', { class: 'w-clock' }, c.h('span', { class: 'w-label' }, x.name || zoneCity(x.tz)), x.t, d.date !== false ? x.s : null)));
    },
});
const WMO = { 0: ['clear', 'Clear'], 1: ['mostly', 'Mostly clear'], 2: ['partly', 'Partly cloudy'], 3: ['cloudy', 'Cloudy'], 45: ['fog', 'Fog'], 48: ['fog', 'Fog'], 51: ['drizzle', 'Drizzle'], 53: ['drizzle', 'Drizzle'], 55: ['drizzle', 'Drizzle'], 56: ['freezing', 'Freezing drizzle'], 57: ['freezing', 'Freezing drizzle'], 61: ['rain', 'Rain'], 63: ['rain', 'Rain'], 65: ['rain', 'Heavy rain'], 66: ['freezing', 'Freezing rain'], 67: ['freezing', 'Freezing rain'], 71: ['snow', 'Snow'], 73: ['snow', 'Snow'], 75: ['snow', 'Heavy snow'], 77: ['snow', 'Snow grains'], 80: ['showers', 'Showers'], 81: ['showers', 'Showers'], 82: ['showers', 'Heavy showers'], 85: ['snow', 'Snow showers'], 86: ['snow', 'Snow showers'], 95: ['storm', 'Thunderstorm'], 96: ['storm', 'Thunderstorm'], 99: ['storm', 'Thunderstorm'] };
const SUN = '#f5b53d', MOON = '#c7d0e0', RAIN = '#4b9de6', SNOW = '#bcd8f2';
const CLOUD = 'M9.5 27h14a5.5 5.5 0 0 0 .6-10.97A8 8 0 0 0 8.6 18.3 4.4 4.4 0 0 0 9.5 27z';
const sunAt = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${SUN}"/>` + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180); return `<line x1="${x + c * (r + 2.2)}" y1="${y + s * (r + 2.2)}" x2="${x + c * (r + 4.6)}" y2="${y + s * (r + 4.6)}" stroke="${SUN}" stroke-width="2" stroke-linecap="round"/>`; }).join('');
const moonAt = (x, y, r) => `<path d="M${x + r * 0.35} ${y - r}a${r} ${r} 0 1 0 ${r * 0.65} ${r * 1.55}A${r * 0.82} ${r * 0.82} 0 0 1 ${x + r * 0.35} ${y - r}z" fill="${MOON}"/>`;
const cloud = (dy = 0, tone = 'var(--w-cloud, #a9b3c2)') => `<path d="${CLOUD}" transform="translate(0 ${dy})" fill="${tone}"/>`;
const drops = (color, n, len) => [10, 16, 22].slice(0, n).map((x) => `<line x1="${x}" y1="25" x2="${x - 1.5}" y2="${25 + len}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`).join('');
function skyIcon(sky, night, size) {
    const body = night ? (x, y, r) => moonAt(x, y, r) : sunAt;
    const g = {
        clear: night ? moonAt(19, 16, 9) : sunAt(16, 16, 6.5),
        mostly: body(13, 12, night ? 7 : 5) + `<path d="M13 28h11a4.3 4.3 0 0 0 .4-8.6 6.3 6.3 0 0 0-12.2 1.8A3.4 3.4 0 0 0 13 28z" fill="var(--w-cloud, #a9b3c2)"/>`,
        partly: body(11.5, 11, night ? 7 : 5) + cloud(),
        cloudy: `<path d="M14 19h11a4.3 4.3 0 0 0 .4-8.6 6.3 6.3 0 0 0-12.2 1.8A3.4 3.4 0 0 0 14 19z" fill="var(--w-cloud, #a9b3c2)" opacity=".5"/>` + cloud(1),
        fog: cloud(-6) + [22, 26.5].map((y, i) => `<line x1="${7 + i * 3}" y1="${y}" x2="${25 + i * 1}" y2="${y}" stroke="var(--w-cloud, #a9b3c2)" stroke-width="2.2" stroke-linecap="round"/>`).join(''),
        drizzle: cloud(-6) + drops(RAIN, 3, 3),
        rain: cloud(-6) + drops(RAIN, 3, 5.5),
        freezing: cloud(-6) + drops(RAIN, 2, 5) + `<circle cx="22" cy="28" r="1.8" fill="${SNOW}"/>`,
        showers: body(10, 9, night ? 6 : 4.2) + cloud(-5) + drops(RAIN, 3, 5),
        snow: cloud(-6) + [[10, 26], [16, 29], [22, 26]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="${SNOW}"/>`).join(''),
        storm: cloud(-6) + `<path d="M17 21l-4.5 6.5h4l-2 5.5 6-7.5h-4l2.5-4.5z" fill="${SUN}"/>`,
    };
    const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    e.setAttribute('viewBox', '0 0 32 34');
    e.setAttribute('width', String(size));
    e.setAttribute('height', String(size));
    e.setAttribute('class', 'w-sky');
    e.innerHTML = g[sky];
    return e;
}
registerWidget({
    id: 'weather', name: 'Weather', icon: 'cloud', description: 'Today and the next days for a place (Open-Meteo)',
    defaults: () => ({ place: 'Köln', days: 4, unit: 'celsius', wind: true, range: true }),
    settings: [
        { key: 'place', label: 'Place', type: 'text' },
        { key: 'unit', label: 'Unit', type: 'select', options: [['celsius', '°C'], ['fahrenheit', '°F']] },
        { key: '', label: 'Show', type: 'section' },
        { key: 'days', label: 'Days ahead', type: 'select', options: ['0', '1', '2', '3', '4', '5', '6', '7'] },
        { key: 'wind', label: 'Show wind', type: 'toggle' },
        { key: 'range', label: 'High and low', type: 'toggle' },
    ],
    render(c) {
        const d = c.data;
        const box = c.h('div', { class: 'w-col' }, c.h('span', { class: 'w-sub' }, `Loading weather for ${d.place}…`));
        void (async () => {
            try {
                const g = await c.fetchJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(d.place)}`, 24 * 60);
                const loc = g?.results?.[0];
                if (!loc) {
                    box.replaceChildren(c.h('span', { class: 'w-sub' }, `Place “${d.place}” not found.`));
                    return;
                }
                const n = Number(d.days) || 0;
                const w = await c.fetchJSON(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code,wind_speed_10m,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=${Math.min(8, n + 1)}&temperature_unit=${d.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius'}`, 30);
                const [sky, txt] = WMO[w.current.weather_code] ?? ['cloudy', ''];
                const night = w.current.is_day === 0;
                const days = w.daily.time.slice(1, 1 + n);
                // the sky on one line, wind and today's high / low on the next – each kept on its line
                const facts2 = [d.range !== false ? `${Math.round(w.daily.temperature_2m_max[0])}° / ${Math.round(w.daily.temperature_2m_min[0])}°` : '', d.wind !== false ? `wind ${Math.round(w.current.wind_speed_10m)} km/h` : ''].filter(Boolean).join(' · ');
                box.replaceChildren(...[
                    c.h('div', { class: 'w-row w-head' }, c.h('span', { class: 'w-emoji' }, skyIcon(sky, night, 40)), c.h('span', { class: 'w-big' }, `${Math.round(w.current.temperature_2m)}°`), c.h('div', { class: 'w-col' }, c.h('span', { class: 'w-label strong w-1line' }, loc.name), c.h('span', { class: 'w-sub w-1line' }, txt), facts2 ? c.h('span', { class: 'w-sub w-1line' }, facts2) : null)),
                    days.length ? c.h('div', { class: 'w-days' }, days.map((x, k) => c.h('div', { class: 'w-day' }, c.h('span', { class: 'w-sub' }, new Date(x + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })), c.h('span', { class: 'w-day-ico' }, skyIcon((WMO[w.daily.weather_code[k + 1]] ?? ['cloudy'])[0], false, 24)), c.h('b', null, `${Math.round(w.daily.temperature_2m_max[k + 1])}°`), c.h('span', { class: 'w-sub' }, `${Math.round(w.daily.temperature_2m_min[k + 1])}°`)))) : null
                ].filter((x) => !!x));
            }
            catch (e) {
                box.replaceChildren(c.h('span', { class: 'w-sub' }, `No weather right now (${e.message}).`));
            }
        })();
        return box;
    },
});
// ── Bookmarks / launcher ────────────────────────────────────────────────────
registerWidget({
    id: 'bookmarks', name: 'Bookmarks', icon: 'bookmark', description: 'A grid of links to websites and pages',
    defaults: () => ({ items: [{ icon: '🎬', name: 'Vimeo', target: 'https://vimeo.com' }], size: 'm', names: true }),
    settings: [
        { key: '', label: 'Links', type: 'section' },
        { key: 'items', label: 'Links', type: 'list', add: 'Add a link', hint: 'No links yet',
            item: [{ key: 'icon', label: 'Icon', type: 'emoji' }, { key: 'name', label: 'Name', type: 'text', width: 84 }, { key: 'target', label: 'Address or page', type: 'link' }],
            newItem: () => ({ icon: '', name: '', target: '' }) },
        { key: '', label: 'Look', type: 'section' },
        { key: 'size', label: 'Tile size', type: 'select', options: [['xs', 'Compact'], ['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] },
        { key: 'names', label: 'Show names', type: 'toggle' },
    ],
    render(c) {
        const d = c.data;
        // older widgets: "icon Name | address" lines
        if (Array.isArray(d.links) && !d.items) {
            const pages = c.pages();
            c.set({ links: undefined, items: d.links.map((line) => {
                    const [left, target = ''] = line.split('|').map((s) => s.trim());
                    const m = left.match(/^(\p{Extended_Pictographic}️?|\S{1,2}\s)?\s*(.*)$/u);
                    const page = /^https?:\/\//i.test(target) ? null : pages.find((p) => p.title.toLowerCase() === target.toLowerCase());
                    return { icon: m?.[1]?.trim() ?? '', name: (m?.[2] ?? left).trim(), target: page ? `page:${page.id}` : target };
                }) });
        }
        const items = Array.isArray(d.items) ? d.items : [];
        const tiles = items.filter((x) => x.target || x.name).map((x) => {
            const t = x.target ?? '';
            const page = t.startsWith('page:') ? c.page(t.slice(5)) : null;
            const url = page ? '' : /^[a-z]+:/i.test(t) ? t : t.includes('.') ? `https://${t}` : '';
            const name = x.name || page?.title || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
            const ico = x.icon || page?.icon || '';
            return c.h('button', { class: 'w-tile', title: page ? page.title : url, onclick: () => (page ? c.openPage(page.id) : url && c.openUrl(url)) }, c.h('span', { class: 'w-tile-ico' }, ico ? renderIcon(ico, 22) : c.icon(page ? 'file' : 'link', 18)), d.names !== false ? c.h('span', { class: 'w-tile-name' }, name) : null);
        });
        if (!tiles.length)
            return c.h('span', { class: 'w-sub' }, 'No links yet – add them under ⋯');
        return c.h('div', { class: `w-tiles size-${d.size || 'm'}` }, tiles);
    },
});
// ── Habit ───────────────────────────────────────────────────────────────────
const habitOffset = new WeakMap();
registerWidget({
    id: 'habit', name: 'Habit', icon: 'sprout', description: 'Tick off days, see the month and keep a streak',
    defaults: () => ({ name: 'Writing', days: [], color: 'green', view: 'month', goal: 'daily', perWeek: 3, weeks: 16 }),
    settings: [
        // a habit of a log (its Habits module): name, colour and ticks live in the log's entries – or the widget's own
        { key: 'link', label: 'Habit', type: 'select', get options() { return [['', 'Its own (only here)'], ...logHabits().map((x) => [`${x.db}|${x.prop}`, `${x.dbName} · ${x.prop}`])]; } },
        { key: 'name', label: 'Name', type: 'text', show: (d) => !d.link },
        { key: '', label: 'Goal', type: 'section' },
        { key: 'goal', label: 'Goal', type: 'select', options: [['daily', 'Every day'], ['weekly', 'Some days a week']] },
        { key: 'perWeek', label: 'Days a week', type: 'select', options: ['1', '2', '3', '4', '5', '6'], show: (d) => d.goal === 'weekly' },
        { key: '', label: 'Look', type: 'section' },
        { key: 'view', label: 'Show', type: 'select', options: [['month', 'Month'], ['weeks', 'Last weeks']] },
        { key: 'weeks', label: 'Weeks', type: 'select', options: ['8', '12', '16', '26', '52'], show: (d) => d.view === 'weeks' },
        { ...COLOR(), show: (d) => !d.link },
    ],
    render(c) {
        const d = c.data;
        const app = c._app;
        const link = typeof d.link === 'string' && d.link ? d.link.split('|') : null;
        const ldb = link ? Database.lookup(link[0]) : undefined;
        const lprop = link?.[1] ?? '';
        const linked = !!(ldb && ldb.prop(lprop));
        const cfg = linked ? dayConfig(ldb) : null;
        let set;
        let toggle;
        if (linked) {
            // the log's entries: a day is done when its entry has the habit ticked
            const idx = dayIndex(ldb, cfg.prop);
            set = new Set([...idx].filter(([, r]) => !!ldb.value(r, lprop)).map(([day]) => isoFromDay(day)));
            toggle = (iso) => void (async () => {
                const day = dayNum(iso);
                let r = idx.get(day);
                app.ws.boundary();
                if (!r) {
                    const l = dayLabel(day);
                    r = await app.ws.addRow(ldb, { [ldb.labelProp]: `${l.wd}, ${l.day} ${l.month} ${l.year}`, [cfg.prop]: { start: iso } }, '');
                }
                r.values[lprop] = !ldb.value(r, lprop);
                await app.ws.saveRow(ldb, r);
                c.redraw();
            })();
        }
        else {
            set = new Set(Array.isArray(d.days) ? d.days : []);
            toggle = (iso) => { if (set.has(iso))
                set.delete(iso);
            else
                set.add(iso); c.set({ days: [...set].sort() }); c.redraw(); };
        }
        const today = todayISO(), col = linked ? habitColor(cfg, lprop) : c.color(d.color).tag;
        const ws = weekStart();
        const weekOf = (iso) => { const t = new Date(iso + 'T12:00'); const back = (t.getDay() + 6 - ws + 7) % 7; return isoOfDate(new Date(t.getTime() - back * dayMs)); };
        // streak: days in a row – or, with a weekly goal, weeks that reached it
        const weekly = d.goal === 'weekly', per = Number(d.perWeek) || 3;
        let streak = 0, best = 0, run = 0;
        if (!weekly) {
            for (let t = new Date();; t = new Date(t.getTime() - dayMs)) {
                const k = isoOfDate(t);
                if (set.has(k))
                    streak++;
                else if (k !== today)
                    break;
                if (streak > 3650)
                    break;
            }
            const all = [...set].sort();
            let prev = '';
            for (const k of all) {
                run = prev && isoOfDate(new Date(new Date(prev + 'T12:00').getTime() + dayMs)) === k ? run + 1 : 1;
                best = Math.max(best, run);
                prev = k;
            }
        }
        else {
            const count = new Map();
            for (const k of set)
                count.set(weekOf(k), (count.get(weekOf(k)) ?? 0) + 1);
            for (let w = weekOf(today), first = true;; first = false) {
                const n = count.get(w) ?? 0;
                if (n >= per)
                    streak++;
                else if (!first)
                    break;
                w = isoOfDate(new Date(new Date(w + 'T12:00').getTime() - 7 * dayMs));
                if (streak > 520)
                    break;
            }
            const ws2 = [...count.keys()].sort();
            let prev = '';
            for (const w of ws2) {
                if ((count.get(w) ?? 0) < per) {
                    run = 0;
                    prev = w;
                    continue;
                }
                run = prev && isoOfDate(new Date(new Date(prev + 'T12:00').getTime() + 7 * dayMs)) === w && run ? run + 1 : 1;
                best = Math.max(best, run);
                prev = w;
            }
        }
        best = Math.max(best, streak);
        const unit = weekly ? 'week' : 'day';
        const cell = (k, extra = '', text) => {
            const on = set.has(k), future = k > today;
            return c.h('button', { class: 'w-day-cell' + extra + (on ? ' on' : '') + (k === today ? ' today' : '') + (future ? ' future' : ''), title: fmtDay(k), disabled: future || c.readonly, style: on ? { background: col } : undefined, onclick: () => toggle(k) }, text ?? null);
        };
        const dows = Array.from({ length: 7 }, (_, i) => WEEKDAYS[(i + ws) % 7].slice(0, 2));
        let grid, foot;
        if (d.view === 'weeks') {
            // one column per week, the newest on the right; it fills the width
            const n = Math.max(4, Math.min(52, Number(d.weeks) || 16));
            const start = new Date(new Date(weekOf(today) + 'T12:00').getTime() - (n - 1) * 7 * dayMs);
            const cells = [];
            for (let i = 0; i < n * 7; i++)
                cells.push(cell(isoOfDate(new Date(start.getTime() + i * dayMs)), ' sq'));
            grid = c.h('div', { class: 'w-habit-weeks', style: { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` } }, cells);
            const from = isoOfDate(start);
            foot = `${[...set].filter((k) => k >= from && k <= today).length} days in ${n} weeks`;
        }
        else {
            // a month as a calendar, with ‹ › to look back
            const off = habitOffset.get(c.el) ?? 0, now = new Date();
            const m = new Date(now.getFullYear(), now.getMonth() + off, 1), mi = m.getMonth();
            const lead = (m.getDay() + 6 - ws + 7) % 7;
            const cells = dows.map((x) => c.h('span', { class: 'w-sub w-hd' }, x));
            for (let i = 0; i < lead; i++)
                cells.push(c.h('span'));
            const len = new Date(m.getFullYear(), mi + 1, 0).getDate();
            for (let k = 1; k <= len; k++)
                cells.push(cell(isoOfDate(new Date(m.getFullYear(), mi, k)), '', String(k)));
            const go = (n) => { habitOffset.set(c.el, off + n); c.redraw(); };
            const label = m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            grid = c.h('div', { class: 'w-col' }, c.h('div', { class: 'w-row w-period' }, c.h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => go(-1) }, c.icon('chevron-left-bold', 13)), c.h('button', { class: 'w-label strong w-period-pick', onclick: (e) => zoomPicker(e.currentTarget, { iso: `${m.getFullYear()}-${pad2(mi + 1)}-01`, onMonth: (yy, mm) => { habitOffset.set(c.el, Math.min(0, (yy - now.getFullYear()) * 12 + mm - 1 - now.getMonth())); c.redraw(); } }) }, label), c.h('button', { class: 'icon-btn', 'aria-label': 'Next month', disabled: off >= 0, onclick: () => go(1) }, c.icon('chevron-right-bold', 13)), off ? c.h('button', { class: 'w-chip', onclick: () => go(-off) }, 'Today') : null), c.h('div', { class: 'w-habit-month' }, cells));
            const mk = `${m.getFullYear()}-${pad2(mi + 1)}`, upto = off ? len : now.getDate();
            foot = `${[...set].filter((k) => k.startsWith(mk)).length} of ${upto} days this month`.replace('this month', off ? 'in ' + m.toLocaleDateString(undefined, { month: 'long' }) : 'this month');
        }
        return c.h('div', { class: 'w-col w-habit' }, c.h('div', { class: 'w-row w-head' }, c.h('div', { class: 'w-col' }, c.h('span', { class: 'w-label strong' }, linked ? lprop : d.name || 'Habit'), c.h('span', { class: 'w-sub' }, `${streak ? `🔥 ${plural(streak, unit)} in a row` : 'No streak yet'}${best > streak ? ` · best ${best}` : ''}${weekly ? ` · goal ${per}× a week` : ''}`)), linked ? c.h('span', { class: 'w-sub w-habit-src' }, ldb.schema.name) : null), grid, c.h('div', { class: 'w-row w-between' }, c.h('button', { class: 'w-btn' + (set.has(today) ? '' : ' primary'), style: set.has(today) ? undefined : { background: col }, disabled: c.readonly, onclick: () => toggle(today) }, set.has(today) ? '✓ Done today' : 'Done today'), c.h('span', { class: 'w-sub' }, foot)));
    },
});
/** every habit of every log (Habits modules of Day views), for the Habit widget */
function logHabits() {
    const out = [];
    for (const db of Database.all()) {
        const day = db.schema.day;
        for (const m of day?.modules ?? [])
            if (m.kind === 'habits')
                for (const p of m.props ?? [])
                    if (db.prop(p))
                        out.push({ db: db.key, dbName: db.schema.name, prop: p });
    }
    return out;
}
// ── Upload slot: one tap to add a photo or file; it turns into what you added ──
registerWidget({
    id: 'upload', name: 'Upload slot', icon: 'camera', description: 'A button to add a photo or file – replaced by it once added (handy in templates)', block: true, bare: true,
    defaults: () => ({ label: '' }),
    settings: [{ key: 'label', label: 'Name', type: 'text', hint: 'Add a photo or file' }, { key: 'photo', label: 'Photos only', type: 'toggle' },
        { key: 'keep', label: 'Stays after an upload', type: 'toggle' }, { key: 'place', label: 'What you add goes', type: 'select', options: [['below', 'Below it'], ['above', 'Above it']] },
        { key: 'compress', label: 'Images and videos', type: 'select', options: [['default', 'As in Settings'], ['ask', 'Ask each time'], ['compressed', 'Compressed'], ['original', 'Original']] }],
    render(c) {
        const pick = () => {
            const input = c.h('input', { type: 'file', multiple: true, accept: c.data.photo ? 'image/*' : undefined, style: { display: 'none' } });
            input.addEventListener('change', () => {
                const files = [...(input.files ?? [])];
                input.remove();
                if (files.length)
                    btn.dispatchEvent(new CustomEvent('nook-insert-files', { bubbles: true, detail: { files, keep: !!c.data.keep, above: c.data.place === 'above', compress: c.data.compress && c.data.compress !== 'default' ? c.data.compress : undefined } }));
            });
            document.body.appendChild(input);
            input.click();
        };
        const btn = c.h('button', { class: 'upload-slot', onclick: pick }, c.icon(c.data.photo ? 'camera' : 'plus', 18), c.h('span', null, String(c.data.label || (c.data.photo ? 'Add a photo' : 'Add a photo or file'))));
        return btn;
    },
});
// ── Page preview (a block: pages on the left, the chosen one on the right) ──
/** the preview whose list had the keyboard (focus comes back after a redraw) */
let pvFocus = null;
let mountPreview = null;
/** the editor registers how to draw a page read-only (avoids a circular import) */
export function setPreviewRenderer(fn) { mountPreview = fn; }
registerWidget({
    id: 'preview', name: 'Preview', icon: 'columns', description: 'Pages and PDFs on the left, the chosen one on the right', block: true, bare: true,
    defaults: () => ({ pages: [], active: 0, split: 220, fix: 'left' }),
    render(c) {
        const app = c._app;
        // the list holds pages (their id) and PDFs (their path in the workspace, always with a "/")
        const isFile = (id) => id.includes('/');
        const fileName = (id) => id.split('/').pop().replace(/\.pdf$/i, '').replace(/^[a-z0-9]{6}-/, '');
        const ids = (Array.isArray(c.data.pages) ? c.data.pages : []).filter((id) => isFile(id) || c.page(id));
        const assetUrl = (path) => app.assetUrl(path);
        const openFile = (path) => void assetUrl(path).then((u) => window.open(u, '_blank', 'noopener'));
        /** saves the file under its own name (fetched first: Dropbox links would open instead of saving) */
        const downloadFile = async (path) => {
            const u = await assetUrl(path);
            const blob = await (await fetch(u)).blob();
            const href = URL.createObjectURL(blob);
            const a = c.h('a', { href, download: path.split('/').pop(), style: { display: 'none' } });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(href), 60_000);
        };
        /** the page holding this preview (new PDFs go into its folder) */
        const ownerFile = () => { let f; const walk = (bs, file) => { for (const b of bs) {
            if (b.type === 'widget' && b.data === c.data)
                f = file;
            if (b.children)
                walk(b.children, file);
        } }; for (const pg of app.ws.pages.values())
            walk(pg.blocks, pg.file); return f; };
        const addPdfs = async (files) => {
            const added = [];
            for (const f of files.filter((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name))) {
                const path = app.ws.newFilePath(ownerFile(), f.name);
                await app.ws.writeFile(path, new Uint8Array(await f.arrayBuffer()));
                added.push(path);
            }
            if (added.length) {
                const cur2 = (Array.isArray(c.data.pages) ? c.data.pages : []);
                c.set({ pages: [...cur2, ...added], active: cur2.length });
                c.redraw();
            }
        };
        const cur = Math.min(Math.max(0, c.data.active ?? 0), Math.max(0, ids.length - 1));
        const left = c.h('div', { class: 'pv-list' });
        const select = (i) => { c.set({ active: i }); pvFocus = c.data; c.redraw(); };
        ids.forEach((id, i) => {
            const file = isFile(id);
            const p = file ? { id, title: fileName(id), icon: 'i:file-text' } : c.page(id);
            const el = c.h('button', { class: 'pagelink pv-item' + (i === cur ? ' on' : ''), tabindex: i === cur ? '0' : '-1', onclick: () => select(i) }, c.h('span', { class: 'pv-ico' }, p.icon && !p.icon.startsWith('i:') ? p.icon : c.icon(p.icon?.startsWith('i:') ? p.icon.slice(2).split(':')[0] : 'file', 16)), c.h('span', { class: 'pl-title' }, p.title));
            // ↑ ↓ (Home / End) walk through the list
            el.addEventListener('keydown', (e) => {
                const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : -1;
                if (to < 0 && e.key !== 'ArrowUp')
                    return;
                e.preventDefault();
                e.stopPropagation();
                if (to >= 0 && to < ids.length && to !== i)
                    select(to);
            });
            if (!c.readonly) {
                // drag to reorder (or out, like any page)
                el.draggable = true;
                el.addEventListener('dragstart', (e) => { e.stopPropagation(); e.dataTransfer.setData('text/x-nook-page', id); e.dataTransfer.setData('text/x-nook-pv', id); e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => el.classList.add('dragging')); });
                el.addEventListener('dragend', () => { el.classList.remove('dragging'); left.querySelectorAll('.pv-before,.pv-after').forEach((x) => x.classList.remove('pv-before', 'pv-after')); });
                el.addEventListener('dragover', (e) => {
                    if (!e.dataTransfer?.types.includes('text/x-nook-page') && !e.dataTransfer?.types.includes('text/x-nook-block'))
                        return;
                    const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
                    left.querySelectorAll('.pv-before,.pv-after').forEach((x) => x !== el && x.classList.remove('pv-before', 'pv-after'));
                    el.classList.toggle('pv-after', after);
                    el.classList.toggle('pv-before', !after);
                });
                el.addEventListener('dragleave', () => el.classList.remove('pv-before', 'pv-after'));
                el.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const move = (to) => { if (to < 0 || to >= ids.length)
                        return; const n = [...ids]; n.splice(to, 0, n.splice(i, 1)[0]); c.set({ pages: n, active: to }); c.redraw(); };
                    c._menu(e, [
                        { label: 'Open', run: () => (file ? openFile(id) : c.openPage(id)) },
                        ...(file ? [{ label: 'Download', run: () => void downloadFile(id) }, ...(app.ws.storage.reveal ? [{ label: app.ws.storage.remote ? 'Show in Dropbox' : 'Show in folder', run: () => void app.ws.storage.reveal(id) }] : [])] : []),
                        ...(file ? [] : [{ label: 'Rename', run: () => askText(el, 'Page title', p.title, (v) => { void app.renamePage(app.ws.pages.get(id), v).then(() => c.redraw()); }) }]),
                        { label: 'Move up', run: () => move(i - 1) },
                        { label: 'Move down', run: () => move(i + 1) },
                        'sep',
                        { label: 'Remove from list', danger: true, run: () => { c.set({ pages: ids.filter((x) => x !== id), active: 0 }); c.redraw(); } },
                    ]);
                });
            }
            left.append(el);
        });
        if (pvFocus === c.data) {
            pvFocus = null;
            requestAnimationFrame(() => left.querySelector('.pv-item.on')?.focus());
        }
        // drop a page here (from the sidebar, a link or a subpage block): it joins the list; a subpage's own block goes away (the page itself stays a subpage, now shown here)
        if (!c.readonly) {
            const T = 'text/x-nook-page', B = 'text/x-nook-block';
            const ok = (e) => !!e.dataTransfer && (e.dataTransfer.types.includes(T) || e.dataTransfer.types.includes(B) || e.dataTransfer.types.includes('Files'));
            left.addEventListener('dragover', (e) => { if (!ok(e))
                return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; left.classList.add('pv-drop'); }, true);
            left.addEventListener('dragleave', (e) => { if (!left.contains(e.relatedTarget))
                left.classList.remove('pv-drop'); });
            left.addEventListener('drop', async (e) => {
                if (!ok(e))
                    return;
                e.preventDefault();
                e.stopPropagation();
                left.classList.remove('pv-drop');
                const dt = e.dataTransfer;
                if (dt.files?.length) {
                    await addPdfs([...dt.files]);
                    return;
                }
                let add = [];
                let from = '';
                const blockIds = dt.getData(B);
                if (blockIds) {
                    // blocks from the page (one or several selected): the editor hands over their pages and takes the blocks out
                    const ev = new CustomEvent('nook-take-pages', { bubbles: true, cancelable: true, detail: { ids: blockIds.split(','), out: [] } });
                    left.dispatchEvent(ev);
                    add = ev.detail.out;
                }
                else {
                    const id = dt.getData(T);
                    from = dt.getData('text/x-nook-from');
                    if (id)
                        add = [id];
                }
                add = add.filter((id) => isFile(id) || c.page(id));
                if (!add.length)
                    return;
                // where in the list: before / after the item under the pointer
                const over = e.target.closest('.pv-item');
                left.querySelectorAll('.pv-before,.pv-after').forEach((x) => x.classList.remove('pv-before', 'pv-after'));
                let at = ids.length;
                if (over) {
                    const k = [...left.querySelectorAll('.pv-item')].indexOf(over);
                    const r = over.getBoundingClientRect();
                    at = k + (e.clientY > r.top + r.height / 2 ? 1 : 0);
                }
                at -= ids.slice(0, at).filter((x) => add.includes(x)).length;
                const n = ids.filter((x) => !add.includes(x));
                n.splice(Math.min(at, n.length), 0, ...add);
                c.set({ pages: n, active: n.indexOf(add[0]) });
                c.redraw();
                if (from && !isFile(add[0]))
                    await app.ws.unlinkSubpage(from, add[0]);
                // from the sidebar (a move there): the page becomes a subpage of the page holding this preview –
                // otherwise its old parent page would keep getting a block for it
                if (!blockIds && !dt.types.includes('text/x-nook-pv')) {
                    const ws = app.ws;
                    let owner;
                    const walk = (bs, pid) => { for (const b of bs) {
                        if (b.type === 'widget' && b.data === c.data)
                            owner = pid;
                        if (b.children)
                            walk(b.children, pid);
                    } };
                    for (const pg of ws.pages.values())
                        walk(pg.blocks, pg.id);
                    const moved = isFile(add[0]) ? undefined : ws.pages.get(add[0]);
                    // not into itself or one of its own subpages
                    let inside = false;
                    for (let q = owner ? ws.pages.get(owner) : undefined, n = 0; q && n < 50; q = q.parent ? ws.pages.get(q.parent) : undefined, n++)
                        if (q.id === add[0])
                            inside = true;
                    if (owner && moved && moved.parent !== owner && !inside) {
                        await ws.unlinkSubpage(moved.parent, moved.id);
                        moved.parent = owner;
                        await ws.savePage(moved);
                        app.refreshSidebar?.();
                    }
                }
            }, true);
            const pickPdf = () => {
                const input = c.h('input', { type: 'file', multiple: true, accept: 'application/pdf,.pdf', style: { display: 'none' } });
                input.addEventListener('change', () => { const fs = [...(input.files ?? [])]; input.remove(); void addPdfs(fs); });
                document.body.appendChild(input);
                input.click();
            };
            const pickPage = (at) => c._pickPage(at, (id) => { if (!ids.includes(id)) {
                c.set({ pages: [...ids, id], active: ids.length });
                c.redraw();
            } });
            left.append(c.h('div', { class: 'pv-adds' }, c.h('button', { class: 'pv-add', onclick: (e) => pickPage(e.currentTarget) }, c.icon('plus-bold', 12), 'Page'), c.h('button', { class: 'pv-add', onclick: pickPdf }, c.icon('plus-bold', 12), 'PDF')));
        }
        // the phone: a list – a page opens as usual, a PDF full screen in the system's viewer (no split view there)
        if (c.phone) {
            const rows = ids.map((id) => {
                const file = isFile(id);
                const pg = file ? null : c.page(id);
                const icon = file ? c.icon('file-text', 19) : pg.icon && !pg.icon.startsWith('i:') ? pg.icon : c.icon(pg.icon?.startsWith('i:') ? pg.icon.slice(2).split(':')[0] : 'file', 19);
                return c.h('button', { class: 'pvm-row', onclick: () => (file ? openPdfFull(() => assetUrl(id)) : c.openPage(id)) }, c.h('span', { class: 'pvm-ico' }, icon), c.h('span', { class: 'pvm-txt' }, c.h('b', null, file ? fileName(id) : pg.title), c.h('span', null, file ? 'PDF' : 'Page')), c.icon('chevron-right', 13));
            });
            const pickPdfM = () => {
                const input = c.h('input', { type: 'file', multiple: true, accept: 'application/pdf,.pdf', style: { display: 'none' } });
                input.addEventListener('change', () => { const fs = [...(input.files ?? [])]; input.remove(); void addPdfs(fs); });
                document.body.appendChild(input);
                input.click();
            };
            return c.h('div', { class: 'pvm' }, c.h('div', { class: 'pvm-head' }, c.icon('columns', 14), 'Preview'), rows.length ? rows : c.h('div', { class: 'pvm-empty' }, 'No pages or PDFs yet'), c.readonly ? null : c.h('div', { class: 'pvm-adds' }, c.h('button', { class: 'set-btn', onclick: (e) => c._pickPage(e.currentTarget, (id) => { if (!ids.includes(id)) {
                    c.set({ pages: [...ids, id], active: ids.length });
                    c.redraw();
                } }) }, c.icon('plus-bold', 12), 'Page'), c.h('button', { class: 'set-btn', onclick: pickPdfM }, c.icon('plus-bold', 12), 'PDF')));
        }
        const right = c.h('div', { class: 'pv-pane' });
        if (ids.length && isFile(ids[cur])) {
            // a PDF: shown in the browser's viewer (Dropbox hands files out as downloads – marked as PDF first)
            const path = ids[cur];
            right.append(c.h('div', { class: 'pv-head' }, c.h('span', { class: 'pv-title' }, fileName(path)), c.h('button', { class: 'pv-open', title: 'Open in a new tab', onclick: () => openFile(path) }, c.icon('maximize', 13), 'Open')));
            right.classList.add('pdf'); // the PDF viewer scrolls itself: the pane doesn't
            const body = c.h('div', { class: 'pv-body pv-pdf' });
            right.append(body);
            void assetUrl(path).then(async (u) => {
                let url = u;
                try {
                    const r = await fetch(u);
                    if (r.ok)
                        url = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: 'application/pdf' }));
                }
                catch { /* the link as it is */ }
                body.append(c.h('iframe', { src: url, class: 'pdf-frame', title: fileName(path) }));
            }).catch(() => body.append(c.h('div', { class: 'pv-empty' }, `File missing: ${path}`)));
        }
        else if (ids.length) {
            const p = c.page(ids[cur]);
            right.append(c.h('div', { class: 'pv-head' }, c.h('span', { class: 'pv-title' }, p.title), c.h('button', { class: 'pv-open', title: 'Open as full page', onclick: () => c.openPage(p.id) }, c.icon('maximize', 13), 'Open')));
            const body = c.h('div', { class: 'pv-body' });
            right.append(body);
            if (mountPreview)
                mountPreview(body, p.blocks, app);
        }
        else
            right.append(c.h('div', { class: 'pv-empty' }, 'Add pages or PDFs on the left to preview them here.'));
        // the divider: drag to resize; right-click to fix a side (like columns)
        const fix = c.data.fix ?? 'left', w = Math.max(140, Math.min(520, Number(c.data.split) || 220));
        const grid = c.h('div', { class: 'pv' + (c.phone ? ' phone' : '') });
        const apply = (px) => { grid.style.gridTemplateColumns = fix === 'left' ? `${px}px 10px 1fr` : fix === 'right' ? `1fr 10px ${px}px` : `${px}fr 10px ${Math.max(1, 1000 - px)}fr`; };
        const sep = c.h('div', { class: 'pv-sep col-resizer', role: 'separator', 'aria-orientation': 'vertical', title: 'Drag to resize · right-click for options' });
        if (!c.readonly) {
            sep.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                sep.setPointerCapture(e.pointerId);
                const r = grid.getBoundingClientRect();
                const move = (ev) => {
                    const x = ev.clientX - r.left;
                    const v = fix === 'right' ? Math.round(r.width - x - 5) : fix === 'none' ? Math.round((x / r.width) * 1000) : Math.round(x - 5);
                    const clamped = fix === 'none' ? Math.max(150, Math.min(850, v)) : Math.max(140, Math.min(r.width - 200, v));
                    apply(clamped);
                    grid.dataset.v = String(clamped);
                };
                const up = () => { sep.removeEventListener('pointermove', move); sep.removeEventListener('pointerup', up); if (grid.dataset.v)
                    c.set({ split: Number(grid.dataset.v) }); };
                sep.addEventListener('pointermove', move);
                sep.addEventListener('pointerup', up);
            });
            sep.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const r = grid.getBoundingClientRect(), lw = Math.round(left.getBoundingClientRect().width), rw = Math.round(right.getBoundingClientRect().width);
                c._menu(e, [
                    { section: 'Width' },
                    { label: 'Fixed left side', hint: `${lw} px${fix === 'left' ? '  ✓' : ''}`, run: () => { c.set({ fix: 'left', split: lw }); c.redraw(); } },
                    { label: 'Fixed right side', hint: `${rw} px${fix === 'right' ? '  ✓' : ''}`, run: () => { c.set({ fix: 'right', split: rw }); c.redraw(); } },
                    { label: 'Both flexible', hint: fix === 'none' ? '✓' : undefined, run: () => { c.set({ fix: 'none', split: Math.round((lw / r.width) * 1000) }); c.redraw(); } },
                ]);
            });
        }
        grid.append(left, sep, right);
        if (!c.phone)
            apply(fix === 'none' ? (Number(c.data.split) > 100 && Number(c.data.split) < 900 ? Number(c.data.split) : 250) : w);
        return grid;
    },
});
//# sourceMappingURL=builtins.js.map