import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pino, Logger } from 'pino';

export let IS_DEBUG = true;

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

const debugLogFile = join(tmpdir(), `lsp-rocks:${process.pid}.log`);

const transport = pino.transport({
  targets: [
    {
      level: 'debug',
      target: 'pino-pretty',
      options: {
        destination: debugLogFile,
      },
    },
  ],
});

let logger: Logger;
const initLogger = () => {
  if (logger) {
    return logger;
  }
  logger = pino(transport);
  logger.level = 'debug';
  return logger;
};

initLogger();
export { logger };
