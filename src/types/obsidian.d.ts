import 'obsidian';
import { Modifier } from "obsidian";

declare module 'obsidian' {
    interface App {
        appId: string;
        plugins: {
            getPlugin(name: string): any;
        };
        commands: any;
    }

    interface Vault {
        getConfig: (name: string) => any;
    }

    interface Workspace {
        editorSuggest: {
            suggests: EditorSuggest<any>[];
        };
    }

    // @ts-ignore
    interface CustomScope extends Scope {
        register: (modifiers: null, key: string | null, func: KeymapEventListener) => KeymapEventHandler;
    }

    interface EditorSuggest<T> {
        type: string;
    }

    interface EditorSuggest<T> {
        suggestions: any;
    }
}
