#!/usr/bin/env node
/**
 * kb-bundler CLI
 *
 *   kb-bundler bundle <config.js>            run a bundler config
 *   kb-bundler upload-r2 <manifest.json>     upload a bundle's R2 blobs
 *   kb-bundler --help
 *
 * `bundle` simply requires() the config — the config file calls build()
 * from the library. This keeps the CLI thin and lets configs use any
 * Node feature they want.
 */
const path = require("node:path");
const fs = require("node:fs");

const VERSION = require("../package.json").version;

function help() {
  console.log(`kb-bundler v${VERSION}

USAGE
  kb-bundler bundle <config.js>
      Execute a bundler config (the config calls build() from the library).

  kb-bundler upload-r2 <manifest.json> --bucket <bucket> [--prefix <p>]
                                       [--concurrency <n>]
      Upload R2 blobs from a bundle's manifest to a CF R2 bucket.
      Credentials via env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.

  kb-bundler --help          Show this message.
  kb-bundler --version       Print version.

LIBRARY USAGE
  const { build, helpers } = require("@mscrnt/kb-bundler");
  build({
    output: { inline: "./dist/data.js", r2: "./dist/r2" },
    async build(ctx) { ctx.inline.MY_INDEX = [...]; ctx.r2.write(...); },
  });
`);
}

function parseFlags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "--help" || args[0] === "-h") {
    help();
    process.exit(0);
  }
  if (args[0] === "--version" || args[0] === "-v") {
    console.log(VERSION);
    process.exit(0);
  }

  const [cmd, ...rest] = args;

  if (cmd === "bundle") {
    const flags = parseFlags(rest);
    const configPath = flags._[0];
    if (!configPath) {
      console.error("kb-bundler: bundle requires a config file path");
      process.exit(2);
    }
    const resolved = path.resolve(configPath);
    if (!fs.existsSync(resolved)) {
      console.error(`kb-bundler: config not found: ${resolved}`);
      process.exit(2);
    }
    // The config file is expected to call build() from the library itself.
    // We just require() it and let it run.
    try {
      require(resolved);
    } catch (e) {
      console.error(`kb-bundler: config failed: ${e.stack || e.message}`);
      process.exit(1);
    }
    return;
  }

  if (cmd === "upload-r2") {
    const flags = parseFlags(rest);
    const manifestPath = flags._[0];
    if (!manifestPath) {
      console.error("kb-bundler: upload-r2 requires a manifest path");
      process.exit(2);
    }
    const { uploadR2 } = require("../lib/upload-r2");
    const res = await uploadR2(path.resolve(manifestPath), {
      bucket: flags.bucket,
      prefix: flags.prefix || "",
      token: process.env.CLOUDFLARE_API_TOKEN || flags.token,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID || flags["account-id"],
      concurrency: Number(flags.concurrency || 8),
    });
    process.exit(res.failed > 0 ? 1 : 0);
  }

  console.error(`kb-bundler: unknown command "${cmd}". Try --help.`);
  process.exit(2);
}

main().catch((e) => {
  console.error("kb-bundler: fatal:", e.stack || e.message);
  process.exit(1);
});
