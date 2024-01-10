# Knowstr

```
NBP_PULSAR_ADVERTISED_ADDRESS=localhost NBP_PULSAR_ADVERTISED_LISTENERS=internal:pulsar://broker:6650,external:pulsar://localhost:6650 NBP_PULSAR_INTERNAL_LISTENER_NAME=internal docker compose up bookie zookeeper broker
NBP_PULSAR_ADVERTISED_ADDRESS=localhost NBP_PULSAR_ADVERTISED_LISTENERS=internal:pulsar://localhost:6650 NBP_PULSAR_INTERNAL_LISTENER_NAME=internal docker compose up bookie zookeeper broker
```