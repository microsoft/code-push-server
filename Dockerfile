FROM ubuntu:24.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    nodejs \
    npm

# Install server
COPY api /app
WORKDIR /app
RUN npm install
RUN npm run build

# Start server
CMD ["/usr/bin/node", "/app/bin/script/server.js"]
