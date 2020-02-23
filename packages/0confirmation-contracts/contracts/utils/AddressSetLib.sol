pragma solidity ^0.6.2;

library AddressSetLib {
  struct AddressSet {
    mapping (address => bool) uniq;
    address[] set;
  }
  function insert(AddressSet storage addressSet, address item) internal pure {
    if (addressSet.uniq[item]) return;
    addressSet.set.push(item);
  }
  function get(AddressSet storage addressSet, uint256 i) internal pure returns (address) {
    return addressSet.set[i];
  }
  function size(AddressSet storage addressSet) internal pure returns (uint256) {
    return addressSet.set.length;
  }
}
