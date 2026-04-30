# 0friction CLI Agent Example

A minimal interactive chatbot that demonstrates the full 0friction flow:
**Quote → Sign Intent → Sign Permit → Submit → Get AI Response**

## Prerequisites

1. A wallet with USDC on Base Sepolia ([faucet](https://faucet.circle.com))
2. The 0friction solver backend running locally

## Setup

```bash
cd examples
npm install
cp .env.example .env
```

Edit `.env`:
- `USER_PRIVATE_KEY` — your wallet private key
- `SOLVER_ADDRESS` — the solver's wallet address (from backend startup logs)

## Run

```bash
# Terminal 1: Start the solver backend
cd ../
ENABLE_MOCK_FALLBACK=true npm run dev --workspace=backend

# Terminal 2: Run the CLI agent
cd examples
npx tsx cli-agent.ts
```

## What happens per message

```
1. You type a message
2. CLI fetches a price quote from solver      → "Max cost: $0.0012 USDC"
3. CLI signs EIP-712 ComputeIntent            → proves you authorized this compute job
4. CLI signs EIP-2612 USDC Permit             → proves you authorized the USDC spend
5. CLI submits signed package to solver        → solver executes 0G compute + settles USDC
6. You see the AI response + cost breakdown
```

No bridging. No A0GI tokens. No 0G Chain interaction. Just USDC signatures on Base.
