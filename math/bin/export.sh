read -p "Enter the conversation ID: " conversationId
/usr/local/bin/clojure -M:run export -Z $conversationId -X -f exported/$conversationId.zip