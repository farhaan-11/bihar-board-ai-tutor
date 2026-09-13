FROM node:22

WORKDIR /app

COPY backend/package*.json ./

RUN npm ci

COPY backend/ .

COPY data /data

CMD ["npm", "start"]