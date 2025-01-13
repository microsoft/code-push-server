FROM node:18.18.0-alpine3.18

WORKDIR /app

COPY node_modules /app/node_modules
COPY package.json /app/package.json
COPY bin /app/bin

CMD [ "npm", "run", "start:env" ]
