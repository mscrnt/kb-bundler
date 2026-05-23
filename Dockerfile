# kb-bundler — node-based bundler for Cloudflare Pages knowledge bases.
#
# Build:   docker build -t mscrnt/kb-bundler .
# Run one-shot:
#   docker run --rm \
#     -v /mnt/blackbox_archives/datasets:/datasets:ro \
#     -v $PWD:/workspace \
#     -v $PWD/dist:/output \
#     mscrnt/kb-bundler bundle /workspace/bob.config.js
# Run as a persistent service (long-lived container, exec into it):
#   docker run -d --name kb-bundler \
#     -v /mnt/blackbox_archives/datasets:/datasets:ro \
#     -v /mnt/user/appdata/kb-bundler/configs:/workspace:ro \
#     -v /mnt/user/appdata/kb-bundler/output:/output \
#     --entrypoint /bin/sh mscrnt/kb-bundler -c "tail -f /dev/null"
#   docker exec kb-bundler kb-bundler bundle /workspace/bob.config.js
#
# Tagging: this image is intended to be tagged with kb-bundler's package
# version; CI publishes `mscrnt/kb-bundler:vX.Y.Z` and `mscrnt/kb-bundler:latest`.
FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY bin/ ./bin/
COPY lib/ ./lib/

RUN npm install --omit=dev --no-audit --no-fund \
 && npm link

# Default working directory for invocations
RUN mkdir -p /workspace /output /datasets
WORKDIR /workspace

# Healthcheck verifies the CLI itself can spawn + that mounts are usable.
# (`doctor` exits non-zero if /workspace, /output, or /datasets aren't usable.)
HEALTHCHECK --interval=60s --timeout=10s --start-period=10s --retries=3 \
  CMD kb-bundler doctor || exit 1

ENTRYPOINT ["kb-bundler"]
# Default CMD runs the long-lived service: prints a banner with mount + env
# state, then sleeps until SIGTERM. Override with --help, bundle, etc. for
# one-shot use:  docker run --rm mscrnt/kb-bundler --help
CMD ["serve"]
