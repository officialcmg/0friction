// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IntentRegistry
 * @notice Minimal on-chain audit log for 0friction compute intents.
 *
 * The solver calls recordIntent() after each successful compute job,
 * creating an immutable on-chain record that links:
 *   - the user who requested compute
 *   - the intent hash (EIP-712 signature digest)
 *   - the model used
 *   - the USDC amount charged
 *   - the settlement transaction hash on the home chain
 */
contract IntentRegistry {
    event IntentFulfilled(
        address indexed owner,
        bytes32 indexed intentHash,
        string model,
        uint256 maxUsdc,
        uint256 chargedUsdc,
        bytes32 settlementTxHash,
        uint256 timestamp
    );

    address public solver;
    uint256 public totalIntents;

    struct IntentRecord {
        address owner;
        bytes32 intentHash;
        string model;
        uint256 maxUsdc;
        uint256 chargedUsdc;
        bytes32 settlementTxHash;
        uint256 timestamp;
    }

    mapping(bytes32 => IntentRecord) public intents;
    mapping(address => uint256) public userIntentCount;

    modifier onlySolver() {
        require(msg.sender == solver, "not solver");
        _;
    }

    constructor() {
        solver = msg.sender;
    }

    function recordIntent(
        address owner,
        bytes32 intentHash,
        string calldata model,
        uint256 maxUsdc,
        uint256 chargedUsdc,
        bytes32 settlementTxHash
    ) external onlySolver {
        require(intents[intentHash].timestamp == 0, "already recorded");

        intents[intentHash] = IntentRecord({
            owner: owner,
            intentHash: intentHash,
            model: model,
            maxUsdc: maxUsdc,
            chargedUsdc: chargedUsdc,
            settlementTxHash: settlementTxHash,
            timestamp: block.timestamp
        });

        userIntentCount[owner]++;
        totalIntents++;

        emit IntentFulfilled(owner, intentHash, model, maxUsdc, chargedUsdc, settlementTxHash, block.timestamp);
    }

    function isIntentRecorded(bytes32 intentHash) external view returns (bool) {
        return intents[intentHash].timestamp > 0;
    }

    function transferSolver(address newSolver) external onlySolver {
        solver = newSolver;
    }
}
