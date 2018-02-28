// timer pool
timers = [];

// resume callback allows us to do something after termination
resumeCallback = null;

function spawnWorker() {
  worker = new Worker("js/worker.js");
  worker.onmessage = function(event) {
    message = event.data
    if(!message) {
      return;
    }

    // if a forward is requetsed then
    // send it back to the worker
    if(message.terminated) {
      worker.postMessage({"resume": true});
      if(resumeCallback) {
        resumeCallback();
        resumeCallback = null;
      }
    } else if(message.forward) {
      worker.postMessage(message);
    }
  }
  return worker;
}
// create workers
worker = spawnWorker();

// other session and time related values
sessionKey = null;
interval = null;
socket = null;
statusSocket = null;

// create a new session key
function newSessionKey() {
  return Array.apply(null, Array(SESSION_KEY_LENGTH)).map(pickRandom).join('');
}

// terminate workers via "poison pill"
function terminateWorkers(callback) {
  worker.postMessage({"terminate": true});
  resumeCallback = callback;
}

function makeWebSocket() {
  socketType = "ws";
  if(window.location.href.startsWith("https")) {
    socketType = "wss";
  }
  return new WebSocket(socketType + "://" + location.hostname + ":" + location.port + "/ws");
}

// socket that periodically asks
// for a status update and then pushes the response
// back to the dispatch method and then waits
// to send the request again
function statusWebSocket(sessionKey) {
  if(statusSocket) {
    statusSocket.close();
    statusSocket = null;
  }
  socket = makeWebSocket();
  socket.onopen = function() {
    socket.send("s" + sessionKey);
  }
  socket.onmessage = function(event) {
    // send status data to event
    dispatchStatus(event.data);
    // after status interval, ask for status again
    timer = window.setTimeout(function() {
      socket.send("s" + sessionKey);
    }, STATUS_CHECK_INTERVAL);
    timers.push(timer);     
  }
  statusSocket = socket;
  return socket;
}

// start test
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
  socket = makeWebSocket();
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
  }, PING_TEST_INTERVAL * 1000);
  timers.push(timer);
}

function doTest_Download(sessionKey) {
  // start download test
  console.log("Starting download portion for " + sessionKey)
  worker.postMessage({"download": true, "sessionKey": sessionKey, "requests": DOWNLOAD_REQUESTS});

  // about a half second into the download start status
  timer = window.setTimeout(function() {
    statusWebSocket(sessionKey);
  }, STATUS_DELAY_INTERVAL);
  timers.push(timer);

  // kill downloaders after time interval
  timer = window.setTimeout(function() {
    clearTimers();
    // handle worker shutdown
    console.log("Stopping downloaders...");
    terminateWorkers(function() {
      // chain to upload portion
      doTest_Upload(sessionKey);
    });
  }, DOWNLOAD_TEST_INTERVAL_S * 1000);
  timers.push(timer);
}

function doTest_Upload(sessionKey) {
  // start upload test
  console.log("Starting upload portion for " + sessionKey)
  worker.postMessage({"upload": true, "sessionKey": sessionKey, "requests": UPLOAD_REQUESTS});

  // about a half second into the upload start status
  timer = window.setTimeout(function() {
    statusWebSocket(sessionKey);
  }, STATUS_DELAY_INTERVAL);
  timers.push(timer);

  // kill uploaders after time interval
  timer = window.setTimeout(function() {
    clearTimers();
    // handle worker shutdown
    console.log("Stopping uploaders...");
    terminateWorkers(function() {
      // chain to stop test after termination
      stopTest();
    });
  }, DOWNLOAD_TEST_INTERVAL_S * 1000);
  timers.push(timer);
}

function stopTest() {
  // stop all timers
  clearTimers();

  // close web socket if needed
  if(statusSocket) {
    statusSocket.close();
  }

  // clear session from server
  // clearSession(sessionKey); // maybe do this after some time?
  sessionKey = null;

  // fix button state
  $("#startButton").prop("disabled", false);
  $("#cancelButton").prop("disabled", true);
}

function pingUpdate(pingTimes) {
  // don't mess with empty ping time list
  if(!pingTimes || pingTimes.length < 1) {
    return;
  }

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
function dispatchStatus(response) {
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
    humanReadable = humanByteSize(bytesPerSecond, true) + "/s";
    $("#downloadSpan").text(humanReadable);
    humanReadableBits = "(" + humanBitSize(bytesPerSecond * 8, true) + "ps)";
    $("#downloadBitSpan").text(humanReadableBits);
  }

  if(response.uploadStart && response.uploadEnd && response.uploadCount) {
    // times delivered are in milliseconds
    bytesPerSecond = Math.floor(response.uploadCount / ((response.uploadEnd - response.uploadStart) / 1000));
    if(lastUploadEnd < response.uploadEnd) {
      uploadBytesPerSecondTally.push(bytesPerSecond);
      $('#uploadChartSpan').sparkline(uploadBytesPerSecondTally, sparkOpts);
    }
    lastUploadEnd = response.uploadEnd;
    humanReadable = humanByteSize(bytesPerSecond, true) + "/s";
    $("#uploadSpan").text(humanReadable);
    humanReadableBits = "(" + humanBitSize(bytesPerSecond * 8, true) + "ps)";
    $("#uploadBitSpan").text(humanReadableBits);
  }
}

// clear recurring timers that have accumulated
function clearTimers() {
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
}

// resets every concievable variable
// and state of the form and just about
// anything you can immagine (timers, etc)
// so that everything can be started again
function reset() {
  // clear any callback
  resumeCallback = null;

  // remove session key
  if(sessionKey) {
    clearSession(sessionKey);
    sessionKey = null;
  }

  // clear any timers
  clearTimers();

  // terminate all worker actions
  terminateWorkers();

  // close web socket (if not null)
  if(socket) {
    socket.close();
  }

  // close status socket if needed
  if(statusSocket) {
    statusSocket.close();
  }

  // clear other values/variables
  downloadBytesPerSecondTally = [];
  uploadBytesPerSecondTally = []
  lastDownloadEnd = 0;
  lastUploadEnd = 0;

  // clear display segments
  $('#pingSpan').html("&nbsp;");
  $('#downloadSpan').html("&nbsp;");
  $('#downloadBitSpan').html("&nbsp;");
  $('#uploadSpan').html("&nbsp;");
  $('#uploadBitSpan').html("&nbsp;");

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
  xhr.open('DELETE', CLEAR_TARGET + "/" + sessionKey + "?timestamp=" + Date.now(), true);
  xhr.send();
}