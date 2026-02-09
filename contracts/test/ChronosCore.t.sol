// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/ChronosCore.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockCOC is ERC20 {
    constructor() ERC20("Claw of Chronos", "COC") {
        _mint(msg.sender, 1_000_000e18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ChronosCoreTest is Test {
    ChronosCore core;
    MockCOC token;

    address creator = address(0x1);
    address agent1 = address(0x2);
    address agent2 = address(0x3);
    address agent3 = address(0x4);

    uint256 constant REQUIRED_AGENTS = 3;
    uint256 constant DELIB = 300;
    uint256 constant BOUNTY_PER_AGENT = 1000e18;
    uint256 constant COMMIT = 60;
    uint256 constant REVEAL = 60;

    string[] options;

    function setUp() public {
        token = new MockCOC();
        core = new ChronosCore(address(token));

        uint256 totalBounty = REQUIRED_AGENTS * BOUNTY_PER_AGENT;
        token.transfer(creator, totalBounty * 10);

        vm.prank(creator);
        token.approve(address(core), type(uint256).max);

        options.push("Option A");
        options.push("Option B");
        options.push("Option C");
    }

    // ── Helpers ────────────────────────────────────────────────────────
    function _createTask() internal returns (uint256) {
        vm.prank(creator);
        return core.createTask("Test task", options, REQUIRED_AGENTS, DELIB);
    }

    function _joinTask(uint256 taskId, address agent) internal {
        vm.prank(agent);
        core.joinTask(taskId);
    }

    function _computeCommit(uint256 taskId, uint256 optionIndex, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(taskId, optionIndex, salt));
    }

    // ── Tests ──────────────────────────────────────────────────────────

    function test_fullLifecycle() public {
        uint256 taskId = _createTask();
        uint256 expectedBounty = REQUIRED_AGENTS * BOUNTY_PER_AGENT;
        assertEq(token.balanceOf(address(core)), expectedBounty);

        _joinTask(taskId, agent1);
        _joinTask(taskId, agent2);
        _joinTask(taskId, agent3);

        (,,,,,,uint256 delibStart, ChronosCore.Phase phase,,,,) = core.getTask(taskId);
        assertEq(uint256(phase), uint256(ChronosCore.Phase.Deliberation));
        assertTrue(delibStart > 0);

        vm.warp(block.timestamp + DELIB + 1);

        bytes32 salt1 = bytes32(uint256(111));
        bytes32 salt2 = bytes32(uint256(222));
        bytes32 salt3 = bytes32(uint256(333));

        vm.prank(agent1);
        core.commit(taskId, _computeCommit(taskId, 0, salt1));
        vm.prank(agent2);
        core.commit(taskId, _computeCommit(taskId, 0, salt2));
        vm.prank(agent3);
        core.commit(taskId, _computeCommit(taskId, 1, salt3));

        vm.warp(block.timestamp + COMMIT + 1);

        vm.prank(agent1);
        core.reveal(taskId, 0, salt1);
        vm.prank(agent2);
        core.reveal(taskId, 0, salt2);
        vm.prank(agent3);
        core.reveal(taskId, 1, salt3);

        vm.warp(block.timestamp + REVEAL + 1);

        core.resolve(taskId);

        vm.prank(agent1);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent1), expectedBounty / 2);

        vm.prank(agent2);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent2), expectedBounty / 2);

        vm.prank(agent3);
        vm.expectRevert(ChronosCore.NotWinner.selector);
        core.claimBounty(taskId);
    }

    function test_cancelBeforeAnyAgents() public {
        uint256 balBefore = token.balanceOf(creator);
        uint256 taskId = _createTask();
        uint256 expectedBounty = REQUIRED_AGENTS * BOUNTY_PER_AGENT;
        assertEq(token.balanceOf(creator), balBefore - expectedBounty);

        vm.prank(creator);
        core.cancelTask(taskId);

        assertEq(token.balanceOf(creator), balBefore);

        (,,,,,,, ChronosCore.Phase phase,, bool cancelled,,) = core.getTask(taskId);
        assertTrue(cancelled);
        assertEq(uint256(phase), uint256(ChronosCore.Phase.Resolved));
    }

    function test_cancelAfterSomeAgents() public {
        uint256 balBefore = token.balanceOf(creator);
        uint256 taskId = _createTask();

        _joinTask(taskId, agent1);
        _joinTask(taskId, agent2);

        vm.prank(creator);
        core.cancelTask(taskId);

        assertEq(token.balanceOf(creator), balBefore);
    }

    function test_cannotCancelAfterDeliberation() public {
        uint256 taskId = _createTask();

        _joinTask(taskId, agent1);
        _joinTask(taskId, agent2);
        _joinTask(taskId, agent3);

        vm.prank(creator);
        vm.expectRevert(ChronosCore.WrongPhase.selector);
        core.cancelTask(taskId);
    }

    function test_creatorJoinsOwnTask() public {
        vm.prank(creator);
        uint256 taskId = core.createTask("Creator joins", options, 2, DELIB);

        vm.prank(creator);
        core.joinTask(taskId);

        _joinTask(taskId, agent1);

        (,,,,,,uint256 delibStart, ChronosCore.Phase phase,,,,) = core.getTask(taskId);
        assertEq(uint256(phase), uint256(ChronosCore.Phase.Deliberation));
        assertTrue(delibStart > 0);

        vm.warp(block.timestamp + DELIB + 1);

        bytes32 salt1 = bytes32(uint256(111));
        bytes32 salt2 = bytes32(uint256(222));

        vm.prank(creator);
        core.commit(taskId, _computeCommit(taskId, 0, salt1));
        vm.prank(agent1);
        core.commit(taskId, _computeCommit(taskId, 0, salt2));

        vm.warp(block.timestamp + COMMIT + 1);

        vm.prank(creator);
        core.reveal(taskId, 0, salt1);
        vm.prank(agent1);
        core.reveal(taskId, 0, salt2);

        vm.warp(block.timestamp + REVEAL + 1);

        core.resolve(taskId);

        uint256 bounty = 2 * BOUNTY_PER_AGENT;

        vm.prank(creator);
        core.claimBounty(taskId);

        vm.prank(agent1);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent1), bounty / 2);
    }

    function test_singleAgent() public {
        vm.prank(creator);
        uint256 taskId = core.createTask("Solo task", options, 1, DELIB);

        _joinTask(taskId, agent1);

        (,,,,,,uint256 delibStart, ChronosCore.Phase phase,,,,) = core.getTask(taskId);
        assertEq(uint256(phase), uint256(ChronosCore.Phase.Deliberation));
        assertTrue(delibStart > 0);

        vm.warp(block.timestamp + DELIB + 1);

        bytes32 salt1 = bytes32(uint256(111));
        vm.prank(agent1);
        core.commit(taskId, _computeCommit(taskId, 0, salt1));

        vm.warp(block.timestamp + COMMIT + 1);

        vm.prank(agent1);
        core.reveal(taskId, 0, salt1);

        vm.warp(block.timestamp + REVEAL + 1);

        core.resolve(taskId);

        vm.prank(agent1);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent1), BOUNTY_PER_AGENT);
    }

    function test_tie() public {
        uint256 taskId = _createTask();

        _joinTask(taskId, agent1);
        _joinTask(taskId, agent2);
        _joinTask(taskId, agent3);

        vm.warp(block.timestamp + DELIB + 1);

        bytes32 salt1 = bytes32(uint256(111));
        bytes32 salt2 = bytes32(uint256(222));
        bytes32 salt3 = bytes32(uint256(333));

        vm.prank(agent1);
        core.commit(taskId, _computeCommit(taskId, 0, salt1));
        vm.prank(agent2);
        core.commit(taskId, _computeCommit(taskId, 1, salt2));
        vm.prank(agent3);
        core.commit(taskId, _computeCommit(taskId, 2, salt3));

        vm.warp(block.timestamp + COMMIT + 1);

        vm.prank(agent1);
        core.reveal(taskId, 0, salt1);
        vm.prank(agent2);
        core.reveal(taskId, 1, salt2);
        vm.prank(agent3);
        core.reveal(taskId, 2, salt3);

        vm.warp(block.timestamp + REVEAL + 1);

        core.resolve(taskId);

        (,,,,,,,,,, uint256 winOpt, bool isTie) = core.getTask(taskId);
        assertTrue(isTie);

        uint256 expectedBounty = REQUIRED_AGENTS * BOUNTY_PER_AGENT;

        vm.prank(agent1);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent1), expectedBounty / 3);

        vm.prank(agent2);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent2), expectedBounty / 3);

        vm.prank(agent3);
        core.claimBounty(taskId);
        assertEq(token.balanceOf(agent3), expectedBounty / 3);
    }

    function test_noReveals_creatorClaimsExpired() public {
        uint256 taskId = _createTask();
        uint256 balBefore = token.balanceOf(creator);

        _joinTask(taskId, agent1);
        _joinTask(taskId, agent2);
        _joinTask(taskId, agent3);

        vm.warp(block.timestamp + DELIB + COMMIT + REVEAL + 1);

        vm.prank(creator);
        core.claimExpired(taskId);

        uint256 expectedBounty = REQUIRED_AGENTS * BOUNTY_PER_AGENT;
        assertEq(token.balanceOf(creator), balBefore + expectedBounty);
    }

    function test_joinFullTask_reverts() public {
        uint256 taskId = _createTask();

        _joinTask(taskId, agent1);
        _joinTask(taskId, agent2);
        _joinTask(taskId, agent3);

        // Once full, deliberation started → deliberationStart != 0 → WrongPhase
        address agent4 = address(0x5);
        vm.prank(agent4);
        vm.expectRevert(ChronosCore.WrongPhase.selector);
        core.joinTask(taskId);
    }

    function test_joinCancelledTask_reverts() public {
        uint256 taskId = _createTask();

        vm.prank(creator);
        core.cancelTask(taskId);

        vm.prank(agent1);
        vm.expectRevert(ChronosCore.TaskIsCancelled.selector);
        core.joinTask(taskId);
    }

    function test_bountyCalculation() public {
        uint256 taskId = _createTask();
        uint256 expectedBounty = REQUIRED_AGENTS * BOUNTY_PER_AGENT;

        (,,,,,uint256 bounty,,,,,,) = core.getTask(taskId);
        assertEq(bounty, expectedBounty);
        assertEq(token.balanceOf(address(core)), expectedBounty);
    }

    function test_partialJoin_noPhaseChange() public {
        uint256 taskId = _createTask();

        _joinTask(taskId, agent1);
        _joinTask(taskId, agent2);

        (,,,,,,uint256 delibStart, ChronosCore.Phase phase,,,,) = core.getTask(taskId);
        assertEq(uint256(phase), uint256(ChronosCore.Phase.Open));
        assertEq(delibStart, 0);
        assertEq(core.agentCount(taskId), 2);
    }

    function test_invalidOptionCount_reverts() public {
        string[] memory badOptions = new string[](1);
        badOptions[0] = "Only one";

        vm.prank(creator);
        vm.expectRevert(ChronosCore.InvalidOptionCount.selector);
        core.createTask("Bad task", badOptions, 3, DELIB);
    }

    function test_zeroRequiredAgents_reverts() public {
        vm.prank(creator);
        vm.expectRevert(ChronosCore.ZeroRequiredAgents.selector);
        core.createTask("Bad task", options, 0, DELIB);
    }

    function test_zeroDuration_reverts() public {
        vm.prank(creator);
        vm.expectRevert(ChronosCore.ZeroDuration.selector);
        core.createTask("Bad task", options, 3, 0);
    }

    function test_doubleJoin_reverts() public {
        uint256 taskId = _createTask();

        _joinTask(taskId, agent1);

        vm.prank(agent1);
        vm.expectRevert(ChronosCore.AlreadyJoined.selector);
        core.joinTask(taskId);
    }

    function test_commitBeforeCommitPhase_reverts() public {
        uint256 taskId = _createTask();

        _joinTask(taskId, agent1);
        _joinTask(taskId, agent2);
        _joinTask(taskId, agent3);

        vm.prank(agent1);
        vm.expectRevert(ChronosCore.WrongPhase.selector);
        core.commit(taskId, bytes32(uint256(123)));
    }
}
