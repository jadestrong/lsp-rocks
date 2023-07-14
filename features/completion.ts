import {
  CompletionItem,
  CompletionParams,
  CompletionRegistrationOptions,
  CompletionRequest,
  CompletionResolveRequest,
  CompletionTriggerKind,
  RegistrationType,
} from 'vscode-languageserver-protocol';
import { LanguageClient } from '../client';
import { byteSlice } from '../utils/string';
import { RunnableDynamicFeature } from './features';
import filterItems from '../utils/filterItems';

export interface EmacsCompletionParams extends CompletionParams {
  /* 当前输入所在行的文本 */
  line: string;
  /** 当前输入时光标所在的列 */
  column: number;
}

/**
 * Store the CompletionItem corresponding to the label
 */
const labelCompletionMap: Map<string, CompletionItem> = new Map();

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
    labelCompletionMap.clear();
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

    resp.items.forEach(it => labelCompletionMap.set(it.label, it));
    const completions = filterItems(pretext, resp.items).slice(
      0,
      this.max_completion_size,
    );
    return completions;
  }

  public get registrationType(): RegistrationType<CompletionRegistrationOptions> {
    return CompletionRequest.type;
  }
}

export class CompletionItemResolveFeature extends RunnableDynamicFeature<
  CompletionItem,
  CompletionItem,
  Promise<CompletionItem>,
  void
> {
  constructor(private client: LanguageClient) {
    super();
  }

  public createParams(params: CompletionItem): CompletionItem {
    const item = labelCompletionMap.get(params.label);
    if (item == undefined) {
      throw new Error(`Can not find CompletionItem by label ${params.label}`);
    }
    return item;
  }

  public async runWith(params: CompletionItem) {
    return this.client.sendRequest(CompletionResolveRequest.type, params);
  }

  public get registrationType() {
    return CompletionResolveRequest.type;
  }
}
