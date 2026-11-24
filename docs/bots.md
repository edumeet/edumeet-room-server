# Bots (recorders, streamers and transcribers)

A connection with `headless=1` in the query is a bot (a recorder, streamer or transcriber page). It is refused unless the room is open with at least one participant in it. Inside a tenant the room-server asks the management server's `bot-verify` service, sending the tenant, the bot token from the socket handshake `auth` payload (the client reads it from the URL fragment; it is not sent as a query parameter) and the client address; the management server applies the tenant's bot policy, the token and its allowed address ranges. A management server without that service makes the room-server refuse every bot in a tenant, so upgrade the management server first. Outside a tenant, bots are admitted without a token.

A bot sends nothing but one thing: when the deployment collects client monitoring samples, a bot sends its samples like any client, over the one data channel a bot may open (`observertc-samples`, which goes to the media node and is never handed to another peer). Its samples carry `headless: true`; they include `botType` only when the page was given one (a provider bot that handles several job types has none), and `botId` when it runs provider jobs. This keeps a recorder's figures separate from a participant's. The samples describe the receiving side: what the recorder actually got.

A bot records one session. A connection with `session=<breakout session id>` in the query is placed in that breakout room at join, whether or not anyone is in it yet; it is refused with `sessionNotOpen` when no such breakout room exists, and it is ended with `sessionClosed` when the breakout room is removed or ejected, while the participants are moved back to the main room as before. A moderator cannot move a bot between sessions. The join response carries the peer's actual `sessionId`.

The client address is the first entry of `x-forwarded-for` when the connection comes from one of the `trustedProxies`, and the socket address otherwise. The proxy configuration shipped with edumeet-docker overwrites that header with the PROXY-protocol address for the room-server, so a client cannot supply it; a proxy that appends to the header instead must be configured to overwrite it, or the address ranges of the bot tokens cannot be trusted.

### Bot jobs

A tenant can let moderators start a recording, a live stream or a transcription from inside the
room. The work is done by an outside service, a **provider**, which the tenant configures in the
management server: one row per provider, holding the kinds of job it offers, the bot access token,
the provider's https API address and the API key it issued. The contract that service implements is
[BOT-PROVIDER-API.md](https://github.com/edumeet/edumeet/blob/main/BOT-PROVIDER-API.md).

The room-server reads its tenant's providers once, when the room is created, alongside the room
itself, and keeps them for as long as the room lives: later changes in the management server apply
to the next room. A failure to read them, an older management server without the `bot-providers`
service, a room outside a tenant, or a deployment without a management server all mean the same
thing, no providers, and then there is no job API and no buttons in the room. A room that is not
claimed in the management (no `managedId`) gets no providers on join either, and
`moderator:startBotJob` there answers `room not managed`: in such a room the first participant has
every permission, so anyone signed in could otherwise record a room nobody owns. Stopping a job is
still allowed. Nothing else about bots changes: a bot started by hand works as before.

Requests, all of them needing `MODERATE_ROOM` and a signed-in peer (one with a `managedId`, since the
recording is delivered to people by their accounts): `moderator:startBotJob` with the job type and,
when the tenant has several providers of that type, which one; `moderator:stopBotJob` with the job id. A
job runs in the session the moderator was in when starting it, so a moderator in a breakout room
records that breakout room, and a session runs at most one job of each kind (`bot job already
running`). Starting answers immediately with the job id and calls the provider behind the answer.

A provider sends **one bot per session**, and that bot does every job of that provider there: the
room-server gives each bot an id of its own, sends it with every job, and a second kind started in a
session where the provider's bot is already present goes to that bot, which takes it on at once.
Stopping one job ends that job at the provider and leaves the bot for the others; the bot leaves with
its last job. A job that comes while its bot is leaving gets a new bot. A bot of a provider that
offers more than one kind is sent without a `botType`, so it takes audio and video, since it may be
asked to record later; only a transcription-only provider's bot is told it is a transcriber and takes
audio alone. The participants of a session are told about its jobs with `botJobs` (each with its kind, the
provider's label and the provider's id, so a client can tell which jobs share a bot), and
moderators are told about a failure with `botJobFailed`; neither carries the provider's address or
key. A room runs at most `maxBotJobsPerRoom` jobs at once (see [Bot jobs](#bot-jobs)).

The start call carries `room.mainSessionId`, the main room's session, on every job, the same for a
job in a breakout room of that meeting, so a provider can group the recordings of one meeting.
It also carries the people to tell about the recording: the owners of the room (known since
the room was created) and the moderator who started the job, resolved to addresses with one
`users.find` by id in the management server, each address once; a lookup that fails leaves the job
running without recipients. It also carries the tenant's `locale`, read with the tenant when the room
was created. A transcriber page declares no video capability, so no video consumer is created for it.

The room-server calls a provider twice per job, to start it and to stop it, and learns everything
in between from the bot's own connection: joining, the `botStatus` notification the page sends, and
leaving. The join, running, heartbeat, reconnect and leave timers of the provider contract belong to
the bot, and every job of a bot shows the bot's state. `botStatus` with `finished` or `failed` and a
`type` is about that one kind of job, which ends (`finished`, nothing is sent to the provider) or
fails (the provider is told to stop it, the moderators are told); without a `type` it is about the
whole bot and every job it runs. A status naming a kind the bot does not run is ignored. Provider
calls use HTTPS with certificate validation, reject redirects and time out after 10 seconds.
Failures and job metadata are logged, but not the request body or API key. A failure is logged at
info level with the room, the job or bot, its kinds, the credential and the reason, noting whether
the bot reported it; a bot that fails as a whole tells the moderators once.

Every bot page reports itself running every 20 seconds (`botStatus`); a bot that runs no jobs
here is heard and ignored, so its reports do not reach the log. A bot page carries its bot id in
the query (`botId`). Only a bot whose token the management server
verified may carry one, and only for a bot started with that same credential. A bot already
finished is refused with `jobNotActive`, as is a second page for a bot whose browser is connected; a
page that reloads takes its bot back over. A bot id the room-server does not know, from a verified
bot of one of the room's providers, is the one case where the room-server reads an answer from a
provider: it asks `GET /v1/bots/<botId>?host=<host>&roomId=<room>` once which jobs that bot runs
in this room, and recreates them (at most
one per kind, only kinds the provider offers, and no job it already knows). A provider that knows
none, cannot be reached, or answers nonsense gets its bot refused with `jobNotActive`, and the bot id
is remembered so it is not asked again. This is how jobs survive a restart of the room-server, which
for that reason never tells providers to stop when it shuts down.
