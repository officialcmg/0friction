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
 *
 * This serves as:
 *   1. A transparency/audit mechanism (users can verify their charges)
 *   2. A dispute anchor (intent hashes are independently verifiable)
 *   3. A submission requirement (deployed contract address for EthGlobal)
 */
contract IntentRegistry {
    // ─── Events ──────────────────────────────────────────────

    event IntentFulfilled(
        address indexed owner,
        bytes32 indexed intentHash,
        string model,
        uint256 maxUsdc,
        uint256 chargedUsdc,
        bytes32 settlementTxHash,
        uint256 timestamp
    );

    // ─── State ───────────────────────────────────────────────

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

    // ─── Modifiers ───────────────────────────────────────────

    modifier onlySolver() {
        require(msg.sender == solver, "IntentRegistry: caller is not the solver");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────

    constructor() {
        solver = msg.sender;
    }

    // ─── Functions ───────────────────────────────────────────

    /**
     * @notice Record a fulfilled compute intent on-chain.
     * @param owner The user who requested the compute.
     * @param intentHash The EIP-712 digest of the ComputeIntent struct.
     * @param model The AI model used (e.g. "qwen3.6-plus").
     * @param maxUsdc The maximum USDC the user authorized (in atomic units, 6 decimals).
     * @param chargedUsdc The actual USDC charged (in atomic units, 6 decimals).
     * @param settlementTxHash The transaction hash of the USDC settlement on the home chain.
     */
    function recordIntent(
        address owner,
        bytes32 intentHash,
        string calldata model,
        uint256 maxUsdc,
        uint256 chargedUsdc,
        bytes32 settlementTxHash
    ) external onlySolver {
        require(intents[intentHash].timestamp == 0, "IntentRegistry: intent already recorded");

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

        emit IntentFulfilled(
            owner,
            intentHash,
            model,
            maxUsdc,
            chargedUsdc,
            settlementTxHash,
            block.timestamp
        );
    }

    /**
     * @notice Check if an intent has been recorded.
     */
    function isIntentRecorded(bytes32 intentHash) external view returns (bool) {
        return intents[intentHash].timestamp > 0;
    }

    /**
     * @notice Transfer solver role (for key rotation).
     */
    function transferSolver(address newSolver) external onlySolver {
        solver = newSolver;
    }
}
