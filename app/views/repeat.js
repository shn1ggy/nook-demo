import { asDate, dayNum, fmtDate, MONTHS, parseDateInput, WEEKDAYS } from '../util.js';
import { formatRRule, parseRRule, weekday } from '../recur.js';
import { menu, prompt, toast } from '../ui/pop.js';
export function repeatMenu(ws, db, row, anchor, after) {
    const dateProp = db.schema.properties.find((p) => p.type === 'date')?.name;
    const start = dateProp ? asDate(row.values[dateProp])?.start.slice(0, 10) : undefined;
    if (!start) {
        toast('Give the entry a date first');
        return;
    }
    const cur = parseRRule(row.repeat);
    const wd = weekday(dayNum(start));
    const day = +start.slice(8, 10);
    const save = async (r) => {
        if (r) {
            r.except = undefined;
            row.repeat = formatRRule(r);
        }
        else {
            delete row.repeat;
            delete row.except;
        }
        ws.boundary();
        await ws.saveRow(db, row);
        after();
    };
    const is = (f, interval = 1, days) => !!cur && cur.freq === f && cur.interval === interval && JSON.stringify(cur.days ?? []) === JSON.stringify(days ?? []) && !cur.until && !cur.count;
    const item = (label, on, r) => ({ label: `${on ? '✓' : '   '} ${label}`, run: () => save(r) });
    const custom = () => {
        const base = cur ? { ...cur } : { freq: 'weekly', interval: 1, days: [wd] };
        const units = [['daily', 'days'], ['weekly', 'weeks'], ['monthly', 'months'], ['yearly', 'years']];
        const out = [
            { label: 'Every…', hint: `${base.interval} ${units.find((u) => u[0] === base.freq)[1]}`, sub: () => [
                    ...[1, 2, 3, 4, 6].map((n) => ({ label: `${base.interval === n ? '✓' : '   '} ${n}`, run: () => save({ ...base, interval: n }) })),
                    'sep',
                    ...units.map(([f, l]) => ({ label: `${base.freq === f ? '✓' : '   '} ${l}`, run: () => save({ ...base, freq: f, days: f === 'weekly' ? base.days ?? [wd] : undefined }) })),
                ] },
        ];
        if (base.freq === 'weekly')
            out.push({ label: 'On days', hint: (base.days ?? [wd]).map((d) => WEEKDAYS[d].slice(0, 2)).join(' '), sub: () => WEEKDAYS.map((w, i) => {
                    const days = base.days ?? [wd];
                    const on = days.includes(i);
                    return { label: `${on ? '✓' : '   '} ${w}`, run: () => { const next = on ? days.filter((x) => x !== i) : [...days, i].sort(); if (next.length)
                            save({ ...base, days: next }); } };
                }) });
        out.push({ label: 'Ends', hint: base.until ? fmtDate({ start: base.until }) : base.count ? `after ${base.count}` : 'never', sub: () => [
                { label: `${!base.until && !base.count ? '✓' : '   '} Never`, run: () => save({ ...base, until: undefined, count: undefined }) },
                { label: `${base.until ? '✓' : '   '} On date…`, run: () => prompt(anchor, 'Last date', base.until ? fmtDate({ start: base.until }) : '', (v) => { const d = parseDateInput(v); if (d)
                        save({ ...base, until: d, count: undefined });
                    else
                        toast('Could not read that date'); }) },
                { label: `${base.count ? '✓' : '   '} After a number of times…`, run: () => prompt(anchor, 'How many times in total', String(base.count ?? 10), (v) => { const n = parseInt(v, 10); if (n > 0)
                        save({ ...base, count: n, until: undefined }); }) },
            ] });
        return out;
    };
    menu(anchor, [
        item('Does not repeat', !cur, null),
        'sep',
        item('Every day', is('daily'), { freq: 'daily', interval: 1 }),
        item(`Every week on ${WEEKDAYS[wd]}`, is('weekly', 1, [wd]) || is('weekly', 1), { freq: 'weekly', interval: 1, days: [wd] }),
        item(`Every 2 weeks on ${WEEKDAYS[wd]}`, is('weekly', 2, [wd]) || is('weekly', 2), { freq: 'weekly', interval: 2, days: [wd] }),
        item('Every weekday (Mon–Fri)', is('weekly', 1, [0, 1, 2, 3, 4]), { freq: 'weekly', interval: 1, days: [0, 1, 2, 3, 4] }),
        item(`Every month on day ${day}`, is('monthly'), { freq: 'monthly', interval: 1 }),
        item(`Every year on ${day} ${MONTHS[+start.slice(5, 7) - 1]}`, is('yearly'), { freq: 'yearly', interval: 1 }),
        'sep',
        { label: 'Custom', sub: custom },
    ]);
}
//# sourceMappingURL=repeat.js.map