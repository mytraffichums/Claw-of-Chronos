export interface Message {
  taskId: number;
  sender: string; // address
  content: string;
  timestamp: number;
  signature: string;
}

// In-memory message store: taskId => Message[]
const MAX_MESSAGES_PER_TASK = 500;
const messages = new Map<number, Message[]>();

export function getMessages(taskId: number): Message[] {
  return messages.get(taskId) ?? [];
}

export function addMessage(msg: Message): void {
  const list = messages.get(msg.taskId) ?? [];
  if (list.length >= MAX_MESSAGES_PER_TASK) return; // cap reached
  list.push(msg);
  messages.set(msg.taskId, list);
}
