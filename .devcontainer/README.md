
# Pol.is devcontainer setup

Devcontainers are a streamlined way to setup a development environment with a functioning Pol.is instance. We build a devcontainer, based on an Node Debian Docker image, which contains the pol.is app components and launch it alongside a postgresql Docker image using a Docker compose file.

This integrates really well with the [VS Code Devcontainer extension](https://code.visualstudio.com/docs/devcontainers/containers) which reads the `devcontainer.json` file and will automatically launch the container, once built, and allow you to work on it.

> **WARNING** This container is not intended for production - it has a full Debian OS with development utilities installed and default passwords enabled. Use the dockers scripts in `deploy/docker` for production containers and for testing production-like systems.

## Setup

  1. Install [Podman Desktop](https://podman-desktop.io/)
  2. Build the container using `podman build -t polis-devcontainer:latest .`
  3. Install the [VSCode Devcontainer Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
  4. VSCode should prompt for you to open the current directory in the Dev container

Ports can be opened through prompts in VSCode and you can connect using the following details ...

  * Postgres Username: `polis`
  * Postgres Password: `polis`
  * Postgres Database: `polis`

Once in the container you can start each of the services as follows. Buil notes are in the READMEs for each service.


| Service | Directory | command |
| --- | --- | --- |
| Pol.is server | `./server` | `npm run dev` (after building) |
| Pol.is file-server | `./file-server` | `npm run start` (after building) |
| Pol.is math | `./math` | `clojure -M:run full` |
| NGINX reverse-proxy | anywhere | `sudo service nginx start` |

## Development

The Dockerfiles are based off of the [Node + Postgres Devcontainer scripts](https://github.com/devcontainers/templates/tree/main/src/javascript-node-postgres) from Microsoft.

Note that you will need to delete the devcontainer images and rebuild if making changes to the Devcontainer environment.


