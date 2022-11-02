# Edumeet room server configuration

The configuration is in the `config/` folder and you make a file called `config.json` there.
An example configuration file with all properties set to default values
can be found here: [config.example.json](config/config.example.json).

## Configuration properties

| Name | Description | Format | Default value |
| :--- | :---------- | :----- | :------------ |
| listenPort | Socket port to listen on | `"port"` | ``8443`` |
| listenHost | Ip/address the server will listen on | `"string"` | ``0.0.0.0``
| tls | TLS configuration for the server | `object` | ``{ "cert": "./certs edumeet-demo-cert.pem", "key": "./certs/edumeet-demo-key.pem"}`` |
| mediaNodes | Array of media nodes to use | `array` | ``[ { "host": "localhost", "port": 3001 } ]`` |
---

## Running the server

To run the server you need to have Node.js version 18 or higher installed.

Install the dependencies with `yarn install` and then run the server with `yarn start`.

If you want some debug output, you can run the server with `DEBUG=edumeet-room-server:* yarn start`.