# Deployment

TBD

## Local Development

Make default Apache Pulsar deployment included in `docker-compose.yaml` available to host machine (example is provided for MacOS, needs to be verified on linux) by providing next ENV variables:

```
KNOWSTR_PULSAR_ADVERTISED_ADDRESS=localhost KNOWSTR_PULSAR_ADVERTISED_LISTENERS=internal:pulsar://localhost:6650 KNOWSTR_PULSAR_INTERNAL_LISTENER_NAME=internal docker compose up bookie zookeeper broker
```
