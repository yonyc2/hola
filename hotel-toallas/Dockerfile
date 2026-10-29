FROM node:22-bookworm-slim

# Herramientas por si better-sqlite3 necesita compilarse
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

# La base de datos y los respaldos viven en /data (monta aquí un disco persistente)
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
