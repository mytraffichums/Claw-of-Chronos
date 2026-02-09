// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ChronosCore {
    // ── Types ──────────────────────────────────────────────────────────
    enum Phase { Open, Deliberation, Commit, Reveal, Resolved }

    struct Task {
        address creator;
        string description;
        string[] options;
        uint256 requiredAgents;
        uint256 deliberationDuration;
        uint256 bounty;              // requiredAgents * BOUNTY_PER_AGENT
        uint256 deliberationStart;   // 0 until requiredAgents join
        Phase phase;
        bool resolved;
        bool cancelled;
        uint256 winningOption;
        bool isTie;
    }

    // ── Constants ─────────────────────────────────────────────────────
    uint256 public constant BOUNTY_PER_AGENT = 1000e18;
    uint256 public constant COMMIT_DURATION = 60;
    uint256 public constant REVEAL_DURATION = 60;

    // ── Storage ────────────────────────────────────────────────────────
    IERC20 public immutable chrn;
    uint256 public taskCount;

    mapping(uint256 => Task) internal _tasks;
    mapping(uint256 => address[]) public taskAgents;
    mapping(uint256 => mapping(address => bool)) public isAgent;
    // Commit-reveal
    mapping(uint256 => mapping(address => bytes32)) public commits;
    mapping(uint256 => mapping(address => bool)) public revealed;
    mapping(uint256 => mapping(address => uint256)) public votes;
    // Tallies
    mapping(uint256 => mapping(uint256 => uint256)) public optionVotes;
    mapping(uint256 => uint256) public revealCount;
    // Payout tracking
    mapping(uint256 => mapping(address => bool)) public claimed;
    mapping(uint256 => uint256) public eligibleCount;

    // ── Events ─────────────────────────────────────────────────────────
    event TaskCreated(
        uint256 indexed taskId,
        address indexed creator,
        string description,
        string[] options,
        uint256 bounty,
        uint256 requiredAgents,
        uint256 deliberationDuration
    );
    event TaskStarted(uint256 indexed taskId, uint256 deliberationStart);
    event TaskCancelled(uint256 indexed taskId, address indexed creator, uint256 refund);
    event AgentJoined(uint256 indexed taskId, address indexed agent);
    event PhaseAdvanced(uint256 indexed taskId, Phase phase);
    event CommitSubmitted(uint256 indexed taskId, address indexed agent);
    event RevealSubmitted(uint256 indexed taskId, address indexed agent, uint256 optionIndex);
    event TaskResolved(uint256 indexed taskId, uint256 winningOption, bool isTie);
    event BountyClaimed(uint256 indexed taskId, address indexed agent, uint256 amount);
    event TaskExpiredClaimed(uint256 indexed taskId, address indexed creator, uint256 amount);

    // ── Errors ─────────────────────────────────────────────────────────
    error InvalidOptionCount();
    error ZeroRequiredAgents();
    error ZeroDuration();
    error TransferFailed();
    error WrongPhase();
    error TaskFull();
    error AlreadyJoined();
    error TaskIsCancelled();
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
        uint256 requiredAgents,
        uint256 deliberationDuration
    ) external returns (uint256 taskId) {
        if (options.length < 2 || options.length > 5) revert InvalidOptionCount();
        if (requiredAgents == 0) revert ZeroRequiredAgents();
        if (deliberationDuration == 0) revert ZeroDuration();

        uint256 bounty = requiredAgents * BOUNTY_PER_AGENT;

        bool ok = chrn.transferFrom(msg.sender, address(this), bounty);
        if (!ok) revert TransferFailed();

        taskId = taskCount++;

        Task storage t = _tasks[taskId];
        t.creator = msg.sender;
        t.description = description;
        t.requiredAgents = requiredAgents;
        t.deliberationDuration = deliberationDuration;
        t.bounty = bounty;
        t.phase = Phase.Open;

        for (uint256 i = 0; i < options.length; i++) {
            t.options.push(options[i]);
        }

        emit TaskCreated(
            taskId, msg.sender, description, options, bounty,
            requiredAgents, deliberationDuration
        );
    }

    // ── Join ───────────────────────────────────────────────────────────
    function joinTask(uint256 taskId) external {
        Task storage t = _tasks[taskId];
        if (t.cancelled) revert TaskIsCancelled();
        if (t.deliberationStart != 0) revert WrongPhase();
        if (taskAgents[taskId].length >= t.requiredAgents) revert TaskFull();
        if (isAgent[taskId][msg.sender]) revert AlreadyJoined();

        isAgent[taskId][msg.sender] = true;
        taskAgents[taskId].push(msg.sender);

        emit AgentJoined(taskId, msg.sender);

        // Auto-start deliberation when full
        if (taskAgents[taskId].length == t.requiredAgents) {
            t.deliberationStart = block.timestamp;
            t.phase = Phase.Deliberation;
            emit TaskStarted(taskId, block.timestamp);
            emit PhaseAdvanced(taskId, Phase.Deliberation);
        }
    }

    // ── Cancel ─────────────────────────────────────────────────────────
    function cancelTask(uint256 taskId) external {
        Task storage t = _tasks[taskId];
        if (msg.sender != t.creator) revert NotCreator();
        if (t.deliberationStart != 0) revert WrongPhase();
        if (t.cancelled) revert WrongPhase();

        t.cancelled = true;
        t.phase = Phase.Resolved;

        bool ok = chrn.transfer(t.creator, t.bounty);
        if (!ok) revert TransferFailed();

        emit TaskCancelled(taskId, t.creator, t.bounty);
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
        if (t.phase != Phase.Resolved) revert WrongPhase();
        if (t.resolved) revert WrongPhase();
        if (revealCount[taskId] == 0) revert NoReveals();

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
        if (t.cancelled) revert WrongPhase();

        // Only valid when reveal phase ended with 0 reveals
        bool noReveals = t.phase == Phase.Resolved && revealCount[taskId] == 0;
        if (!noReveals) revert TaskNotExpired();

        t.resolved = true;

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
        uint256 requiredAgents,
        uint256 deliberationDuration,
        uint256 bounty,
        uint256 deliberationStart,
        Phase phase,
        bool resolved,
        bool cancelled,
        uint256 winningOption,
        bool isTie
    ) {
        Task storage t = _tasks[taskId];
        Phase currentPhase = _currentPhase(taskId);
        return (
            t.creator, t.description, t.options, t.requiredAgents,
            t.deliberationDuration, t.bounty, t.deliberationStart,
            currentPhase, t.resolved, t.cancelled, t.winningOption, t.isTie
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
        if (t.resolved || t.cancelled) return Phase.Resolved;
        if (t.deliberationStart == 0) return Phase.Open;

        uint256 delibEnd = t.deliberationStart + t.deliberationDuration;
        uint256 commitEnd = delibEnd + COMMIT_DURATION;
        uint256 revealEnd = commitEnd + REVEAL_DURATION;

        if (block.timestamp >= revealEnd) return Phase.Resolved;
        if (block.timestamp >= commitEnd) return Phase.Reveal;
        if (block.timestamp >= delibEnd) return Phase.Commit;
        return Phase.Deliberation;
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
