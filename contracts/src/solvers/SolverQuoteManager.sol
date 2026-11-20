// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

import { SolverLiquidityVault } from "./SolverLiquidityVault.sol";
import { SolverRegistry } from "./SolverRegistry.sol";
import { BastionPolicyRegistry } from "../policies/BastionPolicyRegistry.sol";

/// @title SolverQuoteManager
/// @notice Deterministic, order-independent on-chain selection among executable solver commitments. Requires no
///         off-chain coordinator at rescue time.
/// @dev Ranking (strict total order):
///      1. Full coverage (amount >= required) before partial coverage.
///      2. Lower feeBps (cheaper for the user).
///      3. Larger committed amount (stronger commitment / more headroom).
///      4. Lower solver failure count (historical reliability).
///      5. Lower commitment id (deterministic tie-break).
contract SolverQuoteManager {
    struct Candidate {
        bytes32 id;
        address solver;
        uint256 amount;
        uint16 feeBps;
        uint64 failures;
    }

    SolverLiquidityVault public immutable VAULT;
    SolverRegistry public immutable SOLVERS;
    BastionPolicyRegistry public immutable POLICIES;

    constructor(SolverLiquidityVault vault_, SolverRegistry solvers_, BastionPolicyRegistry policies_) {
        VAULT = vault_;
        SOLVERS = solvers_;
        POLICIES = policies_;
    }

    /// @notice Returns all currently executable candidates for a policy, best first.
    function rankedCandidates(bytes32 policyId, address token, uint256 required, uint16 maxFeeBps)
        public
        view
        returns (Candidate[] memory out)
    {
        bytes32[] memory ids = VAULT.commitmentsOf(policyId);
        Candidate[] memory tmp = new Candidate[](ids.length);
        uint256 n;
        for (uint256 i; i < ids.length; ++i) {
            SolverLiquidityVault.Commitment memory c = VAULT.getCommitment(ids[i]);
            if (!c.active || c.amount == 0 || c.expiry <= block.timestamp || c.token != token) continue;
            if (c.feeBps > maxFeeBps) continue;
            if (!SOLVERS.isEligible(c.solver)) continue;
            if (!POLICIES.isSolverAllowed(policyId, c.solver)) continue;
            tmp[n++] = Candidate(ids[i], c.solver, c.amount, c.feeBps, SOLVERS.getSolver(c.solver).failures);
        }
        // insertion sort (n <= MAX_COMMITMENTS_PER_POLICY)
        for (uint256 i = 1; i < n; ++i) {
            Candidate memory key = tmp[i];
            uint256 j = i;
            while (j > 0 && _better(key, tmp[j - 1], required)) {
                tmp[j] = tmp[j - 1];
                --j;
            }
            tmp[j] = key;
        }
        out = new Candidate[](n);
        for (uint256 i; i < n; ++i) {
            out[i] = tmp[i];
        }
    }

    function selectBest(bytes32 policyId, address token, uint256 required, uint16 maxFeeBps)
        external
        view
        returns (bool found, Candidate memory best)
    {
        Candidate[] memory c = rankedCandidates(policyId, token, required, maxFeeBps);
        if (c.length == 0) return (false, best);
        return (true, c[0]);
    }

    function _better(Candidate memory a, Candidate memory b, uint256 required) internal pure returns (bool) {
        bool aFull = a.amount >= required;
        bool bFull = b.amount >= required;
        if (aFull != bFull) return aFull;
        if (a.feeBps != b.feeBps) return a.feeBps < b.feeBps;
        if (a.amount != b.amount) return a.amount > b.amount;
        if (a.failures != b.failures) return a.failures < b.failures;
        return uint256(a.id) < uint256(b.id);
    }
}
