import WebSocket from "ws";
import Relay from "./relay.js";
import NostrMessage from "./nostr_message.js";
import Pulsar from "./pulsar.js";
import { relay_future_events_flush_interval } from "./settings.js";

const TERMINATE_DELAY = 1000;

/** Represents the main unit of work that is called by Worker. Manages Relay
 * lifecycly: connect, handle messages, handle errors, disconnect etc
 */
class RelayCrawler {
  /** @param {string} id base64 representation of Relay URL */
  constructor(id) {
    this.id = id;
    this.relay = new Relay(id);
    this.currentEvents = [];
    this.futureEvents = [];
    this.active = false;
    this.starting = false;
    this.stopping = false;
  }

  /** Defines if a relay should be started at next Worker tick */
  shouldStart() {
    return !this.stopping && !this.starting && !this.active;
  }

  /** Gracefully stop Relay Crawler by saving state, closing websocket connection and cleaning resources in Redis  */
  async stop() {
    if (this.stopping) {
      return;
    }

    this.stopping = true;

    switch (this.ws?.readyState) {
      case WebSocket.CONNECTING:
        // this.ws.terminate();
        break;
      case WebSocket.OPEN:
        this.ws.close();
        // this.terminateDelayTimeout = setTimeout(() => {
        //   this.ws?.terminate();
        // }, TERMINATE_DELAY);
        break;
      case WebSocket.CLOSING:
        // this.terminateDelayTimeout = setTimeout(() => {
        //   this.ws?.terminate();
        // }, TERMINATE_DELAY);
        break;
      case WebSocket.CLOSED:
        break;
      default:
        this.ws?.terminate();
        break;
    }

    clearTimeout(this.pingTimeout);
    clearInterval(this.aliveInterval);
    clearInterval(this.futureEventsStoreInterval);

    return new Promise(async (resolve, reject) => {
      const disconnected = await this.relay.disconnect().catch(console.error);

      this.ws = undefined;
      this.pulsar = undefined;
      this.stopping = false;
      this.starting = false;
      this.active = false;
      resolve(disconnected);
    });
  }

  /** While past events are stored when EOSE is received, future events stored by timer */
  async storeFutureEvents() {
    if (this.futureEvents.length) {
      return await this.processEventsBatch(this.futureEvents);
    }
  }

  /** Start crawling a relay: open websocket connection, manage state in redis, handle incoming messages */
  async start() {
    if (!this.shouldStart()) {
      return;
    }

    this.starting = true;

    await this.relay.fetch();

    this.futureEventsStoreInterval = setInterval(this.storeFutureEvents.bind(this), relay_future_events_flush_interval);

    this.ws = new WebSocket(atob(this.id), [], {
      handshakeTimeout: parseInt(this.relay.data.handshake_timeout),
      followRedirects: process.env.KNOWSTR_FOLLOW_REDIRECTS === "true",
      maxRedirects: parseInt(process.env.KNOWSTR_MAX_REDIRECTS || 10),
    });

    this.ws.on("open", this.onConnect.bind(this));
    this.ws.on("ping", this.onPing.bind(this));
    this.ws.on("close", this.onClose.bind(this));
    this.ws.on("message", this.onMessage.bind(this));
    this.ws.on("error", this.onError.bind(this));
    this.ws.on("unexpected-response", this.onBadResponse.bind(this));
    this.ws.on("upgrade", this.onUpgrade.bind(this));
  }

  /** Save error to Redis and stop relay crawler
   * @param {Error} error */
  async fail(error) {
    if (this.stopping) {
      return;
    }

    return Promise.allSettled([this.relay.failed(error), this.stop()]);
  }

  /** When 'upgrade' is received, IP address is stored
   * @param {http.Response} */
  async onUpgrade(res) {
    await this.relay.setIp(res.socket.remoteAddress);
  }

  /** Handle errors by failing the crawler or just stopping it
   * @param {Error} error */
  async onError(error) {
    if (this.stopping) {
      return;
    }
    const softErrors = []; //["Opening handshake has timed out", "Server closed connection, reason:"],

    if (softErrors.includes(error.message?.trim())) {
      await this.stop();
    } else {
      await this.fail(error);
    }
  }

  /** Callback fired when server performs ping(). It is possible to configure per relay
   * to stop crawler in case ping was not received for specified amount of time using
   * Max Server Latency option (0 means never stop crawler if server does not send ping in time).
   * Note, not all servers implement ping correctly */
  onPing() {
    if (this.stopping) {
      return;
    }
    clearTimeout(this.pingTimeout);

    if (this.relay.data.max_server_latency > 0) {
      // Use `WebSocket#terminate()`, which immediately destroys the connection,
      // instead of `WebSocket#close()`, which waits for the close timer.
      // Delay should be equal to the interval at which your server
      // sends out pings plus a conservative assumption of the latency.
      this.pingTimeout = setTimeout(async () => {
        await this.stop();
      }, this.relay.data.max_server_latency);
    }
  }

  /** Send JSON to the relay
   * @param {object} payload Nostr command from client to relay*/
  send(payload) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    return this.ws.send(JSON.stringify(payload));
  }

  /** Handle bad responses from relays like 500, 404 etc */
  async onBadResponse(request, response) {
    await this.fail(new Error(`Unexpected server response: ${response.statusCode}`));
  }

  /** Handles close event either from server or due to internal/unknown error.
   * Fail, deactivate and stop relay in case 4000 code received
   * @param {Number} code
   * @param {string} reason */
  async onClose(code, reason) {
    clearTimeout(this.terminateDelayTimeout);

    switch (code) {
      case 4000:
        // First it was a thing https://github.com/nostr-protocol/nips/commit/36e9fd59e93730c2d2002ec7aac58a53e58143a3
        // then it was removed https://github.com/nostr-protocol/nips/commit/0ba4589550858bb86ed533f90054bfc642aa5350
        await Promise.all([this.relay.failed(new Error(`Server closed connection, reason: ${reason}`)), this.relay.deactivate(), this.stop()]);
        break;
      default:
        await this.stop();
    }
  }

  /** When connection is successfully established, start recurring ping from client to server.
   * Handle relay state in Redis. If past or future crawling is enabled, send corresponding commands to relay
   * If past and future crawling is disabled, deactivate relay */
  async onConnect() {
    const hasNothingToDO = this.relay.data.should_load_past == 0 && this.relay.data.should_load_future == 0 && this.relay.data.should_load_past_again == 0;

    clearInterval(this.aliveInterval);

    this.aliveInterval = setInterval(async () => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
        await this.relay.connect();
      }
    }, this.relay.data.ping_interval);

    await this.relay.connect();

    this.pulsar = new Pulsar();

    if (this.relay.data.should_load_future == 1) {
      this.send(["REQ", "FUTURE", ...this.relay.futureFilters()]);
    }

    if (this.relay.data.should_load_past == 1 && this.relay.lastSeenPastEventCreatedAt !== 0) {
      if (this.relay.lastSeenPastEventCreatedAt === -1) {
        this.relay.touchLastSeenPastEventCreatedAt();
      }
      this.send(["REQ", `PAST_${this.relay.lastSeenPastEventCreatedAt}`, ...this.relay.pastFilters()]);
    }

    this.starting = false;
    this.active = true;

    if (hasNothingToDO) {
      await Promise.all([this.relay.deactivate(), this.stop()]);
    }
  }

  /** Process relay messages according to Nostr/NIPs rules
   * @param {string} data Nostr command sent by relay*/
  async onMessage(data) {
    if (this.starting || this.stopping || !this.active) {
      return;
    }

    const nostrMessage = NostrMessage.parse(data);
    if (!nostrMessage.isValid) {
      return;
    }

    switch (nostrMessage.command) {
      case "AUTH":
        // TODO: Authenticate based on relay settings
        break;
      case "NOTICE":
      case "OK":
      case "COUNT":
        break;
      case "CLOSED":
        await Promise.all([this.relay.failed(new Error(`[CLOSED_EVENT]: ${data}`)), this.stop()]);
        break;
      case "EOSE":
        this.handleEOSE(nostrMessage.sid);
        break;
      case "EVENT":
        if (this.relay.data.event_delay > 0) {
          await new Promise((r) => setTimeout(r, this.relay.data.event_delay));
        }

        if (nostrMessage.sid === "FUTURE") {
          this.futureEvents.push(nostrMessage.event);
        } else {
          this.currentEvents.push(nostrMessage.event);
        }
        break;
      default:
        const error = new Error(`Unknown message: ${data}`);
        await this.fail(error);
    }
  }

  /** Process events batch (either past or future) by rejecting known events,
   * locking new events, trying to store them in Pulsar and permanently mark events
   * as known in case of success.
   * @param {object[]} events list of Nostr events found by either future or past subscription */
  async processEventsBatch(events) {
    if (this.starting || this.stopping || !this.active) {
      return false;
    }

    return new Promise(async (resolve, reject) => {
      let result;
      const promises = [this.relay.countSeen(events.map((e) => e.id)), this.relay.extractAndSaveUrls(events)];

      const newEvents = await this.relay.discardSeenLockNewEventsFrom(events);
      const pulsarResponse = await this.pulsar.store(newEvents);
      if (pulsarResponse.ok) {
        promises.push(this.relay.permanentlyLock(newEvents.map((e) => e.id)));

        result = true;
      } else {
        // TODO: handle error
        promises.push(this.stop());

        result = false;
      }

      await Promise.all(promises);

      resolve(result);
    });
  }

  /** Ignores future EOSE. For past EOSE processes collected events batch.
   * In case of success sends request for next page. Manages lastSeenPastEventCreatedAt state in Redis
   * @param {string} sid subscription_id related to this EOSE event */
  async handleEOSE(sid) {
    if (this.starting || this.stopping || !this.active) {
      return;
    }

    if (sid === "FUTURE") {
      return;
    }

    this.send(["CLOSE", sid]);

    if (this.relay.data.should_load_past != 1) {
      return;
    }

    const isBatchSaved = await this.processEventsBatch(this.currentEvents);

    // We don't want to update Last Seen unless events saved correctly
    if (!isBatchSaved) {
      return;
    }

    // If we didn't find events (there are no more), we set Last Seen to 0, which later means END REACHED
    // If there are events, we take minimum created_at
    const currentLastSeenCreatedAt = this.currentEvents.length ? Math.min(...this.currentEvents.map((e) => e.created_at)) : 0;

    // Just in case we check that new minimum is smaller than existing minimum
    this.relay.lastSeenPastEventCreatedAt = Math.min(this.relay.lastSeenPastEventCreatedAt, currentLastSeenCreatedAt);

    // If Last Seen equals to what we requested in PAST_${TIMESTAMP}, then we set Last Seen to 0 in case no events present
    // If in this case there are still events present it may mean that for this specific SECOND in filter there are more events than LIMIT
    // In this (very rare) case we decrement TIMESTAMP by 1 second, meaning we can skip some events
    // There is no way to detect this and to fetch except for building manual fitlers based on different params
    if (parseInt(sid.substring(5)) === currentLastSeenCreatedAt) {
      this.relay.lastSeenPastEventCreatedAt = this.currentEvents.length === 0 ? 0 : currentLastSeenCreatedAt - 1;
    }

    // If END REACHED we either start again if configured accordingly
    // or turn off PAST filters
    if (this.relay.lastSeenPastEventCreatedAt === 0) {
      if (this.relay.data.should_load_past_again == 1) {
        this.relay.touchLastSeenPastEventCreatedAt();
      } else {
        await this.relay.turnOffPast();
        return;
      }
    }

    // We may configure artificial SLEEP on each EOSE in order to process different
    // relays. However, it may lock nodejs in constant context switches
    if (this.relay.data.eose_delay > 0) {
      await new Promise((r) => setTimeout(r, this.relay.data.eose_delay));
    }

    // Reset Events until next EOSE
    this.currentEvents = [];

    // Request next "page" if Last Seen is positive
    if (this.relay.lastSeenPastEventCreatedAt > 0) {
      this.send(["REQ", `PAST_${this.relay.lastSeenPastEventCreatedAt}`, ...this.relay.pastFilters()]);
    }
  }
}

export default RelayCrawler;
