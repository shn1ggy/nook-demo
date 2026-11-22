// iCalendar (RFC 5545), reading only: events with time zones, all-day dates, repeats and skipped
// dates, for the calendars Nook shows.
import { isoOfDate, hhmmOfDate } from '../util.js';
// ---------- text level ----------
const unfold = (s) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
function unescapeText(v) {
    return v.replace(/\\(.)/g, (_m, c) => (c === 'n' || c === 'N' ? '\n' : c));
}
function parseLine(line) {
    // NAME;PARAM=a;PARAM="b:c":VALUE  (colons inside quoted parameters don't end the name part)
    let i = 0, inQ = false;
    for (; i < line.length; i++) {
        const c = line[i];
        if (c === '"')
            inQ = !inQ;
        else if (c === ':' && !inQ)
            break;
    }
    if (i >= line.length)
        return null;
    const head = line.slice(0, i), value = line.slice(i + 1);
    const parts = [];
    let cur = '';
    inQ = false;
    for (const c of head) {
        if (c === '"') {
            inQ = !inQ;
            continue;
        }
        if (c === ';' && !inQ) {
            parts.push(cur);
            cur = '';
        }
        else
            cur += c;
    }
    parts.push(cur);
    const params = {};
    for (const p of parts.slice(1)) {
        const k = p.indexOf('=');
        if (k > 0)
            params[p.slice(0, k).toUpperCase()] = p.slice(k + 1);
    }
    return { name: parts[0].toUpperCase(), params, value };
}
function parseICal(text) {
    const roots = [];
    const stack = [];
    for (const raw of unfold(text).split('\n')) {
        if (!raw.trim())
            continue;
        const p = parseLine(raw);
        if (!p)
            continue;
        if (p.name === 'BEGIN') {
            const c = { type: p.value.toUpperCase(), props: [], children: [] };
            (stack.length ? stack[stack.length - 1].children : roots).push(c);
            stack.push(c);
        }
        else if (p.name === 'END')
            stack.pop();
        else if (stack.length)
            stack[stack.length - 1].props.push(p);
    }
    return roots;
}
// ---------- time zones ----------
/** Exchange / Outlook use Windows zone names */
const WINDOWS_ZONES = {
    'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'Central European Standard Time': 'Europe/Warsaw',
    'Romance Standard Time': 'Europe/Paris', 'GMT Standard Time': 'Europe/London', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
    'E. Europe Standard Time': 'Europe/Chisinau', 'FLE Standard Time': 'Europe/Kiev', 'GTB Standard Time': 'Europe/Bucharest', 'Russian Standard Time': 'Europe/Moscow',
    'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver', 'Pacific Standard Time': 'America/Los_Angeles',
    'UTC': 'UTC', 'Coordinated Universal Time': 'UTC', 'Tokyo Standard Time': 'Asia/Tokyo', 'China Standard Time': 'Asia/Shanghai', 'India Standard Time': 'Asia/Kolkata',
    'AUS Eastern Standard Time': 'Australia/Sydney', 'Turkey Standard Time': 'Europe/Istanbul', 'Israel Standard Time': 'Asia/Jerusalem',
};
function zoneOffsetMs(zone, utcMs) {
    try {
        const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const parts = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
        const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
        return asUtc - utcMs;
    }
    catch {
        return null;
    }
}
const localStr = (d) => `${isoOfDate(d)}T${hhmmOfDate(d)}`;
/** DTSTART / DTEND / EXDATE value → Nook date ("YYYY-MM-DD" or local "YYYY-MM-DDTHH:MM") */
function fromICalDate(value, params = {}) {
    const v = value.trim();
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v);
    if (!m)
        return null;
    const [, y, mo, d, hh, mi, ss, z] = m;
    if (!hh || params.VALUE === 'DATE')
        return `${y}-${mo}-${d}`;
    if (z)
        return localStr(new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss ?? 0))));
    const tzid = params.TZID?.replace(/^\/+/, '');
    const zone = tzid ? WINDOWS_ZONES[tzid] ?? tzid : null;
    if (zone) {
        const wall = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +(ss ?? 0));
        const off1 = zoneOffsetMs(zone, wall);
        if (off1 != null) {
            const off2 = zoneOffsetMs(zone, wall - off1) ?? off1;
            return localStr(new Date(wall - off2));
        }
    }
    // floating time (no zone): the same wall time everywhere
    return `${y}-${mo}-${d}T${hh}:${mi}`;
}
const addDay = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
// ---------- events ----------
const get = (c, name) => c.props.find((p) => p.name === name);
const getAll = (c, name) => c.props.filter((p) => p.name === name);
/** the main VEVENTs (and with `tasks` also VTODOs) of a calendar object (not the changed single dates of a series) */
function masterEvents(roots, tasks = false) {
    const out = [];
    const walk = (cs) => { for (const c of cs) {
        if ((c.type === 'VEVENT' || (tasks && c.type === 'VTODO')) && !get(c, 'RECURRENCE-ID'))
            out.push(c);
        walk(c.children);
    } };
    walk(roots);
    return out;
}
/** a VTODO: due date (or start) as the date – tasks may have none – and whether it is done */
function taskFromComponent(c) {
    const dp = get(c, 'DUE') ?? get(c, 'DTSTART');
    const start = dp ? fromICalDate(dp.value, dp.params) ?? '' : '';
    const status = (get(c, 'STATUS')?.value ?? '').toUpperCase();
    const ev = { uid: get(c, 'UID')?.value ?? '', title: unescapeText(get(c, 'SUMMARY')?.value ?? ''), start, task: true, done: status === 'COMPLETED' || !!get(c, 'COMPLETED') };
    const desc = get(c, 'DESCRIPTION');
    if (desc?.value)
        ev.description = unescapeText(desc.value);
    const cats = getAll(c, 'CATEGORIES').flatMap((p) => p.value.split(/(?<!\\),/).map((x) => unescapeText(x).trim())).filter(Boolean);
    if (cats.length)
        ev.categories = cats;
    const rr = get(c, 'RRULE');
    if (rr?.value)
        ev.rrule = rr.value;
    const lm = get(c, 'LAST-MODIFIED') ?? get(c, 'DTSTAMP');
    if (lm) {
        const t = fromICalDate(lm.value, lm.params);
        if (t)
            ev.modified = t;
    }
    return ev; // alarms of tasks are left alone (reminder apps set them in many ways)
}
function eventFromComponent(c) {
    if (c.type === 'VTODO')
        return taskFromComponent(c);
    const ds = get(c, 'DTSTART');
    if (!ds)
        return null;
    const start = fromICalDate(ds.value, ds.params);
    if (!start)
        return null;
    const ev = { uid: get(c, 'UID')?.value ?? '', title: unescapeText(get(c, 'SUMMARY')?.value ?? ''), start };
    const de = get(c, 'DTEND');
    const allDay = start.length === 10;
    if (de) {
        let end = fromICalDate(de.value, de.params);
        if (end && allDay)
            end = addDay(end.slice(0, 10), -1); // DTEND of all-day events is the day after
        if (end && end !== start && end > start)
            ev.end = end;
    }
    else {
        const dur = get(c, 'DURATION')?.value;
        const dm = dur && /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(dur);
        if (dm) {
            const mins = ((+(dm[1] ?? 0)) * 7 * 1440) + (+(dm[2] ?? 0)) * 1440 + (+(dm[3] ?? 0)) * 60 + (+(dm[4] ?? 0));
            if (allDay && mins >= 2880)
                ev.end = addDay(start, mins / 1440 - 1);
            else if (!allDay && mins) {
                const [d, t] = start.split('T');
                const [y, m, day] = d.split('-').map(Number);
                const [hh, mi] = t.split(':').map(Number);
                ev.end = localStr(new Date(y, m - 1, day, hh, mi + mins));
            }
        }
    }
    const desc = get(c, 'DESCRIPTION');
    if (desc?.value)
        ev.description = unescapeText(desc.value);
    const loc = get(c, 'LOCATION');
    if (loc?.value)
        ev.location = unescapeText(loc.value);
    const cats = getAll(c, 'CATEGORIES').flatMap((p) => p.value.split(/(?<!\\),/).map((x) => unescapeText(x).trim())).filter(Boolean);
    if (cats.length)
        ev.categories = cats;
    const rr = get(c, 'RRULE');
    if (rr?.value)
        ev.rrule = rr.value;
    const ex = getAll(c, 'EXDATE').flatMap((p) => p.value.split(',').map((v) => fromICalDate(v, p.params)?.slice(0, 10))).filter(Boolean);
    if (ex.length)
        ev.exdates = [...new Set(ex)];
    const al = alarmOf(c, allDay);
    if (al !== undefined)
        ev.alarm = al;
    const lm = get(c, 'LAST-MODIFIED') ?? get(c, 'DTSTAMP');
    if (lm) {
        const t = fromICalDate(lm.value, lm.params);
        if (t)
            ev.modified = t;
    }
    return ev;
}
/** All events of an .ics text (calendar links); with `tasks`, also to-dos. */
export function parseEvents(text, tasks = false) {
    return masterEvents(parseICal(text), tasks).map(eventFromComponent).filter(Boolean);
}
/** minutes of a relative alarm trigger (negative = before the start), or null if it isn't one */
function triggerMinutes(a) {
    const t = get(a, 'TRIGGER');
    if (!t || (t.params.VALUE && t.params.VALUE.toUpperCase() === 'DATE-TIME') || (t.params.RELATED && t.params.RELATED.toUpperCase() === 'END'))
        return null;
    const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(t.value.trim());
    if (!m)
        return null;
    const mins = (+(m[2] ?? 0)) * 7 * 1440 + (+(m[3] ?? 0)) * 1440 + (+(m[4] ?? 0)) * 60 + (+(m[5] ?? 0));
    return m[1] === '-' ? -mins : mins;
}
/** the first simple alarm as Nook's reminder (minutes before; all day: before 9:00) */
function alarmOf(c, allDay) {
    const alarms = c.children.filter((x) => x.type === 'VALARM');
    if (!alarms.length)
        return null;
    for (const a of alarms) {
        const m = triggerMinutes(a);
        if (m !== null)
            return allDay ? 9 * 60 - m : -m;
    }
    return undefined; // only alarms Nook can't show: leave them alone
}
//# sourceMappingURL=ical.js.map