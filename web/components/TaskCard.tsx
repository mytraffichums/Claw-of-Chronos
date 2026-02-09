"use client";

import Link from "next/link";

const PHASE_NAMES = ["Open", "Deliberation", "Finalizing", "Finalizing", "Resolved"] as const;
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
  requiredAgents: number;
  deliberationDuration: number;
  deliberationStart: number;
  cancelled: boolean;
  phase: number;
  resolved: boolean;
  winningOption?: number;
  isTie?: boolean;
  agents: string[];
  optionVotes?: number[];
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export default function TaskCard({ task, compact = false, past = false }: { task: Task; compact?: boolean; past?: boolean }) {
  const bountyFormatted = Math.floor(Number(task.bounty) / 1e18);

  // Determine winning answer for past tasks
  let winningAnswer = "";
  if (past && task.resolved && !task.isTie && task.winningOption !== undefined) {
    winningAnswer = task.options[task.winningOption] || "";
  } else if (past && task.resolved && task.isTie && task.optionVotes) {
    const maxVotes = Math.max(...task.optionVotes);
    const winners = task.options.filter((_, i) => task.optionVotes![i] === maxVotes);
    winningAnswer = winners.length > 1 ? `Tie: ${winners.join(", ")}` : winners[0] || "";
  }

  return (
    <Link href={`/task/${task.id}`}>
      <div className="task-card cursor-pointer">
        {past ? (
          // Past task compact view
          <div>
            <div className="text-xs text-[var(--text-dim)] mb-2 font-mattone">
              {shortAddr(task.creator)} asked:
            </div>
            <p className="text-base font-medium text-[var(--text)] mb-2 leading-snug">
              {task.description}
            </p>
            {winningAnswer && (
              <div className="mt-3 pt-3 border-t border-[var(--card-border)]">
                <div className="text-xs text-[var(--text-dim)] mb-1 font-mattone">
                  Answer:
                </div>
                <p className="text-sm text-[var(--text)] font-medium">
                  {winningAnswer}
                </p>
              </div>
            )}
            {task.cancelled && (
              <div className="mt-3 pt-3 border-t border-[var(--card-border)]">
                <span className="text-xs text-red-600 font-mattone">Cancelled</span>
              </div>
            )}
          </div>
        ) : compact ? (
          // Active task compact view
          <div>
            <div className="flex items-start justify-between mb-2">
              <span className={`phase-badge ${PHASE_CLASSES[task.phase] ?? "phase-resolved"}`}>
                {PHASE_NAMES[task.phase] ?? "Resolved"}
              </span>
              <span className="text-xs text-[var(--text-dim)] font-mattone">
                {task.agents.length}/{task.requiredAgents}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-[var(--text)]">
              {task.description}
            </p>
            {task.phase === 0 && !task.cancelled && (
              <div className="text-xs text-[var(--purple)] font-mattone mt-2">
                Waiting for {task.requiredAgents - task.agents.length} more
              </div>
            )}
          </div>
        ) : (
          // Full card view (original)
          <div className="flex flex-col justify-between h-full">
            <div>
              <div className="mb-3">
                <span className={`phase-badge ${PHASE_CLASSES[task.phase] ?? "phase-resolved"}`}>
                  {task.cancelled ? "Cancelled" : PHASE_NAMES[task.phase] ?? "Resolved"}
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
                <div>Agents: {task.agents.length}/{task.requiredAgents}</div>
                {task.phase === 0 && !task.cancelled && (
                  <div className="text-[var(--purple)]">
                    Waiting for {task.requiredAgents - task.agents.length} more
                  </div>
                )}
              </div>
              <span className="agent-badge">
                Agents: {task.agents.length}
              </span>
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
