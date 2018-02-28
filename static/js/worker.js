// get constants
importScripts("constants.js");
// and import possible utilites
importScripts("utils.js");

// all xhr requests are added to this array and then
// this array is used in a termination call to kill them
requests = [];

// blocking waiting state
discarding = false;

// the worker gets messages from the application
// and then does something (based on the request)
onmessage = function(event) {
    // simple guard against bad message
    message = event.data;
    if(!message) {
        return;
    }

    // handle message
    dispatch(message);
}

function dispatch(message) {
    // handle message switching
    if(message.resume) {
        discarding = false;
        return;
    } else if(discarding) {
        return;
    } else if(message.terminate) {
        terminate(message);
    } else if(message.download) {
        download(message);
    } else if(message.upload) {
        upload(message);
    }
}

// terminate active requests and clear requests
function terminate(message) {
    // start blocking
    discarding = true;
    // termiante xhr requests
    for(i in requests) {
        request = requests[i];
        if(request) {
            request.abort();
        }
    }
    // clear requests
    requests = [];
    // post resume message
    postMessage({"terminated": true});
}

// do downloads
function download(message) {
    // check bytes
    bytes = message.bytes ? message.bytes : MAX_DOWNLOAD_BYTES;
    if(bytes > MAX_DOWNLOAD_BYTES) {
        bytes = MAX_DOWNLOAD_BYTES;
    } else if (bytes < MIN_DOWNLOAD_BYTES) {
        bytes = START_DOWNLOAD_BYTES;
    }

    // check session
    sessionKey = message.sessionKey;
    if(!sessionKey) {
        return;
    }

    // one requests if no amount of requests is specified
    requestCount = message.requests ? message.requests : 1;
    for(r = 0; r < requestCount; r++) {
        // not going to bother with older browsers
        xhr = new XMLHttpRequest();
        requests.push(xhr)

        // on complete
        xhr.onreadystatechange = function(event) {
            if(xhr.readyState < 4) {
              return;
            }

            if (xhr.status >= 200 && xhr.status < 300 && xhr.readyState === 4) {
                downloadResponse = {
                    "download": true,
                    "forward": true,
                    "sessionKey": sessionKey,
                    "bytes": bytes * DOWNLOAD_GROW_FACTOR,
                    "time": Date.now()
                };
                // the response goes back and a new message is sent
                // because that keeps the call stack from growing
                // which is what happens when we call it from here
                postMessage(downloadResponse);
            }
        }

        // open url with byte target
        xhr.responseType = "arraybuffer";
        xhr.open('GET', DOWNLOAD_TARGET + "/" + sessionKey + "?bytes=" + bytes + "&timestamp=" + Date.now(), true);
        xhr.send(null);
    }
}

// random data pool, shared data
randomData = createRandomBlob(UPLOAD_BYTES);
function upload(message) {
    // check session
    sessionKey = message.sessionKey;
    if(!sessionKey) {
        return;
    }

    // one requests if no amount of requests is specified
    requestCount = message.requests ? message.requests : 1;
    for(r = 0; r < requestCount; r++) {
      // not going to bother with older browsers
      xhr = new XMLHttpRequest();
      requests.push(xhr)

      // when upload complete send a new upload
      xhr.upload.onload = function() {
          uploadResponse = {
              "upload": true,
              "forward": true,
              "sessionKey": sessionKey,
              "time": Date.now()
          };

          // the response goes back and a new message is sent
          // because that keeps the call stack from growing
          // which is what happens when we call it from here
          postMessage(uploadResponse);
      };

      // open url with byte target
      xhr.open('POST', UPLOAD_TARGET + "/" + sessionKey + "?timestamp=" + Date.now(), true);
      xhr.setRequestHeader('Content-Encoding', 'application/octet-stream')
      xhr.send(randomData);
    }
}