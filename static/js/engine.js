// constants
WORKER_THREADS = 4;
START_DOWNLOAD_BYTES = 128000;
DOWNLOAD_TEST_INTERVAL_S = 15;
UPLOAD_TEST_INTERVAL_S = 15;
POSSIBLE_KEYS_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
SESSION_KEY_LENGTH = 64; // length of the session key

// essentially pools for the workers
downloadWorkers = [];
uploadWorkers = [];
statusWorkers = [];

// used to sleep for a bit so that we can stagger the starts of workers by a few ms each
// https://stackoverflow.com/questions/951021/what-is-the-javascript-version-of-sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// random string picker for session keys
function pickRandom() {
    return POSSIBLE_KEYS_CHARS[Math.floor(Math.random() * POSSIBLE_KEYS_CHARS.length)];
}

function newSessionKey() {
  return Array.apply(null, Array(SESSION_KEY_LENGTH)).map(pickRandom).join('');
}

function terminateWorkers(pool) {
  // for each in pool, send termination message
  for(i in pool) {
    worker = pool[i];
    if(worker && worker.postMessage) {
      worker.postMessage({"terminate": true});
      worker = null;
    }
    pool[i] = null;
  }
}

function spawnWorker(pool, script) {
  worker = new Worker(script);
  pool.push(worker);
  return worker;
}

async function spawnDownloaders(sessionKey, bytes) {
  if(!bytes || bytes < START_DOWNLOAD_BYTES) {
    bytes = START_DOWNLOAD_BYTES
  }
  for(i = 0; i < WORKER_THREADS; i++) {
    worker = spawnWorker(downloadWorkers, "js/download_worker.js?thread=" + i);
    worker.postMessage({"target": "/data/" + sessionKey, "bytes": START_DOWNLOAD_BYTES, "thread": i});
    await sleep(1 / WORKER_THREADS); // stagger start over the course of one second
  }
  return worker;
}

function spawnUploader() {
  spawnWorker(uploaders, "js/upload_worker.js", []);
}

function doTest() {
  sessionKey = newSessionKey();
  console.log("Got sessionKey: " + sessionKey);
  // do ping, display result

  // start status watcher
  worker = spawnWorker(statusWorkers, "js/status_worker.js");
  // start process
  worker.postMessage({"target": "/status/" + sessionKey});
  // wait for messages and dispatch them back to the event response
  worker.onmessage = function(event) {
    if(event.data && event.data.status) {
      // dispatch status update
      dispatchStatus(sessionKey, event.data.response);
    }
  }

  // chain to download portion
  doTest_Download(sessionKey);
}

function doTest_Download(sessionKey) {
  // start download test
  console.log("Starting download portion for " + sessionKey)
  spawnDownloaders(sessionKey, START_DOWNLOAD_BYTES);

  // kill downloaders after time interval
  window.setTimeout(function() {
    // handle worker shutdown
    console.log("Stopping downloaders...");
    terminateWorkers(downloadWorkers);

    // chain to upload portion
    doTest_Upload(sessionKey);
  }, DOWNLOAD_TEST_INTERVAL_S * 1000);
}

function doTest_Upload(sessionKey) {
  // start uploaders

  // kill uploaders after time interval

  // kill status 25% after upload time kill
  window.setTimeout(function() {
    // handle worker shutdown
    console.log("Stopping status...");
    terminateWorkers(statusWorkers);
  }, (DOWNLOAD_TEST_INTERVAL_S * 1.25) * 1000);
}

// https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string
function humanFileSize(bytes, si) {
    var thresh = si ? 1000 : 1024;
    if(Math.abs(bytes) < thresh) {
        return bytes + ' B';
    }
    var units = si
        ? ['kB','MB','GB','TB','PB','EB','ZB','YB']
        : ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
    var u = -1;
    do {
        bytes /= thresh;
        ++u;
    } while(Math.abs(bytes) >= thresh && u < units.length - 1);
    return bytes.toFixed(1)+' '+units[u];
}

function dispatchStatus(sessionKey, response) {
  // bail on null status
  if(!response || response == null || "null" == response || response.startsWith("null")) {
    return;
  }

  // parse rersponse
  response = JSON.parse(response);

  // update elements
  if(response.downloadStart && response.downloadEnd && response.downloadCount) {
    // times delivered are in milliseconds
    bytesPerSecond = Math.floor(response.downloadCount / ((response.downloadEnd - response.downloadStart) / 1000));
    humanReadable = humanFileSize(bytesPerSecond, true) + "ps";
    document.getElementById("downloadSpan").textContent = humanReadable;
  }
}
