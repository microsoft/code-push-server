#!/usr/bin/env node
"use strict";
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
Object.defineProperty(exports, "__esModule", { value: true });
const parser = require("./command-parser");
const execute = require("./command-executor");
const chalk = require("chalk");
function run() {
    const command = parser.createCommand();
    if (!command) {
        parser.showHelp(/*showRootDescription*/ false);
        return;
    }
    execute
        .execute(command)
        .catch((error) => {
        console.error(chalk.red(`[Error]  ${error.message}`));
        process.exit(1);
    })
        .done();
}
run();
