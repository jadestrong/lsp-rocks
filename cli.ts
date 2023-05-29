#!/usr/bin/env node

import { LspRocks } from "./lsp-rocks";

new LspRocks().start();

process.on('uncaughtException', (err) => {
    console.log('uncaughtException', err);
});

process.on("unhandledRejection", (reason, p) => {
  console.log("unhandledRejection err", reason, p);
});
