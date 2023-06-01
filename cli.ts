#!/usr/bin/env node

import { logger } from "./epc-utils";
import { LspRocks } from "./lsp-rocks";

new LspRocks().start();

process.on('uncaughtException', (err) => {
    console.log('uncaughtException', err);
    logger.info('uncaughtException', err)
});

process.on("unhandledRejection", (reason, p) => {
  console.log("unhandledRejection err", reason, p);
    // logger.info('unhandledRejection err', reason, p)
});
