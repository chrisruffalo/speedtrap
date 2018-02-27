// how much the bytes should grow each time
DOWNLOAD_GROW_FACTOR = 4;
MAX_BYTES = 10240000;

// pool of downloaders
downloaders = [];

onmessage = function(event) {
  // message switching
  message = event.data;
  //console.dir(message);
  if (message.terminate) {
    for(i in downloaders) {
      xhr = downloaders[i];
      xhr.abort();
      xhr[i] = null;
      console.log("Shut down download XHR request");
    }
    // terminate worker
    close();
  } else if (message.target && message.bytes) {
    target = message.target;
    bytes = message.bytes;
    threads = message.threads;
    for(i = 0; i < threads; i++) {
      download(target, bytes, i);
    }
  }
};

function download(target, bytes, thread) {
  if(bytes > MAX_BYTES) {
    bytes = MAX_BYTES;
  }
  //console.log("starting new download on thread " + thread + " with byte size " + bytes);

  // not going to bother with older browsers
  xhr = new XMLHttpRequest();
  downloaders.push(xhr)

  // on complete
  xhr.onreadystatechange = function(event) {
    if(xhr.readyState < 4) {
      return;
    }

    if (xhr.status >= 200 && xhr.status < 300) {
      download(target, bytes * DOWNLOAD_GROW_FACTOR, thread);
    }
  }

  // open url with byte target
  xhr.responseType = "arraybuffer";
  xhr.open('GET', target + "?bytes=" + bytes + "&timestamp=" + Date.now(), true);
  xhr.send(null);
}
