import {
  RegistrationType,
  Location,
  ReferenceParams,
  ReferenceRegistrationOptions,
  ReferencesRequest,
} from 'vscode-languageserver-protocol';
import { LanguageClient } from '../client';
import { RunnableDynamicFeature } from './features';
import { fileURLToPath } from 'node:url';

export class ReferencesFeature extends RunnableDynamicFeature<
  ReferenceParams,
  ReferenceParams,
  Promise<Location[]>,
  ReferenceRegistrationOptions
> {
  constructor(private client: LanguageClient) {
    super();
  }

  public async runWith(params: ReferenceParams): Promise<Location[]> {
    const resp = await this.client.sendRequest(ReferencesRequest.type, params);
    if (resp == null) return [];

    return resp.map(it => ({
      uri: fileURLToPath(it.uri),
      range: it.range,
    }));
  }

  public get registrationType(): RegistrationType<ReferenceRegistrationOptions> {
    return ReferencesRequest.type;
  }
}
