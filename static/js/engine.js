// constants
WORKER_THREADS = 2;
START_DOWNLOAD_BYTES = 128000;
DOWNLOAD_TEST_INTERVAL_S = 15;
UPLOAD_TEST_INTERVAL_S = 15;
SESSION_KEY_LENGTH = 64; // length of the session key

// essentially pools for the workers
downloadWorkers = [];
uploadWorkers = [];
statusWorkers = [];

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
  socket = new WebSocket("ws://localhost:8000/ws");
  startTime = 0;
  endTime = 0;
  pingTimes = [];

  // when the socket is opened start the timer and send a small message
  socket.onopen = function() {
    startTime = window.performance.now();
    socket.send("p"); // any short message will do
  }

  // when a message is rec'd record the time and send a new one
  socket.onmessage = function() {
    endTime = window.performance.now();
    elapsed = (1.0 * (endTime - startTime))/ 2.0;
    pingTimes.push(elapsed);
    startTime = window.performance.now();
    socket.send("p");
  }

  // update ping times
  interval = window.setInterval(function() {
    pingUpdate(pingTimes);
  }, 750);

  // after interval stop web socket and show ping
  window.setTimeout(function() {
    // cancel update interval
    window.clearInterval(interval);

    // close ws
    socket.close();

    // chain to download portion
    doTest_Download(sessionKey);
  }, 5000);
}

function doTest_Download(sessionKey) {
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

function pingUpdate(pingTimes) {
  // get average ping
  sum = pingTimes.reduce(function(a, b){ return a + b;});
  avg = (sum / pingTimes.length); // convert microseconds to milliseconds
  pingTimes = [];
  document.getElementById("pingSpan").textContent = avg.toFixed(4) + "ms";
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
