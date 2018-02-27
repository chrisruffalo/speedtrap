SESSION_CHECK_INTERVAL = 250;

// global xhr status
in_progress = null;
timer = null;

onmessage = function(event) {
  // message switching
  message = event.data;
  //console.dir(message);
  if (message.terminate) {
    if(timer != null) {
      clearTimeout(timer);
    }
    // terminate any in progress xhr
    in_progress.abort();
    // terminate worker
    close();
  } else if (message.target) {
    check(message.target);
  }
};

function check(target) {
  // not going to bother with older browsers
  xhr = new XMLHttpRequest();
  in_progress = xhr;

  // on complete
  xhr.onreadystatechange = function(event) {
    if(xhr.readyState < 4) {
      return;
    }

    if (xhr.status >= 200 && xhr.status < 300) {
      postMessage({"status": true, "response": xhr.response});

      // start timer
      timer = setTimeout(function(){ check(target); }, SESSION_CHECK_INTERVAL);
    }
  }

  // open url with byte target
  xhr.open('GET', target + "?timestamp=" + Date.now(), true);
  xhr.send();
}
