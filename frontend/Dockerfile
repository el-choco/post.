FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js postcss.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginx:stable-alpine
LABEL org.opencontainers.image.title="post. Webmail Frontend" \
      org.opencontainers.image.description="Modern webmail interface with Nginx reverse proxy"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
