import redisClient from "../src/redis.js";
import { ts } from "../src/utils.js";
import { scheduler_main_loop_interval, scheduler_fails_count_threshold, scheduler_max_worker_latency } from "../src/settings.js";

const CONNECTION_TTL = parseInt(process.env.KNOWSTR_CONNECTION_TTL || 60);

export default class Scheduler {
  constructor() {
    this.exiting = false;
  }

  async checkIn(cleanup) {
    const [scheduler, idle] = await Promise.all([redisClient.GET("scheduler"), redisClient.GET("idle")]);
    this.cleanup = cleanup;

    if (scheduler === null) {
      // First run
    } else if (ts() - parseInt(scheduler) < (parseInt(scheduler_main_loop_interval) * 5) / 1000) {
      cleanup("Scheduler is already running, can't have multiple copies");
    } else {
      // Stale record
      await redisClient.DEL("scheduler");
    }

    if (idle) {
      this.cleanup("schedulerInactive");
    } else {
      this.mainLoopInterval = setInterval(this.run.bind(this), scheduler_main_loop_interval);
    }
  }

  async stop() {
    if (this.exiting) {
      return;
    }

    this.exiting = true;
    clearInterval(this.mainLoopInterval);

    await redisClient.DEL("scheduler");
  }

  async run() {
    const [fails, activeRids, alwaysOnRids, idle, scheduler] = await Promise.all([
      redisClient.HGETALL("relays_fail"),
      redisClient.SMEMBERS("active_relays_ids"),
      redisClient.SMEMBERS("always_on_relays_ids"),
      redisClient.GET("idle"),
      redisClient.SET("scheduler", ts().toString()),
    ]);

    if (idle) {
      this.cleanup("schedulerInactive");
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
    const staleRelaysIds = await redisClient.sendCommand(["ZRANGE", "zconnections", "0", (ts() - CONNECTION_TTL).toString(), "BYSCORE"]);
    await Promise.all(staleRelaysIds.map((rid) => redisClient.SADD("restart_relays_ids", rid)));

    const wids = await this.cleanupWorkers();

    if (!wids.length) {
      return;
    }

    const rids = await redisClient.SMEMBERS("active_relays_ids");

    const newWorkers = await this.calculateWorkers(wids, rids);

    if (Object.keys(newWorkers).length) {
      await this.saveWorkers(newWorkers);
    }
  }

  async cleanupWorkers() {
    const wids = [];
    const promises = [];
    const [workerPings, allWids] = await Promise.all([redisClient.HGETALL("workers_ping"), redisClient.SMEMBERS("workers")]);

    allWids
      .filter((wid) => !Object.keys(workerPings).includes(wid))
      .forEach((wid) => {
        console.log(`DELETING ${wid}`);
        promises.push(redisClient.DEL(`workers:${wid}`));
        promises.push(redisClient.SREM("workers", wid));
      });

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

  async calculateWorkers(wids, rids) {
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

  async saveWorkers(workers) {
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
}
