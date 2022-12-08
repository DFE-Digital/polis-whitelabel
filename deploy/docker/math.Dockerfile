FROM docker.io/clojure:tools-deps

WORKDIR /app
COPY . .

# Install clojure and fetch dependencies
RUN clojure -A:dev -P

RUN chmod +x ./bin/run.sh

CMD ["./bin/run.sh"]
