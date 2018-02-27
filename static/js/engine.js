// constants
DOWNLOAD_WORKER_THREADS = 4;
UPLOAD_WORKER_THREADS = 4;
START_DOWNLOAD_BYTES = 1024000;
DOWNLOAD_TEST_INTERVAL_S = 11;
UPLOAD_TEST_INTERVAL_S = 11;
SESSION_KEY_LENGTH = 64; // length of the session key

// sparkline global options
sparkOpts = {
  width: "40%",
  height: "38px"
};

// essentially pools for the workers
downloadWorkers = [];
uploadWorkers = [];
statusWorkers = [];
timers = [];

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

function spawnDownloaders(sessionKey) {
  worker = spawnWorker(downloadWorkers, "js/download_worker.js");
  worker.postMessage({"target": "/data/" + sessionKey, "bytes": START_DOWNLOAD_BYTES, "threads": DOWNLOAD_WORKER_THREADS});
  return worker;
}

function spawnUploaders(sessionKey) {
  worker = spawnWorker(uploadWorkers, "js/upload_worker.js");
  worker.postMessage({"target": "/upload/" + sessionKey, "threads": UPLOAD_WORKER_THREADS});
  return worker;
}

sessionKey = null;
interval = null;
socket = null;
function doTest() {
  // do this juuuusssst in case
  reset();

  // deactivate start button and activate cancel button
  $("#startButton").prop("disabled", true);
  $("#cancelButton").prop("disabled", false);

  sessionKey = newSessionKey();
  //console.log("Got sessionKey: " + sessionKey);
  console.log("Starting ping portion for " + sessionKey)

  // do ping, display result
  socketType = "ws";
  if(window.location.href.startsWith("https")) {
    socketType = "wss";
  }
  socket = new WebSocket(socketType + "://" + location.hostname + ":" + location.port + "/ws");
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
  }, 250);

  // after interval stop web socket and show ping
  timer = window.setTimeout(function() {
    // cancel update interval
    window.clearInterval(interval);
    interval = null;

    // empty pingTimes
    pingTimes = [];

    // close ws
    socket.close();

    // chain to download portion
    doTest_Download(sessionKey);
  }, 5000);
  timers.push(timer);
}

function doTest_Download(sessionKey) {
  // start download test
  console.log("Starting download portion for " + sessionKey)
  spawnDownloaders(sessionKey);

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

  // kill downloaders after time interval
  timer = window.setTimeout(function() {
    // handle worker shutdown
    console.log("Stopping downloaders...");
    terminateWorkers(downloadWorkers);

    // chain to upload portion
    doTest_Upload(sessionKey);
  }, DOWNLOAD_TEST_INTERVAL_S * 1000);
  timers.push(timer);
}

function doTest_Upload(sessionKey) {
  console.log("Starting upload portion for " + sessionKey)
  // start uploaders
  spawnUploaders(sessionKey);

  // kill uploaders after time interval
  timer = window.setTimeout(function() {
    // handle worker shutdown
    console.log("Stopping uploaders...");
    terminateWorkers(uploadWorkers);

    // chain to upload portion
    stopTest(sessionKey);
  }, DOWNLOAD_TEST_INTERVAL_S * 1000);
  timers.push(timer);

  // kill status 5% after upload time kill
  timer = window.setTimeout(function() {
    // handle worker shutdown
    console.log("Stopping status...");
    terminateWorkers(statusWorkers);
  }, (DOWNLOAD_TEST_INTERVAL_S * 1.05) * 1000);
  timers.push(timer);
}

function stopTest() {
  // clear session from server
  // clearSession(sessionKey); // maybe do this after some time?
  sessionKey = null;

  // fix button state
  $("#startButton").prop("disabled", false);
  $("#cancelButton").prop("disabled", true);
}

function pingUpdate(pingTimes) {
  // get average ping
  sum = pingTimes.reduce(function(a, b){ return a + b;});
  avg = (sum / pingTimes.length); // convert microseconds to milliseconds
  $('#pingChartSpan').sparkline(pingTimes, sparkOpts);
  $("#pingSpan").text(avg.toFixed(4) + "ms");
}

// keep track for sparklines
downloadBytesPerSecondTally = [];
uploadBytesPerSecondTally = [];
lastDownloadEnd = 0;
lastUploadEnd = 0;
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
    if(lastDownloadEnd < response.downloadEnd) {
      downloadBytesPerSecondTally.push(bytesPerSecond);
      $('#downloadChartSpan').sparkline(downloadBytesPerSecondTally, sparkOpts);
    }
    lastDownloadEnd = response.downloadEnd;
    humanReadable = humanFileSize(bytesPerSecond, true) + "ps";
    $("#downloadSpan").text(humanReadable);
  }

  if(response.uploadStart && response.uploadEnd && response.uploadCount) {
    // times delivered are in milliseconds
    bytesPerSecond = Math.floor(response.uploadCount / ((response.uploadEnd - response.uploadStart) / 1000));
    if(lastUploadEnd < response.uploadEnd) {
      uploadBytesPerSecondTally.push(bytesPerSecond);
      $('#uploadChartSpan').sparkline(uploadBytesPerSecondTally, sparkOpts);
    }
    lastUploadEnd = response.uploadEnd;
    humanReadable = humanFileSize(bytesPerSecond, true) + "ps";
    $("#uploadSpan").text(humanReadable);
  }
}

// resets every concievable variable
// and state of the form and just about
// anything you can immagine (timers, etc)
// so that everything can be started again
function reset() {
  if(sessionKey) {
    clearSession(sessionKey);
    sessionKey = null;
  }

  // first, terminate workers
  terminateWorkers(downloadWorkers);
  terminateWorkers(uploadWorkers);
  terminateWorkers(statusWorkers);

  // close web socket
  if(socket) {
    socket.close();
  }

  // stop update interval
  if(interval) {
    window.clearInterval(interval);
    interval = null;
  }

  // clear all timers
  for(i in timers) {
    timer = timers[i];
    if(timer) {
      window.clearTimeout(timer);
    }
  }
  timers = [];

  // clear other values/variables
  downloadBytesPerSecondTally = [];
  uploadBytesPerSecondTally = []
  lastDownloadEnd = 0;
  lastUploadEnd = 0;

  // clear display spans
  $('#pingChartSpan').html("&nbsp;");
  $('#downloadChartSpan').html("&nbsp;");
  $('#uploadChartSpan').html("&nbsp;");

  // activate start button, deactivate cancel button
  $("#startButton").prop("disabled", false);
  $("#cancelButton").prop("disabled", true);
}

function clearSession(sessionKey) {
  // not going to bother with older browsers
  xhr = new XMLHttpRequest();

  // open url with delete/clear target
  xhr.open('DELETE', '/clear/' + sessionKey + "?timestamp=" + Date.now(), true);
  xhr.send();
}
