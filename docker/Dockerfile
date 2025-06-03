# Multi-stage Dockerfile for Vault Secrets Web Demo
# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/client

# Copy client package files
COPY app/client/package*.json ./
RUN npm install

# Copy client source code
COPY app/client/ ./

# Build the frontend
RUN npm run build

# Stage 2: Build the Node.js backend
FROM node:20-alpine AS backend-builder

WORKDIR /app

# Copy backend package files
COPY app/package*.json ./
RUN npm install --only=production

# Stage 3: Final runtime image
FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app directory and user
WORKDIR /app
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Copy backend dependencies
COPY --from=backend-builder --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy backend source
COPY --chown=nodejs:nodejs app/server.js ./
COPY --chown=nodejs:nodejs app/package*.json ./

# Copy frontend build
COPY --from=frontend-builder --chown=nodejs:nodejs /app/client/dist ./client/dist

# Create secrets directory
RUN mkdir -p /secrets && chown nodejs:nodejs /secrets

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV SECRETS_DIR=/secrets

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { hostname: 'localhost', port: process.env.PORT || 3000, path: '/api/health', method: 'GET' }; \
    const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); \
    req.on('error', () => process.exit(1)); \
    req.end();"

# Start the application
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
