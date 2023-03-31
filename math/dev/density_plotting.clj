
(def data-values
  [{:x 3.4 :y 5.3}
   {:x 2.2 :y 9.3}
   {:x 4.4 :y 5.1}
   {:x 1.7 :y 5.9}
   {:x 2.4 :y 6.2}
   {:x 7.4 :y 7.4}
   {:x 2.8 :y 10.3}
   {:x 3.9 :y 8.3}])

(def plot-spec-2
  {:width 1000
   :height 800
   :data {:values data-values}
   :layer [{:mark {:type "point" :filled true}
            :encoding {:x {:field "x"}
                       :y {:field "y"}
                       :size {:value 500}}}]})

(def plot-spec
  {:width 500
   :height 400
   :data [{:name "main"
           :values data-values}]
          ;{:name "contours"
          ; :source "main"
          ; :transform [{:type "contour"}]}]
   :marks [{:name "dots"
            :type "symbol"
            :from {:data "main"}
            :encode {:x {:field "x"}
                     :y {:field "y"}}}]})


;(viz/to-json plot-spec-2)
;(oz/view! plot-spec-2)
