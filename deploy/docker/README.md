# Docker deployment

The Dockerfiles are primarily meant to be for production use since changes will need a full build cycle to reflect and they don't contain a lot of the usefully development tools that Devcontainers do. We can use the Docker Compose to test the service locally though in a production-like environment.

## Setup

* Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
* Build `polis-math` by using `npm run build:math`
* Build `polis-server` by using `npm run build:server`
* Build `polis-file-server` by using `npm run build:file-server`
* Run images using `npm run run:compose` 

Navigate to [http://localhost:8000](http://localhost:8000) to view the Pol.is front-end.