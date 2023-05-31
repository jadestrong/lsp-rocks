import { ClientCapabilities, CompletionItem, CompletionItemTag, CompletionParams, CompletionRegistrationOptions, CompletionRequest, CompletionResolveRequest, InsertTextMode, MarkupKind, RegistrationType } from "vscode-languageserver-protocol";
import { LanguageClient } from "../client";
import { message_emacs } from "../epc-utils";
import { RunnableDynamicFeature, ensure } from "./features";

export interface EmacsCompletionParams extends CompletionParams {
  prefix: string;
}

/**
 * Store the CompletionItem corresponding to the label
 */
const labelCompletionMap: Map<string, CompletionItem> = new Map();

export class CompletionFeature extends RunnableDynamicFeature<EmacsCompletionParams, CompletionParams, Promise<CompletionItem[]>, CompletionRegistrationOptions> {

  private max_completion_size = 100;

  constructor(private client: LanguageClient) {
    super();
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    const completion = ensure(ensure(capabilities, 'textDocument')!, 'completion')!;
    completion.dynamicRegistration = true;
    completion.contextSupport = true;
    completion.completionItem = {
      snippetSupport: true,
      commitCharactersSupport: true,
      documentationFormat: [MarkupKind.Markdown, MarkupKind.PlainText],
      deprecatedSupport: true,
      preselectSupport: true,
      tagSupport: { valueSet: [CompletionItemTag.Deprecated] },
      insertReplaceSupport: false,
      insertTextModeSupport: { valueSet: [InsertTextMode.asIs, InsertTextMode.adjustIndentation] },
      labelDetailsSupport: true
    };
    completion.insertTextMode = InsertTextMode.adjustIndentation;
    // completion.completionItemKind = { valueSet: SupportedCompletionItemKinds };
    completion.completionList = {
      itemDefaults: [
        'commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode'
      ]
    };
  }

  // TODO 当前行的文本，当前鼠标所在的位置，当前的行
  // 根据这些计算 prefix 和 triggerChar
  // 另外支持的 triggerChar 需要根据 server 返回的配置来整合获取
  public async runWith(params: EmacsCompletionParams) {
    labelCompletionMap.clear();
    const { prefix } = params;

    const resp = await this.client.sendRequest(CompletionRequest.type, params);
    // message_emacs('completion resp' + JSON.stringify(resp))
    if (resp == null) return [];

    // TODO
    if (typeof resp == 'object' && Array.isArray(resp)) {
      return [];
    }

    const completions = resp.items.filter(it => it.label.startsWith(prefix))
      .slice(0, this.max_completion_size)
      .sort((a, b) => {
        if (a.sortText != undefined && b.sortText != undefined) {
          if (a.sortText == b.sortText) {
            return a.label.length - b.label.length;
          }
          return a.sortText < b.sortText ? -1 : 1;
        }
        return 0;
      });

    const head = completions.shift()
    if (head != undefined) {
      const resolvedHead = await this.client.sendRequest(CompletionResolveRequest.type, head);
      completions.unshift(resolvedHead);
    }
    completions.forEach(it => labelCompletionMap.set(it.label, it));
    return completions;
  }

  public get registrationType(): RegistrationType<CompletionRegistrationOptions> {
    return CompletionRequest.type;
  }

}


export class CompletionItemResolveFeature extends RunnableDynamicFeature<CompletionItem, CompletionItem, Promise<CompletionItem>, void> {

  constructor(private client: LanguageClient) {
    super();
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(ensure(capabilities, 'textDocument')!, 'completion')!, 'completionItem')!.resolveSupport = {
      properties: ['documentation', 'detail', 'additionalTextEdits']
    };
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
