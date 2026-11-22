let handler = null;
export function setConfirmHandler(h) { handler = h; }
export function confirmReminder(title, when, onEdit) { handler?.(title, when, onEdit); }
//# sourceMappingURL=confirm.js.map