import express from "express";
import bodyParser from "body-parser";

import redisClient from "../src/redis.js";
import { pulsar_topic, pulsar_token } from "../src/settings.js";

const BODY_PARSER_PAYLOAD_LIMIT = process.env.KNOWSTR_BODY_PARSER_PAYLOAD_LIMIT || "100mb";

const app = express();
app.use(bodyParser.json({ limit: BODY_PARSER_PAYLOAD_LIMIT }));

app.use(express.json());
app.use(express.static("./public"));
const port = parseInt(process.env.KNOWSTR_EXPRESS_PORT || 3000);
const pulsarBrokerURL = process.env.KNOWSTR_BROKER_API_URL || "http://127.0.0.1:8080";
const pulsarTopicLookupURL = `${pulsarBrokerURL}/lookup/v2/topic/${pulsar_topic.replace(/\:\/\//, "/")}`;

app.get("/errors/:rid", async (req, res) => {
  const errors = await redisClient.SMEMBERS(`relays_error:${req.params.rid}`);
  res.header("Content-Type", "application/json");

  res.json(errors.map((e) => JSON.parse(e)));
});

app.put("/relays-bulk", async (req, res) => {
  const fieldsToSet = Object.entries(req.body.fields);
  const promises = [];

  if (fieldsToSet.length) {
    req.body.urls.forEach((url) => {
      const rid = btoa(url);
      promises.push(redisClient.HSET(`relay:${rid}`, fieldsToSet));

      if (req.body.fields.active === "1") {
        promises.push(redisClient.SADD("active_relays_ids", rid));
      } else {
        promises.push(redisClient.SREM("active_relays_ids", rid));
      }

      if (req.body.fields.always_on === "1") {
        promises.push(redisClient.SADD("always_on_relays_ids", rid));
      } else {
        promises.push(redisClient.SREM("always_on_relays_ids", rid));
      }

      promises.push(redisClient.SADD("restart_relays_ids", rid));
    });
  }

  await promises;

  res.header("Content-Type", "application/json");

  res.json({ message: "OK" });
});

app.put("/relays/:rid", async (req, res) => {
  const payload = Object.entries(req.body.relay);
  await Promise.all([
    redisClient.HSET(`relay:${req.params.rid}`, payload),
    redisClient.SADD("known_relays_ids", req.params.rid),
    redisClient.SADD("restart_relays_ids", req.params.rid),
    req.body.relay.active == 1 ? redisClient.SADD("active_relays_ids", req.params.rid) : redisClient.SREM("active_relays_ids", req.params.rid),
    req.body.relay.always_on == 1 ? redisClient.SADD("always_on_relays_ids", req.params.rid) : redisClient.SREM("always_on_relays_ids", req.params.rid),
  ]);
  res.header("Content-Type", "application/json");

  res.json({ message: "OK" });
});

app.delete("/relays/:rid/errors", async (req, res) => {
  await redisClient.HDEL("relays_fail", req.params.rid);

  res.header("Content-Type", "application/json");

  res.json({ message: "OK" });
});

app.get("/relays/:rid/pfcount", async (req, res) => {
  const pfCount = await redisClient.pfCount(`relay_events_hll:${req.params.rid}`);

  res.header("Content-Type", "application/json");

  res.json({ pfCount: pfCount });
});

app.get("/data", async (req, res) => {
  const pulsarHeaders = pulsar_token ? { Authorization: `Bearer ${pulsar_token}` } : {};
  const [knownRelaysIds, activeRelaysIds, alwaysOnRelaysIds, wids, connections, relaysFail, scheduledAt, idle, redisDbsize, pulsarResponse] = await Promise.all([
    redisClient.SMEMBERS("known_relays_ids"),
    redisClient.SMEMBERS("active_relays_ids"),
    redisClient.SMEMBERS("always_on_relays_ids"),
    redisClient.SMEMBERS("workers"),
    redisClient.sendCommand(["ZRANGE", "zconnections", "0", "-1"]),
    redisClient.HGETALL("relays_fail"),
    redisClient.GET("scheduler"),
    redisClient.GET("idle"),
    redisClient.DBSIZE(),
    fetch(pulsarTopicLookupURL, { headers: pulsarHeaders }).catch(console.error),
  ]);

  const pulsarData = pulsarResponse ? await pulsarResponse.json() : undefined;

  const pulsarOk = pulsarData ? !!pulsarData.brokerUrl : false;

  const workers = await Promise.all(wids.map((wid) => redisClient.SMEMBERS(`workers:${wid}`)));
  const relays = await Promise.all(knownRelaysIds.map((rid) => redisClient.HGETALL(`relay:${rid}`)));

  relays.forEach((r) => {
    const rid = btoa(r.url);

    r.active = activeRelaysIds.includes(rid) ? "1" : "0";
    r.always_on = alwaysOnRelaysIds.includes(rid) ? "1" : "0";
    r.connected = connections.includes(rid);
    r.failsCount = parseInt(relaysFail[rid] || 0);
  });

  const payload = {
    scheduledAt,
    pulsarOk,
    idle,
    redisDbsize,
    workers,
    relays,
  };

  res.header("Content-Type", "application/json");

  res.json(payload);
});

app.get("/settings", async (req, res) => {
  const payload = await redisClient.HGETALL("settings");

  res.header("Content-Type", "application/json");

  res.json(payload);
});

app.put("/settings", async (req, res) => {
  await redisClient.HSET("settings", Object.entries(req.body.settings));

  res.header("Content-Type", "application/json");

  res.json({ message: "OK" });
});

app.put("/idle", async (req, res) => {
  req.body.idle == 1 ? await redisClient.SET("idle", "1") : await redisClient.DEL("idle");
  res.header("Content-Type", "application/json");

  res.json({ message: "OK" });
});

app.listen(port, () => {
  console.log(`Web started on port ${port}`);
});
