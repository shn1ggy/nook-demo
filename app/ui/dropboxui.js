// Dropbox on the start screen: connecting the account (with the app key, once per device) and
// choosing the workspace folder in Dropbox.
import { h } from '../util.js';
import { wcard, wrow } from './win.js';
import { dialog, prompt, toast } from './pop.js';
import { appKey, setAppKey, dropboxLogin, dropboxFolders, dropboxIsWorkspace, dropboxCreateFolder } from '../storage/dropbox.js';
/** goes to Dropbox's login (asks for the app key first if this copy of Nook has none) */
export function connectDropbox() {
    if (appKey()) {
        dropboxLogin().catch((e) => toast(e.message, 5000));
        return;
    }
    const input = h('input', { class: 'field', placeholder: 'App key', 'aria-label': 'Dropbox app key', autocomplete: 'off', spellcheck: 'false' });
    const go = () => { const k = input.value.trim(); if (!k) {
        input.focus();
        return;
    } setAppKey(k); close(); dropboxLogin().catch((e) => toast(e.message, 5000)); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter')
        go(); });
    input.className = 'set-input';
    const close = dialog(h('div', { class: 'bwindow' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px' } }, 'Connect Dropbox')), h('div', { class: 'dialog-body bwin' }, wcard(null, wrow('Your Dropbox app', input, 'dropbox.com/developers → your app → Settings · kept on this device', 'stack'))), h('div', { class: 'bfooter' }, h('button', { class: 'set-btn', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn-new', onclick: go }, 'Continue to Dropbox'))));
    setTimeout(() => input.focus(), 30);
}
/** Nook's folder browser for Dropbox; resolves with the chosen folder ("/Apps/Nook", say) or null */
export function chooseDropboxFolder() {
    return new Promise((done) => {
        let cur = '';
        let finished = false;
        let token = 0;
        const pathEl = h('div', { class: 'fb-path set-input' });
        const list = h('div', { class: 'fb-list set-card' });
        const note = h('div', { class: 'fb-note' });
        const newBtn = h('button', { class: 'set-row set-add fb-new' }, '+  New folder');
        const chooseBtn = h('button', { class: 'btn-new' }, 'Open this folder');
        const go = async (p) => {
            const mine = ++token;
            cur = p;
            pathEl.textContent = p || 'Dropbox';
            list.replaceChildren(h('div', { class: 'fb-empty' }, 'Loading…'));
            note.textContent = '';
            try {
                const [dirs, isWs] = await Promise.all([dropboxFolders(p), p ? dropboxIsWorkspace(p) : Promise.resolve(false)]);
                if (mine !== token)
                    return;
                list.textContent = '';
                if (p)
                    list.appendChild(h('button', { class: 'set-row fb-row fb-up', onclick: () => go(p.slice(0, p.lastIndexOf('/'))) }, '↑  Up'));
                for (const d of dirs)
                    list.appendChild(h('button', { class: 'set-row fb-row', onclick: () => go(d.path) }, h('span', { class: 'set-title' }, d.name), h('span', { class: 'fb-chev' }, '›')));
                if (!dirs.length)
                    list.appendChild(h('div', { class: 'set-row fb-empty' }, 'No folders'));
                list.appendChild(newBtn);
                note.textContent = '';
                if (isWs)
                    pathEl.appendChild(h('span', { class: 'fb-tag' }, 'Workspace'));
                const nm = p.slice(p.lastIndexOf('/') + 1);
                chooseBtn.textContent = p ? `Open “${nm}”` : 'Open';
                chooseBtn.disabled = !p;
            }
            catch (e) {
                if (mine === token) {
                    list.textContent = '';
                    note.textContent = e.message;
                }
            }
        };
        const finish = (v) => { if (finished)
            return; finished = true; close(); done(v); };
        chooseBtn.addEventListener('click', () => finish(cur || null));
        newBtn.addEventListener('click', () => prompt(newBtn, 'New folder name', '', async (n) => {
            n = n.trim().replace(/[\\/]/g, '');
            if (!n)
                return;
            try {
                await dropboxCreateFolder(`${cur}/${n}`);
                go(`${cur}/${n}`);
            }
            catch (e) {
                toast(e.message, 4000);
            }
        }));
        const close = dialog(h('div', { class: 'fb-box' }, h('div', { class: 'dialog-head' }, h('strong', { style: { padding: '0 6px' } }, 'Choose a folder in Dropbox')), h('div', { class: 'dialog-body bwin fb-body' }, pathEl, list, note), h('div', { class: 'bfooter' }, h('button', { class: 'set-btn', onclick: () => finish(null) }, 'Cancel'), chooseBtn)), { onClose: () => { if (!finished) {
                finished = true;
                done(null);
            } } });
        go('');
    });
}
//# sourceMappingURL=dropboxui.js.map