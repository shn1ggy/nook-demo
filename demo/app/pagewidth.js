export function validWidth(value) {
    return value === 'full' ? value : typeof value === 'number' && Number.isFinite(value) && value >= 320 && value <= 3840 ? Math.round(value) : undefined;
}
/** Legacy percentages use one reference size, never the current device's viewport. */
function legacyWidth(percent) {
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 25 || percent > 100)
        return undefined;
    return percent === 100 ? 'full' : Math.round(1440 * percent / 100);
}
export function workspaceWidth(settings) {
    return validWidth(settings.defaultPageWidth) ?? legacyWidth(settings.pageWidth) ?? 960;
}
export function resolvePageWidth(page, settings) {
    return validWidth(page.layoutWidth) ?? (page.fullWidth ? legacyWidth(settings.pageWidth) ?? 'full' : legacyWidth(page.width)) ?? workspaceWidth(settings);
}
export function resolveDatabaseWidth(schema, settings) {
    return validWidth(schema.layoutWidth) ?? legacyWidth(schema.pageWidth) ?? workspaceWidth(settings);
}
export function widthStyle(width) {
    return { maxWidth: width === 'full' ? '100%' : `${width}px` };
}
//# sourceMappingURL=pagewidth.js.map