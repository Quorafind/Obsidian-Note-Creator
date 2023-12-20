import QuickNoteCreatorPlugin from "./quickNoteCreatorIndex";
import { AbstractInputSuggest, App, debounce, PluginSettingTab, Setting, TFolder } from "obsidian";
import { FolderSuggest } from "./suggesters/FolderSuggester";

export interface QuickNoteCreatorSettings {
    use_templater_templates: boolean;
    templates_folder: string;
}

export const DEFAULT_SETTINGS: QuickNoteCreatorSettings = {
    use_templater_templates: true,
    templates_folder: 'templates',
};

export class QuickNoteCreatorSettingTab extends PluginSettingTab {

    constructor(app: App, private readonly plugin: QuickNoteCreatorPlugin) {
        super(app, plugin);
    }

    updateSettings(key: any, value: any) {
        this.plugin.settings = {
            ...this.plugin.settings,
            [key]: value,
        };
        this.applySettingsUpdate();
    }

    applySettingsUpdate = debounce(async ()=>{
         await this.plugin.saveSettings();
    }, 400, true);

    //eslint-disable-next-line
    async hide() {}

    async display(): Promise<void> {
        await this.plugin.loadSettings();

        this.containerEl.empty();

        this.containerEl.createEl('h2', {text: 'Quick Note Creator Settings'});

        this.useTemplaterTemplates();
    }

    useTemplaterTemplates() {
        new Setting(this.containerEl)
            .setName("Use Templater plugin's templates")
            .addToggle((toggle) => {
                toggle
                    .setValue(this.plugin.settings.use_templater_templates)
                    .onChange(async (value) => {
                        this.updateSettings('use_templater_templates', value);
                        this.applySettingsUpdate();

                        setTimeout(()=>{
                            this.display();
                        }, 500)
                    });
            });

        if(this.plugin.settings.use_templater_templates) return;

        new Setting(this.containerEl)
            .setName("Templates folder")
            .setDesc("The folder where your templates are stored")
            .addSearch((cb) => {
                new FolderSuggest(cb.inputEl);
                cb.setPlaceholder("Example: folder1/folder2")
                    .setValue(this.plugin.settings.templates_folder)
                    .onChange((new_folder) => {
                        this.updateSettings('templates_folder', new_folder);
                        this.applySettingsUpdate();
                    });
                // @ts-ignore
                cb.containerEl.addClass("templater_search");
            });
    }
}

