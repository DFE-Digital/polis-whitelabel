
module.exports = {
    // Used for setting appropriate hostname for embedding.
    //SERVICE_HOSTNAME: "123.45.67.89.sslip.io",
    SERVICE_HOSTNAME: "example.com",
  
    domainWhitelist: [
      "^example.com$",
      // local ports
      "^localhost$",
      "^127\\.0\\.0\\.1$",
      "^192\\.168\\.1\\.140$",
      // sample configuration for main pol.is deployment
      // These allow for local ip routing for remote dev deployment
      "^(n|ssl)ip\\.io$",
      ".+\\.(n|ssl)ip\\.io$",
      "^10\\.2\\.28\\.4$", // NGinx in VM
      "^10\\.2\\.32\\.4$" // polis-server
    ],
  
  
    // Note that on build, this doesn't appear in the output files
    SERVICE_URL: 'http://example.com',
    
    // Leaving any of these blank will not show them
    PRIVACY_URL: "/privacy",
    ACCESSIBILITY_URL: "/accessibility",
    COOKIES_URL: "/cookies",
    TERMS_OF_SERVICE_URL: "/tos"
  };
  