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
