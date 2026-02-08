import { Router, type Request, type Response } from "express";
import { verifyMessage, type Address } from "viem";
import { getAllTasks, getTask } from "./chain.js";
import { getMessages, addMessage } from "./store.js";
import { readFileSync } from "fs";
import { resolve } from "path";

const router = Router();

// ── Rate limiter (per-sender, simple in-memory) ─────────────────────────
const MSG_RATE_WINDOW = 60_000; // 1 minute
const MSG_RATE_LIMIT = 20; // max messages per sender per window
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(sender: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(sender);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(sender, { count: 1, resetAt: now + MSG_RATE_WINDOW });
    return false;
  }
  bucket.count++;
  return bucket.count > MSG_RATE_LIMIT;
}

// ── Helpers ──────────────────────────────────────────────────────────────
function parseId(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

const MAX_CONTENT_LENGTH = 2000; // characters

// ── GET /health ────────────────────────────────────────────────────────
router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// ── GET /tasks ─────────────────────────────────────────────────────────
router.get("/tasks", (_req: Request, res: Response) => {
  res.json(getAllTasks());
});

// ── GET /tasks/:id ─────────────────────────────────────────────────────
router.get("/tasks/:id", (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }
  const task = getTask(id);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ ...task, messages: getMessages(id) });
});

// ── POST /tasks/:id/messages ───────────────────────────────────────────
router.post("/tasks/:id/messages", async (req: Request, res: Response) => {
  const taskId = parseId(req.params.id);
  if (taskId === null) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }
  const task = getTask(taskId);

  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const { content, signature, sender } = req.body;

  if (!content || !signature || !sender) {
    res.status(400).json({ error: "Missing content, signature, or sender" });
    return;
  }

  if (typeof content !== "string" || content.length > MAX_CONTENT_LENGTH) {
    res.status(400).json({ error: `Content must be a string of at most ${MAX_CONTENT_LENGTH} characters` });
    return;
  }

  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    res.status(400).json({ error: "Invalid signature format" });
    return;
  }

  if (typeof sender !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(sender)) {
    res.status(400).json({ error: "Invalid sender address" });
    return;
  }

  // Rate limit
  if (isRateLimited(sender.toLowerCase())) {
    res.status(429).json({ error: "Rate limit exceeded" });
    return;
  }

  // Verify EIP-191 signature
  try {
    const message = JSON.stringify({ taskId, content });
    const valid = await verifyMessage({
      address: sender as Address,
      message,
      signature: signature as `0x${string}`,
    });

    if (!valid) {
      console.warn(`[relay] invalid signature from ${sender} on task #${taskId}`);
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  } catch {
    console.warn(`[relay] signature verification threw for ${sender} on task #${taskId}`);
    res.status(401).json({ error: "Signature verification failed" });
    return;
  }

  // Verify sender is a registered agent for this task
  const isRegistered = task.agents.some(
    (a) => a.toLowerCase() === sender.toLowerCase()
  );
  if (!isRegistered) {
    res.status(403).json({ error: "Sender is not a registered agent for this task" });
    return;
  }

  const msg = {
    taskId,
    sender: sender.toLowerCase(),
    content,
    timestamp: Date.now(),
    signature,
  };

  addMessage(msg);
  res.status(201).json(msg);
});

// ── GET /tasks/:id/messages ────────────────────────────────────────────
router.get("/tasks/:id/messages", (req: Request, res: Response) => {
  const taskId = parseId(req.params.id);
  if (taskId === null) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }
  res.json(getMessages(taskId));
});

// ── GET /skill.md ──────────────────────────────────────────────────────
router.get("/skill.md", (_req: Request, res: Response) => {
  try {
    const skillPath = resolve(process.cwd(), "..", "skill.md");
    const content = readFileSync(skillPath, "utf-8");
    res.type("text/markdown").send(content);
  } catch {
    res.status(404).send("skill.md not found");
  }
});

export default router;
