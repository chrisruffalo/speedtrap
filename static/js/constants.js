// session/misc
SESSION_KEY_LENGTH = 64; // length of the session key

// ping
PING_TEST_INTERVAL = 3;

// download
DOWNLOAD_REQUESTS = 2;
DOWNLOAD_GROW_FACTOR = 2;
MIN_DOWNLOAD_BYTES = 1024000;
MAX_DOWNLOAD_BYTES = 52000000;
DOWNLOAD_TEST_INTERVAL_S = 10;

// upload
UPLOAD_REQUESTS = 2;
UPLOAD_TEST_INTERVAL_S = 10;
UPLOAD_BYTES = 5000000;
MAX_PROVIDER_ARRAY = 65536;

// status check
STATUS_DELAY_INTERVAL = 750;
STATUS_CHECK_INTERVAL = 250;

// API details
API_ROOT = "/api"
DOWNLOAD_TARGET = API_ROOT + "/download";
UPLOAD_TARGET = API_ROOT + "/upload";
STATUS_TARGET = API_ROOT + "/status";
CLEAR_TARGET = API_ROOT + "/clear";

// sparkline global options
sparkOpts = {
  width: "38%",
  height: "35px"
};