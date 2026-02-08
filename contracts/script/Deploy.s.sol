// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/ChronosCore.sol";

contract DeployScript is Script {
    function run() external {
        address chrnToken = vm.envAddress("CHRN_TOKEN");

        vm.startBroadcast();
        ChronosCore core = new ChronosCore(chrnToken);
        console.log("ChronosCore deployed at:", address(core));
        vm.stopBroadcast();
    }
}
