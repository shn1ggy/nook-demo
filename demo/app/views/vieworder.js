const MIME = 'text/x-nook-view';
export function viewDrag(el, id, db, done, axis = 'y') {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => { e.stopPropagation(); e.dataTransfer.setData(MIME, `${db.key}:${id}`); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    const side = (e) => { const r = el.getBoundingClientRect(); return axis === 'x' ? e.clientX >= r.left + r.width / 2 : e.clientY >= r.top + r.height / 2; };
    el.addEventListener('dragover', (e) => {
        if (!e.dataTransfer?.types.includes(MIME))
            return;
        e.preventDefault();
        e.stopPropagation();
        const after = side(e);
        el.classList.toggle('drop-before', !after);
        el.classList.toggle('drop-after', after);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
    el.addEventListener('drop', (e) => {
        const data = e.dataTransfer?.getData(MIME) ?? '';
        const after = el.classList.contains('drop-after');
        el.classList.remove('drop-before', 'drop-after');
        const [key, from] = data.split(':');
        if (key !== db.key || !from || from === id)
            return;
        e.preventDefault();
        e.stopPropagation();
        const moving = db.views.find((v) => v.id === from);
        if (!moving)
            return;
        const rest = db.views.filter((v) => v.id !== from);
        rest.splice(rest.findIndex((v) => v.id === id) + (after ? 1 : 0), 0, moving);
        db.views = rest;
        done();
    });
}
//# sourceMappingURL=vieworder.js.map