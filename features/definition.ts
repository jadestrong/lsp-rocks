import {
  RegistrationType,
  DefinitionParams,
  DefinitionRegistrationOptions,
  DefinitionRequest,
  Location,
  LocationLink,
} from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { LanguageClient } from '../client';
import { RunnableDynamicFeature } from './features';

export class DefinitionFeature extends RunnableDynamicFeature<
  DefinitionParams,
  DefinitionParams,
  Promise<Location[]>,
  DefinitionRegistrationOptions
> {
  constructor(private client: LanguageClient) {
    super();
  }

  public async runWith(params: DefinitionParams): Promise<Location[]> {
    if (!this.client.checkCapabilityForMethod(DefinitionRequest.type)) {
      return [];
    }
    const resp = await this.client.sendRequest(DefinitionRequest.type, params);
    if (resp == null) return [];

    if (Array.isArray(resp)) {
      return resp.map((it: Location | LocationLink) => {
        if (this.isLocation(it)) {
          return { uri: URI.parse(it.uri).path, range: it.range };
        } else {
          return { uri: URI.parse(it.targetUri).path, range: it.targetRange };
        }
      });
    }

    return [{ uri: URI.parse(resp.uri).path, range: resp.range }];
  }

  private isLocation(value: any): value is Location {
    return 'uri' in value && 'range' in value;
  }

  public get registrationType(): RegistrationType<DefinitionRegistrationOptions> {
    return DefinitionRequest.type;
  }
}
