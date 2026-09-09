// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {FlashLoanArb} from "../src/FlashLoanArb.sol";

contract DeployLocal is Script {
    function run() external {
        vm.startBroadcast();
        FlashLoanArb loanArb = new FlashLoanArb();
        console.log("FlashLoanArb deployed at:", address(loanArb));
        vm.stopBroadcast();
    }
}
