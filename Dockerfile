FROM node:20-bookworm-slim

WORKDIR /usr/src/app

COPY . .

RUN yarn install
RUN yarn run build

EXPOSE 8443

ENTRYPOINT DEBUG=edumeet:* MANAGEMENT_USERNAME=edumeet-admin@localhost MANAGEMENT_PASSWORD=supersecret yarn run prodstart $0 $@
