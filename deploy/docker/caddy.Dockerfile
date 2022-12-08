FROM docker.io/caddy:2.6.2-alpine

COPY ./Caddyfile.dev /etc/caddy/Caddyfile

EXPOSE 80