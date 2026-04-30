import { http, createConfig } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: {
    [baseSepolia.id]: http(),
  },
});

export const SOLVER_URL = "http://localhost:3001";
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;
export const SOLVER_ADDRESS = (import.meta.env.VITE_SOLVER_ADDRESS || "0x0000000000000000000000000000000000000001") as `0x${string}`;
