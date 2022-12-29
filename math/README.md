# polis-math

The statistics part of polis.

## Development environment

To get a sense for how various parts of these system can be used, take a look
at the comment block at the
[bottom of `dev/user.clj`](https://github.com/compdemocracy/polis/blob/dev/math/dev/user.clj#L328).

Run `clj -M:dev` to get nREPL going. This will not start math worker's
processing queue.

You can start the polling system by manually running `(runner/run!)`, as
described below, as long as you have the `DATABASE_URL` environment variable
pointing to a database.

## Starting and stopping the system

This application uses Stuart Sierra's Component library for REPL-reloadability.
Sometimes, (e.g.) evaluating a new definition of an existing function will be
picked up by the system immediately without any further work. In other cases
though, especially if something stateful is involved, it may be necessary to
reload/restart the system.

This can be performed using a set of utility functions in the `polismath.runner`
namespace (generally assumed to be aliased to `runner`). To stop the system, you
can use `runner/stop!`, followed by `namespace.repl/refresh` to reload
namespaces, and `runner/start!` to start the system back up. The
`runner/system-reset!` function will do all of this for you automatically, but
offers less flexibility in specifying configuration details in how you start
the system.

While this setup is nice from the perspective of system reloadability, Stuart's
Component library unfortunately requires that a lot of the core functions of
the system end up having to explicitly accept an argument corresponding to
their part of the system. This ends up being somewhat annoying from the
perspective of interactive development, as it requires grabbing the
corresponding component out of the `runner/system` map, and passing that to
the function in question.

## Running commands

There are also a number of commands which can be run from the root of the
monorepo:

* `clojure -M:run --help` - print run command help
* ~~`clojure -M:run export <conversation-id> -f <export-filename>.zip`~~ - export the conversation at `<conversation-id>` to the given filename
  * Instead use `lein with-profile production run export -X -Z <conversation-id> -f <my-filename>.zip` to get the raw data
  * Note this will not work unless `MATH_ENV` is set to `prod`
  * The `production` profile prevent vulnerable dependencies from being installed and used
* `clojure -M:run update -Z <conversation-id>` - update a particular conversation
* `clojure -M:run full` - run a full system (poller plus auxiliary task processing)
* et al.

## Worker configuration

There are a number of variables for tuning and tweaking the system, many of
which are exposed via environment variables. See
[`src/polismath/components/config.clj`](https://github.com/pol-is/polisMath/blob/master/src/polismath/components/config.clj#L51)
for the complete listing of environment variables.

The ones you're most frequently to need to tweak for one reason or another:

* `MATH_ENV`: This defaults to `dev`, for local development environments.
  Traditionally we've set this to `prod` and `preprod` for our production and
  pre-production deployments specifically. This value is used in keying the
  math export json blobs as found in the `math_main` and other tables in the
  database. This makes it possible to run multiple math environments (dev,
  testing, prod, preprod) all on the same database of votes. This setting is
  something of a relic from an old architecture where prod and preprod
  environments ran off of the same database, and with the docker
  infrastructure is generally no longer needed. Nevertheless, when you start
  the math server, you will need to run it with the same `MATH_ENV` setting as
  you ran the math worker with.
* `POLL_FROM_DAYS_AGO`: This defaults to 10 (at the time of this writing).
  Conversations which have had vote or moderation activity in the specified
  range will be loaded into memory, and will be updated. This prevents old
  inactive conversations from being loaded into memory every time the poller
  starts.

You'll also need to pass database credentials and such.

* `DATABASE_URL`: `postgres://<username>:<password>@<url>:<port>/<database-id>`
* `WEBSERVER_PASS` & `WEBSERVER_USERNAME`, to the polis-server instance,
  primarily for uathenticated api calls to send email notifications to users
  when their exports are done, via the polis-server.
* `DATABASE_IGNORE_SSL` - certain database deployments (eg. Docker) may not
  accept SSL

## Tests

You can run tests by executing `clojure -M:test`.

Since Clojure is slow to start though, you may find it easier to run the
`test-runner/-main` function (located at `tests/test_runner.clj`) from within
your nREPL process. There is an example of this in the `dev/user.clj` file
mentioned above. There are rough units tests for most of the basic math things,
and one or two higher level integration tests (presently broken).

## Architecture

The system is designed around a polling mechanism which queries the database at
a regular interval for new votes and moderation status. These data are then
routed to a "conversation manager", an agent like thing that maintains the
current state of the conversation, and orchestrates updates to the data. The
reason for this particular design is that when a conversation is very active,
votes can come in at a very rapid rate. Meanwhile, the time it takes to run an
update increases. We need to have a way of queueing up vote and moderation
data updates, so that they're ready to be processed once the last conversation
update has completed.

You can see the conversation manager implementation at
`src/polismath/conv_man.clj`.
