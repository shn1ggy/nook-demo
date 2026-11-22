export const CONFIG_PATH = '.workspace/calendars.json';
export async function loadConfig(ws) {
    let raw = {};
    try {
        raw = JSON.parse(await ws.storage.read(CONFIG_PATH));
    }
    catch { /* none yet */ }
    const all = (Array.isArray(raw.subscriptions) ? raw.subscriptions : []);
    // only calendar links are left: accounts (CalDAV), their calendars and two-way sync are gone. What an older
    // workspace still holds of them – logins included – is dropped from the file.
    const cfg = { subscriptions: all.filter((s) => !s.account) };
    if (raw.accounts !== undefined || raw.links !== undefined || raw.options !== undefined || cfg.subscriptions.length !== all.length) {
        await saveConfig(ws, cfg).catch(() => { });
        try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && (k.startsWith('nook:calendar-password:') || k === 'nook:relay'))
                    localStorage.removeItem(k);
            }
        }
        catch { /* nothing kept */ }
    }
    return cfg;
}
export async function saveConfig(ws, c) {
    await ws.write(CONFIG_PATH, JSON.stringify({ subscriptions: c.subscriptions }, null, 2) + '\n', false);
}
//# sourceMappingURL=calsync.js.map