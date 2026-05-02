# Build = dossier server/ (Railway : Root Directory = server).
# Au runtime, définir PORT via l’hébergeur (Railway injecte PORT) ; défaut local 8787 dans le code.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Image Playwright : Chromium + dépendances système
# Doit matcher la version Playwright du package.json pour que l'exécutable Chromium soit présent.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "dist/index.js"]
