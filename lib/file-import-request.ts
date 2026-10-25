// Image and style imports share one sequence so a slow earlier file cannot reopen an old dialog.
let sequence = 0;
export const FILE_IMPORT_TOAST_ID = "image-drop-import";
export const beginFileImport = () => ++sequence;
export const isLatestFileImport = (request: number) => request === sequence;
