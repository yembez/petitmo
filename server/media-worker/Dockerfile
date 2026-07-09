# Media worker Petitmo — dérivés photos/vidéos (sharp + ffmpeg-static).
# Service séparé du PDF Playwright (`server/Dockerfile`).

FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production

# Railway injecte PORT au runtime ; 8788 = défaut local.
EXPOSE 8788

CMD ["node", "src/index.js"]
