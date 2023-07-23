import { URI } from 'vscode-uri';
import * as path from 'node:path';
import { RPCServer } from 'ts-elrpc';
import {
  eval_in_emacs,
  get_emacs_func_result,
  init_epc_server,
  message_emacs,
  send_response_to_emacs,
} from './epc-utils';
import { LanguageClient } from './client';
import { toggleDebug, logger } from './logger';
import { importLangServers } from './utils/importLangServers';
import executable from './utils/executable';
import languageIdMap from './constants/languageIdMap';
import { CompletionItem } from 'vscode-languageserver-protocol';

export class LspRocks {
  private _server: RPCServer | null;

  readonly filePathToProject: Map<string, string> = new Map();
  readonly _clients: Map<string, LanguageClient[] | undefined>;

  readonly recentRequests: Map<string, any>;
  configs: ServerConfig[] = [];

  constructor() {
    this._clients = new Map();
    this.recentRequests = new Map();
  }

  public async start() {
    this._server = await init_epc_server();
    this._server?.defineMethod('message', async (message: RequestMessage) => {
      this.recentRequests.set(message.cmd, message.id);
      const response = await this.messageHandler(message);
      if (response?.data != null) {
        send_response_to_emacs(response);
      }
    });

    this._server?.defineMethod('request', async (message: RequestMessage) => {
      this.recentRequests.set(message.cmd, message.id);
      const response = await this.messageHandler(message);
      return response?.data;
    });

    this._server?.defineMethod('lsp-rocks--toggle-trace-io', () => {
      const isDebug = toggleDebug();
      if (this._server?.logger) {
        this._server.logger.level = isDebug ? 'debug' : 'info';
      }
      message_emacs(
        `LSP-ROCKS :: Server logging ${isDebug ? 'enabled' : 'disabled'}`,
      );
    });

    this._server?.defineMethod('get-elrpc-logfile', async () => {
      return this._server?.logfile ?? '';
    });

    this.configs = await importLangServers();
    message_emacs('config length ' + this.configs.length);
  }

  public async messageHandler(req: RequestMessage) {
    const { id, cmd, params } = req;
    const filepath = params.textDocument.uri;
    params.textDocument.uri = URI.file(filepath).toString();
    logger.info(
      `receive message => id: ${id}, cmd: ${cmd}, params: ${JSON.stringify(
        req.params,
      )}`,
    );

    let data: any = null;
    const {
      textDocument: { uri },
    } = params;
    let projectRoot = this.filePathToProject.get(uri);

    if (!projectRoot) {
      projectRoot = await get_emacs_func_result<string>(
        'lsp-rocks--suggest-project-root',
      );
      this.filePathToProject.set(uri, projectRoot);
    }

    const clients = await this.ensureClient(projectRoot, filepath);
    if (!clients?.length) {
      message_emacs(`No client found for this project ${projectRoot}`);
      return;
    }

    if (
      this.recentRequests.get(req.cmd) != req.id &&
      req.cmd != 'textDocument/didChange'
    ) {
      return;
    }

    if (req.cmd === 'textDocument/didOpen') {
      // 如果 didOpen 事件，则在当前 buffer 设置 triggerCharacters
      const triggerCharacters = clients.map(client => client.triggerCharacters);
      eval_in_emacs(
        'lsp-rocks--record-trigger-characters',
        filepath,
        triggerCharacters.reduce((prev, cur) => prev.concat(cur), []),
      );
    }
    // const temp = new Promise<void>((_, reject) => {
    //   setTimeout(() => {
    //     logger.debug(`${req.cmd} execeed time out 300ms`);
    //     reject();
    //   }, 1000);
    // });
    if (req.cmd === 'textDocument/completion') {
      data = await this.doCompletion(clients, req);
    } else {
      data = await Promise.all(
        clients.map(client => client.on(req.cmd, req.params)),
      );
      data = data.filter(item => !!item);
      data = data[0];
    }
    // data = await Promise.race([
    //   temp,
    // ]);
    logger.debug({
      cmd: req.cmd,
      data,
    });
    // data = await client.on(req.cmd, req.params);
    if (this.recentRequests.get(req.cmd) != req.id) {
      return;
    }
    return {
      id,
      cmd,
      data,
    };
  }

  async doCompletion(clients: LanguageClient[], req: RequestMessage) {
    const resps = await Promise.allSettled<CompletionItem[]>(
      clients.map(client => client.on(req.cmd, req.params)),
    );
    const fulfilledResps = resps.filter(
      (resp): resp is PromiseFulfilledResult<CompletionItem[]> =>
        resp.status === 'fulfilled',
    );
    return fulfilledResps.reduce((prev, cur) => {
      return prev.concat(cur.value);
    }, [] as CompletionItem[]);
  }

  private async ensureClient(projectRoot: string, filePath: string) {
    // find all support current file's config
    // find workspace?
    const extension = path.extname(filePath);
    const languageId = languageIdMap[extension];
    if (!languageId) {
      throw new Error(`Not support current file type ${extension}.`);
    }
    let clients = this._clients.get(projectRoot);
    if (clients) {
      return clients;
    }

    const configs = this.findClients(filePath, projectRoot);
    if (!configs.length) {
      throw new Error(`No LSP server for ${filePath}.`);
    }
    // TODO logger.info
    message_emacs(
      `Found the following clients for ${filePath}: ${configs
        .map(item => item.name)
        .join('  ')}`,
    );
    clients = (
      await Promise.all(
        configs.map(config =>
          this.createClient(config.name, projectRoot, config),
        ),
      )
    ).filter((client): client is LanguageClient => !!client);

    this._clients.set(projectRoot, clients);
    return clients;
  }

  findClients(filepath: string, projectRoot: string) {
    const extname = path.extname(filepath);
    return this.configs
      .filter(
        config =>
          config.supportExtensions.includes(extname) ||
          config.supportExtensions.includes(extname.slice(1)),
      )
      .filter(item => executable(item.command))
      .filter(item => item.activate(filepath, projectRoot));
  }

  private async createClient(
    name: string,
    project: string,
    config: ServerConfig,
  ) {
    const client = new LanguageClient(
      name,
      project,
      config,
      this.filePathToProject,
    );
    await client.start();

    return client;
  }
}
