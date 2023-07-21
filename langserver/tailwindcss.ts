import { existsSync } from 'fs';
import { join } from 'path';
import { type InitializeResult } from 'vscode-languageserver-protocol';

const tailwindcss: ServerConfig = {
  name: 'tailwindcss',
  command: 'tailwindcss-language-server',
  args: ['--stdio'],
  supportExtensions: ['tsx', 'jsx'],
  initializeOptions: function () {
    const { editor, tailwindCSS } = this.settings;
    return {
      ...editor,
      ...tailwindCSS,
    };
  },
  settings: {
    editor: {
      userLanguages: {
        eelixir: 'html-eex',
        eruby: 'erb',
      },
    },
    tailwindCSS: {
      emmetCompletions: false,
      showPixelEquivalents: true,
      rootFontSize: 16,
      validate: true,
      hovers: true,
      suggestions: true,
      codeActions: true,
      lint: {
        invalidScreen: 'error',
        invalidVariant: 'error',
        invalidTailwindDirective: 'error',
        invalidApply: 'error',
        invalidConfigPath: 'error',
        cssConflict: 'warning',
        recommendedVariantOrder: 'warning',
      },
      experimental: {
        classRegex: '',
      },
      classAttributes: ['class', 'className', 'ngClass'],
    },
  },
  activate: (_, workspaceRoot) => {
    const configFiles = [
      'tailwind.config.js',
      join('config', 'tailwind.config.js'),
      join('assets', 'tailwind.config.js'),
      'tailwind.config.cjs',
      join('config', 'tailwind.config.cjs'),
      join('assets', 'tailwind.config.cjs'),
      'tailwind.config.ts',
      join('config', 'tailwind.config.ts'),
      join('assets', 'tailwind.config.ts'),
    ];

    return configFiles.some(configFile =>
      existsSync(join(workspaceRoot, configFile)),
    );
  },
  initializedFn: (result: InitializeResult) => {
    // NOTE Workaround the problem that company-mode completion not work when typing \"-\" in classname.
    // As company-grap-symbol return nil when before char isn't a symbol.
    if (result.capabilities.completionProvider?.triggerCharacters) {
      result.capabilities.completionProvider.triggerCharacters.push('-');
    }
    return result;
  },
};

export default tailwindcss;
