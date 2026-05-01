# 0friction

> **Cross-chain AI compute via 0G — pay with USDC, no bridging required.**

0friction is a TypeScript SDK + solver backend that lets any EVM app use [0G Compute](https://0g.ai) (decentralized AI inference) without forcing users to hold A0GI tokens, bridge assets, or interact with 0G Chain directly.

Users pay with **USDC on Base** via gasless EIP-2612 permit signatures. The 0friction solver handles all 0G interaction behind the scenes.

## Architecture

```
┌────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   User (Base)  │     │  0friction Solver │     │   0G Compute    │
│                │     │                  │     │                 │
│  1. Get quote  │────▶│  Price estimate   │     │                 │
│  2. Sign intent│     │                  │     │                 │
│  3. Sign permit│     │  Verify sigs     │     │                 │
│  4. Submit     │────▶│  Execute compute  │────▶│  AI Inference   │
│                │     │  Settle USDC     │     │  (TEE verified) │
│  5. Get result │◀────│  Return response │◀────│                 │
└────────────────┘     └──────────────────┘     └─────────────────┘
```

**Key innovation:** Users never touch 0G Chain. They sign two gasless signatures on their home chain, and the solver handles everything else.

## Quick Start

```bash
# Clone
git clone https://github.com/your-repo/0friction
cd 0friction

# Install
npm install
cd frontend && npm install && cd ..

# Configure
cp .env.example .env
# Edit .env with your keys

# Run backend (mock mode for testing)
ENABLE_MOCK_FALLBACK=true npm run dev --workspace=backend

# Run frontend (separate terminal)
cd frontend && npm run dev
```

## Project Structure

```
0friction/
├── sdk/              @0friction/sdk — TypeScript SDK (npm package)
├── backend/          Solver backend (Express + 0G broker)
├── frontend/         Demo chat interface (React + wagmi)
├── contracts/        IntentRegistry.sol (deployed on 0G Chain)
├── examples/         CLI agent example
└── .env.example      Environment variables
```

## Deployments

| Component | Location |
|-----------|----------|
| IntentRegistry | `0x01D1084d915eAb33A36FBaBFC29Dc8e6478b0926` on 0G Galileo (chain 16602) |
| Solver Address | `0xB9a33C169d1360E6AdFf7266797f85467856bCc2` |
| USDC (Base Sepolia) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## SDK Usage

```typescript
import { createClient, COMPUTE_INTENT_TYPES, buildIntentDomain, hashPayload } from "@0friction/sdk";

// 1. Create client
const client = createClient({
  solverUrl: "https://solver.0friction.xyz",
  chainId: 84532,
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  solver: "0xB9a33C169d1360E6AdFf7266797f85467856bCc2",
});

// 2. Get price quote
const quote = await client.quote.get({
  model: "qwen3.6-plus",
  prompt: "What is quantum computing?",
});

// 3. Build intent + sign with your wallet
const intent = client.intent.build({ quote, owner: userAddress, requestPayload, nonce: "1" });
const intentSig = await wallet.signTypedData(/* EIP-712 */);

// 4. Sign USDC permit (gasless)
const permitSig = await wallet.signTypedData(/* EIP-2612 */);

// 5. Submit — get AI response
const result = await client.intent.submit({
  intent, intentSignature: intentSig,
  permit, permitSignature: permitSig,
  requestPayload, quoteId: quote.quoteId,
});

console.log(result.response); // AI response from 0G
```

## How It Works

1. **Quote** — User requests a price estimate for their prompt
2. **Sign Intent** — User signs an EIP-712 `ComputeIntent` authorizing the compute job
3. **Sign Permit** — User signs an EIP-2612 USDC `permit` authorizing the payment
4. **Submit** — Both signatures are sent to the solver backend
5. **Execute** — Solver runs AI inference via 0G Compute Network (TEE-verified)
6. **Settle** — Solver calls `permit()` + `transferFrom()` to collect USDC on Base
7. **Record** — Intent fulfillment is logged on-chain via IntentRegistry on 0G

**Zero gas for users. Zero bridging. Zero A0GI tokens needed.**

## 0G Protocol Features Used

- **0G Compute Network** — Decentralized AI inference via `@0gfoundation/0g-compute-ts-sdk`
- **TEE Verification** — Response integrity via `processResponse()` TEE attestation
- **0G Chain** — IntentRegistry contract for on-chain audit trail
- **Service Discovery** — `listService()` for dynamic provider discovery

## Tech Stack

| Layer | Technology |
|-------|-----------|
| SDK | TypeScript, viem, EIP-712/EIP-2612 |
| Backend | Express, ethers.js, @0gfoundation/0g-compute-ts-sdk |
| Frontend | React, wagmi, viem |
| Contract | Solidity 0.8.20, Foundry |
| Chains | Base Sepolia (payments), 0G Galileo (compute + registry) |

## Team

Built for **ETHGlobal Open Agents** hackathon — 0G track.

## License

MIT
