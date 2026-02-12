import "dotenv/config";
import express from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import {
  closePipelineQueues,
  createPipelineQueues,
  createRedisConnection,
  parsePositiveInt,
} from "./queues";

async function main(): Promise<void> {
  const connection = createRedisConnection();
  const queues = createPipelineQueues(connection);

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [
      new BullMQAdapter(queues.sync),
      new BullMQAdapter(queues.build),
      new BullMQAdapter(queues.index),
      new BullMQAdapter(queues.orchestrator),
    ],
    serverAdapter,
  });

  const app = express();
  app.use("/admin/queues", serverAdapter.getRouter());
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  const port = parsePositiveInt(process.env.BULL_BOARD_PORT, 3100);
  const host = process.env.BULL_BOARD_HOST ?? "0.0.0.0";

  const server = app.listen(port, host, () => {
    console.log(`bull-board listening on http://${host}:${port}/admin/queues`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`bull-board shutting down (${signal})`);

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await closePipelineQueues(queues);
    await connection.quit();
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
