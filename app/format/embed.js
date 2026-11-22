// Which links can be shown embedded (an iframe), and the address to embed.
export function embedUrl(url) {
    let u;
    try {
        u = new URL(url);
    }
    catch {
        return null;
    }
    // only other websites over https: never a script address, never Nook itself (an embedded copy of Nook could act as the user)
    if (u.protocol !== 'https:' || (typeof location !== 'undefined' && u.host === location.host))
        return null;
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' && u.searchParams.get('v'))
        return `https://www.youtube-nocookie.com/embed/${u.searchParams.get('v')}`;
    if (host === 'youtu.be')
        return `https://www.youtube-nocookie.com/embed${u.pathname}`;
    if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname))
        return `https://player.vimeo.com/video${u.pathname.match(/^\/\d+/)[0]}`;
    if (host === 'open.spotify.com' && !u.pathname.startsWith('/embed'))
        return `https://open.spotify.com/embed${u.pathname}`;
    if (host === 'loom.com' && u.pathname.startsWith('/share/'))
        return `https://www.loom.com/embed/${u.pathname.slice(7)}`;
    if (host === 'figma.com')
        return `https://www.figma.com/embed?embed_host=nook&url=${encodeURIComponent(url)}`;
    if (host === 'google.com' && u.pathname.startsWith('/maps'))
        return `https://maps.google.com/maps?q=${encodeURIComponent(url)}&output=embed`;
    // already an embed address (Miro live-embed, widgets, players …)
    if (/\/(live-)?embed\b|\/widgets?\/|player\./.test(url))
        return url;
    return null;
}
/** "notion.so" → readable site name for bookmark cards */
export function siteName(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    }
    catch {
        return url;
    }
}
//# sourceMappingURL=embed.js.map