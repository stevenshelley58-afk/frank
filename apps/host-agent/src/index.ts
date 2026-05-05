import { loadHostAgentConfig } from "./config.js";
import { createHostAgentServer } from "./server.js";

const config = loadHostAgentConfig();
const server = createHostAgentServer({ config });

server.listen(config.port, config.host, () => {
  console.log(`Frank host agent listening on ${config.host}:${config.port}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
