const Pulsar = require("pulsar-client");
const Redis = require("redis");

const READ_TIMEOUT = parseInt(process.env.KNOWSTR_READ_TIMEOUT || 5000);

(async () => {
  let exiting;
  let msg;
  let timeout;

  const redisClient = Redis.createClient({
    url: process.env.KNOWSTR_REDIS_URL || "redis://127.0.0.1:6379",
  }).on("error", (err) => console.error("[RedisClientError]", err));

  await redisClient.connect();

  const [topic, token, url] = await Promise.all([redisClient.HGET("settings", "pulsar_topic"), redisClient.HGET("settings", "pulsar_token"), redisClient.HGET("settings", "pulsar_url")]);

  const currentMessageId = await redisClient.GET(`pulsar_reader_example_message_id:${topic}`);

  const clientParams = {
    serviceUrl: url || process.env.KNOWSTR_PULSAR_URL || "pulsar://127.0.0.1:6650",
    operationTimeoutSeconds: 30,
  };

  if (token || process.env.KNOWSTR_PULSAR_TOKEN) {
    clientParams["authentication"] = new Pulsar.AuthenticationToken({
      token: token || process.env.KNOWSTR_PULSAR_TOKEN,
    });
  }

  // Create a client
  const client = new Pulsar.Client(clientParams);

  const mid = currentMessageId ? Pulsar.MessageId.deserialize(Buffer.from(currentMessageId, "hex")) : Pulsar.MessageId.earliest();

  // Create a reader
  const reader = await client.createReader({
    topic: topic,
    startMessageId: mid,
  });

  const onTimeout = async () => {
    console.log("Exiting because of reader timeout");
    await reader.close().catch(console.error);
    await client.close().catch(console.error);
    await redisClient.quit().catch(console.error);
    process.exit();
  };

  timeout = setTimeout(onTimeout, READ_TIMEOUT);

  while ((msg = await reader.readNext())) {
    clearTimeout(timeout);
    timeout = setTimeout(onTimeout, READ_TIMEOUT);
    const payload = msg.getData().toString();
    const event = JSON.parse(payload);
    const messageId = msg.getMessageId().serialize().toString("hex");

    await Promise.all([redisClient.SET(`pulsar_reader_example_message_id:${topic}`, messageId), redisClient.SET(`id:${event.id}`, parseInt(Date.now() / 1000))]);
  }
})();
