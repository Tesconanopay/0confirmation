pragma experimental ABIEncoderV2;
// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;
import { ModuleLib } from "../../lib/ModuleLib.sol";
import { BorrowProxyLib } from "../../../BorrowProxyLib.sol";
import { SmartFinalityAdapterLib } from "./SmartFinalityAdapterLib.sol";
import { SmartFinalityProxyKeeper } from "../../../proxy-keeper/SmartFinalityProxyKeeper.sol";
import { SmartFinalityLib } from "../../../proxy-keeper/SmartFinalityLib.sol";

contract SmartFinalityAdapter {
  using ModuleLib for *;
  BorrowProxyLib.ProxyIsolate proxyIsolate;
  constructor(address smartFinalityProxyKeeper) public {
    SmartFinalityAdapterLib.Isolate storage isolate = SmartFinalityAdapterLib.getIsolatePointer();
    isolate.smartFinalityProxyKeeper = smartFinalityProxyKeeper;
  }
  function getExternalIsolateHandler() public pure returns (SmartFinalityAdapterLib.Isolate memory result) {
    result = SmartFinalityAdapterLib.getIsolatePointer();
  }
  function handle(ModuleLib.AssetSubmodulePayload memory payload) public {
    require(proxyIsolate.owner != tx.origin, "can only be called via initialization script");
    SmartFinalityAdapterLib.Isolate memory externalIsolate = SmartFinalityAdapter(payload.moduleAddress).getExternalIsolateHandler();
    (SmartFinalityLib.FinalityState state, , ,) = SmartFinalityProxyKeeper(externalIsolate.smartFinalityProxyKeeper).peekFinalityRecord(address(this));
    if (state == SmartFinalityLib.FinalityState.SUFFICIENT_CONFIRMATIONS) proxyIsolate.unbound = true;
  }
}
    
