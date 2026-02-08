import express from "express";
import cors from "cors";
import router from "./routes.js";
import { startPoller } from "./chain.js";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.use(router);

const server = app.listen(PORT, () => {
  console.log(`[relay] listening on port ${PORT}`);
  startPoller();
});

// Graceful shutdown
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[relay] received ${sig}, shutting down...`);
    server.close(() => process.exit(0));
  });
}
