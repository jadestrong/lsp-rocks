import {
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
    args: string[];
    supportExtensions: string[];
    settings: Record<string, unknown>; // default is a {}
    initializeOptions?: () => Record<string, unknown>; // default return settings
    activate: (workspaceRoot: string) => boolean; // default return false
    initializedFn?: (result: InitializeResult) => InitializeResult;
  }
}
