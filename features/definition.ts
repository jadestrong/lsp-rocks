import {
  RegistrationType,
  DefinitionParams,
  DefinitionRegistrationOptions,
  DefinitionRequest,
  Location,
  LocationLink,
} from 'vscode-languageserver-protocol';
import { fileURLToPath } from 'node:url';
import { LanguageClient } from '../client';
import methodRequirements from '../constants/methodRequirements';
import { toMethod } from '../util';
import { RunnableDynamicFeature } from './features';
import { message_emacs } from '../epc-utils';

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
          return { uri: fileURLToPath(it.uri), range: it.range };
        } else {
          return { uri: fileURLToPath(it.targetUri), range: it.targetRange };
        }
      });
    }

    return [{ uri: fileURLToPath(resp.uri), range: resp.range }];
  }

  private isLocation(value: any): value is Location {
    return 'uri' in value && 'range' in value;
  }

  public get registrationType(): RegistrationType<DefinitionRegistrationOptions> {
    return DefinitionRequest.type;
  }
}
