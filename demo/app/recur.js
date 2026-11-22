// Recurring entries. The rule is stored in the entry's file as an iCalendar RRULE
// (e.g. `_repeat: FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;UNTIL=20270131`), the form other calendars use;
// skipped dates are listed in `_except`. Calendars show the occurrences.
import { addDays, dayNum, isoFromDay, pad2, WEEKDAYS } from './util.js';
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
export function parseRRule(s) {
    if (!s)
        return null;
    const parts = Object.fromEntries(String(s).replace(/^RRULE:/i, '').split(';').map((p) => p.split('=')).map(([k, v]) => [k.toUpperCase(), v ?? '']));
    const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[(parts.FREQ ?? '').toUpperCase()];
    if (!freq)
        return null;
    const r = { freq, interval: Math.max(1, Number(parts.INTERVAL) || 1) };
    if (parts.BYDAY) {
        const d = parts.BYDAY.split(',').map((x) => BYDAY.indexOf(x.slice(-2).toUpperCase())).filter((x) => x >= 0);
        if (d.length)
            r.days = [...new Set(d)].sort();
    }
    if (parts.UNTIL) {
        const u = parts.UNTIL.replace(/T.*$/, '');
        r.until = /^\d{8}$/.test(u) ? `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}` : u.slice(0, 10);
    }
    if (parts.COUNT)
        r.count = Math.max(1, Number(parts.COUNT) || 1);
    return r;
}
export function formatRRule(r) {
    const out = [`FREQ=${r.freq.toUpperCase()}`];
    if (r.interval > 1)
        out.push(`INTERVAL=${r.interval}`);
    if (r.freq === 'weekly' && r.days?.length)
        out.push(`BYDAY=${r.days.map((d) => BYDAY[d]).join(',')}`);
    if (r.until)
        out.push(`UNTIL=${r.until.replace(/-/g, '')}`);
    else if (r.count)
        out.push(`COUNT=${r.count}`);
    return out.join(';');
}
const weekday = (n) => (new Date(n * 864e5).getUTCDay() + 6) % 7;
function monthAdd(iso, months) {
    const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1 + months, d = +iso.slice(8, 10);
    const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return d > last ? null : `${yy}-${pad2(mm + 1)}-${pad2(d)}`; // e.g. the 31st is skipped in short months
}
/** Occurrence start dates (YYYY-MM-DD) of a series starting on `start`, within [from, to). */
export function occurrences(start, r, from, to, limit = 1000) {
    const s0 = start.slice(0, 10);
    const out = [];
    const toN = dayNum(to), fromN = dayNum(from);
    const untilN = r.until ? dayNum(r.until) : Infinity;
    const except = new Set(r.except ?? []);
    let n = 0; // occurrences counted from the start (for COUNT)
    const push = (iso) => {
        const d = dayNum(iso);
        if (d < dayNum(s0) || d > untilN)
            return true;
        n++;
        if (r.count && n > r.count)
            return false;
        if (d >= fromN && d < toN && !except.has(iso))
            out.push(iso);
        return true;
    };
    for (let i = 0; i < 20000 && out.length < limit; i++) {
        if (r.freq === 'daily') {
            const iso = addDays(s0, i * r.interval);
            if (dayNum(iso) >= toN || dayNum(iso) > untilN)
                break;
            if (!push(iso))
                break;
        }
        else if (r.freq === 'weekly') {
            const monday = dayNum(s0) - weekday(dayNum(s0)) + i * 7 * r.interval;
            if (monday >= toN || monday > untilN)
                break;
            const days = r.days?.length ? r.days : [weekday(dayNum(s0))];
            let go = true;
            for (const d of days) {
                if (!push(isoFromDay(monday + d))) {
                    go = false;
                    break;
                }
            }
            if (!go)
                break;
        }
        else {
            const iso = monthAdd(s0, r.freq === 'monthly' ? i * r.interval : i * 12 * r.interval);
            const probe = monthAdd(s0.slice(0, 8) + '01', r.freq === 'monthly' ? i * r.interval : i * 12 * r.interval);
            if (dayNum(probe) >= toN || dayNum(probe) > untilN)
                break;
            if (iso && !push(iso))
                break;
        }
    }
    return out;
}
const SHORT = WEEKDAYS.map((d) => d.slice(0, 3));
export function describeRepeat(r, fmtDay = (x) => x) {
    if (!r)
        return 'Does not repeat';
    const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
    let s = r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`;
    if (r.freq === 'weekly' && r.days?.length)
        s += ` on ${r.days.map((d) => SHORT[d]).join(', ')}`;
    if (r.until)
        s += `, until ${fmtDay(r.until)}`;
    else if (r.count)
        s += `, ${r.count} times`;
    return s;
}
export { weekday };
//# sourceMappingURL=recur.js.map