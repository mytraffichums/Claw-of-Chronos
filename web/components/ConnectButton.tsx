"use client";

import { useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

export default function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        disabled
        className="px-4 py-2 bg-[var(--text)] text-white rounded font-mattone font-medium opacity-50"
      >
        Connect Wallet
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="px-4 py-2 bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text)] rounded font-mattone hover:bg-[rgba(190,182,170,0.75)] transition-all flex items-center gap-2"
      >
        <span className="w-2 h-2 rounded-full bg-[var(--green)]"></span>
        {address.slice(0, 6)}...{address.slice(-4)}
        <span className="text-xs opacity-60">✕</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: connectors[0] })}
      className="px-4 py-2 bg-[var(--text)] text-white rounded font-mattone font-medium hover:opacity-90 transition-all"
    >
      Connect Wallet
    </button>
  );
}
