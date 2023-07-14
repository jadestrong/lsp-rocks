import { ConfigurationRequest } from "vscode-languageserver-protocol";
import { LanguageClient } from "../client";
import { RunnableDynamicFeature } from "./features";

export class ConfigurationFeature extends RunnableDynamicFeature<
  any,
  any,
  any,
  any
> {
  constructor(private client: LanguageClient) {
    super();
  }

  public get registrationType() {
    return ConfigurationRequest.type
  }

  public initialize() {
    this.client.onRequest(ConfigurationRequest.type, () => {
      return [this.client._initializationOptions]
    })
  }

  protected runWith() {
    //
  }
}
