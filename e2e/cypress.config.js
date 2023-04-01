const { defineConfig } = require('cypress')

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:8000',
    embedUrl: 'http://localhost:8001/embed.html',
    maildevApiBaseUrl: 'http://localhost:1080',
    chromeWebSecurity: false,
    excludeSpecPattern: '**/examples/*.spec.js',
    apiPath: '/api/v3',
    setupNodeEvents(on, config) {
      require('cypress-terminal-report/src/installLogsPrinter')(on)
    }
  }
})
