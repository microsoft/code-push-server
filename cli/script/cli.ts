#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as parser from "./command-parser";
import * as execute from "./command-executor";
import * as chalk from "chalk";

function run() {
  const command = parser.createCommand();

  if (!command) {
    parser.showHelp(/*showRootDescription*/ false);
    return;
  }

  execute
    .execute(command)
    .catch((error: any): void => {
      console.error(chalk.red(`[Error]  ${error.message}`));
      process.exit(1);
    })
    .done();
}

run();
