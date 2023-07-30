#!/usr/bin/env node

import { message_emacs } from './epc-utils';
import { logger } from './logger';
import { LspRocks } from './lsp-rocks';

new LspRocks().start();

process.on('uncaughtException', err => {
  console.log('uncaughtException', err);
  message_emacs('uncaughtException ' + err.message);
  logger.error({
    msg: 'uncaughtException',
    data: err,
  });
});

process.on('unhandledRejection', (reason, p) => {
  console.log('unhandledRejection err', reason, p);
  message_emacs(
    'unhandledRejection err ' +
      reason +
      ' message ' +
      (reason as Error).message +
      ' stack ' +
      (reason as Error).stack +
      JSON.stringify(p),
  );
  logger.error({
    msg: 'unhandledRejection',
    reason,
    p
  })
});
