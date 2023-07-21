import { ChildProcess } from 'child_process';
import * as Is from './util';

import {
  CancellationToken,
  ErrorCodes,
  ExitNotification,
  InitializeParams,
  InitializeRequest,
  InitializeResult,
  InitializedNotification,
  LogMessageNotification,
  MessageType,
  NotificationType,
  NotificationType0,
  PositionEncodingKind,
  ProtocolConnection,
  ProtocolNotificationType,
  ProtocolNotificationType0,
  ProtocolRequestType,
  ProtocolRequestType0,
  RequestType,
  RequestType0,
  SemanticTokensDeltaRequest,
  SemanticTokensRangeRequest,
  SemanticTokensRequest,
  ServerCapabilities,
  ShutdownRequest,
  TextDocumentSyncKind,
  TextDocumentSyncOptions,
  RequestHandler0,
  RequestHandler,
  GenericRequestHandler,
  Disposable,
  DocumentSelector,
  RegistrationParams,
  RegistrationRequest,
  Registration,
  SymbolKind,
  MarkupKind,
  InsertTextMode,
} from 'vscode-languageserver-protocol';

import {
  CancellationStrategy,
  MessageSignature,
  RAL,
  ResponseError,
} from 'vscode-jsonrpc/node';
import { DynamicFeature, RunnableDynamicFeature } from './features/features';
import {
  DidChangeTextDocumentFeature,
  DidCloseTextDocumentFeature,
  DidOpenTextDocumentFeature,
  DidSaveTextDocumentFeature,
  WillSaveTextDocumentFeature,
} from './features/textSynchronization';
import {
  CompletionFeature,
  CompletionItemResolveFeature,
} from './features/completion';
import { DefinitionFeature } from './features/definition';
import { DeclarationFeature } from './features/declaration';
import { ReferencesFeature } from './features/reference';
import { ImplementationFeature } from './features/implementation';
import { pathToFileURL } from 'node:url';
import { TypeDefinitionFeature } from './features/typeDefinition';
import { HoverFeature } from './features/hover';
import { SignatureHelpFeature } from './features/signatureHelp';
import { PrepareRenameFeature, RenameFeature } from './features/rename';
import { logger, message_emacs } from './epc-utils';
import { ConfigurationFeature } from './features/configuration';
import { Logger } from 'pino';
import { createLogger } from './logger';
import Connection, { ServerOptions } from './connection';
import data2String from './utils/data2String';
import methodRequirements from './constants/methodRequirements';

enum ClientState {
  Initial = 'initial',
  Starting = 'starting',
  StartFailed = 'startFailed',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
}

/**
 * Signals in which state the language client is in.
 */
export enum State {
  /**
   * The client is stopped or got never started.
   */
  Stopped = 1,
  /**
   * The client is starting but not ready yet.
   */
  Starting = 3,
  /**
   * The client is running and ready.
   */
  Running = 2,
}

type ResolvedClientOptions = {
  stdioEncoding: string;
  initializationOptions?: any | (() => any);
  progressOnInitialization: boolean;
  documentSelector?: DocumentSelector;
  connectionOptions?: {
    cancellationStrategy?: CancellationStrategy;
    maxRestartCount?: number;
  };
  markdown: {
    isTrusted: boolean;
    supportHtml: boolean;
  };
  disableDynamicRegister?: boolean;
};

export class LanguageClient {
  readonly _project: string;

  readonly _language: string;

  readonly _name: string;

  _initializationOptions: any;

  logger: Logger;

  private readonly _serverOptions: ServerOptions;

  private _serverProcess: ChildProcess | undefined;

  private _state: ClientState;

  private _onStart: Promise<void> | undefined;

  private _onStop: Promise<void> | undefined;

  private _connection: ProtocolConnection | undefined;

  private _initializeResult: InitializeResult | undefined;

  capabilities: ServerCapabilities;
  // 记录 client/registerCapability 返回注册的能力
  private registeredCapabilities = new Map<
    Registration['method'],
    Registration
  >();

  private _clientOptions: ResolvedClientOptions;

  private _features: DynamicFeature<any>[];

  private _dynamicFeatures: Map<string, DynamicFeature<any>>;

  private serverConfig: ServerConfig | undefined;

  constructor(
    language: string,
    project: string,
    serverOptions: ServerOptions,
    serverConfig: ServerConfig,
  ) {
    this._name = `${project}:${language}`;
    this._project = project;
    this._language = language;
    this._serverOptions = serverOptions;
    this._features = [];
    this._dynamicFeatures = new Map();
    this._clientOptions = {
      stdioEncoding: 'utf-8',
      progressOnInitialization: false,
      markdown: {
        isTrusted: true,
        supportHtml: true,
      },
    };

    this.serverConfig = serverConfig;

    this.logger = createLogger(language);

    this.registerBuiltinFeatures();
  }

  get triggerCharacters() {
    return this.capabilities.completionProvider?.triggerCharacters ?? [];
  }

  public sendRequest<R, PR, E, RO>(
    type: ProtocolRequestType0<R, PR, E, RO>,
    token?: CancellationToken,
  ): Promise<R>;
  public sendRequest<P, R, PR, E, RO>(
    type: ProtocolRequestType<P, R, PR, E, RO>,
    params: P,
    token?: CancellationToken,
  ): Promise<R>;
  public sendRequest<R, E>(
    type: RequestType0<R, E>,
    token?: CancellationToken,
  ): Promise<R>;
  public sendRequest<P, R, E>(
    type: RequestType<P, R, E>,
    params: P,
    token?: CancellationToken,
  ): Promise<R>;
  public sendRequest<R>(method: string, token?: CancellationToken): Promise<R>;
  public sendRequest<R>(
    method: string,
    param: any,
    token?: CancellationToken,
  ): Promise<R>;
  public async sendRequest<R>(
    type: string | MessageSignature,
    ...params: any[]
  ): Promise<R | undefined> {
    if (
      this._state === ClientState.StartFailed ||
      this._state === ClientState.Stopping ||
      this._state === ClientState.Stopped
    ) {
      return Promise.reject(
        new ResponseError(
          ErrorCodes.ConnectionInactive,
          'Client is not running',
        ),
      );
    }
    try {
      return await this._connection?.sendRequest<R>(
        Is.toMethod(type),
        ...params,
      );
    } catch (error) {
      this.error(
        `Sending request ${Is.toMethod(type)} failed. ` +
          (error as Error).message,
      );
      throw error;
    }
  }

  public onRequest<R, PR, E, RO>(
    type: ProtocolRequestType0<R, PR, E, RO>,
    handler: RequestHandler0<R, E>,
  ): Promise<Disposable>;
  public onRequest<P, R, PR, E, RO>(
    type: ProtocolRequestType<P, R, PR, E, RO>,
    handler: RequestHandler<P, R, E>,
  ): Promise<Disposable>;
  public onRequest<R, E>(
    type: RequestType0<R, E>,
    handler: RequestHandler0<R, E>,
  ): Promise<Disposable>;
  public onRequest<P, R, E>(
    type: RequestType<P, R, E>,
    handler: RequestHandler<P, R, E>,
  ): Promise<Disposable>;
  public onRequest<R, E>(
    method: string,
    handler: GenericRequestHandler<R, E>,
  ): Promise<Disposable>;
  public async onRequest<R, E>(
    type: string | MessageSignature,
    handler: GenericRequestHandler<R, E>,
  ): Promise<Disposable | undefined> {
    if (
      this._state === ClientState.StartFailed ||
      this._state === ClientState.Stopping ||
      this._state === ClientState.Stopped
    ) {
      throw new Error('Language client is not ready yet');
    }
    try {
      return this._connection?.onRequest(Is.toMethod(type), (...params) => {
        return handler.call(null, ...params);
      });
    } catch (error) {
      this.error(
        `Registering request handler ${Is.toMethod(type)} failed.`,
        (error as Error).message,
      );
      throw error;
    }
  }

  public sendNotification<RO>(
    type: ProtocolNotificationType0<RO>,
  ): Promise<void>;
  public sendNotification<P, RO>(
    type: ProtocolNotificationType<P, RO>,
    params?: P,
  ): Promise<void>;
  public sendNotification(type: NotificationType0): Promise<void>;
  public sendNotification<P>(
    type: NotificationType<P>,
    params?: P,
  ): Promise<void>;
  public sendNotification(method: string): Promise<void>;
  public sendNotification(method: string, params: any): Promise<void>;
  public async sendNotification<P>(
    type: string | MessageSignature,
    params?: P,
  ): Promise<void> {
    if (
      this._state === ClientState.StartFailed ||
      this._state === ClientState.Stopping ||
      this._state === ClientState.Stopped
    ) {
      return Promise.reject(
        new ResponseError(
          ErrorCodes.ConnectionInactive,
          'Client is not running',
        ),
      );
    }
    try {
      // logger.info(`[sendNotification] ${Is.toMethod(type)}`, params)
      return await this._connection?.sendNotification(
        Is.toMethod(type),
        params,
      );
    } catch (error) {
      this.error(
        `Sending notification ${Is.string(type) ? type : type.method} failed.`,
        error,
      );
      throw error;
    }
  }

  public async start() {
    if (this._state === ClientState.Stopping) {
      throw new Error(
        'Client is currently stopping. Can only restart a full stopped client',
      );
    }
    // We are already running or are in the process of getting up
    // to speed.
    if (this._onStart !== undefined) {
      return this._onStart;
    }
    const [promise, resolve, reject] = this.createOnStartPromise();
    this._onStart = promise;

    this._state = ClientState.Starting;
    try {
      const connection = await new Connection().createConnection(
        this._serverOptions,
        {},
        this.logger,
      );
      connection.onNotification(LogMessageNotification.type, message => {
        switch (message.type) {
          case MessageType.Error:
            this.error(message.message);
            break;
          case MessageType.Warning:
            this.warn(message.message);
            break;
          case MessageType.Info:
            this.info(message.message);
            break;
          default:
            console.log(message.message);
        }
      });
      connection.listen();
      this._connection = connection;
      this.initializeFeatures();

      connection.onRequest(RegistrationRequest.type, params =>
        this.handleRegistrationRequest(params),
      );
      connection.onRequest('client/registerFeature', params =>
        this.handleRegistrationRequest(params),
      );

      await this.initialize(connection);
      resolve();
    } catch (error) {
      this._state = ClientState.StartFailed;
      this.error(
        `${this._name} client: couldn't create connection to server. ${
          (error as Error).message
        }`,
      );
      reject(error);
    }
    return this._onStart;
  }

  public async restart() {
    await this.stop();
    await this.start();
  }

  private async initialize(
    connection: ProtocolConnection,
  ): Promise<InitializeResult> {
    const initializationOptions = this.serverConfig?.initializeOptions?.();
    const initParams: InitializeParams = {
      processId: process.pid,
      clientInfo: {
        name: 'Emacs',
        version: 'GNU Emacs',
      },
      locale: 'en',
      rootPath: this._project,
      rootUri: pathToFileURL(this._project).toString(),
      capabilities: {
        general: {
          positionEncodings: ['utf-32', 'utf-16'],
        },
        workspace: {
          workspaceEdit: {
            documentChanges: true,
            resourceOperations: ['create', 'rename', 'delete'],
          },
          applyEdit: true,
          symbol: {
            symbolKind: {
              valueSet: Array.from({ length: 25 }).map(
                (_, idx) => idx + 1,
              ) as SymbolKind[],
            },
          },
          executeCommand: { dynamicRegistration: false },
          // didChangeWatchedFiles: { dynamicRegistration: true },
          // workspaceFolders: true,
        },
        textDocument: {
          declaration: { dynamicRegistration: true, linkSupport: true },
          definition: { dynamicRegistration: true, linkSupport: true },
          references: { dynamicRegistration: true },
          implementation: { dynamicRegistration: true, linkSupport: true },
          typeDefinition: { dynamicRegistration: true, linkSupport: true },
          synchronization: {
            willSave: true,
            didSave: true,
            willSaveWaitUntil: true,
          },
          // documentSymbol: { symbolKind }
          // formatting: { dynamicRegistration: true },
          // rangeFormatting: { dynamicRegistration: true },
          // onTypeFormatting: { dynamicRegistration: true },
          // rename: { dynamicRegistration: true, prepareSupport: true },
          // codeAction: {
          //   dynamicRegistration: true,
          //   isPreferredSupport: true,
          //   codeActionLiteralSupport: {
          //     codeActionKind: {
          //       valueSet: [
          //         '',
          //         "quickfix",
          //         "refactor",
          //         "refactor.extract",
          //         "refactor.inline",
          //         "refactor.rewrite",
          //         "source",
          //         "source.organizeImports"
          //       ],
          //     },
          //   },
          //   resolveSupport: { properties: ['edit', 'command'] },
          //   dataSupport: true,
          // },
          completion: {
            dynamicRegistration: true,
            contextSupport: true,
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: [MarkupKind.Markdown, MarkupKind.PlainText],
              deprecatedSupport: true,
              insertReplaceSupport: true,
              insertTextModeSupport: {
                valueSet: [
                  InsertTextMode.asIs,
                  InsertTextMode.adjustIndentation,
                ],
              },
              labelDetailsSupport: true,
            },
          },
          publishDiagnostics: {
            relatedInformation: true,
            tagSupport: { valueSet: [1, 2] },
            versionSupport: true,
          },
        },
      },
      initializationOptions,
      workspaceFolders: [
        {
          uri: pathToFileURL(this._project).toString(),
          name: this._project.slice(this._project.lastIndexOf('/')),
        },
      ],
    };

    return this.doInitialize(connection, initParams);
  }

  public registerFeature(feature: DynamicFeature<any>): void {
    // 这里收集 feature
    this._features.push(feature);
    if (DynamicFeature.is(feature)) {
      const registrationType = feature.registrationType;
      this._dynamicFeatures.set(registrationType.method, feature);
    }
  }

  protected registerBuiltinFeatures() {
    this.registerFeature(new DidOpenTextDocumentFeature(this));
    this.registerFeature(new DidCloseTextDocumentFeature(this));
    this.registerFeature(new DidChangeTextDocumentFeature(this));
    this.registerFeature(new WillSaveTextDocumentFeature(this));
    this.registerFeature(new DidSaveTextDocumentFeature(this));
    this.registerFeature(new CompletionFeature(this));
    this.registerFeature(new CompletionItemResolveFeature(this));
    this.registerFeature(new DefinitionFeature(this));
    this.registerFeature(new TypeDefinitionFeature(this));
    this.registerFeature(new DeclarationFeature(this));
    this.registerFeature(new ReferencesFeature(this));
    this.registerFeature(new ImplementationFeature(this));
    this.registerFeature(new HoverFeature(this));
    this.registerFeature(new SignatureHelpFeature(this));
    this.registerFeature(new RenameFeature(this));
    this.registerFeature(new PrepareRenameFeature(this));
    this.registerFeature(new ConfigurationFeature(this));
  }

  private initializeFeatures() {
    const documentSelector = this._clientOptions.documentSelector;
    for (const feature of this._features) {
      feature.initialize(this.capabilities, documentSelector);
    }
  }

  private handleRegistrationRequest(params: RegistrationParams) {
    for (const registration of params.registrations) {
      const feature = this._dynamicFeatures.get(registration.method);
      if (!feature) {
        this.error(`No feature implementation for ${registration.method}`);
      }
      logger.info(
        `register ${registration.method}`,
        JSON.stringify(registration),
      );
      // TODO 只需要处理 workspace/didChangeWatchedFiles
      this.registeredCapabilities.set(registration.method, registration);
    }
  }

  private async doInitialize(
    connection: ProtocolConnection,
    initParams: InitializeParams,
  ): Promise<InitializeResult> {
    try {
      let result = await connection.sendRequest(
        InitializeRequest.type,
        initParams,
      );
      if (this.serverConfig?.initializedFn) {
        result = this.serverConfig.initializedFn(result);
      }
      if (
        result.capabilities.positionEncoding !== undefined &&
        result.capabilities.positionEncoding !== PositionEncodingKind.UTF16
      ) {
        throw new Error(
          `Unsupported position encoding (${result.capabilities.positionEncoding}) received from server ${this._name}`,
        );
      }

      this._initializeResult = result;
      this._state = ClientState.Running;

      // TODO what?
      let textDocumentSyncOptions: TextDocumentSyncOptions | undefined =
        undefined;
      if (Is.number(result.capabilities.textDocumentSync)) {
        if (
          result.capabilities.textDocumentSync === TextDocumentSyncKind.None
        ) {
          textDocumentSyncOptions = {
            openClose: false,
            change: TextDocumentSyncKind.None,
            save: undefined,
          };
        } else {
          textDocumentSyncOptions = {
            openClose: true,
            change: result.capabilities.textDocumentSync,
            save: {
              includeText: false,
            },
          };
        }
      } else if (
        result.capabilities.textDocumentSync !== undefined &&
        result.capabilities.textDocumentSync !== null
      ) {
        textDocumentSyncOptions = result.capabilities
          .textDocumentSync as TextDocumentSyncOptions;
      }

      // 记录当前 client 支持的 server capabilities
      this.capabilities = Object.assign({}, result.capabilities, {
        resolvedTextDocumentSync: textDocumentSyncOptions,
      });
      this.initializeFeatures();

      await connection.sendNotification(InitializedNotification.type, {});

      return result;
    } catch (error) {
      if (error instanceof Error) {
        message_emacs(
          'error ' + ' message ' + error.message + ' stack' + error.stack,
        );
      } else {
        message_emacs('error1: ' + JSON.stringify(error));
      }
      this.error('Server initialization failed.', error);
      void this.stop();
      throw error;
    }
  }

  public async stop(timeout = 2000) {
    try {
      await this.shutdown('stop', timeout);
    } finally {
      if (this._serverProcess) {
        this._serverProcess = undefined;
      }
    }
  }

  private async shutdown(
    mode: 'suspend' | 'stop',
    timeout: number,
  ): Promise<void> {
    // If the client is stopped or in its initial state return.
    if (
      this._state === ClientState.Stopped ||
      this._state === ClientState.Initial
    ) {
      return;
    }

    // If we are stopping the client and have a stop promise return it.
    if (this._state === ClientState.Stopping) {
      if (this._onStop !== undefined) {
        return this._onStop;
      } else {
        throw new Error('Client is stopping but no stop promise available.');
      }
    }

    const connection = this._connection;

    // We can't stop a client that is not running (e.g. has no connection). Especially not
    // on that us starting since it can't be correctly synchronized.
    if (this._state !== ClientState.Running || !connection) {
      throw new Error(
        `Client is not running and can't be stopped. It's current state is: ${this._state}`,
      );
    }

    this._initializeResult = undefined;
    this._state = ClientState.Stopping;

    const tp = new Promise<undefined>(c => {
      RAL().timer.setTimeout(c, timeout);
    });
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const shutdown = (async connection => {
      await connection.sendRequest(ShutdownRequest.type, undefined);
      await connection.sendNotification(ExitNotification.type);
      return connection;
    })(connection);

    // eslint-disable-next-line @typescript-eslint/no-shadow
    return (this._onStop = Promise.race([tp, shutdown])
      .then(
        connection => {
          // The connection won the race with the timeout.
          if (connection !== undefined) {
            connection.end();
            connection.dispose();
          } else {
            this.error('Stopping server timed out');
            throw new Error('Stopping the server timed out');
          }
        },
        error => {
          this.error('Stopping server failed', error);
          throw error;
        },
      )
      .finally(() => {
        this._state = ClientState.Stopped;
        this._onStart = undefined;
        this._onStop = undefined;
        this._connection = undefined;
      }));
  }

  private createOnStartPromise(): [
    Promise<void>,
    () => void,
    (error: any) => void,
  ] {
    let resolve!: () => void;
    let reject!: (error: any) => void;
    const promise: Promise<void> = new Promise((_resolve, _reject) => {
      resolve = _resolve;
      reject = _reject;
    });
    return [promise, resolve, reject];
  }

  public async on(method: string, params: any) {
    return (
      this._dynamicFeatures.get(method) as RunnableDynamicFeature<
        any,
        any,
        any,
        any
      >
    ).run(params);
  }

  public info(message: string, data?: any): void {
    const msg = `[Info  - ${new Date().toLocaleTimeString()}] ${
      message || data2String(data)
    }`;
    logger.info(msg);
  }

  public warn(message: string, data?: any): void {
    const msg = `[Warn  - ${new Date().toLocaleTimeString()}] ${
      message || data2String(data)
    }`;
    logger.info(msg);
  }

  public error(message: string, data?: any): void {
    const msg = `[Error  - ${new Date().toLocaleTimeString()}] ${
      message || data2String(data)
    }`;
    logger.info(msg);
  }

  private static RequestsToCancelOnContentModified: Set<string> = new Set([
    SemanticTokensRequest.method,
    SemanticTokensRangeRequest.method,
    SemanticTokensDeltaRequest.method,
  ]);

  public checkCapabilityForMethod(method: string | MessageSignature) {
    const methodName = Is.toMethod(method);
    const { capability } = methodRequirements[methodName];
    return !capability || this.capabilities[capability];
  }
}
