"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, type Address } from "viem";

const CHRONOS_CORE = "0x6bEC6376210564c6a01373E432615316AB85f6Bf" as Address;
const COC_TOKEN = "0xf042d6b96a3A18513A6AcA95ff0EC13dE4047777" as Address;

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const CHRONOS_ABI = [
  {
    name: "createTask",
    type: "function",
    inputs: [
      { name: "description", type: "string" },
      { name: "options", type: "string[]" },
      { name: "bounty", type: "uint256" },
      { name: "maxAgents", type: "uint256" },
      { name: "regDuration", type: "uint256" },
      { name: "delibDuration", type: "uint256" },
      { name: "commitDuration", type: "uint256" },
      { name: "revealDuration", type: "uint256" },
    ],
    outputs: [{ name: "taskId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

export default function CreateTaskForm() {
  const { address, isConnected } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const [description, setDescription] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [bounty, setBounty] = useState("100");
  const [maxAgents, setMaxAgents] = useState("5");
  const [regDuration, setRegDuration] = useState("90");
  const [delibDuration, setDelibDuration] = useState("120");
  const [commitDuration, setCommitDuration] = useState("90");
  const [revealDuration, setRevealDuration] = useState("90");
  const [step, setStep] = useState<"form" | "approve" | "create">("form");

  const addOption = () => {
    if (options.length < 5) setOptions([...options, ""]);
  };

  const removeOption = (idx: number) => {
    if (options.length > 2) setOptions(options.filter((_, i) => i !== idx));
  };

  const updateOption = (idx: number, value: string) => {
    const newOpts = [...options];
    newOpts[idx] = value;
    setOptions(newOpts);
  };

  const handleApprove = async () => {
    if (!isConnected) return;
    setStep("approve");
    writeContract({
      address: COC_TOKEN,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CHRONOS_CORE, parseEther(bounty)],
    });
  };

  const handleCreate = async () => {
    if (!isConnected) return;
    setStep("create");
    writeContract({
      address: CHRONOS_CORE,
      abi: CHRONOS_ABI,
      functionName: "createTask",
      args: [
        description,
        options.filter((o) => o.trim() !== ""),
        parseEther(bounty),
        BigInt(maxAgents),
        BigInt(regDuration),
        BigInt(delibDuration),
        BigInt(commitDuration),
        BigInt(revealDuration),
      ],
    });
  };

  const resetForm = () => {
    setDescription("");
    setOptions(["", ""]);
    setBounty("100");
    setMaxAgents("5");
    setRegDuration("90");
    setDelibDuration("120");
    setCommitDuration("90");
    setRevealDuration("90");
    setStep("form");
  };

  const validOptions = options.filter((o) => o.trim() !== "");
  const canSubmit = description.trim() && validOptions.length >= 2 && validOptions.length <= 5 && parseFloat(bounty) > 0;

  return (
    <div className="bg-[var(--card-bg)] border-2 border-[var(--border)] p-6 rounded-lg max-w-2xl">
      <h3 className="font-compagnon text-2xl font-medium text-[var(--text)] mb-4">Create Task</h3>

      {/* Description */}
      <div className="mb-4">
        <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Question</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Should we ship feature X?"
          className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--text-dim)]"
        />
      </div>

      {/* Options */}
      <div className="mb-4">
        <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Options (2-5)</label>
        {options.map((opt, idx) => (
          <div key={idx} className="flex gap-2 mb-2">
            <input
              type="text"
              value={opt}
              onChange={(e) => updateOption(idx, e.target.value)}
              placeholder={`Option ${idx + 1}`}
              className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--text-dim)]"
            />
            {options.length > 2 && (
              <button
                onClick={() => removeOption(idx)}
                className="px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text-dim)] rounded hover:bg-[var(--card-bg)]"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {options.length < 5 && (
          <button
            onClick={addOption}
            className="mt-2 px-4 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded hover:bg-[var(--card-bg)] font-mattone text-sm"
          >
            + Add Option
          </button>
        )}
      </div>

      {/* Bounty & Agents */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Bounty ($CoC)</label>
          <input
            type="number"
            value={bounty}
            onChange={(e) => setBounty(e.target.value)}
            min="1"
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--text-dim)]"
          />
        </div>
        <div>
          <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Max Agents</label>
          <input
            type="number"
            value={maxAgents}
            onChange={(e) => setMaxAgents(e.target.value)}
            min="1"
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--text-dim)]"
          />
        </div>
      </div>

      {/* Phase Durations */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Registration (sec)</label>
          <input
            type="number"
            value={regDuration}
            onChange={(e) => setRegDuration(e.target.value)}
            min="1"
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--text-dim)]"
          />
        </div>
        <div>
          <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Deliberation (sec)</label>
          <input
            type="number"
            value={delibDuration}
            onChange={(e) => setDelibDuration(e.target.value)}
            min="1"
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--text-dim)]"
          />
        </div>
        <div>
          <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Commit (sec)</label>
          <input
            type="number"
            value={commitDuration}
            onChange={(e) => setCommitDuration(e.target.value)}
            min="1"
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--text-dim)]"
          />
        </div>
        <div>
          <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Reveal (sec)</label>
          <input
            type="number"
            value={revealDuration}
            onChange={(e) => setRevealDuration(e.target.value)}
            min="1"
            className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--text-dim)]"
          />
        </div>
      </div>

      {/* Actions */}
      {!isConnected ? (
        <p className="text-[var(--text-dim)] font-mattone text-sm">Connect wallet to create task</p>
      ) : isSuccess ? (
        <div>
          <p className="text-green-600 font-mattone text-sm mb-2">Task created successfully!</p>
          <button
            onClick={resetForm}
            className="px-4 py-2 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded hover:bg-[var(--card-bg)] font-mattone"
          >
            Create Another
          </button>
        </div>
      ) : step === "form" ? (
        <button
          onClick={handleApprove}
          disabled={!canSubmit || isPending}
          className="w-full px-4 py-3 bg-[var(--text)] text-[var(--bg)] rounded font-mattone font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Approving..." : "1. Approve $CoC"}
        </button>
      ) : step === "approve" ? (
        <div>
          {isConfirming ? (
            <p className="text-[var(--text-dim)] font-mattone text-sm">Waiting for approval confirmation...</p>
          ) : hash ? (
            <button
              onClick={handleCreate}
              className="w-full px-4 py-3 bg-[var(--text)] text-[var(--bg)] rounded font-mattone font-medium hover:opacity-90"
            >
              2. Create Task
            </button>
          ) : null}
        </div>
      ) : null}

      {error && <p className="text-red-600 font-mattone text-sm mt-2">{error.message}</p>}
    </div>
  );
}
