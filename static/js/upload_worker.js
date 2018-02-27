// how big of an entropy block the random function can provide
MAX_PROVIDER_ARRAY = 65536;
UPLOAD_BYTES = 5120000;

// pool of downloaders
uploaders = [];

onmessage = function(event) {
  // message switching
  message = event.data;
  //console.dir(message);
  if (message.terminate) {
    for(i in uploaders) {
      xhr = uploaders[i];
      xhr.abort();
      xhr[i] = null;
      console.log("Shut down upload XHR request");
    }
    // terminate worker
    close();
  } else if (message.target) {
    target = message.target;
    for(i = 0; i < message.threads; i++) {
      // start upload
      upload(target, i);
    }
  }
};

function binaryBlob(length) {
  // build containing array buffer
  container = new ArrayBuffer(length);
  containerView = new Uint32Array(container);

  // holder array
  holder = new ArrayBuffer(MAX_PROVIDER_ARRAY);
  bHolder = new Uint32Array(holder);

  index = 0;
  while(index < containerView.length) {
    // get random values
    crypto.getRandomValues(bHolder);
    for(i in bHolder) {
      if(index >= containerView.length){
        break;
      }
      containerView[index++] = bHolder[i];
    }
  }

  // return array buffer as blob
  return new Blob(containerView, {"type": "application/octet-stream"});
  //return container;
}

// random data pool, each thread has own data
randomData = binaryBlob(UPLOAD_BYTES);
function upload(target, thread) {
  //console.log("starting new upload on thread " + thread);

  // not going to bother with older browsers
  xhr = new XMLHttpRequest();
  uploaders.push(xhr)

  // on complete
  xhr.onreadystatechange = function(event) {
    if(xhr.readyState < 4) {
      return;
    }

    // done uploading
    if(xhr.status >= 200 && xhr.status < 300) {
      upload(target, thread);
    }
  }

  // open url with byte target
  xhr.open('POST', target + "?timestamp=" + Date.now(), true);
  xhr.setRequestHeader('Content-Encoding', 'identity')
  xhr.send(randomData);
}
