import PulsarClient from "pulsar-client";
import { pulsar_topic, pulsar_send_timeout_ms, pulsar_max_pending_messages, pulsar_block_if_queue_full } from "./settings.js";

const URL = process.env.PULSAR_URL || "pulsar://127.0.0.1:6650";

export const client = new PulsarClient.Client({ serviceUrl: URL });

export const producer = await client
  .createProducer({
    topic: pulsar_topic,
    sendTimeoutMs: pulsar_send_timeout_ms,
    maxPendingMessages: pulsar_max_pending_messages,
    blockIfQueueFull: pulsar_block_if_queue_full === "true",
  })
  .catch(console.error);

export default class Pulsar {
  constructor() {
    this.producer = producer;
  }

  async send(payload) {
    return this.producer.send({ data: Buffer.from(JSON.stringify(payload)) });
  }

  async store(events) {
    const result = { ok: true };

    try {
      await Promise.all(events.map((e) => this.send(e)));
    } catch (error) {
      result.ok = false;
      result.error = error;
    }

    // Seems like there are some issues with batched sending so we await every message instead
    //
    // events.forEach(event => {
    //   this.send(event);
    // });
    // await this.producer.flush().catch((error) => {
    //   result.ok = false;
    //   result.error = error
    // });

    return result;
  }
}
