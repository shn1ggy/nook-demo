// PDFs: Dropbox hands files out as downloads, so a PDF is fetched and marked as one before it is shown.
// On the phone PDFs open full screen in the system's viewer (scrolling, zoom, page numbers, Share) – inside a page
// the iPhone shows only the first page and swiping moves the page instead of the PDF.
import { h } from '../util.js';
import { iconSvg } from './icons.js';
import { toast } from './pop.js';
/** the file as a PDF blob */
export async function pdfBlob(url) {
    const r = await fetch(url);
    if (!r.ok)
        throw new Error(`Could not load the PDF (${r.status})`);
    return new Blob([await r.arrayBuffer()], { type: 'application/pdf' });
}
/** a link the browser shows as a PDF (falls back to the link itself) */
export async function pdfUrl(url) {
    try {
        return URL.createObjectURL(await pdfBlob(url));
    }
    catch {
        return url;
    }
}
/** full screen in the system's viewer: the window opens on the tap (else the browser blocks it), the PDF follows */
export function openPdfFull(getUrl) {
    const w = window.open('', '_blank');
    getUrl().then(pdfUrl).then((u) => {
        if (w && !w.closed) {
            w.location.href = u;
            return;
        }
        const a = h('a', { href: u, target: '_blank', rel: 'noopener', style: { display: 'none' } });
        document.body.append(a);
        a.click();
        a.remove();
    }).catch((e) => { w?.close(); toast(e.message); });
}
/** Save: the share sheet with the file (Save to Files, AirDrop …), else a download */
export async function savePdf(getUrl, name) {
    const fileName = /\.pdf$/i.test(name) ? name : `${name}.pdf`;
    try {
        const blob = await pdfBlob(await getUrl());
        const file = new File([blob], fileName, { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: fileName });
                return;
            }
            catch (e) {
                if (e.name === 'AbortError')
                    return;
            }
        }
        const href = URL.createObjectURL(blob);
        const a = h('a', { href, download: fileName, style: { display: 'none' } });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 60_000);
    }
    catch (e) {
        toast(e.message);
    }
}
/** the phone's PDF card: icon, name, Open (full screen) and Save */
export function pdfCard(name, getUrl, sub = 'PDF') {
    return h('div', { class: 'pdf-card' }, h('div', { class: 'pdf-card-top' }, h('span', { class: 'pdf-card-ico' }, iconSvg('file-text', 24)), h('span', { class: 'pdf-card-txt' }, h('b', null, name), h('span', null, sub))), h('div', { class: 'pdf-card-btns' }, h('button', { class: 'btn-new', onclick: () => openPdfFull(getUrl) }, iconSvg('maximize', 15), 'Open'), h('button', { class: 'set-btn', onclick: () => void savePdf(getUrl, name) }, iconSvg('upload', 15), 'Save')));
}
//# sourceMappingURL=pdf.js.map