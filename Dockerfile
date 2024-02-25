FROM node:20-bookworm-slim

WORKDIR /usr/src/app

COPY . .

RUN yarn install
RUN yarn run build

EXPOSE 8443

ENTRYPOINT [ "./entrypoint.sh" ]
