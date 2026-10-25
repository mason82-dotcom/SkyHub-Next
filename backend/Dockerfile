FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
# Include all first-party modules required by server.js at runtime.
COPY backend/*.js ./

# Read-only MinIO DR composite validation.
COPY scripts/minio-dr-composite.js /app/scripts/minio-dr-composite.js
COPY scripts/lib/minio-dr-iam-attestation.js /app/scripts/lib/minio-dr-iam-attestation.js

COPY backend/data ./data
COPY frontend/public /app/frontend/public
EXPOSE 4000
USER node
CMD ["node", "server.js"]
