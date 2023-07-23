import { type ServerCapabilities } from 'vscode-languageserver-protocol';

interface Capability {
  capability?: keyof ServerCapabilities;
  checkCommand?: (capability: ServerCapabilities) => void;
}

const methodRequirements: Record<string, Capability> = {
  'textDocument/callHierarchy': {
    capability: 'callHierarchyProvider',
  },
  'textDocument/codeAction': {
    capability: 'codeActionProvider',
  },
  'codeAction/resolve': {
    checkCommand: () => {
      // Implementation here
    },
  },
  'textDocument/codeLens': {
    capability: 'codeLensProvider',
  },
  'textDocument/completion': {
    capability: 'completionProvider',
  },
  'completionItem/resolve': {
    checkCommand: (capability: ServerCapabilities) => {
      // Implementation here
      return capability.completionProvider?.resolveProvider;
    },
  },
  'textDocument/declaration': {
    capability: 'declarationProvider',
  },
  'textDocument/definition': {
    capability: 'definitionProvider',
  },
  'textDocument/documentColor': {
    capability: 'colorProvider',
  },
  'textDocument/documentLink': {
    capability: 'documentLinkProvider',
  },
  'textDocument/documentHighlight': {
    capability: 'documentHighlightProvider',
  },
  'textDocument/documentSymbol': {
    capability: 'documentSymbolProvider',
  },
  'textDocument/foldingRange': {
    capability: 'foldingRangeProvider',
  },
  'textDocument/formatting': {
    capability: 'documentFormattingProvider',
  },
  'textDocument/hover': {
    capability: 'hoverProvider',
  },
  'textDocument/implementation': {
    capability: 'implementationProvider',
  },
  'textDocument/linkedEditingRange': {
    capability: 'linkedEditingRangeProvider',
  },
  'textDocument/onTypeFormatting': {
    capability: 'documentOnTypeFormattingProvider',
  },
  'textDocument/prepareRename': {
    checkCommand: () => {
      // Implementation here
    },
  },
  'textDocument/rangeFormatting': {
    capability: 'documentRangeFormattingProvider',
  },
  'textDocument/references': {
    capability: 'referencesProvider',
  },
  'textDocument/rename': {
    capability: 'renameProvider',
  },
  'textDocument/selectionRange': {
    capability: 'selectionRangeProvider',
  },
  'textDocument/semanticTokens': {
    capability: 'semanticTokensProvider',
  },
  'textDocument/semanticTokensFull': {
    checkCommand: () => {
      // Implementation here
    },
  },
  'textDocument/semanticTokensFull/Delta': {
    checkCommand: () => {
      // Implementation here
    },
  },
  'textDocument/semanticTokensRangeProvider': {
    checkCommand: () => {
      // Implementation here
    },
  },
  'textDocument/signatureHelp': {
    capability: 'signatureHelpProvider',
  },
  'textDocument/typeDefinition': {
    capability: 'typeDefinitionProvider',
  },
  'textDocument/typeHierarchy': {
    capability: 'typeHierarchyProvider',
  },
  'workspace/executeCommand': {
    capability: 'executeCommandProvider',
  },
  'workspace/symbol': {
    capability: 'workspaceSymbolProvider',
  },
};

export default methodRequirements;
