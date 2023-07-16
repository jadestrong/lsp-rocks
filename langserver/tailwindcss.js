const path = require('path');
const fs = require('fs');
/**
 * @type { ServerConfig }
 */
module.exports = {
  name: 'tailwindcss',
  command: 'tailwindcss-language-server',
  args: ['--stdio'],
  supportExtensions: ['tsx'],
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
  activate: workspaceRoot => {
    const configFiles = [
      'tailwind.config.js',
      path.join('config', 'tailwind.config.js'),
      path.join('assets', 'tailwind.config.js'),
      'tailwind.config.cjs',
      path.join('config', 'tailwind.config.cjs'),
      path.join('assets', 'tailwind.config.cjs'),
      'tailwind.config.ts',
      path.join('config', 'tailwind.config.ts'),
      path.join('assets', 'tailwind.config.ts'),
    ];

    return configFiles.some(configFile =>
      fs.existsSync(path.join(workspaceRoot, configFile)),
    );
  },
  initializedFn: result => {
    // NOTE Workaround the problem that company-mode completion not work when typing \"-\" in classname.
    // As company-grap-symbol return nil when before char isn't a symbol.
    if (result.capabilities.completionProvider.triggerCharacters) {
      result.capabilities.completionProvider.triggerCharacters.push('-');
    }
    return result;
  },
};
