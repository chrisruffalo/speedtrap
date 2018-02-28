// https://stackoverflow.com/questions/10420352/converting-file-size-in-bytes-to-human-readable-string
function humanByteSize(bytes, si) {
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

function humanBitSize(bits, si) {
    var thresh = si ? 1000 : 1024;
    if(Math.abs(bits) < thresh) {
        return bits + ' b';
    }
    var units = si
        ? ['kb','Mb','Gb','Tb','Pb','Eb','Zb','Yb']
        : ['Kib','Mib','Gib','Tib','Pib','Eib','Zib','Yib'];
    var u = -1;
    do {
        bits /= thresh;
        ++u;
    } while(Math.abs(bits) >= thresh && u < units.length - 1);
    return bits.toFixed(1)+' '+units[u];
}

// random string picker for session keys
POSSIBLE_KEYS_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function pickRandom() {
    return POSSIBLE_KEYS_CHARS[Math.floor(Math.random() * POSSIBLE_KEYS_CHARS.length)];
}

// creates a fully randomized binary blob
function createRandomBlob(length) {
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
}
