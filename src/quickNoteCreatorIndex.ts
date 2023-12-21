import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    FuzzyMatch,
    normalizePath,
    Notice,
    Plugin,
    prepareFuzzySearch,
    TAbstractFile,
    TFile,
    TFolder,
    Vault
} from 'obsidian';
import { DEFAULT_SETTINGS, QuickNoteCreatorSettings, QuickNoteCreatorSettingTab } from "./quickNoteCreatorSetting";

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

export default class QuickNoteCreatorPlugin extends Plugin {
    settings: QuickNoteCreatorSettings;
    settingTab: QuickNoteCreatorSettingTab;

    async onload() {

        this.patchSuggestions();
        await this.loadSettings();
        this.settingTab = new QuickNoteCreatorSettingTab(this.app, this);
        this.addSettingTab(this.settingTab);

        this.app.workspace.onLayoutReady(() => {
            this.initSuggestion();
        });

    }

    onunload() {

    }

    /**
     * Initializes the suggestion functionality in the application.
     * This method checks for the existence of a 'quick-add-tag' type suggestion.
     * If it exists, it removes it and adds a new QuickNoteCreatorSuggest at the beginning of the suggestions array.
     * If it doesn't exist, it simply adds a new QuickNoteCreatorSuggest at the beginning.
     */
    initSuggestion() {
        const existed = this.app.workspace.editorSuggest.suggests.findIndex((suggest) => suggest.type === 'quick-add-tag');
        console.log(this.app.workspace.editorSuggest.suggests);
        if (existed !== -1) {
            this.app.workspace.editorSuggest.suggests.splice(existed, 1);
            this.app.workspace.editorSuggest.suggests.unshift(new QuickNoteCreatorSuggest(this.app, this));
        } else {
            this.app.workspace.editorSuggest.suggests.unshift(new QuickNoteCreatorSuggest(this.app, this));
        }
    }

    /**
     * Patches the file suggestion system in the application.
     * This method locates the file suggester and adds custom instructions for creating a Templater note.
     * It modifies the suggestion element in the user interface to include these instructions.
     */
    patchSuggestions() {
        const fileSuggester = this.app.workspace.editorSuggest.suggests.find(
            (suggest) => {
                // @ts-ignore
                return suggest.suggestManager && suggest.suggestManager.mode === 'file';
            }
        );
        if (fileSuggester) {
            // @ts-ignore
            const instructionsEl = (fileSuggester.suggestEl as HTMLElement).find('.prompt-instructions');
            const customInstructionEl = instructionsEl.find('.custom-instruction');
            if (customInstructionEl) return;

            const instructionEl = instructionsEl.createDiv({
                cls: 'prompt-instruction custom-instruction',
            });
            instructionEl.createSpan({
                cls: 'prompt-instruction-command',
                text: 'Type $'
            });
            instructionEl.createSpan({
                text: 'to create a Templater note',
            });
        }
    }


    public async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}


export class QuickNoteCreatorSuggest extends EditorSuggest<string> {
    editor: Editor;
    cursor: EditorPosition;
    plugin: QuickNoteCreatorPlugin;
    templater: any;
    templaterPlugin: any;

    public type = 'quick-add-tag';

    afterDollarText: string = '';
    beforeDollarText: string = '';
    betwennDollarAndHeadingText: string = '';

    hasDoubleBrackets: boolean = false;

    isModKey: boolean = false;
    isShiftKey: boolean = false;

    isDollarKey: boolean = false;
    isHeadingKey: boolean = false;
    isBlockKey: boolean = false;
    isLineKey: boolean = false;

    files: TFile[] = [];

    // 新的正则表达式，匹配以 `[[` 开头，且之后不包含 `[` 和 `]` 的字符串
    readonly CUSTOM_TAG_REGEX = /\[\[([^\[\]]+)/;
    readonly CUSTOM_INSTRUCTION = [
        {
            command: 'Enter',
            purpose: 'to create a Templater note'
        },
        {
            command: 'Ctrl+Enter',
            purpose: 'to create a Templater note and open it'
        },
        {
            command: 'Shift+Enter',
            purpose: 'to create note with current input as tag'
        }
    ];

    constructor(app: App, plugin: QuickNoteCreatorPlugin) {
        super(app);
        this.plugin = plugin;

        this.setInstructions(this.CUSTOM_INSTRUCTION);

        try {
            this.templaterPlugin = this.app.plugins.getPlugin('templater-obsidian');
            this.templater = this.templaterPlugin.templater;
        } catch (e) {
            console.log(e);
            new Notice('Templater plugin is not installed or enabled. Please install and enable it to use this plugin.');
        }

        this.scope.register([], 'Tab', (evt) => {
            evt.preventDefault();
            this.suggestions.useSelectedItem(evt);
        });

        this.scope.register(['Mod'], 'Enter', (evt) => {
            evt.preventDefault();
            this.isModKey = true;
            this.suggestions.useSelectedItem(evt);
        });

        this.scope.register(['Shift'], 'Enter', (evt) => {
            evt.preventDefault();
            this.isShiftKey = true;
            this.suggestions.useSelectedItem(evt);
        });

        this.scope.register(null, '#', (evt) => {
            evt.preventDefault();
            this.isHeadingKey = true;
            this.suggestions.useSelectedItem(evt);
        });

        this.scope.register(null, '^', (evt) => {
            evt.preventDefault();
            this.isBlockKey = true;
            this.suggestions.useSelectedItem(evt);
        });

        this.scope.register(null, '|', (evt) => {
            evt.preventDefault();
            this.isLineKey = true;
            this.suggestions.useSelectedItem(evt);
        });
    }

    fuzzySearchItemsOptimized(query: string, items: string[]): FuzzyMatch<string>[] {
        // 使用 prepareFuzzySearch 来创建一个预先准备好的查询函数
        const preparedSearch = prepareFuzzySearch(query);

        return items
            .map((item) => {
                const result = preparedSearch(item);
                if (result) {
                    return {
                        item: item,
                        match: result,
                    };
                }
                return null;
            })
            .filter(Boolean) as FuzzyMatch<string>[];
    }

    onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
        const targetTemplatePath = this.templaterPlugin && this.plugin.settings.use_templater_templates ? this.templaterPlugin?.settings.templates_folder : this.plugin?.settings.templates_folder;
        this.files = get_tfiles_from_folder(this.app, targetTemplatePath);

        this.cursor = cursor;
        this.editor = editor;
        const currentLineNum = cursor.line;
        const currentLineText = editor.getLine(currentLineNum);
        const textUntilCursor = currentLineText.slice(0, cursor.ch);
        const textAfterCursor = currentLineText.slice(cursor.ch);

        const getLastDoubleBracketIndex = (text: string) => {
            const lastDoubleBracketIndex = text.lastIndexOf(']]');
            return lastDoubleBracketIndex === -1 ? 0 : lastDoubleBracketIndex;
        };

        const targetText = textUntilCursor.slice(getLastDoubleBracketIndex(textUntilCursor));
        const match = targetText.match(this.CUSTOM_TAG_REGEX);

        if (match) {
            const matchedText = match[1]; // 获取匹配到的文本
            const dollarIndex = matchedText.indexOf('$');
            this.isDollarKey = dollarIndex !== -1;
            if (dollarIndex !== -1) {
                this.afterDollarText = matchedText.slice(dollarIndex + 1);
                this.beforeDollarText = matchedText.slice(0, dollarIndex);

                this.hasDoubleBrackets = textAfterCursor.indexOf(']]') !== -1;


                return {
                    start: {
                        line: currentLineNum,
                        ch: getLastDoubleBracketIndex(textUntilCursor) + (match.index || 0),
                    },
                    end: {
                        line: currentLineNum,
                        ch: cursor.ch,
                    },
                    query: this.afterDollarText,
                };
            }
        }
        return null;
    }

    getSuggestions(context: EditorSuggestContext): string[] {
        const names = this.files.map((file) => file.basename);

        const query = this.fuzzySearchItemsOptimized(context.query, names)
            .map((match) => match.item)
            .sort((a, b) => {
                return a.localeCompare(b);
            });

        if (query.length === 0) {
            return ['Create note with tag:' + context.query.trim().split(' ').map((tag) => {
                return tag.startsWith('#') ? (' ' + tag) : (' #' + tag);
            }).join(' ')];
        }

        return (
            query || []
        );
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }

    async selectSuggestion(value: string): Promise<void> {
        if (this.context) {
            const editor = this.context.editor;
            const start = this.context.start;
            const end = this.context.end;

            let targetValue = this.isShiftKey || value.contains(':') ? `---\ntags: \n${
                this.context.query.trim().split(' ').map((tag) => {
                    return tag.startsWith('#') ? ('  - ' + tag) : ('  - ' + tag);
                }).join('\n')
            }\n---\n` : `${this.context.query}`;


            editor.transaction({
                changes: [
                    {
                        from: {
                            line: start.line,
                            ch: end.ch - this.context.query.length - 1,
                        },
                        to: end,
                        text: this.hasDoubleBrackets ? '' : ']]',
                    },
                ],
            });

            const file = this.isShiftKey || value.contains(':') ? '' : this.files.find((file) => file.basename === value);
            if (this.templater) this.templater.create_new_note_from_template(file || targetValue, undefined, this.beforeDollarText, this.isModKey);
            else {
                new Notice('Templater plugin is not installed or enabled. Please install and enable it to use this plugin.');
                const template = file instanceof TFile ? await this.app.vault.read(file) : '';

                const folder = get_folder(this.app);
                const path = (folder?.path || '') + '/' + this.beforeDollarText + '.md';
                const newFile = await this.app.vault.create(path, targetValue + template);
                if (newFile) {
                    if (this.isModKey) {
                        await this.app.workspace.openLinkText(newFile.path, '', true);
                    }
                }
            }

            if ((this.isHeadingKey || this.isLineKey || this.isBlockKey) && !this.isModKey) {
                const insertText = this.isHeadingKey ? '#' : (this.isLineKey ? '|' : '#^');

                setTimeout(() => {
                    editor.transaction({
                        changes: [
                            {
                                from: {
                                    line: start.line,
                                    ch: start.ch + this.beforeDollarText.length + '[['.length,
                                },
                                to: {
                                    line: start.line,
                                    ch: start.ch + this.beforeDollarText.length + '[['.length,
                                },
                                text: insertText,
                            }
                        ]
                    });
                    editor.setSelection({
                        line: start.line,
                        ch: start.ch + this.beforeDollarText.length + '[['.length + (this.isBlockKey ? 2 : 1)
                    });

                    this.isBlockKey = false;
                    this.isLineKey = false;
                    this.isHeadingKey = false;
                }, 200);


            }

            console.log(this.context.query, this.context.start, this.context.end);

            this.isModKey = false;
            this.isShiftKey = false;

            setTimeout(function () {
                return editor.focus();
            });
        }
        this.close();
    }
}
