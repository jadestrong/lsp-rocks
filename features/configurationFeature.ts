import {
  ClientCapabilities,
  ConfigurationRequest,
} from "vscode-languageserver-protocol";
import { LanguageClient } from "../client";
import { logger } from "../epc-utils";
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
      logger.info(`[Sending response] ${ConfigurationRequest.method}`, JSON.stringify(this.client._initializationOptions))
      return this.client._initializationOptions;
    })
  }

  protected runWith() {
    //
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    capabilities.workspace = capabilities.workspace ?? {}
    capabilities.workspace.configuration = true
  }
}
