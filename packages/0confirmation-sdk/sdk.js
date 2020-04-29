'use strict';

const ISafeViewExecutor = require('@0confirmation/sol/build/ISafeViewExecutor');
const pendingTransfersQuery = require('./queries/query-pending-transfers');
const genesisQuery = require('./queries/query-genesis');
const { makeManagerClass } = require('./manager');
const environment = require('./environments');
const constants = require('./constants');
const BN = require('bignumber.js');
const resultToJsonRpc = require('./util/result-to-jsonrpc');
const { Buffer } = require('safe-buffer');
const {
  Common: {
    RenVMType
  },
  RenVM
} = require('@0confirmation/renvm');
const makeBaseProvider = require('@0confirmation/providers/base-provider');
const { toHex, toBase64 } = require('./util');
const ethersUtil = require('ethers/utils');
const { joinSignature, solidityKeccak256 } = ethersUtil;
const ethers = require('ethers');
const defaultProvider = ethers.getDefaultProvider();
const { Contract } = require('ethers/contract');
const utils = require('./util');
const abi = ethersUtil.defaultAbiCoder;
const Driver = require('./driver');
const { Web3Provider } = require('ethers/providers/web3-provider');
const Web3ProviderEngine = require('web3-provider-engine');
const LiquidityToken = require('@0confirmation/sol/build/LiquidityToken');
const LiquidityRequestParcel = require('./liquidity-request-parcel');
const LiquidityRequest = require('./liquidity-request');
const DepositedLiquidityRequestParcel = require('./deposited-liquidity-request-parcel');
const ShifterPoolArtifact = require('@0confirmation/sol/build/ShifterPool');
const BorrowProxyLib = require('@0confirmation/sol/build/BorrowProxyLib');
const ShifterBorrowProxy = require('@0confirmation/sol/build/ShifterBorrowProxy');
const BorrowProxy = require('./borrow-proxy');
const ShifterPool = require('./shifter-pool');
const filterABI = (abi) => abi.filter((v) => v.type !== 'receive');
const shifterPoolInterface = new ethers.utils.Interface(filterABI(ShifterPoolArtifact.abi));
const shifterBorrowProxyInterface = new ethers.utils.Interface(filterABI(ShifterBorrowProxy.abi));
const uniq = require('lodash/uniq');

const getSignatures = (abi) => {
  const wrapped = new ethers.utils.Interface(filterABI(abi));
  return uniq(Object.keys(wrapped.functions).filter((v) => /^\w+$/.test(v)).map((v) => wrapped.functions[v].sighash));
};

const { timeout } = require('./util');

const getProvider = (driver) => makeBaseProvider(driver.getBackend('ethereum').provider).asEthers();

class Zero {
  static async fromProvider(ethProvider, presetName = 'default') {
    const provider = new Web3Provider(ethProvider);
    const chainId = Number(await provider.send('eth_chainId', []));
    const network = networks[chainId][presetName];
    return new Zero(Object.assign({
      backends: Object.assign({}, network, {
        provider: ethProvider
      })
    }, networks.contracts));
  }
  setEnvironment(env) {
    this.network = env;
    this.network.shifterPool = this.network.shifterPool || ethers.constants.AddressZero;
    this.shifterPool = new ShifterPool({
      getProvider: this.getProvider.bind(this),
      network: {
        shifterPool: env.shifterPool || this.network.shifterPool || ethers.constants.AddressZero
      }
    });
  }
  constructor(o, ...args) {
    if (o.send) {
      if (args.length && args[0]) {
        if (args[0] === 'mock') o = environment.getMockEnvironment(o);
        else o = environment.getEnvironment(o, ...args);
      }
    }
    const {
      backends,
      shifterPool,
      borrowProxyLib,
      borrowProxyCreationCode,
      mpkh
    } = o;
    this.options = {
      shifterPool,
      borrowProxyLib,
      borrowProxyCreationCode,
      mpkh
    };
    this.driver = new Driver(backends);
    const isTestnet = this.driver.getBackend('btc').testnet;
    this.setEnvironment({
      mpkh: mpkh,
      borrowProxyLib,
      borrowProxyCreationCode,
      shifterPool: shifterPool,
      isTestnet
    });
  }
  async setBorrowProxy(address) {
    return await this.driver.sendWrapped('0cf_setBorrowProxy', [ address ]);
  }
  getProvider() {
    const eth = this.driver.getBackend('ethereum');
    return makeBaseProvider(eth.provider);
  }
  getBorrowProvider() {
    const wrappedEthProvider = getProvider(this.driver);
    const ethProvider = wrappedEthProvider.provider;
    const providerEngine = new Web3ProviderEngine();
    const sendAsync = (o, cb) => {
      resultToJsonRpc(o.id, async () => {
        switch (o.method) {
          case 'eth_accounts':
            return [ await this.driver.sendWrapped('0cf_getBorrowProxy', []) ];
          case 'eth_sign':
          case 'personal_sign':
          case 'eth_signTypedData':
            throw Error('borrow proxy cannot sign messages');
          case 'eth_sendTransaction':
          case 'eth_estimateGas':
            const [ payload ] = o.params;
            const [ from ] = await wrappedEthProvider.send('eth_accounts', []);
            const borrowProxy = await this.driver.sendWrapped('0cf_getBorrowProxy', []);
            return await wrappedEthProvider.send(o.method, [ Object.assign({
              from,
              to: borrowProxy,
              data: shifterBorrowProxyInterface.functions.proxy.encode([ payload.to, payload.value || '0x0', payload.data || '0x' ])
            }, payload.value && { value: payload.value } || {}, payload.gasPrice && { gasPrice: payload.gasPrice } || {}, payload.gas && { gas: payload.gas } || {}, payload.gasLimit && { gasLimit: payload.gasLimit } || {}, payload.nonce && { nonce: payload.nonce } || {}) ]);
          case 'eth_call':
            const [ callPayload ] = o.params;
            const callBorrowProxy = await this.driver.sendWrapped('0cf_getBorrowProxy', []);
            return await wrappedEthProvider.send(o.method, [ Object.assign({
              from: callBorrowProxy,
              data: callPayload.data
            }, callPayload.to && { to: callPayload.to } || {}, callPayload.value && { value: callPayload.value } || {}, callPayload.gasPrice && { gasPrice: callPayload.gasPrice } || {}, callPayload.gas && { gas: callPayload.gas } || {}, callPayload.gasLimit && { gasLimit: callPayload.gasLimit } || {}, callPayload.nonce && { nonce: callPayload.nonce } || {}) ]);
          default:
            return await wrappedEthProvider.send(o.method, o.params);
        }
      }).then((response) => cb(null, response)).catch((err) => cb(err));
    };
    const send = (o, cb) => sendAsync(o, cb);
    return Object.assign(providerEngine, {
      send,
      sendAsync
    });
  }
  createLiquidityRequest({
    token,
    amount,
    nonce,
    borrower,
    forbidLoan,
    gasRequested,
    actions
  }) {
    return new LiquidityRequest({
      zero: this,
      shifterPool: this.network.shifterPool,
      borrowProxyLib: this.network.borrowProxyLib,
      borrowProxyCreationCode: this.network.borrowProxyCreationCode,
      actions: actions || [],
      token,
      amount,
      nonce,
      borrower,
      forbidLoan: false,
      gasRequested
    });
  }
  subscribeBorrows(filterArgs, callback) {
    const contract = new Contract(this.network.shifterPool, filterABI(BorrowProxyLib.abi), getProvider(this.driver).getSigner());
    const filter = contract.filters.BorrowProxyMade(...filterArgs);
    contract.on(filter, (user, proxyAddress, data) => callback(new BorrowProxy({
      zero: this,
      user,
      proxyAddress,
      record: data,
      shifterPool: this.network.shifterPool,
      borrowProxyCreationCode: this.network.borrowProxyCreationCode,
      borrowProxyLib: this.network.borrowProxyLib
    })));
    return () => contract.removeListener(filter);
  }
  async getBorrowProxies(borrower) {
    if (!borrower) {
      borrower = (await this.send('eth_accounts', []))[0];
    }
    const provider = this.getProvider().asEthers();
    const contract = this.shifterPool.contract;
    const filter = contract.filters.BorrowProxyMade(...[ borrower ]);
    const logs = await provider.getLogs(Object.assign({
      fromBlock: await this.shifterPool.getGenesis() 
    }, filter));
    const decoded = logs.map((v) => contract.interface.parseLog(v).values);
    return decoded.map((v) => new BorrowProxy(Object.assign({
      zero: this,
      shifterPool: this.network.shifterPool,
      borrowProxyCreationCode: this.network.borrowProxyCreationCode,
      borrowProxyLib: this.network.borrowProxyLib
    }, v)));
  } 
  async broadcastLiquidityRequest({
    from,
    token,
    amount,
    nonce,
    actions,
    forbidLoan,
    gasRequested
  }) {
    const liquidityRequest = this.createLiquidityRequest({
      token,
      amount,
      nonce,
      forbidLoan,
      actions: actions || [],
      gasRequested
    });
    const parcel = await liquidityRequest.sign(from);
    await parcel.broadcast();
    return parcel;
  }
  async submitToRenVM({
    token,
    amount,
    to,
    nonce,
    utxo
  }) {
    return await this.driver.sendWrapped('ren_submitTx', {
      tx: {
        to: RenVM.Tokens.BTC.Mint,
        in: [{
          name: 'p',
          type: RenVMType.ExtEthCompatPayload,
          value: {
            abi: constants.CONST_P_ABI_B64,
            value: constants.CONST_P_VALUE_B32,
            fn: constants.CONST_P_FN_B64
          }
        }, {
          name: 'token',
          type: RenVMType.ExtTypeEthCompatAddress,
          value: utils.stripHexPrefix(token)
        }, {
          name: 'to',
          type: RenVMType.ExtTypeEthCompatAddress,
          value: utils.stripHexPrefix(to)
        }, {
          name: 'n',
          type: RenVMType.TypeB32,
          value: toBase64(nonce)
        }, {
          name: 'utxo',
          type: RenVMType.ExtTypeBtcCompatUTXO,
          value: {
            vOut: String(utxo.vOut),
            txHash: String(toBase64(utxo.txHash))
          }
        }]
      }
    });
  }
  async listenForLiquidityRequests(callback) {
    return await (this.driver.getBackend('zero'))._filterLiquidityRequests((msg) => {
      const [{
        shifterPool,
        token,
        amount,
        nonce,
        actions,
        forbidLoan,
        gasRequested,
        signature
      }] = msg.data.params;
      if (shifterPool !== this.network.shifterPool) return;
      callback(new LiquidityRequestParcel({
        zero: this,
        borrowProxyLib: this.network.borrowProxyLib,
        borrowProxyCreationCode: this.network.borrowProxyCreationCode,
        shifterPool,
        actions,
        token,
        forbidLoan,
        nonce,
        amount,
        gasRequested,
        signature
      }));
    });
  }
  async stopListeningForLiquidityRequests() {
    return await (this.driver.getBackend('zero'))._unsubscribeLiquidityRequests();
  }
  async approvePool(token, overrides) {
    const contract = new Contract(token, filterABI(LiquidityToken.abi), getProvider(this.driver).getSigner());
    return await contract.approve(this.network.shifterPool, '0x' + Array(64).fill('f').join(''), overrides || {});
  }
  async getLiquidityTokenFor(token) {
    const contract = new Contract(this.network.shifterPool, filterABI(ShifterPool.abi), getProvider(this.driver).getSigner());
    const liquidityToken = new Contract(await contract.getLiquidityTokenHandler(token), filterABI(LiquidityToken.abi), getProvider(this.driver).getSigner());
    return liquidityToken;
  }
  async approveLiquidityToken(token, overrides) {
    const liquidityToken = await this.getLiquidityTokenFor(token);
    const contract = new Contract(token, filterABI(LiquidityToken.abi), getProvider(this.driver).getSigner());
    return await contract.approve(liquidityToken.address, '0x' + Array(62).fill('f').join(''), overrides || {});
  }
  async addLiquidity(token, value, overrides) {
    const liquidityToken = await this.getLiquidityTokenFor(token);
    return await liquidityToken.addLiquidity(value, overrides || {});
  }
  async removeLiquidity(token, value, overrides) {
    const liquidityToken = await this.getLiquidityTokenFor(token);
    return await liquidityToken.removeLiquidityToken(value, overrides || {});
  }
  async executeBorrow(liquidityRequest, bond, timeoutExpiry, overrides) {
    const { 
      shifterPool,
      token,
      nonce,
      amount,
      gasRequested,
      signature,
      actions,
      forbidLoan,
      borrower
    } = liquidityRequest;
    const contract = new Contract(this.network.shifterPool, filterABI(ShifterPool.abi), getProvider(this.driver).getSigner());
    const tx = await contract.executeBorrow({
      request: {
        borrower,
        token,
        nonce,
        amount,
        forbidLoan,
        actions: (actions || []).map((v) => ({
          to: v.to,
          txData: v.calldata
        })),
      },
      gasRequested,
      signature
    }, bond, timeoutExpiry, Object.assign(overrides || {}, {
      value: '0x' + new BN(gasRequested).toString(16)
    }));
    return tx;
  }
  async loadBorrowProxyCreationCode() {
    this.network.borrowProxyCreationCode = await (new Contract(this.network.shifterPool, filterABI(ShifterPool.abi), getProvider(this.driver).getSigner())).getBorrowProxyCreationCode();
  }
  async initializeDriver() {
    await this.driver.initialize();
  }
}

const preprocessor = (artifact, ...args) => {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, (new ethers.providers.JsonRpcProvider('http://localhost:8545')).getSigner());
  const { data } = factory.getDeployTransaction(...args);
  return {
    to: ethers.constants.AddressZero,
    calldata: data
  };
};

class ZeroMock extends Zero {
  connectMock(otherZero) {
    const zeroBackend = this.driver.getBackend('zero');
    const otherZeroBackend = otherZero.driver.getBackend('zero');
    zeroBackend.connectMock(otherZeroBackend);
  }
  constructor(provider) {
    super(provider, 'mock');
  }
}

module.exports = Object.assign(Zero, {
  ZeroMock,
  BorrowProxy,
  preprocessor,
  getSignatures,
  LiquidityRequestParcel,
  LiquidityRequest,
  DepositedLiquidityRequestParcel
}, utils);
