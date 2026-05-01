"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { parseAbi, keccak256, toBytes } from "viem";

// ─── Constants ────────────────────────────────────────────────

const SOLVER_URL =
  process.env.NEXT_PUBLIC_SOLVER_URL || "http://localhost:3001";
const USDC_ADDRESS =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;
const SOLVER_ADDRESS =
  (process.env.NEXT_PUBLIC_SOLVER_ADDRESS ||
    "0xB9a33C169d1360E6AdFf7266797f85467856bCc2") as `0x${string}`;
const MODEL = "qwen/qwen-2.5-7b-instruct";
const CHAIN_ID = 84532;

// ─── EIP-712 types ────────────────────────────────────────────

const INTENT_TYPES = {
  ComputeIntent: [
    { name: "owner", type: "address" },
    { name: "solver", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "token", type: "address" },
    { name: "model", type: "string" },
    { name: "promptHash", type: "bytes32" },
    { name: "quoteId", type: "string" },
    { name: "maxUsdc", type: "string" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

// ─── Types ────────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  cost?: string;
  jobId?: string;
}

type Step =
  | "idle"
  | "quoting"
  | "sign-intent"
  | "sign-permit"
  | "submitting";

// ─── Page ─────────────────────────────────────────────────────

export default function Page() {
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [nonce, setNonce] = useState(0);
  const [balance, setBalance] = useState<string | null>(null);
  const [spent, setSpent] = useState(0);

  const chatRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, step]);

  // USDC balance
  useEffect(() => {
    if (!address || !publicClient) return;
    (async () => {
      try {
        const [bal, dec] = await Promise.all([
          publicClient.readContract({
            address: USDC_ADDRESS,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [address],
          }),
          publicClient.readContract({
            address: USDC_ADDRESS,
            abi: ERC20_ABI,
            functionName: "decimals",
          }),
        ]);
        setBalance((Number(bal) / 10 ** Number(dec)).toFixed(2));
      } catch {
        setBalance(null);
      }
    })();
  }, [address, publicClient, messages]);

  // ─── Send flow ────────────────────────────────────────────

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || step !== "idle") return;

    if (!address) {
      setMessages((m) => [...m, { role: "system", content: "Connect your wallet first." }]);
      return;
    }
    if (!walletClient) {
      setMessages((m) => [
        ...m,
        { role: "system", content: "Wallet not ready — switch to Base Sepolia (chain 84532) and retry." },
      ]);
      return;
    }

    const userMsg: Message = { role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");

    try {
      // 1. Quote
      setStep("quoting");
      const qRes = await fetch(`${SOLVER_URL}/v1/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, prompt: text }),
      });
      if (!qRes.ok) throw new Error(`Quote error ${qRes.status}: ${await qRes.text()}`);
      const quote = await qRes.json();

      // 2. Build request payload + prompt hash
      const requestPayload = {
        model: MODEL,
        messages: history
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
      };
      const canonical = JSON.stringify({
        model: requestPayload.model,
        messages: requestPayload.messages,
      });
      const promptHash = keccak256(toBytes(canonical));

      const intent = {
        owner: address,
        solver: SOLVER_ADDRESS,
        chainId: CHAIN_ID,
        token: USDC_ADDRESS,
        model: MODEL,
        promptHash,
        quoteId: quote.quoteId,
        maxUsdc: quote.maxChargeUsdc,
        deadline: quote.expiresAt,
        nonce: String(nonce),
      };

      // 3. Sign intent (EIP-712, gasless)
      setStep("sign-intent");
      const intentSig = await walletClient.signTypedData({
        domain: {
          name: "0friction",
          version: "1",
          chainId: BigInt(CHAIN_ID),
          verifyingContract: "0x0000000000000000000000000000000000000001",
        },
        types: INTENT_TYPES,
        primaryType: "ComputeIntent",
        message: {
          ...intent,
          chainId: BigInt(CHAIN_ID),
          deadline: BigInt(intent.deadline),
          nonce: BigInt(intent.nonce),
        },
      });

      // 4. Read USDC domain + permit nonce from chain
      setStep("sign-permit");
      let usdcName = "USD Coin";
      let usdcVer = "2";
      let permitNonce = 0n;
      try {
        [usdcName, usdcVer, permitNonce] = await Promise.all([
          publicClient!.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "name" }),
          publicClient!.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "version" }),
          publicClient!.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "nonces", args: [address] }),
        ]);
      } catch { /* use defaults */ }

      const permit = {
        owner: address,
        spender: SOLVER_ADDRESS,
        value: quote.maxChargeUsdcAtomic,
        nonce: String(permitNonce),
        deadline: quote.expiresAt,
      };

      // Sign permit (EIP-2612, gasless)
      const permitSig = await walletClient.signTypedData({
        domain: {
          name: usdcName,
          version: usdcVer,
          chainId: BigInt(CHAIN_ID),
          verifyingContract: USDC_ADDRESS,
        },
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

      // 5. Submit to solver
      setStep("submitting");
      const sRes = await fetch(`${SOLVER_URL}/v1/intent/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          intentSignature: intentSig,
          permit,
          permitSignature: permitSig,
          requestPayload,
          quoteId: quote.quoteId,
        }),
      });
      if (!sRes.ok) throw new Error(`Submit error ${sRes.status}: ${await sRes.text()}`);
      const result = await sRes.json();

      setNonce((n) => n + 1);
      setSpent((s) => s + parseFloat(result.auditBundle?.chargedUsdc || "0"));
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: result.response || "[No response]",
          cost: result.auditBundle?.chargedUsdc,
          jobId: result.jobId,
        },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // User rejected signature — don't spam, just show clean message
      if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("denied")) {
        setMessages((m) => [...m, { role: "system", content: "Signature cancelled." }]);
      } else {
        setMessages((m) => [...m, { role: "system", content: `Error: ${msg}` }]);
      }
    } finally {
      setStep("idle");
    }
  }, [input, step, address, walletClient, publicClient, messages, nonce]);

  // Keyboard handler
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const busy = step !== "idle";
  const canSend = !!input.trim() && !!address && !busy;

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="shell">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="wordmark">0friction</span>
          <span className="tagline">AI compute via 0G · Pay with USDC</span>
        </div>
        <div className="header-right">
          {balance !== null && (
            <div className="badge">{balance} USDC</div>
          )}
          {spent > 0 && (
            <div className="badge warn">${spent.toFixed(4)} spent</div>
          )}
          {address ? (
            <button className="wallet-btn connected" onClick={() => disconnect()}>
              {address.slice(0, 6)}…{address.slice(-4)}
            </button>
          ) : (
            <button className="wallet-btn" onClick={() => connect({ connector: connectors[0] })}>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* Chat */}
      <div className="chat" ref={chatRef}>
        {messages.length === 0 && !busy && (
          <div className="empty">
            <div className="empty-icon">⚡</div>
            <h2>0friction</h2>
            <p>
              Chat with AI on 0G Compute Network. Pay per message with USDC on
              Base — no bridging, no gas, no A0GI tokens needed.
            </p>
            <div className="pill-row">
              <span className="pill">🔐 Gasless Signatures</span>
              <span className="pill">💰 USDC on Base</span>
              <span className="pill">⚡ 0G Compute</span>
              <span className="pill">🤖 qwen-2.5-7b</span>
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">{m.content}</div>
            {m.role === "assistant" && (m.cost || m.jobId) && (
              <div className="msg-meta">
                {m.cost && <span className="meta-cost">💳 ${m.cost} USDC</span>}
                {m.jobId && <span className="meta-model">{MODEL}</span>}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="progress-card">
            <div className={`progress-step ${step === "quoting" ? "active" : "done"}`}>
              {step === "quoting" ? <div className="spinner" /> : "✓"}
              <span>Getting price quote</span>
            </div>
            {step !== "quoting" && (
              <div className={`progress-step ${step === "sign-intent" ? "active" : "done"}`}>
                {step === "sign-intent" ? <div className="spinner" /> : "✓"}
                <span>Sign compute intent (EIP-712)</span>
              </div>
            )}
            {(step === "sign-permit" || step === "submitting") && (
              <div className={`progress-step ${step === "sign-permit" ? "active" : "done"}`}>
                {step === "sign-permit" ? <div className="spinner" /> : "✓"}
                <span>Sign USDC permit (EIP-2612)</span>
              </div>
            )}
            {step === "submitting" && (
              <div className="progress-step active">
                <div className="spinner" />
                <span>Running AI on 0G Compute…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="input-bar">
        <div className="input-row">
          <textarea
            ref={textRef}
            className="input-field"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={address ? "Message…" : "Connect wallet to start"}
            disabled={!address || busy}
          />
          <button className="send-btn" onClick={send} disabled={!canSend}>
            ↑
          </button>
        </div>
        <div className="input-hint">
          {address
            ? "Each message uses 2 gasless signatures · Powered by 0G Compute"
            : "Connect MetaMask on Base Sepolia (chain 84532)"}
        </div>
      </div>
    </div>
  );
}
