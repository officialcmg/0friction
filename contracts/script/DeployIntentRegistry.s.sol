// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IntentRegistry} from "../src/IntentRegistry.sol";

contract DeployIntentRegistry is Script {
    function run() public {
        vm.startBroadcast();

        IntentRegistry registry = new IntentRegistry();
        console.log("IntentRegistry deployed at:", address(registry));
        console.log("Solver (owner):", registry.solver());

        vm.stopBroadcast();
    }
}
