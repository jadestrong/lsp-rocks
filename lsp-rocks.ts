import { LanguageClient } from './client';
import { RPCServer } from 'ts-elrpc';
import { get_emacs_func_result, init_epc_server, logger, message_emacs, send_response_to_emacs } from './epc-utils';
import { toggleDebug } from './log';
import { TextDocumentIdentifier } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
// import { importLangServers } from './utils/importLangServers';

interface InitParams {
  language: string;
  project: string;
  command: string;
  args: string[];
  clientInfo: { name: string, version: string };
}

interface Message {
  id: string,
  cmd: string,
}

interface RequestMessage extends Message {
  lang: string;
  project: string;
  params: {
    textDocument: TextDocumentIdentifier
    [key: string]: any
  };
}

export class LspRocks {
  private _server: RPCServer | null;

  readonly _filePathToProject: Map<string, string> = new Map();
  readonly _clients: Map<string, LanguageClient>;

  readonly _recentRequests: Map<string, any>;
  _langServerMap: Record<string, any>

  constructor() {
    this._clients = new Map();
    this._recentRequests = new Map();
    // importLangServers().then(configs => {
    //   this._langServerMap = configs
    // })
  }

  public async start() {
    this._server = await init_epc_server();
    this._server?.defineMethod('message', async (message: RequestMessage) => {
      this._recentRequests.set(message.cmd, message.id);
      const response = await this.messageHandler(message);
      if (response?.data != null) {
        send_response_to_emacs(response)
      }
    });

    this._server?.defineMethod('request', async (message: RequestMessage) => {
      this._recentRequests.set(message.cmd, message.id);
      const response = await this.messageHandler(message);
      return response?.data
    })

    this._server?.defineMethod('lsp-rocks--toggle-trace-io', () => {
      const isDebug = toggleDebug()
      if (this._server?.logger) {
        this._server.logger.level = isDebug ? 'debug' : 'info';
      }
      message_emacs(`LSP-ROCKS :: Server logging ${isDebug ? 'enabled' : 'disabled'}`)
    })

    this._server?.defineMethod('get-elrpc-logfile', async () => {
      return this._server?.logfile ?? ''
    })
  }

  public async messageHandler(req: RequestMessage) {
    const { id, cmd, params } = req;
    params.textDocument.uri = URI.file(params.textDocument.uri).toString()
    logger.info(`receive message => id: ${id}, cmd: ${cmd}, params: ${JSON.stringify(req.params)}`);

    let data: any = null;
    const { textDocument: { uri } } = params
    let projectRoot = this._filePathToProject.get(uri);

    if (!projectRoot) {
      projectRoot = await get_emacs_func_result<string>('lsp-rocks--suggest-project-root')
      this._filePathToProject.set(uri, projectRoot);
    }

    const client = await this.ensureClient(projectRoot);

    if (this._recentRequests.get(req.cmd) != req.id && req.cmd != 'textDocument/didChange') {
      return;
    }

    data = await client.on(req.cmd, req.params);
    if (this._recentRequests.get(req.cmd) != req.id) {
      return;
    }
    return {
      id,
      cmd,
      data
    };
  }

  private async ensureClient(clientId: string): Promise<LanguageClient> {
    let client = this._clients.get(clientId);
    if (client === undefined) {
      const params = await get_emacs_func_result<InitParams>('lsp-rocks--init');
      if (params != undefined) {
        client = new LanguageClient(params.language, params.project, params.clientInfo, {
          command: params.command,
          args: params.args,
          options: { cwd: params.project },
        });
        this._clients.set(clientId, client);
        await client.start();
        // eval_in_emacs('lsp-rocks--inited')
      } else {
        message_emacs('Can not create LanguageClient, because language and project is undefined')
        throw new Error('Can not create LanguageClient, because language and project is undefined');
      }
    }

    return client;
  }
}
