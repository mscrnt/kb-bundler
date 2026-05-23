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

ENTRYPOINT ["kb-bundler"]
CMD ["--help"]
