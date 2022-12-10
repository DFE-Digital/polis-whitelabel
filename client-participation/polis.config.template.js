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

  // Point to a polisServer instance (local recommended for dev)
  SERVICE_URL: "http:localhost:8000",

  // Used for setting appropriate hostname for embedding.
  //SERVICE_HOSTNAME: "123.45.67.89.sslip.io",
  SERVICE_HOSTNAME: "localhost",

  // Note that this must match the participation client port specified in polisServer instance
  PORT: 5001,

  // must register with facebook and get a facebook app id to use the facebook auth features
  FB_APP_ID: "661042417336977",

  // For data exports

  UPLOADER: "local", // alt: s3, scp

  // Uploader settings: local
  LOCAL_OUTPUT_PATH: "./build",

  // Uploader settings: s3
  S3_BUCKET_PROD: "pol.is",
  S3_BUCKET_PREPROD: "preprod.pol.is",

  // Uploader settings: scp
  SCP_SUBDIR_PREPROD: "preprod",
  SCP_SUBDIR_PROD: "prod",

  // Leaving any of these blank will not show them
  PRIVACY_URL: "https://pol.is/privacy",
  ACCESSIBILITY_URL: "",
  COOKIES_URL: "",
  TERMS_OF_SERVICE_URL: "https://pol.is/tos"
};
