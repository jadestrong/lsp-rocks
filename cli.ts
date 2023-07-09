#!/usr/bin/env node

import { logger, message_emacs } from "./epc-utils";
import { LspRocks } from "./lsp-rocks";

new LspRocks().start();

process.on('uncaughtException', (err) => {
    console.log('uncaughtException', err);
    message_emacs('uncaughtException ' + JSON.stringify(err))
    logger.info('uncaughtException', err)
});

process.on("unhandledRejection", (reason, p) => {
  console.log("unhandledRejection err", reason, p);
    message_emacs('unhandledRejection err' + reason + ' ' + JSON.stringify(p))
    // logger.info('unhandledRejection err', reason, p)
});
