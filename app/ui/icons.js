// Icon library: line icons drawn on a 24×24 grid (1.75 stroke, round caps), stored in
// files as "i:<name>" or "i:<name>:<color>". Emoji and plain text icons keep working;
// the old text symbols (⌂ ▤ ▦ …) are shown as the matching icon.
import { COLORS, stepsOf } from '../util.js';
/** name → [svg inner markup, search words] */
export const ICON_LIB = {
    // pages & documents
    'file': ['<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', 'page document'],
    'file-text': ['<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6M9 9h1"/>', 'page document text note'],
    'notebook': ['<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M3 7h4M3 12h4M3 17h4"/>', 'journal diary tagebuch'],
    'book': ['<path d="M4 19.5V5a2 2 0 0 1 2-2h14v15H6.5A2.5 2.5 0 0 0 4 20.5 2.5 2.5 0 0 0 6.5 23H20"/>', 'book read library'],
    'book-open': ['<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>', 'read study learn'],
    'download': ['<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>', 'download save'],
    'folder': ['<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>', 'folder directory'],
    'archive': ['<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>', 'archive box storage'],
    'inbox': ['<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>', 'inbox mail tray'],
    'clipboard': ['<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>', 'clipboard tasks'],
    'clipboard-check': ['<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>', 'done checklist tasks'],
    'quote': ['<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>', 'quote language sprache'],
    'pen': ['<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>', 'write edit pen'],
    'pencil': ['<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><path d="m15 5 4 4"/>', 'edit draw'],
    'message': ['<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 'chat comment message'],
    'mail': ['<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>', 'mail email letter'],
    'paperclip': ['<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>', 'attachment'],
    // time & planning
    'calendar': ['<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>', 'calendar date'],
    'calendar-days': ['<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>', 'calendar month schedule'],
    'calendar-check': ['<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>', 'calendar done event'],
    'clock': ['<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', 'time clock hour'],
    'alarm': ['<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M5 3 2 6M22 6l-3-3"/>', 'alarm reminder'],
    'hourglass': ['<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>', 'wait pending deadline'],
    'bell': ['<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', 'notification reminder'],
    'repeat': ['<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>', 'recurring monthly subscription'],
    'refresh': ['<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', 'reload sync recurring'],
    'check-square': ['<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>', 'todo checkbox task'],
    'check-circle': ['<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', 'done complete'],
    'list': ['<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', 'list items'],
    'list-todo': ['<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4M13 6h8M13 12h8M13 18h8"/>', 'tasks todo'],
    'target': ['<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', 'goal aim focus'],
    'flag': ['<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>', 'flag milestone priority'],
    'pin': ['<path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>', 'pin pinned'],
    'bookmark': ['<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>', 'bookmark save'],
    'tag': ['<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1"/>', 'tag label'],
    // money
    'wallet': ['<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>', 'wallet money finance'],
    'euro': ['<path d="M4 10h12M4 14h9"/><path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"/>', 'euro money expenses ausgaben'],
    'calculator': ['<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/>', 'calculator calculation costs'],
    'dollar': ['<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', 'dollar money'],
    'coins': ['<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>', 'coins money savings'],
    'piggy-bank': ['<path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z"/><path d="M2 9v1c0 1.1.9 2 2 2h1M16 11h.01"/>', 'savings bank money'],
    'credit-card': ['<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>', 'card payment'],
    'receipt': ['<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11"/>', 'receipt invoice bill'],
    'briefcase': ['<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>', 'work job freelance business'],
    'chart-pie': ['<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>', 'chart pie statistics'],
    'chart-bar': ['<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>', 'chart bar statistics'],
    'trending-up': ['<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>', 'growth income trend'],
    'percent': ['<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>', 'percent tax'],
    'landmark': ['<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4z"/>', 'bank government tax'],
    'shopping-cart': ['<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>', 'shopping groceries'],
    'shopping-bag': ['<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>', 'shopping bag fashion'],
    'gift': ['<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C9.5 3 12 8 12 8s2.5-5 4.5-5a2.5 2.5 0 0 1 0 5"/>', 'gift present birthday'],
    // film & media
    'film': ['<rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/>', 'film movie'],
    'clapperboard': ['<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="m6.2 5.3 3.1 3.9M12.4 3.4l3.1 4M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', 'film shoot dreh directing'],
    'camera': ['<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>', 'camera photo'],
    'video': ['<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>', 'video camera gear'],
    'aperture': ['<circle cx="12" cy="12" r="10"/><path d="m14.31 8 5.74 9.94M9.69 8h11.48M7.38 12l5.74-9.94M9.69 16 3.95 6.06M14.31 16H2.83M16.62 12l-5.74 9.94"/>', 'lens camera gear'],
    'play': ['<polygon points="6 3 20 12 6 21 6 3"/>', 'play start'],
    'tv': ['<rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/>', 'tv series watch'],
    'image': ['<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>', 'image picture photo'],
    'music': ['<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', 'music song'],
    'mic': ['<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>', 'microphone audio sound'],
    'headphones': ['<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>', 'audio sound podcast'],
    'palette': ['<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 11.999 2z"/>', 'color design art grading'],
    'scissors': ['<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>', 'cut edit schnitt'],
    // study & work
    'graduation-cap': ['<path d="M21.42 10.92a1 1 0 0 0-.02-1.84L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.83l8.57 3.91a2 2 0 0 0 1.66 0z"/><path d="M22 10v6M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>', 'study school university bafög'],
    'school': ['<path d="M14 22v-4a2 2 0 1 0-4 0v4"/><path d="m18 10 4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2"/><path d="M18 5v17M4 6l8-4 8 4M6 5v17"/><circle cx="12" cy="9" r="2"/>', 'school building'],
    'lightbulb': ['<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"/>', 'idea'],
    'code': ['<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>', 'code programming'],
    'terminal': ['<path d="m4 17 6-6-6-6M12 19h8"/>', 'terminal console'],
    'monitor': ['<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>', 'computer screen'],
    'laptop': ['<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>', 'laptop computer'],
    'smartphone': ['<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>', 'phone mobile'],
    'database': ['<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>', 'database data'],
    'table': ['<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>', 'table grid'],
    'kanban': ['<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>', 'board kanban'],
    'layout': ['<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>', 'layout dashboard'],
    'columns': ['<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>', 'columns split'],
    'layers': ['<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>', 'layers stack'],
    'box': ['<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>', 'package box delivery'],
    'wrench': ['<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>', 'tool fix repair'],
    'arrow-up-down': ['<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>', 'sort order up down'],
    'rows': ['<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M21 9H3"/><path d="M21 15H3"/>', 'rows group lines'],
    'sliders': ['<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>', 'sliders settings options adjust'],
    'settings': ['<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', 'settings gear'],
    // life
    'home': ['<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>', 'home house start'],
    'user': ['<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>', 'person profile contact'],
    'users': ['<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>', 'people team contacts'],
    'heart': ['<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>', 'love health favorite'],
    'star': ['<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', 'star favorite'],
    'sparkles': ['<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4M22 5h-4"/>', 'magic new ideas'],
    'zap': ['<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>', 'quick energy flash'],
    'flame': ['<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>', 'hot urgent fire'],
    'trophy': ['<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0z"/>', 'award festival win'],
    'rocket': ['<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>', 'launch project start'],
    'coffee': ['<path d="M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1M6 2v2"/>', 'coffee break cafe'],
    'utensils': ['<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>', 'food recipes eat restaurant'],
    'apple': ['<path d="M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06z"/><path d="M10 2c1 .5 2 2 2 5"/>', 'food fruit health'],
    'leaf': ['<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>', 'nature plant'],
    'sun': ['<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>', 'day summer weather'],
    'moon': ['<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>', 'night sleep'],
    'cloud': ['<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>', 'cloud weather'],
    'globe': ['<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>', 'web world website internet'],
    'map-pin': ['<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>', 'location place'],
    'plane': ['<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>', 'travel flight trip'],
    'train': ['<rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16M12 3v8M8 19l-2 3M18 22l-2-3M8 15h.01M16 15h.01"/>', 'travel train'],
    'car': ['<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>', 'car drive'],
    'dumbbell': ['<path d="M14.4 14.4 9.6 9.6M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829zM21.5 21.5l-1.4-1.4M3.9 3.9 2.5 2.5M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>', 'sport fitness gym'],
    // seasons & holidays
    'tree-pine': ['<path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/><path d="M12 22v-3"/>', 'christmas tree xmas weihnachten winter fir'],
    'snowflake': ['<path d="m10 20-1.25-2.5L6 18M10 4 8.75 6.5 6 6M14 20l1.25-2.5L18 18M14 4l1.25 2.5L18 6M17 21l-3-6h-4M17 3l-3 6 1.5 3M2 12h6.5L10 9M20 10l-1.5 2 1.5 2M22 12h-6.5L14 15M4 10l1.5 2L4 14M7 21l3-6-1.5-3M7 3l3 6h4"/>', 'snow winter cold christmas xmas'],
    'ornament': ['<circle cx="12" cy="14" r="7"/><path d="M10 7V4.5h4V7M12 4.5V2.5M5.6 11.5c2 1.3 4.2 1.9 6.4 1.9s4.4-.6 6.4-1.9"/>', 'christmas bauble xmas decoration weihnachten'],
    'candy-cane': ['<path d="M5.7 21a2 2 0 0 1-3.5-2l8.6-14a6 6 0 0 1 10.4 6 2 2 0 1 1-3.464-2 2 2 0 1 0-3.464-2Z"/><path d="M17.75 7 15 2.1M10.9 4.8 13 9M7.9 9.7 10 14M5.3 14.4 7 18.5"/>', 'christmas xmas sweets candy'],
    'cake': ['<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/>', 'birthday party celebration geburtstag'],
    // travel & getting around
    'luggage': ['<rect x="5" y="6" width="14" height="14" rx="2"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M9.5 10v6M14.5 10v6M8 20v1.5M16 20v1.5"/>', 'travel suitcase trip holiday vacation urlaub reise'],
    'map': ['<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15M9 3.236v15"/>', 'travel map route trip karte'],
    'compass': ['<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>', 'travel direction explore navigation'],
    'palm': ['<path d="M13 8c0-2.76-2.46-5-5.5-5S2 5.24 2 8h2l1-1 1 1h4M13 7.14A5.82 5.82 0 0 1 16.5 6c3.04 0 5.5 2.24 5.5 5h-3l-1-1-1 1h-3M5.89 9.71c-2.15 2.15-2.3 5.47-.35 7.43l4.24-4.25.7-.7.71-.71 2.12-2.12c-1.95-1.96-5.27-1.8-7.42.35M11 15.5c.5 2.5-.17 4.5-1 6.5h4c2-5.5-.5-12-1-14"/>', 'beach holiday vacation summer palm tree urlaub'],
    'mountain': ['<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>', 'mountains hiking nature travel berge'],
    'tent': ['<path d="M3.5 21 14 3M20.5 21 10 3M15.5 21 12 15l-3.5 6M2 21h20"/>', 'camping festival outdoor travel'],
    'ticket': ['<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2M13 17v2M13 11v2"/>', 'ticket event cinema concert travel'],
    'bed': ['<path d="M2 4v16M2 8h18a2 2 0 0 1 2 2v10M2 17h20M6 8v9"/>', 'hotel sleep stay bed travel'],
    'car-front': ['<path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8M7 14h.01M17 14h.01"/><rect width="18" height="8" x="3" y="10" rx="2"/><path d="M5 18v2M19 18v2"/>', 'car auto drive vehicle'],
    'bus': ['<path d="M8 6v6M15 6v6M2 12h19.6M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>', 'bus transport travel'],
    'train-front': ['<path d="M8 3.1V7a4 4 0 0 0 8 0V3.1M9 15l-1-1M15 15l1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3M16 19l2 3"/>', 'train rail tram db bahn zug travel'],
    'bike': ['<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>', 'bicycle cycling sport fahrrad'],
    'ship': ['<path d="M12 10.189V14M12 2v3M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>', 'boat ferry ship travel cruise'],
    'fuel': ['<path d="M3 22h12M4 9h10M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>', 'fuel gas petrol car tanken'],
    // symbols
    'move-horizontal': ['<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>', 'width wide horizontal'],
    'move-vertical': ['<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>', 'height tall vertical'],
    'move': ['<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>', 'move position drag'],
    'upload': ['<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>', 'upload send file import'],
    'link': ['<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', 'link url'],
    'external': ['<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 'open link external arrow'],
    'arrow-up': ['<path d="m5 12 7-7 7 7M12 19V5"/>', 'up move'],
    'arrow-down': ['<path d="M12 5v14M19 12l-7 7-7-7"/>', 'down move'],
    'arrow-left': ['<path d="M19 12H5M12 19l-7-7 7-7"/>', 'left back'],
    'restore': ['<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', 'undo restore revert back'],
    'arrow-right': ['<path d="M5 12h14M12 5l7 7-7 7"/>', 'arrow go next'],
    'chevrons-right': ['<path d="m6 17 5-5-5-5M13 17l5-5-5-5"/>', 'quick buttons forward'],
    'plus': ['<path d="M12 5v14M5 12h14"/>', 'add new'],
    'eye': ['<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 'show visible see'],
    'eye-off': ['<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', 'hide hidden'],
    'eye-half': ['<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><path d="M12 9a3 3 0 0 1 0 6z"/>', 'when filled'],
    'crosshair': ['<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/>', 'today now'],
    'minus-circle': ['<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>', 'remove'],
    'chevron-down': ['<path d="m6 9 6 6 6-6"/>', 'open more'],
    'chevron-right': ['<path d="m9 18 6-6-6-6"/>', 'next forward'],
    'chevron-left': ['<path d="m15 18-6-6 6-6"/>', 'back previous'],
    'filter': ['<path d="M3 5h18M6 12h12M10 19h4"/>', 'filter funnel'],
    'search': ['<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', 'search find'],
    'lock': ['<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', 'private secure'],
    'key': ['<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>', 'password key'],
    'info': ['<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>', 'info note'],
    'alert': ['<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>', 'warning important'],
    'help': ['<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>', 'question help'],
    'hash': ['<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>', 'number hash'],
    'type': ['<path d="M4 7V4h16v3M9 20h6M12 4v16"/>', 'text title'],
    'align-left': ['<path d="M15 12H3M17 18H3M21 6H3"/>', 'text paragraph'],
    'align-center': ['<path d="M17 12H7M19 18H5M21 6H3"/>', 'center'],
    'align-right': ['<path d="M21 12H9M21 18H7M21 6H3"/>', 'right'],
    'sigma': ['<path d="M18 7V4H6l6 8-6 8h12v-3"/>', 'formula sum'],
    'circle-dot': ['<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>', 'select option'],
    'tags': ['<path d="m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19"/><path d="M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="6.5" cy="9.5" r=".5"/>', 'multi select tags'],
    'circle': ['<circle cx="12" cy="12" r="10"/>', 'circle dot'],
    'square': ['<rect x="3" y="3" width="18" height="18" rx="2"/>', 'square'],
    'plus-circle': ['<circle cx="12" cy="12" r="10"/><path d="M8 12h8M12 8v8"/>', 'add new'],
    'mouse-pointer': ['<path d="M12.586 12.586 19 19M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"/>', 'button click'],
    'list-ordered': ['<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>', 'numbered list'],
    'toggle': ['<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 8 4 4-4 4"/>', 'toggle collapse'],
    'heading': ['<path d="M6 12h12M6 20V4M18 20V4"/>', 'heading title'],
    'file-plus': ['<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15h6"/>', 'new page subpage'],
    'maximize': ['<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>', 'expand full page open'],
    'minimize': ['<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>', 'collapse'],
    'minus': ['<path d="M5 12h14"/>', 'divider line'],
    'trash': ['<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>', 'delete trash'],
    // simple, bold and filled icons
    'plus-bold': ['<path stroke-width="2.75" d="M12 5v14M5 12h14"/>', 'plus add new bold simple'],
    'minus-bold': ['<path stroke-width="2.75" d="M5 12h14"/>', 'minus remove bold simple'],
    'check-bold': ['<path stroke-width="2.75" d="m5 12.5 4.5 4.5L19 7.5"/>', 'check done ok bold simple'],
    'x-bold': ['<path stroke-width="2.75" d="M6 6l12 12M18 6 6 18"/>', 'close x cancel bold simple'],
    'arrow-up-bold': ['<path stroke-width="2.75" d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>', 'arrow up bold simple direction'],
    'arrow-down-bold': ['<path stroke-width="2.75" d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>', 'arrow down bold simple direction'],
    'arrow-left-bold': ['<path stroke-width="2.75" d="M19 12H5M11.5 5.5 5 12l6.5 6.5"/>', 'arrow left back bold simple direction'],
    'arrow-right-bold': ['<path stroke-width="2.75" d="M5 12h14M12.5 5.5 19 12l-6.5 6.5"/>', 'arrow right next go bold simple direction'],
    'arrow-up-right-bold': ['<path stroke-width="2.75" d="M7 17 17 7M8 7h9v9"/>', 'arrow up right external open link bold simple direction'],
    'arrow-down-right-bold': ['<path stroke-width="2.75" d="M7 7l10 10M17 8v9H8"/>', 'arrow down right bold simple direction'],
    'arrow-down-left-bold': ['<path stroke-width="2.75" d="M17 7 7 17M16 17H7V8"/>', 'arrow down left bold simple direction'],
    'arrow-up-left-bold': ['<path stroke-width="2.75" d="M17 17 7 7M7 16V7h9"/>', 'arrow up left bold simple direction'],
    'chevron-up-bold': ['<path stroke-width="2.75" d="m6 15 6-6 6 6"/>', 'chevron up bold simple direction'],
    'chevron-down-bold': ['<path stroke-width="2.75" d="m6 9 6 6 6-6"/>', 'chevron down bold simple direction'],
    'chevron-left-bold': ['<path stroke-width="2.75" d="m15 6-6 6 6 6"/>', 'chevron left bold simple direction'],
    'chevron-right-bold': ['<path stroke-width="2.75" d="m9 6 6 6-6 6"/>', 'chevron right bold simple direction'],
    'chevrons-right-bold': ['<path stroke-width="2.75" d="m6 6 6 6-6 6M13 6l6 6-6 6"/>', 'chevrons right fast forward bold simple direction'],
    'refresh-bold': ['<path stroke-width="2.75" d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', 'refresh reload repeat bold simple'],
    'circle-fill': ['<circle class="f" cx="12" cy="12" r="8"/>', 'circle dot filled'],
    'square-fill': ['<rect class="f" x="4.5" y="4.5" width="15" height="15" rx="3"/>', 'square filled'],
    'triangle-fill': ['<path class="f" d="M12 4.5 21 19.5H3z"/>', 'triangle filled warning'],
    'play-fill': ['<path class="f" d="M8 5.5v13l10.5-6.5z"/>', 'play start filled video'],
    'pause-fill': ['<rect class="f" x="6" y="5" width="4" height="14" rx="1"/><rect class="f" x="14" y="5" width="4" height="14" rx="1"/>', 'pause filled'],
    'star-fill': ['<polygon class="f" points="12 2.5 15 8.6 21.6 9.5 16.8 14.2 17.9 20.8 12 17.7 6.1 20.8 7.2 14.2 2.4 9.5 9 8.6"/>', 'star favorite filled'],
    'heart-fill': ['<path class="f" d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 6.6 4.5 4.5 0 0 1 20 9.5c0 6.1-8 11-8 11z"/>', 'heart love like filled'],
    'bolt-fill': ['<path class="f" d="M13 2 4 14h7l-1 8 9-12h-7z"/>', 'bolt lightning zap quick filled'],
    'bookmark-fill': ['<path class="f" d="M6 3.5h12v17l-6-4-6 4z"/>', 'bookmark save filled'],
    'flag-fill': ['<path class="f" d="M5 3h12l-2 4.5L17 12H7v9H5z"/>', 'flag mark filled'],
    'tag-fill': ['<path class="f" d="M3 4v7l9.5 9.5 8-8L11 3H4zM7.5 6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" fill-rule="evenodd"/>', 'tag label filled'],
    'pin-fill': ['<path class="f" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 4.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" fill-rule="evenodd"/>', 'pin location place map filled'],
    'chat-fill': ['<path class="f" d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1z"/>', 'chat message comment filled'],
    'plus-circle-fill': ['<path class="f" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v4h4v2h-4v4h-2v-4H7v-2h4z" fill-rule="evenodd"/>', 'plus add new circle filled'],
    'check-circle-fill': ['<path class="f" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.3 6.3 1.4 1.4-7.2 7.2-4.2-4.2 1.4-1.4 2.8 2.8z" fill-rule="evenodd"/>', 'check done circle filled'],
    'dot': ['<circle class="f" cx="12" cy="12" r="3.5"/>', 'dot point small filled'],
    // more icons (set 2)
    'activity': ['<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>', 'activity pulse health heartbeat'],
    'award': ['<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/>', 'award medal prize badge'],
    'battery': ['<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2M6 11v2M10 11v2"/>', 'battery energy power'],
    'bell-off': ['<path d="M8.7 3A6 6 0 0 1 18 8c0 2.4.5 4.3 1.1 5.7M17 17H3s3-2 3-9c0-.6.1-1.2.3-1.8M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20"/>', 'mute silent notification off'],
    'brush': ['<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>', 'brush paint art design'],
    'bug': ['<rect x="8" y="6" width="8" height="14" rx="4"/><path d="M19 7l-3 2M5 7l3 2M19 19l-3-2M5 19l3-2M20 13h-4M4 13h4M10 4l1 2M14 4l-1 2"/>', 'bug error issue'],
    'building': ['<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>', 'building office company city'],
    'cat': ['<path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5z"/><path d="M8 14v.5M16 14v.5M11.25 16.25h1.5L12 17z"/>', 'cat pet animal'],
    'dog': ['<path d="M10 5.17C10 3.4 8.6 2 6.83 2c-1.27 0-2.4.74-2.9 1.89L2 9c0 1.1.9 2 2 2h1.1M14 5.17C14 3.4 15.4 2 17.17 2c1.27 0 2.4.74 2.9 1.89L22 9c0 1.1-.9 2-2 2h-1.1"/><path d="M5 11v5a6 6 0 0 0 6 6h2a6 6 0 0 0 6-6v-5c0-3.9-3.1-7-7-7s-7 3.1-7 7z"/><path d="M9 14h.01M15 14h.01M11 18h2"/>', 'dog pet animal'],
    'feather': ['<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><path d="M16 8 2 22M17.5 15H9"/>', 'feather write light'],
    'fingerprint': ['<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4M14 13.12c0 2.38 0 6.38-1 8.88M17.29 21.02c.12-.6.43-2.3.5-3.02M2 12a10 10 0 0 1 18-6M2 16h.01M21.8 16c.2-2 .13-5.35 0-6M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2M8.65 22c.21-.66.45-1.32.57-2M9 6.8a6 6 0 0 1 9 5.2v2"/>', 'identity security fingerprint'],
    'gamepad': ['<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/>', 'game play controller fun'],
    'glasses': ['<circle cx="6" cy="15" r="4"/><circle cx="18" cy="15" r="4"/><path d="M14 15a2 2 0 0 0-4 0M2.5 13 5 7c.7-1.3 1.4-2 3-2M21.5 13 19 7c-.7-1.3-1.5-2-3-2"/>', 'glasses read reading'],
    'globe-2': ['<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>', 'world web international language'],
    'hammer': ['<path d="m15 12-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9M17.64 15 22 10.64M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25V7.86L16.27 5.4a5.5 5.5 0 0 0-3.89-1.61H9l.92.82A6.18 6.18 0 0 1 12 9.24V10l2 2h.87c.85 0 1.65.33 2.25.93l1.25 1.25"/>', 'hammer build tool repair'],
    'hand': ['<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>', 'hand stop wave help'],
    'handshake': ['<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8"/>', 'deal agreement partner client'],
    'inbox-2': ['<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>', 'tray inbox incoming'],
    'infinity': ['<path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4z"/>', 'infinity forever loop'],
    'kanban-2': ['<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>', 'board kanban columns'],
    'key-round': ['<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>', 'password access key'],
    'languages': ['<path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>', 'language translate sprache'],
    'library': ['<path d="m16 6 4 14M12 6v14M8 8v12M4 4v16"/>', 'library books study'],
    'life-buoy': ['<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 9.17l4.24-4.24M14.83 14.83l4.24 4.24M9.17 14.83l-4.24 4.24"/>', 'help support rescue'],
    'megaphone': ['<path d="m3 11 18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6"/>', 'announce marketing loud promotion'],
    'message-square': ['<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 'chat message comment'],
    'mountain-snow': ['<path d="m8 3 4 8 5-5 5 15H2L8 3z"/><path d="M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19"/>', 'mountain snow ski winter'],
    'newspaper': ['<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>', 'news article press'],
    'package': ['<path d="M16.5 9.4 7.55 4.24M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.29 7 12 12l8.71-5M12 22V12"/>', 'package delivery parcel shipping'],
    'paw': ['<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.05Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10z"/>', 'pet animal paw'],
    'pen-tool': ['<path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.59 7.59"/><circle cx="11" cy="11" r="2"/>', 'design vector pen'],
    'phone': ['<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>', 'phone call telephone'],
    'pill': ['<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7zM8.5 8.5l7 7"/>', 'medicine health pill'],
    'pizza': ['<path d="M15 11h.01M11 15h.01M16 16h.01M2 16l20 6-6-20A20 20 0 0 0 2 16"/><path d="M5.71 17.11a17.04 17.04 0 0 1 11.4-11.4"/>', 'food pizza eat'],
    'plug': ['<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>', 'plug power electric'],
    'podcast': ['<circle cx="12" cy="11" r="1"/><path d="M11 17a1 1 0 0 1 2 0c0 .5-.34 3-.5 4.5a.5.5 0 0 1-1 0c-.16-1.5-.5-4-.5-4.5zM8 14a5 5 0 1 1 8 0M17 18.5a9 9 0 1 0-10 0"/>', 'podcast audio radio'],
    'printer': ['<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>', 'print printer copyshop'],
    'puzzle': ['<path d="M19.44 7.85c-.24.24-.4.58-.4.95 0 .69.56 1.25 1.25 1.25h.46c.69 0 1.25.56 1.25 1.25v3.4c0 .69-.56 1.25-1.25 1.25h-.46a1.25 1.25 0 0 0 0 2.5h.46c.69 0 1.25.56 1.25 1.25v.05c0 1.1-.9 2-2 2h-3.4c-.69 0-1.25-.56-1.25-1.25v-.46a1.25 1.25 0 0 0-2.5 0v.46c0 .69-.56 1.25-1.25 1.25H6.6c-1.1 0-2-.9-2-2v-3.4c0-.69.56-1.25 1.25-1.25h.46a1.25 1.25 0 0 0 0-2.5h-.46c-.69 0-1.25-.56-1.25-1.25V7.8c0-1.1.9-2 2-2h3.4c.69 0 1.25-.56 1.25-1.25v-.46a1.25 1.25 0 0 1 2.5 0v.46c0 .69.56 1.25 1.25 1.25h3.4c.37 0 .71.16.95.4z"/>', 'puzzle plugin extension piece'],
    'rss': ['<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>', 'rss feed atom subscribe'],
    'radio': ['<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>', 'radio broadcast signal'],
    'recycle': ['<path d="M7 19H4.82a1.83 1.83 0 0 1-1.57-.88 1.79 1.79 0 0 1 0-1.8L7.2 9.6M11 19h8.2a1.83 1.83 0 0 0 1.57-.88 1.8 1.8 0 0 0 0-1.8L19.4 13.8M14 16l-3 3 3 3M8.3 13.6 7.2 9.6 3.2 10.7M9.34 5.36l.96-1.68A1.83 1.83 0 0 1 11.87 3c.65 0 1.24.34 1.57.88l3.93 6.72M13.38 9.94l4 1.06 1.05-4"/>', 'recycle environment green'],
    'ruler': ['<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0zM14.5 12.5l2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2"/>', 'measure ruler size'],
    'save': ['<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>', 'save disk store'],
    'scale': ['<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM7 21h10M12 3v18M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>', 'law balance justice weigh'],
    'send': ['<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>', 'send email submit paper plane'],
    'server': ['<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>', 'server data storage'],
    'shield': ['<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 'security protect safe insurance'],
    'shirt': ['<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>', 'clothes costume shirt wardrobe kostüm'],
    'smile': ['<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>', 'smile happy mood face'],
    'sprout': ['<path d="M7 20h10M10 20c5.5-2.5.8-6.4 3-10M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8zM14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/>', 'grow plant habit start'],
    'stethoscope': ['<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>', 'doctor health medical arzt'],
    'sticky-note': ['<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v6h6"/>', 'note sticky memo'],
    'thermometer': ['<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z"/>', 'temperature weather fever'],
    'timer': ['<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>', 'timer stopwatch countdown time'],
    'umbrella': ['<path d="M22 12a10.06 10.06 1 0 0-20 0zM12 12v8a2 2 0 0 0 4 0M12 2v1"/>', 'rain weather umbrella insurance'],
    'wand': ['<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>', 'magic wand auto'],
    'wifi': ['<path d="M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 20 0M12 20h.01"/>', 'wifi internet network'],
    'wind': ['<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2M9.6 4.6A2 2 0 1 1 11 8H2M12.6 19.4A2 2 0 1 0 14 16H2"/>', 'wind weather air'],
    'wine': ['<path d="M8 22h8M7 10h10M12 15v7M12 15a5 5 0 0 0 5-5c0-2-.5-4-2-8H9c-1.5 4-2 6-2 8a5 5 0 0 0 5 5z"/>', 'wine drink party glass'],
    'beer': ['<path d="M17 11h1a3 3 0 0 1 0 6h-1M9 12v6M13 12v6M14 7.5c-1 0-1.44.5-3 .5s-2-.5-3-.5-1.72.5-2.5.5a2.5 2.5 0 0 1 0-5c.78 0 1.57.5 2.5.5S9.44 2 11 2s2 1.5 3 1.5 1.72-.5 2.5-.5a2.5 2.5 0 0 1 0 5c-.78 0-1.5-.5-2.5-.5z"/><path d="M5 8v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/>', 'beer drink bar bier'],
    'popcorn': ['<path d="M18 8a2 2 0 0 0 0-4 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0 0 4M10 22 9 8M14 22l1-14"/><path d="M20 8c.5 0 .9.4.8 1l-2.6 12c-.1.5-.7 1-1.2 1H7c-.6 0-1.1-.4-1.2-1L3.2 9c-.1-.6.3-1 .8-1z"/>', 'cinema movie popcorn kino'],
    'drama': ['<path d="M10 11h.01M14 6h.01M18 6h.01M6.5 13.1h.01M22 5c0 9-4 12-6 12s-6-3-6-12c0-2 2-3 6-3s6 1 6 3"/><path d="M17.4 9.9c-.8.8-2 .8-2.8 0M10.1 7.1C9 7.2 7.7 7.7 6 8.6c-3.5 2-4.7 3.9-3.7 5.6 4.5 7.8 9.5 8.4 11.2 7.4.9-.5 1.9-2.1 1.9-4.7"/><path d="M9.1 16.5c.3-1.1 1.4-1.7 2.4-1.4"/>', 'theater drama masks acting schauspiel'],
    'spotlight': ['<path d="M15.3 7.3 22 2M9 22 15 14M13.2 4.6 8.5 9.3a2 2 0 0 0 0 2.8l3.4 3.4a2 2 0 0 0 2.8 0l4.7-4.7z"/><path d="M5 18l-3 3M7 22H3"/>', 'light spotlight stage lighting'],
};
/** old text symbols → icon names, so existing workspaces look right */
const LEGACY = {
    '⌂': 'home', '▤': 'file-text', '▥': 'notebook', '▦': 'calendar-days', '◇': 'graduation-cap', '€': 'euro',
    '▷': 'video', '↻': 'repeat', '❝': 'quote', '“': 'quote', '▣': 'briefcase', '◷': 'clock', '↗': 'external',
    '»': 'chevrons-right', '▫': 'file', '◉': 'mouse-pointer', '☑': 'check-square', '▨': 'image',
};
/** Parses a stored icon value; null for emoji / free text. */
/** an icon's colour: "white" is real white, a palette colour its text colour, none follows the text */
export function iconColor(c) {
    if (!c || c === 'default')
        return undefined;
    if (c === 'white')
        return '#ffffff';
    return COLORS[c] ? stepsOf(c).icon : undefined;
}
export function parseIcon(v) {
    if (!v)
        return null;
    if (v.startsWith('i:')) {
        const [, name, color] = v.split(':');
        return ICON_LIB[name] ? { name, color: color } : null;
    }
    const legacy = LEGACY[v.trim()];
    return legacy ? { name: legacy } : null;
}
/** optical sizing: every icon is scaled around its centre so they all feel the same size – measured once from each icon's drawn box (geometric mean of width and height, target 19 of 24, damped, 0.94–1.35) */
const FIT = { "file": [1.053, 12.0, 12.0], "file-text": [1.053, 12.0, 12.0], "book-open": [0.958, 12.0, 12.5], "folder": [0.958, 12.0, 11.5], "archive": [0.941, 12.0, 12.0], "quote": [0.941, 12.0, 12.0], "pen": [0.94, 12.02, 12.0], "pencil": [0.94, 12.02, 12.0], "paperclip": [0.94, 11.72, 12.0], "calendar": [0.941, 12.0, 12.0], "calendar-days": [0.941, 12.0, 12.0], "calendar-check": [0.941, 12.0, 12.0], "clock": [0.94, 12.0, 12.0], "alarm": [0.941, 12.0, 12.0], "bell": [0.941, 12.0, 12.0], "repeat": [0.941, 12.0, 12.0], "check-circle": [0.94, 12.0, 12.0], "list": [1.105, 12.0, 12.0], "list-todo": [1.053, 12.0, 12.0], "target": [0.94, 12.0, 12.0], "bookmark": [1.053, 12.0, 12.0], "tag": [0.94, 12.0, 12.0], "wallet": [0.957, 12.5, 12.0], "euro": [1.07, 11.5, 12.0], "dollar": [1.068, 12.0, 12.0], "coins": [0.94, 12.0, 12.0], "briefcase": [0.941, 12.0, 12.0], "chart-pie": [0.94, 12.0, 12.0], "trending-up": [1.129, 12.0, 12.0], "percent": [1.049, 12.0, 12.0], "landmark": [0.941, 12.0, 12.0], "shopping-cart": [0.94, 12.07, 12.03], "shopping-bag": [0.941, 12.0, 12.0], "film": [0.94, 12.0, 12.0], "clapperboard": [0.941, 11.51, 11.51], "video": [1.068, 12.0, 12.0], "aperture": [0.94, 12.0, 12.0], "play": [1.053, 13.0, 12.0], "tv": [0.94, 12.0, 12.0], "palette": [0.94, 12.0, 12.0], "school": [0.94, 12.0, 12.0], "lightbulb": [1.068, 12.0, 12.0], "code": [1.068, 12.0, 12.0], "terminal": [1.094, 12.0, 12.0], "monitor": [0.941, 12.0, 12.0], "database": [0.941, 12.0, 12.0], "layers": [0.94, 12.01, 11.99], "box": [0.941, 12.0, 12.0], "wrench": [0.94, 12.5, 11.5], "sliders": [1.049, 12.0, 12.0], "settings": [0.94, 12.0, 12.0], "home": [0.941, 12.0, 12.0], "users": [0.941, 12.0, 12.0], "heart": [0.941, 12.0, 12.0], "star": [0.94, 12.0, 11.51], "sparkles": [0.94, 12.0, 12.0], "zap": [0.941, 12.0, 12.0], "flame": [1.035, 12.0, 12.5], "trophy": [0.94, 12.0, 12.0], "rocket": [0.94, 12.25, 11.75], "coffee": [0.94, 12.5, 11.5], "utensils": [0.941, 12.0, 12.0], "apple": [0.94, 12.0, 12.0], "leaf": [0.94, 11.5, 11.5], "sun": [0.94, 12.0, 12.0], "globe": [0.94, 12.0, 12.0], "plane": [0.967, 12.09, 11.91], "car": [1.068, 12.0, 13.0], "dumbbell": [0.94, 12.0, 12.0], "snowflake": [0.941, 12.0, 12.0], "ornament": [1.044, 12.0, 11.75], "candy-cane": [0.94, 11.97, 12.01], "cake": [0.958, 12.0, 12.5], "luggage": [1.044, 12.0, 12.25], "compass": [0.94, 12.0, 12.0], "palm": [0.94, 12.0, 12.5], "mountain": [0.941, 12.0, 12.0], "tent": [0.941, 12.0, 12.0], "car-front": [1.031, 12.0, 12.5], "bike": [0.958, 12.0, 12.5], "ship": [0.94, 12.0, 12.0], "fuel": [0.94, 12.5, 12.0], "link": [0.94, 12.0, 12.0], "arrow-up": [1.14, 12.0, 12.0], "arrow-down": [1.14, 12.0, 12.0], "arrow-left": [1.14, 12.0, 12.0], "arrow-right": [1.14, 12.0, 12.0], "chevrons-right": [1.325, 12.0, 12.0], "filter": [1.053, 12.0, 12.0], "lock": [0.941, 12.0, 12.0], "key": [0.94, 12.0, 11.5], "info": [0.94, 12.0, 12.0], "alert": [0.94, 11.99, 11.99], "help": [0.94, 12.0, 12.0], "type": [1.049, 12.0, 12.0], "align-left": [1.105, 12.0, 12.0], "align-center": [1.105, 12.0, 12.0], "align-right": [1.105, 12.0, 12.0], "sigma": [1.147, 12.0, 12.0], "circle-dot": [0.94, 12.0, 12.0], "circle": [0.94, 12.0, 12.0], "plus-circle": [0.94, 12.0, 12.0], "list-ordered": [1.125, 12.5, 12.0], "heading": [1.147, 12.0, 12.0], "file-plus": [1.053, 12.0, 12.0], "minus": [1.143, 12.0, 12.0], "trash": [0.941, 12.0, 12.0], "plus-bold": [1.092, 12.0, 12.0], "minus-bold": [1.143, 12.0, 12.0], "check-bold": [1.219, 12.0, 12.25], "x-bold": [1.194, 12.0, 12.0], "arrow-up-bold": [1.116, 12.0, 12.0], "arrow-down-bold": [1.116, 12.0, 12.0], "arrow-left-bold": [1.116, 12.0, 12.0], "arrow-right-bold": [1.116, 12.0, 12.0], "arrow-up-right-bold": [1.22, 12.0, 12.0], "arrow-down-right-bold": [1.22, 12.0, 12.0], "arrow-down-left-bold": [1.22, 12.0, 12.0], "arrow-up-left-bold": [1.22, 12.0, 12.0], "chevron-up-bold": [1.35, 12.0, 12.0], "chevron-down-bold": [1.35, 12.0, 12.0], "chevron-left-bold": [1.35, 12.0, 12.0], "chevron-right-bold": [1.35, 12.0, 12.0], "chevrons-right-bold": [1.167, 12.5, 12.0], "circle-fill": [1.196, 12.0, 12.0], "square-fill": [1.251, 12.0, 12.0], "triangle-fill": [1.173, 12.0, 12.0], "play-fill": [1.35, 13.25, 12.0], "pause-fill": [1.35, 12.0, 12.0], "heart-fill": [1.207, 12.0, 12.71], "bolt-fill": [1.131, 11.5, 12.0], "bookmark-fill": [1.294, 12.0, 12.0], "flag-fill": [1.269, 11.0, 12.0], "tag-fill": [1.123, 11.75, 11.75], "pin-fill": [1.159, 12.0, 12.0], "chat-fill": [1.146, 12.5, 12.5], "plus-circle-fill": [1.023, 12.0, 12.0], "check-circle-fill": [1.023, 12.0, 12.0], "activity": [0.941, 12.0, 12.0], "award": [1.068, 12.0, 12.0], "battery": [1.129, 12.0, 12.0], "bell-off": [0.94, 12.0, 12.0], "brush": [0.94, 12.02, 12.49], "bug": [1.049, 12.0, 12.0], "cat": [0.97, 11.99, 11.91], "dog": [0.94, 12.0, 12.0], "feather": [0.94, 12.0, 12.0], "fingerprint": [0.94, 11.96, 12.0], "gamepad": [1.068, 12.0, 12.0], "globe-2": [0.94, 12.0, 12.0], "hammer": [0.966, 12.44, 12.46], "hand": [0.94, 11.95, 12.0], "handshake": [0.94, 12.0, 12.06], "infinity": [1.205, 12.0, 12.0], "key-round": [0.94, 12.0, 11.5], "languages": [0.94, 12.0, 12.0], "library": [1.049, 12.0, 12.0], "life-buoy": [0.94, 12.0, 12.0], "megaphone": [1.078, 12.0, 12.5], "mountain-snow": [0.941, 12.0, 12.0], "newspaper": [0.94, 12.0, 12.0], "package": [0.941, 12.0, 12.0], "paw": [0.94, 12.0, 12.0], "pen-tool": [0.94, 12.0, 12.0], "phone": [0.94, 12.06, 11.96], "pill": [0.94, 12.0, 12.0], "pizza": [0.94, 12.0, 12.0], "plug": [1.068, 12.0, 12.0], "podcast": [0.941, 12.0, 12.01], "printer": [0.94, 12.0, 12.0], "puzzle": [0.968, 13.3, 12.3], "recycle": [0.956, 12.01, 12.5], "ruler": [0.94, 12.0, 12.0], "scale": [0.941, 12.0, 12.0], "send": [0.94, 12.0, 12.0], "server": [0.94, 12.0, 12.0], "shirt": [0.94, 12.0, 12.0], "smile": [0.94, 12.0, 12.0], "sprout": [1.07, 11.5, 12.0], "stethoscope": [0.94, 12.0, 11.99], "thermometer": [1.205, 12.0, 12.0], "umbrella": [0.94, 12.0, 12.0], "wand": [0.94, 12.5, 11.5], "wine": [1.129, 12.0, 12.0], "beer": [0.941, 12.0, 12.0], "popcorn": [0.947, 12.0, 12.0], "drama": [0.94, 11.98, 11.98], "spotlight": [0.94, 12.0, 12.0], "star-fill": [1.06, 12.0, 11.65], "dot": [1.06, 12.0, 12.0] };
export function iconSvg(name, size = 16, color) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', color ?? 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('ico-svg');
    const fit = ICON_LIB[name] ? FIT[name] : undefined;
    if (fit) {
        // scaled around its own centre; strokes keep their thickness
        const [k, cx, cy] = fit;
        svg.innerHTML = `<g transform="translate(12 12) scale(${k}) translate(${-cx} ${-cy})" stroke-width="${(1.75 / k).toFixed(3)}">${ICON_LIB[name][0]}</g>`;
        svg.querySelectorAll('[stroke-width]').forEach((e) => { if (e.tagName !== 'g')
            e.setAttribute('stroke-width', (parseFloat(e.getAttribute('stroke-width')) / k).toFixed(3)); });
    }
    else
        svg.innerHTML = ICON_LIB[name]?.[0] ?? ICON_LIB.file[0];
    // filled shapes take the icon colour as fill
    svg.querySelectorAll('.f').forEach((e) => { e.setAttribute('fill', color ?? 'currentColor'); e.setAttribute('stroke', 'none'); });
    return svg;
}
/** Renders any stored icon value (library icon, legacy symbol or emoji) as an element. */
export function renderIcon(v, size = 16, fallback = 'file') {
    const span = document.createElement('span');
    span.className = 'ico';
    const spec = parseIcon(v);
    if (spec)
        span.appendChild(iconSvg(spec.name, size, iconColor(spec.color)));
    else if (v) {
        span.textContent = v;
        span.classList.add('emoji');
        span.style.fontSize = `${Math.round(size * 0.95)}px`;
    }
    else
        span.appendChild(iconSvg(fallback, size));
    return span;
}
/** plain-text form of an icon for places that only take text (palette rows) */
//# sourceMappingURL=icons.js.map