import { deviceStorage, clearAssets, assetLimitMB, setAssetLimitMB, DropboxStorage } from '../storage/dropbox.js';
import { kbDebugOn, setKbDebug } from './kbdebug.js';
import { phonePref, setPhonePref } from './app.js';
import { wcard, wrow, wsum } from './win.js';
import { allWidgets, customWidgets } from '../widgets/api.js';
import { installWidget, loadCustomWidgets, removeWidgetFile, WIDGET_DIR } from '../widgets/runtime.js';
import { WIDGET_PROMPT } from '../widgets/prompt.js';
import { saveFile } from '../exporter/export.js';
// Settings window (⌘/Ctrl+,): General, Appearance, Behaviour, Dates & numbers, Colors, Shortcuts,
// Custom shortcuts, Calendars, Import and Files. Moved out of app.ts to keep that file about the app shell.
import { APP } from '../config.js';
import { COLORS, h, bgFromColor, DATE_FORMATS, colorLabel, BUILTIN_COLORS, builtinColor, DEFAULT_BG, fmtNumber, fmtDay, defaultLocale, segmented, svgIcon, ICONS } from '../util.js';
import { iconSvg, renderIcon } from './icons.js';
import { menu, toast, dialog, confirmDialog, colorDot } from './pop.js';
import { REMIND_TIMED, REMIND_DAY } from './reminders.js';
import { eventToKey, prettyKey, keyAlternatives } from './commands.js';
import { calendarSection } from './calsettings.js';
import { sourcesSection } from './sourcesettings.js';
import { workspaceWidth } from '../pagewidth.js';
import { widthControl } from './widthcontrol.js';
import { dbItems, pageItems, pickEntries, pickerControl } from './pickers.js';
import { exportRaw, exportWorkspace } from '../exporter/export.js';
import { calendars } from '../sync/service.js';
import { moreControl, openSettingsWindow, selectControl, switchControl } from './settings.js';
import { typeIcon } from '../views/cells.js';
import { FONTS } from './app.js';
import { colorButton, openColorPicker } from './colorpicker.js';
export function openSettings(app, start) {
    // already open: the shortcut (or button) closes it instead of stacking a second window
    if (app.settingsWin && document.querySelector('.set-window')) {
        if (!start) {
            app.settingsWin.close();
            app.settingsWin = null;
        }
        return;
    }
    const ws = app.ws;
    const s = ws.settings;
    const apply = async (meta = false) => { if (meta)
        await ws.saveMeta(); await ws.saveSettings(); app.sidebarOpen = s.sidebar; app.applySettings(); app.render(); };
    let win = null;
    const redraw = () => win?.refresh();
    // ----- general -----
    const general = () => {
        const name = h('input', { type: 'text', class: 'set-input', value: ws.meta.name, 'aria-label': 'Workspace name' });
        name.addEventListener('change', () => { ws.meta.name = name.value.trim() || ws.meta.name; apply(true); });
        return [
            { heading: 'Workspace' },
            { title: 'Name', desc: 'In the sidebar and the window title', control: name, keywords: 'workspace name' },
            { title: 'Saved in', desc: 'Settings travel with the workspace folder', value: ws.storage.label, control: app.shell.showInFolder ? h('button', { class: 'set-btn', onclick: () => app.shell.showInFolder() }, 'Show in folder') : undefined, keywords: 'where location folder dropbox' },
            ...syncRows(),
            { heading: 'Start page' },
            { title: 'Start page', desc: 'Opens first; first favorite in the sidebar', control: pickerControl({ value: ws.meta.home ?? '', items: () => pageItems(ws), change: (v) => { ws.meta.home = v; apply(true); }, label: 'Start page' }) },
            { title: 'Date and time', desc: 'Right of the start page’s title', control: switchControl(!!s.homeClock, (v) => { if (v)
                    s.homeClock = true;
                else
                    delete s.homeClock; apply(); }, 'Date and time on the start page'), keywords: 'clock date time start page home today' },
        ];
    };
    // ----- navigation -----
    const behaviour = () => [
        ...(document.documentElement.classList.contains('phone') ? [
            { heading: 'On this phone' },
            { title: 'Open on', desc: 'Where Nook starts', control: segmented([['home', 'Start page'], ['pages', 'Library'], ['last', 'Last page']], phonePref().start, (v) => setPhonePref({ start: v }), 'Open on'), keywords: 'start open launch pages library last phone' },
            { title: 'Bottom bar', desc: 'Icons with their names, or icons only', control: segmented([['labels', 'Icons and labels'], ['icons', 'Icons only']], phonePref().tabLabels ? 'labels' : 'icons', (v) => setPhonePref({ tabLabels: v === 'labels' }), 'Bottom bar'), keywords: 'tab bar bottom labels icons names' },
        ] : []),
        { heading: 'Sidebar' },
        { title: 'Show sidebar at start', control: switchControl(s.sidebar, (v) => { s.sidebar = v; apply(); }, 'Show sidebar at start'), keywords: 'sidebar open hidden' },
        { title: 'Workspace bar when hidden', desc: 'Search, settings and workspaces stay in the bottom left', control: switchControl(!!s.wsFloat, (v) => { s.wsFloat = v; apply(); }, 'Workspace bar when hidden'), keywords: 'floating workspace settings search bottom left sidebar closed' },
        { heading: 'Pages' },
        { title: 'Start page in the path', desc: 'The path at the top always begins with it', control: switchControl(!!s.homeCrumb, (v) => { if (v)
                s.homeCrumb = true;
            else
                delete s.homeCrumb; apply(); }, 'Start page in the path'), keywords: 'home start page breadcrumb path top bar' },
        { title: 'Backlinks', desc: 'Pages that link to a page, under its content', control: segmented([['expanded', 'Open'], ['collapsed', 'Folded'], ['off', 'Off']], s.backlinks ?? 'collapsed', (v) => { if (v === 'collapsed')
                delete s.backlinks;
            else
                s.backlinks = v; apply(); }, 'Backlinks'), keywords: 'backlinks linked from mentions references' },
        { heading: 'Entries' },
        { title: 'Open entries with', desc: 'Calendar events, cards and list entries', control: segmented([['single', 'Click'], ['double', 'Double click']], s.openWith ?? 'double', (v) => { s.openWith = v; apply(); }, 'Open entries with'), keywords: 'click double single open entry event card notion' },
    ];
    // ----- about -----
    const about = () => {
        const kind = ws.storage.constructor.name;
        // where this workspace's files are kept
        const runs = kind === 'DropboxStorage' ? ['Dropbox', 'Every change is saved to your Dropbox; this device keeps a copy to work offline.']
            : kind === 'ServerStorage' ? ['Folder on this computer', 'Through Nook’s local server, so every browser can open folders.']
                : kind === 'TauriStorage' ? ['Folder on this computer', 'Read and written directly by the desktop app.']
                    : kind === 'FolderStorage' ? ['Folder on this computer', 'This browser was given access to the workspace folder.']
                        : ['Nowhere', 'A demo: changes are gone when you close Nook.'];
        return [
            { heading: 'Version' },
            { title: APP.name, desc: `Released ${fmtDay(APP.released)}`, value: APP.version, icon: h('img', { class: 'set-ico-img', src: 'icon-256.png', alt: '', width: '30', height: '30' }), keywords: 'version release about' },
            { title: 'What’s new', desc: 'Every change is listed in CHANGELOG.md', value: 'CHANGELOG.md', keywords: 'changelog changes' },
            { heading: 'This workspace' },
            { title: 'Saved in', desc: runs[1], value: runs[0] },
            { title: 'Files', desc: 'Pages are Markdown, settings JSON – readable in any text editor', value: `Format ${APP.formatVersion}` },
            ...(document.documentElement.classList.contains('phone') ? [{ heading: 'This screen' }, { title: 'Sizes', desc: screenFacts(), keywords: 'screen display size' }, { title: 'Keyboard diagnostics', desc: 'A readout at the top of the screen with what iOS reports while you type – for finding the keyboard bug. Nothing leaves this device.', control: switchControl(kbDebugOn(), (on) => setKbDebug(on), 'Keyboard diagnostics'), keywords: 'keyboard debug diagnostics test' }] : []),
            { heading: 'Credits' },
            { title: 'Geist and Geist Mono', desc: 'Fonts by Vercel', value: 'OFL 1.1', keywords: 'font license' },
            { title: 'Icons', desc: 'In the style of Lucide', value: 'ISC', keywords: 'icons license lucide' },
        ];
    };
    // ----- files -----
    // ----- fetching what changed elsewhere, on demand -----
    const syncRows = () => {
        const st = ws.storage;
        if (!st.sync)
            return [];
        const desc = h('span', null, '…');
        const off = st.onStatus?.((x) => {
            if (!desc.isConnected && desc.dataset.seen) {
                off?.();
                return;
            }
            desc.dataset.seen = '1';
            const when = st.lastChecked ? new Date(st.lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            desc.textContent = x.error ? `Problem: ${x.error}` : x.offline ? 'Offline – changes are kept and sent later' : x.pending ? `${x.pending} change${x.pending === 1 ? '' : 's'} waiting to be saved` : `Everything saved${when ? ` · checked ${when}` : ''}`;
        });
        const run = async (btn, deep) => {
            const label = btn.textContent;
            btn.disabled = true;
            btn.textContent = deep ? 'Loading…' : 'Fetching…';
            try {
                let n = 0;
                if (deep)
                    await st.reloadAll();
                else
                    n = await st.sync();
                await app.reload(true);
                toast(deep ? 'Workspace loaded again from Dropbox' : n ? `${n} change${n === 1 ? '' : 's'} from your other devices` : 'Everything is up to date');
            }
            catch (err) {
                toast(`Could not refresh: ${err.message}`, 4000);
            }
            btn.disabled = false;
            btn.textContent = label;
            win?.refresh();
        };
        return [
            { heading: 'Sync' },
            { title: 'Changes from other devices', desc, control: h('button', { class: 'set-btn', onclick: (e) => run(e.currentTarget, false) }, 'Fetch now'), keywords: 'sync refresh update reload fetch dropbox changes' },
            // what waits to be saved, by folder – to see what a long "Saving to Dropbox…" is about
            ...(st instanceof DropboxStorage && st.pendingSummary().length ? [{ title: `Waiting to be saved: ${st.pendingSummary().reduce((n, [, c]) => n + c, 0)}`, desc: st.pendingSummary().slice(0, 6).map(([k, n]) => `${k} ${n}`).join(' · '), keywords: 'pending waiting outbox queue saving' }] : []),
            ...(st.reloadAll ? [{ title: 'Load the workspace again', desc: 'If something still looks out of date – your changes are saved first', control: h('button', { class: 'set-btn', onclick: (e) => run(e.currentTarget, true) }, 'Load again'), keywords: 'reload reset cache resync repair' }] : []),
        ];
    };
    const devInfo = h('span', null, '…');
    void deviceStorage().then((d) => { const mb = (b) => b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`; devInfo.textContent = `Text ${mb(d.textBytes)} · ${d.files.toLocaleString()} files ${mb(d.fileBytes)}`; }).catch(() => { devInfo.textContent = 'Not available here'; });
    const arrange = () => confirmDialog({
        title: 'Prepare arranging the folder?',
        lines: [
            'Nook works out where everything goes – Pages/ nested like the sidebar, Databases/ with one file per entry, pictures next to what shows them, the rest into Unused files/ – and checks the result on a copy in memory. Nothing in the folder changes yet; the plan is saved as .workspace/arrange-plan.json.',
            'Then, on your Windows PC: close Nook everywhere, pause Dropbox, double-click “Arrange Nook (Windows).cmd” (in the Nook download) and drag your workspace folder into its window. It moves everything in seconds, checks the result and puts everything back if anything is off. Resume Dropbox afterwards.',
        ],
        ok: 'Prepare',
        onOk: async () => {
            app.settingsWin?.close();
            app.settingsWin = null;
            const t = h('div', { class: 'toast prog-toast', role: 'status' }, 'Preparing …');
            document.body.append(t);
            try {
                const r = await ws.makeArrangePlan((step) => { t.textContent = `Preparing · ${step} …`; });
                await ws.storage.flush?.();
                t.remove();
                confirmDialog({ title: 'Plan ready', lines: [`${r.moves.toLocaleString()} moves and ${r.writes.toLocaleString()} updated files, checked on a copy. Saved in .workspace/arrange-plan.json.`, 'Next, on your Windows PC: wait until Dropbox has synced the plan, close Nook (also on the phone), pause Dropbox, run “Arrange Nook (Windows).cmd” and drag the workspace folder into it. Resume Dropbox when it says Done.'], ok: 'OK', onOk: () => { } });
            }
            catch (e) {
                t.remove();
                const report = e.report;
                if (!report) {
                    toast(`Could not prepare: ${e.message}`, 10000);
                    return;
                }
                // the whole list, to read and to copy
                const pre = h('pre', { class: 'arrange-report' }, report);
                const close = dialog(h('div', { class: 'bwindow' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px' } }, 'Not prepared – what differed')), h('div', { class: 'dialog-body' }, pre), h('div', { class: 'bfooter' }, h('button', { class: 'set-btn', onclick: () => { void navigator.clipboard.writeText(report).then(() => toast('Copied')); } }, 'Copy'), h('button', { class: 'btn-new', onclick: () => close() }, 'Close'))));
            }
        },
    });
    const files = () => [
        { heading: 'Adding images and videos' },
        { title: 'Size', desc: 'Compressed: images at most 2560 px as JPEG (82 %), videos at most 1080p – usually a tenth of the size, with no visible difference. Small files stay as they are', control: selectControl([['ask', 'Ask each time'], ['compressed', 'Compressed'], ['original', 'Original']], ws.settings.compress ?? 'ask', (v) => { ws.settings.compress = v; void ws.saveSettings(); }, 'Size'), keywords: 'compress compression upload image photo video size quality smaller original' },
        { heading: 'Folders' },
        ws.layout2
            ? { title: 'Folders follow the sidebar', desc: 'Pages/ nested like the sidebar, Databases/ with one file per entry, files next to the page or entry that shows them', value: 'On', keywords: 'folder layout structure finder explorer files sidebar' }
            : { title: 'Folders follow the sidebar', desc: 'Now pages, databases and files are in three flat folders. Prepare a plan here, then a script on your Windows PC arranges them into Pages/ and Databases/', control: h('button', { class: 'set-btn', onclick: arrange }, 'Prepare…'), keywords: 'folder layout structure finder explorer files sidebar arrange' },
        ...(ws.storage instanceof DropboxStorage ? [
            { heading: 'On this device' },
            { title: 'Kept in this browser', desc: devInfo, keywords: 'storage space cache device offline' },
            { title: 'Files kept after showing them', desc: 'The least recently shown go first – Dropbox still has them', control: selectControl([['100', '100 MB'], ['300', '300 MB'], ['1000', '1 GB'], ['0', 'No limit']], String(assetLimitMB()), (v) => setAssetLimitMB(Number(v)), 'Limit'), keywords: 'storage cache limit images space' },
            { title: 'Empty the file store', desc: 'Images and files load from Dropbox again when shown', control: h('button', { class: 'set-btn', onclick: async () => { await clearAssets(); toast('File store emptied'); win?.refresh(); } }, 'Empty'), keywords: 'clear cache storage space' },
        ] : []),
        { heading: 'Clean up' },
        ...(ws.storage instanceof DropboxStorage ? [{ title: 'Missing files', desc: 'Files that pages and entries point at but that are gone – Dropbox keeps deleted files for 30 days (180 with Plus), and they can be brought back from here', control: h('button', { class: 'set-btn', onclick: (e) => void missingFiles(e.currentTarget) }, 'Look…'), keywords: 'missing deleted files restore recover lost pdf images attachments dropbox' }] : []),
        { title: 'Links to files', desc: 'Pages and entries that point at a file that has moved: pointed at the file of that name again – next to the page or entry, else anywhere in the workspace', control: h('button', { class: 'set-btn', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try {
                    const n = await ws.relinkFiles();
                    toast(n ? `Repaired ${n} ${n === 1 ? 'link' : 'links'}` : 'All links to files work');
                }
                catch (err) {
                    toast(`Could not repair: ${err.message}`);
                }
                finally {
                    b.disabled = false;
                } } }, 'Repair'), keywords: 'file missing broken links attachments pdf images repair relink moved' },
        { title: 'Unused files', desc: 'Nothing points at them any more – delete or move aside', control: h('button', { class: 'set-btn', onclick: (e) => unusedFiles(e.currentTarget) }, 'Find…'), keywords: 'unused files assets images clean up orphaned attachments storage' },
    ];
    const missingFiles = async (btn) => {
        const st = ws.storage;
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = 'Looking…';
        try {
            await ws.relinkFiles().catch(() => 0);
            const miss = ws.missingFiles();
            if (!miss.length) {
                toast('No missing files – every link points at a file');
                return;
            }
            const found = await st.deletedVersions([...new Set(miss.flatMap((m) => m.places))]);
            const hits = miss.map((m) => { const at = m.places.find((p) => found.has(p)); return { ...m, at, v: at ? found.get(at) : undefined }; });
            const nameOf = (x) => decodeURI(x.ref).split('/').pop();
            const shortOf = (n) => n.replace(/^[a-z0-9]{6}-/, '');
            const body = h('div', { class: 'mf-body' });
            const go = h('button', { class: 'btn-new' });
            const status = (x) => x.local ? `in your folder · ${Math.max(1, Math.round(x.local.size / 1024)).toLocaleString()} KB` : x.v ? `in Dropbox, deleted ${new Date(x.v.when).toLocaleDateString()}` : 'not found yet';
            const draw = () => {
                body.textContent = '';
                const ready = hits.filter((x) => x.local || x.v), lost = hits.filter((x) => !x.local && !x.v);
                const row = (x) => h('div', { class: 'mf-row' + (x.local || x.v ? ' ok' : '') }, h('span', { class: 'mf-n' }, shortOf(nameOf(x))), h('span', { class: 'mf-t' }, x.title), h('span', { class: 'mf-s' }, status(x)));
                if (ready.length)
                    body.append(h('div', { class: 'mf-sec' }, `Ready to put back · ${ready.length}`), ...ready.map(row));
                if (lost.length)
                    body.append(h('div', { class: 'mf-sec' }, `Still missing · ${lost.length}`), ...lost.map(row));
                go.textContent = ready.length ? `Put back ${ready.length} ${ready.length === 1 ? 'file' : 'files'}` : 'Nothing to put back';
                go.disabled = !ready.length;
            };
            // a folder (or files) on this computer: each missing file is found by its name (with or without the short prefix)
            const pickFrom = (dir) => {
                const inp = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
                if (dir)
                    inp.setAttribute('webkitdirectory', '');
                inp.addEventListener('change', () => {
                    const byName = new Map();
                    for (const f of [...(inp.files ?? [])]) {
                        byName.set(f.name.toLowerCase(), f);
                        byName.set(shortOf(f.name).toLowerCase(), f);
                    }
                    let n = 0;
                    for (const x of hits) {
                        if (x.local)
                            continue;
                        const nm = nameOf(x);
                        const f = byName.get(nm.toLowerCase()) ?? byName.get(shortOf(nm).toLowerCase());
                        if (f) {
                            x.local = f;
                            n++;
                        }
                    }
                    inp.remove();
                    draw();
                    toast(n ? `Found ${n} of ${hits.length}` : 'None of the missing files is in there', 4000);
                });
                document.body.appendChild(inp);
                inp.click();
            };
            const phone = document.documentElement.classList.contains('phone');
            const close = dialog(h('div', { class: 'bwindow mf-window' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px', flex: 1 } }, `Missing files · ${miss.length}`), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close() }, svgIcon(ICONS.close))), body, h('div', { class: 'mf-foot' }, phone ? null : h('button', { class: 'set-btn', onclick: () => pickFrom(true) }, 'Look in a folder…'), h('button', { class: 'set-btn', onclick: () => pickFrom(false) }, 'Choose files…'), h('span', { style: { flex: '1' } }), go)), { wide: true });
            draw();
            go.addEventListener('click', async () => {
                go.disabled = true;
                let n = 0, bad = 0;
                const ready = hits.filter((x) => x.local || x.v);
                for (const x of ready) {
                    go.textContent = `Putting back ${n + bad + 1} of ${ready.length}…`;
                    try {
                        if (x.local)
                            await ws.putBackFile(x.ref, x.owner, new Uint8Array(await x.local.arrayBuffer()));
                        else {
                            await st.restoreVersion(x.at, x.v.rev);
                            ws.noteFile(x.at);
                            await ws.putBackFile(x.ref, x.owner, null, x.at);
                        }
                        n++;
                    }
                    catch (err) {
                        console.warn(err);
                        bad++;
                    }
                }
                close();
                toast(`Put back ${n} ${n === 1 ? 'file' : 'files'}${bad ? ` · ${bad} failed` : ''}`, 5000);
                app.render();
            });
        }
        catch (err) {
            toast(`Could not look: ${err.message}`);
        }
        finally {
            btn.disabled = false;
            btn.textContent = old;
        }
    };
    const unusedFiles = async (btn) => {
        btn.disabled = true;
        btn.textContent = 'Searching…';
        let list = [];
        try {
            list = await ws.unusedFiles();
        }
        catch (err) {
            toast(`Could not search: ${err.message}`);
            return;
        }
        finally {
            btn.disabled = false;
            btn.textContent = 'Find…';
        }
        if (!list.length) {
            toast('No unused files');
            return;
        }
        const n = list.length, files = n === 1 ? 'file' : 'files';
        const moveBtn = h('button', { class: 'set-btn', title: 'Move to .workspace/unused-files' }, 'Move aside');
        const delBtn = h('button', { class: 'btn-new danger-btn' }, `Delete ${n} ${files}`);
        const close = dialog(h('div', { class: 'bwindow unused-box' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px' } }, 'Unused files')), h('div', { class: 'dialog-body bwin' }, wsum(`${n} ${files} nothing points at`), wcard(null, ...list.map((f) => { const rel = f.slice('assets/'.length); const i = rel.lastIndexOf('/'); return wrow(rel.slice(i + 1), null, i > 0 ? rel.slice(0, i) : 'assets'); }))), h('div', { class: 'bfooter' }, h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), moveBtn, delBtn)));
        const act = async (run, done) => {
            moveBtn.disabled = delBtn.disabled = true;
            try {
                const k = await run();
                close();
                toast(done(k));
            }
            catch (err) {
                moveBtn.disabled = delBtn.disabled = false;
                toast(`Could not finish: ${err.message}`, 4000);
            }
        };
        moveBtn.addEventListener('click', () => act(() => ws.moveUnusedFiles(list), (k) => `Moved ${k} ${k === 1 ? 'file' : 'files'} to .workspace/unused-files`));
        delBtn.addEventListener('click', () => confirmDialog({ title: `Delete ${n} ${files}?`, lines: ['They can’t be restored.'], ok: 'Delete', danger: true, onOk: () => act(() => ws.deleteUnusedFiles(list), (k) => `Deleted ${k} ${k === 1 ? 'file' : 'files'}`) }));
        requestAnimationFrame(() => delBtn.focus());
    };
    // ----- appearance -----
    let bgOpen = false;
    const appearance = () => {
        const ACCENTS = ['#2383e2', '#529e72', '#9d68d3', '#d15796', '#df5452', '#c77d48', '#ca9849', '#9b9b9b'];
        const cur = (s.accent || '#2383e2').toLowerCase();
        const custom = h('button', { type: 'button', class: 'accent-swatch accent-other' + (!ACCENTS.includes(cur) ? ' on' : ''), style: !ACCENTS.includes(cur) ? { background: cur } : undefined, title: 'Any color', 'aria-label': 'Choose any accent color',
            onclick: () => openColorPicker(custom, { value: cur, original: '#2383e2', label: 'Accent', onInput: (c) => { s.accent = c; custom.style.background = c; app.applySettings(); }, onDone: () => { ws.saveSettings(); redraw(); } }) });
        const accents = h('div', { class: 'accent-row' }, ACCENTS.map((c) => h('button', { class: 'accent-swatch' + (cur === c ? ' on' : ''), style: { background: c }, title: c, 'aria-label': `Accent ${c}`, onclick: () => { s.accent = c; ws.saveSettings(); app.applySettings(); redraw(); } })), custom);
        // background colour of the current theme: hue, saturation, lightness
        const mode = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
        const bgc = { ...(s.background?.[mode] ?? DEFAULT_BG[mode]) };
        const limits = mode === 'dark' ? { l: [0, 22] } : { l: [88, 100] };
        /** a slider row: name left, slider + value right (the same in Appearance and Colors) */
        const bgRow = (key, title, min, max, unit) => {
            const get = () => (key === 'c' ? s.contrast ?? 0 : bgc[key]);
            const val = h('span', { class: 'set-slider-val' }, `${get()}${unit}`);
            const r = h('input', { type: 'range', class: 'set-slider' + (key === 'h' ? ' hue' : ''), min: String(min), max: String(max), step: key === 'l' ? '0.5' : '1', value: String(get()), 'aria-label': `${title} of the background` });
            fillSlider(r);
            r.addEventListener('input', () => {
                const v = Number(r.value);
                fillSlider(r);
                val.textContent = `${v}${unit}`;
                if (key === 'c') {
                    s.contrast = v || undefined;
                    app.applySettings();
                    liveRender();
                    return;
                }
                bgc[key] = v;
                s.background = { ...(s.background ?? {}), [mode]: { ...bgc } };
                app.applySettings();
                const chip = document.querySelector('.set-window .bg-chip');
                if (chip)
                    chip.style.background = `hsl(${bgc.h} ${bgc.s}% ${bgc.l}%)`;
            });
            r.addEventListener('change', () => ws.saveSettings());
            return { title, control: h('div', { class: 'set-slider-wrap' }, r, val), keywords: 'background hue saturation lightness contrast' };
        };
        const bgRows = bgOpen ? [bgRow('h', 'Hue', 0, 360, '°'), bgRow('s', 'Saturation', 0, 40, ' %'), bgRow('l', 'Lightness', limits.l[0], limits.l[1], ' %')] : [];
        const bgBtn = h('button', { class: 'set-btn with-icon', onclick: () => { bgOpen = !bgOpen; redraw(); } }, h('span', { class: 'bg-chip', style: { background: `hsl(${bgc.h} ${bgc.s}% ${bgc.l}%)` } }), bgOpen ? 'Done' : 'Adjust…');
        return [
            { heading: 'Theme' },
            document.documentElement.classList.contains('phone')
                // phone: see each theme before picking it
                ? { title: 'Theme', wide: h('div', { class: 'theme-cards' }, ...[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']].map(([k, l]) => h('button', { class: 'theme-card' + ((s.theme ?? 'dark') === k ? ' on' : ''), onclick: () => { s.theme = k; apply(); redraw(); } }, h('span', { class: `theme-prev theme-prev-${k}` }, h('i'), h('i'), h('i')), h('span', null, l)))), keywords: 'dark light mode appearance system auto' }
                : { title: 'Theme', control: segmented([['dark', 'Dark'], ['light', 'Light'], ['system', 'Auto']], s.theme ?? 'dark', (v) => { s.theme = v; apply(); redraw(); }, 'Theme'), keywords: 'dark light mode appearance system auto' },
            { title: 'Accent', desc: 'Buttons, selections and highlights', control: accents, keywords: 'accent colour color theme' },
            { title: 'Background', desc: 'The page; sidebar, cards and lines follow', control: bgBtn, keywords: 'background hue saturation brightness colour grey contrast' },
            ...bgRows,
            { heading: 'Text' },
            { title: 'Font', control: segmented(FONTS.map((f) => [f[0], f[1]]), FONTS.some((f) => f[0] === s.font) ? s.font : 'system', (v) => { s.font = v; apply(); }, 'Font'), keywords: 'font typeface geist serif monospace' },
            { title: 'Size', desc: 'Everything in Nook', control: selectControl([80, 90, 100, 110, 125, 140, 150].map((n) => [String(n), `${n} %`]), String(s.zoom ?? 100), (v) => { const n = Number(v); if (n === 100)
                    delete s.zoom;
                else
                    s.zoom = n; apply(); }, 'Size'), keywords: 'zoom size scale bigger smaller ui' },
            { heading: 'Layout' },
            { title: 'Density', desc: 'Rows, blocks and sidebar', control: segmented([['dense', 'Compact'], ['compact', 'Comfortable']], s.density, (v) => { s.density = v; apply(); }, 'Density'), keywords: 'compact spacing density' },
            { title: 'Page width', desc: 'Pages can choose their own in their ⋯ menu', keywords: 'page width full wide narrow default pixels', control: widthControl(workspaceWidth(s), (value) => { s.defaultPageWidth = value; delete s.pageWidth; void apply(); }) },
            { title: 'Buttons and page links', desc: 'Default size on pages', control: selectControl([['large', 'Large (cards)'], ['normal', 'Normal (one line)']], s.blockSize ?? 'large', (v) => { s.blockSize = v; apply(); }, 'Buttons and page links'), keywords: 'large small size button page link subpage card tile' },
            { title: 'Blur behind windows', control: switchControl(!!s.blur, (v) => { s.blur = v; apply(); }, 'Blur behind windows'), keywords: 'blur background overlay dialog window' },
            { heading: 'This device' },
            { title: 'Own appearance on this device', desc: 'Everything above applies only here', control: switchControl(ws.deviceLook, (v) => { ws.setDeviceLook(v); app.applySettings(); app.render(); redraw(); }, 'Own appearance on this device'), keywords: 'device computer laptop phone local own different per device width scale' },
            { heading: 'Reset' },
            { title: 'Background', desc: 'Back to the original color', control: h('button', { class: 'set-btn', disabled: !s.background?.[mode], onclick: () => { if (s.background)
                        delete s.background[mode]; ws.saveSettings(); app.applySettings(); app.render(); redraw(); } }, 'Reset') },
        ];
    };
    // ----- dates -----
    const dates = () => [
        { heading: 'Dates and times' },
        { title: 'Date', desc: 'How dates are shown and typed', control: selectControl(DATE_FORMATS.map(([v, ex]) => [v, ex]), s.dateFormat ?? 'DD.MM.YYYY', (v) => { s.dateFormat = v; apply(); }, 'Date format'), keywords: 'date format' },
        { title: 'Time', control: segmented([['24h', '21:00'], ['12h', '9:00 PM']], s.timeFormat ?? '24h', (v) => { s.timeFormat = v; apply(); }, 'Time format'), keywords: 'time format 12 24 am pm' },
        { title: 'Week starts on', desc: 'Calendars and date pickers', control: segmented([['mon', 'Monday'], ['sun', 'Sunday']], s.weekStart ?? 'mon', (v) => { s.weekStart = v; apply(); }, 'Week starts on'), keywords: 'sunday monday calendar week' },
        { heading: 'Numbers' },
        { title: 'Numbers and amounts', desc: `${fmtNumber(1234.5)} · ${fmtNumber(1234.5, 'euro')}`, control: selectControl(NUMBER_LOCALES.map(([v, l]) => [v, l]), NUMBER_LOCALES.some(([v]) => v === ws.meta.locale) ? ws.meta.locale : '', (v) => { ws.meta.locale = v; apply(true).then(redraw); }, 'Number format'), keywords: 'number format decimal comma point thousands currency locale language' },
    ];
    // number formats people use (by language and country)
    const NUMBER_LOCALES = [['', `This computer (${defaultLocale()})`], ['en-US', '1,234.5 (English, US)'], ['en-GB', '1,234.5 (English, UK)'], ['de-DE', '1.234,5 (German)'], ['de-CH', '1’234.5 (Swiss)'], ['fr-FR', '1 234,5 (French)'], ['es-ES', '1234,5 (Spanish)'], ['it-IT', '1.234,5 (Italian)'], ['nl-NL', '1.234,5 (Dutch)'], ['sv-SE', '1 234,5 (Swedish)'], ['ja-JP', '1,234.5 (Japanese)']];
    // ----- colors -----
    let liveQueued = false;
    const liveRender = () => { if (liveQueued)
        return; liveQueued = true; requestAnimationFrame(() => { liveQueued = false; app.render(); }); };
    const colors = () => {
        const cfg = (s.colors ??= {});
        const save = () => { if (!cfg.custom?.length)
            delete cfg.custom; if (cfg.overrides && !Object.keys(cfg.overrides).length)
            delete cfg.overrides; if (!Object.keys(cfg).length)
            delete s.colors; ws.saveSettings(); app.applySettings(); app.render(); };
        // live: everything using the colour (calendar entries, tags, callouts …) follows while you pick
        const picker = (value, label, onInput, original, name) => colorButton({ value, label, original, dot: false, preview: name ? () => preview(name) : undefined, onInput: (c) => { onInput(c); app.applySettings(); liveRender(); }, onDone: () => { save(); redraw(); } });
        const preview = (c) => h('span', { class: 'color-preview' }, h('span', { class: 'tag', style: { background: `var(--c-${c}-strong, ${COLORS[c].tag})` } }, 'Option'), h('span', { 'data-color': c }, 'Text'), h('span', { 'data-color': `${c}_bg` }, 'Highlight'));
        // all colours at once: the same sliders as the background in Appearance
        const tuneSlider = (key, label, min, max, unit) => {
            const v0 = s[key] ?? 0;
            const fmt = (v) => `${v > 0 ? '+' : ''}${v}${unit}`;
            const val = h('span', { class: 'bg-val' }, fmt(v0));
            const r = h('input', { type: 'range', class: 'bg-range', min: String(min), max: String(max), step: '1', value: String(v0), 'aria-label': label });
            r.addEventListener('input', () => { const v = Number(r.value); if (v)
                s[key] = v;
            else
                delete s[key]; val.textContent = fmt(v); app.applySettings(); liveRender(); tuneBox.querySelectorAll('[data-c]').forEach((t) => { t.style.background = COLORS[t.dataset.c].tag; }); });
            r.addEventListener('change', () => ws.saveSettings());
            return h('label', { class: 'bg-slider' }, h('span', { class: 'bg-label' }, label), r, val);
        };
        const tuneBox = h('div', { class: 'bg-controls' }, tuneSlider('colorSat', 'Saturation', -100, 100, '%'), tuneSlider('colorLight', 'Brightness', -20, 20, ''), h('div', { class: 'bg-foot' }, h('span', { class: 'color-preview' }, ...['red', 'orange', 'green', 'blue', 'purple'].map((c) => h('span', { class: 'tag', 'data-c': c, style: { background: COLORS[c].tag } }, c[0].toUpperCase() + c.slice(1))))));
        const swTile = (c) => h('span', { class: 'set-ico-swatch', 'data-swatch': c, style: { background: `var(--c-${c}, ${COLORS[c].text})` } });
        /** one colour per row: the background shade is made from it */
        // you pick what tags show; the stored colour (text) is worked out from it
        const one = (value, label, set, original, name) => picker(value, label, (v) => set(v), original, name);
        const sliderRow = (key, title, min, max, unit) => {
            const v0 = s[key] ?? 0;
            const fmt = (v) => `${v > 0 ? '+' : ''}${v}${unit}`;
            const val = h('span', { class: 'set-slider-val' }, fmt(v0));
            const r = h('input', { type: 'range', class: 'set-slider', min: String(min), max: String(max), step: '1', value: String(v0), 'aria-label': title });
            fillSlider(r);
            r.addEventListener('input', () => { fillSlider(r); const v = Number(r.value); if (v)
                s[key] = v;
            else
                delete s[key]; val.textContent = fmt(v); app.applySettings(); liveRender(); });
            r.addEventListener('change', () => ws.saveSettings());
            return { title, control: h('div', { class: 'set-slider-wrap' }, r, val), keywords: 'saturation brightness lightness all colors global' };
        };
        const items = [
            { heading: 'All colors' },
            sliderRow('colorSat', 'Saturation', -100, 100, ' %'),
            sliderRow('colorLight', 'Brightness', -20, 20, ''),
            (() => {
                // shown as opacity (100 % = solid); stored as how much is taken away
                const op = 100 - (s.colorShade ?? 0);
                const val = h('span', { class: 'set-slider-val' }, `${op} %`);
                const r = h('input', { type: 'range', class: 'set-slider', min: '20', max: '100', step: '1', value: String(op), 'aria-label': 'Shade opacity' });
                fillSlider(r);
                r.addEventListener('input', () => { fillSlider(r); const v = 100 - Number(r.value); if (v)
                    s.colorShade = v;
                else
                    delete s.colorShade; val.textContent = `${r.value} %`; app.applySettings(); liveRender(); });
                r.addEventListener('change', () => ws.saveSettings());
                return { title: 'Shade opacity', desc: 'Tags, callouts, buttons and rows – lower lets the page show through', control: h('div', { class: 'set-slider-wrap' }, r, val), keywords: 'opacity transparent shades fill' };
            })(),
            (() => {
                // contrast: stronger tags, entries, callouts and highlights against the background
                const val = h('span', { class: 'set-slider-val' }, `${s.contrast ?? 0} %`);
                const r = h('input', { type: 'range', class: 'set-slider', min: '0', max: '100', step: '1', value: String(s.contrast ?? 0), 'aria-label': 'Contrast' });
                fillSlider(r);
                r.addEventListener('input', () => { fillSlider(r); s.contrast = Number(r.value) || undefined; val.textContent = `${r.value} %`; app.applySettings(); liveRender(); });
                r.addEventListener('change', () => ws.saveSettings());
                return { title: 'Contrast', desc: 'How far colors stand out from the background', control: h('div', { class: 'set-slider-wrap' }, r, val), keywords: 'contrast colors stronger' };
            })(),
            { heading: 'Built-in colors' }
        ];
        for (const c of BUILTIN_COLORS.filter((x) => x !== 'default')) {
            const o = cfg.overrides?.[c];
            const base = builtinColor(c);
            items.push({ title: colorLabel(c), desc: preview(c), icon: swTile(c), keywords: 'colour palette',
                control: one(o?.text ?? base.text, colorLabel(c), (v) => { ((cfg.overrides ??= {})[c] = { text: v, bg: bgFromColor(v) }); }, base.text, c) });
        }
        items.push({ heading: 'Your colors' });
        for (const c of cfg.custom ?? []) {
            const name = h('input', { type: 'text', class: 'set-input color-name', value: c.name, 'aria-label': 'Color name' });
            name.addEventListener('keydown', (e) => e.stopPropagation());
            name.addEventListener('change', () => { c.name = name.value.trim() || c.name; save(); redraw(); });
            items.push({ title: name, desc: preview(c.id), icon: swTile(c.id), keywords: 'colour palette custom',
                control: h('div', { class: 'color-ctl' }, one(c.text, c.name, (v) => { c.text = v; c.bg = bgFromColor(v); delete c.tags; }, undefined, c.id), moreControl(() => [{ label: 'Delete color', danger: true, run: () => confirmDialog({ title: `Delete “${c.name}”?`, lines: ['Options, text and callouts using it turn to the default color.'], ok: 'Delete', danger: true, onOk: () => { cfg.custom = cfg.custom.filter((x) => x !== c); save(); redraw(); } }) }])) });
        }
        items.push({ action: 'Add a color', keywords: 'colour palette custom', run: () => {
                const id = `c-${Math.random().toString(36).slice(2, 7)}`;
                (cfg.custom ??= []).push({ id, name: `Color ${(cfg.custom?.length ?? 0) + 1}`, text: '#7fc8c0', bg: bgFromColor('#7fc8c0') });
                save();
                redraw();
            } });
        // resets: always the last group of a tab, every button called “Reset”
        items.push({ heading: 'Reset' }, { title: 'All colors', desc: 'Saturation, brightness, shades and contrast back to normal', control: h('button', { class: 'set-btn', disabled: !s.colorSat && !s.colorLight && !s.contrast && !s.colorShade, onclick: () => { delete s.colorSat; delete s.colorLight; delete s.contrast; delete s.colorShade; ws.saveSettings(); app.applySettings(); app.render(); redraw(); } }, 'Reset') }, { title: 'Built-in colors', desc: 'Back to the original colors; yours stay', control: h('button', { class: 'set-btn', disabled: !cfg.overrides || !Object.keys(cfg.overrides).length, onclick: () => { delete cfg.overrides; save(); redraw(); } }, 'Reset') });
        return items;
    };
    // ----- keyboard shortcuts -----
    const record = (btn, done) => {
        btn.classList.add('rec');
        btn.textContent = 'Press keys…';
        const rec = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const k = eventToKey(e);
            if (!k)
                return;
            document.removeEventListener('keydown', rec, true);
            done(k === 'Escape' ? null : k);
        };
        document.addEventListener('keydown', rec, true);
    };
    // built-in shortcuts in groups (anything new lands in "Other")
    const SHORTCUT_GROUPS = [
        ['Editing', ['edit.undo', 'edit.redo', 'page.new', 'database.new', 'quickadd']],
        ['Moving around', ['palette', 'nav.back', 'nav.forward', 'nav.home', 'view.sidebar', 'sidebar.rename', 'settings', 'trash', 'comments', 'history']],
        ['Entries and calendars', ['entries.open', 'entries.duplicate', 'calendar.newOnDay', 'view.today', 'period.prev', 'period.next']],
        ['Workspace', ['workspace.switch', 'workspace.reload', 'workspace.reveal']],
    ];
    const shortcuts = () => {
        const items = [];
        const all = app.keymap.all().filter((x) => !x.id.startsWith('action.') && !x.id.startsWith('jump.'));
        const row = (c) => {
            const btn = h('button', { class: 'key-btn', title: 'Click, then press the new shortcut · Backspace = none · Esc = cancel' }, prettyKey(app.keymap.binding(c.id)) || '—');
            btn.addEventListener('click', () => record(btn, (k) => {
                if (k) {
                    const conflict = app.keymap.all().find((o) => o.id !== c.id && keyAlternatives(app.keymap.binding(o.id)).includes(k));
                    ws.keymap[c.id] = k === 'Backspace' || k === 'Delete' ? '' : k;
                    if (conflict) {
                        ws.keymap[conflict.id] = '';
                        toast(`"${conflict.label}" had this shortcut and is now unassigned`);
                    }
                    ws.saveKeymap();
                    app.render();
                }
                redraw();
            }));
            return { title: c.label, control: btn, keywords: `shortcut key ${c.id}` };
        };
        const placed = new Set();
        for (const [name, ids] of SHORTCUT_GROUPS) {
            const list = ids.map((id) => all.find((c) => c.id === id)).filter((c) => !!c);
            if (!list.length)
                continue;
            items.push({ heading: name });
            for (const c of list) {
                items.push(row(c));
                placed.add(c.id);
            }
        }
        const rest = all.filter((c) => !placed.has(c.id));
        if (rest.length) {
            items.push({ heading: 'Other' });
            rest.forEach((c) => items.push(row(c)));
        }
        items.push({ heading: 'Reset' }, { title: 'All shortcuts', desc: 'Back to the original keys', control: h('button', { class: 'set-btn', disabled: !Object.keys(ws.keymap).length, onclick: () => confirmDialog({ title: 'Reset all shortcuts?', lines: ['Every shortcut goes back to its original keys.'], ok: 'Reset', onOk: () => { for (const k of Object.keys(ws.keymap))
                        delete ws.keymap[k]; ws.saveKeymap(); redraw(); } }) }, 'Reset'), keywords: 'reset shortcuts' });
        return items;
    };
    // ----- custom shortcuts -----
    const saveActs = async () => { await ws.saveSettings(); app.registerActions(); redraw(); };
    const customShortcuts = () => {
        const items = [{ heading: 'Set a property' }];
        for (const a of s.actions ?? []) {
            const btn = h('button', { class: 'key-btn', title: 'Click, then press a new key' }, prettyKey(a.key) || '—');
            btn.addEventListener('click', () => record(btn, (k) => { if (k)
                a.key = k; saveActs(); }));
            items.push({ title: app.describeAction(a), desc: 'On the selected entries or the open entry', keywords: 'custom shortcut', control: h('div', { class: 'color-ctl' }, btn, moreControl(() => [{ label: 'Remove shortcut', danger: true, run: () => { s.actions = (s.actions ?? []).filter((x) => x !== a); saveActs(); } }])) });
        }
        const addProp = (add) => {
            const valueEntries = (db, p) => {
                const pick = (value) => () => {
                    const a = { id: Math.random().toString(36).slice(2, 8), key: '', db: db.key, prop: p.name, value };
                    (s.actions ??= []).push(a);
                    redraw();
                    const btns = document.querySelectorAll('.set-window .key-btn');
                    const btn = btns[btns.length - 1];
                    if (btn)
                        record(btn, (k) => { if (!k) {
                            s.actions = s.actions.filter((x) => x !== a);
                            redraw();
                            return;
                        } a.key = k; saveActs(); });
                };
                if (p.type === 'checkbox')
                    return [{ label: 'Check', run: pick(true) }, { label: 'Uncheck', run: pick(false) }, { label: 'Toggle', run: pick('toggle') }];
                if (p.type === 'date' || p.type === 'created_time')
                    return [{ label: 'Today', run: pick({ start: 'today' }) }, 'sep', { label: 'Clear', run: pick(null) }];
                return [...(p.options ?? []).map((o) => ({ label: o.name, icon: colorDot(o.color), run: pick(o.name) })), 'sep', { label: 'Clear', run: pick(null) }];
            };
            menu(add, [...[...ws.dbs.values()].sort((x, y) => x.schema.name.localeCompare(y.schema.name)).map((db) => ({
                    label: db.schema.name, icon: renderIcon(db.schema.icon, 16, 'database'),
                    sub: () => {
                        const props = db.schema.properties.filter((p) => ['select', 'multi_select', 'checkbox', 'date'].includes(p.type));
                        return props.length ? props.map((p) => ({ label: p.name, icon: typeIcon(p.type), sub: () => valueEntries(db, p) })) : [{ label: 'No select, checkbox or date properties', run: () => { } }];
                    },
                }))], { filter: true });
        };
        items.push({ action: 'Add… (database, property, value, then the key)', run: addProp, keywords: 'add custom shortcut property' });
        // buttons and opening pages / databases
        items.push({ heading: 'Open or run' });
        for (const j of s.jumps ?? []) {
            const btn = h('button', { class: 'key-btn', title: 'Click, then press a new key' }, prettyKey(j.key) || '—');
            btn.addEventListener('click', () => record(btn, (k) => { if (k)
                j.key = k; void saveActs(); }));
            items.push({ title: app.describeJump(j), keywords: 'custom shortcut button page favorite open', control: h('div', { class: 'color-ctl' }, btn, moreControl(() => [{ label: 'Remove shortcut', danger: true, run: () => { s.jumps = (s.jumps ?? []).filter((x) => x !== j); if (!s.jumps.length)
                            delete s.jumps; void saveActs(); } }])) });
        }
        const startJump = (j) => {
            (s.jumps ??= []).push(j);
            redraw();
            const btns = document.querySelectorAll('.set-window .key-btn');
            const btn = btns[btns.length - 1];
            if (btn)
                record(btn, (k) => { if (!k) {
                    s.jumps = s.jumps.filter((x) => x !== j);
                    redraw();
                    return;
                } j.key = k; void saveActs(); });
        };
        const addJumpMenu = (addJump) => {
            const nid = () => Math.random().toString(36).slice(2, 8);
            const buttons = [];
            for (const pg of ws.pages.values()) {
                const list = [];
                const walk = (arr) => { for (const b of arr) {
                    if (b.type === 'button')
                        list.push(b);
                    if (b.children)
                        walk(b.children);
                } };
                walk(pg.blocks);
                if (list.length)
                    buttons.push({ label: pg.title, icon: renderIcon(pg.icon, 16), sub: () => list.map((b) => ({ label: b.text || 'Button', icon: b.icon ? renderIcon(b.icon, 15) : undefined, run: () => startJump({ id: nid(), key: '', button: { page: pg.id, block: b.id, label: b.text ?? '' } }) })) });
            }
            const favs = s.favorites.map((id) => id.startsWith('db:') ? (ws.dbs.has(id.slice(3)) ? id : null) : ws.pages.has(id) ? id : null).filter(Boolean);
            const label = (id) => id.startsWith('db:') ? ws.dbs.get(id.slice(3)).schema.name : ws.pages.get(id).title;
            const icon = (id) => id.startsWith('db:') ? renderIcon(ws.dbs.get(id.slice(3)).schema.icon, 16, 'database') : renderIcon(ws.pages.get(id).icon, 16);
            menu(addJump, [
                { label: 'Run a button', icon: iconSvg('mouse-pointer', 16), sub: () => buttons.length ? buttons : [{ label: 'No buttons yet', run: () => { } }] },
                'sep',
                { section: 'Open a favorite' },
                ...favs.map((id) => ({ label: label(id), icon: icon(id), run: () => startJump({ id: nid(), key: '', open: id }) })),
                { label: 'Open another page', icon: iconSvg('file', 16), subFilter: true, sub: () => pickEntries(pageItems(ws), (id) => startJump({ id: nid(), key: '', open: id })) },
                { label: 'Open a database', icon: iconSvg('database', 16), subFilter: true, sub: () => pickEntries(dbItems(ws), (k) => startJump({ id: nid(), key: '', open: `db:${k}` })) },
            ]);
        };
        items.push({ action: 'Add… (a button, page or database)', run: addJumpMenu, keywords: 'add custom shortcut button page' });
        return items;
    };
    const sections = [
        { id: 'general', group: 'Workspace', label: document.documentElement.classList.contains('phone') ? 'Workspace' : 'General', icon: 'settings', summary: () => ws.meta.name, card: () => ws.storage.remote ? 'Saved in Dropbox' : 'Saved on this device', subtitle: 'This workspace’s name and where it is saved.', items: general },
        { id: 'notifications', group: 'Workspace', label: 'Notifications', icon: 'bell', subtitle: 'Reminders and what needs you – inside Nook, on every device.', items: () => [
                { heading: 'Reminders' },
                { title: 'Default for entries with a time', desc: 'For entries without a reminder of their own', control: selectControl([['none', 'None'], ...REMIND_TIMED.map(([m, l]) => [String(m), l])], s.remindTimed === undefined ? 'none' : String(s.remindTimed), (v) => { if (v === 'none')
                        delete s.remindTimed;
                    else
                        s.remindTimed = Number(v); void ws.saveSettings(); }, 'Default'), keywords: 'reminder default notification time' },
                { title: 'Default for all-day entries', desc: 'For entries without a time and without a reminder of their own', control: selectControl([['none', 'None'], ...REMIND_DAY.map(([m, l]) => [String(m), l])], s.remindDay === undefined ? 'none' : String(s.remindDay), (v) => { if (v === 'none')
                        delete s.remindDay;
                    else
                        s.remindDay = Number(v); void ws.saveSettings(); }, 'Default'), keywords: 'reminder default notification all-day' },
                { title: 'Missed while away', desc: 'Reminders that came due while Nook was closed are shown from the last …', control: selectControl([['2', '2 hours'], ['24', '24 hours'], ['72', '3 days'], ['168', '1 week']], String(s.remindMissed ?? 24), (v) => { s.remindMissed = Number(v) === 24 ? undefined : Number(v); void ws.saveSettings(); }, 'Missed'), keywords: 'reminder missed away closed' },
                { title: 'Ping when a reminder goes off', desc: 'A small soft sound', control: switchControl(s.notifySound !== false, (on) => { s.notifySound = on ? undefined : false; void ws.saveSettings(); }, 'Ping'), keywords: 'sound ping reminder notification audio' },
                { heading: 'Also listed' },
                { title: 'Sync problems', desc: 'Conflicts and changes not saved to Dropbox yet – shown under Notifications and counted in the red number', control: switchControl(s.notifySync !== false, (on) => { s.notifySync = on ? undefined : false; void ws.saveSettings(); app.notes.paint(); }, 'Sync problems'), keywords: 'conflict sync dropbox unsaved notifications' },
                { title: 'Missing files', desc: 'Pages and entries that point at files which are gone', control: switchControl(s.notifyMissing !== false, (on) => { s.notifyMissing = on ? undefined : false; void ws.saveSettings(); app.notes.paint(); }, 'Missing files'), keywords: 'missing files notifications' },
            ] },
        { id: 'behaviour', group: 'Workspace', label: 'Navigation', icon: 'compass', subtitle: 'How you move between pages and open entries.', items: behaviour },
        { id: 'appearance', group: 'Look', label: 'Appearance', icon: 'palette', subtitle: 'Theme, text and layout.', summary: () => ({ light: 'Light', dark: 'Dark', system: 'Auto' }[s.theme ?? 'dark'] ?? ''), items: appearance },
        { id: 'dates', group: 'Look', label: 'Dates & numbers', icon: 'calendar', subtitle: 'How dates, times and numbers are written.', items: dates },
        { id: 'colors', group: 'Look', label: 'Colors', icon: 'circle-dot', subtitle: 'The colors of options, text, highlights and callouts.', items: colors },
        { id: 'widgets', group: 'Content', label: 'Widgets', icon: 'puzzle', summary: () => { const n = customWidgets().length; return n ? String(n) : ''; }, subtitle: 'Small blocks like timers and notes, added with “/”.', items: () => {
                const own = customWidgets();
                const pick = () => {
                    const inp = h('input', { type: 'file', accept: '.js,text/javascript', multiple: true });
                    inp.onchange = async () => {
                        let errs = [];
                        for (const f of Array.from(inp.files ?? []))
                            errs = await installWidget(app.ws, f.name, await f.text());
                        toast(errs.length ? `Problem: ${errs.join(' · ')}` : 'Widget added – find it in “/” → Widgets', errs.length ? 8000 : 3000);
                        app.render();
                        win?.refresh();
                    };
                    inp.click();
                };
                const builtIn = allWidgets().filter((w) => !w.custom);
                return [
                    { heading: 'Your widgets' },
                    ...own.map((w) => ({ title: w.name, desc: [w.custom, w.description].filter(Boolean).join(' · '), icon: w.icon, keywords: 'widget custom',
                        control: moreControl(() => [
                            { label: 'Export file', icon: iconSvg('download', 16), run: async () => { const code = await app.ws.storage.read(`${WIDGET_DIR}/${w.custom}`); void saveFile({ name: w.custom, blob: new Blob([code], { type: 'text/javascript' }) }); } },
                            'sep',
                            { label: 'Remove', danger: true, run: () => confirmDialog({ title: `Remove “${w.name}”?`, lines: ['Its widgets on your pages show “not installed” until you add the file again. Their content is kept.'], ok: 'Remove', danger: true, onOk: async () => { await removeWidgetFile(app.ws, w.custom); app.render(); win?.refresh(); } }) },
                        ]) })),
                    { action: 'Add a widget file…', run: () => pick(), keywords: 'import widget install add file' },
                    { heading: 'Make one with AI', control: own.length ? h('button', { class: 'set-btn', title: 'After you changed a widget file in the folder yourself', onclick: async () => { const e = await loadCustomWidgets(app.ws); toast(e.length ? `Problem: ${e.join(' · ')}` : 'Widgets reloaded', e.length ? 8000 : 2000); app.render(); win?.refresh(); } }, 'Reload files') : undefined },
                    { title: 'Copy the prompt', desc: 'Paste it into a chat AI, describe the widget, save the answer as .js', icon: 'sparkles', control: h('button', { class: 'set-btn primary', onclick: async () => { await navigator.clipboard.writeText(WIDGET_PROMPT); toast('Prompt copied – paste it into an AI chat'); } }, 'Copy prompt'), keywords: 'ai chatgpt claude prompt widget' },
                    { title: 'Only add files you trust', desc: 'Widgets run inside Nook', icon: 'info', value: WIDGET_DIR, keywords: 'folder trust security' },
                    { heading: 'Built in' },
                    { title: '', wide: h('div', { class: 'wset-grid' }, builtIn.map((w) => h('div', { class: 'wset-card' }, h('span', { class: 'set-ico' }, iconSvg(w.icon, 16)), h('span', { class: 'wset-card-txt' }, h('b', null, w.name), h('span', null, w.description ?? ''))))), keywords: builtIn.map((w) => w.name).join(' ') },
                ];
            } },
        { id: 'shortcuts', group: 'Keyboard', desktopOnly: true, label: 'Shortcuts', icon: 'key', subtitle: 'Click a shortcut, then press the new keys.', items: shortcuts },
        { id: 'custom-shortcuts', group: 'Keyboard', desktopOnly: true, label: 'Your shortcuts', icon: 'zap', subtitle: 'One key that sets a property, runs a button or opens a page.', items: customShortcuts },
        calendarSection(() => app.ws, () => win?.refresh()),
        sourcesSection(() => app.ws, () => win?.refresh(), () => win?.close()),
        { id: 'import', group: 'Data', label: 'Import', icon: 'arrow-down', subtitle: 'Bring content from other apps.', items: () => [
                { heading: 'From other apps' },
                { title: 'Notion', desc: 'Its Markdown & CSV export, with subpages. Notion stays unchanged.', icon: 'file', control: h('button', { class: 'set-btn primary', onclick: () => { win?.close(); app.shell.importNotion?.(); } }, 'Import…'), keywords: 'notion export import' },
                { title: 'CSV file', desc: 'A table from any app (contacts, Excel, Numbers …) as a new database – columns become properties of the right type.', icon: 'table', control: h('button', { class: 'set-btn primary', onclick: () => { win?.close(); app.importCsvFile(); } }, 'Import…'), keywords: 'csv import table contacts excel spreadsheet' },
            ] },
        { id: 'export', group: 'Data', label: 'Export & backup', icon: 'arrow-up', subtitle: 'Take your content with you.', items: () => [
                { heading: 'Export' },
                { title: 'Everything', desc: 'Markdown & CSV with files, as one .zip – for Notion, Obsidian …', keywords: 'export notion markdown csv zip obsidian',
                    control: h('button', { class: 'set-btn primary', onclick: () => void app.runExport(() => exportWorkspace(app.ws)) }, 'Export') },
                { title: 'One page or database', desc: 'In its ⋯ menu → Export', value: 'Markdown · HTML · CSV · PDF', keywords: 'export page pdf html print' },
                { heading: 'Backup' },
                { title: 'Workspace folder', desc: 'Exactly as saved, as .zip – opens again in Nook', keywords: 'backup zip copy',
                    control: h('button', { class: 'set-btn', onclick: () => void app.runExport(() => exportRaw(app.ws)) }, 'Download') },
            ] },
        { id: 'files', group: 'Data', label: 'Files', icon: 'folder', subtitle: 'Images and files in the workspace.', items: files },
        // phone: what used to sit under Pages → Workspace lives here now
        ...(document.documentElement.classList.contains('phone') ? [
            { id: 'switchws', group: 'More', label: 'Switch workspace', icon: 'layers', summary: () => ws.meta.name, items: () => [], run: () => { const b = document.querySelector('.pset-row:last-child') ?? document.body; app.shell.workspaceMenu(b); } },
        ] : []),
        { id: 'about', group: '', label: `About ${APP.name}`, icon: 'info', subtitle: 'Pages, databases and calendars as plain files in a folder you own.', items: about },
    ];
    // the tabs in their groups: Workspace, Look, Content, Keyboard, Data, then About on its own
    const ORDER = ['Workspace', 'Look', 'Content', 'Keyboard', 'Data', 'More', ''];
    const LOOK = ['appearance', 'colors', 'dates'];
    sections.sort((x, y) => ORDER.indexOf(x.group) - ORDER.indexOf(y.group) || (x.group === 'Look' ? LOOK.indexOf(x.id) - LOOK.indexOf(y.id) : 0));
    // a phone has no keyboard shortcuts, no window to size, no sidebar to keep open and opens with one tap
    if (document.documentElement.classList.contains('phone')) {
        const skip = new Set(['Show sidebar at start', 'Workspace bar when hidden', 'Open entries with', 'Size', 'Page width', 'Blur behind windows']);
        for (let i = sections.length - 1; i >= 0; i--) {
            const sec = sections[i];
            if (sec.id === 'shortcuts' || sec.id === 'custom-shortcuts') {
                sections.splice(i, 1);
                continue;
            }
            const all = sec.items;
            sec.items = () => {
                const kept = all().filter((it) => !('title' in it && typeof it.title === 'string' && skip.has(it.title)));
                // a heading whose settings are all gone goes too
                return kept.filter((it, n) => !('heading' in it && it.heading) || (kept[n + 1] !== undefined && !('heading' in kept[n + 1] && kept[n + 1].heading)));
            };
        }
    }
    win = openSettingsWindow(sections, start);
    app.settingsWin = win;
    // sync status changes while the window is open (e.g. "Syncing…" → "Synced just now")
    const off = calendars.onStatus(() => { if (document.querySelector('.set-window'))
        win?.refresh();
    else
        off(); });
}
/** the coloured part of a slider follows its value */
function fillSlider(r) { const p = ((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100; r.style.setProperty('--p', `${p}%`); }
/** what the phone reports about its screen – for sorting out a layout that does not fit (About → This screen) */
function screenFacts() {
    const probe = (css) => { const d = document.body.appendChild(document.createElement('div')); d.style.cssText = `position:fixed;top:0;left:0;width:0;visibility:hidden;height:${css}`; const v = d.offsetHeight; d.remove(); return v; };
    const nav = navigator;
    const vv = window.visualViewport;
    return [
        `screen ${screen.width}×${screen.height} (avail ${screen.availHeight})`,
        `window ${innerWidth}×${innerHeight}`, `page ${document.documentElement.clientHeight}`, `body ${document.body.offsetHeight}`,
        `visible ${vv ? Math.round(vv.height) : '–'}`,
        `lvh ${probe('100lvh')} · svh ${probe('100svh')} · dvh ${probe('100dvh')} · vh ${probe('100vh')}`,
        `safe area ${probe('env(safe-area-inset-top)')} / ${probe('env(safe-area-inset-bottom)')}`,
        `home-screen app: ${nav.standalone === true || matchMedia('(display-mode: standalone)').matches ? 'yes' : 'no'}${document.documentElement.classList.contains('fullscreen') ? ' · under the status bar' : ''}`,
    ].join(' · ');
}
//# sourceMappingURL=settingsdialog.js.map