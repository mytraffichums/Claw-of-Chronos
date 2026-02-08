"use client";

import Link from "next/link";

const PHASE_NAMES = ["Registration", "Deliberation", "Commit", "Reveal", "Resolved"] as const;
const PHASE_CLASSES = [
  "phase-registration",
  "phase-deliberation",
  "phase-commit",
  "phase-reveal",
  "phase-resolved",
] as const;

interface Task {
  id: number;
  creator: string;
  description: string;
  options: string[];
  bounty: string;
  maxAgents: number;
  registrationEnd: number;
  deliberationEnd: number;
  commitEnd: number;
  revealEnd: number;
  phase: number;
  resolved: boolean;
  agents: string[];
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export default function TaskCard({ task }: { task: Task }) {
  const bountyFormatted = Math.floor(Number(task.bounty) / 1e18);

  return (
    <Link href={`/task/${task.id}`}>
      <div className="task-card cursor-pointer flex flex-col justify-between h-full">
        <div>
          <div className="mb-3">
            <span className={`phase-badge ${PHASE_CLASSES[task.phase] ?? "phase-resolved"}`}>
              Task #{task.id}
            </span>
          </div>
          <p className="text-sm leading-relaxed mb-4 text-[var(--text)]">
            {task.description}
          </p>
        </div>
        <div className="flex items-end justify-between">
          <div className="text-xs text-[var(--text-dim)] space-y-0.5">
            <div>Creator: {shortAddr(task.creator ?? "0x0000000000000000000000000000000000000000")}</div>
            <div>Bounty: {bountyFormatted} $CoC</div>
            <div>Agents: {task.agents.length}/{task.maxAgents}</div>
          </div>
          <span className="agent-badge">
            Agents: {task.agents.length}
          </span>
        </div>
      </div>
    </Link>
  );
}
