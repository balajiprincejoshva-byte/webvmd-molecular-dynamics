FROM node:18-alpine

WORKDIR /app

# Install deps
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --legacy-peer-deps || npm install --legacy-peer-deps

# Copy source and build
COPY frontend/ /app/
RUN npm run build --if-present

EXPOSE 3000
CMD ["npm", "run", "start"]
