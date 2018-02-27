package main

import (
	"bufio"
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dustin/randbo"
	"github.com/gobuffalo/packr"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

// how many times to reuse the buffer
const bufferFactor = 128

type msg struct {
	Num int
}

// status struct
type status struct {
	UploadByteCount   uint64 `json:"uploadCount,omitempty"`
	DownloadByteCount uint64 `json:"downloadCount,omitempty"`
	DownloadStart     uint64 `json:"downloadStart,omitempty"`
	DownloadEnd       uint64 `json:"downloadEnd,omitempty"`
}

// map of session statuses
var statusMap = make(map[string]*status)

// source
var randSource = rand.New(rand.NewSource(time.Now().Unix()))

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
		errorFinding = false
		sessionStatus = &status{}
		statusMap[sessionID] = sessionStatus
	}

	// drop mutex
	statusMutex.Unlock()
	return sessionStatus, errorFinding
}

func ping(w http.ResponseWriter, r *http.Request) {
	params := mux.Vars(r)
	log.Printf("Ping for session %s", params["sessionID"])
}

func getData(w http.ResponseWriter, r *http.Request) {
	params := mux.Vars(r)
	sessionID := params["sessionID"]

	// get session status
	sessionStatus, _ := getSessionStatus(sessionID, true)

	// determine byte count
	reqBytes, convErr := strconv.ParseInt(r.URL.Query().Get("bytes"), 10, 64)
	if convErr != nil {
		return
	}

	// log session and byte request
	log.Printf("Get data request for session %s (%d bytes)", sessionID, reqBytes)

	// start writing headers to prevent any attempt at caching
	w.Header().Add("Cache-Control", "no-cache, no-store, must-revalidate")

	// send random stream of bytes, should be larger than compression windows on most hardware
	buffer := make([]byte, 4194304)

	bufW := bufio.NewWriter(w)
	bufR := bufio.NewReader(randbo.New())

	// populate buffer
	bufR.Read(buffer)

	// start clock at very first read and don't change later
	atomic.CompareAndSwapUint64(&sessionStatus.DownloadStart, 0, uint64(time.Now().UnixNano()/int64(time.Millisecond)))

	for reqBytes > 0 {
		// write byte slice
		writtenBytes, err := bufW.Write(buffer)

		if writtenBytes > 0 {
			// count downloaded bytes
			atomic.AddUint64(&sessionStatus.DownloadByteCount, uint64(writtenBytes))
			// clock should always be latest value of time
			atomic.StoreUint64(&sessionStatus.DownloadEnd, uint64(time.Now().UnixNano()/int64(time.Millisecond)))
		}

		// break after final counts if error
		if err != nil {
			break
		}

		// adjust waiting bytes
		reqBytes -= int64(writtenBytes)
	}

}

func getUpload(w http.ResponseWriter, r *http.Request) {
	params := mux.Vars(r)
	sessionID := params["sessionID"]
	log.Printf("Upload request for session %s", sessionID)
	// get session status
	sessionStatus, _ := getSessionStatus(sessionID, true)

	// just an attempt at the buffer size, probably need to do better here
	var buffer = make([]byte, 4194304)

	// dilligently read and discard everything
	for true {
		readBytes, err := r.Body.Read(buffer)
		if readBytes < 1 || err != nil {
			break
		}
		// count uploaded bytes
		atomic.AddUint64(&sessionStatus.UploadByteCount, uint64(readBytes))
	}
}

func getStatus(w http.ResponseWriter, r *http.Request) {
	params := mux.Vars(r)
	sessionID := params["sessionID"]
	log.Printf("Status request for session %s", sessionID)
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

func handleWsConn(conn *websocket.Conn) {
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			return
		}

		//log.Print("got ping from client")

		conn.WriteMessage(websocket.TextMessage, []byte("p"))
	}
}

func main() {
	router := mux.NewRouter()

	// ping
	router.HandleFunc("/ping/{sessionID}", ping).Methods("GET")

	// get data
	router.HandleFunc("/data/{sessionID}", getData).Methods("GET")

	// send data
	router.HandleFunc("/upload/{sessionID}", getUpload).Methods("PUT", "POST")

	// get status
	router.HandleFunc("/status/{sessionID}", getStatus).Methods("GET")

	// clear status
	router.HandleFunc("/clear/{sessionID}", clearStatus).Methods("DELETE")

	// websocket
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

	// log exit reason
	log.Fatal(http.ListenAndServe(":8000", router))
}
