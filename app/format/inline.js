// Inline markdown <-> HTML for rich text inside blocks.
// Supported: **bold**, *italic*, `code`, ~~strike~~, <u>underline</u>, [link](url),
// <span color="red">x</span> (text colour), <span color="yellow_bg">x</span> (highlight) and
// <mark comment="id">x</mark> (text with a comment; the comment itself is in comments/<page>.json)
import { escapeHtml } from '../util.js';
export function inlineToHtml(md) {
    let s = escapeHtml(md);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
    s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, u) => {
        const safe = /^(https?:|mailto:|#|nook:)/.test(u) ? u : '#';
        return `<a href="${safe}" target="_blank" rel="noopener" title="${safe === '#' ? '' : safe.replace(/"/g, '&quot;')} · click to open">${t}</a>`;
    });
    s = s.replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/g, '<u>$1</u>');
    s = s.replace(/&lt;span color=&quot;([a-z_]+)&quot;&gt;(.*?)&lt;\/span&gt;/g, '<span data-color="$1">$2</span>');
    s = s.replace(/&lt;mark comment=&quot;([A-Za-z0-9_-]+)&quot;&gt;(.*?)&lt;\/mark&gt;/g, '<mark class="cmt" data-comment="$1">$2</mark>');
    return s.replace(/\n/g, '<br>');
}
/** Convert the contenteditable DOM back to inline markdown. */
export function htmlToInline(root) {
    let out = '';
    for (const n of Array.from(root.childNodes))
        out += nodeToMd(n);
    return out.replace(/ /g, ' ').replace(/\n+$/, '');
}
function nodeToMd(n) {
    if (n.nodeType === Node.TEXT_NODE)
        return n.textContent ?? '';
    if (n.nodeType !== Node.ELEMENT_NODE)
        return '';
    const el = n;
    const inner = htmlToInline(el);
    switch (el.tagName) {
        case 'B':
        case 'STRONG': return inner.trim() ? `**${inner}**` : inner;
        case 'I':
        case 'EM': return inner.trim() ? `*${inner}*` : inner;
        case 'S':
        case 'STRIKE':
        case 'DEL': return inner.trim() ? `~~${inner}~~` : inner;
        case 'U': return inner.trim() ? `<u>${inner}</u>` : inner;
        case 'CODE': return `\`${inner}\``;
        case 'A': return `[${inner}](${el.getAttribute('href') ?? ''})`;
        case 'MARK': return el.dataset.comment && inner ? `<mark comment="${el.dataset.comment}">${inner}</mark>` : inner;
        case 'BR': return '\n';
        case 'DIV':
        case 'P': return '\n' + inner;
        case 'SPAN': {
            const c = el.dataset.color;
            return c ? `<span color="${c}">${inner}</span>` : inner;
        }
        default: return inner;
    }
}
export function plainText(md) {
    return md.replace(/\*\*|~~|`/g, '').replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<\/?(span|u|mark)[^>]*>/g, '');
}
//# sourceMappingURL=inline.js.map