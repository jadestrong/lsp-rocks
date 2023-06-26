import { LanguageClient } from './client';
import { RPCServer } from 'ts-elrpc';
import { eval_in_emacs, get_emacs_func_result, init_epc_server, logger, message_emacs, send_response_to_emacs } from './epc-utils';

/**
 * All supports request commands
 */
enum ServerCommand {
  Init = 'init',
}

enum EmacsCommand {
  GetVar = 'get-var',
  CallFunc = 'call-func',
}

const emacsCommands = Object.values(EmacsCommand);

interface InitParams {
  language: string;
  project: string;
  command: string;
  args: string[];
  clientInfo: { name: string, version: string };
}

namespace Message {
  export function isResponse(msg: Message): msg is ResponseMessage {
    return emacsCommands.includes(msg.cmd as EmacsCommand);
  }
}

type RequestId = string;

interface Message {
  id: RequestId,
  cmd: string | ServerCommand | EmacsCommand,
}

interface RequestMessage extends Message {
  lang: string;
  project: string;
  params: any;
}

interface ResponseMessage extends Message {
  data: any;
}


function mkres(id: string | number, cmd: string, data: string[]) {
  return JSON.stringify({ id, cmd, data });
}

export class LspRocks {
  private _server: RPCServer | null;

  private _emacsVars: Map<string, any>;

  readonly _clients: Map<string, LanguageClient>;

  readonly _recentRequests: Map<string, any>;

  constructor() {
    this._clients = new Map();
    this._recentRequests = new Map();
  }

  public async start() {
    this._server = await init_epc_server();
    this._server?.defineMethod('message', async (message: Message) => {
      this._recentRequests.set(message.cmd, message.id);
      const response = await this.messageHandler(message);
      if (response?.data != null) {
        send_response_to_emacs(response)
      }
    });

    this._server?.defineMethod('request', async (message: Message) => {
      this._recentRequests.set(message.cmd, message.id);
      const response = await this.messageHandler(message);
      return response?.data
    })

    // start success, notify emacs to init
    eval_in_emacs('lsp-rocks--init')
  }

  public async messageHandler(msg: Message) {
    const { id, cmd } = msg;
    logger.info(`receive message => id: ${msg.id}, cmd: ${msg.cmd}, params: ${JSON.stringify((msg as any).params)}`);
    const logLabel = `${id}:${cmd}`;
    console.time(logLabel)
    if (Message.isResponse(msg)) {
      // TODO
      message_emacs('get response' + JSON.stringify(msg))
    } else {
      const req = msg as RequestMessage;
      let data: any = null;
      const projectRoot = await get_emacs_func_result<string>('lsp-rocks--suggest-project-root')
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const client = await this.ensureClient(projectRoot);

      // if (req.cmd == ServerCommand.Init) {
      //   return;
      // }

      if (this._recentRequests.get(req.cmd) != req.id && req.cmd != 'textDocument/didChange') {
        return;
      }

      data = await client.on(req.cmd, req.params);
      if (this._recentRequests.get(req.cmd) != req.id) {
        return;
      }
      console.timeLog(logLabel)
      return {
        id,
        cmd,
        data
      };
    }

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
        eval_in_emacs('lsp-rocks--inited')
      } else {
        message_emacs('Can not create LanguageClient, because language and project is undefined')
        throw new Error('Can not create LanguageClient, because language and project is undefined');
      }
    }

    return client;
  }
}
