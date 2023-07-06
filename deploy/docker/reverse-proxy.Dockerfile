
# This takes the base NGinx Docker file and builds in a 3rd party module for adjusting headers 
# (openresty/headers-more-nginx-module). It then copies the built module into the base NGinx Docker 
# image and copies over some custom configuration.

FROM --platform=linux/amd64 nginx:1.23.3-alpine AS builder

# nginx:alpine contains NGINX_VERSION environment variable, like so:
ENV NGINX_VERSION 1.23.3

# Our HEADERS_MORE module version - see https://github.com/openresty/headers-more-nginx-module
ENV HEADERS_MORE_VERSION 0.34

# Download sources

RUN wget "http://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" -O nginx.tar.gz && \
  wget "https://github.com/openresty/headers-more-nginx-module/archive/refs/tags/v${HEADERS_MORE_VERSION}.tar.gz" -O headers-more.tar.gz

# For latest build deps, see https://github.com/nginxinc/docker-nginx/blob/master/mainline/alpine/Dockerfile
RUN apk add --no-cache --virtual .build-deps \
  gcc \
  libc-dev \
  make \
  openssl-dev \
  pcre-dev \
  zlib-dev \
  linux-headers \
  libxslt-dev \
  gd-dev \
  geoip-dev \
  libedit-dev \
  bash \
  alpine-sdk \
  findutils \
  curl \
  gnupg

# Reuse same cli arguments as the nginx:alpine image used to build
RUN mkdir /usr/src && CONFARGS=$(nginx -V 2>&1 | sed -n -e 's/^.*arguments: //p') \
	tar -zxC /usr/src -f nginx.tar.gz && \
  tar -xzvf "headers-more.tar.gz" && \
  HEADERS_MORE_DIR="$(pwd)/headers-more-nginx-module-${HEADERS_MORE_VERSION}" && \
  cd /usr/src/nginx-$NGINX_VERSION && \
  ./configure --with-compat $CONFARGS --add-dynamic-module=$HEADERS_MORE_DIR && \
  make && make install

FROM --platform=linux/amd64 nginx:1.23.3-alpine

# Extract the dynamic module from the builder image
COPY --from=builder /usr/local/nginx/modules/ngx_http_headers_more_filter_module.so /usr/local/nginx/modules/ngx_http_headers_more_filter_module.so

COPY ./reverse-proxy-config/nginx.conf /etc/nginx/nginx.conf
# The base Docker image copies files in the template directory to the config directory
# after running through 'envsubst' which switchs environment variables into the template.
# Name it default to overwrite the existing config file.
COPY ./reverse-proxy-config/default.conf.template /etc/nginx/templates/default.conf.template
