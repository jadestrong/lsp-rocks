const eslint: ServerConfig = {
  name: 'esint',
  args: ['--stdio'],
  settings: {},
  supportExtensions: ['ts', 'tsx', 'js', 'jsx', 'vue'],
  command: 'vscode-eslint-language-server',
  activate: function (filePath: string, workspaceRoot: string): boolean {
    return false;
    // throw new Error('Function not implemented.');
  },
};

export default eslint;
