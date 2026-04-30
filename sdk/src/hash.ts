import { keccak256, toBytes } from "viem";

/**
 * Compute a deterministic keccak256 hash of a request payload.
 *
 * Uses canonical JSON serialization (stable key order, explicit fields)
 * to ensure the same payload always produces the same hash — regardless
 * of property ordering or extra whitespace.
 */
export function hashPayload(payload: {
  model: string;
  messages: Array<{ role: string; content: string }>;
}): `0x${string}` {
  const canonical = JSON.stringify({
    model: payload.model,
    messages: payload.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });
  return keccak256(toBytes(canonical));
}
