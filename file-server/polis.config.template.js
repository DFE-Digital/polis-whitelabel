
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
  
  
    // Note that this must match the participation client port specified in polisServer instance
    PORT: 5001,
  
    DISABLE_INTERCOM: true,
    DISABLE_PLANS: true,
  
    // Point to a polisServer instance (local recommended for dev). 
    // Note that on build, this doesn't appear in the output files
    SERVICE_URL: 'http://example.com',
    
    UPLOADER: 'local', // alt: s3, scp
    
    // Uploader settings: local
    LOCAL_OUTPUT_PATH: './build',
    
    
    // Not used
  
    FB_APP_ID: '661042417336977',
    // Uploader settings: s3
    S3_BUCKET_PROD: 'pol.is',
    S3_BUCKET_PREPROD: 'preprod.pol.is',
  
    // Uploader settings: scp
    SCP_SUBDIR_PREPROD: 'preprod',
    SCP_SUBDIR_PROD: 'prod',
  };
  