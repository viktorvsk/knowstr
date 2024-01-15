import redisClient from "./redis.js";

import RelayExtractor from "./relay_extractor.js";
import { ts } from "./utils.js";
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
  redis_lock_timeout,
} from "./settings.js";

const NEW_RELAY_PARAMS = {
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

/** Represents a Relay model and manages its state in Redis **/
class Relay {
  /**
   * constructor description
   * @param {string} id base64 representation of URL
   */
  constructor(id) {
    this.id = id;
  }

  /**
   * @param {string} ip
   * Saves relay IP once connection established */
  async setIp(ip) {
    return redisClient.HSET(`relay:${this.id}`, "ip", ip);
  }

  /** Indicate that relay currently has active connection **/
  async connect() {
    const promises = [redisClient.sendCommand(["ZADD", "zconnections", ts().toString(), this.id])];

    if (this.lastSeenPastEventCreatedAt && this.lastSeenPastEventCreatedAt != this.data.last_seen_past_event_created_at) {
      promises.push(redisClient.HSET(`relay:${this.id}`, "last_seen_past_event_created_at", this.lastSeenPastEventCreatedAt));
    }

    return Promise.all(promises);
  }

  /** Indicate that relay currently has no active connection **/
  async disconnect() {
    return Promise.all([
      redisClient.sendCommand(["ZREM", "zconnections", this.id]),
      redisClient.HSET(`relay:${this.id}`, "last_seen_past_event_created_at", (this.lastSeenPastEventCreatedAt || ts()).toString()),
    ]);
  }

  /** Deactivate relay to prevent Workers from trying to start crawling it **/
  async deactivate() {
    return Promise.all([redisClient.HSET(`relay:${this.id}`, "active", "0"), redisClient.SREM("active_relays_ids", this.id)]);
  }

  /** Turn OFF crawling past events in case if the end of events stored on relay was reached **/
  async turnOffPast() {
    return redisClient.HSET(`relay:${this.id}`, "should_load_past", "0");
  }

  /** @param {Error} error
   * Increment number of failed attempts in Redis HASH named `relays_fail`
   * and record error's `name` and `message` in Redis SET named `relays_error:${this.id}`
   **/
  async failed(error) {
    const errorString = JSON.stringify({
      name: error.name,
      message: error.message,
    });

    return Promise.all([redisClient.HINCRBY("relays_fail", this.id, 1), redisClient.SADD(`relays_error:${this.id}`, errorString)]);
  }

  /** Extract URLs from nostr events based on kinds and other rules
   * implemented in RelayExtractor class. Store new relays from those URLs which
   * could optionally become active if set in global settings. Redis keys used:
   * - HASH `relay:ID` for new relays
   * - SET `known_relays_ids` to register new relays
   * - SET `active_relays_ids` in case new relays are created active
   * @param {Object[]} events list of nostr events
   */
  async extractAndSaveUrls(events) {
    const urls = RelayExtractor.perform(events);
    return new Promise(async (resolve, reject) => {
      const toCreateRelays = [];
      const results = await Promise.all(urls.map((url) => redisClient.sendCommand(["HSETNX", `relay:${btoa(url)}`, "url", url])));

      results.forEach((value, index) => {
        if (value == 1) {
          toCreateRelays.push(urls[index]);
        }
      });
      const relaysCMD = toCreateRelays.map((url) => redisClient.HSET(`relay:${btoa(url)}`, Object.entries({ ...NEW_RELAY_PARAMS, url: url })));
      const activeRelaysIdsCMD = NEW_RELAY_PARAMS.active == 1 ? toCreateRelays.map((url) => redisClient.SADD("active_relays_ids", btoa(url))) : [];
      const knownRelaysCMD = toCreateRelays.map((url) => redisClient.SADD("known_relays_ids", btoa(url)));
      await Promise.allSettled([...relaysCMD, ...activeRelaysIdsCMD, ...knownRelaysCMD]);

      resolve(toCreateRelays);
    });
  }

  /** Receives a list of nostr events and checks against IDs stored in Redis
   * using SET command with NX EX modifiers. Events with ids already stored in Redis
   * are removed from resulting set. New ids are locked in Redis for a duration specified in the settings.
   * Events that became locked in Redis are returned
   * @param {Object[]} events list of nostr events
   * @return {Promise<Object[]>} list of new nostr events
   */
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

  /** Lock events ids that were successfully stored in Pulsar
   * @param {string[]} ids list of nostr events ids
   */
  async permanentlyLock(ids) {
    return Promise.all(ids.map((eid) => redisClient.set(`id:${eid}`, ts().toString())));
  }

  /** Record nostr events ids as seen towards this Relay using Redis HLL key `relay_events_hll:${this.id}`
   * Which lets analyze later how many events each relay has without having to store duplicates
   * @param {string[]} ids list of nostr events ids
   */
  async countSeen(ids) {
    const promises = ids.map((eid) => redisClient.pfAdd(`relay_events_hll:${this.id}`, eid));
    promises.push(redisClient.INCRBY("totalevents", ids.length));

    return Promise.all(promises);
  }

  /** Fetch data for this relay stored in Redis. It does not update data nor makes
   * a new request to Redis in case it was already loaded before.
   */
  async fetch() {
    if (this.data) {
      return this.data;
    }

    return new Promise(async (resolve, reject) => {
      this.data = await redisClient.HGETALL(`relay:${this.id}`);
      this.data = { ...NEW_RELAY_PARAMS, ...this.data };
      const isFirstRun = typeof this.data.last_seen_past_event_created_at === "undefined";
      this.lastSeenPastEventCreatedAt = isFirstRun ? -1 : this.data.last_seen_past_event_created_at;

      resolve(this.data);
    });
  }

  /** Update this.lastSeenPastEventCreatedAt to current timestamp
   */
  touchLastSeenPastEventCreatedAt() {
    return (this.lastSeenPastEventCreatedAt = ts());
  }

  /** Future filters in nostr format (using current timestamp) */
  futureFilters() {
    return JSON.parse(this.data.future_filters).map((f) => ({
      ...f,
      since: ts(),
    }));
  }

  /** Past filters in nostr format (using timestamp saved in `this.lastSeenPastEventCreatedAt`) */
  pastFilters() {
    return JSON.parse(this.data.past_filters).map((f) => ({
      ...f,
      until: parseInt(this.lastSeenPastEventCreatedAt),
    }));
  }
}

export default Relay;
