import { readFileSync, writeFileSync, existsSync } from "fs";

export interface Message {
  taskId: number;
  sender: string; // address
  content: string;
  timestamp: number;
  signature: string;
}

// Persistent message store: taskId => Message[]
const MAX_MESSAGES_PER_TASK = 500;
const STORE_PATH = process.env.STORE_PATH ?? "./messages.json";
const messages = new Map<number, Message[]>();

// Load from disk on startup
try {
  if (existsSync(STORE_PATH)) {
    const data = JSON.parse(readFileSync(STORE_PATH, "utf-8")) as Record<string, Message[]>;
    for (const [key, msgs] of Object.entries(data)) {
      messages.set(Number(key), msgs);
    }
    console.log(`[store] loaded ${messages.size} tasks from ${STORE_PATH}`);
  }
} catch (err) {
  console.warn(`[store] failed to load ${STORE_PATH}:`, (err as Error).message);
}

function persist(): void {
  try {
    const obj: Record<string, Message[]> = {};
    for (const [k, v] of messages) obj[String(k)] = v;
    writeFileSync(STORE_PATH, JSON.stringify(obj));
  } catch (err) {
    console.warn(`[store] failed to persist:`, (err as Error).message);
  }
}

export function getMessages(taskId: number): Message[] {
  return messages.get(taskId) ?? [];
}

export function addMessage(msg: Message): void {
  const list = messages.get(msg.taskId) ?? [];
  if (list.length >= MAX_MESSAGES_PER_TASK) return; // cap reached
  list.push(msg);
  messages.set(msg.taskId, list);
  persist();
}
