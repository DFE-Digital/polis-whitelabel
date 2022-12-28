
# Pol.is devcontainer setup


Devcontainers are a streamlined way to setup a development environment with a functioning Pol.is instance. We build a devcontainer, based on an Ubuntu Docker image, which contains the pol.is app components and launch it alongside a postgresql Docker image using a Docker compose file.

This integrates really well with the [VS Code Devcontainer extension](https://code.visualstudio.com/docs/devcontainers/containers) which reads the `devcontainer.json` file and will automatically launch the container, once built, and allow you to work on it.

> **WARNING** This container is not intended for production - it has a full Ubuntu OS with development utilities installed and default passwords enabled. Use the dockers scripts in `deploy/docker` for production containers.

## Setup

  1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  2. Build the container using `docker build -t polis-devcontainer:latest .`
  3. Install the [VSCode Devcontainer Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
  4. VSCode should prompt for you to open the current directory in the Dev container

Ports can be opened through prompts in VSCode and you can connect using the following details ...

  * Postgres Username: `polis`
  * Postgres Password: `polis`
  * Postgres Database: `polis`

## Development

The Dockerfiles are based off of the [Ubuntu Devcontainer scripts](https://github.com/microsoft/vscode-dev-containers/tree/main/containers/ubuntu/.devcontainer) from Microsoft. They have been tweaked to add a different username to match the database


