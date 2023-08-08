import {
  CompletionItem,
  CompletionParams,
  CompletionRegistrationOptions,
  CompletionRequest,
  CompletionResolveRequest,
  CompletionTriggerKind,
  InsertReplaceEdit,
  RegistrationType,
  TextEdit,
} from 'vscode-languageserver-protocol';
import { LanguageClient } from '../client';
import { byteSlice } from '../utils/string';
import { RunnableDynamicFeature } from './features';
import filterItems from '../utils/filterItems';
// import { message_emacs } from '../epc-utils';
import { logger } from '../logger';

export interface EmacsCompletionParams extends CompletionParams {
  /* 当前输入所在行的文本 */
  line: string;
  /** 当前输入时光标所在的列 */
  column: number;
}

/**
 * Store the CompletionItem corresponding to the label
 */
// const labelCompletionMap: Map<string, CompletionItem> = new Map();

export class CompletionFeature extends RunnableDynamicFeature<
  EmacsCompletionParams,
  CompletionParams,
  Promise<CompletionItem[]>,
  CompletionRegistrationOptions
> {
  private max_completion_size = 100;

  constructor(private client: LanguageClient) {
    super();
  }

  public async runWith(params: EmacsCompletionParams) {
    if (!this.client.checkCapabilityForMethod(CompletionRequest.type)) {
      return [];
    }
    this.client.labelCompletionMap.clear();
    const { line, column, textDocument, position } = params;

    logger.debug({
      message: 'completion request',
      data: params,
    });
    const pretext = byteSlice(line, 0, column);
    const triggerCharacter = this.client.triggerCharacters.find(triggerChar =>
      pretext.endsWith(triggerChar),
    );
    const completionParams: CompletionParams = {
      textDocument,
      position,
      context: {
        triggerKind: triggerCharacter
          ? CompletionTriggerKind.TriggerCharacter
          : CompletionTriggerKind.Invoked,
        triggerCharacter,
      },
    };

    const resp = await this.client.sendRequest(
      CompletionRequest.type,
      completionParams,
    );
    // message_emacs('completion resp' + JSON.stringify(resp))
    if (resp == null) return [];

    // TODO
    if (typeof resp == 'object' && Array.isArray(resp)) {
      return [];
    }

    const completions = filterItems(pretext, resp.items).slice(
      0,
      this.max_completion_size,
    );
    const items = completions.map<EmacsCompletionItem>((it, idx) => {
      const no = `${it.label}-${idx}`;
      const item = {
        ...it,
        no,
        source: this.client.name,
      };
      this.client.labelCompletionMap.set(no, item);
      return item;
    });
    return items;
  }

  public get registrationType(): RegistrationType<CompletionRegistrationOptions> {
    return CompletionRequest.type;
  }
}

export class CompletionItemResolveFeature extends RunnableDynamicFeature<
  CompletionItem,
  CompletionItem | undefined,
  Promise<CompletionItem | null>,
  void
> {
  constructor(private client: LanguageClient) {
    super();
  }

  public createParams(params: CompletionItem) {
    const item = this.client.labelCompletionMap.get(params.label);
    return item;
  }

  private isRequestCapable(): boolean {
    return this.client.checkCapabilityForMethod(CompletionResolveRequest.type);
  }

  private async resolveCompletionRequest(params: EmacsCompletionItem) {
    if (params.resolving) {
      logger.info(`${params.no} hit a resolve cache`);
      return params.resolving;
    }
    params.resolving = this.client.sendRequest(
      CompletionResolveRequest.type,
      params,
    );
    return params.resolving;
  }

  public async runWith(params: EmacsCompletionItem | undefined) {
    if (!this.isRequestCapable() || !params) {
      return null;
    }
    let resp: CompletionItem | undefined;
    if (params.resolving) {
      logger.info(`${params.no} hit a resolve cache`);
      resp = await params.resolving;
    } else {
      resp = await this.resolveCompletionRequest(params);
    }

    // let resp = await (params.resolving
    //   ? params.resolving
    //   : (params.resolving = this.client.sendRequest(
    //       CompletionResolveRequest.type,
    //       params,
    //     )));
    // 如果下发了更详细的 detail
    if (resp && resp.detail && resp.detail !== params.detail) {
      const { detail, documentation } = resp;
      if (!documentation) {
        resp.documentation = {
          kind: 'markdown',
          value: detail,
        };
      } else if (typeof documentation === 'string') {
        resp.documentation = `${detail}\n\n${documentation}`;
      } else {
        resp.documentation = {
          ...documentation,
          value: `${detail}\n\n${documentation.value}`,
        };
      }
    }
    if (resp && resp.textEdit && InsertReplaceEdit.is(resp.textEdit)) {
      return {
        ...resp,
        textEdit: TextEdit.replace(
          resp.textEdit.replace,
          resp.textEdit.newText,
        ),
      };
    }
    return resp;
  }

  public get registrationType() {
    return CompletionResolveRequest.type;
  }
}
