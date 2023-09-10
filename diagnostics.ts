import {
  type PublishDiagnosticsParams,
  type Diagnostic,
} from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { fileUriToProject } from './project';
import { eval_in_emacs } from './epc-utils';
import { logger } from './logger';

interface DiagnosticItem {
  source: string;
  uri: string;
  diagnostics: Diagnostic[];
}

class DiagnosticCenter {
  private diagnosticMap: Map<string, DiagnosticItem[]> = new Map();

  getDiagnosticsByFilePath(filePath: string): Diagnostic[] {
    const uri = URI.file(filePath).toString();
    const projectRoot = fileUriToProject.get(uri);
    if (!projectRoot) {
      return [];
    }
    const itemsOfProject = this.diagnosticMap.get(projectRoot);
    return (
      itemsOfProject
        ?.filter(item => item.uri === uri)
        .reduce((prev, cur) => {
          return prev.concat(cur.diagnostics);
        }, [] as Diagnostic[]) ?? []
    );
  }

  setDiagnosticsByProjectRoot(
    projectRoot: string,
    source: string,
    diagnosticsParams: PublishDiagnosticsParams,
  ) {
    let isReport = true;
    let items = this.diagnosticMap.get(projectRoot);
    if (!items) {
      items = [];
      this.diagnosticMap.set(projectRoot, items);
    }
    const theItem = items.find(
      item => item.uri === diagnosticsParams.uri && item.source === source,
    );
    if (!theItem) {
      items.push({
        ...diagnosticsParams,
        source,
      });
    } else {
      if (
        (!theItem.diagnostics.length &&
          !diagnosticsParams.diagnostics.length) ||
        JSON.stringify(theItem.diagnostics) ===
          JSON.stringify(diagnosticsParams.diagnostics)
      ) {
        isReport = false;
      }
      theItem.diagnostics = diagnosticsParams.diagnostics;
    }

    if (!isReport) {
      return;
    }
    const diagnostics = items
      .filter(item => item.uri === diagnosticsParams.uri)
      .reduce((prev, cur) => {
        return prev.concat(cur.diagnostics);
      }, [] as Diagnostic[]);

    logger.info({
      msg: `diagnostics ${source}`,
      data: diagnosticsParams,
    });

    const filePath = URI.parse(diagnosticsParams.uri).fsPath;
    eval_in_emacs(
      'lsp-rocks--diagnostics-flycheck-report',
      filePath,
      diagnostics,
    );
  }
}

const diagnosticCenter = new DiagnosticCenter();
export default diagnosticCenter;
