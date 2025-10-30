FROM --platform=linux/amd64 docker.io/clojure:tools-deps-1.11.1.1208-alpine

WORKDIR /app
COPY . .

# Run as a separate step so that the dependencies are cached in the Docker image and 
# not downloaded on every run
RUN clojure -P

RUN chmod +x ./bin/run.sh

CMD ["./bin/run.sh"]
