import { ResponseError } from "vscode-jsonrpc";
import * as Is from "../util";

function data2String(data: object): string {
  if (data instanceof ResponseError) {
    const responseError = data as ResponseError<any>;
    return `  Message: ${responseError.message}\n  Code: ${
      responseError.code
    } ${responseError.data ? "\n" + responseError.data.toString() : ""}`;
  }
  if (data instanceof Error) {
    if (Is.string(data.stack)) {
      return data.stack;
    }
    return (data as Error).message ?? JSON.stringify(data);
  }
  if (Is.string(data)) {
    return data;
  }
  return data.toString();
}

export default data2String
