import { encode, quote, symbol, startServer, RPCServer } from 'ts-elrpc';

let epc_client: RPCServer | null = null;

export async function init_epc_server() {
    if (epc_client === null) {
        try {
            epc_client = await startServer();
        } catch(e) {
            console.error(e);
        }
    }
    return epc_client;
}

export function close_epc_client() {
    if (epc_client) {
        epc_client.stop()
    }
}

export function handle_arg_types(arg: any) {
    if (typeof arg === 'string' && arg.startsWith("'")) {
        arg = symbol(arg.split("'")[1]);
    }
    return quote(arg);
}

export async function eval_in_emacs(method_name: string, ...args: any[]) {
    const _args = [symbol(method_name), ...(args.map(handle_arg_types))];
    const sexp = encode(_args);
    return await epc_client?.callMethod('eval-in-emacs', [sexp]);
}

export async function message_emacs(message: string) {
    eval_in_emacs("message", `[LSP-ROCKS] ${message}`);
}

export function convert_emacs_bool(symbol_value: any, symbol_is_boolean: 't' | 'nil') {
    if (symbol_is_boolean == 't') {
        return symbol_value === 't';
    } else {
        return symbol_value;
    }
}

export async function get_emacs_vars(args: string[]) {
  const results = await epc_client?.callMethod<Array<[any, 't'| 'nil']>>('get-emacs-vars', args)
  return (results ?? []).map(([symbol_value, symbol_is_boolean]) => {
        return convert_emacs_bool(symbol_value, symbol_is_boolean);
    });
}

export async function get_emacs_var(var_name: string) {
  const result = await epc_client?.callMethod<[any, 't' | 'nil']>('get-emacs-var', var_name);
    // message_emacs("resutl", result)
    if (!result) {
        throw new Error(`[LSP-ROCKS] no such variable: ${var_name}`);
    }
    const [symbol_value, symbol_is_boolean] = result;
    return convert_emacs_bool(symbol_value, symbol_is_boolean)
}

export async function get_emacs_func_result<T extends boolean>(method_name: string, ...args: any[]): Promise<T> {
    const _args = [symbol(method_name), ...(args.map(handle_arg_types))];
    const sexp = encode(_args);
    const result = await epc_client?.callMethod<any>('get-emacs-func-result', [sexp])
    return result === 't' ? true : result;
}

export const logger = {
  info: (...args: any[]) => {
    eval_in_emacs('lsp-rocks--log', ...args)
  },
}

interface Response {
  id: string | number,
  cmd: string,
  data: any[]
}
export function send_response_to_emacs(resp: Response) {
  eval_in_emacs("lsp-rocks--message-handler", resp)
}
