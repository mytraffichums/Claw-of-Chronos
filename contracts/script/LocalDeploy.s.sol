// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/ChronosCore.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockCHRN is ERC20 {
    constructor() ERC20("Chronos", "CHRN") {
        _mint(msg.sender, 1_000_000e18);
    }
}

contract LocalDeployScript is Script {
    function run() external {
        vm.startBroadcast();

        MockCHRN token = new MockCHRN();
        console.log("MockCHRN deployed at:", address(token));

        ChronosCore core = new ChronosCore(address(token));
        console.log("ChronosCore deployed at:", address(core));

        vm.stopBroadcast();
    }
}
