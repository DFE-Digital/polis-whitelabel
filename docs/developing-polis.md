# Developing pol.is

## Cache

The Devcontainer, Docker scripts and VM setup guide all detail an NGinx reverse-proxy running on port `3000`. This caches a lot of the pol.is output and may make development difficult. What's more, your browser will cache files locally.

Unless you are testing the caching or reverse proxy settings you will likely want to ...

  1. develop against the `server` directly on port `8000`
  2. disable local cache in your browser - this can be done in Chrome, for example, by opening 'Developer Tools' -> 'Settings' (:gear:) -> 'Disable cache (while dev tools is open)'

To empty the NGinx cache, stop Nginx, delete the cache files, then restart - e.g. on the Devcontainer

```sh
sudo service nginx stop
sudo rm -rf /var/cache/nginx
sudo service nginx start
```

