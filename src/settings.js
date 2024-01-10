import redisClient from "./redis.js";

const DEFAULT_SETTINGS = {
  worker_main_loop_interval: "3000",
  worker_max_relays: "10",
  scheduler_main_loop_interval: "3000",
  scheduler_fails_count_threshold: "5",
  scheduler_max_worker_latency: "120",
  redis_lock_timeout: "2",
  relay_default_handshake_timeout: "5000",
  relay_default_past_filters: JSON.stringify([{ limit: 1000 }]),
  relay_default_future_filters: JSON.stringify([{ limit: 1000 }]),
  relay_default_active: "0",
  relay_default_should_load_past: "1",
  relay_default_should_load_future: "1",
  relay_default_should_load_past_again: "0",
  relay_default_eose_delay: "0",
  relay_default_event_delay: "0",
  relay_default_max_server_latency: "0",
  relay_default_ping_interval: "25000",
  relay_future_events_flush_interval: "1000",
  pulsar_topic: "persistent://public/default/globalstr",
  pulsar_send_timeout_ms: "1000",
  pulsar_max_pending_messages: "10000",
  pulsar_block_if_queue_full: "true",
};

await Promise.all(
  Object.entries(DEFAULT_SETTINGS).map((pair) => {
    const key = pair[0];
    const value = pair[1];

    return redisClient.sendCommand(["HSETNX", "settings", key, value]);
  }),
);

const settings = await redisClient.HGETALL("settings");

export const {
  worker_main_loop_interval,
  worker_max_relays,
  scheduler_main_loop_interval,
  scheduler_fails_count_threshold,
  scheduler_max_worker_latency,
  redis_lock_timeout,
  redis_disable_offline_queue,
  redis_ping_interval,
  relay_default_handshake_timeout,
  relay_default_past_filters,
  relay_default_future_filters,
  relay_default_active,
  relay_default_should_load_past,
  relay_default_should_load_future,
  relay_default_should_load_past_again,
  relay_default_eose_delay,
  relay_default_event_delay,
  relay_default_max_server_latency,
  relay_default_ping_interval,
  relay_future_events_flush_interval,
  pulsar_topic,
  pulsar_send_timeout_ms,
  pulsar_max_pending_messages,
  pulsar_block_if_queue_full,
} = settings;
