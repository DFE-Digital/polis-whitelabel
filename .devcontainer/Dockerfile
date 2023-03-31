FROM mcr.microsoft.com/devcontainers/javascript-node:0-18-bullseye

# In this instance we add the psql command so we can access the database from the command line, NGinx and modules
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends postgresql-client leiningen libpq-dev nginx libnginx-mod-http-headers-more-filter

# [Optional] Uncomment if you want to install an additional version of node using nvm
# ARG EXTRA_NODE_VERSION=10
# RUN su node -c "source /usr/local/share/nvm/nvm.sh && nvm install ${EXTRA_NODE_VERSION}"

# [Optional] Uncomment if you want to install more global node modules
# RUN su node -c "npm install -g <your-package-list-here>"

# Setup NGinx
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/50-mod-http-headers-more-filter.conf /etc/nginx/modules-enabled/50-mod-http-headers-more-filter.conf

# Let NGinx through
EXPOSE 3000
