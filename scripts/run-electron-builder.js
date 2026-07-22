#!/usr/bin/env node

// Running electron-builder through ELECTRON_RUN_AS_NODE can introduce an
// extra argv entry, so normalize the command line before loading the CLI.
const args = process.argv.slice(2);
if (args[0] === __filename) {
  args.shift();
}
process.argv = [process.argv[0], __filename, ...args];
require("../node_modules/electron-builder/out/cli/cli");
