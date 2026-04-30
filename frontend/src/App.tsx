import { useState, useRef, useEffect } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useWalletClient,
} from "wagmi";
import { parseAbi, keccak256, toBytes } from "viem";
import { SOLVER_URL, USDC_ADDRESS, SOLVER_ADDRESS } from "./config";

// ─── Types ───────────────────────────────────────────────────

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  cost?: string;
  jobId?: string;
  status?: string;
  settlementTx?: string;
}

type SigningStep = "idle" | "quoting" | "signing-intent" | "signing-permit" | "submitting" | "done";

// ─── EIP-712 Types ───────────────────────────────────────────

const COMPUTE_INTENT_TYPES = {
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
  "function nonces(address owner) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

// ─── App ─────────────────────────────────────────────────────

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [signingStep, setSigningStep] = useState<SigningStep>("idle");
  const [balance, setBalance] = useState<string | null>(null);
  const [intentNonce, setIntentNonce] = useState(0);
  const [totalSpent, setTotalSpent] = useState(0);

  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, signingStep]);

  // Fetch USDC balance
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

  // ─── Send Message Flow ─────────────────────────────────────

  async function handleSend() {
    if (!input.trim() || !address || !walletClient || !publicClient || signingStep !== "idle") return;

    const userMessage = input.trim();
    setInput("");

    // Add user message
    const newMessages: Message[] = [...messages, { role: "user", content: userMessage }];
    setMessages(newMessages);

    try {
      // 1. Get quote
      setSigningStep("quoting");
      const quoteRes = await fetch(`${SOLVER_URL}/v1/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "qwen3.6-plus", prompt: userMessage }),
      });

      if (!quoteRes.ok) throw new Error(`Quote failed: ${await quoteRes.text()}`);
      const quote = await quoteRes.json();

      // 2. Build payload + prompt hash
      const chatMessages = newMessages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      const requestPayload = { model: "qwen3.6-plus", messages: chatMessages };
      const canonical = JSON.stringify({
        model: requestPayload.model,
        messages: requestPayload.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const promptHash = keccak256(toBytes(canonical));

      // 3. Build + sign intent
      setSigningStep("signing-intent");
      const intent = {
        owner: address,
        solver: SOLVER_ADDRESS,
        chainId: 84532,
        token: USDC_ADDRESS,
        model: "qwen3.6-plus",
        promptHash,
        quoteId: quote.quoteId,
        maxUsdc: quote.maxChargeUsdc,
        deadline: quote.expiresAt,
        nonce: String(intentNonce),
      };

      const intentSignature = await walletClient.signTypedData({
        domain: {
          name: "0friction",
          version: "1",
          chainId: 84532n,
          verifyingContract: "0x0000000000000000000000000000000000000001",
        },
        types: COMPUTE_INTENT_TYPES,
        primaryType: "ComputeIntent",
        message: {
          ...intent,
          chainId: 84532n,
          deadline: BigInt(intent.deadline),
          nonce: BigInt(intent.nonce),
        },
      });

      // 4. Build + sign permit
      setSigningStep("signing-permit");

      let usdcName = "USD Coin";
      let usdcVersion = "2";
      let permitNonce = 0n;
      try {
        [usdcName, usdcVersion, permitNonce] = await Promise.all([
          publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "name" }),
          publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "version" }),
          publicClient.readContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: "nonces", args: [address] }),
        ]);
      } catch { /* use defaults */ }

      const permit = {
        owner: address,
        spender: SOLVER_ADDRESS,
        value: quote.maxChargeUsdcAtomic,
        nonce: String(permitNonce),
        deadline: quote.expiresAt,
      };

      const permitSignature = await walletClient.signTypedData({
        domain: {
          name: usdcName,
          version: usdcVersion,
          chainId: 84532n,
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
      setSigningStep("submitting");
      const submitRes = await fetch(`${SOLVER_URL}/v1/intent/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          intentSignature,
          permit,
          permitSignature,
          requestPayload,
          quoteId: quote.quoteId,
        }),
      });

      if (!submitRes.ok) throw new Error(`Submit failed: ${await submitRes.text()}`);
      const result = await submitRes.json();

      setIntentNonce((n) => n + 1);
      setTotalSpent((t) => t + parseFloat(result.auditBundle?.chargedUsdc || "0"));

      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: result.response || "[No response]",
          cost: result.auditBundle?.chargedUsdc,
          jobId: result.jobId,
          status: result.status,
          settlementTx: result.auditBundle?.settlementTxHash,
        },
      ]);
    } catch (err: any) {
      setMessages([...newMessages, { role: "system", content: `Error: ${err.message}` }]);
    } finally {
      setSigningStep("idle");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ─── Render ────────────────────────────────────────────────

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-brand">
          <div>
            <h1>0friction</h1>
            <span className="tagline">AI compute via 0G · Paid in USDC</span>
          </div>
        </div>
        <div className="header-right">
          {balance && (
            <div className="balance-badge">
              <span>💰</span>
              <span>{balance} USDC</span>
            </div>
          )}
          {totalSpent > 0 && (
            <div className="balance-badge" style={{ color: "var(--warning)" }}>
              <span>📊</span>
              <span>${totalSpent.toFixed(4)} spent</span>
            </div>
          )}
          {isConnected ? (
            <button className="wallet-btn connected" onClick={() => disconnect()}>
              {address?.slice(0, 6)}...{address?.slice(-4)}
            </button>
          ) : (
            <button className="wallet-btn" onClick={() => connect({ connector: connectors[0] })}>
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* Chat Area */}
      <div className="chat-area" ref={chatRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="logo-big">0friction</div>
            <p>
              Chat with AI powered by 0G Compute. Pay per message with USDC on Base — no bridging, no gas, no A0GI tokens needed.
            </p>
            <div className="feature-tags">
              <span className="feature-tag">🔐 Gasless Signatures</span>
              <span className="feature-tag">💰 USDC Payments</span>
              <span className="feature-tag">⚡ 0G Compute</span>
              <span className="feature-tag">🔗 Base Sepolia</span>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-bubble">{msg.content}</div>
            {msg.role === "assistant" && (
              <div className="message-meta">
                {msg.cost && <span className="cost">💳 ${msg.cost} USDC</span>}
                {msg.jobId && <span className="status">📋 {msg.jobId}</span>}
                {msg.settlementTx && msg.settlementTx !== "pending" && !msg.settlementTx.startsWith("mock") && (
                  <span>🔗 {msg.settlementTx.slice(0, 10)}...</span>
                )}
              </div>
            )}
          </div>
        ))}

        {signingStep !== "idle" && (
          <div className="signing-status">
            <div className={`step ${signingStep === "quoting" ? "active" : "done"}`}>
              {signingStep === "quoting" ? <div className="spinner" /> : "✅"} Getting price quote...
            </div>
            {(signingStep === "signing-intent" || signingStep === "signing-permit" || signingStep === "submitting") && (
              <div className={`step ${signingStep === "signing-intent" ? "active" : "done"}`}>
                {signingStep === "signing-intent" ? <div className="spinner" /> : "✅"} Sign compute intent
              </div>
            )}
            {(signingStep === "signing-permit" || signingStep === "submitting") && (
              <div className={`step ${signingStep === "signing-permit" ? "active" : "done"}`}>
                {signingStep === "signing-permit" ? <div className="spinner" /> : "✅"} Sign USDC permit
              </div>
            )}
            {signingStep === "submitting" && (
              <div className="step active">
                <div className="spinner" /> Executing AI compute on 0G...
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="input-area">
        <div className="input-row">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? "Type your message..." : "Connect wallet to start chatting"}
            disabled={!isConnected || signingStep !== "idle"}
            rows={1}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!input.trim() || !isConnected || signingStep !== "idle"}
          >
            ↑
          </button>
        </div>
        <div className="input-hint">
          Powered by 0G Compute · Each message requires 2 wallet signatures (gasless)
        </div>
      </div>
    </div>
  );
}
