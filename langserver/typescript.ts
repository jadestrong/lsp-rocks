const typescript: ServerConfig = {
  name: 'ts-ls',
  command: 'typescript-language-server',
  args: ['--stdio'],
  supportExtensions: ['tsx', 'jsx', 'ts', 'js', 'mjs', '.mts'],
  initializeOptions: () => ({
    logVerbosity: 'off',
    maxTsServerMemory: 3072,
    plugins: [
      {
        name: '@styled/typescript-styled-plugin',
        location:
          '/Users/bytedance/.config/yarn/global/node_modules/@styled/typescript-styled-plugin/',
      },
    ],
    preferences: {
      includePackageJsonAutoImports: 'on',
      includeAutomaticOptionalChainCompletions: true,
    },
    tsserver: {
      logVerbosity: 'off',
      path: '/opt/homebrew/bin/tsserver',
    },
  }),
  settings: {
    javascript: {
      autoClosingTags: true,
      implicitProjectConfig: {
        checkJs: false,
        experimentalDecorators: false,
      },
      preferences: {
        importModuleSpecifier: 'auto',
        quoteStyle: 'auto',
        renameShorthandProperties: true,
      },
      referencesCodeLens: {
        enabled: false,
      },
      suggest: {
        autoImports: true,
        completeFunctionCalls: false,
        completeJSDocs: true,
        enabled: true,
        names: true,
        paths: true,
      },
      suggestionActions: {
        enabled: true,
      },
      updateImportsOnFileMove: {
        enabled: 'prompt',
      },
      validate: {
        enable: true,
      },
      format: {
        enable: false,
        insertSpaceAfterCommaDelimiter: true,
        insertSpaceAfterConstructor: false,
        insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
        insertSpaceAfterKeywordsInControlFlowStatements: true,
        insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: false,
        insertSpaceAfterOpeningAndBeforeClosingEmptyBraces: false,
        insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
        insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
        insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
        insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
        insertSpaceAfterSemicolonInForStatements: true,
        insertSpaceBeforeAndAfterBinaryOperators: true,
        insertSpaceBeforeFunctionParenthesis: false,
        placeOpenBraceOnNewLineForControlBlocks: false,
        placeOpenBraceOnNewLineForFunctions: false,
      },
      inlayHints: {
        includeInlayEnumMemberValueHints: true,
        includeInlayFunctionLikeReturnTypeHints: true,
        includeInlayFunctionParameterTypeHints: true,
        includeInlayParameterNameHints: 'none',
        includeInlayParameterNameHintsWhenArgumentMatchesName: true,
        includeInlayPropertyDeclarationTypeHints: true,
        includeInlayVariableTypeHints: true,
      },
    },
    typescript: {
      autoClosingTags: true,
      check: {
        npmIsInstalled: true,
      },
      disableAutomaticTypeAcquisition: false,
      implementationsCodeLens: {
        enabled: false,
      },
      preferences: {
        importModuleSpecifier: 'auto',
        quoteStyle: 'auto',
        renameShorthandProperties: true,
      },
      referencesCodeLens: {
        enabled: false,
      },
      reportStyleChecksAsWarnings: true,
      suggest: {
        autoImports: true,
        completeFunctionCalls: false,
        completeJSDocs: true,
        enabled: true,
        paths: true,
      },
      suggestionActions: {
        enabled: true,
      },
      surveys: {
        enabled: true,
      },
      tsc: {
        autoDetect: 'on',
      },
      tsserver: {
        log: 'off',
        trace: 'off',
      },
      updateImportsOnFileMove: {
        enabled: 'prompt',
      },
      validate: {
        enable: true,
      },
      format: {
        enable: false,
        insertSpaceAfterCommaDelimiter: true,
        insertSpaceAfterConstructor: false,
        insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
        insertSpaceAfterKeywordsInControlFlowStatements: true,
        insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: false,
        insertSpaceAfterOpeningAndBeforeClosingEmptyBraces: false,
        insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
        insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
        insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
        insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
        insertSpaceAfterSemicolonInForStatements: true,
        insertSpaceAfterTypeAssertion: false,
        insertSpaceBeforeAndAfterBinaryOperators: true,
        insertSpaceBeforeFunctionParenthesis: false,
        placeOpenBraceOnNewLineForControlBlocks: false,
        placeOpenBraceOnNewLineForFunctions: false,
      },
      inlayHints: {
        includeInlayEnumMemberValueHints: true,
        includeInlayFunctionLikeReturnTypeHints: true,
        includeInlayFunctionParameterTypeHints: true,
        includeInlayParameterNameHints: 'none',
        includeInlayParameterNameHintsWhenArgumentMatchesName: true,
        includeInlayPropertyDeclarationTypeHints: true,
        includeInlayVariableTypeHints: true,
      },
      tsdk: '/Users/bytedance/Documents/JadeStrong/byteair_i18n/node_modules/typescript/lib',
    },
    completions: {
      completeFunctionCalls: true,
    },
  },
  initializedFn: result => {
    // send didChangeConfiguration notify
    return result;
  },
  activate: () => {
    return true;
  },
};

export default typescript;
