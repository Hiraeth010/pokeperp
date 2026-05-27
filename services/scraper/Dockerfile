# Slim Node image — no browser needed.  Oxylabs handles the headless rendering
# on their side; we just POST URLs and parse the returned HTML with cheerio.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV PORT=3002

CMD ["npm", "start"]
