FROM docker.io/clojure:tools-deps-1.11.1.1208-jammy

WORKDIR /app
COPY . .

RUN chmod +x ./bin/run.sh

CMD ["./bin/run.sh"]
