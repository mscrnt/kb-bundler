/**
 * Small, zero-dependency helpers shared by config files and the bundler core.
 *
 *   const { tokenize, slugify, truncateWords, bytes, human, readJsonl } =
 *     require("@mscrnt/kb-bundler/helpers");
 */
const fs = require("node:fs");
const path = require("node:path");

function tokenize(s) {
  const out = new Set();
  for (const t of (s || "").toLowerCase().split(/\W+/)) {
    if (t.length > 2) out.add(t);
  }
  return Array.from(out);
}

function slugify(s, max = 80) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, max);
}

function truncateWords(s, n) {
  if (!s) return "";
  const words = s.split(/\s+/);
  return words.length <= n ? s : words.slice(0, n).join(" ") + " […]";
}

function truncateChars(s, n) {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n) + " […]";
}

function bytes(s) {
  return Buffer.byteLength(s, "utf8");
}

function human(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function readText(p) {
  return fs.readFileSync(p, "utf8");
}

function readJson(p) {
  return JSON.parse(readText(p));
}

function* readJsonl(p, { skipBad = true } = {}) {
  const text = readText(p);
  let lineNum = 0;
  for (const line of text.split("\n")) {
    lineNum += 1;
    const s = line.trim();
    if (!s) continue;
    try {
      yield JSON.parse(s);
    } catch (e) {
      if (!skipBad) throw new Error(`bad JSONL line ${lineNum} in ${p}: ${e.message}`);
      // skipBad: warn but continue
      console.warn(`[kb-bundler] skipping bad JSONL line ${lineNum} in ${path.basename(p)}: ${e.message}`);
    }
  }
}

function listDir(p, ext) {
  if (!fs.existsSync(p)) return [];
  return fs
    .readdirSync(p)
    .filter((f) => !ext || f.endsWith(ext))
    .sort();
}

function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split("\n")) {
    const colon = line.indexOf(": ");
    if (colon === -1) continue;
    fm[line.slice(0, colon).trim()] = line.slice(colon + 2).trim();
  }
  return { fm, body: m[2] };
}

module.exports = {
  tokenize,
  slugify,
  truncateWords,
  truncateChars,
  bytes,
  human,
  readText,
  readJson,
  readJsonl,
  listDir,
  parseFrontmatter,
};
