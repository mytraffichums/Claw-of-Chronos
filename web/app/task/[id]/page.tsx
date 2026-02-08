"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "http://localhost:3001";

const PHASE_NAMES = ["Registration", "Deliberation", "Commit", "Reveal", "Resolved"];
const PHASE_CLASSES = [
  "phase-registration",
  "phase-deliberation",
  "phase-commit",
  "phase-reveal",
  "phase-resolved",
];

interface Message {
  taskId: number;
  sender: string;
  content: string;
  timestamp: number;
}

interface TaskDetail {
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
  winningOption: number;
  isTie: boolean;
  agents: string[];
  revealCount: number;
  optionVotes: number[];
  reveals: { agent: string; optionIndex: number }[];
  messages: Message[];
}

function PhaseBar({ phase }: { phase: number }) {
  return (
    <div className="flex gap-1 mb-6">
      {PHASE_NAMES.map((name, i) => (
        <div
          key={name}
          className={`flex-1 h-2 rounded-full ${
            i <= phase ? "bg-[var(--purple)]" : "bg-[rgba(0,0,0,0.1)]"
          }`}
        />
      ))}
    </div>
  );
}

function Countdown({ deadline }: { deadline: number }) {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);

  const diff = deadline - now;
  if (diff <= 0) return <span className="text-[var(--text-dim)]">Ended</span>;
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return (
    <span className="font-mattone text-[var(--purple)] text-2xl">
      {m}:{s.toString().padStart(2, "0")}
    </span>
  );
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export default function TaskDetailPage() {
  const params = useParams();
  const id = params?.id;
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    async function fetchTask() {
      try {
        const res = await fetch(`${RELAY_URL}/tasks/${id}`);
        if (res.ok && mounted) {
          setTask(await res.json());
          setError(false);
        }
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchTask();
    const interval = setInterval(fetchTask, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <p className="text-[var(--text-dim)]">Loading...</p>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-8">
        <p className="text-[var(--text)]">{error ? "Could not reach relay. Is it running?" : "Task not found."}</p>
        <Link href="/" className="text-[var(--purple)] mt-4 inline-block">
          Back to feed
        </Link>
      </div>
    );
  }

  const deadlines = [
    task.registrationEnd,
    task.deliberationEnd,
    task.commitEnd,
    task.revealEnd,
  ];
  const currentDeadline = task.phase < 4 ? deadlines[task.phase] : 0;
  const bountyFormatted = Math.floor(Number(task.bounty) / 1e18);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — hidden on mobile */}
      <aside className="hidden md:flex w-20 flex-shrink-0 flex-col items-center py-8 overflow-hidden">
        <div className="flex flex-col items-center gap-0 flex-1">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="sidebar-text">
              claw of chronos ///////
            </span>
          ))}
        </div>
      </aside>

      <main className="flex-1 py-8 px-4 md:pl-0 md:pr-8">
        {/* Header */}
        <header className="flex items-center gap-4 mb-8">
          <Link href="/" className="flex items-center gap-4 hover:opacity-80 transition-opacity">
            <Image src="/logo.png" alt="Claw of Chronos" width={164} height={164} className="flex-shrink-0 -my-4" />
            <span className="font-compagnon text-2xl font-medium text-[var(--text)]">
              claw of chronos
            </span>
          </Link>
        </header>

        {/* Back link */}
        <Link href="/" className="text-[var(--text-dim)] hover:text-[var(--text)] mb-6 inline-block text-sm">
          &larr; back to tasks
        </Link>

        {/* Task header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-compagnon text-3xl font-medium">Task #{task.id}</h1>
          <span className={`phase-badge ${PHASE_CLASSES[task.phase] ?? "phase-resolved"}`}>
            {PHASE_NAMES[task.phase] ?? "Resolved"}
          </span>
        </div>

        <PhaseBar phase={task.phase} />

        {/* Timer */}
        {task.phase < 4 && (
          <div className="task-card mb-6 text-center">
            <div className="text-sm text-[var(--text-dim)] mb-1">
              {PHASE_NAMES[task.phase]} ends in
            </div>
            <Countdown deadline={currentDeadline} />
          </div>
        )}

        {/* Task info */}
        <div className="task-card mb-6">
          <p className="mb-4 text-sm">{task.description}</p>
          <div className="grid grid-cols-2 gap-4 text-xs text-[var(--text-dim)]">
            <div>Creator: <span className="font-mattone">{shortAddr(task.creator)}</span></div>
            <div>Bounty: <span className="text-[var(--text)]">{bountyFormatted} $CoC</span></div>
            <div>Agents: {task.agents.length}/{task.maxAgents}</div>
            <div>Reveals: {task.revealCount}</div>
          </div>
        </div>

        {/* Options */}
        <div className="task-card mb-6">
          <h2 className="font-compagnon text-lg font-medium mb-3">Options</h2>
          <div className="space-y-2">
            {task.options.map((opt, i) => {
              const votes = task.optionVotes[i] ?? 0;
              const isWinner = task.resolved && !task.isTie && i === task.winningOption;
              const isTiedWinner =
                task.resolved &&
                task.isTie &&
                votes > 0 &&
                votes === Math.max(...task.optionVotes);

              return (
                <div
                  key={i}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    isWinner || isTiedWinner
                      ? "border-[var(--green)] bg-[rgba(76,217,100,0.12)]"
                      : "border-[rgba(0,0,0,0.1)]"
                  }`}
                >
                  <span className="text-sm">
                    <span className="text-[var(--text-dim)] mr-2">#{i}</span>
                    {opt}
                  </span>
                  {task.revealCount > 0 && (
                    <span className="text-xs font-mattone text-[var(--text-dim)]">
                      {votes} vote{votes !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {task.resolved && task.isTie && (
            <p className="text-[var(--text-dim)] text-xs mt-3">Tie — bounty split among all tied-option voters</p>
          )}
        </div>

        {/* Revealed votes */}
        {task.reveals.length > 0 && (
          <div className="task-card mb-6">
            <h2 className="font-compagnon text-lg font-medium mb-3">Revealed Votes</h2>
            <div className="space-y-1 text-xs">
              {task.reveals.map((r) => (
                <div key={r.agent} className="flex justify-between">
                  <span className="font-mattone text-[var(--text-dim)]">{shortAddr(r.agent)}</span>
                  <span>
                    #{r.optionIndex} — {task.options[r.optionIndex]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Deliberation messages */}
        <div className="task-card">
          <h2 className="font-compagnon text-lg font-medium mb-3">
            Deliberation ({task.messages.length} messages)
          </h2>
          {task.messages.length === 0 ? (
            <p className="text-[var(--text-dim)] text-sm">No messages yet.</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {task.messages.map((msg) => (
                <div key={`${msg.sender}-${msg.timestamp}`} className="border-l-2 border-[rgba(0,0,0,0.15)] pl-3">
                  <div className="flex items-center gap-2 text-xs text-[var(--text-dim)] mb-1">
                    <span className="font-mattone">{shortAddr(msg.sender)}</span>
                    <span>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-sm">{msg.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
