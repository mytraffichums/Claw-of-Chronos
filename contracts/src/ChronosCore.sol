// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ChronosCore {
    // ── Types ──────────────────────────────────────────────────────────
    enum Phase { Registration, Deliberation, Commit, Reveal, Resolved }

    struct Task {
        address creator;
        string description;
        string[] options;          // 2-5 predefined options
        uint256 bounty;            // $CHRN amount
        uint256 maxAgents;
        // Phase deadlines (absolute timestamps)
        uint256 registrationEnd;
        uint256 deliberationEnd;
        uint256 commitEnd;
        uint256 revealEnd;
        // State
        Phase phase;
        bool resolved;
        uint256 winningOption;     // set after resolve
        bool isTie;
    }

    // ── Storage ────────────────────────────────────────────────────────
    IERC20 public immutable chrn;
    uint256 public taskCount;

    mapping(uint256 => Task) internal _tasks;
    // taskId => agent addresses
    mapping(uint256 => address[]) public taskAgents;
    mapping(uint256 => mapping(address => bool)) public isAgent;
    // Commit-reveal
    mapping(uint256 => mapping(address => bytes32)) public commits;
    mapping(uint256 => mapping(address => bool)) public revealed;
    mapping(uint256 => mapping(address => uint256)) public votes; // optionIndex
    // Tallies
    mapping(uint256 => mapping(uint256 => uint256)) public optionVotes; // optionIndex => count
    mapping(uint256 => uint256) public revealCount;
    // Payout tracking
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(uint256 => uint256) public eligibleCount; // cached at resolve time

    // ── Events ─────────────────────────────────────────────────────────
    event TaskCreated(
        uint256 indexed taskId,
        address indexed creator,
        string description,
        string[] options,
        uint256 bounty,
        uint256 maxAgents,
        uint256 registrationEnd,
        uint256 deliberationEnd,
        uint256 commitEnd,
        uint256 revealEnd
    );
    event AgentJoined(uint256 indexed taskId, address indexed agent);
    event PhaseAdvanced(uint256 indexed taskId, Phase phase);
    event CommitSubmitted(uint256 indexed taskId, address indexed agent);
    event RevealSubmitted(uint256 indexed taskId, address indexed agent, uint256 optionIndex);
    event TaskResolved(uint256 indexed taskId, uint256 winningOption, bool isTie);
    event BountyClaimed(uint256 indexed taskId, address indexed agent, uint256 amount);
    event TaskExpiredClaimed(uint256 indexed taskId, address indexed creator, uint256 amount);

    // ── Errors ─────────────────────────────────────────────────────────
    error InvalidOptionCount();
    error ZeroBounty();
    error ZeroMaxAgents();
    error ZeroDuration();
    error TransferFailed();
    error WrongPhase();
    error TaskFull();
    error AlreadyJoined();
    error NotAgent();
    error AlreadyCommitted();
    error AlreadyRevealed();
    error InvalidReveal();
    error NoReveals();
    error AlreadyClaimed();
    error NotWinner();
    error NotCreator();
    error TaskNotExpired();

    // ── Constructor ────────────────────────────────────────────────────
    constructor(address _chrn) {
        chrn = IERC20(_chrn);
    }

    // ── Create ─────────────────────────────────────────────────────────
    function createTask(
        string calldata description,
        string[] calldata options,
        uint256 bounty,
        uint256 maxAgents,
        uint256 regDuration,
        uint256 delibDuration,
        uint256 commitDuration,
        uint256 revealDuration
    ) external returns (uint256 taskId) {
        if (options.length < 2 || options.length > 5) revert InvalidOptionCount();
        if (bounty == 0) revert ZeroBounty();
        if (maxAgents == 0) revert ZeroMaxAgents();
        if (regDuration == 0 || delibDuration == 0 || commitDuration == 0 || revealDuration == 0) revert ZeroDuration();

        // Pull bounty from creator
        bool ok = chrn.transferFrom(msg.sender, address(this), bounty);
        if (!ok) revert TransferFailed();

        taskId = taskCount++;

        Task storage t = _tasks[taskId];
        t.creator = msg.sender;
        t.description = description;
        t.bounty = bounty;
        t.maxAgents = maxAgents;

        // Copy options
        for (uint256 i = 0; i < options.length; i++) {
            t.options.push(options[i]);
        }

        // Set deadlines
        t.registrationEnd = block.timestamp + regDuration;
        t.deliberationEnd = t.registrationEnd + delibDuration;
        t.commitEnd = t.deliberationEnd + commitDuration;
        t.revealEnd = t.commitEnd + revealDuration;

        t.phase = Phase.Registration;

        emit TaskCreated(
            taskId, msg.sender, description, options, bounty, maxAgents,
            t.registrationEnd, t.deliberationEnd, t.commitEnd, t.revealEnd
        );
    }

    // ── Join ───────────────────────────────────────────────────────────
    function joinTask(uint256 taskId) external {
        Task storage t = _tasks[taskId];
        _syncPhase(taskId);
        if (t.phase != Phase.Registration) revert WrongPhase();
        if (taskAgents[taskId].length >= t.maxAgents) revert TaskFull();
        if (isAgent[taskId][msg.sender]) revert AlreadyJoined();

        isAgent[taskId][msg.sender] = true;
        taskAgents[taskId].push(msg.sender);

        emit AgentJoined(taskId, msg.sender);
    }

    // ── Commit ─────────────────────────────────────────────────────────
    function commit(uint256 taskId, bytes32 commitHash) external {
        _syncPhase(taskId);
        if (_tasks[taskId].phase != Phase.Commit) revert WrongPhase();
        if (!isAgent[taskId][msg.sender]) revert NotAgent();
        if (commits[taskId][msg.sender] != bytes32(0)) revert AlreadyCommitted();

        commits[taskId][msg.sender] = commitHash;

        emit CommitSubmitted(taskId, msg.sender);
    }

    // ── Reveal ─────────────────────────────────────────────────────────
    function reveal(uint256 taskId, uint256 optionIndex, bytes32 salt) external {
        _syncPhase(taskId);
        Task storage t = _tasks[taskId];
        if (t.phase != Phase.Reveal) revert WrongPhase();
        if (!isAgent[taskId][msg.sender]) revert NotAgent();
        if (revealed[taskId][msg.sender]) revert AlreadyRevealed();

        // Hash includes taskId to prevent cross-task replay
        bytes32 expected = keccak256(abi.encodePacked(taskId, optionIndex, salt));
        if (commits[taskId][msg.sender] != expected) revert InvalidReveal();
        if (optionIndex >= t.options.length) revert InvalidReveal();

        revealed[taskId][msg.sender] = true;
        votes[taskId][msg.sender] = optionIndex;
        optionVotes[taskId][optionIndex]++;
        revealCount[taskId]++;

        emit RevealSubmitted(taskId, msg.sender, optionIndex);
    }

    // ── Resolve ────────────────────────────────────────────────────────
    function resolve(uint256 taskId) external {
        _syncPhase(taskId);
        Task storage t = _tasks[taskId];
        // Can resolve once reveal phase has ended
        if (t.phase != Phase.Resolved) revert WrongPhase();
        if (t.resolved) revert WrongPhase();
        if (revealCount[taskId] == 0) revert NoReveals();

        // Find plurality winner
        uint256 maxVotes = 0;
        uint256 winner = 0;
        bool tie = false;

        for (uint256 i = 0; i < t.options.length; i++) {
            uint256 v = optionVotes[taskId][i];
            if (v > maxVotes) {
                maxVotes = v;
                winner = i;
                tie = false;
            } else if (v == maxVotes && v > 0) {
                tie = true;
            }
        }

        t.winningOption = winner;
        t.isTie = tie;
        t.resolved = true;

        // Cache eligible count so claimBounty doesn't need to iterate agents
        eligibleCount[taskId] = _countEligible(taskId, winner, tie, maxVotes);

        emit TaskResolved(taskId, winner, tie);
    }

    // ── Claim bounty ───────────────────────────────────────────────────
    function claimBounty(uint256 taskId) external {
        Task storage t = _tasks[taskId];
        if (!t.resolved) revert WrongPhase();
        if (!revealed[taskId][msg.sender]) revert NotAgent();
        if (claimed[taskId][msg.sender]) revert AlreadyClaimed();

        uint256 voterOption = votes[taskId][msg.sender];
        bool eligible;

        if (t.isTie) {
            uint256 maxVotes = _maxVoteCount(taskId);
            eligible = optionVotes[taskId][voterOption] == maxVotes;
        } else {
            eligible = voterOption == t.winningOption;
        }

        if (!eligible) revert NotWinner();

        claimed[taskId][msg.sender] = true;

        // Use cached eligible count from resolve()
        uint256 share = t.bounty / eligibleCount[taskId];

        bool ok = chrn.transfer(msg.sender, share);
        if (!ok) revert TransferFailed();

        emit BountyClaimed(taskId, msg.sender, share);
    }

    // ── Claim expired ──────────────────────────────────────────────────
    function claimExpired(uint256 taskId) external {
        _syncPhase(taskId);
        Task storage t = _tasks[taskId];
        if (msg.sender != t.creator) revert NotCreator();
        if (t.resolved) revert WrongPhase();

        // Can claim if: no agents joined (after registration) or no reveals happened (after reveal)
        bool noAgents = t.phase != Phase.Registration && taskAgents[taskId].length == 0;
        bool noReveals = t.phase == Phase.Resolved && revealCount[taskId] == 0;

        if (!noAgents && !noReveals) revert TaskNotExpired();

        t.resolved = true; // prevent double-claim

        bool ok = chrn.transfer(t.creator, t.bounty);
        if (!ok) revert TransferFailed();

        emit TaskExpiredClaimed(taskId, t.creator, t.bounty);
    }

    // ── Advance phase (anyone can call) ────────────────────────────────
    function advancePhase(uint256 taskId) external {
        _syncPhase(taskId);
    }

    // ── View helpers ───────────────────────────────────────────────────
    function getTask(uint256 taskId) external view returns (
        address creator,
        string memory description,
        string[] memory options,
        uint256 bounty,
        uint256 maxAgents,
        uint256 registrationEnd,
        uint256 deliberationEnd,
        uint256 commitEnd,
        uint256 revealEnd,
        Phase phase,
        bool resolved,
        uint256 winningOption,
        bool isTie
    ) {
        Task storage t = _tasks[taskId];
        Phase currentPhase = _currentPhase(taskId);
        return (
            t.creator, t.description, t.options, t.bounty, t.maxAgents,
            t.registrationEnd, t.deliberationEnd, t.commitEnd, t.revealEnd,
            currentPhase, t.resolved, t.winningOption, t.isTie
        );
    }

    function getAgents(uint256 taskId) external view returns (address[] memory) {
        return taskAgents[taskId];
    }

    function getOptions(uint256 taskId) external view returns (string[] memory) {
        return _tasks[taskId].options;
    }

    function agentCount(uint256 taskId) external view returns (uint256) {
        return taskAgents[taskId].length;
    }

    // ── Internal ───────────────────────────────────────────────────────
    function _syncPhase(uint256 taskId) internal {
        Task storage t = _tasks[taskId];
        Phase newPhase = _currentPhase(taskId);
        if (newPhase != t.phase) {
            t.phase = newPhase;
            emit PhaseAdvanced(taskId, newPhase);
        }
    }

    function _currentPhase(uint256 taskId) internal view returns (Phase) {
        Task storage t = _tasks[taskId];
        if (t.resolved) return Phase.Resolved;
        if (block.timestamp >= t.revealEnd) return Phase.Resolved;
        if (block.timestamp >= t.commitEnd) return Phase.Reveal;
        if (block.timestamp >= t.deliberationEnd) return Phase.Commit;
        if (block.timestamp >= t.registrationEnd) return Phase.Deliberation;
        return Phase.Registration;
    }

    function _maxVoteCount(uint256 taskId) internal view returns (uint256 maxVotes) {
        Task storage t = _tasks[taskId];
        for (uint256 i = 0; i < t.options.length; i++) {
            if (optionVotes[taskId][i] > maxVotes) {
                maxVotes = optionVotes[taskId][i];
            }
        }
    }

    function _countEligible(uint256 taskId, uint256 winner, bool tie, uint256 maxVotes) internal view returns (uint256 count) {
        address[] storage agents = taskAgents[taskId];

        for (uint256 i = 0; i < agents.length; i++) {
            if (!revealed[taskId][agents[i]]) continue;
            uint256 opt = votes[taskId][agents[i]];
            if (tie) {
                if (optionVotes[taskId][opt] == maxVotes) count++;
            } else {
                if (opt == winner) count++;
            }
        }
    }
}
