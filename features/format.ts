import { DocumentFormattingParams, DocumentFormattingRegistrationOptions, DocumentFormattingRequest, RegistrationType, TextEdit } from "vscode-languageserver-protocol";
import { RunnableDynamicFeature } from "./features";
import { LanguageClient } from "../client";

export class DocumentFormatingFeature extends RunnableDynamicFeature<
  DocumentFormattingParams,
  DocumentFormattingParams,
  Promise<TextEdit[]>,
  DocumentFormattingRegistrationOptions
> {
  constructor(private client: LanguageClient) {
    super();
  }

  protected async runWith(params: DocumentFormattingParams): Promise<TextEdit[]> {
    const resp = await this.client.sendRequest(DocumentFormattingRequest.type, params);

    return resp ?? [];
  }

  public get registrationType(): RegistrationType<DocumentFormattingRegistrationOptions> {
    return DocumentFormattingRequest.type;
  }
}
