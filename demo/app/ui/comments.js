// Comments on a piece of text: select text → Comment (format bar, or ⌘⌥M / Ctrl+Alt+M).
// The text gets a <mark comment="id">; the comment itself (text, dates, done) lives in
// comments/<page or entry>.json, so the page's markdown stays readable.
// Click the marked text to read, edit, resolve or delete the comment.
import { h, svgIcon, ICONS, unwrapEl } from '../util.js';
import { iconSvg } from './icons.js';
import { when } from './keep.js';
import { openPop } from './pop.js';
const now = () => new Date().toISOString().slice(0, 19);
export function input(initial, placeholder, onSave, onCancel) {
    const ta = h('textarea', { class: 'comment-input', rows: 1, placeholder, 'aria-label': placeholder });
    ta.value = initial;
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(240, ta.scrollHeight)}px`; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSave(ta.value.trim());
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    });
    requestAnimationFrame(() => { grow(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    return ta;
}
/** A new comment on the text in `mark` (just wrapped). `sync` writes the text back to the page. */
export function newTextComment(ws, path, mark, sync) {
    let saved = false;
    let close = () => { };
    const ta = input('', 'Add a comment… (↵ to save)', async (t) => {
        if (!t) {
            close();
            return;
        }
        saved = true;
        const list = await ws.comments(path);
        list.push({ id: mark.dataset.comment, text: t, created: now(), quote: (mark.textContent ?? '').slice(0, 200) });
        await ws.saveComments(path, list);
        close();
    }, () => close());
    mark.classList.add('active');
    close = openPop(mark, h('div', { class: 'cmt-pop' }, h('div', { class: 'cmt-quote' }, mark.textContent ?? ''), ta), () => {
        mark.classList.remove('active');
        if (!saved)
            unwrapEl(mark);
        sync();
    });
}
/** The comment on a marked piece of text: read, edit, resolve, delete. */
export async function openTextComment(ws, path, mark, sync, readonly = false) {
    const id = mark.dataset.comment;
    let list = await ws.comments(path);
    const c = list.find((x) => x.id === id);
    const box = h('div', { class: 'cmt-pop' });
    let close = () => { };
    const remove = async (keep) => {
        list = await ws.comments(path);
        const cur = list.find((x) => x.id === id);
        if (cur && keep) {
            cur.done = true;
            cur.edited = now();
        }
        await ws.saveComments(path, keep ? list : list.filter((x) => x.id !== id));
        unwrapEl(mark);
        sync();
        close();
    };
    const draw = () => {
        box.textContent = '';
        if (!c) {
            box.append(h('div', { class: 'cmt-text muted' }, 'This comment was not found (deleted elsewhere?).'));
            if (!readonly)
                box.append(h('div', { class: 'cmt-foot' }, h('button', { class: 'vtool', onclick: () => remove(false) }, 'Remove highlight')));
            return;
        }
        const text = h('div', { class: 'cmt-text', title: readonly ? '' : 'Click to edit' }, c.text);
        const edit = () => {
            const ta = input(c.text, 'Edit comment', async (t) => {
                if (!t) {
                    draw();
                    return;
                }
                list = await ws.comments(path);
                const cur = list.find((x) => x.id === id);
                if (cur) {
                    cur.text = t;
                    cur.edited = now();
                    c.text = t;
                    c.edited = cur.edited;
                    await ws.saveComments(path, list);
                }
                draw();
            }, () => draw());
            text.replaceWith(ta);
        };
        if (!readonly)
            text.addEventListener('click', edit);
        box.append(h('div', { class: 'cmt-quote' }, mark.textContent ?? ''), text, h('div', { class: 'cmt-foot' }, h('span', { class: 'cmt-meta' }, `${when(c.created)}${c.edited ? ' · edited' : ''}`), readonly ? null : h('span', { class: 'cmt-actions' }, h('button', { class: 'icon-btn', 'aria-label': 'Edit comment', title: 'Edit', onclick: edit }, iconSvg('pencil', 14)), h('button', { class: 'icon-btn', 'aria-label': 'Resolve comment', title: 'Resolve (removes the highlight, keeps the comment in the list)', onclick: () => remove(true) }, iconSvg('check-circle', 15)), h('button', { class: 'icon-btn', 'aria-label': 'Delete comment', title: 'Delete', onclick: () => remove(false) }, svgIcon(ICONS.trash, 14)))));
    };
    draw();
    mark.classList.add('active');
    close = openPop(mark, box, () => mark.classList.remove('active'));
}
//# sourceMappingURL=comments.js.map