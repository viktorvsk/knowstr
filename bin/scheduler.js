import Scheduler from "../src/scheduler.js";

const scheduler = new Scheduler();

await scheduler.checkIn(cleanup);

async function cleanup(eventType) {
  console.log(`Exiting because ${eventType}`);
  await scheduler?.stop();

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
