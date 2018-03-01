# SPEEDTRAP!

## Overview

There's not a lot to this project but essentially I was looking at trying to self-host a speed test so that I could measure ping and data speeds between wherever I was and my house. The main purpose is for things like Plex or other types of streaming and to diagnose connection issues while I'm on the road. There are a few other solutions out there but they either really use too much resources on the target system or they are too complicated to get running quickly. I wanted something that was simple and reasonably fast.

## Concept of Operations

The thought process behind this application was that the browser could either accept traffic or send traffic to the server and that the server could keep statistics on it. The browser client can periodically ask for the status of the statistics and use that to display things on the client side.

The basic program flow follows these steps:
* Ensure the starting state clear
* Open a websocket
* For an ${interval}:
* * push a byte to the server
* * wait for response, divide time by two for average one-way ping
* Start websocket connection to monitor status
* For an ${interval}:
* * Download progressively larger chunks from the server
* * Status responses update widgets in page
* For an ${interval}:
* * Upload chunks to the server
* * Status responses update widgets in page
* Close websockets and requests

## Building and Running

The application requires that `packr` be installed:
```bash
[]$ go get -u github.com/gobuffalo/packr/...
```

Once `packr` is intalled the application can be built or installed with packr for embedded static resources:
```bash
[]$ packr build
[]$ packr install
```

## Docker

Speedtrap is completely built inside the Docker container and just needs to be built with:
```bash
[]$ docker build -t chrisruffalo/speedtrap .
```

Running the container will always bring the service up on the inside on port 8000. Other than mapping the port there is little that you need to do:
```bash
[]$ docker run -d --name speedtrap -p 8000:8000 chrisruffalo/speedtrap
```

## Reverse Proxy

### Apache

To serve Speedtrap through HTTPD a configuration like the following works assuming you are hosting your application on `speedtrap.yourhost.tld` and using port 8000 for the application or for the Docker container:

```
<VirtualHost *:80>
    ServerName speedtrap.yourhost.tld
 
 
    ProxyPreserveHost On
    ProxyRequests off

    ProxyPass "/ws/" "ws://localhost:8000/ws/"
    ProxyPassReverse "/ws/" "ws://localhost:8000/ws/"

    ProxyPass / http://localhost:8000/
    ProxyPassReverse / http://localhost:8000/

    RewriteEngine on
    RewriteCond %{HTTP:Upgrade} =websocket [NC]
    RewriteRule /(.*)  ws://localhost:8000/$1 [P,L]
    RewriteCond %{HTTP:Upgrade} !=websocket [NC]
    RewriteRule /(.*)  http://localhost:8000/$1 [P,L]
</VirtualHost>
```