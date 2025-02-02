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
import { toggleDebug, logger, IS_DEBUG } from './logger';
import { importLangServers } from './utils/importLangServers';
import executable from './utils/executable';
import languageIdMap from './constants/languageIdMap';
import { CompletionItem } from 'vscode-languageserver-protocol';
import { fileUriToProject } from './project';
import diagnosticCenter from './diagnostics';

export class LspRocks {
  private _server: RPCServer | null;

  readonly _clients: Map<string, LanguageClient[] | undefined>;

  readonly recentRequests: Map<string, any>;
  configs: ServerConfig[] = [];

  constructor() {
    this._clients = new Map();
    this.recentRequests = new Map();
  }

  public async start() {
    this._server = await init_epc_server();
    this._server?.logger &&
      (this._server.logger.level = IS_DEBUG ? 'debug' : 'error');
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

    this._server?.defineMethod('pullDiagnostics', (filePath: string) => {
      // logger.info({
      //   cmd: 'pullDiagnostics',
      //   filePath,
      // });
      const diagnostics = diagnosticCenter.getDiagnosticsByFilePath(filePath);

      // logger.debug({
      //   cmd: 'pullDiagnostics',
      //   filePath,
      //   diagnostics,
      // });
      return diagnostics;
    });

    this._server?.defineMethod('resolve', async (message: RequestMessage) => {
      logger.info({
        cmd: message.cmd,
        message,
      });
      this.recentRequests.set(message.cmd, message.id);
      const response = await this.messageHandler(message);
      return response?.data;
    });

    this._server?.defineMethod('restart', async (projectRoot: string) => {
      if (!projectRoot) {
        message_emacs('No projectRoot provide to restart.');
        return;
      }
      const clients = this._clients.get(projectRoot);
      const tsls = clients?.find(item => item.name === 'ts-ls');
      if (!tsls) {
        message_emacs('No language server(s) is associated with this buffer.');
      }
      await tsls?.restart();
    });

    // TODO optimize
    this._server?.defineMethod('get-all-opened-files', () => {
      return Array.from(fileUriToProject.keys()).map(uri => {
        return URI.parse(uri).fsPath;
      });
    });

    this.configs = await importLangServers();
    message_emacs('config length ' + this.configs.length);
  }

  public async messageHandler(req: RequestMessage) {
    const { id, cmd, params } = req;
    logger.info(
      `receive message => id: ${id}, cmd: ${cmd}, params: ${JSON.stringify(
        req.params,
      )}`,
    );
    const filepath = params.textDocument.uri;
    params.textDocument.uri = URI.file(filepath).toString();

    let data: any = null;
    const {
      textDocument: { uri },
    } = params;
    let projectRoot = fileUriToProject.get(uri);

    if (!projectRoot) {
      projectRoot = await get_emacs_func_result<string>(
        'lsp-rocks--suggest-project-root',
      );
    }

    const clients = await this.ensureClient(projectRoot, filepath);
    if (!clients?.length) {
      message_emacs(`No client found for this project ${projectRoot}`);
      return;
    }
    // NOTE 只有有相应的server的文件才记录
    fileUriToProject.set(uri, projectRoot);

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
    } else if (req.cmd === 'textDocument/formatting') {
      // 如果是 formating ，则需要找到其中一个支持该能力的 server 发送请求即可
      const [client] = clients.filter(item =>
        item.checkCapabilityForMethod(req.cmd),
      );
      logger.debug('Did find a client?', {
        msg: client?.name,
      });
      if (client) {
        data = await client.on(req.cmd, req.params);
      } else {
        data = [];
      }
    } else {
      data = await Promise.all(
        clients.map(client => client.on(req.cmd, req.params)),
      );
      data = data.filter(item => (Array.isArray(item) ? item.length : !!item));
      data = data[0];
    }
    if (this.recentRequests.get(req.cmd) != req.id) {
      logger.debug(`not equal`);
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
    const extension = path.extname(filePath);
    const languageId = languageIdMap[extension];
    if (!languageId) {
      throw new Error(`Not support current file type ${extension}.`);
    }
    const cachedClients = this._clients.get(projectRoot) ?? [];
    const cachedNames = cachedClients?.map(client => client.name);

    const configs = this.findClients(filePath, projectRoot).filter(
      config => !cachedNames.includes(config.name),
    );

    if (!configs.length) {
      return cachedClients;
    }

    const newClients = (
      await Promise.all(
        configs.map(config =>
          this.createClient(config.name, projectRoot, config),
        ),
      )
    ).filter((client): client is LanguageClient => !!client);
    const clients = [...cachedClients, ...newClients];
    this._clients.set(projectRoot, clients);

    message_emacs(
      `Found the following clients for ${filePath}: ${clients
        .map(item => item.name)
        .join('  ')}`,
    );
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
    const client = new LanguageClient(name, project, config);
    await client.start();

    return client;
  }
}
