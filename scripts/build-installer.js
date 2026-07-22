#!/usr/bin/env node

async function main() {
  const builder = require("../node_modules/electron-builder");
  const { Platform, Arch } = builder;
  const targets = new Map([
    [Platform.WINDOWS, new Map([[Arch.x64, ["nsis", "portable"]]])],
  ]);

  const result = await builder.build({
    targets,
    projectDir: process.cwd(),
    publish: "never",
  });

  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
