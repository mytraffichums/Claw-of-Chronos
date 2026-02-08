"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

export default function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="px-4 py-2 bg-[var(--card-bg)] border-2 border-[var(--border)] text-[var(--text)] rounded font-mattone hover:bg-[var(--bg)]"
      >
        {address.slice(0, 6)}...{address.slice(-4)}
      </button>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: connectors[0] })}
      className="px-4 py-2 bg-[var(--text)] text-[var(--bg)] rounded font-mattone font-medium hover:opacity-90"
    >
      Connect Wallet
    </button>
  );
}
