FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN addgroup -g 10001 -S app \
  && adduser -u 10001 -S -G app app \
  && chown -R app:app /app

USER app

EXPOSE 3000
CMD ["npm", "run", "start"]
