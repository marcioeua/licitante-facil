# Licitante Fácil: front-end compilado + API Node em um único container.

# 1) Compila o front-end (Vue + Quasar)
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY frontend/ ./
RUN npx quasar build

# 2) Imagem final: só a API e os arquivos estáticos
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    PORT=3333 \
    DB_PATH=/data/licitante.db \
    UPLOAD_DIR=/data/uploads
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY backend/src ./src
COPY --from=frontend /app/frontend/dist/spa /app/frontend/dist/spa
# Banco SQLite e arquivos enviados ficam em /data (monte um volume persistente aqui).
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
