import * as fs from "fs";
import { ChildProcess } from "child_process";
import * as Is from "./util";

import {
  CancellationToken,
  ClientCapabilities,
  DiagnosticTag,
  DidChangeTextDocumentNotification,
  ErrorCodes,
  ExitNotification,
  FailureHandlingKind,
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
  ResourceOperationKind,
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
} from "vscode-languageserver-protocol";

import {
  CancellationStrategy,
  MessageSignature,
  RAL,
  ResponseError,
} from "vscode-jsonrpc/node";
import {
  DynamicFeature,
  ensure,
  RunnableDynamicFeature,
} from "./features/features";
import {
  DidChangeTextDocumentFeature,
  DidCloseTextDocumentFeature,
  DidOpenTextDocumentFeature,
  DidSaveTextDocumentFeature,
  WillSaveTextDocumentFeature,
} from "./features/textSynchronization";
import {
  CompletionFeature,
  CompletionItemResolveFeature,
} from "./features/completion";
import { DefinitionFeature } from "./features/definition";
import { DeclarationFeature } from "./features/declaration";
import { ReferencesFeature } from "./features/reference";
import { ImplementationFeature } from "./features/implementation";

import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { TypeDefinitionFeature } from "./features/typeDefinition";
import { HoverFeature } from "./features/hover";
import { SignatureHelpFeature } from "./features/signatureHelp";
import { PrepareRenameFeature, RenameFeature } from "./features/rename";
import { logger, message_emacs } from "./epc-utils";
import { ConfigurationFeature } from "./features/configuration";
import { Logger } from "pino";
import { createLogger } from "./logger";
import Connection, { ServerOptions } from "./connection";
import data2String from "./utils/data2String";

enum ClientState {
  Initial = "initial",
  Starting = "starting",
  StartFailed = "startFailed",
  Running = "running",
  Stopping = "stopping",
  Stopped = "stopped",
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
  documentSelector?: DocumentSelector
  connectionOptions?: {
    cancellationStrategy?: CancellationStrategy;
    maxRestartCount?: number;
  };
  markdown: {
    isTrusted: boolean;
    supportHtml: boolean;
  };
  disableDynamicRegister?: boolean
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

  private _clientInfo: any;

  private _initializeResult: InitializeResult | undefined;

  private _capabilities: ServerCapabilities;
  // 记录 client/registerCapability 返回注册的能力
  registeredServerCapabilities = new Map<Registration['method'], Registration>();

  private _clientOptions: ResolvedClientOptions;

  // private _fileVersions: Map<string, number>;

  private _features: DynamicFeature<any>[];

  private _dynamicFeatures: Map<string, DynamicFeature<any>>;

  constructor(
    language: string,
    project: string,
    clientInfo: any,
    serverOptions: ServerOptions
  ) {
    this._name = `${project}:${language}`;
    this._project = project;
    this._language = language;
    this._clientInfo = clientInfo;
    this._serverOptions = serverOptions;
    // this._fileVersions = new Map();
    this._features = [];
    this._dynamicFeatures = new Map();
    this._clientOptions = {
      stdioEncoding: "utf-8",
      progressOnInitialization: false,
      markdown: {
        isTrusted: true,
        supportHtml: true,
      },
    };

    this.logger = createLogger(language)

    // TODO 哪些是 builtin 的？
    this.registerBuiltinFeatures();
  }

  private get $state(): ClientState {
    return this._state;
  }

  private set $state(value: ClientState) {
    this._state = value;
  }

  public sendRequest<R, PR, E, RO>(
    type: ProtocolRequestType0<R, PR, E, RO>,
    token?: CancellationToken
  ): Promise<R>;
  public sendRequest<P, R, PR, E, RO>(
    type: ProtocolRequestType<P, R, PR, E, RO>,
    params: P,
    token?: CancellationToken
  ): Promise<R>;
  public sendRequest<R, E>(
    type: RequestType0<R, E>,
    token?: CancellationToken
  ): Promise<R>;
  public sendRequest<P, R, E>(
    type: RequestType<P, R, E>,
    params: P,
    token?: CancellationToken
  ): Promise<R>;
  public sendRequest<R>(method: string, token?: CancellationToken): Promise<R>;
  public sendRequest<R>(
    method: string,
    param: any,
    token?: CancellationToken
  ): Promise<R>;
  public async sendRequest<R>(
    type: string | MessageSignature,
    ...params: any[]
  ): Promise<R | undefined> {
    if (
      this.$state === ClientState.StartFailed ||
      this.$state === ClientState.Stopping ||
      this.$state === ClientState.Stopped
    ) {
      return Promise.reject(
        new ResponseError(
          ErrorCodes.ConnectionInactive,
          "Client is not running"
        )
      );
    }
    try {
      return await this._connection?.sendRequest<R>(Is.toMethod(type), ...params);
    } catch (error) {
      this.error(`Sending request ${Is.toMethod(type)} failed. ` + (error as Error).message);
      throw error;
    }
  }

  public onRequest<R, PR, E, RO>(type: ProtocolRequestType0<R, PR, E, RO>, handler: RequestHandler0<R, E>): Promise<Disposable>
  public onRequest<P, R, PR, E, RO>(type: ProtocolRequestType<P, R, PR, E, RO>, handler: RequestHandler<P, R, E>): Promise<Disposable>
  public onRequest<R, E>(type: RequestType0<R, E>, handler: RequestHandler0<R, E>): Promise<Disposable>
  public onRequest<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): Promise<Disposable>
  public onRequest<R, E>(method: string, handler: GenericRequestHandler<R, E>): Promise<Disposable>
  public async onRequest<R, E>(type: string | MessageSignature, handler: GenericRequestHandler<R, E>): Promise<Disposable | undefined>  {
    if (
      this.$state === ClientState.StartFailed ||
        this.$state === ClientState.Stopping ||
        this.$state === ClientState.Stopped
    ) {
      throw new Error('Language client is not ready yet')
    }
    try {
      return this._connection?.onRequest(Is.toMethod(type), (...params) => {
        return handler.call(null, ...params)
      })
    } catch (error) {
      this.error(
        `Registering request handler ${Is.toMethod(type)} failed.`,
        (error as Error).message
      )
      throw error
    }
  }

  public sendNotification<RO>(
    type: ProtocolNotificationType0<RO>
  ): Promise<void>;
  public sendNotification<P, RO>(
    type: ProtocolNotificationType<P, RO>,
    params?: P
  ): Promise<void>;
  public sendNotification(type: NotificationType0): Promise<void>;
  public sendNotification<P>(
    type: NotificationType<P>,
    params?: P
  ): Promise<void>;
  public sendNotification(method: string): Promise<void>;
  public sendNotification(method: string, params: any): Promise<void>;
  public async sendNotification<P>(
    type: string | MessageSignature,
    params?: P
  ): Promise<void> {
    if (
      this.$state === ClientState.StartFailed ||
      this.$state === ClientState.Stopping ||
      this.$state === ClientState.Stopped
    ) {
      return Promise.reject(
        new ResponseError(
          ErrorCodes.ConnectionInactive,
          "Client is not running"
        )
      );
    }
    try {
      // logger.info(`[sendNotification] ${Is.toMethod(type)}`, params)
      return await this._connection?.sendNotification(Is.toMethod(type), params);
    } catch (error) {
      this.error(
        `Sending notification ${Is.string(type) ? type : type.method} failed.`,
        error
      );
      throw error;
    }
  }

  public async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  public async start(): Promise<void> {
    if (this.$state === ClientState.Stopping) {
      throw new Error(
        "Client is currently stopping. Can only restart a full stopped client"
      );
    }
    // We are already running or are in the process of getting up
    // to speed.
    if (this._onStart !== undefined) {
      return this._onStart;
    }
    const [promise, resolve, reject] = this.createOnStartPromise();
    this._onStart = promise;

    this.$state = ClientState.Starting;
    try {
      const connection = await new Connection().createConnection(
        this._serverOptions,
        this._clientInfo.connectionOptions,
        this.logger,
      );
      connection.onNotification(LogMessageNotification.type, (message) => {
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
      this._connection = connection
      this.initializeFeatures()

      connection.onRequest(RegistrationRequest.type, params =>
        this.handleRegistrationRequest(params)
      )
      connection.onRequest('client/registerFeature', params => this.handleRegistrationRequest(params))

      await this.initialize(connection, this._clientInfo);
      resolve();
    } catch (error) {
      this.$state = ClientState.StartFailed;
      this.error(
        `${this._name} client: couldn't create connection to server. ${(error as Error).message}`,
      );
      reject(error);
    }
    return this._onStart;
  }

  private async initialize(
    connection: ProtocolConnection,
    clientInfo: any
  ): Promise<InitializeResult> {
    // May language server need some initialization options.
    const langSreverConfig = `./langserver/${this._language}.json`;
    const initializationOptions = fs.existsSync(
      path.join(__dirname, langSreverConfig)
    )
      ? require(langSreverConfig)
      : {};
    this._initializationOptions = initializationOptions

    const initParams: InitializeParams = {
      processId: process.pid,
      clientInfo,
      locale: "en",
      rootPath: this._project,
      rootUri: pathToFileURL(this._project).toString(),
      capabilities: this.getClientCapabilities(),
      initializationOptions,
      workspaceFolders: [
        {
          uri: pathToFileURL(this._project).toString(),
          name: this._project.slice(this._project.lastIndexOf("/")),
        },
      ],
    };
    this.fillInitializeParams(initParams);
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

  protected fillInitializeParams(params: InitializeParams): void {
    for (const feature of this._features) {
      if (Is.func(feature.fillInitializeParams)) {
        feature.fillInitializeParams(params);
      }
    }
  }

  private getClientCapabilities(): ClientCapabilities {
    const result: ClientCapabilities = {};

    // workspace
    const workspace = ensure(result, "workspace");
    workspace.applyEdit = true;
    const workspaceEdit = ensure(workspace, "workspaceEdit");
    workspaceEdit.documentChanges = true;
    workspaceEdit.resourceOperations = [
      ResourceOperationKind.Create,
      ResourceOperationKind.Rename,
      ResourceOperationKind.Delete,
    ];
    workspaceEdit.failureHandling = FailureHandlingKind.TextOnlyTransactional;
    workspaceEdit.normalizesLineEndings = true;
    workspaceEdit.changeAnnotationSupport = {
      groupsOnLabel: true,
    };

    const diagnostics = ensure(ensure(result, "textDocument"), "publishDiagnostics");
    diagnostics.relatedInformation = true;
    diagnostics.versionSupport = false;
    diagnostics.tagSupport = {
      valueSet: [DiagnosticTag.Unnecessary, DiagnosticTag.Deprecated],
    };
    diagnostics.codeDescriptionSupport = true;
    diagnostics.dataSupport = true;

    const windowCapabilities = ensure(result, "window");
    const showMessage = ensure(windowCapabilities, "showMessage");
    showMessage.messageActionItem = { additionalPropertiesSupport: true };
    const showDocument = ensure(windowCapabilities, "showDocument");
    showDocument.support = true;

    // general
    const general = ensure(result, "general");
    general.positionEncodings = ["utf-16", 'utf-32'];

    // others
    for (const feature of this._features) {
      feature.fillClientCapabilities(result);
    }

    return result;
  }

  private initializeFeatures() {
    const documentSelector = this._clientOptions.documentSelector
    for (const feature of this._features) {
      feature.initialize(this._capabilities, documentSelector)
    }
  }

  private handleRegistrationRequest(params: RegistrationParams) {
    for (const registration of params.registrations) {
      const feature = this._dynamicFeatures.get(registration.method);
      if (!feature) {
        this.error(`No feature implementation for ${registration.method}`);
      }
      logger.info(`register ${registration.method}`, JSON.stringify(registration))
      this.registeredServerCapabilities.set(registration.method, registration);
    }
  }

  private async doInitialize(
    connection: ProtocolConnection,
    initParams: InitializeParams
  ): Promise<InitializeResult> {

    try {
      const result = await connection.sendRequest(InitializeRequest.type, initParams);
      if (
        result.capabilities.positionEncoding !== undefined &&
        result.capabilities.positionEncoding !== PositionEncodingKind.UTF16
      ) {
        throw new Error(
          `Unsupported position encoding (${result.capabilities.positionEncoding}) received from server ${this._name}`
        );
      }

      this._initializeResult = result;
      this.$state = ClientState.Running;

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

      // 记录当前 client 支持的 server  capabilities
      this._capabilities = Object.assign({}, result.capabilities, {
        resolvedTextDocumentSync: textDocumentSyncOptions,
      });
      this.initializeFeatures();

      await connection.sendNotification(InitializedNotification.type, {});

      return result;
    } catch (error) {
      if (error instanceof Error) {
        message_emacs("error " + ' message ' + error.message + ' stack' + error.stack);
      } else {
        message_emacs("error1: " + JSON.stringify(error))
      }
      this.error("Server initialization failed.", error);
      void this.stop();
      throw error;
    }
  }

  private activeConnection(): ProtocolConnection | undefined {
    return this.$state === ClientState.Running && this._connection !== undefined
      ? this._connection
      : undefined;
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
    mode: "suspend" | "stop",
    timeout: number
  ): Promise<void> {
    // If the client is stopped or in its initial state return.
    if (
      this.$state === ClientState.Stopped ||
      this.$state === ClientState.Initial
    ) {
      return;
    }

    // If we are stopping the client and have a stop promise return it.
    if (this.$state === ClientState.Stopping) {
      if (this._onStop !== undefined) {
        return this._onStop;
      } else {
        throw new Error("Client is stopping but no stop promise available.");
      }
    }

    const connection = this.activeConnection();

    // We can't stop a client that is not running (e.g. has no connection). Especially not
    // on that us starting since it can't be correctly synchronized.
    if (connection === undefined || this.$state !== ClientState.Running) {
      throw new Error(
        `Client is not running and can't be stopped. It's current state is: ${this.$state}`
      );
    }

    this._initializeResult = undefined;
    this.$state = ClientState.Stopping;

    const tp = new Promise<undefined>((c) => {
      RAL().timer.setTimeout(c, timeout);
    });
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const shutdown = (async (connection) => {
      await connection.sendRequest(ShutdownRequest.type, undefined);
      await connection.sendNotification(ExitNotification.type);
      return connection;
    })(connection);

    // eslint-disable-next-line @typescript-eslint/no-shadow
    return (this._onStop = Promise.race([tp, shutdown])
      .then(
        (connection) => {
          // The connection won the race with the timeout.
          if (connection !== undefined) {
            connection.end();
            connection.dispose();
          } else {
            this.error("Stopping server timed out");
            throw new Error("Stopping the server timed out");
          }
        },
        (error) => {
          this.error("Stopping server failed", error);
          throw error;
        }
      )
      .finally(() => {
        this.$state = ClientState.Stopped;
        this._onStart = undefined;
        this._onStop = undefined;
        this._connection = undefined;
      }));
  }

  private createOnStartPromise(): [
    Promise<void>,
    () => void,
    (error: any) => void
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

  // public async didChange(params: any) {
  //   this.sendNotification(DidChangeTextDocumentNotification.type, {
  //     textDocument: {
  //       uri: params.uri,
  //       version: this.updateFileVersion(params.uri),
  //     },
  //     contentChanges: [params.contentChange],
  //   });
  // }

  // private updateFileVersion(fileUri: string) {
  //   const version = this._fileVersions.get(fileUri) || 0;
  //   this._fileVersions.set(fileUri, version + 1);
  //   return version;
  // }

  public info(message: string, data?: any): void {
    const msg = `[Info  - ${new Date().toLocaleTimeString()}] ${
      message || data2String(data)
    }`;
    logger.info(msg)
  }

  public warn(message: string, data?: any): void {
    const msg = `[Warn  - ${new Date().toLocaleTimeString()}] ${
      message || data2String(data)
    }`;
    logger.info(msg)
  }

  public error(message: string, data?: any): void {
    const msg = `[Error  - ${new Date().toLocaleTimeString()}] ${
      message || data2String(data)
    }`;
    logger.info(msg)
  }

  private static RequestsToCancelOnContentModified: Set<string> = new Set([
    SemanticTokensRequest.method,
    SemanticTokensRangeRequest.method,
    SemanticTokensDeltaRequest.method,
  ]);
}
