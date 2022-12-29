(defproject polismath "0.1.0-SNAPSHOT"
  :source-paths ["src/"]
  :jvm-opts ["-Xmx4g"]
  :repl-options {:timeout 220000
                 :port 34344}
  :target-path "target/%s"
  :javac-target "1.8"
  :repositories {"twitter4j" "https://twitter4j.org/maven2"}
  :plugins []

  :git-dependencies [["https://github.com/GeorgeJahad/debug-repl.git" "master"]]
  :dependencies [;; org.clojure stuff
                 [org.clojure/clojure "1.10.1"]
                 [org.clojure/spec.alpha "0.2.187"]
                 [org.clojure/core.async "1.3.610"]
                 [org.clojure/data.csv "1.0.0"]
                 [org.clojure/math.numeric-tower "0.0.4"]
                 [org.clojure/core.match "1.0.0"]
                 [org.clojure/tools.namespace "1.0.0"]
                 [org.clojure/tools.logging "1.1.0"]
                 [org.clojure/tools.trace "0.7.10"]
                 [org.clojure/tools.reader "1.3.3"]

                 [org.flatland/ordered "1.5.9"]
                 ;; Other stuff
                 [commons-collections/commons-collections "20040616"]
                 [cheshire "5.10.0"]
                 [com.taoensso/timbre "4.10.0"]
                 ;; Updates; requires fixing index conflict between named-matrix and core.matrix
                 [net.mikera/core.matrix "0.62.0"]
                 [net.mikera/vectorz-clj "0.48.0"]
                 [net.mikera/core.matrix.stats "0.7.0"]
                 [net.mikera/vectorz-clj "0.48.0"]
                 [criterium "0.4.6"]
                 [clj-http "3.10.2"]
                 [org.clojure/tools.cli "1.0.194"]
                 ;; implicitly requires jetty, component and ring
                 [ring/ring-core "1.8.1" :exclusions [clj-time]]
                 [ring-jetty-component "0.3.1" :exclusions [clj-time]]
                 [ring-basic-authentication "1.0.5"]
                 [ring/ring-ssl "0.3.0"]
                 [bidi "2.1.6" :exclusions [prismatic/schema]]
                 [bigml/sampling "3.2"]
                 [org.postgresql/postgresql "42.5.1"]
                 [korma "0.4.3"]
                 [clj-time "0.15.2"]
                 [clj-excel "0.0.1"]
                 [semantic-csv "0.2.0"]
                 [prismatic/plumbing "0.5.5"]
                 [environ "1.2.0"]
                 [mount "0.1.16"]
                 [honeysql "1.0.444"]
                 
                 ;; Dev
                 [metasoarous/oz "1.6.0-alpha3"]
                 [org.clojure/test.check "1.1.0"]
                 [irresponsible/tentacles "0.6.6"]]

  :gorilla-options {:keymap {"command:app:save" "alt+g alt+w"}
                    :port 989796}
  :main ^:skip-aot polismath.runner
  :min-lein-version "2.3.0"
  :profiles {:dev {:dependencies []
                   :source-paths ["src" "dev"]}
             :production {:env {}}}
  :test-selectors {:default (fn [m]
                              (not (or (clojure.string/includes? (str (:ns m)) "conv-man-tests")
                                       (clojure.string/includes? (str (:name m)) "conv-man-tests"))))
                   :integration (fn [m]
                                  (or (clojure.string/includes? (str (:ns m)) "conv-man-tests")
                                      (clojure.string/includes? (str (:name m)) "conv-man-tests")))})
