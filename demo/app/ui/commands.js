// Command registry + keymap. Every action has an id; keys are bound per workspace in
// .workspace/keymap.json (overrides) on top of these defaults.
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export function eventToKey(e) {
    const parts = [];
    if (isMac ? e.metaKey : e.ctrlKey)
        parts.push('Mod');
    if (isMac && e.ctrlKey)
        parts.push('Ctrl');
    if (e.altKey)
        parts.push('Alt');
    if (e.shiftKey)
        parts.push('Shift');
    let k = e.key;
    if (k === ' ')
        k = 'Space';
    if (k.length === 1)
        k = k.toUpperCase();
    if (e.code?.startsWith('Digit'))
        k = e.code.slice(5);
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(k))
        return '';
    parts.push(k);
    return parts.join('+');
}
/** "A | B" = alternative bindings for the same command */
export const keyAlternatives = (k) => (k ? k.split(' | ').map((x) => x.trim()).filter(Boolean) : []);
export function prettyKey(k) {
    if (!k)
        return '';
    if (k.includes(' | '))
        return keyAlternatives(k).map((x) => prettyKey(x)).join('  or  ');
    return k.split(' ').map((chord) => chord.split('+').map((p) => {
        if (p === 'Mod')
            return isMac ? '⌘' : 'Ctrl';
        if (p === 'Shift')
            return isMac ? '⇧' : 'Shift';
        if (p === 'Alt')
            return isMac ? '⌥' : 'Alt';
        if (p === 'Ctrl')
            return '⌃';
        if (p === 'ArrowLeft')
            return '←';
        if (p === 'ArrowRight')
            return '→';
        if (p === 'ArrowUp')
            return '↑';
        if (p === 'ArrowDown')
            return '↓';
        if (p === 'Enter')
            return '↵';
        if (p === 'Backslash' || p === '\\')
            return '\\';
        return p;
    }).join(isMac ? '' : '+')).join(' ');
}
export class Keymap {
    overrides;
    commands = new Map();
    pendingChord = null;
    chordTimer;
    constructor(overrides) {
        this.overrides = overrides;
    }
    register(c) { this.commands.set(c.id, c); }
    unregister(id) { this.commands.delete(id); }
    all() { return [...this.commands.values()]; }
    get(id) { return this.commands.get(id); }
    binding(id) {
        return id in this.overrides ? this.overrides[id] || undefined : this.commands.get(id)?.key;
    }
    /** Handles a keydown; returns true when a command ran. Supports two-step chords like "G H". */
    handle(e) {
        const k = eventToKey(e);
        if (!k)
            return false;
        const typing = isTyping(e.target);
        const candidates = this.all().map((c) => ({ c, key: this.binding(c.id) })).filter((x) => x.key);
        const full = this.pendingChord ? `${this.pendingChord} ${k}` : k;
        for (const { c, key } of candidates) {
            if (keyAlternatives(key).includes(full)) {
                // another command may use the same key where this one doesn't apply
                if (c.when && !c.when(e))
                    continue;
                // plain-letter shortcuts never fire while typing
                if (typing && !/Mod|Alt|Ctrl/.test(full) && !full.includes(' '))
                    continue;
                if (typing && full.includes(' '))
                    continue;
                e.preventDefault();
                this.pendingChord = null;
                c.run();
                return true;
            }
        }
        if (!typing && !this.pendingChord && candidates.some(({ key }) => keyAlternatives(key).some((x) => x.startsWith(k + ' ') && !x.startsWith(k + ' | ')))) {
            this.pendingChord = k;
            clearTimeout(this.chordTimer);
            this.chordTimer = setTimeout(() => { this.pendingChord = null; }, 1200);
            e.preventDefault();
            return true;
        }
        this.pendingChord = null;
        return false;
    }
}
export function isTyping(t) {
    const el = t;
    if (!el)
        return false;
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}
//# sourceMappingURL=commands.js.map