import { Bot } from "./bot.js";

// ── Bot private keys from env ──────────────────────────────────────────
// Set BOT_KEY_1, BOT_KEY_2, BOT_KEY_3 environment variables
// These should be pre-funded with MON for gas

const bots: Bot[] = [];

const botConfigs = [
  { name: "Analyst", personality: "analyst" as const, keyEnv: "BOT_KEY_1" },
  { name: "Contrarian", personality: "contrarian" as const, keyEnv: "BOT_KEY_2" },
  { name: "Follower", personality: "follower" as const, keyEnv: "BOT_KEY_3" },
];

for (const cfg of botConfigs) {
  const key = process.env[cfg.keyEnv];
  if (!key) {
    console.warn(`[warn] ${cfg.keyEnv} not set — skipping ${cfg.name}`);
    continue;
  }
  bots.push(new Bot(cfg.name, cfg.personality, key as `0x${string}`));
}

if (bots.length === 0) {
  console.error("No bot keys configured. Set BOT_KEY_1, BOT_KEY_2, BOT_KEY_3 env vars.");
  process.exit(1);
}

console.log(`Starting ${bots.length} bots:`);
for (const bot of bots) {
  console.log(`  ${bot.name} (${bot.personality}) — ${bot.address}`);
}

// ── Main loop ──────────────────────────────────────────────────────────
const TICK_INTERVAL = Number(process.env.TICK_INTERVAL ?? 10000);

async function loop() {
  while (true) {
    await Promise.all(bots.map((bot) => bot.tick()));
    await new Promise((r) => setTimeout(r, TICK_INTERVAL));
  }
}

loop().catch(console.error);
