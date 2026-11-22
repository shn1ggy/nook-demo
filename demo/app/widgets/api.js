// ─────────────────────────────────────────────────────────────────────────────
//  Nook widgets – the API.
//
//  A widget is a small block with its own state, e.g. a timer or a sticky note.
//  It is ONE plain JavaScript object (see WidgetDef). Built-in widgets live in
//  builtins.ts; your own live as .js files in the workspace folder
//  ".workspace/widgets/" and look like this:
//
//      export default {
//        id: 'hello',                     // unique, lowercase, a-z 0-9 -
//        name: 'Hello',                   // shown in the "/" menu
//        icon: 'smile',                   // a Nook icon name (Settings → icon picker)
//        description: 'Says hello',
//        defaults: () => ({ who: 'world' }),
//        settings: [{ key: 'who', label: 'Name', type: 'text' }],
//        render(ctx) {
//          return ctx.h('div', { class: 'w-big' }, `Hello ${ctx.data.who}!`);
//        },
//      };
//
//  Rules: no imports, no globals you didn't create – everything comes through `ctx`.
//  State is plain JSON in ctx.data; change it with ctx.set({...}) (saved with the page).
//  WIDGETS.md in the project folder explains everything, with a prompt for an AI.
// ─────────────────────────────────────────────────────────────────────────────
const REGISTRY = new Map();
export function registerWidget(def, customFile) {
    if (!def || typeof def.id !== 'string' || typeof def.render !== 'function')
        throw new Error('A widget needs id, name and render(ctx).');
    if (!/^[a-z0-9-]{1,40}$/.test(def.id))
        throw new Error(`Widget id “${def.id}”: use a-z, 0-9 and -.`);
    REGISTRY.set(def.id, { ...def, custom: customFile });
}
export const widgetDef = (id) => REGISTRY.get(id);
export const allWidgets = () => [...REGISTRY.values()];
export const customWidgets = () => allWidgets().filter((w) => w.custom);
export function unregisterCustom() { for (const [k, w] of REGISTRY)
    if (w.custom)
        REGISTRY.delete(k); }
//# sourceMappingURL=api.js.map