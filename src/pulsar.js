import PulsarClient from "pulsar-client";
import { pulsar_topic, pulsar_send_timeout_ms, pulsar_max_pending_messages, pulsar_block_if_queue_full, pulsar_token, pulsar_url } from "./settings.js";

/** @module Pulsar
 * @desc Initializes global Pulsar client instance
 * */

const clientParams = {
  serviceUrl: pulsar_url || process.env.KNOWSTR_PULSAR_URL || "pulsar://127.0.0.1:6650",
  // operationTimeoutSeconds: 30,
  // ioThreads: 4,
  // messageListenerThreads: 4,
  // concurrentLookupRequest: 100,
  // useTls: false,
  // tlsTrustCertsFilePath: '/path/to/ca-cert.pem',
  // tlsValidateHostname: false,
  // tlsAllowInsecureConnection: false,
  // statsIntervalInSeconds: 60,
};

if (pulsar_token) {
  clientParams["authentication"] = new PulsarClient.AuthenticationToken({
    token: pulsar_token,
  });
}

/** Pulsar client instance */
export const client = new PulsarClient.Client(clientParams);

/** Pulsar producer instance based on topic, token and settings stored in Redis */
export const producer = await client
  .createProducer({
    topic: pulsar_topic,
    sendTimeoutMs: pulsar_send_timeout_ms,
    maxPendingMessages: pulsar_max_pending_messages,
    blockIfQueueFull: pulsar_block_if_queue_full == "1",
  })
  .catch(console.error);

/** Responsible for storing nostr events in pulsar based on global producer*/
class Pulsar {
  constructor() {
    this.producer = producer;
  }

  async #send(payload) {
    return this.producer.send({ data: Buffer.from(JSON.stringify(payload)) });
  }

  /** Persist events in Pulsar, return error otherwise
   * @param {objecty[]} events list of Nostr events
   * @return {object} */
  async store(events) {
    const result = { ok: true };

    try {
      await Promise.all(events.map((e) => this.#send(e)));
    } catch (error) {
      result.ok = false;
      result.error = error;
    }

    // Seems like there are some issues with batched sending so we await every message instead
    // May be not related, worth checking https://github.com/apache/pulsar-client-node/issues/230
    //
    // events.forEach(event => {
    //   this.#send(event);
    // });
    // await this.producer.flush().catch((error) => {
    //   result.ok = false;
    //   result.error = error
    // });

    return result;
  }
}

export default Pulsar;
