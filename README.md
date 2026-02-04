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
| defaultRoomSettings | Default permissions for rooms | `"object"` | | 
| liveReload | live reload for prometheus exporter config | `"bool"` | | 
| prometheus | prometheus exporter for rooms | `"object"` | | 

---
# Configuration Reference (`config.json`)

This document describes all available configuration options in `config.json`, their purpose, and expected values.

---

## Root Configuration

### `liveReload`

```json
{
	"liveReload": false,
  ...
}
```

- **Type:** `boolean`
- **Default:** `false`
- **Description:**  
  Enables or disables live reload of the application when configuration files change.  
  Intended mainly for development environments. (currently only works with prometheus exporter)

---

## Prometheus Monitoring

### `prometheus`

Exposes Prometheus metrics when enabled.

```json
{
	"prometheus": {
		"enabled": false,
		"period": 10,
		"listener": [
			{
				"ip": "0.0.0.0",
				"port": 3080,
				"protocol": "http"
			},
			{
				"ip": "0.0.0.0",
				"port": 3043,
				"protocol": "https",
				"cert": {
					"cert": "./certs/edumeet-demo-cert.pem",
					"key": "./certs/edumeet-demo-key.pem"
				}
			}
		]
	},
  ...
}
```
#### `prometheus.enabled`

- **Type:** `boolean`
- **Default:** `false`
- **Description:**  
  Enables Prometheus metrics collection and exposure.

#### `prometheus.period`

- **Type:** `number`
- **Unit:** seconds
- **Default:** `10`
- **Description:**  
  Interval at which metrics are collected.

#### `prometheus.listener`

- **Type:** `array`
- **Description:**  
  List of network listeners used to expose Prometheus metrics.

##### Listener Object

| Field     | Type     | Description |
|----------|----------|-------------|
| `ip`     | `string` | IP address to bind to (e.g. `0.0.0.0`) |
| `port`   | `number` | Port to listen on |
| `protocol` | `string` | `http` or `https` |

##### HTTPS Listener – `cert`

Required when `protocol` is `https`.

| Field | Type | Description |
|------|------|-------------|
| `cert` | `string` | Path to TLS certificate file |
| `key`  | `string` | Path to TLS private key file |

---

## Server Settings

```json
	"listenPort": "8443",
	"listenHost": "0.0.0.0",
	"tls": {
		"cert": "./certs/edumeet-demo-cert.pem",
		"key": "./certs/edumeet-demo-key.pem"
	},
```

### `listenHost`

- **Type:** `string`
- **Default:** `0.0.0.0`
- **Description:**  
  Host or IP address the main server listens on.

### `listenPort`

- **Type:** `string`
- **Default:** `"8443"`
- **Description:**  
  Port used by the main server.  
  Stored as a string for flexible parsing.

---

## TLS Configuration

### `tls`

Defines TLS settings for the main server. (if not specified runs on http mode)

| Field | Type | Description |
|------|------|-------------|
| `cert` | `string` | Path to TLS certificate |
| `key`  | `string` | Path to TLS private key |

---

## Management Service

### `managementService`

Configuration for the external management/authentication service. (if not specified disabled)

#### `managementService.host`

- **Type:** `string`
- **Description:**  
  Base URL of the management service.

#### `managementService.jwtPublicKeys`

- **Type:** `array<string>`
- **Description:**  
  List of PEM-encoded public keys used to verify JWT tokens issued by the management service.

---

## Default Room Settings

### `defaultRoomSettings`

Defines default behavior and permissions for newly created rooms.
```json
	"defaultRoomSettings": {
			"defaultRole": {
					"name": "Default",
					"description": "Default role",
					"permissions": [
							{ "name": "CHANGE_ROOM_LOCK" },
							{ "name": "PROMOTE_PEER" },
							{ "name": "SEND_CHAT" },
							{ "name": "MODERATE_CHAT" },
							{ "name": "SHARE_AUDIO" },
							{ "name": "SHARE_VIDEO" },
							{ "name": "SHARE_SCREEN" },
							{ "name": "SHARE_EXTRA_VIDEO" },
							{ "name": "SHARE_FILE" },
							{ "name": "MODERATE_FILES" },
							{ "name": "MODERATE_ROOM" },
							{ "name": "LOCAL_RECORD_ROOM" },
							{ "name": "CREATE_ROOM" },
							{ "name": "CHANGE_ROOM" }
					]
			},
			"locked": false,
			"tracker": "wss://<trackerfqdn>/<path>/",
			"reactionsEnabled": false
	},
```

---

### Default Role

#### `defaultRoomSettings.defaultRole`

Describes the default role assigned to users.

| Field | Type | Description |
|------|------|-------------|
| `name` | `string` | Human-readable role name |
| `description` | `string` | Role description |
| `permissions` | `array` | List of permissions granted to the role |

##### Permissions

Each permission is an object with a `name` field.

Example permissions:

- `CHANGE_ROOM_LOCK`
- `PROMOTE_PEER`
- `SEND_CHAT`
- `MODERATE_CHAT`
- `SHARE_AUDIO`
- `SHARE_VIDEO`
- `SHARE_SCREEN`
- `SHARE_EXTRA_VIDEO`
- `SHARE_FILE`
- `MODERATE_FILES`
- `MODERATE_ROOM`
- `LOCAL_RECORD_ROOM`
- `CREATE_ROOM`
- `CHANGE_ROOM`

---

### Room Behavior

| Setting | Type | Description |
|-------|------|-------------|
| `maxActiveVideos` | `number` | Maximum number of active video streams |
| `locked` | `boolean` | Whether rooms are locked by default |
| `breakoutsEnabled` | `boolean` | Enables breakout rooms |
| `chatEnabled` | `boolean` | Enables chat functionality |
| `raiseHandEnabled` | `boolean` | Enables “raise hand” feature |
| `filesharingEnabled` | `boolean` | Enables file sharing |
| `localRecordingEnabled` | `boolean` | Enables local room recording |
| `tracker` | `string` | for file sharing |
| `maxFileSize` | `number` | filesize for fileshareing (100 is the default value - 100 MB )  |



---

## Media Nodes

### `mediaNodes`

- **Type:** `array`
- **Description:**  
  List of available media nodes used for audio and video processing.

```json
"mediaNodes": [{
		"hostname": "localhost",
		"port": 3000,
		"secret": "secret-shared-with-media-node",
		"latitude": 63.430481,
		"longitude": 10.394964,
		"country": "NO",
		"turnHostname": "localhost",
		"turnports" :  [
			{
				"protocol":"turn",
				"port": 80,
				"transport": "udp"
			},
			{
				"protocol":"turns",
				"port": 443,
				"transport": "tcp"
			}
		]
	}]
```

---

### Media Node Object

| Field | Type | Description |
|------|------|-------------|
| `hostname` | `string` | Media node hostname or IP |
| `port` | `number` | Media node control port |
| `secret` | `string` | Shared secret for authentication |
| `latitude` | `number` | Geographic latitude |
| `longitude` | `number` | Geographic longitude |
| `country` | `string` | ISO country code |
| `turnHostname` | `string` | TURN server hostname |

---

### TURN Ports

#### `mediaNodes[].turnports`

Defines TURN/TURNS listeners for NAT traversal.

##### TURN Port Object

| Field | Type | Description |
|------|------|-------------|
| `protocol` | `string` | `turn` or `turns` |
| `port` | `number` | Port number |
| `transport` | `string` | `udp` or `tcp` |

---

## Notes

- All file paths are relative to the application working directory unless otherwise specified.
- TLS certificates must be valid and readable by the application.
- Media node secrets **must match** the configuration on the corresponding media node services.

