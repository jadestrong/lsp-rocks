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
import { message_emacs } from '../epc-utils';

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
    const items = completions.map((it, idx) => {
      const no = `${it.label}-${idx}`
      this.client.labelCompletionMap.set(no, it);
      return {
        ...it,
        no,
      }
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

  public async runWith(params: CompletionItem | undefined) {
    if (
      !this.client.checkCapabilityForMethod(CompletionResolveRequest.type) ||
      !params
    ) {
      return null;
    }
    const resp = await this.client.sendRequest(CompletionResolveRequest.type, params);
    // 如果下发了更详细的 detail
    if (resp && resp.detail && resp.detail !== params.detail) {
      const { detail, documentation } = resp;
      if (!documentation) {
        resp.documentation = {
          kind: 'markdown',
          value: detail,
        }
      } else if (typeof documentation === 'string') {
        resp.documentation = `${detail}\n\n${documentation}`;
      } else {
        resp.documentation = {
          ...documentation,
          value: `${detail}\n\n${documentation.value}`,
        }
      }
    }
    if (resp && resp.textEdit && InsertReplaceEdit.is(resp.textEdit)) {
      return {
        ...resp,
        textEdit: TextEdit.replace(resp.textEdit.replace, resp.textEdit.newText),
      }
    }
    return resp;

  }

  public get registrationType() {
    return CompletionResolveRequest.type;
  }
}
