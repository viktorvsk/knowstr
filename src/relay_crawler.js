import WebSocket from "ws";
import Relay from "./relay.js";
import NostrMessage from "./nostr_message.js";
import Pulsar from "./pulsar.js";
import { relay_future_events_flush_interval } from "./settings.js";

const TERMINATE_DELAY = 1000;

class RelayCrawler {
  constructor(id) {
    this.id = id;
    this.relay = new Relay(id);
    this.currentEvents = [];
    this.futureEvents = [];
    this.active = false;
    this.starting = false;
    this.stopping = false;
  }

  shouldStart() {
    return !this.stopping && !this.starting && !this.active;
  }

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

  async storeFutureEvents() {
    if (this.futureEvents.length) {
      return await this.processEventsBatch(this.futureEvents);
    }
  }

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

  async fail(error) {
    if (this.stopping) {
      return;
    }

    return Promise.allSettled([this.relay.failed(error), this.stop()]);
  }

  async onUpgrade(res) {
    await this.relay.setIp(res.socket.remoteAddress);
  }

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

  send(payload) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    return this.ws.send(JSON.stringify(payload));
  }

  async onBadResponse(request, response) {
    await this.fail(new Error(`Unexpected server response: ${response.statusCode}`));
  }

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

  async onConnect() {
    const hasNothingToDO = this.relay.data.should_load_past == 0 && this.relay.data.should_load_future == 0 && this.relay.data.should_load_past_again == 0;

    clearInterval(this.aliveInterval);

    this.aliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
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
