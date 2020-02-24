pragma solidity ^0.6.2;

import { RenVMShiftMessageLib } from "./RenVMShiftMessageLib.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "./utils/TokenUtils.sol";

library ShifterBorrowProxyLib {
  using SafeMath for *;
  using TokenUtils for *;
  struct ProxyRecord {
    address token;
    uint256 timeoutExpiry;
    RenVMShiftMessageLib.RenVMShiftMessage message;
    LenderRecord loan;
  }
  struct TriggerParcel {
    ProxyRecord record;
    bytes darknodeSignature;
  }
  struct LenderRecord {
    uint256 amount;
    address keeper;
    uint256 poolFee;
    uint256 keeperFee;
  }
  function computePostFee(LenderRecord memory record) internal pure returns (uint256) {
    return record.amount.sub(computePoolFee(record).add(computeKeeperFee(record)));
  }
  function computePoolFee(LenderRecord memory record) internal pure returns (uint256) {
    return record.amount.mul(record.poolFee).div(uint256(1 ether));
  }
  function computeKeeperFee(LenderRecord memory record) internal pure returns (uint256) {
    return record.amount.mul(record.keeperFee).div(uint256(1 ether));
  }
  function computeAdjustedKeeperFee(LenderRecord memory record, uint256 actual) internal pure returns (uint256) {
    return actual.mul(record.keeperFee).div(uint256(1 ether));
  }
}