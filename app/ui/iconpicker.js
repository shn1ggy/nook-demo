// Icon picker: library icons (with colour) or emoji, with search. Returns the stored form
// ("i:name[:color]", an emoji, or undefined for "remove").
import { h, COLORS, colorLabel } from '../util.js';
import { ICON_LIB, iconColor, iconSvg, parseIcon } from './icons.js';
import { openPop, closePop } from './pop.js';
const EMOJI = ('📄 📝 📓 📔 📒 📚 📖 🗂️ 📁 🗃️ 📦 📌 📍 🔖 🏷️ ✅ ☑️ ✔️ ⭐ 🌟 ✨ 💡 🔥 ⚡ 🎯 🚀 🏆 🎉 🎁 ❤️ 💙 💚 💛 🧡 💜 🖤 ' +
    '🏠 🏡 🏢 🏫 🎓 💼 💰 💶 💵 💳 🧾 📈 📉 📊 🏦 🛒 🛍️ 🍕 🍔 🍝 🥗 🍎 ☕ 🍺 🍷 🎬 🎥 📽️ 🎞️ 📷 📸 🎙️ 🎧 🎵 🎨 🖌️ ✂️ ' +
    '💻 🖥️ 📱 ⌨️ 🖱️ 🔧 🔨 ⚙️ 🔒 🔑 📅 📆 🗓️ ⏰ ⏳ 🔔 📣 💬 ✉️ 📧 📞 🌍 🗺️ ✈️ 🚆 🚗 🚲 🏖️ ⛰️ 🌲 🌸 🌞 🌙 ☁️ 🌧️ ❄️ ' +
    '🐶 🐱 🧠 💪 🏃 🧘 ⚽ 🎮 🎲 🧩 📺 🎭 🎤 🎸 🎹 👤 👥 👋 🙂 😊 😎 🤔 😴 🙏').split(' ');
export function pickIcon(anchor, current, onPick) {
    const cur = parseIcon(current);
    let tab = current && !cur ? 'emoji' : 'icons';
    let color = cur?.color ?? 'default';
    let q = '';
    const done = (v) => { closePop(); onPick(v); };
    const box = h('div', { class: 'iconpick' });
    const tabs = h('div', { class: 'iconpick-tabs' });
    const search = h('input', { class: 'pop-input', placeholder: 'Search icons…' });
    const colors = h('div', { class: 'iconpick-colors' });
    const grid = h('div', { class: 'iconpick-grid' });
    const draw = () => {
        tabs.textContent = '';
        tabs.append(h('button', { class: 'vtab' + (tab === 'icons' ? ' on' : ''), onclick: () => { tab = 'icons'; draw(); } }, 'Icons'), h('button', { class: 'vtab' + (tab === 'emoji' ? ' on' : ''), onclick: () => { tab = 'emoji'; draw(); } }, 'Emoji'), h('span', { style: { flex: '1' } }), h('button', { class: 'vtab', onclick: () => done(undefined) }, 'Remove'));
        search.placeholder = tab === 'icons' ? 'Search icons…' : 'Type or paste any emoji, Enter to use';
        colors.textContent = '';
        colors.style.display = tab === 'icons' ? '' : 'none';
        // "Default" follows the text around it (grey in the sidebar); "White" is always white
        for (const c of ['default', 'white', ...Object.keys(COLORS).filter((x) => x !== 'default')]) {
            colors.appendChild(h('button', {
                class: 'iconpick-color' + (c === color ? ' on' : '') + (c === 'default' ? ' auto' : ''), title: c === 'default' ? 'Default (like the text)' : c === 'white' ? 'White' : colorLabel(c), 'aria-label': `Color ${c}`,
                style: { background: c === 'default' ? 'linear-gradient(135deg, var(--fg) 50%, var(--fg-muted) 50%)' : iconColor(c) },
                onclick: () => {
                    color = c;
                    // recolour the current icon right away (the picker stays open)
                    if (cur && tab === 'icons') {
                        cur.color = c;
                        onPick(`i:${cur.name}${c === 'default' ? '' : ':' + c}`);
                    }
                    draw();
                },
            }));
        }
        grid.textContent = '';
        const tint = iconColor(color);
        if (tab === 'icons') {
            const words = q.toLowerCase().split(/\s+/).filter(Boolean);
            for (const [name, [, tags]] of Object.entries(ICON_LIB)) {
                const hay = `${name} ${tags}`;
                if (words.length && !words.every((w) => hay.includes(w)))
                    continue;
                grid.appendChild(h('button', {
                    class: 'iconpick-cell' + (cur?.name === name ? ' on' : ''), title: name, 'aria-label': name,
                    onclick: () => done(`i:${name}${color === 'default' ? '' : ':' + color}`),
                }, iconSvg(name, 20, tint)));
            }
        }
        else {
            for (const e of EMOJI)
                grid.appendChild(h('button', { class: 'iconpick-cell emoji', onclick: () => done(e) }, e));
        }
        if (!grid.children.length)
            grid.appendChild(h('div', { class: 'muted small', style: { gridColumn: '1 / -1', padding: '8px' } }, 'No icons found.'));
    };
    search.addEventListener('input', () => { q = search.value; if (tab === 'icons')
        draw(); });
    search.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter')
            return;
        e.preventDefault();
        if (tab === 'emoji' && search.value.trim())
            done(search.value.trim());
        else
            grid.querySelector('.iconpick-cell')?.click();
    });
    box.append(tabs, search, colors, grid);
    draw();
    openPop(anchor, box);
    search.focus();
}
//# sourceMappingURL=iconpicker.js.map