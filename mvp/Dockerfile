FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG RUN_TESTS=1
RUN npm run build && if [ "$RUN_TESTS" = "1" ]; then npm test; fi

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/dist/client ./dist/client
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src/domain.js /app/src/assessments.js /app/src/medications.js /app/src/medical-profile.js /app/src/current-medications.js /app/src/reference-text.js /app/src/guidelines.js ./src/
COPY --from=build --chown=node:node /app/scripts/serve.mjs /app/scripts/serve-demo.mjs /app/scripts/security-headers.mjs /app/scripts/run-journal-worker.mjs /app/scripts/publish-reference-files.mjs ./scripts/
USER node
EXPOSE 8080
CMD ["node", "scripts/serve.mjs"]
