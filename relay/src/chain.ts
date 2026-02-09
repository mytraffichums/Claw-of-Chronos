import { createPublicClient, http, parseAbiItem, type Address, type Log } from "viem";

// ── Config ─────────────────────────────────────────────────────────────
const RPC_URL = process.env.MONAD_RPC ?? "https://rpc.monad.xyz";
const CONTRACT_ADDRESS = process.env.CHRONOS_CORE as Address;
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL ?? 5000);

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 143);
const COMMIT_DURATION = 60;
const REVEAL_DURATION = 60;

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
  bounty: string;
  requiredAgents: number;
  deliberationDuration: number;
  deliberationStart: number; // 0 until full
  cancelled: boolean;
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

// ── Contract ABI fragments ───────────────────────────────────────────
const contractAbi = [
  parseAbiItem("function taskCount() view returns (uint256)"),
  parseAbiItem("function getTask(uint256 taskId) view returns (address creator, string description, string[] options, uint256 requiredAgents, uint256 deliberationDuration, uint256 bounty, uint256 deliberationStart, uint8 phase, bool resolved, bool cancelled, uint256 winningOption, bool isTie)"),
  parseAbiItem("function getAgents(uint256 taskId) view returns (address[])"),
  parseAbiItem("function revealCount(uint256 taskId) view returns (uint256)"),
  parseAbiItem("function optionVotes(uint256 taskId, uint256 optionIndex) view returns (uint256)"),
] as const;

// ── Event ABI fragments ─────────────────────────────────────────────
const taskCreatedEvent = parseAbiItem(
  "event TaskCreated(uint256 indexed taskId, address indexed creator, string description, string[] options, uint256 bounty, uint256 requiredAgents, uint256 deliberationDuration)"
);
const taskStartedEvent = parseAbiItem(
  "event TaskStarted(uint256 indexed taskId, uint256 deliberationStart)"
);
const taskCancelledEvent = parseAbiItem(
  "event TaskCancelled(uint256 indexed taskId, address indexed creator, uint256 refund)"
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
  taskCreatedEvent, taskStartedEvent, taskCancelledEvent,
  agentJoinedEvent, phaseAdvancedEvent, commitSubmittedEvent,
  revealSubmittedEvent, taskResolvedEvent,
];

// ── Hydrate from contract view functions on startup ─────────────────
async function hydrateFromContract() {
  console.log("[chain] hydrating task cache from contract...");

  const count = await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: contractAbi,
    functionName: "taskCount",
  });
  const taskCount = Number(count);
  console.log(`[chain] found ${taskCount} tasks on-chain`);

  for (let id = 0; id < taskCount; id++) {
    try {
      const [creator, description, options, requiredAgents, deliberationDuration,
        bounty, deliberationStart, phase, resolved, cancelled, winningOption, isTie] =
        await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: contractAbi,
          functionName: "getTask",
          args: [BigInt(id)],
        });

      const agents = await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: contractAbi,
        functionName: "getAgents",
        args: [BigInt(id)],
      });

      const rc = await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: contractAbi,
        functionName: "revealCount",
        args: [BigInt(id)],
      });

      // Read option votes
      const votes: number[] = [];
      for (let o = 0; o < options.length; o++) {
        const v = await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: contractAbi,
          functionName: "optionVotes",
          args: [BigInt(id), BigInt(o)],
        });
        votes.push(Number(v));
      }

      tasks.set(id, {
        id,
        creator,
        description,
        options: [...options],
        bounty: bounty.toString(),
        requiredAgents: Number(requiredAgents),
        deliberationDuration: Number(deliberationDuration),
        deliberationStart: Number(deliberationStart),
        cancelled,
        phase: Number(phase),
        resolved,
        winningOption: Number(winningOption),
        isTie,
        agents: [...agents],
        revealCount: Number(rc),
        optionVotes: votes,
        reveals: [], // not available from view functions, only from events
      });
    } catch (err) {
      console.error(`[chain] error reading task ${id}:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[chain] hydration complete, ${tasks.size} tasks cached`);
}

// ── Event processing (for live updates after hydration) ──────────────
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
        requiredAgents: Number(args.requiredAgents),
        deliberationDuration: Number(args.deliberationDuration),
        deliberationStart: 0,
        cancelled: false,
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
    case "TaskStarted": {
      const task = tasks.get(Number(args.taskId));
      if (task) {
        task.deliberationStart = Number(args.deliberationStart);
        task.phase = 1;
      }
      break;
    }
    case "TaskCancelled": {
      const task = tasks.get(Number(args.taskId));
      if (task) {
        task.cancelled = true;
        task.phase = 4;
      }
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
        task.phase = 4;
      }
      break;
    }
  }
}

// ── Poller (only new events after hydration) ─────────────────────────
let lastBlock = 0n;
let polling = false;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const currentBlock = await client.getBlockNumber();

    if (currentBlock > lastBlock) {
      const fromBlock = lastBlock + 1n;

      // Monad RPC limits eth_getLogs to 100-block ranges — paginate
      const MAX_RANGE = 100n;
      for (let start = fromBlock; start <= currentBlock; start += MAX_RANGE + 1n) {
        const end = start + MAX_RANGE > currentBlock ? currentBlock : start + MAX_RANGE;
        const logs = await client.getLogs({
          address: CONTRACT_ADDRESS,
          events: allEvents,
          fromBlock: start,
          toBlock: end,
        });

        for (const log of logs) {
          processLog(log);
        }
      }

      lastBlock = currentBlock;
    }

    // Update phases based on current time
    const now = Math.floor(Date.now() / 1000);
    for (const task of tasks.values()) {
      if (task.resolved || task.cancelled) continue;
      if (task.deliberationStart === 0) {
        task.phase = 0; // Open — waiting for agents
        continue;
      }

      const delibEnd = task.deliberationStart + task.deliberationDuration;
      const commitEnd = delibEnd + COMMIT_DURATION;
      const revealEnd = commitEnd + REVEAL_DURATION;

      if (now >= revealEnd) task.phase = 4;
      else if (now >= commitEnd) task.phase = 3;
      else if (now >= delibEnd) task.phase = 2;
      else task.phase = 1;
    }
  } catch (err) {
    console.error("[chain] poll error:", err instanceof Error ? err.message : String(err));
  } finally {
    polling = false;
  }
}

export async function startPoller() {
  if (!CONTRACT_ADDRESS) {
    console.error("[chain] FATAL: CHRONOS_CORE env var is required. Set it to the deployed ChronosCore contract address.");
    process.exit(1);
  }

  // 1. Hydrate all existing tasks from contract state
  await hydrateFromContract();

  // 2. Start polling for new events from current block
  lastBlock = await client.getBlockNumber();
  console.log(`[chain] live polling from block ${lastBlock}, every ${POLL_INTERVAL}ms`);
  setInterval(poll, POLL_INTERVAL);
}
