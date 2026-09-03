FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server/ server/
COPY --from=client-build /app/client/dist ./client/dist
EXPOSE 3000
ENV PORT=3000
CMD ["node","server/index.js"]
