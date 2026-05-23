/**
 * Minimal kb-bundler config — bundle a flat list of markdown notes into
 * an inline JS module (no R2 needed).
 *
 *   $ kb-bundler bundle examples/simple/config.js
 */
const path = require("node:path");
const { build, helpers } = require("@mscrnt/kb-bundler");

const SRC = path.join(__dirname, "notes");
const OUT = path.join(__dirname, "dist");

build({
  output: {
    inline: path.join(OUT, "notes_data.js"),
    r2: path.join(OUT, "r2"),  // will be empty for this example
  },
  inlineHeader: "Minimal kb-bundler example — flat-notes bundle",
  async build(ctx) {
    const { listDir, readText, parseFrontmatter, tokenize } = ctx.helpers;
    const notes = [];
    for (const f of listDir(SRC, ".md")) {
      const { fm, body } = parseFrontmatter(readText(path.join(SRC, f)));
      notes.push({
        slug: f.replace(/\.md$/, ""),
        title: fm.title || f,
        type: fm.type || "note",
        body,
        tokens: tokenize(fm.title + " " + body),
      });
    }
    ctx.inline.NOTES = notes;
  },
});
