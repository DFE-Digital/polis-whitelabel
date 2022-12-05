const finalhandler = require('finalhandler');
const fs = require('fs');
const http = require('http');
const serveStatic = require('serve-static');

const config = JSON.parse(fs.readFileSync(process.env.CONFIG_FILE || './fs_config.json'));


// Serve up public/ftp folder
const serve = serveStatic(config.fileRoot, {
  'index': false,
  'setHeaders': setHeaders
});

// Set header to force download
function setHeaders (res, filePath) {
  // FIXME: This will crash if a file is requested where there isn't a .headersJson file counterpart - mitigate with a try-catch for now
  // FIXME: This is blocking and will not scale well
  try {
    const configFile = fs.readFileSync(filePath + ".headersJson");
    const headers = JSON.parse(configFile);
    const headerNames = Object.keys(headers);
    if (headerNames && headerNames.length) {
      res.setHeader('Pragma', null);
      headerNames.forEach((name) => {
        res.setHeader(name, headers[name]);
      });
    }
  } catch (error) {
    console.error('Could not add the headers from ' + filePath + '.headersJson');
  }
}

// Create server
const fileServer = http.createServer(function onRequest (req, res) {
  serve(req, res, finalhandler(req, res));
});

// Listen
fileServer.listen(config.port, function (err) {
  if (!err) {
    console.log('polis-file-server listening on port ' + config.port);
  } else {
    console.error('Error starting polis-file-server.');
    console.error(err);
  }
});
