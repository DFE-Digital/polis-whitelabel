module.exports = {
  domainWhitelist: [
    // local ports
    "^localhost$",
    "^127\\.0\\.0\\.1$",
    "^192\\.168\\.[0-9]{1,3}\\.[0-9]{1,3}$",

    // sample configuration for main pol.is deployment
    "^pol\\.is",
    ".+\\.pol\\.is$",
    
    // These allow for local ip routing for remote dev deployment
    "^(n|ssl)ip\\.io$",
    ".+\\.(n|ssl)ip\\.io$",
  ],

  FB_APP_ID: '661042417336977',

  // Leaving any of these blank will not show them
  PRIVACY_URL: "/privacy",
  ACCESSIBILITY_URL: "/accessibility",
  COOKIES_URL: "/cookies",
  TERMS_OF_SERVICE_URL: "/tos"
};
