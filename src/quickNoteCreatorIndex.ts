import {
    AbstractInputSuggest,
    App,
    CustomScope,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    FuzzyMatch,
    Notice,
    Plugin,
    prepareFuzzySearch,
    TFile
} from 'obsidian';
import { DEFAULT_SETTINGS, QuickNoteCreatorSettings, QuickNoteCreatorSettingTab } from "./quickNoteCreatorSetting";
import { get_folder, get_tfiles_from_folder } from "./utils";
import { around } from "monkey-around";

export default class QuickNoteCreatorPlugin extends Plugin {
    settings: QuickNoteCreatorSettings;
    settingTab: QuickNoteCreatorSettingTab;

    patchTarget: any;
    hasLoaded: boolean = false;

    async onload() {

        this.patchSuggestions();
        this.patchFrontMatterSuggestions();
        await this.loadSettings();
        this.settingTab = new QuickNoteCreatorSettingTab(this.app, this);
        this.addSettingTab(this.settingTab);

        this.app.workspace.onLayoutReady(() => {
            this.initSuggestion();
        });

    }

    onunload() {
        console.log('unloading plugin');
    }

    /**
     * Initializes the suggestion functionality in the application.
     * This method checks for the existence of a 'quick-add-tag' type suggestion.
     * If it exists, it removes it and adds a new QuickNoteCreatorSuggest at the beginning of the suggestions array.
     * If it doesn't exist, it simply adds a new QuickNoteCreatorSuggest at the beginning.
     */
    initSuggestion() {
        const existed = this.app.workspace.editorSuggest.suggests.findIndex((suggest) => suggest.type === 'quick-add-tag');
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

    patchFrontMatterSuggestions() {
        const alreadyGetPatchTarget = () => {
            return this.patchTarget !== undefined;
        }

        const hasLoaded = () => {
            return this.hasLoaded;
        }

        const triggerLoaded = () => {
            this.hasLoaded = true;
        }

        const getPlugin = () => {
            return this;
        }

        const addInstruction = (suggestEl: HTMLElement) => {
            const instructionsEl = (suggestEl as HTMLElement).find('.prompt-instructions');
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

        const setPatchTarget = (patchTarget: any) => {
            this.patchTarget = patchTarget;

            around(patchTarget.constructor.prototype, {
                getSuggestions: (next) => {
                    return function (args: string) {
                        if(!hasLoaded()) {
                            this.plugin = getPlugin();
                            try {
                                this.templaterPlugin = this.app.plugins.getPlugin('templater-obsidian');
                                this.templater = this.templaterPlugin.templater;
                            } catch (e) {
                                console.log(e);
                                new Notice('Templater plugin is not installed or enabled. Please install and enable it to use this plugin.');
                            }

                            this.type = 'quick-add-tag';

                            this.afterDollarText = '';
                            this.beforeDollarText = '';
                            this.betwennDollarAndHeadingText = '';

                            this.hasDoubleBrackets = false;

                            this.isModKey = false;
                            this.isShiftKey = false;

                            this.isDollarKey = false;
                            this.isHeadingKey = false;
                            this.isBlockKey = false;
                            this.isLineKey = false;

                            this.files = [];

                            triggerLoaded();
                        }

                        // check if this start with `[[`
                        if(args.startsWith('[[')) {
                            if(this.suggestEl) addInstruction(this.suggestEl);

                            const targetTemplatePath = this.templaterPlugin && this.plugin.settings.use_templater_templates ? this.templaterPlugin?.settings.templates_folder : this.plugin?.settings.templates_folder;
                            if(targetTemplatePath) this.files = get_tfiles_from_folder(this.app, targetTemplatePath);

                            const CUSTOM_TAG_REGEX = /\[\[([^\[\]]+)/
                            const match = args.match(CUSTOM_TAG_REGEX);
                            if(match) {
                                const matchedText = match[1];
                                const dollarIndex = matchedText.indexOf('$');
                                this.isDollarKey = dollarIndex !== -1;
                                if (dollarIndex !== -1) {
                                    this.afterDollarText = matchedText.slice(dollarIndex + 1);
                                    this.beforeDollarText = matchedText.slice(0, dollarIndex);

                                    const textAfterCursor = args.slice(dollarIndex || 0);
                                    this.hasDoubleBrackets = textAfterCursor.indexOf(']]') !== -1;

                                    return this.calculateSuggestions(this.afterDollarText);
                                }
                            }
                        }


                        const result = next.call(this, args);

                        return result;
                    }
                },
                selectSuggestion: (next) => {
                    return async function (...args: any) {
                        if (typeof args[0] === 'string') {
                            const value = args[0];
                            const shouldBuildTags = this.isShiftKey || value.includes(':');
                            const shouldUseFile = !shouldBuildTags;
                            const shouldCreateNote = !this.templater;
                            const shouldAddFormatting = (this.getFormattingFlags()) && !this.isModKey;

                            const tagValue = this.buildTagValue(value);
                            const targetValue = shouldBuildTags ? `---\ntags:\n${tagValue}\n---\n` : value;

                            this.insertClosingBracketsIfNeeded(value);

                            const selectedFile = shouldUseFile ? this.findFileByName(value) : '';
                            await this.processTemplate(selectedFile, targetValue);

                            // if (shouldAddFormatting) {
                            //     this.formatAndSetSelection(editor, start);
                            // }

                            this.resetFlags();
                            this.close();

                            return ;
                        }

                        const result = next.call(this, ...args);
                        return result;
                    }
                },
                renderSuggestion: (next)=> {
                    return function (...args: any) {
                        if(typeof args[0] === 'string') {
                            (args[1] as HTMLElement).setText(args[0]);
                            return;
                        }

                        const result = next.call(this, ...args);
                        return result;
                    }
                },
                calculateSuggestions: (next) => {
                    return function (queryString: string) {
                        const names = this.files.map((file: TFile) => file.basename);

                        const query = this.fuzzySearchItemsOptimized(queryString, names)
                            .map((match: FuzzyMatch<string>) => match.item)
                            .sort((a: string, b: string) => {
                                return a.localeCompare(b);
                            });

                        if (query.length === 0) {
                            return ['Create note with tag:' + queryString.trim().split(' ').map((tag) => {
                                return tag.startsWith('#') ? (' ' + tag) : (' #' + tag);
                            }).join(' ')];
                        }

                        return (
                            query
                        );
                    }
                },
                fuzzySearchItemsOptimized: (next) => {
                    return function (query: string, items: string[]): FuzzyMatch<string>[] {
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
                },
                buildTagValue: (next) => {
                    return function (query: string): string {
                        return query.trim().split(' ').map(tag => `  - ${tag}`).join('\n');
                    }
                },
                insertClosingBracketsIfNeeded: (next) => {
                    return function (query: string) {
                        this.setValue('[[' + this.beforeDollarText + ']]');
                    }
                },
                showNoticeIfTemplaterNotInstalled: (next) => {
                    return function () {
                        new Notice(
                            'Templater plugin is not installed or enabled. Please install and enable it to use this plugin.'
                        );
                    }
                },
                processTemplate: (next) => {
                    return async function (file: TFile | string, targetValue: string) {
                        if (this.templater) {
                            this.templater.create_new_note_from_template(file || targetValue, undefined, this.beforeDollarText, this.isModKey);
                            return;
                        }

                        this.showNoticeIfTemplaterNotInstalled();
                        const template = file instanceof TFile ? await this.app.vault.read(file) : '';
                        const newFile = await this.createNewNoteFromTemplate(template, targetValue);

                        if (this.isModKey && newFile) {
                            this.openLinkForNewFile(newFile);
                        }
                    }
                },
                findFileByName: (next) => {
                    return function (value: string): TFile | string {
                        return this.files.find((file: TFile) => file.basename === value) ?? '';
                    }
                },
                createNewNoteFromTemplate: (next) => {
                    return async function (template: string, targetValue: string) {
                        const folder = get_folder(this.app);
                        const path = `${folder?.path ?? ''}/${this.beforeDollarText}.md`;
                        return await this.app.vault.create(path, targetValue + template);
                    }
                },
                openLinkForNewFile: (next) => {
                    return async function (newFile: TFile) {
                        await this.app.workspace.openLinkText(newFile.path, '', true);
                    }
                },
                formatAndSetSelection: (next) => {
                    return function (editor: Editor, start: EditorPosition) {
                        const insertText = this.getInsertText();
                        const insertLength = this.isBlockKey ? 2 : 1;
                        setTimeout(() => {
                            this.resetFormattingFlags();
                        }, 200);
                    }
                },
                getInsertText: (next) => {
                    return function () {
                        if (this.isHeadingKey) return '#';
                        if (this.isLineKey) return '|';
                        if (this.isBlockKey) return '#^';
                        return '';
                    }
                },
                getFormattingFlags: (next) => {
                    return function () {
                        return this.isHeadingKey || this.isLineKey || this.isBlockKey;
                    }
                },
                resetFormattingFlags: (next) => {
                    return function () {
                        this.isBlockKey = false;
                        this.isLineKey = false;
                        this.isHeadingKey = false;
                    }
                },
                resetFlags: (next) => {
                    return function () {
                        this.isModKey = false;
                        this.isShiftKey = false;
                    }
                },
                focusEditorAfterDelay: (next) => {
                    return function (editor: Editor) {
                        setTimeout(() => editor.focus());
                    }
                }
            })

        }

        around(AbstractInputSuggest.prototype as any, {
            showSuggestions: (next) => {
                return function (args: any) {
                    if(!alreadyGetPatchTarget()) {
                        setPatchTarget(this);
                    }
                    const result = next.call(this, args);

                    return result;
                }
            },
        })
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
            command: 'Type ↩',
            purpose: 'to create a Templater note'
        },
        {
            command: 'Type ⌘ + ↩',
            purpose: 'to create and open'
        },
        {
            command: 'Type ⇧ + ↩',
            purpose: 'to create with value as tag'
        },
        {
            command: 'Type #/^/|',
            purpose: 'to add heading/block/alias link'
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

        this.initScopeEvents();
    }

    initScopeEvents() {
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

        (this.scope as unknown as CustomScope).register(null, '#', (evt) => {
            evt.preventDefault();
            this.isHeadingKey = true;
            this.suggestions.useSelectedItem(evt);
        });

        (this.scope as unknown as CustomScope).register(null, '^', (evt) => {
            evt.preventDefault();
            this.isBlockKey = true;
            this.suggestions.useSelectedItem(evt);
        });

        (this.scope as unknown as CustomScope).register(null, '|', (evt) => {
            evt.preventDefault();
            this.isLineKey = true;
            this.suggestions.useSelectedItem(evt);
        });
    }

    fuzzySearchItemsOptimized(query: string, items: string[]): FuzzyMatch<string>[] {
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
            const matchedText = match[1];
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
            query
        );
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.setText(value);
    }

    async selectSuggestion(value: string): Promise<void> {
        const shouldBuildTags = this.isShiftKey || value.includes(':');
        const shouldUseFile = !shouldBuildTags;
        const shouldCreateNote = !this.templater;
        const shouldAddFormatting = (this.getFormattingFlags()) && !this.isModKey;

        if (!this.context) {
            this.close();
            return;
        }

        const {editor, start, end, query} = this.context;
        const tagValue = this.buildTagValue(query);
        const targetValue = shouldBuildTags ? `---\ntags:\n${tagValue}\n---\n` : query;

        this.insertClosingBracketsIfNeeded(editor, start, end, query);

        const selectedFile = shouldUseFile ? this.findFileByName(value) : '';
        await this.processTemplate(selectedFile, targetValue);

        if (shouldAddFormatting) {
            this.formatAndSetSelection(editor, start);
        } else {
            editor.setSelection({line: start.line, ch: start.ch + this.beforeDollarText.length + 4});
        }

        this.resetFlags();
        this.focusEditorAfterDelay(editor);

        this.close();
    }

    private buildTagValue(query: string): string {
        return query.trim().split(' ').map(tag => `  - ${tag}`).join('\n');
    }

    private insertClosingBracketsIfNeeded(editor: Editor, start: EditorPosition, end: EditorPosition, query: string) {
        editor.transaction({
            changes: [{
                from: {line: start.line, ch: end.ch - query.length - 1},
                to: end,
                text: this.hasDoubleBrackets ? '' : ']]'
            }],
        });
    }

    private async processTemplate(file: TFile | string, targetValue: string) {
        if (this.templater) {
            this.templater.create_new_note_from_template(file || targetValue, undefined, this.beforeDollarText, this.isModKey);
            return;
        }

        this.showNoticeIfTemplaterNotInstalled();
        const template = file instanceof TFile ? await this.app.vault.read(file) : '';
        const newFile = await this.createNewNoteFromTemplate(template, targetValue);

        if (this.isModKey && newFile) {
            this.openLinkForNewFile(newFile);
        }
    }

    private showNoticeIfTemplaterNotInstalled() {
        new Notice(
            'Templater plugin is not installed or enabled. Please install and enable it to use this plugin.'
        );
    }

    // A method to find a file by name
    private findFileByName(value: string): TFile | string {
        return this.files.find((file) => file.basename === value) ?? '';
    }

    // A method to create a new note from the template
    private async createNewNoteFromTemplate(template: string, targetValue: string) {
        const folder = get_folder(this.app);
        const path = `${folder?.path ?? ''}/${this.beforeDollarText}.md`;
        return await this.app.vault.create(path, targetValue + template);
    }

    // A method to open a link for a new file
    private async openLinkForNewFile(newFile: TFile) {
        await this.app.workspace.openLinkText(newFile.path, '', true);
    }

    // A method to format and set the selection in the editor
    private formatAndSetSelection(editor: Editor, start: EditorPosition) {
        const insertText = this.getInsertText();
        const insertLength = this.isBlockKey ? 2 : 1;
        setTimeout(() => {
            editor.transaction({
                changes: [{from: start, to: start, text: insertText}],
            });
            editor.setSelection({line: start.line, ch: start.ch + insertLength});
            this.resetFormattingFlags();
        }, 200);
    }

    // A method to get the correct text to insert based on flags
    private getInsertText(): string {
        if (this.isHeadingKey) return '#';
        if (this.isLineKey) return '|';
        if (this.isBlockKey) return '#^';
        return '';
    }

    private getFormattingFlags() {
        return this.isHeadingKey || this.isLineKey || this.isBlockKey;
    }

    // A method to reset the formatting-related flags
    private resetFormattingFlags() {
        this.isBlockKey = false;
        this.isLineKey = false;
        this.isHeadingKey = false;
    }

    // A method to reset action flags (mod and shift keys)
    private resetFlags() {
        this.isModKey = false;
        this.isShiftKey = false;
    }

    // A method to focus the editor after a given delay
    private focusEditorAfterDelay(editor: Editor) {
        setTimeout(() => editor.focus());
    }
}
