"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, type Address } from "viem";

const CHRONOS_CORE = "0xc3F988DfFa5b3e49Bb887F8eF86c9081Fa381e97" as Address;
const COC_TOKEN = "0xf042d6b96a3A18513A6AcA95ff0EC13dE4047777" as Address;
const BOUNTY_PER_AGENT = 1000n;

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
      { name: "requiredAgents", type: "uint256" },
      { name: "deliberationDuration", type: "uint256" },
    ],
    outputs: [{ name: "taskId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

const PRESETS = { quick: 300n, standard: 600n, deep: 1200n } as const;

export default function CreateTaskForm() {
  const { isConnected } = useAccount();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const [description, setDescription] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [requiredAgents, setRequiredAgents] = useState("3");
  const [deliberationPreset, setDeliberationPreset] = useState<"quick" | "standard" | "deep">("standard");
  const [step, setStep] = useState<"form" | "approve" | "create">("form");

  const taskCreated = step === "create" && isSuccess;

  const deliberationDuration = PRESETS[deliberationPreset];
  const agents = BigInt(requiredAgents || "0");
  const totalBounty = agents * BOUNTY_PER_AGENT * 10n ** 18n;

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
      args: [CHRONOS_CORE, totalBounty],
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
        agents,
        deliberationDuration,
      ],
    });
  };

  const resetForm = () => {
    setDescription("");
    setOptions(["", ""]);
    setRequiredAgents("3");
    setDeliberationPreset("standard");
    setStep("form");
  };

  const validOptions = options.filter((o) => o.trim() !== "");
  const canSubmit = description.trim() && validOptions.length >= 2 && validOptions.length <= 5 && agents > 0n;

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--card-border)] p-6 rounded-xl backdrop-filter backdrop-blur-lg">
      <h3 className="font-compagnon text-2xl font-medium text-[var(--text)] mb-4">Create Task</h3>

      {/* Question */}
      <div className="mb-4">
        <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Question</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Should we ship feature X?"
          className="w-full px-3 py-2 bg-[rgba(255,255,255,0.4)] border border-[var(--card-border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--purple)] focus:ring-1 focus:ring-[var(--purple)]"
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
              className="flex-1 px-3 py-2 bg-[rgba(255,255,255,0.4)] border border-[var(--card-border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--purple)] focus:ring-1 focus:ring-[var(--purple)]"
            />
            {options.length > 2 && (
              <button
                onClick={() => removeOption(idx)}
                className="px-3 py-2 bg-[rgba(255,255,255,0.4)] border border-[var(--card-border)] text-[var(--text)] rounded hover:bg-[rgba(255,255,255,0.6)]"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {options.length < 5 && (
          <button
            onClick={addOption}
            className="mt-2 px-4 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text)] rounded hover:bg-[rgba(190,182,170,0.75)] font-mattone text-sm transition-all"
          >
            + Add Option
          </button>
        )}
      </div>

      {/* Required Agents */}
      <div className="mb-4">
        <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Required Agents</label>
        <input
          type="number"
          value={requiredAgents}
          onChange={(e) => setRequiredAgents(e.target.value)}
          min="1"
          className="w-full px-3 py-2 bg-[rgba(255,255,255,0.4)] border border-[var(--card-border)] text-[var(--text)] rounded focus:outline-none focus:border-[var(--purple)] focus:ring-1 focus:ring-[var(--purple)]"
        />
      </div>

      {/* Deliberation Duration Presets */}
      <div className="mb-4">
        <label className="block font-mattone text-sm text-[var(--text-dim)] mb-2">Discussion Duration</label>
        <div className="flex gap-2">
          {(["quick", "standard", "deep"] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => setDeliberationPreset(preset)}
              className={`flex-1 px-4 py-2 rounded font-mattone text-sm border transition-all ${
                deliberationPreset === preset
                  ? "bg-[var(--text)] text-white border-[var(--text)]"
                  : "bg-[var(--card-bg)] text-[var(--text)] border-[var(--card-border)] hover:bg-[rgba(190,182,170,0.75)]"
              }`}
            >
              {preset === "quick" ? "Quick (5m)" : preset === "standard" ? "Standard (10m)" : "Deep (20m)"}
            </button>
          ))}
        </div>
      </div>

      {/* Cost Display */}
      <div className="mb-4 p-3 bg-[rgba(255,255,255,0.5)] rounded border border-[var(--card-border)]">
        <div className="font-mattone text-sm text-[var(--text)]">
          Total Cost:{" "}
          <span className="font-medium">
            {agents > 0n ? `${(agents * BOUNTY_PER_AGENT).toLocaleString()} $CoC` : "---"}
          </span>
        </div>
        {agents > 0n && (
          <div className="font-mattone text-xs text-[var(--text)] mt-1 opacity-75">
            {requiredAgents} agents × 1,000 $CoC per agent
          </div>
        )}
      </div>

      {/* Actions */}
      {!isConnected ? (
        <p className="text-[var(--text-dim)] font-mattone text-sm">Connect wallet to create task</p>
      ) : taskCreated ? (
        <div>
          <p className="text-green-600 font-mattone text-sm mb-2">Task created successfully!</p>
          <button
            onClick={resetForm}
            className="px-4 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text)] rounded hover:bg-[rgba(190,182,170,0.75)] font-mattone transition-all"
          >
            Create Another
          </button>
        </div>
      ) : step === "form" ? (
        <button
          onClick={handleApprove}
          disabled={!canSubmit || isPending}
          className="w-full px-4 py-3 bg-[var(--text)] text-white rounded font-mattone font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Approving..." : "1. Approve $CoC"}
        </button>
      ) : step === "approve" ? (
        <div>
          {isPending ? (
            <p className="text-[var(--text)] font-mattone text-sm">Confirm approval in wallet...</p>
          ) : isConfirming ? (
            <p className="text-[var(--text)] font-mattone text-sm">Waiting for approval confirmation...</p>
          ) : isSuccess ? (
            <button
              onClick={handleCreate}
              disabled={isPending}
              className="w-full px-4 py-3 bg-[var(--text)] text-white rounded font-mattone font-medium hover:opacity-90"
            >
              2. Create Task
            </button>
          ) : (
            <p className="text-[var(--text)] font-mattone text-sm">Approval transaction submitted...</p>
          )}
        </div>
      ) : step === "create" ? (
        <p className="text-[var(--text)] font-mattone text-sm">
          {isConfirming ? "Creating task..." : "Task creation submitted..."}
        </p>
      ) : null}

      {error && <p className="text-red-600 font-mattone text-sm mt-2">{error.message}</p>}
    </div>
  );
}
