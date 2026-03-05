FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx mastra build

EXPOSE 4112

CMD ["npx", "mastra", "start"]
