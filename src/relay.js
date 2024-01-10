import redisClient from "./redis.js";
import { ts } from "./utils.js";
import { redis_lock_timeout } from "./settings.js";
import {
  relay_default_max_server_latency,
  relay_default_handshake_timeout,
  relay_default_past_filters,
  relay_default_future_filters,
  relay_default_active,
  relay_default_should_load_past,
  relay_default_should_load_future,
  relay_default_should_load_past_again,
  relay_default_eose_delay,
  relay_default_event_delay,
  relay_default_ping_interval,
} from "./settings.js";

export default class Relay {
  static #defaultRelayParams = {
    past_filters: relay_default_past_filters,
    future_filters: relay_default_future_filters,
    active: relay_default_active,
    should_load_past: relay_default_should_load_past,
    should_load_future: relay_default_should_load_future,
    should_load_past_again: relay_default_should_load_past_again,
    eose_delay: relay_default_eose_delay,
    event_delay: relay_default_event_delay,
    handshake_timeout: relay_default_handshake_timeout,
    max_server_latency: relay_default_max_server_latency,
    ping_interval: relay_default_ping_interval,
  };
  constructor(id) {
    this.id = id;
  }

  static async setIp({ id, ip }) {
    return redisClient.HSET(`relay:${id}`, "ip", ip);
  }

  static async find(url) {
    const instance = new Relay(btoa(url));
    await instance.fetch();
    return instance;
  }

  static async connect(id) {
    return redisClient.SADD("connections", id);
  }

  static async disconnect({ id, lastSeenPastEventCreatedAt }) {
    return Promise.all([redisClient.SREM("connections", id), redisClient.HSET(`relay:${id}`, "last_seen_past_event_created_at", (lastSeenPastEventCreatedAt || ts()).toString())]);
  }

  static async deactivate(id) {
    return Promise.all([redisClient.HSET(`relay:${id}`, "active", "0"), redisClient.SREM("active_relays_ids", id)]);
  }

  static async turnOffPast(id) {
    return redisClient.HSET(`relay:${id}`, "should_load_past", "0");
  }

  static async activate(id) {
    return Promise.all([redisClient.HSET(`relay:${id}`, "active", "1"), redisClient.SADD("active_relays_ids", id)]);
  }

  static async failed({ id, error }) {
    const promises = [];

    if (error) {
      let err = ((err) =>
        JSON.stringify(
          Object.getOwnPropertyNames(Object.getPrototypeOf(err)).reduce(function (accumulator, currentValue) {
            return (accumulator[currentValue] = err[currentValue]), accumulator;
          }, {}),
        ))(error);
      if (err !== "{}") {
        promises.push(redisClient.HINCRBY("relays_fail", id, 1).catch(console.error));
        promises.push(redisClient.SADD(`relays_error:${id}`, err).catch(console.error));
      }
    }

    return Promise.all(promises);
  }

  async createFromUrlsList(urls) {
    return new Promise(async (resolve, reject) => {
      const toCreateRelays = [];
      const results = await Promise.all(urls.map((url) => redisClient.sendCommand(["HSETNX", `relay:${btoa(url)}`, "url", url])));

      results.forEach((value, index) => {
        if (value == 1) {
          toCreateRelays.push(urls[index]);
        }
      });
      const relaysCMD = toCreateRelays.map((url) => redisClient.HSET(`relay:${btoa(url)}`, Object.entries({ ...Relay.#defaultRelayParams, url: url })));
      const activeRelaysIdsCMD = Relay.#defaultRelayParams.active == 1 ? toCreateRelays.map((url) => redisClient.SADD("active_relays_ids", btoa(url))) : [];
      const knownRelaysCMD = toCreateRelays.map((url) => redisClient.SADD("known_relays_ids", btoa(url)));
      await Promise.allSettled([...relaysCMD, ...activeRelaysIdsCMD, ...knownRelaysCMD]);

      resolve(toCreateRelays);
    });
  }

  async discardSeenLockNewEventsFrom(events) {
    return new Promise(async (resolve, reject) => {
      const newEvents = [];
      const results = await Promise.all(events.map((e) => redisClient.sendCommand(["SET", `id:${e.id}`, ts().toString(), "NX", "EX", redis_lock_timeout])));
      results.forEach((value, index) => {
        if (value === "OK") {
          newEvents.push(events[index]);
        }
      });
      resolve(newEvents);
    });
  }

  async permanentLockFor(events) {
    const promises = events.map((e) => [redisClient.set(`id:${e.id}`, ts().toString()), redisClient.pfAdd(`relay_events_hll:${this.id}`, e.id)]);

    return Promise.all(promises.flat());
  }

  async fetch() {
    if (this.data) {
      return this.data;
    }

    return new Promise(async (resolve, reject) => {
      this.data = await redisClient.HGETALL(`relay:${this.id}`);
      this.data = { ...Relay.#defaultRelayParams, ...this.data };
      const isFirstRun = typeof this.data.last_seen_past_event_created_at === "undefined";
      this.lastSeenPastEventCreatedAt = isFirstRun ? -1 : this.data.last_seen_past_event_created_at;

      resolve(this.data);
    });
  }

  touchLastSeenPastEventCreatedAt() {
    return (this.lastSeenPastEventCreatedAt = ts());
  }

  futureFilters() {
    return JSON.parse(this.data.future_filters).map((f) => ({
      ...f,
      since: ts(),
    }));
  }

  pastFilters() {
    return JSON.parse(this.data.past_filters).map((f) => ({
      ...f,
      until: parseInt(this.lastSeenPastEventCreatedAt),
    }));
  }
}
