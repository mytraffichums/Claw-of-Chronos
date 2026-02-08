// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/ChronosCore.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockCHRN is ERC20 {
    constructor() ERC20("Chronos", "CHRN") {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ChronosCoreTest is Test {
    ChronosCore public core;
    MockCHRN public token;

    address creator = address(0x1);
    address agent1 = address(0x2);
    address agent2 = address(0x3);
    address agent3 = address(0x4);

    uint256 constant BOUNTY = 100e18;

    // Phase durations
    uint256 constant REG = 60;
    uint256 constant DELIB = 120;
    uint256 constant COMMIT = 60;
    uint256 constant REVEAL = 60;

    string[] options;

    function setUp() public {
        token = new MockCHRN();
        core = new ChronosCore(address(token));

        // Fund creator
        token.transfer(creator, BOUNTY * 10);

        // Approve
        vm.prank(creator);
        token.approve(address(core), type(uint256).max);

        options.push("Option A");
        options.push("Option B");
        options.push("Option C");
    }

    // ── Helpers ────────────────────────────────────────────────────────
    function _createTask() internal returns (uint256) {
        vm.prank(creator);
        return core.createTask("Test task", options, BOUNTY, 5, REG, DELIB, COMMIT, REVEAL);
    }

    function _joinTask(uint256 taskId, address agent) internal {
        vm.prank(agent);
        core.joinTask(taskId);
    }

    function _computeCommit(uint256 taskId, uint256 optionIndex, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(taskId, optionIndex, salt));
    }

    // ── Test full lifecycle ────────────────────────────────────────────
    function test_fullLifecycle() public {
        uint256 taskId = _createTask();

        // Verify task created
        assertEq(core.taskCount(), 1);
        assertEq(token.balanceOf(address(core)), BOUNTY);

        // Join
        _joinTask(taskId, agent1);
        _joinTask(taskId, agent2);
        _joinTask(taskId, agent3);
        assertEq(core.agentCount(taskId), 3);

        // Skip to commit phase
        vm.warp(block.timestamp + REG + DELIB + 1);

        // All agents commit for option 0 (majority)
        bytes32 salt1 = bytes32(uint256(111));
        bytes32 salt2 = bytes32(uint256(222));
        bytes32 salt3 = bytes32(uint256(333));

        vm.prank(agent1);
        core.commit(taskId, _computeCommit(taskId, 0, salt1));
        vm.prank(agent2);
        core.commit(taskId, _computeCommit(taskId, 0, salt2));
        vm.prank(agent3);
        core.commit(taskId, _computeCommit(taskId, 1, salt3));

        // Skip to reveal phase
        vm.warp(block.timestamp + COMMIT + 1);

        vm.prank(agent1);
        core.reveal(taskId, 0, salt1);
        vm.prank(agent2);
        core.reveal(taskId, 0, salt2);
        vm.prank(agent3);
        core.reveal(taskId, 1, salt3);

        assertEq(core.revealCount(taskId), 3);

        // Skip past reveal
        vm.warp(block.timestamp + REVEAL + 1);

        // Resolve
        core.resolve(taskId);

        // Check result
        (,,,,,,,,, ChronosCore.Phase phase, bool resolved, uint256 winOpt, bool isTie) = core.getTask(taskId);
        assertEq(uint256(phase), uint256(ChronosCore.Phase.Resolved));
        assertTrue(resolved);
        assertEq(winOpt, 0);
        assertFalse(isTie);

        // Claim bounty — agent1 and agent2 should get 50e18 each
        uint256 bal1Before = token.balanceOf(agent1);
        vm.prank(agent1);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent1) - bal1Before, 50e18);

        vm.prank(agent2);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent2), 50e18);

        // Agent3 voted for losing option — should revert
        vm.prank(agent3);
        vm.expectRevert(ChronosCore.NotWinner.selector);
        core.claimBounty(taskId);
    }

    // ── Test tie ───────────────────────────────────────────────────────
    function test_tie() public {
        uint256 taskId = _createTask();

        _joinTask(taskId, agent1);
        _joinTask(taskId, agent2);

        vm.warp(block.timestamp + REG + DELIB + 1);

        bytes32 salt1 = bytes32(uint256(111));
        bytes32 salt2 = bytes32(uint256(222));

        vm.prank(agent1);
        core.commit(taskId, _computeCommit(taskId, 0, salt1));
        vm.prank(agent2);
        core.commit(taskId, _computeCommit(taskId, 1, salt2));

        vm.warp(block.timestamp + COMMIT + 1);

        vm.prank(agent1);
        core.reveal(taskId, 0, salt1);
        vm.prank(agent2);
        core.reveal(taskId, 1, salt2);

        vm.warp(block.timestamp + REVEAL + 1);

        core.resolve(taskId);

        (,,,,,,,,,, bool resolved,, bool isTie) = core.getTask(taskId);
        assertTrue(resolved);
        assertTrue(isTie);

        // Both should be able to claim, 50 each
        vm.prank(agent1);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent1), 50e18);

        vm.prank(agent2);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent2), 50e18);
    }

    // ── Test no reveals → creator claims ───────────────────────────────
    function test_noReveals_creatorClaims() public {
        uint256 taskId = _createTask();

        _joinTask(taskId, agent1);

        // Skip through all phases, agent never commits/reveals
        vm.warp(block.timestamp + REG + DELIB + COMMIT + REVEAL + 1);

        uint256 balBefore = token.balanceOf(creator);
        vm.prank(creator);
        core.claimExpired(taskId);
        assertEq(token.balanceOf(creator) - balBefore, BOUNTY);
    }

    // ── Test no agents joined → creator claims ─────────────────────────
    function test_noAgents_creatorClaims() public {
        uint256 taskId = _createTask();

        // Skip past registration
        vm.warp(block.timestamp + REG + 1);

        uint256 balBefore = token.balanceOf(creator);
        vm.prank(creator);
        core.claimExpired(taskId);
        assertEq(token.balanceOf(creator) - balBefore, BOUNTY);
    }

    // ── Test wrong phase reverts ───────────────────────────────────────
    function test_joinAfterRegistration_reverts() public {
        uint256 taskId = _createTask();
        vm.warp(block.timestamp + REG + 1);

        vm.prank(agent1);
        vm.expectRevert(ChronosCore.WrongPhase.selector);
        core.joinTask(taskId);
    }

    function test_commitBeforeCommitPhase_reverts() public {
        uint256 taskId = _createTask();
        _joinTask(taskId, agent1);

        vm.prank(agent1);
        vm.expectRevert(ChronosCore.WrongPhase.selector);
        core.commit(taskId, bytes32(0));
    }

    function test_doubleJoin_reverts() public {
        uint256 taskId = _createTask();
        _joinTask(taskId, agent1);

        vm.prank(agent1);
        vm.expectRevert(ChronosCore.AlreadyJoined.selector);
        core.joinTask(taskId);
    }

    function test_invalidOptionCount_reverts() public {
        string[] memory badOptions = new string[](1);
        badOptions[0] = "Only one";

        vm.prank(creator);
        vm.expectRevert(ChronosCore.InvalidOptionCount.selector);
        core.createTask("Bad task", badOptions, BOUNTY, 5, REG, DELIB, COMMIT, REVEAL);
    }

    // ── Test zero maxAgents reverts ────────────────────────────────────
    function test_zeroMaxAgents_reverts() public {
        vm.prank(creator);
        vm.expectRevert(ChronosCore.ZeroMaxAgents.selector);
        core.createTask("Bad task", options, BOUNTY, 0, REG, DELIB, COMMIT, REVEAL);
    }

    // ── Test zero duration reverts ──────────────────────────────────────
    function test_zeroDuration_reverts() public {
        vm.prank(creator);
        vm.expectRevert(ChronosCore.ZeroDuration.selector);
        core.createTask("Bad task", options, BOUNTY, 5, 0, DELIB, COMMIT, REVEAL);

        vm.prank(creator);
        vm.expectRevert(ChronosCore.ZeroDuration.selector);
        core.createTask("Bad task", options, BOUNTY, 5, REG, 0, COMMIT, REVEAL);

        vm.prank(creator);
        vm.expectRevert(ChronosCore.ZeroDuration.selector);
        core.createTask("Bad task", options, BOUNTY, 5, REG, DELIB, 0, REVEAL);

        vm.prank(creator);
        vm.expectRevert(ChronosCore.ZeroDuration.selector);
        core.createTask("Bad task", options, BOUNTY, 5, REG, DELIB, COMMIT, 0);
    }

    // ── Test single voter gets full bounty ──────────────────────────────
    function test_singleVoter_fullBounty() public {
        uint256 taskId = _createTask();

        _joinTask(taskId, agent1);

        vm.warp(block.timestamp + REG + DELIB + 1);

        bytes32 salt1 = bytes32(uint256(111));
        vm.prank(agent1);
        core.commit(taskId, _computeCommit(taskId, 0, salt1));

        vm.warp(block.timestamp + COMMIT + 1);
        vm.prank(agent1);
        core.reveal(taskId, 0, salt1);

        vm.warp(block.timestamp + REVEAL + 1);
        core.resolve(taskId);

        uint256 balBefore = token.balanceOf(agent1);
        vm.prank(agent1);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent1) - balBefore, BOUNTY);
    }

    // ── Test invalid optionIndex in reveal ──────────────────────────────
    function test_invalidOptionIndex_reverts() public {
        uint256 taskId = _createTask();
        _joinTask(taskId, agent1);

        vm.warp(block.timestamp + REG + DELIB + 1);

        // Commit with out-of-bounds option index (99)
        bytes32 salt1 = bytes32(uint256(111));
        bytes32 badCommit = keccak256(abi.encodePacked(taskId, uint256(99), salt1));
        vm.prank(agent1);
        core.commit(taskId, badCommit);

        vm.warp(block.timestamp + COMMIT + 1);

        // Reveal with the matching invalid option — should revert with InvalidReveal
        vm.prank(agent1);
        vm.expectRevert(ChronosCore.InvalidReveal.selector);
        core.reveal(taskId, 99, salt1);
    }

    // ── Test claimExpired during deliberation with no agents ─────────────
    function test_claimExpired_noAgents_duringDelib() public {
        uint256 taskId = _createTask();

        // Skip past registration into deliberation — no one joined
        vm.warp(block.timestamp + REG + 1);

        uint256 balBefore = token.balanceOf(creator);
        vm.prank(creator);
        core.claimExpired(taskId);
        assertEq(token.balanceOf(creator) - balBefore, BOUNTY);
    }

    function test_resolveBeforeRevealEnd_reverts() public {
        uint256 taskId = _createTask();
        _joinTask(taskId, agent1);

        vm.warp(block.timestamp + REG + DELIB + 1);

        bytes32 salt1 = bytes32(uint256(111));
        vm.prank(agent1);
        core.commit(taskId, _computeCommit(taskId, 0, salt1));

        vm.warp(block.timestamp + COMMIT + 1);
        vm.prank(agent1);
        core.reveal(taskId, 0, salt1);

        // Still in reveal phase — resolve should revert
        vm.expectRevert(ChronosCore.WrongPhase.selector);
        core.resolve(taskId);
    }
}
