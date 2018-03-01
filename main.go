package main

import (
	"fmt"
	"flag"
	"bufio"
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gobuffalo/packr"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

// constrain this so people don't go nuts on the server
const _MAX_DOWNLOAD_BYTES = 52000000

// status struct
type status struct {
	UploadByteCount   uint64 `json:"uploadCount,omitempty"`
	UploadStart       uint64 `json:"uploadStart,omitempty"`
	UploadEnd         uint64 `json:"uploadEnd,omitempty"`
	DownloadByteCount uint64 `json:"downloadCount,omitempty"`
	DownloadStart     uint64 `json:"downloadStart,omitempty"`
	DownloadEnd       uint64 `json:"downloadEnd,omitempty"`
}

// map of session statuses
var statusMap = make(map[string]*status)

// source for random values
var randSource = rand.New(rand.NewSource(time.Now().Unix()))

// mutex for protecting status creation/retrieval
var statusMutex = &sync.Mutex{}

func getSessionStatus(sessionID string, create bool) (*status, bool) {
	// start with nil session status
	var sessionStatus *status

	// precondition
	if len(sessionID) < 1 {
		return sessionStatus, false
	}

	// engage mutex and read for existing session
	statusMutex.Lock()
	// if session found, drop mutex and return
	sessionStatus, ok := statusMap[sessionID]
	if ok {
		statusMutex.Unlock()
		return sessionStatus, true
	}

	// if session not found and create is required, create new
	errorFinding := true
	if create {
		log.Printf("Created new session %s", sessionID)
		errorFinding = false
		sessionStatus = &status{}
		statusMap[sessionID] = sessionStatus
	}

	// drop mutex
	statusMutex.Unlock()
	return sessionStatus, errorFinding
}

func getDownload(w http.ResponseWriter, r *http.Request) {
	params := mux.Vars(r)
	sessionID := params["sessionID"]

	// get session status
	sessionStatus, _ := getSessionStatus(sessionID, true)

	// determine byte count
	reqBytes, convErr := strconv.ParseInt(r.URL.Query().Get("bytes"), 10, 64)
	if convErr != nil {
		return
	}
	if reqBytes > _MAX_DOWNLOAD_BYTES {
		reqBytes = _MAX_DOWNLOAD_BYTES
	}

	// log session and byte request
	//log.Printf("Get data request for session %s (%d bytes)", sessionID, reqBytes)

	// start writing headers to prevent any attempt at caching
	w.Header().Add("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Add("Content-Type", "application/octet-stream")

	// send random stream of bytes, should be larger than compression windows on most hardware
	bufSize := 4194304
	if reqBytes < int64(bufSize) {
		bufSize = int(reqBytes)
	}
	buffer := make([]byte, bufSize)

	bufW := bufio.NewWriter(w)

	// populate reusable buffer
	rand.Read(buffer)

	// start clock at very first read and don't change later
	atomic.CompareAndSwapUint64(&sessionStatus.DownloadStart, 0, uint64(time.Now().UnixNano()/int64(time.Millisecond)))

	for reqBytes > 0 {
		// write byte slice
		writtenBytes, err := bufW.Write(buffer)

		// count downloaded bytes
		atomic.AddUint64(&sessionStatus.DownloadByteCount, uint64(writtenBytes))
		// clock should always be latest value of time
		atomic.StoreUint64(&sessionStatus.DownloadEnd, uint64(time.Now().UnixNano()/int64(time.Millisecond)))

		// break after final counts if error
		if err != nil {
			break
		}

		// adjust waiting bytes
		reqBytes -= int64(writtenBytes)

		// flush writer
		bufW.Flush()
	}

}

func getUpload(w http.ResponseWriter, r *http.Request) {
	params := mux.Vars(r)
	sessionID := params["sessionID"]
	//log.Printf("Upload request for session %s", sessionID)
	// get session status
	sessionStatus, _ := getSessionStatus(sessionID, true)

	// start clock at very first write and don't change later
	atomic.CompareAndSwapUint64(&sessionStatus.UploadStart, 0, uint64(time.Now().UnixNano()/int64(time.Millisecond)))

	// copy interval because if we just read all the bytes we never get around to updating the session
	var copyLen int64 = 8000
	buffer := make([]byte, copyLen)

	// dilligently read and discard everything
	for true {
		readBytes, err := r.Body.Read(buffer)
		if err != nil {
			break
		}
		// count uploaded bytes
		atomic.AddUint64(&sessionStatus.UploadByteCount, uint64(readBytes))
		// clock should always be latest value of time
		atomic.StoreUint64(&sessionStatus.UploadEnd, uint64(time.Now().UnixNano()/int64(time.Millisecond)))
	}

	// respond with ok message
	w.Write([]byte("ok"))
}

func getStatus(w http.ResponseWriter, r *http.Request) {
	params := mux.Vars(r)
	sessionID := params["sessionID"]
	//log.Printf("Status request for session %s", sessionID)
	if sessionStatus, ok := getSessionStatus(sessionID, false); ok {
		json.NewEncoder(w).Encode(sessionStatus)
	} else {
		// 404 response code if no status found
		w.WriteHeader(404)
	}
}

func clearStatus(w http.ResponseWriter, r *http.Request) {
	params := mux.Vars(r)
	sessionID := params["sessionID"]
	if _, ok := getSessionStatus(sessionID, false); ok {
		delete(statusMap, sessionID)
		log.Printf("Removed session for %s", sessionID)
	} else {
		// 404 response code if no status found
		w.WriteHeader(404)
	}
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != "http://"+r.Host {
		http.Error(w, "Origin not allowed", 403)
		return
	}
	conn, err := websocket.Upgrade(w, r, w.Header(), 1024, 1024)
	if err != nil {
		http.Error(w, "Could not open websocket connection", http.StatusBadRequest)
	}

	go handleWsConn(conn)
}

func pingResponse(conn *websocket.Conn) {
	conn.WriteMessage(websocket.TextMessage, []byte("p"))
}

func statusResponse(message string, conn *websocket.Conn) {
	// get rest of string to get message id
	sessionID := message[1:]
	if sessionStatus, ok := getSessionStatus(sessionID, false); ok {
		jsonBytes, _ := json.Marshal(sessionStatus)
		conn.WriteMessage(websocket.TextMessage, jsonBytes)
	} else {
		conn.WriteMessage(websocket.TextMessage, []byte("e"))
	}
}

func handleWsConn(conn *websocket.Conn) {
	for {
		messageType, p, err := conn.ReadMessage()
		if err != nil {
			return
		}

		// check message type
		if messageType == websocket.TextMessage {
			message := string(p)
			if strings.HasPrefix(message, "p") {
				pingResponse(conn)
			} else if strings.HasPrefix(message, "s") {
				statusResponse(message, conn)
			}
		} else {
			conn.WriteMessage(websocket.TextMessage, []byte("e"))
		}		
	}
}

func main() {
	router := mux.NewRouter()

	// get bytes of data from the server
	router.HandleFunc("/api/download/{sessionID}", getDownload).Methods("GET")

	// send data (which is counted and discarded)
	router.HandleFunc("/api/upload/{sessionID}", getUpload).Methods("PUT", "POST")

	// get status of upload/downloads
	router.HandleFunc("/api/status/{sessionID}", getStatus).Methods("GET")

	// clear status/session manually
	router.HandleFunc("/api/clear/{sessionID}", clearStatus).Methods("DELETE")

	// websocket for ping/pong and status connections
	router.HandleFunc("/ws", wsHandler)

	// handle static files, no idea why fileserver doesn't work with the box righ there but it won't so
	// we make this strange contraption to get it to work
	box := packr.NewBox("./static")
	router.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if len(path) < 1 || "/" == path {
			path = "/index.html"
		}
		if !box.Has(path) {
			w.WriteHeader(404)
			return
		}
		w.Write(box.Bytes(path))
	})

	var host = flag.String("host", "127.0.0.1", "Host to serve traffic on")
	var port = flag.Int("port", 9922, "Port to serve traffic on" )
	flag.Parse()

	// set host and port
	hostAndPort := fmt.Sprintf("%s:%d", *host, *port)

	// start session reaper
	ticker := time.NewTicker(30 * time.Second)
	go func() {
	    for {
	       select {
	        case <- ticker.C:
	        	minute := uint64(60000) // one minute in ms
	        	now := uint64(time.Now().UnixNano()/int64(time.Millisecond))
	            for key, value := range statusMap {
	            	if value != nil && (value.DownloadEnd > 0 && (now - value.DownloadEnd) >= uint64(3 * minute)) || (value.UploadEnd > 0 && (now - value.UploadEnd) >= minute) {
	            		delete(statusMap, key)
	            		log.Printf("Reaped expired session %s", key)
	            	}
	            }
	        }
	    }
	 }()	

	// log traffic location
	log.Printf("Serving traffic on %s", hostAndPort)

	// log exit reason
	log.Fatal(http.ListenAndServe(hostAndPort, router))
}
