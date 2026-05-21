# --- Phase 1: Build ---
FROM node:20-slim AS builder
WORKDIR /app

# Install dependencies (use cache)
COPY package.json package-lock.json* ./
RUN npm install --frozen-lockfile

# Copy source code
COPY . .

# Build the app (ensure production env)
ENV NODE_ENV=production
# Set backend URL for build if needed (client-side calls)
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build

# --- Phase 2: Run ---
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy only necessary files from builder
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 8080

CMD ["sh", "-c", "npm start -- -p ${PORT:-8080}"]
