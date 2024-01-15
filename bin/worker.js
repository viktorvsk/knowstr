import http from "node:http";
import https from "node:https";
import CacheableLookup from "cacheable-lookup";
import { client as pulsarClient, producer } from "../src/pulsar.js";
import redisClient from "../src/redis.js";

import Worker from "../src/worker.js";

const cacheable = new CacheableLookup({
  lookup: false,
});
cacheable.servers = (process.env.KNOWSTR_DNS_SERVERS || "1.1.1.1,1.0.0.1,8.8.8.8,8.8.4.4,9.9.9.9").split(",");

cacheable.install(http.globalAgent);
cacheable.install(https.globalAgent);

const worker = new Worker();

await worker.checkIn(cleanup);

async function cleanup(eventType) {
  console.log(`Exiting because ${eventType}`);
  await worker.stop();
  await Promise.allSettled([producer.flush(), redisClient.quit()]);

  await producer.close();
  await pulsarClient.close();

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
