/**
 * Upload R2 blob directory produced by `kb-bundler bundle` to a Cloudflare
 * R2 bucket via the S3-compatible HTTP API.
 *
 * Credentials are read from env:
 *   R2_ACCOUNT_ID         — Cloudflare account id
 *   R2_ACCESS_KEY_ID      — R2 API token access key (Manage R2 API tokens)
 *   R2_SECRET_ACCESS_KEY  — R2 API token secret
 *
 * Usage from CLI:
 *   kb-bundler upload-r2 <manifest.json> --bucket <bucket-name> [--prefix <prefix>]
 *
 * Uses native fetch (Node 18+); zero npm dependencies.
 *
 * NOTE: R2 supports an S3-compatible endpoint at
 *   https://<account_id>.r2.cloudflarestorage.com/<bucket>/<key>
 * but signing requires AWS Sig v4. To keep dependencies at zero we use
 * the simpler official R2 PUT endpoint via a Cloudflare API token instead:
 *   PUT https://api.cloudflare.com/client/v4/accounts/<account_id>/r2/buckets/<bucket>/objects/<url-encoded-key>
 * which only needs Authorization: Bearer <CF API token with R2 Write>.
 */
const fs = require("node:fs");
const path = require("node:path");
const { human } = require("./helpers");

// Lower default concurrency than feels intuitive — the Cloudflare API
// endpoint we use (Bearer-token /accounts/.../r2/buckets/.../objects PUT)
// rate-limits aggressively (code 971 "Please wait and consider throttling").
// 4 parallel workers with retry-and-backoff lands ~5k objects without
// burning through retry budget. Bumping above ~6 starts producing 429s.
const DEFAULT_CONCURRENCY = 4;
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadR2(manifestPath, { bucket, prefix = "", token, accountId, concurrency = DEFAULT_CONCURRENCY }) {
  if (!bucket) throw new Error("upload-r2: --bucket is required");
  if (!token) throw new Error("upload-r2: CLOUDFLARE_API_TOKEN env (or --token) required");
  if (!accountId) throw new Error("upload-r2: CLOUDFLARE_ACCOUNT_ID env (or --account-id) required");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  // v0.1.3+ stores absolute paths; older manifests stored CWD-relative
  // paths. Resolve relative paths against the manifest's directory so a
  // moved/copied manifest still points at the right blob dir.
  const blobsDir = path.isAbsolute(manifest.r2.dir)
    ? manifest.r2.dir
    : path.resolve(path.dirname(manifestPath), manifest.r2.dir);
  if (!fs.existsSync(blobsDir)) {
    throw new Error(`R2 blob dir not found at ${blobsDir} (from manifest ${manifest.r2.dir})`);
  }

  const objects = manifest.r2.objects;
  console.log(`[upload-r2] uploading ${objects.length} objects (${human(manifest.r2.total_bytes)}) to bucket "${bucket}"${prefix ? ` (prefix "${prefix}")` : ""}`);

  let done = 0;
  let failed = 0;
  const queue = objects.slice();

  async function putOne(key, body, contentType) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      let r;
      try {
        r = await fetch(url, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": contentType || "application/octet-stream",
          },
          body,
        });
      } catch (e) {
        // Network-level failure — retry with backoff, fall through.
        if (attempt === MAX_RETRIES) return { ok: false, status: 0, text: `network: ${e.message}` };
        await sleep(Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS));
        continue;
      }
      if (r.ok) return { ok: true };
      // Retry on 429 (rate limit) and 5xx. Honor Retry-After if present.
      if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
        if (attempt === MAX_RETRIES) {
          const t = await r.text().catch(() => "");
          return { ok: false, status: r.status, text: t.slice(0, 200) };
        }
        const ra = Number(r.headers.get("retry-after"));
        const backoff = Number.isFinite(ra) && ra > 0
          ? ra * 1000
          : Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS) + Math.random() * 250;
        await sleep(backoff);
        continue;
      }
      // 4xx other than 429 — non-retryable.
      const t = await r.text().catch(() => "");
      return { ok: false, status: r.status, text: t.slice(0, 200) };
    }
    return { ok: false, status: 0, text: "exhausted retries" };
  }

  async function worker(_workerId) {
    while (queue.length) {
      const obj = queue.shift();
      if (!obj) break;
      const key = (prefix ? prefix.replace(/\/$/, "") + "/" : "") + obj.key;
      const body = fs.readFileSync(path.join(blobsDir, obj.key));
      const res = await putOne(key, body, obj.content_type);
      if (res.ok) {
        done += 1;
        if (done % 100 === 0 || done === objects.length) {
          console.log(`[upload-r2] ${done}/${objects.length}`);
        }
      } else {
        failed += 1;
        console.error(`[upload-r2] FAIL ${key}: ${res.status} ${res.text}`);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker(i));
  await Promise.all(workers);

  console.log(`[upload-r2] done — ${done} uploaded, ${failed} failed`);
  return { done, failed };
}

module.exports = { uploadR2 };
