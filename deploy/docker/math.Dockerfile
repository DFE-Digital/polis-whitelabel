FROM docker.io/clojure:tools-deps

WORKDIR /app
COPY . .

RUN chmod +x ./bin/run.sh

CMD ["./bin/run.sh"]
