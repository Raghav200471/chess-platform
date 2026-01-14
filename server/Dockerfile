FROM node:18-alpine

WORKDIR /usr/src/app

COPY shared /usr/src/app/shared

COPY server/package*.json ./server/

WORKDIR /usr/src/app/server
RUN npm install

COPY server/ .

EXPOSE 4000

CMD [ "npm", "run", "dev" ]