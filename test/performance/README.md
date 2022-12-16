# Performance tests

Apache JMeter scripts for performance testing of the pol.is system.

## Install and launch

Install and launch the [Apache JMeter](https://jmeter.apache.org/) GUI. For the Mac you can use Homebrew as follows

```
brew install jmeter
open /opt/homebrew/bin/jmeter
```

Open the `*.jmx` file


## `conversation-basic.jmx`

A basic script that hits the conversation page only. This _broadly_ approximates participants hitting pol.is to vote. 

### How to run

 and edit the 'Server Name or IP' under 'HTTP Request` accordingly with the address of your pol.is instance. Update 'Path' with the path of a live conversation on you Pol.is system.

Hit start to run the test, results are shown in 'View Results Tree'
