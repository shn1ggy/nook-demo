// The app's name and identity live here and only here.
// Renaming the app = changing these values (plus src-tauri/tauri.conf.json productName).
export const APP = {
    name: 'Nook',
    /** shown in Settings → General; same as package.json and src-tauri */
    version: '0.9.105',
    released: '2026-11-17',
    id: 'app.nook.desktop',
    /** Hidden folder inside every workspace that holds its settings. */
    workspaceDir: '.workspace',
    /** Bumped when the on-disk format changes; older workspaces get migrated. */
    formatVersion: 1,
};
//# sourceMappingURL=config.js.map