import {
  type PublishDiagnosticsParams,
  type Diagnostic,
} from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import { filePathToProject } from './project';
import { eval_in_emacs } from './epc-utils';

interface DiagnosticItem {
  source: string;
  uri: string;
  diagnostics: Diagnostic[];
}

class DiagnosticCenter {
  private diagnosticMap: Map<string, DiagnosticItem[]> = new Map();

  getDiagnosticsByFilePath(filePath: string): Diagnostic[] {
    const uri = URI.file(filePath).toString();
    const projectRoot = filePathToProject.get(uri);
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
      theItem.diagnostics = diagnosticsParams.diagnostics;
    }
    eval_in_emacs('lsp-rocks--diagnostics-flycheck-report');
  }
}

const diagnosticCenter = new DiagnosticCenter();
export default diagnosticCenter;
