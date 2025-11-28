

FROM docker.io/clojure:temurin-25-tools-deps-1.12.3.1577-alpine

WORKDIR /app
COPY . .

# Run as a separate step so that the dependencies are cached in the Docker image and 
# not downloaded on every run
RUN clojure -P

RUN chmod +x ./bin/run.sh

CMD ["./bin/run.sh"]
