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

// ── Personality types ──────────────────────────────────────────────────
type Personality = "analyst" | "contrarian" | "follower";

const DELIB_MESSAGES: Record<Personality, string[]> = {
  analyst: [
    "After careful analysis, I think we should consider the long-term implications of each option.",
    "Looking at the data, option {opt} seems most promising based on fundamentals.",
    "Let me break this down systematically. The key factors here are risk and reward.",
    "From an analytical perspective, we need to weigh the trade-offs carefully.",
    "The rational choice here requires examining all variables objectively.",
  ],
  contrarian: [
    "I disagree with the popular sentiment. Let's think about this differently.",
    "Everyone seems to be leaning one way, but have you considered the opposite?",
    "Playing devil's advocate here — option {opt} might not be as good as it seems.",
    "The crowd is often wrong. I'm going to push back on the consensus.",
    "What if the obvious choice is actually the worst one? Let's reconsider.",
  ],
  follower: [
    "I agree with the general direction. Option {opt} makes sense to me.",
    "The arguments presented so far are compelling. I'm aligned with the majority.",
    "This seems like a clear case. I'll go with what most agents are suggesting.",
    "I trust the collective wisdom here. Let's move forward together.",
    "No objections from me — the consensus is strong on this one.",
  ],
};

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

  // ── Choose option based on personality ─────────────────────────────
  chooseOption(task: RelayTask): number {
    const n = task.options.length;
    switch (this.personality) {
      case "analyst":
        // Picks the "middle" option or first if only 2
        return Math.floor(n / 2);
      case "contrarian":
        // Picks the last option (least popular assumption)
        return n - 1;
      case "follower":
        // Picks the first option (follows the default)
        // If other reveals exist, follow majority
        if (task.reveals.length > 0) {
          const counts = new Map<number, number>();
          for (const r of task.reveals) {
            counts.set(r.optionIndex, (counts.get(r.optionIndex) ?? 0) + 1);
          }
          let best = 0;
          let bestCount = 0;
          for (const [opt, count] of counts) {
            if (count > bestCount) {
              bestCount = count;
              best = opt;
            }
          }
          return best;
        }
        return 0;
    }
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

        // Phase 1: Deliberation — post message
        if (task.phase === 1 && !this.deliberated.has(task.id) && this.joinedTasks.has(task.id)) {
          const templates = DELIB_MESSAGES[this.personality];
          const optIdx = this.chooseOption(task);
          let msg = templates[Math.floor(Math.random() * templates.length)];
          msg = msg.replace("{opt}", `#${optIdx} (${task.options[optIdx]})`);

          await this.postMessage(task.id, msg);
          console.log(`[${this.name}] deliberated on task #${task.id}`);
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
            const optionIndex = this.chooseOption(task);
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
