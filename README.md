# kb-bundler

> Build a structured knowledge base into a Cloudflare-Pages-friendly artifact: a small inline JS module + a directory of R2 blobs. For edge-native RAG / structured-lookup chat UIs.

If you're shipping a chat that runs at the Cloudflare edge against a fixed knowledge base — heroes wiki, fan-encyclopedia, product catalog, docs site — this is the build step in between "messy source files" and "Worker that responds in 100 ms".

It does two things:

1. **Inline bundle** — a single ES module (`data.js`) of small indexes the Worker imports directly. Things like hero rosters, character name → slug maps, topic lists. Designed to fit inside the Workers script size limit (1 MB free, 10 MB paid).
2. **R2 bundle** — a folder of per-record JSON/MD blobs the Worker fetches on demand. Things like full character bios, per-book scene summaries, per-topic guide content. Storage is essentially free (10 GB R2 free tier) and reads are fast (single-digit ms from a Worker).

You decide what goes where in a short JS config file. The library exposes the primitives, the config has the rules.

## Why does this exist?

OpenWebUI / LibreChat / similar self-hosted chat platforms are great behind a login, but they're awkward for *public* chat UIs — you need rate limiting, you can't expose your API key, the workspace tool pipeline often relies on a WebSocket to a logged-in browser session.

The pattern that actually works for public RAG chat is:
- Cloudflare Pages serves a static HTML chat UI
- A Pages Function (Worker) handles each user message: validates, rate-limits, then runs an OpenAI-style tool loop against a model endpoint
- Tools execute at the edge against bundled data (no extra backend service)
- Tool calls that need more than a tiny index fetch from R2

This package is the "bundle the data once, ship it" part of that pattern. It's pulled out of an internal pipeline that powers a couple of public chat sites (`tavern.mscrnt.com` is a Top Heroes companion, `bob.mscrnt.com` is a Dresden Files lookup persona) and generalised so you can use the same plumbing.

## Install

```bash
npm install --save-dev @mscrnt/kb-bundler
```

Or run via Docker, no install needed (see `Dockerfile` for details):

```bash
docker run --rm \
  -v "$PWD":/workspace \
  -v /path/to/your/data:/datasets:ro \
  -v "$PWD"/dist:/output \
  ghcr.io/mscrnt/kb-bundler bundle /workspace/your-config.js
```

## Quick start

Create `your-config.js`:

```js
const path = require("node:path");
const { build, helpers } = require("@mscrnt/kb-bundler");

build({
  output: {
    inline: path.join(__dirname, "dist", "data.js"),
    r2:     path.join(__dirname, "dist", "r2"),
  },
  inlineLimitBytes: 900 * 1024,           // optional, default 800 KB
  inlineHeader: "My site's KB bundle",
  async build(ctx) {
    const { listDir, readText, parseFrontmatter, tokenize, slugify } = ctx.helpers;

    // Inline: small index of titles, types, tokens — used by the Worker
    // to decide what to fetch from R2 on each tool call.
    const docs = [];
    for (const f of listDir("./source/kb", ".md")) {
      const { fm, body } = parseFrontmatter(readText("./source/kb/" + f));
      const slug = slugify(fm.title || f);
      docs.push({ slug, title: fm.title, type: fm.type, tokens: tokenize(fm.title + " " + body) });
      // R2: full document body keyed by slug — fetched on demand.
      ctx.r2.write(`docs/${slug}.md`, body, "text/markdown");
    }
    ctx.inline.DOCS = docs;
  },
});
```

Run it:

```bash
npx kb-bundler bundle ./your-config.js
```

You get:

```
dist/
├── data.js                            ← Worker imports this
├── kb_bundler_manifest.json           ← what got built
└── r2/
    └── docs/
        ├── hero-foo.md
        ├── hero-bar.md
        └── …                          ← upload these to R2
```

Then upload the R2 blobs once (per build) to your bucket:

```bash
export CLOUDFLARE_API_TOKEN=xxx       # token needs R2 Edit permission
export CLOUDFLARE_ACCOUNT_ID=yyy
npx kb-bundler upload-r2 ./dist/kb_bundler_manifest.json --bucket my-bundle
```

In your Worker:

```js
import { DOCS } from "./_lib/data.js";

export async function onRequestPost({ request, env }) {
  // env.MY_R2 is an R2 binding declared in wrangler.toml
  const slug = /* derived from request */;
  const doc = DOCS.find(d => d.slug === slug);
  if (!doc) return new Response("not found", { status: 404 });
  const obj = await env.MY_R2.get(`docs/${slug}.md`);
  return new Response(obj.body, { headers: { "content-type": "text/markdown" } });
}
```

## API

### `build(opts) → Promise<manifest>`

| field | required | description |
|---|---|---|
| `output.inline` | yes | path where the inline ES module is written |
| `output.r2` | yes | directory where per-key R2 blobs are written |
| `inlineLimitBytes` | no | warn (and mark `over_limit` in manifest) if inline exceeds this. Default 800 KB |
| `inlineHeader` | no | comment block written at the top of the inline module |
| `build(ctx)` | yes | async function called with the build context |

The `ctx` argument provides:

| field | description |
|---|---|
| `ctx.inline` | object to populate; each `SCREAMING_SNAKE_CASE` key becomes a named export of the inline module |
| `ctx.r2.write(key, content, contentType?)` | write an R2 blob. `content` can be a string or a JSON-serialisable object |
| `ctx.helpers` | the same helpers exposed by `require("@mscrnt/kb-bundler/helpers")` |
| `ctx.log(...args)` | prefixed console.log |

### Helpers (`require("@mscrnt/kb-bundler/helpers")`)

- `tokenize(s)` → lowercase, length-3+ word tokens (good enough for keyword scoring at the edge)
- `slugify(s, max=80)` → safe lowercase slug
- `truncateWords(s, n)` / `truncateChars(s, n)` — cap output, append `[…]`
- `bytes(s)` / `human(n)` — byte size + pretty printer
- `readText(p)` / `readJson(p)` / `readJsonl(p)` — file readers (JSONL is a generator)
- `listDir(p, ext?)` — sorted directory listing
- `parseFrontmatter(text)` → `{ fm, body }`

## CLI

```
kb-bundler bundle <config.js>            run a bundler config
kb-bundler upload-r2 <manifest.json> --bucket <bucket> [--prefix <p>]
                                     [--concurrency <n>]
kb-bundler --help
kb-bundler --version
```

`upload-r2` reads credentials from env:
- `CLOUDFLARE_API_TOKEN` — needs **R2 → Edit** permission for the target bucket
- `CLOUDFLARE_ACCOUNT_ID`

## Container

A `Dockerfile` ships with the repo. Use it as a one-shot or as a persistent service:

```bash
# one-shot
docker run --rm \
  -v $PWD:/workspace \
  -v /path/to/data:/datasets:ro \
  -v $PWD/dist:/output \
  mscrnt/kb-bundler bundle /workspace/my-config.js

# persistent (exec into it for each build, faster — no container startup cost)
docker run -d --name kb-bundler \
  -v /path/to/data:/datasets:ro \
  -v /path/to/configs:/workspace:ro \
  -v /path/to/output:/output \
  --entrypoint /bin/sh mscrnt/kb-bundler -c "tail -f /dev/null"
docker exec kb-bundler kb-bundler bundle /workspace/my-config.js
```

## Examples

- `examples/simple/` — flat list of markdown notes → inline only, no R2

## Design notes

- **Zero npm dependencies** at runtime — uses only Node stdlib + native `fetch`. Easy to audit, fast cold-start in the container.
- **The bundler does not push to R2** by default. It writes the blob set to a local directory and emits a manifest. A separate `upload-r2` command (or your CI) does the actual upload. This means you can build offline, inspect what's about to ship, and decide when to rotate.
- **Inline exports are SCREAMING_SNAKE_CASE** — enforced. Keeps it obvious what's "build-time data" vs runtime code.
- **The R2 blob dir is wiped on each build** so you don't ship stale objects you removed from the config.

## Status

Public release of an internal tool. The API at 0.x is subject to change as the second and third sites land. Pinning by tag/sha is fine.

If you use it for something, open an issue / PR — happy to support more knowledge-base shapes in the helpers.
