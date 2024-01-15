import crypto from "crypto";

import RelayCrawler from "./relay_crawler.js";
import redisClient from "./redis.js";
import { ts } from "./utils.js";
import { worker_main_loop_interval, worker_max_relays } from "./settings.js";

/** Handles multiple RelayCrawlers lifecycle: starts, stops, restarts. Holds current crawlers state
 * and checks with changes provided by Scheduler each tick */
class Worker {
  constructor() {
    this.wid = crypto.randomBytes(16).toString("hex");
    this.exiting = false;
    this.relays = [];
  }

  /** First, each worker checks in, checks if it should exit due to idle state and starts main loop of its not*/
  async checkIn(cleanup) {
    const [_worker, _ping, idle] = await Promise.all([redisClient.SADD("workers", this.wid), redisClient.HSET("workers_ping", this.wid, ts().toString()), redisClient.get("idle")]);

    if (idle) {
      cleanup("workersIdle");
    }

    this.cleanup = cleanup;

    this.mainLoopInterval = setInterval(this.run.bind(this), worker_main_loop_interval);
  }

  /** Main loop where crawlers states are managed */
  async run() {
    if (this.exiting) {
      return;
    }

    const [_ping, isActive, wrids, restartIds, idle] = await Promise.all([
      redisClient.HSET("workers_ping", this.wid, ts().toString()),
      redisClient.SISMEMBER("workers", this.wid),
      redisClient.SMEMBERS(`workers:${this.wid}`),
      redisClient.SMEMBERS(`restart_relays_ids`),
      redisClient.get("idle"),
    ]);

    if (!isActive || idle) {
      this.cleanup(isActive ? "workersIdle" : "workerInactive");
    }

    await Promise.allSettled(this.relays.filter((r) => !wrids.includes(r.id) || restartIds.includes(r.id)).map((r) => r.stop()));

    const restartedIds = this.relays.filter((r) => restartIds.includes(r.id)).map((r) => r.id);

    this.relays = this.relays.filter((r) => wrids.includes(r.id) && !restartIds.includes(r.id));

    await Promise.all(restartIds.map((rid) => redisClient.SREM("restart_relays_ids", rid)));

    const currentlyActiveRelaysIds = this.relays.map((r) => r.id);

    wrids.filter((rid) => !currentlyActiveRelaysIds.includes(rid)).forEach((rid) => this.relays.push(new RelayCrawler(rid)));

    const relaysToStartCount = worker_max_relays - this.relays.filter((r) => r.active || r.starting).length;

    await this.relays
      .filter((r) => r.shouldStart())
      .sort(() => (Math.random() > 0.5 ? 1 : -1))
      .slice(0, relaysToStartCount)
      .map((r) => r.start());
  }

  /** Gracefully stop worker */
  async stop() {
    if (this.exiting) {
      return;
    }

    this.exiting = true;
    clearInterval(this.mainLoopInterval);
    await Promise.allSettled(this.relays.map((r) => r.stop()));
    await Promise.all([redisClient.HDEL("workers_ping", this.wid), redisClient.DEL(`workers:${this.wid}`), redisClient.SREM("workers", this.wid)]);
  }
}

export default Worker;
