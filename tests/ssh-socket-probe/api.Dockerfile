FROM node:24-bookworm-slim
WORKDIR /
COPY apps/api/src/ssh-transport.ts /apps/api/src/ssh-transport.ts
COPY tests/ssh-socket-probe/fixture-api.mjs /tests/ssh-socket-probe/fixture-api.mjs
USER node
CMD ["node", "/tests/ssh-socket-probe/fixture-api.mjs"]
