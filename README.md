# Edumeet room server

This is the room server service for the Edumeet project.
It handles signaling to and from client and media node services.

![](img/edumeet-room-server.drawio.png)

## Usage

Make a file called `config.json` in the `/config` folder. An example configuration file with all properties set to default values can be found here:
[config.example.json](config/config.example.json)

Note that if you don't provide a value for `tls.cert` and `tls.key` the server will start in HTTP mode.

### Reverse proxy
We use geo position based on client ipv4 address when doing load balancing.
If you're running room-server service behind a reverse proxy, you need to forward client ipv4 address in http header `x-forwarded-for`.

As ipv6 is not supported in [the library we use for geoip lookup](https://github.com/geoip-lite/node-geoip), deploying edumeet using ipv6 is not recommend.

### Running the service manually

```bash
$ yarn install
$ MANAGEMENT_USERNAME=username MANAGEMENT_PASSWORD=password yarn start
```

To run the service you need to have Node.js version 18 or higher installed. Alternatively you can get some debug output by running it like this:

```bash
$ DEBUG=edumeet:* yarn start
```

### Docker
https://github.com/edumeet/edumeet-docker/tree/main has guidelines for running all eduMEET-components as docker containers.
To build just edumeet-room-server you can use the included `./Dockerfile` here in this repo.

Edit and change password/username to use with management-server in `./Dockerfile` 

Building: 
```bash 
docker build . -t edumeet-room-server
```

Running: 
```bash 
docker run -v $(pwd)/config:/usr/src/app/config -p 8443:8443 -d edumeet-room-server
```
## Configuration properties

| Name | Description | Format | Default value |
| :--- | :---------- | :----- | :------------ |
| listenPort | Socket port to listen on | `"port"` | ``8443`` |
| listenHost | Ip/address the server will listen on | `"string"` | ``0.0.0.0``
| tls | TLS configuration for the server | `object` | ``{ "cert": "./certs edumeet-demo-cert.pem", "key": "./certs/edumeet-demo-key.pem"}`` |
| mediaNodes | Array of media nodes to use | `array` | ``[ { "host": "localhost", "port": 3000, "secret": "secret-shared-with-media-node", "latitude": 63.430481, "longitude": 10.394964, "country": "NO" } ]`` |
| managementService | Management service configuration | `object` | ``{	"host": "http://localhost:3030", "jwtPublicKeys": [	"-----BEGIN PUBLIC KEY-----\nMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAwO5DNSj3KSWpC4yFw0pP\nY6cmJPb3H6HzmbehugHMl+l0UFAr+eNeGKgXiKPFEGqWTMJg8mK72FNCLP+u/uBn\n8LhYOghIFUsiO9HZwEUH9rtN2L1nXOYKY/dckEVECMxjVnwsEilp+nV9AKncns7k\n37ERT+AhgmKYsIbZx8HL2KIsLEZhnZahTY2Iyw149hBzNFTwSKW9QssbPAL0RRl4\nydUHNnhMP21ElsQ0McQQae6C0bCejNMpiDFc0MqjzcnI4o0zH/nTIR68dNXTmZBa\nsoqvTsly3T9f3IkoDAd+NiYir4/4u43PlIrDB6RwMjsgjCKOrlLJoZFgcc2xORO5\nJTk8NKXg4AgTezs62izUz/kR90H/TXL87oiBQqIQ0XpDsiy5IPwkcUllv8f/q4oZ\n9wrV7/zdKTiHGI6OaIeNNYH726jTcUAadOzWuiyLAj99ki0ZZimUYwSPbZJ4NbHD\nFMVO/gAkTvuk0PZW1vsrqXdyFkuYk/2lUufrTYyOCDpyHE6GQuraC9qawsF/pL85\njolO9ea5zbVdBLAIThUDMvxp3c8sYuZfsapryiWqpcFokLJ/it6f/M9JFnL5WR0E\nY554QO73Qet5e/xXdTmqbFcqUcL1xQLHlPZsKjocEcPM7rXBLeUGxk7/OUPPgSaE\nM/ijCSi/4aqDk2lPSdzG1RsCAwEAAQ==\n-----END PUBLIC KEY-----\n" ] }`` |
---
