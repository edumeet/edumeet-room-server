FROM node:24-bookworm-slim

RUN apt-get update; DEBIAN_FRONTEND=noninteractive apt-get install -yq gettext-base; apt-get clean

WORKDIR /usr/src/app

COPY . .

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
RUN yarn install --immutable
RUN yarn run build

EXPOSE 8443

ENTRYPOINT [ "./entrypoint.sh" ]
