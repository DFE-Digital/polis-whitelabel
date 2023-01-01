FROM docker.io/nginx:1.23-alpine

# The base Docker image copies files in the template directory to the config directory
# after running through 'envsubst' which switchs environment variables into the template.
# Name it default to overwrite the existing config file.
COPY ./nginx.conf.template /etc/nginx/templates/default.conf.template

