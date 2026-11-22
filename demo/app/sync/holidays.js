const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** Easter Sunday (Gregorian), as a UTC date */
export function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
    const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(y, month - 1, day));
}
/** the date a rule gives in a year, or null when the rule can't be read */
function ruleDate(rule, y) {
    let m;
    if ((m = rule.match(/^easter([+-]\d+)?$/i))) {
        const d = easter(y);
        d.setUTCDate(d.getUTCDate() + Number(m[1] ?? 0));
        return d;
    }
    if ((m = rule.match(/^(\d\d)-(\d\d)$/)))
        return new Date(Date.UTC(y, +m[1] - 1, +m[2]));
    if ((m = rule.match(/^(\d\d)-(\d\d)-(sun|mon|tue|wed|thu|fri|sat)$/i))) {
        // the last given weekday before the date
        const d = new Date(Date.UTC(y, +m[1] - 1, +m[2]));
        const w = WD.indexOf(m[3].toLowerCase());
        do
            d.setUTCDate(d.getUTCDate() - 1);
        while (d.getUTCDay() !== w);
        return d;
    }
    if ((m = rule.match(/^(\d\d)-(sun|mon|tue|wed|thu|fri|sat)(-?\d)$/i))) {
        const mon = +m[1] - 1, w = WD.indexOf(m[2].toLowerCase()), n = Number(m[3]);
        if (n > 0) {
            const d = new Date(Date.UTC(y, mon, 1));
            while (d.getUTCDay() !== w)
                d.setUTCDate(d.getUTCDate() + 1);
            d.setUTCDate(d.getUTCDate() + 7 * (n - 1));
            return d;
        }
        const d = new Date(Date.UTC(y, mon + 1, 0));
        while (d.getUTCDay() !== w)
            d.setUTCDate(d.getUTCDate() - 1);
        d.setUTCDate(d.getUTCDate() + 7 * (n + 1));
        return d;
    }
    return null;
}
/** "rule name" lines → all-day events for a range of years */
export function holidayEvents(rules, id, from = new Date().getFullYear() - 5, to = new Date().getFullYear() + 5) {
    const out = [];
    for (const line of rules.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#'))
            continue;
        const sp = t.indexOf(' ');
        if (sp < 0)
            continue;
        const rule = t.slice(0, sp), name = t.slice(sp + 1).trim();
        for (let y = from; y <= to; y++) {
            const d = ruleDate(rule, y);
            if (d)
                out.push({ uid: `${id}-${rule}-${y}`, title: name, start: iso(d), end: iso(d) });
        }
    }
    return out;
}
const DE_ALL = `01-01 Neujahr
easter-2 Karfreitag
easter+1 Ostermontag
05-01 Tag der Arbeit
easter+39 Christi Himmelfahrt
easter+50 Pfingstmontag
10-03 Tag der Deutschen Einheit
12-25 1. Weihnachtstag
12-26 2. Weihnachtstag`;
const DE_STATES = {
    BW: ['Baden-Württemberg', '01-06 Heilige Drei Könige\neaster+60 Fronleichnam\n11-01 Allerheiligen'],
    BY: ['Bayern', '01-06 Heilige Drei Könige\neaster+60 Fronleichnam\n08-15 Mariä Himmelfahrt\n11-01 Allerheiligen'],
    BE: ['Berlin', '03-08 Internationaler Frauentag'],
    BB: ['Brandenburg', 'easter Ostersonntag\neaster+49 Pfingstsonntag\n10-31 Reformationstag'],
    HB: ['Bremen', '10-31 Reformationstag'],
    HH: ['Hamburg', '10-31 Reformationstag'],
    HE: ['Hessen', 'easter+60 Fronleichnam'],
    MV: ['Mecklenburg-Vorpommern', '03-08 Internationaler Frauentag\n10-31 Reformationstag'],
    NI: ['Niedersachsen', '10-31 Reformationstag'],
    NW: ['Nordrhein-Westfalen', 'easter+60 Fronleichnam\n11-01 Allerheiligen'],
    RP: ['Rheinland-Pfalz', 'easter+60 Fronleichnam\n11-01 Allerheiligen'],
    SL: ['Saarland', 'easter+60 Fronleichnam\n08-15 Mariä Himmelfahrt\n11-01 Allerheiligen'],
    SN: ['Sachsen', '10-31 Reformationstag\n11-23-wed Buß- und Bettag'],
    ST: ['Sachsen-Anhalt', '01-06 Heilige Drei Könige\n10-31 Reformationstag'],
    SH: ['Schleswig-Holstein', '10-31 Reformationstag'],
    TH: ['Thüringen', '09-20 Weltkindertag\n10-31 Reformationstag'],
};
/** ready-made sets; "custom" starts empty. Add a country by adding an entry here. */
export const HOLIDAY_SETS = [
    { id: 'de', name: 'Deutschland (bundesweit)', rules: DE_ALL },
    ...Object.entries(DE_STATES).map(([k, [n, extra]]) => ({ id: `de-${k.toLowerCase()}`, name: `Deutschland · ${n}`, rules: `${DE_ALL}\n${extra}` })),
    { id: 'at', name: 'Österreich', rules: '01-01 Neujahr\n01-06 Heilige Drei Könige\neaster+1 Ostermontag\n05-01 Staatsfeiertag\neaster+39 Christi Himmelfahrt\neaster+50 Pfingstmontag\neaster+60 Fronleichnam\n08-15 Mariä Himmelfahrt\n10-26 Nationalfeiertag\n11-01 Allerheiligen\n12-08 Mariä Empfängnis\n12-25 Christtag\n12-26 Stefanitag' },
    { id: 'ch', name: 'Schweiz (bundesweit)', rules: '01-01 Neujahr\neaster+39 Auffahrt\n08-01 Bundesfeiertag\n12-25 Weihnachten' },
    { id: 'gb', name: 'United Kingdom (England & Wales)', rules: '01-01 New Year’s Day\neaster-2 Good Friday\neaster+1 Easter Monday\n05-mon1 Early May Bank Holiday\n05-mon-1 Spring Bank Holiday\n08-mon-1 Summer Bank Holiday\n12-25 Christmas Day\n12-26 Boxing Day' },
    { id: 'us', name: 'United States (federal)', rules: '01-01 New Year’s Day\n01-mon3 Martin Luther King Jr. Day\n02-mon3 Presidents’ Day\n05-mon-1 Memorial Day\n06-19 Juneteenth\n07-04 Independence Day\n09-mon1 Labor Day\n10-mon2 Columbus Day\n11-11 Veterans Day\n11-thu4 Thanksgiving\n12-25 Christmas Day' },
    { id: 'fr', name: 'France', rules: '01-01 Jour de l’an\neaster+1 Lundi de Pâques\n05-01 Fête du Travail\n05-08 Victoire 1945\neaster+39 Ascension\neaster+50 Lundi de Pentecôte\n07-14 Fête nationale\n08-15 Assomption\n11-01 Toussaint\n11-11 Armistice\n12-25 Noël' },
    { id: 'custom', name: 'Own list', rules: '# one per line: date and name\n# 12-24 Christmas Eve\n# easter+1 Easter Monday\n# 11-thu4 Thanksgiving' },
];
export const HOLIDAY_URL = 'nook:holidays';
//# sourceMappingURL=holidays.js.map