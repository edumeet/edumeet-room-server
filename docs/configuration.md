# Room-server configuration reference

| Name | Description | Format | Default value |
| :--- | :---------- | :----- | :------------ |
| listenPort | Socket port to listen on | `"string"` | Example: `"8443"`; set explicitly |
| listenHost | IP address the server will listen on | `"string"` | Example: `"0.0.0.0"`; set explicitly |
| trustedProxies | Addresses (IP or CIDR) of reverse proxies whose `X-Forwarded-For` is believed. The client address decides a bot credential's `allowedIps` and media node selection, so a client that reaches the room server directly must not be able to choose it | `array` | ``[ "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "::1/128", "fc00::/7", "fe80::/10" ]`` |
| tls | TLS configuration for the server | `object` | ``{ "cert": "./certs/edumeet-demo-cert.pem", "key": "./certs/edumeet-demo-key.pem"}`` |
| mediaNodes | Array of media nodes to use. Each needs a `secret` that is not empty, the one its media node was started with (`MEDIA_SECRET`); the room server does not start otherwise | `array` | ``[ { "hostname": "localhost", "port": 3000, "secret": "secret-shared-with-media-node", "latitude": 63.430481, "longitude": 10.394964, "country": "NO" } ]`` |
| countryToRegion | Map media-node country codes to deployment-defined region labels | `object` | not set |
| defaultAllowedMediaNodeRegions | Fallback region allowlist for tenants without their own restriction | `array` | ``[]`` (no restriction) |
| managementService | Management service configuration | `object` | ``{	"host": "http://localhost:3030", "jwtPublicKeys": [	"REPLACE_WITH_THE_PUBLIC_KEY_OF_YOUR_MANAGEMENT_SERVER" ] }`` |
| defaultRoomSettings | Default permissions and feature settings for rooms | `"object"` | |
| maxBotJobsPerRoom | Maximum simultaneous recording, streaming and transcription jobs per room | integer (1–100) | `10` |
| clientMonitoring | Room information sent to media nodes with client samples | `object` | `roomInfo: false`, `obfuscateRoomName: false` |
| liveReload | Reload Prometheus listener/period settings when `config.json` changes; does not reload the main server | `boolean` | `false` |
| prometheus | prometheus exporter for rooms | `"object"` | |
| suspiciousClients | Write the addresses of clients that behave unusually to a file | `object` | off |

The reload-validation schema also accepts an optional `version` string, but the room server does not currently read it; setting it has no effect.

---
## Detailed configuration reference

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
  When enabled, changes to `config.json` reload Prometheus listener and refresh-period settings.
  The main room-server listener and room/media-node settings are not reloaded.

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
  Minimum interval between refreshing calculated room, peer and media-node metrics. Metrics are
  refreshed when Prometheus scrapes them; this setting does not run a background collection timer.

#### `prometheus.listener`

- **Type:** `array`
- **Description:**
  List of network listeners used to expose Prometheus metrics. Include this array whenever the
  `prometheus` object is present, even if `enabled` is `false`.

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

The main server reads `listenPort` and `listenHost` directly from the configuration file, so set both explicitly. The separate `ConfigLoader` uses an internal `listenPort` default of `8334` when validating configuration for Prometheus and reloads, but its parsed settings do not configure the main listener.

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
- **Example value:** `"0.0.0.0"`
- **Description:**
  Host or IP address the main server listens on.

### `listenPort`

- **Type:** `string`
- **Example value:** `"8443"`
- **Description:**
  Port used by the main server.

---

## TLS Configuration

### `tls`

Defines TLS settings for the main server. If `tls` is omitted, the server uses HTTP. When `tls` is
present, both `cert` and `key` are required for the configuration to validate.

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
  PEM-encoded public keys used to verify JWTs signed by the management server's private
  `authentication.secret`. Configure the matching public key from that key pair. The public key
  shipped in the examples is rejected and logged because its private key is also public. On Docker
  deployments, `utils/run-me-first.sh` generates a new pair. If no valid matching key is configured,
  management users are treated as guests and lose their owner permissions in managed rooms.

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
							{ "name": "SEND_CHAT" },
							{ "name": "SHARE_AUDIO" },
							{ "name": "SHARE_VIDEO" },
							{ "name": "SHARE_SCREEN" },
							{ "name": "SHARE_EXTRA_VIDEO" },
							{ "name": "SHARE_FILE" },
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

Every participant gets the permissions of this role. In an unmanaged room, every participant except the first is given this role alone. The first participant is made the room's moderator separately, with every permission except `BYPASS_ROOM_LOCK`. A signed-in first participant gets that one too. So whatever this role grants, every anonymous visitor with the room's URL gets. The shipped role grants participant permissions only: `SEND_CHAT`, `SHARE_AUDIO`, `SHARE_VIDEO`, `SHARE_SCREEN`, `SHARE_EXTRA_VIDEO`, `SHARE_FILE` and `CHANGE_ROOM`. A moderator can give a participant more during the meeting. Adding moderation or room-control permissions here (`MODERATE_ROOM`, `MODERATE_CHAT`, `MODERATE_FILES`, `CHANGE_ROOM_LOCK`, `PROMOTE_PEER`, `CREATE_ROOM`, `BYPASS_ROOM_LOCK`) lets anyone who joins mute, kick, unlock, admit from the lobby or close the meeting.

When the last participant holding `MODERATE_ROOM` leaves an unmanaged room, the participant who has been in the room longest becomes moderator the same way as the first one, so the room always has one. Everyone is told who the new moderator is.

A room that is open stays what it was opened as, managed or unmanaged. The room server therefore ends a meeting when that changes in the management server:

- A managed room is created under the name of an open unmanaged room. Otherwise whoever opened the name first would stay moderator, and the managed room's lock, owners, roles and meeting tokens would not apply.
- A managed room is deleted while its meeting is running.

The participants see that the meeting has ended. Whoever connects next opens the room as what it is now. After the room server has lost its connection to the management server, it compares every open room with the management server once, because changes made meanwhile are not sent again.

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

`MODIFY_ROLE` is declared but is not currently enforced; setting it does not let a participant
grant or revoke roles.

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
| `tracker` | `string` | WebTorrent tracker URL used for file sharing |
| `maxFileSize` | `integer` | Maximum uploaded file size in bytes. Default: `100,000,000` bytes (100 MB). |
| `endToEndEncryption` | `boolean` | Whether media in rooms is end-to-end encrypted by default. Requires a Chromium based browser; other browsers are refused entry to an encrypted room. |
| `reactionsEnabled` | `boolean` | Whether reactions are enabled by default (true if omitted) |

#### `endToEndEncryption` precedence

If a tenant enables `endToEndEncryptionLock`, its E2EE value is forced and per-room settings are
ignored. Otherwise, the effective value is resolved in this order: per-room setting, tenant default
when it is set, this room-server config value, then `false`. Only an unset value falls through, so
an explicit `false` at a higher level stops the resolution.

The room-server config value is used when neither the room nor its tenant has an E2EE value set, and
for unmanaged deployments. A tenant defaults row for other settings does not override this value
unless it also sets E2EE; an explicit tenant default of either `true` or `false` takes precedence.



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
| `ca` | `string` | Path to a PEM file with the CA certificate the media node's TLS certificate must chain to. Turns validation on. |
| `rejectUnauthorized` | `boolean` | Validate the media node's TLS certificate. Default: `true` when `ca` is set, otherwise `false`. |

The room server sends the media node's `secret` over this TLS connection. Without validation, someone on the network path between room server and media node can impersonate the node and read the secret, so the room server logs a warning at start for each such node.

**Strongly recommended:** configure both `rejectUnauthorized: true` and `ca` for every media node now. Set `ca` to a PEM certificate for the CA you trust to issue that node's certificate (or the self-signed node certificate itself). This makes the room server verify the node's identity and prevents an on-path attacker from reading the shared secret. Without either `ca` or explicit `rejectUnauthorized: true`, the current default does not validate; a later release will validate by default. Configuring verification now avoids relying on the insecure default and prepares deployments for that change. The node certificate must identify the configured `hostname` (as an IP address SAN when `hostname` is an IP address).

A self-signed certificate for a media node, made on the media node's host (replace the address with the node's `hostname`; use `subjectAltName=DNS:<name>` for a host name):

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 3650 \
  -subj '/CN=edumeet-media-node' -addext 'subjectAltName=IP:203.0.113.10' \
  -keyout key.pem -out cert.pem
```

Start the media node with `--cert cert.pem --key key.pem` and copy `cert.pem`, not the key, to the room server as that node's `ca`. If the `ca` file cannot be read, the room server logs an error and does not use the node; it does not fall back to an unvalidated connection. The edumeet and edumeet-docker compose setups make and pin such a certificate for the media node on the same host.

---

### TURN Ports

#### `mediaNodes[].turnports`

Defines TURN/TURNS listeners for NAT traversal. TURN is optional: the room server advertises TURN
URLs for a media node only when both `turnHostname` and at least one `turnports` entry are set.
Otherwise, it sends no TURN URLs for that node.

##### TURN Port Object

| Field | Type | Description |
|------|------|-------------|
| `protocol` | `string` | `turn` or `turns` |
| `port` | `number` | Port number |
| `transport` | `string` | `udp` or `tcp` |

---

## Media Node Region Binding

The room server supports restricting which media nodes a given tenant's rooms may use, based on a coarse "region" grouping (e.g. `EEA`, `UA`). This is opt-in — deployments that don't mix regions can skip this whole section and the routing behaviour stays identical to before.

### `countryToRegion`

- **Type:** `object` (map of 2-letter ISO country code → region label or array of region labels)
- **Description:** Maps the `country` field of each media node to one or more region labels. Region labels are deployment-defined strings; the only requirement is that they match the values selected by super-admins in the management UI's tenant editor (see `knownRegions` in the client config).

A country may belong to **multiple regions** (e.g. Germany simultaneously in the wider EEA bucket and the narrower DACH bucket). Express it by giving the country an array of labels; tenants then choose which of those buckets they accept.

```json
"countryToRegion": {
	"DE": [ "EEA", "DACH" ],
	"AT": [ "EEA", "DACH" ],
	"CH": "DACH",
	"FR": "EEA",
	"PL": "EEA",
	"UA": "UA"
}
```

In the example above:
- An EEA-only tenant (`['EEA']`) sees DE, AT, FR, PL — but not CH (Switzerland is not in EEA) and not UA.
- A DACH-only tenant (`['DACH']`) sees DE, AT, CH — but not FR, PL, UA.
- A tenant with `['EEA','DACH']` would see DE, AT, CH, FR, PL.

The single-string form (`"FR": "EEA"`) is the convenience shorthand for `[ "EEA" ]`.

A country missing from this map (or mapped to an empty array) resolves to the internal region `OTHER` and is excluded from any region-limited tenant's candidate set. The server logs a warning at startup if any configured media node has such a country.

### `defaultAllowedMediaNodeRegions`

- **Type:** `array of strings`
- **Description:** Fallback region restriction applied when:
  - the room's tenant has no `allowedMediaNodeRegions` set, **or**
  - the room could not be resolved to a tenant (unmanaged deployment, or FQDN not present in the tenant DB).

When unset, those cases fall through to "no restriction" (every media node is eligible). Multi-region deployments (e.g. an EU + UA fleet) should set this to a safe baseline so that an unconfigured tenant cannot accidentally land on a non-baseline node.

```jsonc
// PCSS-style multi-region deployment: unmanaged / unknown tenants stay in EEA.
"defaultAllowedMediaNodeRegions": ["EEA"]
```

```jsonc
// Single-region deployment: leave empty (or omit the field entirely).
"defaultAllowedMediaNodeRegions": []
```

### Per-tenant override

In the management server, each tenant can have an `allowedMediaNodeRegions` array (managed via the tenant editor in the client). When set and non-empty, it overrides the deployment-level default for rooms belonging to that tenant.

## Bot jobs

### `maxBotJobsPerRoom`

- **Type:** `integer` from 1 to 100, optional
- **Default:** `10`
- **Description:** How many server recordings, live streams and transcriptions one room may run at the same time, its breakout rooms included, for every provider together. It is also the most a tenant may have: a tenant's own `maxBotJobsPerRoom` in the management server, set in the tenant editor, can lower it for that tenant's rooms but not raise it, so a tenant value above this one counts as this one. To let tenants choose more, raise this value. The tenant's value is read when a room opens, so a change there applies to the next room; a change to this config value needs a restart of the room server. The limit is for new jobs: jobs that a restarted room server takes back from their provider go on even when the limit was lowered while they ran (up to 100 per room). A job that is still stopping counts towards the limit. A moderator who starts one more job gets a notice with the limit (with a client of the same release), and the provider is not called. When a provider answers a new job with `429`, the moderators are told the provider is busy.

```json
"maxBotJobsPerRoom": 20
```

## Client Monitoring

### `clientMonitoring`

- **Type:** `object`, optional
- **Description:** What the room server tells media nodes about a room, so that a node that stores client monitoring samples (see the [sample storage guide](https://github.com/edumeet/edumeet-media-node/blob/main/docs/sample-storage.md)) can file them per tenant and room. By default it tells them nothing: a media node knows a room only by the random id of the room session. Whether clients send samples at all is a client setting (`clientMonitor.samplingPeriodInMs`), and display names in the samples are a client matter too (`obfuscateDisplayName`).

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `roomInfo` | `boolean` | `false` | Send every media node a room uses the tenant host (the host name the room's first participant joined on) and a label for the room. |
| `obfuscateRoomName` | `boolean` | `false` | With `roomInfo` on, label the room by its session id instead of its name, so room names, which people choose freely, never reach a media node or its sample storage. |

```json
"clientMonitoring": {
	"roomInfo": true,
	"obfuscateRoomName": true
}
```

Media nodes can be run by other organisations, which is why this is opt-in. It applies to end-to-end encrypted rooms like any other.

## Suspicious clients

### `suspiciousClients`

- **Type:** `object`, optional
- **Default:** off
- **Description:** The room-server writes client addresses to a file when clients repeatedly open
  short connections, hit a server-side limit (including when a session recovery is refused), or
  stop reading data sent to them. It does not block clients. Operators decide what to do with the
  file, for example a temporary firewall ban.

| Field | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `file` | `string` | | The file that the lines are appended to. Without it, the function is off. |
| `windowSeconds` | `integer` | `300` | The length of the time window in which events are counted. |
| `shortConnectionSeconds` | `integer` | `10` | A connection that received the state of a room and lasted less than this counts as short. |
| `maxShortConnections` | `integer` | `200` | Write a line when one address has more than this many short connections in a window. |
| `maxLimitHits` | `integer` | `10` | Write a line when one address triggers a server-side limit more than this many times in a window. Refused session recoveries count as limit hits. |

```json
"suspiciousClients": {
	"file": "/usr/src/app/suspicious/suspicious-ips.log"
}
```

The room-server writes at most one line for each address in each window. Each line starts with the time (UTC, ISO 8601) and the address. The counts follow:

```
2026-11-12T11:05:00.000Z 203.0.113.7 short_connections=201 limit_hits=0 window=300s
```

The address is the client address that the room-server also uses for bot tokens (see [Bots](bots.md)). The room-server must see the real address of each client: the reverse proxy is listed in `trustedProxies` and overwrites `x-forwarded-for`, and clients reach the room-server only through the proxy.

With Docker, mount a folder of the host and put the file in it:

```yaml
volumes:
  - ./data/suspicious:/usr/src/app/suspicious
```

Use the UID and GID of the running image's process to set ownership of the folder before the container starts. Do not assume one UID across image versions. If Docker makes the folder, root owns it, and the room-server cannot write the file.

The file only grows. Rotate it on the host, for example with logrotate.

One address can be many people: a university network, or a mobile network that puts many users behind one address. A ban stops all of them. Look at the file for some time before a tool acts on it, and keep the settings high and the bans short. For a complete setup with logrotate and fail2ban, also when the reverse proxy runs in Docker, see [SUSPICIOUS-CLIENTS.md](https://github.com/edumeet/edumeet/blob/main/SUSPICIOUS-CLIENTS.md) in the edumeet repository.
