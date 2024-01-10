import redisClient from "../src/redis.js";
import { ts } from "../src/utils.js";
import { scheduler_main_loop_interval, scheduler_fails_count_threshold, scheduler_max_worker_latency } from "../src/settings.js";

let exiting = false;

const [scheduler, idle] = await Promise.all([redisClient.sendCommand(["SET", `scheduler`, ts().toString(), "NX"]), redisClient.get("idle")]);

if (scheduler === null) {
  throw new Error("Scheduler is already running, can't have multiple copies");
}

const mainLoopInterval = setInterval(main, scheduler_main_loop_interval);

if (idle) {
  cleanup("INACTIVE");
}

async function main() {
  const [fails, activeRids, alwaysOnRids, idle] = await Promise.all([
    redisClient.HGETALL("relays_fail"),
    redisClient.SMEMBERS("active_relays_ids"),
    redisClient.SMEMBERS("always_on_relays_ids"),
    redisClient.get("idle"),
  ]);

  if (idle) {
    cleanup("INACTIVE");
  }

  const failsCleanupPromises = Object.entries(fails)
    .filter((fail) => {
      return activeRids.includes(fail[0]) && fail[1] >= scheduler_fails_count_threshold && !alwaysOnRids.includes(fail[0]);
    })
    .map((fail) => {
      const rid = fail[0];
      // const _failedAttempts = fail[1];

      return [
        redisClient.SREM("active_relays_ids", rid), // TODO: make a single command
        redisClient.HSET(`relay:${rid}`, "active", "0"),
      ];
    })
    .flat();

  await Promise.all(failsCleanupPromises);

  const [wids, rids] = await Promise.all([cleanupWorkers(), redisClient.SMEMBERS("active_relays_ids")]);

  if (!wids.length) {
    return;
  }

  const newWorkers = await calculateWorkers(wids, rids);

  if (Object.keys(newWorkers).length) {
    await saveWorkers(newWorkers);
  }
}

async function cleanupWorkers() {
  const wids = [];
  const promises = [];
  const workerPings = await redisClient.HGETALL("workers_ping");

  Object.entries(workerPings).forEach((worker) => {
    const wid = worker[0];
    const lastPingedAt = worker[1];

    if (ts() - parseInt(lastPingedAt) >= scheduler_max_worker_latency) {
      promises.push(redisClient.HDEL("workers_ping", wid));
      promises.push(redisClient.DEL(`workers:${wid}`));
      promises.push(redisClient.SREM("workers", wid));
    } else {
      wids.push(wid);
    }
  });
  await Promise.all(promises);
  return wids;
}

async function calculateWorkers(wids, rids) {
  const workers = {};
  let excessRelays = [];
  let perWorker = Math.ceil(rids.length / wids.length);

  for (const wid of wids) {
    const wrids = await redisClient.SMEMBERS(`workers:${wid}`);
    workers[wid] = wrids.map(parseInt).filter((rid) => rids.includes(rid)); // # TODO: remove parseInt() ?
  }

  let activeRelaysIds = Object.values(workers).flat();

  Object.entries(workers).forEach(([wid, wrids]) => {
    if (wrids.length > perWorker) {
      while (wrids.length > perWorker) {
        excessRelays.push(wrids.pop());
      }
    }
  });

  excessRelays.push(...rids.filter((rid) => !activeRelaysIds.includes(rid)));
  excessRelays = [...new Set(excessRelays)];

  Object.entries(workers).forEach(([wid, wrids]) => {
    if (wrids.length < perWorker) {
      while (wrids.length < perWorker) {
        let rid = excessRelays.pop();
        if (!rid) break;
        wrids.push(rid);
      }
    }
  });

  return workers;
}

async function saveWorkers(workers) {
  const transaction = redisClient.multi();
  Object.entries(workers).forEach((worker) => {
    const wid = worker[0];
    const wrids = worker[1];
    transaction.DEL(`workers:${wid}`);

    if (wrids.length) {
      transaction.SADD(`workers:${wid}`, wrids);
    }
  });
  await transaction.exec();
}

async function cleanup(eventType) {
  if (exiting) {
    return;
  }
  exiting = true;
  clearInterval(mainLoopInterval);

  await redisClient.DEL("scheduler").catch(console.error);

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
