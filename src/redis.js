import { createClient } from "redis";

const redisDisableOfflineQueue = process.env.REDIS_DISABLE_OFFLINE_QUEUE == "true" || false;
const redisPingInterval = parseInt(process.env.REDIS_PING_INTERVAL) || 5000;

const URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const client = createClient({
  url: URL,
  disableOfflineQueue: redisDisableOfflineQueue,
  pingInterval: redisPingInterval,
}).on("error", (err) => console.error("[RedisClientError]", err));

if (!client.isOpen) {
  await client.connect();
}

export default client;
