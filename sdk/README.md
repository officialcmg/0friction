# @0friction/sdk

TypeScript SDK for 0G AI compute abstraction.

Use 0G compute from any app runtime while users pay with USDC on their home chain through gasless signatures.

## Install

```bash
npm i @0friction/sdk
```

## Why this SDK

- Runtime-agnostic TypeScript API (frontend, backend, edge, agent runtimes)
- Simple flow: quote -> build intent -> pass signatures -> submit
- Gasless user auth (EIP-712 + EIP-2612)
- 0G compute execution hidden behind one backend endpoint

## 60-second integration

```ts
import {
  createClient,
  buildIntentDomain,
  buildPermitDomain,
  COMPUTE_INTENT_TYPES,
  PERMIT_TYPES,
} from "@0friction/sdk";

const client = createClient();

// 1) Get quote
const quote = await client.quote.get({
  model: "qwen/qwen-2.5-7b-instruct",
  prompt: "What is 0G Compute?",
});

// 2) Build request payload + intent
const requestPayload = {
  model: "qwen/qwen-2.5-7b-instruct",
  messages: [{ role: "user", content: "What is 0G Compute?" }],
};

const intent = client.intent.build({
  quote,
  owner: userAddress,
  requestPayload,
  nonce: String(Date.now()),
});

// 3) App layer signs intent (EIP-712)
const intentSignature = await walletClient.signTypedData({
  account: userAddress,
  domain: buildIntentDomain(client.config.chainId),
  types: COMPUTE_INTENT_TYPES,
  primaryType: "ComputeIntent",
  message: {
    owner: intent.owner,
    solver: intent.solver,
    chainId: BigInt(intent.chainId),
    token: intent.token,
    model: intent.model,
    promptHash: intent.promptHash,
    quoteId: intent.quoteId,
    maxUsdc: intent.maxUsdc,
    deadline: BigInt(intent.deadline),
    nonce: BigInt(intent.nonce),
  },
});

// 4) App layer signs USDC permit (EIP-2612)
const permit = {
  owner: userAddress,
  spender: client.config.solver,
  value: quote.maxChargeUsdcAtomic,
  nonce: String(usdcPermitNonce),
  deadline: quote.expiresAt,
};

const permitSignature = await walletClient.signTypedData({
  account: userAddress,
  domain: buildPermitDomain(client.config.chainId, client.config.token, "USDC", "2"),
  types: PERMIT_TYPES,
  primaryType: "Permit",
  message: {
    owner: permit.owner,
    spender: permit.spender,
    value: BigInt(permit.value),
    nonce: BigInt(permit.nonce),
    deadline: BigInt(permit.deadline),
  },
});

// 5) Submit and get response
const result = await client.intent.submit({
  intent,
  intentSignature,
  permit,
  permitSignature,
  requestPayload,
  quoteId: quote.quoteId,
});

console.log(result.status, result.response);
```

## Gasless flow explained

Per request (v1):
1. User signs ComputeIntent (EIP-712) to authorize exact compute request.
2. User signs Permit (EIP-2612) to authorize bounded USDC payment.
3. Solver verifies signatures, executes 0G inference, and settles payment.

No user gas tx is required for signing itself.

## API overview

- `createClient(config?)`
- `client.quote.get({ model, prompt })`
- `client.intent.build({ quote, owner, requestPayload, nonce })`
- `client.intent.submit({ intent, intentSignature, permit, permitSignature, requestPayload, quoteId })`
- `client.jobs.get(jobId)`
- `client.jobs.poll(jobId)`

## Defaults

`createClient()` uses default testnet config:
- solver URL: `https://zerofriction-solver.onrender.com`
- chain: Base Sepolia (`84532`)
- token: Base Sepolia USDC

Override anything via `createClient({ solverUrl, chainId, token, solver })`.

## Notes

- Signing is intentionally app-layer (viem/ethers/wagmi/custom signer).
- SDK is transport + payload + validation glue.
- For a full live flow test, see repo script: `../test-sdk.ts`.

## Roadmap

This is v1. Future versions will add:
- session-based auth (no per-message signature UX)
- multi-chain support (beyond Base)
- richer policy modules for agent frameworks

## License

MIT
