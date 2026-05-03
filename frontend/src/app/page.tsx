"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useWalletClient,
  useSwitchChain,
} from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { parseAbi, keccak256, toBytes } from "viem";

// ─── Constants ────────────────────────────────────────────────

const SOLVER_URL = process.env.NEXT_PUBLIC_SOLVER_URL || "http://localhost:3001";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`;
const SOLVER_ADDRESS = (
  process.env.NEXT_PUBLIC_SOLVER_ADDRESS ||
  "0xB9a33C169d1360E6AdFf7266797f85467856bCc2"
) as `0x${string}`;
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

type Step = "idle" | "switching-chain" | "quoting" | "sign-intent" | "sign-permit" | "submitting";

// ─── Page ─────────────────────────────────────────────────────

export default function Page() {
  const { address, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
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
  const isConnected = !!address;
  const isWrongChain = isConnected && chainId !== CHAIN_ID;

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
          publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
          publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "decimals" }),
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

    // Auto-switch chain if on wrong network
    if (chainId !== CHAIN_ID) {
      setStep("switching-chain");
      try {
        await switchChain({ chainId: CHAIN_ID });
        // Brief wait for walletClient to update
        await new Promise((r) => setTimeout(r, 800));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((m) => [...m, { role: "system", content: `Could not switch to Base Sepolia: ${msg}` }]);
        setStep("idle");
        return;
      }
    }

    if (!walletClient) {
      setMessages((m) => [...m, { role: "system", content: "Wallet not ready — please try again." }]);
      setStep("idle");
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
      if (!qRes.ok) throw new Error(`Quote failed: ${await qRes.text()}`);
      const quote = await qRes.json();

      // 2. Build payload + prompt hash
      const requestPayload = {
        model: MODEL,
        messages: history
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
      };
      const promptHash = keccak256(
        toBytes(JSON.stringify({ model: requestPayload.model, messages: requestPayload.messages }))
      );

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

      // 3. Sign compute intent (EIP-712, gasless)
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

      // 4. Read USDC nonce + domain, sign permit (EIP-2612, gasless)
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

      const permitSig = await walletClient.signTypedData({
        domain: { name: usdcName, version: usdcVer, chainId: BigInt(CHAIN_ID), verifyingContract: USDC_ADDRESS },
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

      // 5. Submit to solver → triggers real 0G compute + USDC settlement
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
      if (!sRes.ok) throw new Error(`Submit failed (${sRes.status}): ${await sRes.text()}`);
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
      if (msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("denied")) {
        setMessages((m) => [...m, { role: "system", content: "Signature cancelled." }]);
      } else {
        setMessages((m) => [...m, { role: "system", content: `Error: ${msg}` }]);
      }
    } finally {
      setStep("idle");
    }
  }, [input, step, address, chainId, walletClient, publicClient, messages, nonce, switchChain]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const busy = step !== "idle";
  const canSend = !!input.trim() && !!address && !busy;
  const hasMessages = messages.length > 0 || busy;

  // ─── Render ───────────────────────────────────────────────

  return (
    <div className="shell">

      {/* ── Header ── */}
      <header className="header">
        <div className="header-brand">
          <div className="brand-icon">⚡</div>
          <div className="brand-text">
            <span className="brand-name">0friction</span>
            <span className="brand-sub">AI compute via 0G</span>
          </div>
        </div>
        <div className="header-right">
          {balance !== null && (
            <div className="badge-usdc">
              <span>💰</span>
              <span>{balance} USDC</span>
            </div>
          )}
          {spent > 0 && (
            <div className="badge-spent">
              <span>${spent.toFixed(4)} spent</span>
            </div>
          )}
          {address ? (
            <button className="wallet-btn connected" onClick={() => disconnect()}>
              <span>●</span>
              {address.slice(0, 6)}…{address.slice(-4)}
            </button>
          ) : (
            <button className="wallet-btn" onClick={() => connect({ connector: connectors[0] })}>
              <span>🔗</span>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* ── Chat / Landing ── */}
      <div className="chat" ref={chatRef}>
        {!hasMessages ? (
          <div className="landing">
            <div className="landing-icon-wrap">
              <div className="landing-icon">⚡</div>
              <div className="landing-icon-dot" />
            </div>

            <h1>AI Without the Friction</h1>

            <p className="landing-sub">
              Chat with AI on 0G Compute Network. Pay per message with
              USDC on Base — no bridging, no gas, no tokens needed.
            </p>

            <div className="pills">
              <span className="pill"><span className="pill-icon">🔐</span> Gasless Signatures</span>
              <span className="pill"><span className="pill-icon">💰</span> USDC on Base</span>
              <span className="pill"><span className="pill-icon">⚡</span> 0G Compute</span>
              <span className="pill"><span className="pill-icon">🤖</span> qwen-2.5-7b</span>
            </div>

            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-card-icon">⚡</div>
                <h3>Instant Access</h3>
                <p>No sign-ups or subscriptions. Just connect and start chatting.</p>
              </div>
              <div className="feature-card">
                <div className="feature-card-icon">💳</div>
                <h3>Pay Per Use</h3>
                <p>Only pay for what you use. Transparent pricing per message.</p>
              </div>
              <div className="feature-card">
                <div className="feature-card-icon">🤖</div>
                <h3>Powerful Models</h3>
                <p>Access state-of-the-art AI models via decentralized compute.</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="messages">
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="bubble">{m.content}</div>
                {m.role === "assistant" && m.cost && (
                  <div className="msg-meta">
                    <span className="meta-cost">💳 ${m.cost} USDC</span>
                    <span>{MODEL}</span>
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="progress-card">
                {step === "switching-chain" && (
                  <div className="progress-step active">
                    <div className="spinner" />
                    <span>Switching to Base Sepolia…</span>
                  </div>
                )}
                {step !== "switching-chain" && (
                  <div className={`progress-step ${step === "quoting" ? "active" : "done"}`}>
                    {step === "quoting" ? <div className="spinner" /> : "✓"}
                    <span>Getting price quote</span>
                  </div>
                )}
                {(step === "sign-intent" || step === "sign-permit" || step === "submitting") && (
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
        )}
      </div>

      {/* ── Input bar ── */}
      <div className="input-bar">
        <div className="input-inner">
          <div className="input-row">
            <textarea
              ref={textRef}
              className="input-field"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={
                !address
                  ? "Connect wallet to start"
                  : isWrongChain
                  ? "Wrong network — will auto-switch on send"
                  : "Message…"
              }
              disabled={!address || busy}
            />
            <button className="send-btn" onClick={send} disabled={!canSend}>
              ↑
            </button>
          </div>

          <div className="status-bar">
            <div className="status-dot" />
            <span>Base Sepolia (Chain 84532)</span>
            <span>·</span>
            <span>~$0.001 per message</span>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="footer">
        <div className="footer-left">
          <span>⚡</span>
          <span>Powered by 0G Compute Network</span>
        </div>
        <div className="footer-right">
          <a
            href="https://github.com/officialcmg/0friction"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            GitHub <span>›</span>
          </a>
          <a
            href="https://0g.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-link"
          >
            0G Network <span>›</span>
          </a>
        </div>
      </footer>
    </div>
  );
}
