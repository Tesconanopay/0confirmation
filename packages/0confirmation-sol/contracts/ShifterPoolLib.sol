pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import { ECDSA } from "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";
import { TokenUtils } from "./utils/TokenUtils.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { BorrowProxyLib } from "./BorrowProxyLib.sol";
import { IShifter } from "./interfaces/IShifter.sol";
import { IShifterRegistry } from "./interfaces/IShifterRegistry.sol";
import { LiquidityToken } from "./LiquidityToken.sol";
import { ShifterBorrowProxy } from "./ShifterBorrowProxy.sol";
import { ShifterBorrowProxyLib } from "./ShifterBorrowProxyLib.sol";
import { ShifterBorrowProxyFactoryLib } from "./ShifterBorrowProxyFactoryLib.sol";
import { FactoryLib } from "./FactoryLib.sol";
import { ShifterPool } from "./ShifterPool.sol";

library ShifterPoolLib {
  using BorrowProxyLib for *;
  using TokenUtils for *;
  using ShifterBorrowProxyLib for *;
  using ShifterBorrowProxyFactoryLib for *;
  using SafeMath for *;
  struct Isolate {
    uint256 genesis;
    address borrowProxyImplementation;
    address assetForwarderImplementation;
    address shifterRegistry;
    uint256 minTimeout;
    uint256 poolFee;
    mapping (address => bool) isKeeper;
    mapping (bytes32 => bool) provisionExecuted;
    mapping (address => address) tokenToLiquidityToken;
    BorrowProxyLib.ControllerIsolate borrowProxyController;
    BorrowProxyLib.ModuleRegistry registry;
  }
  bytes32 constant ASSET_FORWARDER_IMPLEMENTATION_SALT = 0x547c714bc15831c4a5fc7c91d35b0c6e69e7277fa19cd7e3a2ccaf940ff441fd;
  function GET_ASSET_FORWARDER_IMPLEMENTATION_SALT() internal pure returns (bytes32) {
    return ASSET_FORWARDER_IMPLEMENTATION_SALT;
  }
  function deriveAssetForwarderAddress(BorrowProxyLib.ProxyIsolate storage isolate, bytes32 salt) internal view returns (address) {
    address masterAddress = isolate.masterAddress;
    return FactoryLib.deriveInstanceAddress(masterAddress, ShifterPool(masterAddress).getAssetForwarderImplementationHandler(), keccak256(abi.encodePacked(ASSET_FORWARDER_IMPLEMENTATION_SALT, salt)));
  }
  function deployAssetForwarder(BorrowProxyLib.ProxyIsolate storage isolate, bytes32 salt) public returns (address created) {
    return ShifterPool(isolate.masterAddress).deployAssetForwarderClone(salt);
  }
  function makeBorrowProxy(Isolate storage isolate, bytes32 salt) internal returns (address payable proxyAddress) {
    proxyAddress = address(uint160(isolate.deployBorrowProxy(salt)));
  }
  function issueLoan(Isolate storage isolate, address token, address payable proxyAddress, uint256 fee) internal {
    require(LiquidityToken(getLiquidityToken(isolate, token)).loan(proxyAddress, fee), "insufficient funds in liquidity pool");
  }
  function setupBorrowProxy(address payable proxyAddress, address borrower, address token, bool unbound) internal {
    require(ShifterBorrowProxy(proxyAddress).setup(borrower, token, unbound), "setup phase failure");
  }
  function sendInitializationActions(address payable proxyAddress, ShifterBorrowProxyLib.InitializationAction[] memory actions) internal {
    ShifterBorrowProxy(proxyAddress).receiveInitializationActions(actions);
  }
  function computeLoanParams(Isolate storage isolate, uint256 amount, uint256 bond, uint256 timeoutExpiry) internal view returns (ShifterBorrowProxyLib.LenderParams memory) {
    require(timeoutExpiry >= isolate.minTimeout, "timeout insufficient");
    uint256 baseKeeperFee = uint256(1 ether).div(100); // 1%
    require(bond.mul(uint256(1 ether)).div(amount) > uint256(1 ether).div(100), "bond below minimum");
    uint256 keeperFee = amount < bond ? baseKeeperFee : uint256(baseKeeperFee).mul(bond).div(amount);
    return ShifterBorrowProxyLib.LenderParams({
      keeperFee: keeperFee,
      poolFee: isolate.poolFee,
      timeoutExpiry: block.number + timeoutExpiry,
      bond: bond
    });
  }
  struct LiquidityProvisionMessage {
    uint256 amount;
    uint256 nonce;
    uint256 keeperFee;
    uint256 timeoutExpiry;
    bytes signature;
  }
  struct LiquidityTokenLaunch {
    address token;
    address liqToken;
  }
  function launchLiquidityToken(Isolate storage isolate, address token, string memory name, string memory symbol, uint8 decimals) internal returns (address) {
    require(isolate.tokenToLiquidityToken[token] == address(0x0), "already deployed liquidity token for target token");
    address liquidityToken = address(new LiquidityToken(address(this), token, name, symbol, decimals));
    isolate.tokenToLiquidityToken[token] = liquidityToken;
    return liquidityToken;
  }
  function getLiquidityToken(Isolate storage isolate, address token) internal view returns (address) {
    address retval = isolate.tokenToLiquidityToken[token];
    require(retval != address(0x0), "not a registered liquidity token");
    return retval;
  }
  function lendLiquidity(Isolate storage isolate, address provider, address token, address target, uint256 amount) internal returns (bool) {
    if (!isolate.isKeeper[provider]) return false;
    return token.transferTokenFrom(provider, target, amount);
  }
  function getShifter(Isolate storage isolate, address token) internal view returns (IShifter) {
    return IShifterRegistry(isolate.shifterRegistry).getShifterByToken(token);
  }
  function provisionHashAlreadyUsed(Isolate storage isolate, bytes32 provisionHash) internal view returns (bool) {
    return isolate.provisionExecuted[provisionHash];
  }
  function preventProvisionReplay(Isolate storage isolate, bytes32 provisionHash) internal returns (bool) {
    isolate.provisionExecuted[provisionHash] = true;
    return true;
  }
  function mapBorrowProxy(Isolate storage isolate, address proxyAddress, ShifterBorrowProxyLib.ProxyRecord memory record) internal {
    bytes memory data = record.encodeProxyRecord();
    isolate.borrowProxyController.setProxyToken(proxyAddress, record.request.token);
    isolate.borrowProxyController.setProxyOwner(proxyAddress, record.request.borrower);
    record.request.borrower.transfer(msg.value);
    isolate.borrowProxyController.mapProxyRecord(proxyAddress, data);
    BorrowProxyLib.emitBorrowProxyMade(record.request.borrower, proxyAddress, data);
  }
}   
