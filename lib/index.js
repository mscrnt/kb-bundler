/**
 * @mscrnt/kb-bundler — public API.
 *
 *   const { build } = require("@mscrnt/kb-bundler");
 *
 *   build({
 *     output: { inline: "./dist/data.js", r2: "./dist/r2" },
 *     inlineLimitBytes: 900 * 1024,    // optional, default 800 KB
 *     inlineHeader: "Optional comment block at top of the inline module",
 *     async build(ctx) {
 *       // ctx.inline.MY_INDEX = [...]     → goes into inline JS module
 *       // ctx.r2.write("foo/bar.json", {...}) → blob in the R2 dir
 *       // ctx.helpers.{tokenize, slugify, truncateWords, …}
 *     },
 *   });
 *
 * Resolves to a manifest object that describes what was written.
 * Writes:
 *   - <inline path>                         — single ES module file
 *   - <r2 path>/<key…>                      — one file per R2 object
 *   - <r2 path>/../kb_bundler_manifest.json — full manifest
 */
const fs = require("node:fs");
const path = require("node:path");
const helpers = require("./helpers");
const { R2Writer, writeInlineModule } = require("./writers");

const DEFAULT_INLINE_LIMIT_BYTES = 800 * 1024; // 800 KB — leaves room for Worker code on Free tier

function human(n) { return helpers.human(n); }

async function build(opts) {
  if (!opts || typeof opts.build !== "function") {
    throw new Error("kb-bundler: opts.build (async function) is required");
  }
  if (!opts.output || !opts.output.inline || !opts.output.r2) {
    throw new Error("kb-bundler: opts.output.inline and opts.output.r2 are required");
  }

  const inlinePath = path.resolve(opts.output.inline);
  const r2Dir = path.resolve(opts.output.r2);
  const manifestPath = path.join(path.dirname(r2Dir), "kb_bundler_manifest.json");
  const inlineLimit = opts.inlineLimitBytes || DEFAULT_INLINE_LIMIT_BYTES;

  // Wipe previous R2 outputs so we don't ship stale blobs.
  if (fs.existsSync(r2Dir)) fs.rmSync(r2Dir, { recursive: true, force: true });

  const r2 = new R2Writer(r2Dir);
  const ctx = {
    inline: {},
    r2,
    helpers,
    // convenience pass-through
    log: (...args) => console.log("[kb-bundler]", ...args),
  };

  await opts.build(ctx);

  // Write inline module
  const inlineBytes = writeInlineModule(inlinePath, ctx.inline, opts.inlineHeader || "");

  // Summarize inline exports for the manifest
  const inlineSummary = {};
  for (const [k, v] of Object.entries(ctx.inline)) {
    if (Array.isArray(v)) inlineSummary[k] = { type: "array", length: v.length };
    else if (v && typeof v === "object") inlineSummary[k] = { type: "object", keys: Object.keys(v).length };
    else inlineSummary[k] = { type: typeof v };
  }

  const stamp = new Date().toISOString();
  const manifest = {
    bundler: "@mscrnt/kb-bundler",
    build_stamp: stamp,
    inline: {
      // Absolute path so consumers (e.g. upload-r2, downstream copy
      // steps) don't need to know what CWD was at bundle time.
      path: inlinePath,
      bytes: inlineBytes,
      limit_bytes: inlineLimit,
      over_limit: inlineBytes > inlineLimit,
      exports: inlineSummary,
    },
    r2: {
      dir: r2Dir,
      object_count: r2.count(),
      total_bytes: r2.totalBytes(),
      objects: r2.objects.sort((a, b) => a.key.localeCompare(b.key)),
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  printReport(manifest);
  return manifest;
}

function printReport(m) {
  const buckets = {};
  for (const o of m.r2.objects) {
    const top = o.key.split("/")[0];
    (buckets[top] ||= { count: 0, bytes: 0 });
    buckets[top].count += 1;
    buckets[top].bytes += o.bytes;
  }
  console.log("");
  console.log("─── kb-bundler report ───────────────────────────────────────────");
  console.log(`Inline module : ${m.inline.path}`);
  console.log(
    `              : ${human(m.inline.bytes)} (limit ${human(m.inline.limit_bytes)})` +
      (m.inline.over_limit ? "  ⚠️  OVER LIMIT" : "  ✓"),
  );
  console.log(`R2 dir        : ${m.r2.dir}`);
  console.log(`              : ${m.r2.object_count} files, ${human(m.r2.total_bytes)} total`);
  for (const [b, s] of Object.entries(buckets).sort((a, c) => c[1].bytes - a[1].bytes)) {
    console.log(`              · ${b.padEnd(14)} ${String(s.count).padStart(5)} files  ${human(s.bytes).padStart(9)}`);
  }
  console.log("──────────────────────────────────────────────────────────────────");
}

module.exports = { build, helpers };
