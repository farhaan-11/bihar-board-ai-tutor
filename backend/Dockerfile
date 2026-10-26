FROM node:22-slim

WORKDIR /app

RUN chown node:node /app

COPY --chown=node:node backend/package*.json ./

RUN npm ci --omit=dev

COPY --chown=node:node backend/ .

COPY --chown=node:node data /data

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 5000) + '/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

CMD ["npm", "start"]
