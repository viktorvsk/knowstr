import crypto from "crypto";

import RelayCrawler from "../src/relay_crawler.js";
import redisClient from "../src/redis.js";
import { client as pulsarClient, producer } from "../src/pulsar.js";
import { ts } from "../src/utils.js";
import { worker_main_loop_interval, worker_max_relays } from "../src/settings.js";

let exiting;

const wid = crypto.randomBytes(16).toString("hex");

const [_worker, idle] = await Promise.all([redisClient.SADD("workers", wid), redisClient.get("idle")]);

let relays = [];

let mainLoopInterval = setInterval(main, worker_main_loop_interval);

if (idle) {
  cleanup("INACTIVE");
}

async function main() {
  if (exiting) {
    return;
  }

  const [_ping, isActive, wrids, restartIds, idle] = await Promise.all([
    redisClient.HSET("workers_ping", wid, ts().toString()),
    redisClient.SISMEMBER("workers", wid),
    redisClient.SMEMBERS(`workers:${wid}`),
    redisClient.SMEMBERS(`restart_relays_ids`),
    redisClient.get("idle"),
  ]);

  if (!isActive || idle) {
    cleanup("INACTIVE");
  }

  await Promise.allSettled(relays.filter((r) => !wrids.includes(r.id) || restartIds.includes(r.id)).map((r) => r.stop()));

  const restartedIds = relays.filter((r) => restartIds.includes(r.id)).map((r) => r.id);

  relays = relays.filter((r) => wrids.includes(r.id) && !restartIds.includes(r.id));

  await Promise.all(restartIds.map((rid) => redisClient.SREM("restart_relays_ids", rid)));

  const currentlyActiveRelaysIds = relays.map((r) => r.id);

  wrids.filter((rid) => !currentlyActiveRelaysIds.includes(rid)).forEach((rid) => relays.push(new RelayCrawler(rid)));

  const relaysToStartCount = worker_max_relays - relays.filter((r) => r.active || r.starting).length;

  relays
    .filter((r) => r.shouldStart())
    .sort(() => (Math.random() > 0.5 ? 1 : -1))
    .slice(0, relaysToStartCount)
    .forEach((r) => r.start());
}

async function cleanup(eventType) {
  if (exiting) {
    return;
  }
  exiting = true;
  clearInterval(mainLoopInterval);

  await Promise.allSettled([relays.map((r) => r.stop())].flat());

  await producer?.flush();
  await producer?.close();

  await Promise.all([redisClient.HDEL("workers_ping", wid), redisClient.DEL(`workers:${wid}`), redisClient.SREM("workers", wid), redisClient.quit(), pulsarClient.close()]);

  process.exit();
}

[`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `SIGTERM`].forEach((eventType) => {
  process.on(eventType, cleanup.bind(null, eventType));
});

process
  .on("unhandledRejection", (reason, p) => {
    console.error(reason, "Unhandled Rejection at Promise", p);
  })
  .on("uncaughtException", (err) => {
    console.error(err, "Uncaught Exception thrown");
    cleanup("uncaughtException");
    process.exit(1);
  });
