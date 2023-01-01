module.exports = {
  domainWhitelist: [
    // local ports
    "^localhost$",
    "^127\\.0\\.0\\.1$",
    "^192\\.168\\.[0-9]{1,3}\\.[0-9]{1,3}$",
    // These allow for local ip routing for remote dev deployment
    "^(n|ssl)ip\\.io$",
    ".+\\.(n|ssl)ip\\.io$",
  ],

  // Used for setting appropriate hostname for embedding.
  SERVICE_URL: "http://192.168.64.5",

  // Note that this must match the participation client port specified in polisServer instance
  PORT: 5001,

  // must register with facebook and get a facebook app id to use the facebook auth features
  FB_APP_ID: "661042417336977",

  // Leaving any of these blank will not show them
  PRIVACY_URL: "/privacy",
  ACCESSIBILITY_URL: "/accessibility",
  COOKIES_URL: "/cookies",
  TERMS_OF_SERVICE_URL: "/tos"
};
