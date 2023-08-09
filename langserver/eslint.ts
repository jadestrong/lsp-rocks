import { basename, dirname } from 'path';
import { URI } from 'vscode-uri';

const eslint: ServerConfig = {
  name: 'eslint',
  args: ['--stdio'],
  settings: {},
  configuration(items, filePathToProject) {
    return items.map(item => {
      const { scopeUri } = item;
      if (!scopeUri) {
        return null;
      }
      const projectRoot = filePathToProject.get(scopeUri);
      if (!projectRoot) {
        return null;
      }
      // const filePath = URI.parse(scopeUri).path;
      // 找出这个 file 所属的 projectRoot
      return {
        validate: 'probe',
        packageManager: 'npm',
        useESLintClass: false,
        codeAction: {
          disableRuleComment: {
            enable: true,
            location: 'separateLine',
          },
          showDocumentation: {
            enable: true,
          },
        },
        codeActionOnSave: {
          enable: false,
          mode: 'all',
        },
        format: true,
        quiet: false,
        onIgnoredFiles: 'off',
        options: {},
        rulesCustomizations: [],
        run: 'onType',
        nodePath: null,
        workingDirectory: null,
        workspaceFolder: {
          name: basename(projectRoot),
          uri: URI.file(projectRoot).toString(),
        },
        experimental: {
          useFlatConfig: false,
        },
        problems: {
          shortenToSingleLine: false,
        },
      };
    });
  },
  supportExtensions: ['ts', 'tsx', 'js', 'jsx', 'vue'],
  command: 'vscode-eslint-language-server',
  activate: function (): boolean {
    return true;
  },
};

export default eslint;
