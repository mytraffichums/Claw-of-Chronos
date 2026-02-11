import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodePacked,
  type Address,
  type PrivateKeyAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getDecision, type LLMDecision, type Personality } from "./llm.js";

// ── Config ─────────────────────────────────────────────────────────────
const RPC_URL = process.env.MONAD_RPC ?? "https://rpc.monad.xyz";
const RELAY_URL = process.env.RELAY_URL ?? "http://localhost:3001";
const CONTRACT_ADDRESS = process.env.CHRONOS_CORE as Address;

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 143);

const monad = {
  id: CHAIN_ID,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

// ── Contract ABI (minimal fragments) ──────────────────────────────────
const ABI = [
  {
    name: "joinTask",
    type: "function",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "commit",
    type: "function",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "commitHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "reveal",
    type: "function",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "optionIndex", type: "uint256" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "isAgent",
    type: "function",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    name: "commits",
    type: "function",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    name: "revealed",
    type: "function",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    name: "taskCount",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "resolve",
    type: "function",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "claimBounty",
    type: "function",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "claimed",
    type: "function",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

// Re-export Personality from llm module
export type { Personality } from "./llm.js";

// ── Relay task type ────────────────────────────────────────────────────
interface RelayTask {
  id: number;
  description: string;
  options: string[];
  bounty: string;
  requiredAgents: number;
  deliberationDuration: number;
  deliberationStart: number;
  cancelled: boolean;
  phase: number;
  resolved: boolean;
  agents: string[];
  reveals: { agent: string; optionIndex: number }[];
}

// ── Bot class ──────────────────────────────────────────────────────────
export class Bot {
  name: string;
  personality: Personality;
  account: PrivateKeyAccount;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;

  // Track per-task state
  private joinedTasks = new Set<number>();
  private deliberated = new Set<number>();
  private committedTasks = new Map<number, { optionIndex: number; salt: `0x${string}` }>();
  private revealedTasks = new Set<number>();
  private resolvedTasks = new Set<number>();
  private claimedTasks = new Set<number>();
  private decisions = new Map<number, LLMDecision>();

  constructor(name: string, personality: Personality, privateKey: `0x${string}`) {
    this.name = name;
    this.personality = personality;
    this.account = privateKeyToAccount(privateKey);
    this.publicClient = createPublicClient({ chain: monad, transport: http(RPC_URL) });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: monad,
      transport: http(RPC_URL),
    });
  }

  get address(): string {
    return this.account.address;
  }

  // ── Get cached LLM decision option (fallback to 0) ─────────────────
  getCachedOption(taskId: number): number {
    return this.decisions.get(taskId)?.optionIndex ?? 0;
  }

  // ── Post deliberation message to relay ─────────────────────────────
  async postMessage(taskId: number, content: string): Promise<void> {
    try {
      const message = JSON.stringify({ taskId, content });
      const signature = await this.account.signMessage({ message });

      await fetch(`${RELAY_URL}/tasks/${taskId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          signature,
          sender: this.address,
        }),
      });
    } catch (err) {
      console.warn(`[${this.name}] postMessage failed for task #${taskId}:`, (err as Error).message);
    }
  }

  // ── Main tick ──────────────────────────────────────────────────────
  async tick(): Promise<void> {
    let tasks: RelayTask[];
    try {
      const res = await fetch(`${RELAY_URL}/tasks`);
      tasks = await res.json();
    } catch {
      return; // relay down
    }

    for (const task of tasks) {
      const now = Math.floor(Date.now() / 1000);

      try {
        // Phase 0: Open — join if not already, not cancelled, not full
        if (task.phase === 0 && !task.cancelled && task.deliberationStart === 0 && !this.joinedTasks.has(task.id)) {
          const alreadyJoined = await this.publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: ABI,
            functionName: "isAgent",
            args: [BigInt(task.id), this.address as Address],
          });

          if (alreadyJoined) {
            this.joinedTasks.add(task.id);
          } else {
            try {
              const hash = await this.walletClient.writeContract({
                address: CONTRACT_ADDRESS,
                abi: ABI,
                functionName: "joinTask",
                args: [BigInt(task.id)],
                chain: monad,
                account: this.account,
              });
              // Wait for tx to be mined so next bot sees updated state
              await this.publicClient.waitForTransactionReceipt({ hash });
              console.log(`[${this.name}] joined task #${task.id} (tx: ${hash})`);
              this.joinedTasks.add(task.id);
            } catch (joinErr) {
              console.log(`[${this.name}] join task #${task.id} failed: ${(joinErr as Error).message?.slice(0, 80)}`);
            }
          }
        }

        // Catch up: if we're an agent but missed the join (e.g. bot restarted)
        if (task.phase > 0 && task.phase < 4 && !this.joinedTasks.has(task.id)) {
          const alreadyJoined = await this.publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: ABI,
            functionName: "isAgent",
            args: [BigInt(task.id), this.address as Address],
          });
          if (alreadyJoined) this.joinedTasks.add(task.id);
        }

        // Phase 1/2: Deliberation — get LLM decision and post message
        // Allow deliberation in phase 2 as well, so slower bots still post before committing
        if ((task.phase === 1 || task.phase === 2) && !this.deliberated.has(task.id) && this.joinedTasks.has(task.id)) {
          try {
            // Fetch existing conversation from relay
            let existingMessages: { sender: string; content: string }[] = [];
            try {
              const msgRes = await fetch(`${RELAY_URL}/tasks/${task.id}/messages`);
              if (msgRes.ok) existingMessages = await msgRes.json();
            } catch {}

            const decision = await getDecision(
              this.personality,
              task.description,
              task.options,
              existingMessages
            );

            this.decisions.set(task.id, decision);
            await this.postMessage(task.id, decision.deliberationMessage);
            console.log(`[${this.name}] deliberated on task #${task.id} — chose option #${decision.optionIndex}`);
            console.log(`[${this.name}] reasoning: ${decision.reasoning}`);
          } catch (llmErr) {
            console.warn(`[${this.name}] LLM failed for task #${task.id}:`, (llmErr as Error).message);
            this.decisions.set(task.id, {
              optionIndex: 0,
              reasoning: "LLM fallback",
              deliberationMessage: `After considering the options, I'll go with option #0 (${task.options[0]}).`,
            });
            await this.postMessage(task.id, `After considering the options, I'll go with option #0 (${task.options[0]}).`);
          }
          this.deliberated.add(task.id);
        }

        // Phase 2: Commit
        if (task.phase === 2 && !this.committedTasks.has(task.id) && this.joinedTasks.has(task.id)) {
          const existing = await this.publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: ABI,
            functionName: "commits",
            args: [BigInt(task.id), this.address as Address],
          });

          if (existing === "0x0000000000000000000000000000000000000000000000000000000000000000") {
            const optionIndex = this.getCachedOption(task.id);
            const salt = keccak256(
              encodePacked(["address", "uint256", "uint256"], [this.address as Address, BigInt(task.id), BigInt(Date.now())])
            ) as `0x${string}`;
            const commitHash = keccak256(
              encodePacked(["uint256", "uint256", "bytes32"], [BigInt(task.id), BigInt(optionIndex), salt])
            );

            const hash = await this.walletClient.writeContract({
              address: CONTRACT_ADDRESS,
              abi: ABI,
              functionName: "commit",
              args: [BigInt(task.id), commitHash],
              chain: monad,
              account: this.account,
            });
            console.log(`[${this.name}] committed on task #${task.id} option=${optionIndex} (tx: ${hash})`);
            this.committedTasks.set(task.id, { optionIndex, salt });
          } else {
            // Already committed in a previous run — we don't have the salt, so skip reveal
            console.log(`[${this.name}] task #${task.id}: commit exists on-chain, skipping (no local salt)`);
            this.committedTasks.set(task.id, { optionIndex: -1, salt: "0x" as `0x${string}` });
          }
        }

        // Phase 3: Reveal
        if (task.phase === 3 && !this.revealedTasks.has(task.id) && this.committedTasks.has(task.id)) {
          const alreadyRevealed = await this.publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: ABI,
            functionName: "revealed",
            args: [BigInt(task.id), this.address as Address],
          });

          if (!alreadyRevealed) {
            const commitData = this.committedTasks.get(task.id)!;
            if (commitData.optionIndex >= 0) {
              const hash = await this.walletClient.writeContract({
                address: CONTRACT_ADDRESS,
                abi: ABI,
                functionName: "reveal",
                args: [BigInt(task.id), BigInt(commitData.optionIndex), commitData.salt],
                chain: monad,
                account: this.account,
              });
              console.log(`[${this.name}] revealed on task #${task.id} (tx: ${hash})`);
            }
          }
          this.revealedTasks.add(task.id);
        }

        // Phase 4: Resolved — resolve on-chain, then claim bounty
        if (task.phase >= 4 && this.revealedTasks.has(task.id)) {
          // Step 1: Call resolve() if not yet resolved on-chain
          if (!task.resolved && !this.resolvedTasks.has(task.id)) {
            try {
              const hash = await this.walletClient.writeContract({
                address: CONTRACT_ADDRESS,
                abi: ABI,
                functionName: "resolve",
                args: [BigInt(task.id)],
                chain: monad,
                account: this.account,
              });
              console.log(`[${this.name}] resolved task #${task.id} (tx: ${hash})`);
            } catch (resolveErr) {
              // Another bot may have resolved first — that's fine
              console.log(`[${this.name}] resolve task #${task.id}: ${(resolveErr as Error).message?.slice(0, 80)}`);
            }
            this.resolvedTasks.add(task.id);
          }

          // Step 2: Claim bounty once resolved
          if (task.resolved && !this.claimedTasks.has(task.id)) {
            const alreadyClaimed = await this.publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi: ABI,
              functionName: "claimed",
              args: [BigInt(task.id), this.address as Address],
            });

            if (!alreadyClaimed) {
              try {
                const hash = await this.walletClient.writeContract({
                  address: CONTRACT_ADDRESS,
                  abi: ABI,
                  functionName: "claimBounty",
                  args: [BigInt(task.id)],
                  chain: monad,
                  account: this.account,
                });
                console.log(`[${this.name}] claimed bounty on task #${task.id} (tx: ${hash})`);
              } catch (claimErr) {
                // Not a winner — that's expected for some bots
                console.log(`[${this.name}] claim task #${task.id}: ${(claimErr as Error).message?.slice(0, 80)}`);
              }
            }
            this.claimedTasks.add(task.id);
          }
        }
      } catch (err) {
        console.error(`[${this.name}] error on task #${task.id}:`, (err as Error).message);
      }
    }
  }
}
