import { createClient } from "redis";

/** @module Redis
 * @desc Initializes global Redis client instance
 * */

const redisDisableOfflineQueue = process.env.KNOWSTR_REDIS_DISABLE_OFFLINE_QUEUE == "true" || false;
const redisPingInterval = parseInt(process.env.KNOWSTR_REDIS_PING_INTERVAL) || 5000;

const URL = process.env.KNOWSTR_REDIS_URL || "redis://127.0.0.1:6379";

/** Instance */
const client = createClient({
  url: URL,
  disableOfflineQueue: redisDisableOfflineQueue,
  pingInterval: redisPingInterval,
}).on("error", (err) => console.error("[RedisClientError]", err));

if (!client.isOpen) {
  await client.connect();
}

export default client;
