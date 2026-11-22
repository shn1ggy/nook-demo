import { fmtDay, fmtTime } from './util.js';
// Times written the way people say them, for reminders: "tomorrow 10", "mon", "sat 10:30", "in 2 hours",
// "this evening", "next week", "23.11. 9:00", "18:00" – English and German. And, relative to an entry's date,
// "15 min", "2 hours before", "1 day", "18:00 the day before", "9:00 on the day".
const pad = (n) => String(n).padStart(2, '0');
/** local time as YYYY-MM-DDTHH:MM */
export const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fromLocalIso = (s) => { const [d, t] = s.split('T'); const [y, m, da] = d.split('-').map(Number); const [hh, mi] = (t ?? '09:00').split(':').map(Number); return new Date(y, m - 1, da, hh, mi); };
const DAYS = [[/^(sun|sunday|so|sonntag)$/, 0], [/^(mon|monday|mo|montag)$/, 1], [/^(tue|tues|tuesday|di|dienstag)$/, 2], [/^(wed|wednesday|mi|mittwoch)$/, 3], [/^(thu|thur|thurs|thursday|do|donnerstag)$/, 4], [/^(fri|friday|fr|freitag)$/, 5], [/^(sat|saturday|sa|samstag)$/, 6]];
/** "10", "10:30", "10.30", "9am", "6pm", "18 uhr" → [h, m] */
function clock(s) {
    const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|uhr|h)?$/);
    if (!m)
        return null;
    let h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (m[3] === 'pm' && h < 12)
        h += 12;
    if (m[3] === 'am' && h === 12)
        h = 0;
    return h < 24 && mi < 60 ? [h, mi] : null;
}
/** a moment from what was typed, or null */
export function parseWhen(text, now = new Date()) {
    // also what Nook shows ("Sun, 22.11.2026, 21:00"), "21 uhr", "2100", "21:00h"
    const t = text.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').replace(/^(at|um|am) /, '')
        .replace(/^(mon|tue|wed|thu|fri|sat|sun|mo|di|mi|do|fr|sa|so)[a-z]*\.? (?=\d{1,2}\.\d{1,2}\.)/, '')
        .replace(/\b(\d{1,2})(\d{2}) ?(uhr|h)?$/, (m, a2, b2) => (Number(a2) < 24 && Number(b2) < 60 && !/\./.test(m) ? `${a2}:${b2}` : m))
        .replace(/(\d{1,2}(?::\d{2})?) ?(uhr|h)$/, '$1').replace(/ um /, ' ').trim();
    if (!t)
        return null;
    // in 20 min / in 2 hours / in 3 days
    let m = t.match(/^in (\d+(?:[.,]\d+)?) ?(m|min|mins|minute|minutes|minuten|h|hr|hrs|hour|hours|std|stunde|stunden|d|day|days|tag|tagen|tage|w|week|weeks|woche|wochen)$/);
    if (m) {
        const n = Number(m[1].replace(',', '.')), u = m[2][0];
        const ms = u === 'm' ? 60_000 : u === 'h' || u === 's' ? 3600_000 : u === 'd' || u === 't' ? 864e5 : 7 * 864e5;
        return new Date(now.getTime() + n * ms);
    }
    const at = (d, hm, def = [9, 0]) => { const x = new Date(d); x.setHours(...(hm ?? def), 0, 0); return x; };
    const parts = t.split(' ');
    const rest = (from) => parts.slice(from).join(' ');
    const timeOf = (s) => (s ? clock(s.replace(/^(at|um) /, '')) : null);
    if (/^(this evening|tonight|heute abend)$/.test(t))
        return at(now, [19, 0]);
    if (/^(next week|nächste woche)$/.test(t)) {
        const d = new Date(now);
        d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
        return at(d, null);
    }
    if (/^(today|heute)\b/.test(t)) {
        const hm = timeOf(rest(1));
        return hm || !rest(1) ? at(now, hm, [18, 0]) : null;
    }
    if (/^(tomorrow|tmrw|morgen)\b/.test(t)) {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        const r = rest(1).replace(/^(früh|morning)$/, '9');
        const hm = timeOf(r);
        return hm || !r ? at(d, hm) : null;
    }
    // a weekday: the next one (today counts only if the time is still ahead)
    const wd = DAYS.find(([re]) => re.test(parts[0].replace(/[.,]$/, '')));
    if (wd) {
        const hm = timeOf(rest(1));
        if (rest(1) && !hm)
            return null;
        const d = new Date(now);
        let add = (wd[1] - d.getDay() + 7) % 7;
        const cand = at(new Date(d.getTime() + add * 864e5), hm);
        if (cand <= now) {
            add += 7;
            return at(new Date(d.getTime() + add * 864e5), hm);
        }
        return cand;
    }
    // 23.11. / 23.11.2026 / 2026-11-23 (+ time)
    m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?: (.+))?$/) ?? null;
    if (m) {
        const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
        const hm = m[4] ? timeOf(m[4]) : null;
        if (m[4] && !hm)
            return null;
        let d = at(new Date(y, Number(m[2]) - 1, Number(m[1])), hm);
        if (!m[3] && d < now)
            d = at(new Date(y + 1, Number(m[2]) - 1, Number(m[1])), hm);
        return d;
    }
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ t](.+))?$/);
    if (m) {
        const hm = m[4] ? timeOf(m[4]) : null;
        if (m[4] && !hm)
            return null;
        return at(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), hm);
    }
    // just a time: today, or tomorrow if it has passed
    const hm = clock(t);
    if (hm) {
        const d = at(now, hm);
        if (d <= now)
            d.setDate(d.getDate() + 1);
        return d;
    }
    return null;
}
/** minutes before an entry's start from "15 min", "2 hours before", "1 day", "18:00 the day before", "9:00 on the day" */
export function parseBefore(text, startIso) {
    const raw = text.trim().toLowerCase().replace(/\s+/g, ' ');
    const t = /day before$/.test(raw) ? raw : raw.replace(/ (before|vorher|davor)$/, '');
    let m = t.match(/^(\d+(?:[.,]\d+)?) ?(m|min|mins|minute|minutes|minuten|h|hr|hrs|hour|hours|std|stunde|stunden|d|day|days|tag|tage|w|week|weeks|woche|wochen)$/);
    if (m) {
        const n = Number(m[1].replace(',', '.')), u = m[2][0];
        return Math.round(n * (u === 'm' ? 1 : u === 'h' || u === 's' ? 60 : u === 'd' || u === 't' ? 1440 : 10080));
    }
    m = t.match(/^(?:at )?(\S+) (?:the day before|am vortag|the evening before)$/) ?? t.match(/^(?:the day before|am vortag) (?:at )?(\S+)$/);
    const start = fromLocalIso(startIso.length > 10 ? startIso.slice(0, 16) : `${startIso.slice(0, 10)}T09:00`);
    if (m) {
        const hm = clock(m[1]);
        if (!hm)
            return null;
        const d = new Date(start);
        d.setDate(d.getDate() - 1);
        d.setHours(hm[0], hm[1], 0, 0);
        return Math.round((start.getTime() - d.getTime()) / 60_000);
    }
    m = t.match(/^(?:at )?(\S+) (?:on the day|am tag|that day)$/);
    if (m) {
        const hm = clock(m[1]);
        if (!hm)
            return null;
        const d = new Date(start);
        d.setHours(hm[0], hm[1], 0, 0);
        const mins = Math.round((start.getTime() - d.getTime()) / 60_000);
        return mins >= 0 ? mins : null;
    }
    return null;
}
/** "Thu, 19.11.2026, 18:00" – in the workspace's date and time format */
export function fmtWhen(d) {
    const iso = localIso(d);
    return `${d.toLocaleDateString(undefined, { weekday: 'short' })}, ${fmtDay(iso.slice(0, 10))}, ${fmtTime(iso.slice(11, 16))}`;
}
/** the text of a reminder chip in a line: "tomorrow 9:00", "Sat 10:00", "23.11. 9:00" */
export function shortWhen(d, now = new Date()) {
    const t = fmtTime(localIso(d).slice(11, 16));
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
    if (days === 0)
        return `today ${t}`;
    if (days === 1)
        return `tomorrow ${t}`;
    if (days > 1 && days < 7)
        return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${t}`;
    return `${fmtDay(localIso(d).slice(0, 10))} ${t}`;
}
//# sourceMappingURL=when.js.map