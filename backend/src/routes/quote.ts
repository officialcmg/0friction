import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config.js";
import { storeQuote, type StoredQuote } from "../store.js";

const router = Router();

/**
 * POST /v1/quote
 *
 * Returns a signed price quote for a compute request.
 * The user uses this quote to build their intent + permit signatures.
 */
router.post("/", (req, res) => {
  try {
    const { model, prompt } = req.body;

    if (!model || !prompt) {
      return res.status(400).json({ error: "model and prompt are required" });
    }

    // Estimate tokens (rough: ~4 chars per token)
    const estimatedInputTokens = Math.ceil(prompt.length / 4);
    const estimatedOutputTokens = 400; // conservative cap for v1

    // Pricing formula from REQUIREMENTS_STAGE_QUOTING.md
    // qwen3.6-plus (≤256k): input 0.80 A0GI/1M, output 4.80 A0GI/1M
    const inPriceA0gi = 0.80;
    const outPriceA0gi = 4.80;

    const costA0gi =
      (estimatedInputTokens / 1_000_000) * inPriceA0gi +
      (estimatedOutputTokens / 1_000_000) * outPriceA0gi;

    const maxChargeUsdc =
      costA0gi * config.a0giToUsdc * (1 + config.riskMargin) + config.feeFloor;

    // Round to 6 decimal places (USDC precision)
    const maxChargeUsdcStr = maxChargeUsdc.toFixed(6);
    // Convert to atomic units (6 decimals)
    const maxChargeUsdcAtomic = Math.ceil(maxChargeUsdc * 1_000_000).toString();

    const expiresAt = Math.floor(Date.now() / 1000) + config.quoteTtlSeconds;
    const quoteId = `quote_${uuidv4().slice(0, 8)}`;

    // For v1, signature is a simple hash (proper EIP-712 signing in production)
    const signature = `0x${"00".repeat(65)}` as string;

    const quote: StoredQuote = {
      quoteId,
      model: model || config.defaultModel,
      provider: config.defaultProviderAddress,
      estimatedInputTokens,
      estimatedOutputTokens,
      maxChargeUsdc: maxChargeUsdcStr,
      maxChargeUsdcAtomic,
      expiresAt,
      signature,
      used: false,
    };

    storeQuote(quote);

    console.log(`📋 Quote ${quoteId}: ${estimatedInputTokens} in / ${estimatedOutputTokens} out → $${maxChargeUsdcStr} USDC`);

    return res.json({
      quoteId: quote.quoteId,
      model: quote.model,
      provider: quote.provider,
      estimatedInputTokens: quote.estimatedInputTokens,
      estimatedOutputTokens: quote.estimatedOutputTokens,
      maxChargeUsdc: quote.maxChargeUsdc,
      maxChargeUsdcAtomic: quote.maxChargeUsdcAtomic,
      expiresAt: quote.expiresAt,
      signature: quote.signature,
    });
  } catch (err: any) {
    console.error("Quote error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export { router as quoteRouter };
