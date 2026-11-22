export class FormulaError extends Error {
}
function lex(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) {
            i++;
            continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
            const m = src.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i);
            out.push({ t: 'num', v: Number(m[0]) });
            i += m[0].length;
            continue;
        }
        if (c === '"' || c === '“' || c === '„') {
            let j = i + 1, s = '';
            while (j < src.length && src[j] !== '"' && src[j] !== '”' && src[j] !== '“') {
                if (src[j] === '\\') {
                    s += src[j + 1] ?? '';
                    j += 2;
                    continue;
                }
                s += src[j++];
            }
            out.push({ t: 'str', v: s });
            i = j + 1;
            continue;
        }
        if (c === '[') {
            const j = src.indexOf(']', i);
            if (j < 0)
                throw new FormulaError('Missing ]');
            out.push({ t: 'prop', v: src.slice(i + 1, j) });
            i = j + 1;
            continue;
        }
        if (c === '(') {
            out.push({ t: '(' });
            i++;
            continue;
        }
        if (c === ')') {
            out.push({ t: ')' });
            i++;
            continue;
        }
        if (c === ',' || c === ';') {
            out.push({ t: ',' });
            i++;
            continue;
        }
        const two = src.slice(i, i + 2);
        if (['==', '!=', '<>', '<=', '>=', '&&', '||'].includes(two)) {
            out.push({ t: 'op', v: two });
            i += 2;
            continue;
        }
        if ('+-*/^%<>=&!'.includes(c)) {
            out.push({ t: 'op', v: c });
            i++;
            continue;
        }
        // identifiers may contain letters incl. umlauts, digits, _, . and %
        const m = src.slice(i).match(/^[\p{L}_][\p{L}\p{N}_.%]*/u);
        if (m) {
            out.push({ t: 'id', v: m[0] });
            i += m[0].length;
            continue;
        }
        throw new FormulaError(`Unexpected "${c}"`);
    }
    return out;
}
const PREC = {
    '||': 1, or: 1, '&&': 2, and: 2,
    '==': 3, '=': 3, '!=': 3, '<>': 3, '<': 4, '>': 4, '<=': 4, '>=': 4,
    '&': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '^': 8,
};
export function parse(src) {
    const toks = lex(src);
    let p = 0;
    const peek = () => toks[p];
    const binOp = () => {
        const t = peek();
        if (!t)
            return null;
        if (t.t === 'op' && t.v in PREC)
            return t.v;
        if (t.t === 'id' && (t.v.toLowerCase() === 'and' || t.v.toLowerCase() === 'or'))
            return t.v.toLowerCase();
        return null;
    };
    function expr(minPrec = 0) {
        let left = unary();
        for (;;) {
            const op = binOp();
            if (!op || PREC[op] < minPrec)
                break;
            p++;
            const right = expr(op === '^' ? PREC[op] : PREC[op] + 1);
            left = { k: 'bin', op, a: left, b: right };
        }
        return left;
    }
    function unary() {
        const t = peek();
        if (t && t.t === 'op' && (t.v === '-' || t.v === '!' || t.v === '+')) {
            p++;
            return { k: 'un', op: t.v, a: unary() };
        }
        if (t && t.t === 'id' && t.v.toLowerCase() === 'not' && toks[p + 1]?.t !== '(') {
            p++;
            return { k: 'un', op: '!', a: unary() };
        }
        return primary();
    }
    function primary() {
        const t = toks[p++];
        if (!t)
            throw new FormulaError('Formula ends too early');
        if (t.t === 'num')
            return { k: 'num', v: t.v };
        if (t.t === 'str')
            return { k: 'str', v: t.v };
        if (t.t === 'prop')
            return { k: 'prop', name: t.v };
        if (t.t === '(') {
            const e = expr();
            expect(')');
            return e;
        }
        if (t.t === 'id') {
            const low = t.v.toLowerCase();
            if (peek()?.t === '(') {
                p++;
                const args = [];
                if (peek()?.t !== ')') {
                    for (;;) {
                        args.push(expr());
                        if (peek()?.t === ',') {
                            p++;
                            continue;
                        }
                        break;
                    }
                }
                expect(')');
                if (low === 'prop' && args[0]?.k === 'str')
                    return { k: 'prop', name: args[0].v };
                return { k: 'call', fn: low, args };
            }
            if (low === 'true')
                return { k: 'bool', v: true };
            if (low === 'false')
                return { k: 'bool', v: false };
            return { k: 'prop', name: t.v };
        }
        throw new FormulaError('Unexpected symbol');
    }
    function expect(tt) {
        const t = toks[p++];
        if (!t || t.t !== tt)
            throw new FormulaError(`Expected ${tt}`);
    }
    const e = expr();
    if (p < toks.length)
        throw new FormulaError('Unexpected text after formula');
    return e;
}
function num(v) {
    if (v == null || v === '')
        return 0;
    if (typeof v === 'number')
        return v;
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    if (typeof v === 'string') {
        const n = Number(v.replace(',', '.'));
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}
function str(v) {
    if (v == null)
        return '';
    if (Array.isArray(v))
        return v.join(', ');
    if (typeof v === 'object')
        return v.end ? `${v.start} → ${v.end}` : v.start;
    return String(v);
}
function truthy(v) {
    if (Array.isArray(v))
        return v.length > 0;
    return !!v && v !== 0 && v !== '';
}
function eq(a, b) {
    if (typeof a === 'number' || typeof b === 'number')
        return num(a) === num(b);
    return str(a) === str(b);
}
function dateOf(v) {
    const s = typeof v === 'object' && v && !Array.isArray(v) ? v.start : typeof v === 'string' ? v : null;
    if (!s)
        return null;
    const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
    return Number.isNaN(d.getTime()) ? null : d;
}
const FN = {
    if: (a, ev) => truthy(ev(a[0])) ? ev(a[1]) : a[2] ? ev(a[2]) : null,
    ifs: (a, ev) => { for (let i = 0; i + 1 < a.length; i += 2)
        if (truthy(ev(a[i])))
            return ev(a[i + 1]); return a.length % 2 ? ev(a[a.length - 1]) : null; },
    switch: (a, ev) => {
        const v = ev(a[0]);
        let i = 1;
        for (; i + 1 < a.length; i += 2)
            if (eq(v, ev(a[i])))
                return ev(a[i + 1]);
        return i < a.length ? ev(a[i]) : null;
    },
    and: (a, ev) => a.every((x) => truthy(ev(x))),
    or: (a, ev) => a.some((x) => truthy(ev(x))),
    not: (a, ev) => !truthy(ev(a[0])),
    empty: (a, ev) => !truthy(ev(a[0])),
    round: (a, ev) => { const f = 10 ** num(a[1] ? ev(a[1]) : 0); return Math.round(num(ev(a[0])) * f) / f; },
    floor: (a, ev) => Math.floor(num(ev(a[0]))),
    ceil: (a, ev) => Math.ceil(num(ev(a[0]))),
    abs: (a, ev) => Math.abs(num(ev(a[0]))),
    sqrt: (a, ev) => Math.sqrt(num(ev(a[0]))),
    min: (a, ev) => Math.min(...a.map((x) => num(ev(x)))),
    max: (a, ev) => Math.max(...a.map((x) => num(ev(x)))),
    sum: (a, ev) => a.reduce((s, x) => s + num(ev(x)), 0),
    tonumber: (a, ev) => num(ev(a[0])),
    concat: (a, ev) => a.map((x) => str(ev(x))).join(''),
    format: (a, ev) => str(ev(a[0])),
    len: (a, ev) => str(ev(a[0])).length,
    length: (a, ev) => str(ev(a[0])).length,
    lower: (a, ev) => str(ev(a[0])).toLowerCase(),
    upper: (a, ev) => str(ev(a[0])).toUpperCase(),
    contains: (a, ev) => str(ev(a[0])).includes(str(ev(a[1]))),
    replace: (a, ev) => str(ev(a[0])).replace(str(ev(a[1])), str(ev(a[2]))),
    now: () => new Date().toISOString().slice(0, 16),
    today: () => new Date().toISOString().slice(0, 10),
    year: (a, ev) => dateOf(ev(a[0]))?.getFullYear() ?? null,
    month: (a, ev) => { const d = dateOf(ev(a[0])); return d ? d.getMonth() + 1 : null; },
    day: (a, ev) => dateOf(ev(a[0]))?.getDate() ?? null,
    datebetween: (a, ev) => {
        const x = dateOf(ev(a[0])), y = dateOf(ev(a[1]));
        if (!x || !y)
            return null;
        const unit = str(ev(a[2] ?? { k: 'str', v: 'days' }));
        const ms = x.getTime() - y.getTime();
        const div = unit.startsWith('week') ? 6048e5 : unit.startsWith('hour') ? 36e5 : 864e5;
        return Math.trunc(ms / div);
    },
};
export function evaluate(node, lookup) {
    const ev = (n) => {
        switch (n.k) {
            case 'num': return n.v;
            case 'str': return n.v;
            case 'bool': return n.v;
            case 'prop': return lookup(n.name);
            case 'un': {
                const v = ev(n.a);
                return n.op === '-' ? -num(v) : n.op === '!' ? !truthy(v) : num(v);
            }
            case 'bin': {
                const op = n.op;
                if (op === 'and' || op === '&&')
                    return truthy(ev(n.a)) && truthy(ev(n.b));
                if (op === 'or' || op === '||')
                    return truthy(ev(n.a)) || truthy(ev(n.b));
                const a = ev(n.a), b = ev(n.b);
                switch (op) {
                    case '+': return typeof a === 'string' && typeof b === 'string' && (isNaN(+a) || isNaN(+b)) ? a + b : num(a) + num(b);
                    case '-': return num(a) - num(b);
                    case '*': return num(a) * num(b);
                    case '/': return num(b) === 0 ? null : num(a) / num(b);
                    case '%': return num(a) % num(b);
                    case '^': return num(a) ** num(b);
                    case '&': return str(a) + str(b);
                    case '==':
                    case '=': return eq(a, b);
                    case '!=':
                    case '<>': return !eq(a, b);
                    case '<': return num(a) < num(b);
                    case '>': return num(a) > num(b);
                    case '<=': return num(a) <= num(b);
                    case '>=': return num(a) >= num(b);
                }
                return null;
            }
            case 'call': {
                const f = FN[n.fn];
                if (!f)
                    throw new FormulaError(`Unknown function ${n.fn}()`);
                return f(n.args, ev);
            }
        }
    };
    return ev(node);
}
/** Properties referenced by a formula (used to order formula columns that reference each other). */
export function references(node, out = new Set()) {
    if (node.k === 'prop')
        out.add(node.name);
    else if (node.k === 'bin') {
        references(node.a, out);
        references(node.b, out);
    }
    else if (node.k === 'un')
        references(node.a, out);
    else if (node.k === 'call')
        node.args.forEach((a) => references(a, out));
    return out;
}
const cache = new Map();
export function compile(src) {
    let c = cache.get(src);
    if (!c) {
        try {
            c = parse(src);
        }
        catch (e) {
            c = e instanceof FormulaError ? e : new FormulaError(String(e));
        }
        cache.set(src, c);
    }
    return c;
}
/** A formula with every reference to property `from` pointing at `to` instead
 *  ([from], prop("from") and bare names); strings and function names stay untouched. */
export function renameInFormula(src, from, to) {
    const bare = /^[\p{L}_][\p{L}\p{N}_.%]*$/u.test(to) ? to : `[${to}]`;
    let out = '', i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '"' || c === '“' || c === '„') {
            let j = i + 1;
            while (j < src.length && src[j] !== '"' && src[j] !== '”' && src[j] !== '“')
                j += src[j] === '\\' ? 2 : 1;
            out += src.slice(i, j + 1);
            i = j + 1;
            continue;
        }
        if (c === '[') {
            const j = src.indexOf(']', i);
            if (j < 0) {
                out += src.slice(i);
                break;
            }
            out += src.slice(i + 1, j) === from ? `[${to}]` : src.slice(i, j + 1);
            i = j + 1;
            continue;
        }
        const m = /[\p{L}_]/u.test(c) && !/[\p{L}\p{N}_.%]/u.test(src[i - 1] ?? ' ') ? src.slice(i).match(/^[\p{L}_][\p{L}\p{N}_.%]*/u) : null;
        if (m) {
            const after = src.slice(i + m[0].length);
            const call = /^\s*\(/.test(after);
            if (call && m[0].toLowerCase() === 'prop') {
                // prop("Name")
                const pm = after.match(/^(\s*\(\s*)(["“„])([^"”“]*)(["”“])/);
                if (pm && pm[3] === from) {
                    out += `prop${pm[1]}"${to.replace(/"/g, '\\"')}"`;
                    i += m[0].length + pm[0].length;
                    continue;
                }
            }
            out += !call && m[0] === from ? bare : m[0];
            i += m[0].length;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}
//# sourceMappingURL=formula.js.map