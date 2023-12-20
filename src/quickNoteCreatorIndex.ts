import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo, FuzzyMatch, normalizePath,
	Plugin, prepareFuzzySearch, TAbstractFile, TFile, TFolder, Vault
} from 'obsidian';

export function resolve_tfolder(folder_str: string): TFolder {
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

export function get_tfiles_from_folder(folder_str: string): Array<TFile> {
	const folder = resolve_tfolder(folder_str);

	const files: Array<TFile> = [];
	Vault.recurseChildren(folder, (file: TAbstractFile) => {
		if (file instanceof TFile) {
			files.push(file);
		}
	});

	files.sort((a, b) => {
		return a.basename.localeCompare(b.basename);
	});

	return files;
}

export default class QuickNoteCreatorPlugin extends Plugin {
	async onload() {
		this.app.workspace.onLayoutReady(()=>{
			this.initSuggestion();
		})
	}

	onunload() {

	}

	initSuggestion() {
		const existed = this.app.workspace.editorSuggest.suggests.findIndex((suggest) => suggest.type === 'quick-add-tag');
		console.log(existed);
		if (existed !== -1) {
			this.app.workspace.editorSuggest.suggests.splice(existed, 1);
			this.app.workspace.editorSuggest.suggests.unshift(new QuickNoteCreatorSuggest(this.app, this));
		} else {
			this.app.workspace.editorSuggest.suggests.unshift(new QuickNoteCreatorSuggest(this.app, this));
		}
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

	hasDoubleBrackets: boolean = false;

	isModKey: boolean = false;
	isShiftKey: boolean = false;

	files: TFile[] = [];

	// 新的正则表达式，匹配以 `[[` 开头，且之后不包含 `[` 和 `]` 的字符串
	readonly CUSTOM_TAG_REGEX = /\[\[([^\[\]]+)/;

	constructor(app: App, plugin: QuickNoteCreatorPlugin) {
		super(app);
		this.plugin = plugin;

		this.setInstructions([
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
		])

		this.templaterPlugin = this.app.plugins.getPlugin('templater-obsidian');
		this.templater = this.templaterPlugin.templater;

		this.scope.register(['Mod'], 'Enter', (evt) => {
			evt.preventDefault();
			this.isModKey = true;
			this.suggestions.useSelectedItem(evt);
		});

		this.scope.register(['Shift'], 'Enter', (evt) => {
			evt.preventDefault();
			this.isModKey = true;
			this.suggestions.useSelectedItem(evt);
		});
	}

	fuzzySearchItemsOptimized(query: string, items: string[]): FuzzyMatch<string>[] {
		// 使用 prepareFuzzySearch 来创建一个预先准备好的查询函数
		const preparedSearch = prepareFuzzySearch(query);

		const matches: FuzzyMatch<string>[] = items
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

		return matches;
	}

	onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
		// if (!this.checkSettings()) return null;
		this.files = get_tfiles_from_folder(this.templaterPlugin.settings.templates_folder);

		this.cursor = cursor;
		this.editor = editor;
		const currentLineNum = cursor.line;
		const currentLineText = editor.getLine(currentLineNum);
		const textUntilCursor = currentLineText.slice(0, cursor.ch);
		const textAfterCursor = currentLineText.slice(cursor.ch);

		const match = textUntilCursor.match(this.CUSTOM_TAG_REGEX);

		if (match) {
			const matchedText = match[1]; // 获取匹配到的文本
			const dollarIndex = matchedText.indexOf('$');
			if (dollarIndex !== -1) {
				this.afterDollarText = matchedText.slice(dollarIndex + 1);
				this.beforeDollarText = matchedText.slice(0, dollarIndex);

				this.hasDoubleBrackets = textAfterCursor.indexOf(']]') !== -1;

				return {
					start: {
						line: currentLineNum,
						ch: match.index,
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
			})

		if(query.length === 0) {
			return ['Create note with tag: ' + `#${context.query}`]
		}


		return (
			query || []
		);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		if (this.context) {
			console.log(this.isModKey);

			const editor = this.context.editor;
			const start = this.context.start;
			const end = this.context.end;

			let targetValue = this.isShiftKey || value.contains(':') ? `---\ntags: \n  - ${this.context.query}\n---\n` : `${this.context.query}`;

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
			this.templater.create_new_note_from_template(file || targetValue, undefined, this.beforeDollarText, this.isModKey);

			this.isModKey = false;
			this.isShiftKey = false;

			setTimeout(function () {
				return editor.focus();
			});
		}
		this.close();
	}
}
