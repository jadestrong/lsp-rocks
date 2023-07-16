import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pino } from 'pino';

export let IS_DEBUG = false;

export const toggleDebug = () => {
  IS_DEBUG = !IS_DEBUG;
  return IS_DEBUG;
};

export const createLogger = (clientName: string) => {
  const logfile = join(tmpdir(), `lsp-rocks:${clientName}-${process.pid}.log`);

  const transport = pino.transport({
    targets: [
      {
        level: IS_DEBUG ? 'debug' : 'info',
        target: 'pino-pretty',
        options: {
          destination: logfile,
          // messageFormat: (log: Record<string, unknown>, messageKey: string) => {
          //   // do some log message customization
          //   return `hello ${log[messageKey]}`;
          // }
        },
      },
    ],
  });

  const logger = pino(transport);

  return logger;
};
