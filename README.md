# Knowstr

Knowstr knows which events are happening on Nostr, and you could too. Main goal is to allow anyone to obtain exact set of events they desire. This is achieved in multiple steps:

- Choose which relays to get events from
- For each relay decide which filters to apply separately to events that are already stored there (past) and those that you get while subscribed
- On receiving events from a relay, validate their signature and (optionally) decide how you want to validate event payload. For instance, NIP-01 defines `#e` and `#p` tags must refer to event id and pubkey and consist of `<32-bytes lowercase hex of the id of another event>`. However, event with an `#e` tag equal to `HELLO WORLD` would technically be a valid nostr event if signed correctly. You should be able to define your own rules on what events are valid and what are not (note, this is a work in progress currently)
- Next, Knowstr deduplicates valid events received from different relays and only stores unique ones
- This process is eventually consistent, self healing and lets you manage most of the option through UI or convenient REST API
- When you have a set (or rather a stream if you don't stop the process) of events you want to knowstr, you should be able to conveniently process those events from start to finish as many times as you want, for example in order to fill different niche relays with events you pick on your own, or to train your personal machine learning model

## Gettings started

Clone the project and run docker compose

```
docker-compose up
```

Ensure your docker user has correct permissions for directories where container's data stored: `./docker/redis-data`, `./docker/zookeeper-data`, `./docker/bookkeeper-data`. This will launch all the services required for development locally:

- [Redis](https://redis.io) (standalone) — as the main storage for settings, relays and events ids (for deduplication)
- [Apache Pulsar](https://pulsar.apache.org) — that consists of services `bookie`, `broker`, `zookeeper` and `pulsar-init` to store events stream
- [Apache Pulsar Manager](https://github.com/apache/pulsar-manager) — that consists of `dashboard` and `dashboard-setup` containers to conveniently manage Apache Pulsar cluster configuration
- Knowstr Scheduler — which is responsible for monitoring workers, assigning relays to them and cleaning up resources
- Knowstr Worker — which is responsible for gettings events from multiple relays
- Knowstr Web — which is an admin interface to manage Knowstr
- `reader` — which is an [example](examples/reader) of how to actually use events stream and by default it fills Redis with events already stored in Apache Pulsar
- `traefik` - which is used here as a tool to protect `web` admin interface with Basic Auth

When ready, open `http://localhost:3001` in browser. It will ask for Basic Authentication:

- **username**: knowstr
- **password**: knowstr

This will get you to knowstr `web` admin interface you can further setup completely with UI.

At `http://localhost:9527` Pulsar Manager is available. Use the same credentials for username and password.

**NOTE**: Only use this setup locally, change all the passwords if exposed to internet.

Feel free to explore `docker-compose.yml` to see how things actually work together. There are a lot of ways on how to deploy it to production including managed services for Redis and Apache Pulsar.

See [docs](docs) for more information.
