/**
 * CommonJS shim for @0gfoundation/0g-compute-ts-sdk.
 * tsx intercepts dynamic ESM imports incorrectly, but require() works.
 * This file is .js so Node loads it as pure CJS regardless of tsx.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sdk = require("@0gfoundation/0g-compute-ts-sdk");

module.exports = {
  createZGComputeNetworkBroker: sdk.createZGComputeNetworkBroker,
};
