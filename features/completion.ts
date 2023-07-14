import { ClientCapabilities, CompletionItem, CompletionParams, CompletionRegistrationOptions, CompletionRequest, CompletionResolveRequest, CompletionTriggerKind, InsertTextMode, MarkupKind, RegistrationType} from "vscode-languageserver-protocol";
import { LanguageClient } from "../client";
import { byteSlice } from "../utils/string";
import { RunnableDynamicFeature, ensure } from "./features";
import filterItems from "../utils/filterItems";

export interface EmacsCompletionParams extends CompletionParams {
  // prefix: string;
  /* 当前输入所在行的文本 */
  line: string;
  /** 当前输入时光标所在的列 */
  column: number;
}

// export interface CompletionRegistrationOptions extends TextDocumentRegistrationOptions, CompletionOptions {}

const findTriggerCharacter = (pretext: string, triggerCharacters: string[] | undefined) => {
  return triggerCharacters?.find(triggerCharacter => {
    return pretext.endsWith(triggerCharacter);
  });
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
    const completion = ensure(ensure(capabilities, 'textDocument'), 'completion');
    completion.dynamicRegistration = true;
    completion.contextSupport = true;
    completion.completionItem = {
      snippetSupport: true,
      commitCharactersSupport: true,
      documentationFormat: [MarkupKind.Markdown, MarkupKind.PlainText],
      deprecatedSupport: true,
      insertReplaceSupport: true,
      insertTextModeSupport: { valueSet: [InsertTextMode.asIs, InsertTextMode.adjustIndentation] },
      labelDetailsSupport: true
    };
    // completion.insertTextMode = InsertTextMode.adjustIndentation;
    // completion.completionItemKind = { valueSet: SupportedCompletionItemKinds };
    // NOTE 这个开启会导致不返回 textEdit ，这个属性的作用是可以将 items 里面的相同的属性提取出来，
    // 比如 textEdit 这样就可以显著减少补全列表的体积大小
    // completion.completionList = {
    //   itemDefaults: [
    //     'commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode'
    //   ]
    // };
  }

  // TODO 当前行的文本，当前鼠标所在的位置，当前的行
  // 根据这些计算 prefix 和 triggerChar
  // 另外支持的 triggerChar 需要根据 server 返回的配置来整合获取，从 client 上取 server 下发的 trigger 么？
  public async runWith(params: EmacsCompletionParams) {
    labelCompletionMap.clear();
    const { registeredServerCapabilities } = this.client;
    const { registerOptions } = registeredServerCapabilities.get('textDocument/completion') ?? {}
    const { triggerCharacters } = registerOptions as CompletionRegistrationOptions ?? {}
    const { line, column, textDocument, position } = params;

    const pretext = byteSlice(line, 0, column);
    const triggerCharacter = findTriggerCharacter(pretext, triggerCharacters)
    // message_emacs(`pretext ${pretext} ${triggerCharacters?.join(' ')}`)
    const completionParams: CompletionParams = {
      textDocument,
      position,
      context: {
        triggerKind: triggerCharacter ? CompletionTriggerKind.TriggerCharacter : CompletionTriggerKind.Invoked,
        triggerCharacter,
      }
    }

    const resp = await this.client.sendRequest(CompletionRequest.type, completionParams);
    // message_emacs('completion resp' + JSON.stringify(resp))
    if (resp == null) return [];

    // TODO
    if (typeof resp == 'object' && Array.isArray(resp)) {
      return [];
    }

    resp.items.forEach(it => labelCompletionMap.set(it.label, it));
    const completions = filterItems(pretext, resp.items).slice(0, this.max_completion_size)
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
    ensure(ensure(ensure(capabilities, 'textDocument'), 'completion'), 'completionItem').resolveSupport = {
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
