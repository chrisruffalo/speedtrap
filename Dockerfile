FROM golang:1.9

# set up working dir and copy local project
WORKDIR /go/src/speedtrap
COPY *.go .
COPY static ./static

# get all deps
RUN go get -d -v ./...
# actually install packer
RUN go get github.com/gobuffalo/packr/...
# use packer to build with embedded bins
RUN packr install

# run speedtrap
CMD ["speedtrap", "-host", "0.0.0.0", "-port", "8000"]
