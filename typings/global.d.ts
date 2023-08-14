import {
  CompletionItem,
  ConfigurationItem,
  InitializeResult,
  type TextDocumentIdentifier,
} from 'vscode-languageserver-protocol';

declare global {
  interface Message {
    id: string;
    cmd: string;
  }

  interface RequestMessage extends Message {
    lang: string;
    project: string;
    params: {
      textDocument: TextDocumentIdentifier;
      [key: string]: any;
    };
  }

  interface ServerConfig {
    name: string;
    command: string;
    multiRoot?: boolean;
    args: string[];
    supportExtensions: string[];
    settings: Record<string, unknown>; // default is a {}
    configuration?: (
      items: ConfigurationItem[],
      fileUriToProject: Map<string, string>,
    ) => Array<object | null>;
    initializeOptions?: () => Record<string, unknown>; // default return settings
    activate: (filepath: string, workspaceRoot: string) => boolean; // default return false
    initializedFn?: (result: InitializeResult) => InitializeResult;
  }

  interface EmacsCompletionItem extends CompletionItem {
    no?: string;
    source?: string;
    resolving?: Promise<CompletionItem>;
    start: number;
    end: number;
  }
}
