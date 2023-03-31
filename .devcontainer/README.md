
# Pol.is devcontainer setup

Devcontainers are a streamlined way to setup a development environment with a functioning Pol.is instance. We build a devcontainer, based on an Node Debian Docker image, which contains the pol.is app components and launch it alongside a postgresql Docker image using a Docker compose file.

This integrates really well with the [VS Code Devcontainer extension](https://code.visualstudio.com/docs/devcontainers/containers) which reads the `devcontainer.json` file and will automatically launch the container, once built, and allow you to work on it.

> **WARNING** This container is not intended for production - it has a full Debian OS with development utilities installed and default passwords enabled. Use the dockers scripts in `deploy/docker` for production containers and for testing production-like systems.

## Setup

  1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  2. Build the container using `docker build -t polis-devcontainer:latest .`
  3. Install the [VSCode Devcontainer Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
  4. VSCode should prompt for you to open the current directory in the Dev container

Ports can be opened through prompts in VSCode and you can connect using the following details ...

  * Postgres Username: `node`
  * Postgres Password: `node`
  * Postgres Database: `node`

## Development

The Dockerfiles are based off of the [Node + Postgres Devcontainer scripts](https://github.com/devcontainers/templates/tree/main/src/javascript-node-postgres) from Microsoft.

Note that you will need to delete the devcontainer images and rebuild if making changes to the Devcontainer environment.


