FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm test

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/dist/client ./dist/client
COPY --from=build --chown=node:node /app/scripts/serve.mjs /app/scripts/security-headers.mjs ./scripts/
USER node
EXPOSE 8080
CMD ["node", "scripts/serve.mjs"]
