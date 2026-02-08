import { createPublicClient, http, parseAbiItem, type Address, type Log } from "viem";

// ── Config ─────────────────────────────────────────────────────────────
const RPC_URL = process.env.MONAD_RPC ?? "https://rpc.monad.xyz";
const CONTRACT_ADDRESS = process.env.CHRONOS_CORE as Address;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL ?? 5000);

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 143);

const monad = {
  id: CHAIN_ID,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

export const client = createPublicClient({
  chain: monad,
  transport: http(RPC_URL),
});

// ── Cached task type ───────────────────────────────────────────────────
export interface CachedTask {
  id: number;
  creator: string;
  description: string;
  options: string[];
  bounty: string; // bigint as string for JSON
  maxAgents: number;
  registrationEnd: number;
  deliberationEnd: number;
  commitEnd: number;
  revealEnd: number;
  phase: number;
  resolved: boolean;
  winningOption: number;
  isTie: boolean;
  agents: string[];
  revealCount: number;
  optionVotes: number[];
  reveals: { agent: string; optionIndex: number }[];
}

// ── In-memory task cache ───────────────────────────────────────────────
const tasks = new Map<number, CachedTask>();

export function getAllTasks(): CachedTask[] {
  return Array.from(tasks.values()).sort((a, b) => b.id - a.id);
}

export function getTask(id: number): CachedTask | undefined {
  return tasks.get(id);
}

// ── ABI fragments for events ───────────────────────────────────────────
const taskCreatedEvent = parseAbiItem(
  "event TaskCreated(uint256 indexed taskId, address indexed creator, string description, string[] options, uint256 bounty, uint256 maxAgents, uint256 registrationEnd, uint256 deliberationEnd, uint256 commitEnd, uint256 revealEnd)"
);
const agentJoinedEvent = parseAbiItem(
  "event AgentJoined(uint256 indexed taskId, address indexed agent)"
);
const phaseAdvancedEvent = parseAbiItem(
  "event PhaseAdvanced(uint256 indexed taskId, uint8 phase)"
);
const commitSubmittedEvent = parseAbiItem(
  "event CommitSubmitted(uint256 indexed taskId, address indexed agent)"
);
const revealSubmittedEvent = parseAbiItem(
  "event RevealSubmitted(uint256 indexed taskId, address indexed agent, uint256 optionIndex)"
);
const taskResolvedEvent = parseAbiItem(
  "event TaskResolved(uint256 indexed taskId, uint256 winningOption, bool isTie)"
);

const allEvents = [
  taskCreatedEvent,
  agentJoinedEvent,
  phaseAdvancedEvent,
  commitSubmittedEvent,
  revealSubmittedEvent,
  taskResolvedEvent,
];

// ── Event processing ───────────────────────────────────────────────────
function processLog(log: Log<bigint, number, false>) {
  const raw = log as any;
  const eventName = raw.eventName as string;
  const args = raw.args;

  switch (eventName) {
    case "TaskCreated": {
      const id = Number(args.taskId);
      tasks.set(id, {
        id,
        creator: args.creator,
        description: args.description,
        options: args.options,
        bounty: args.bounty.toString(),
        maxAgents: Number(args.maxAgents),
        registrationEnd: Number(args.registrationEnd),
        deliberationEnd: Number(args.deliberationEnd),
        commitEnd: Number(args.commitEnd),
        revealEnd: Number(args.revealEnd),
        phase: 0,
        resolved: false,
        winningOption: 0,
        isTie: false,
        agents: [],
        revealCount: 0,
        optionVotes: new Array(args.options.length).fill(0),
        reveals: [],
      });
      break;
    }
    case "AgentJoined": {
      const task = tasks.get(Number(args.taskId));
      if (task && !task.agents.includes(args.agent)) {
        task.agents.push(args.agent);
      }
      break;
    }
    case "PhaseAdvanced": {
      const task = tasks.get(Number(args.taskId));
      if (task) task.phase = Number(args.phase);
      break;
    }
    case "CommitSubmitted": {
      // Just track that commit happened (no extra state needed)
      break;
    }
    case "RevealSubmitted": {
      const task = tasks.get(Number(args.taskId));
      if (task) {
        const optIdx = Number(args.optionIndex);
        task.revealCount++;
        task.optionVotes[optIdx] = (task.optionVotes[optIdx] ?? 0) + 1;
        task.reveals.push({ agent: args.agent, optionIndex: optIdx });
      }
      break;
    }
    case "TaskResolved": {
      const task = tasks.get(Number(args.taskId));
      if (task) {
        task.resolved = true;
        task.winningOption = Number(args.winningOption);
        task.isTie = args.isTie;
        task.phase = 4; // Resolved
      }
      break;
    }
  }
}

// ── Poller ──────────────────────────────────────────────────────────────
let lastBlock = 0n;
let polling = false;

async function poll() {
  if (polling) return; // prevent concurrent polls
  polling = true;
  try {
    const currentBlock = await client.getBlockNumber();

    if (currentBlock > lastBlock) {
      const fromBlock = lastBlock === 0n ? (currentBlock > 5000n ? currentBlock - 5000n : 0n) : lastBlock + 1n;

      const logs = await client.getLogs({
        address: CONTRACT_ADDRESS,
        events: allEvents,
        fromBlock,
        toBlock: currentBlock,
      });

      for (const log of logs) {
        processLog(log);
      }

      lastBlock = currentBlock;
    }

    // Always update phases based on current time
    const now = Math.floor(Date.now() / 1000);
    for (const task of tasks.values()) {
      if (task.resolved) continue;
      if (now >= task.revealEnd) task.phase = 4;
      else if (now >= task.commitEnd) task.phase = 3;
      else if (now >= task.deliberationEnd) task.phase = 2;
      else if (now >= task.registrationEnd) task.phase = 1;
    }
  } catch (err) {
    console.error("[chain] poll error:", err instanceof Error ? err.message : String(err));
  } finally {
    polling = false;
  }
}

export function startPoller() {
  if (!CONTRACT_ADDRESS) {
    console.error("[chain] FATAL: CHRONOS_CORE env var is required. Set it to the deployed ChronosCore contract address.");
    process.exit(1);
  }
  console.log(`[chain] polling ${CONTRACT_ADDRESS} every ${POLL_INTERVAL}ms`);
  poll(); // initial
  setInterval(poll, POLL_INTERVAL);
}
