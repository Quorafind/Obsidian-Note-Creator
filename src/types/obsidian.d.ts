import 'obsidian';

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

  interface EditorSuggest<T> {
    type: string;
  }

  interface EditorSuggest<T> {
    suggestions: any;
  }
}
