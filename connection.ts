import { lstat } from 'fs';
import { ChildProcess, spawn } from 'child_process';
import {
  ConnectionOptions,
  MessageReader,
  MessageWriter,
  ProtocolConnection,
  Trace,
  createProtocolConnection,
} from 'vscode-languageserver-protocol';
import {
  StreamMessageReader,
  StreamMessageWriter,
  generateRandomPipeName,
} from 'vscode-jsonrpc/node';
import { Logger } from 'pino';
import { message_emacs } from './epc-utils';
import * as Is from './util';
import { logger as commonLogger } from './logger';

export enum TransportKind {
  stdio,
  ipc,
  pipe,
  socket,
}
export interface SocketTransport {
  kind: TransportKind.socket;
  port: number;
}
namespace Transport {
  export function isSocket(
    value: Transport | undefined,
  ): value is SocketTransport {
    const candidate = value as SocketTransport;
    return (
      candidate &&
      candidate.kind === TransportKind.socket &&
      Is.number(candidate.port)
    );
  }
}
export type Transport = TransportKind | SocketTransport;

export interface ExecutableOptions {
  cwd?: string;
  env?: any;
  detached?: boolean;
  shell?: boolean;
}
export interface Executable {
  command: string;
  transport?: Transport;
  args?: string[];
  options?: ExecutableOptions;
}
namespace Executable {
  export function is(value: any): value is Executable {
    return Is.string(value.command);
  }
}
export type ServerOptions = Executable;

export interface MessageTransports {
  reader: MessageReader;
  writer: MessageWriter;
  detached?: boolean;
}
export namespace MessageTransports {
  export function is(value: any): value is MessageTransports {
    const candidate: MessageTransports = value;
    return (
      candidate &&
      MessageReader.is(value.reader) &&
      MessageWriter.is(value.writer)
    );
  }
}

class Connection {
  private serverProcess: ChildProcess | undefined;

  async createConnection(
    serverOptions: ServerOptions,
    connectionOptions: ConnectionOptions,
    logger: Logger,
  ): Promise<ProtocolConnection> {
    const transports = await this.createMessageTransports(serverOptions);

    const connection = createProtocolConnection(
      transports.reader,
      transports.writer,
      console,
      connectionOptions,
    );
    connection.onError(err => {
      message_emacs(`connection onError: ${err[1]}`);
      commonLogger.error({
        msg: `${serverOptions.command} Connection error `,
        data: err,
      });
    });

    connection.trace(Trace.Off, {
      log(messageOrDataObject: string | any, data?: string) {
        if (Is.string(messageOrDataObject)) {
          const msg = `${messageOrDataObject}\n${data}`;
          logger?.info(msg);
        } else {
          logger?.info(JSON.stringify(data));
        }
      },
    });

    return connection;
  }

  protected async createMessageTransports(
    server: ServerOptions,
  ): Promise<MessageTransports> {
    const serverWorkingDir = await this.getServerWorkingDir(server.options);

    if (Executable.is(server) && server.command) {
      const args: string[] =
        server.args !== undefined ? server.args.slice(0) : [];
      let pipeName: string | undefined = undefined;
      const transport = server.transport;
      if (transport === TransportKind.stdio) {
        args.push('--stdio');
      } else if (transport === TransportKind.pipe) {
        pipeName = generateRandomPipeName();
        args.push(`--pipe=${pipeName}`);
      } else if (Transport.isSocket(transport)) {
        args.push(`--socket=${transport.port}`);
      } else if (transport === TransportKind.ipc) {
        throw new Error(
          'Transport kind ipc is not support for command executable',
        );
      }
      const options = Object.assign({}, server.options);
      options.cwd = options.cwd || serverWorkingDir;
      if (transport === undefined || transport === TransportKind.stdio) {
        message_emacs(
          `server ${server.command} ${args.join(' ')} ${JSON.stringify(
            options,
          )}`,
        );
        const serverProcess = spawn(server.command, args, options);
        if (!serverProcess || !serverProcess.pid) {
          const message = `Launching server using command ${server.command} failed.`;
          if (!serverProcess) {
            return Promise.reject<MessageTransports>(message);
          }
          return new Promise<MessageTransports>((_, reject) => {
            process.on('error', err => {
              reject(`${message} ${err}`);
            });
            // the error event should always be run immediately,
            // but race on it just in case
            setImmediate(() => reject(message));
          });
        }
        serverProcess.stderr.on('data', data =>
          console.error(
            'server error: ',
            Is.string(data) ? data : data.toString('utf8'),
          ),
        );
        this.serverProcess = serverProcess;
        return Promise.resolve({
          reader: new StreamMessageReader(serverProcess.stdout),
          writer: new StreamMessageWriter(serverProcess.stdin),
        });
      }
    }
    return Promise.reject<MessageTransports>(
      new Error(
        'Unsupported server configuration ' + JSON.stringify(server, null, 4),
      ),
    );
  }

  private getServerWorkingDir(options?: {
    cwd?: string;
  }): Promise<string | undefined> {
    const cwd = options && options.cwd;
    // make sure the folder exists otherwise creating the process will fail
    return new Promise(resolve => {
      if (cwd) {
        lstat(cwd, (err, stats) => {
          resolve(!err && stats.isDirectory() ? cwd : undefined);
        });
      } else {
        resolve(undefined);
      }
    });
  }
}

export default Connection;
