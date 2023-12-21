import { App, normalizePath, TAbstractFile, TFile, TFolder, Vault } from "obsidian";

/**
 * Resolves a folder within the application.
 * @param {App} app - The application instance.
 * @param {string} folder_str - The path string of the folder.
 * @returns {TFolder} - The resolved folder as a TFolder object.
 * @throws Will throw an error if the folder doesn't exist or the path is not a folder.
 */
export function resolve_tfolder(app: App, folder_str: string): TFolder {
    folder_str = normalizePath(folder_str);
    const folder = app.vault.getAbstractFileByPath(folder_str);
    if (!folder) {
        throw new Error(`Folder "${folder_str}" doesn't exist`);
    }
    if (!(folder instanceof TFolder)) {
        throw new Error(`${folder_str} is a file, not a folder`);
    }
    return folder;
}

/**
 * Gets all markdown files from a specified folder.
 * @param {App} app - The application instance.
 * @param {string} folder_str - The path string of the folder.
 * @returns {Array<TFile>} - An array of TFile objects representing markdown files in the folder.
 */
export function get_tfiles_from_folder(app: App, folder_str: string): Array<TFile> {
    const folder = resolve_tfolder(app, folder_str);
    const files: Array<TFile> = [];
    Vault.recurseChildren(folder, (file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === 'md') {
            files.push(file);
        }
    });
    files.sort((a, b) => a.basename.localeCompare(b.basename));
    return files;
}

/**
 * Retrieves the currently active file in the application.
 * @param {App} app - The application instance.
 * @returns {TFile | null} - The currently active file, or null if no file is active.
 */
export function get_active_file(app: App) {
    return app.workspace.activeEditor?.file ?? app.workspace.getActiveFile();
}

/**
 * Determines the default folder for new files based on application settings.
 * @param {App} app - The application instance.
 * @returns {TFolder} - The default folder for new files.
 */
export function get_folder(app: App) {
    let folder: TFolder;
    const new_file_location = app.vault.getConfig("newFileLocation");
    switch (new_file_location) {
        case "current": {
            const active_file = get_active_file(app);
            if (active_file) {
                folder = active_file.parent ?? app.vault.getRoot();
                return folder;
            }
            break;
        }
        case "folder":
            folder = app.fileManager.getNewFileParent("");
            return folder;
        case "root":
            folder = app.vault.getRoot();
            return folder;
        default:
            break;
    }
}
