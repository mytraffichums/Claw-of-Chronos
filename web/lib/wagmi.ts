import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

export const monad = {
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.monad.xyz"] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: "https://monad.socialscan.io" },
  },
} as const;

export const config = createConfig({
  chains: [monad],
  connectors: [injected()],
  transports: {
    [monad.id]: http(),
  },
});
