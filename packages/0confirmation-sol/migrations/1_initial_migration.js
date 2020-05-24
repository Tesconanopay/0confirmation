const Migrations = artifacts.require('Migrations');
const ShifterPool = artifacts.require('ShifterPool');
const SandboxLib = artifacts.require('SandboxLib');
const UniswapAdapter = artifacts.require('UniswapAdapter');
const SimpleBurnLiquidationModule = artifacts.require('SimpleBurnLiquidationModule');
const ShifterERC20Mock = artifacts.require('ShifterERC20Mock');
const ERC20Adapter = artifacts.require('ERC20Adapter');
const LiquidityToken = artifacts.require('LiquidityToken');
const CurveAdapter = artifacts.require('CurveAdapter');
const ShifterRegistryMock = artifacts.require('ShifterRegistryMock');
const ShifterBorrowProxyFactoryLib = artifacts.require('ShifterBorrowProxyFactoryLib');
const Curvefi = artifacts.require('Curvefi');
const CurveToken = artifacts.require('CurveToken');
const DAI = artifacts.require('DAI');
const WBTC = artifacts.require('WBTC');
const TransferAll = artifacts.require('TransferAll');
const SwapEntireLoan = artifacts.require('SwapEntireLoan');
const UniswapV2Factory = artifacts.require('UniswapV2Factory');
const UniswapV2Router01 = artifacts.require('UniswapV2Router01');
const WETH9 = artifacts.require('WETH9');

const ethers = require('ethers');
const environments = require('@0confirmation/sdk/environments');
const fs = require('fs');

const Zero = require('@0confirmation/sdk');
const { ZeroMock } = Zero;

const ModuleTypes = {
  BY_CODEHASH: 1,
  BY_ADDRESS: 2
};

const kovan = environments.getAddresses('testnet');

const getAddress = (artifact, network_id) => {
  if (network_id) return artifact.networks[network_id].address;
  const highest = Math.max(...Object.keys(artifact.networks).map((v) => Number(v)));
  return artifact.networks[highest].address;
};

const isNetworkOrFork = (v, network) => [network, network + '-fork'].includes(v);

const NO_SUBMODULE = '0x' + Array(40).fill('0').join('');

module.exports = async function(deployer) {
  await deployer.deploy(Migrations);
  await deployer.deploy(ShifterBorrowProxyFactoryLib);
  await deployer.link(ShifterBorrowProxyFactoryLib, ShifterPool);
  await deployer.deploy(ShifterPool);
  await deployer.deploy(ERC20Adapter);
  const erc20Adapter = await ERC20Adapter.deployed();
  let weth, shifterRegistry, dai, renbtc, factory, router;
  if (['ganache', 'test'].find((v) => v === isNetworkOrFork(deployer.network))) {
    await deployer.deploy(WETH9);
    weth = await WETH.deployed();
    await deployer.deploy(DAI);
    dai = await DAI.deployed();
    await deployer.deploy(ShifterRegistryMock);
    shifterRegistry = await ShifterRegistryMock.deployed();
    renbtc = { address: await shifterRegistry.token() };
    await UniswapV2Factory.deploy(ethers.constants.AddressZero);
    factory = await UniswapV2Factory.deployed()
    await deployer.deploy(UniswapV2Router01, factory.address, weth.address);
    router = await UniswapV2Router01.deployed();
    await factory.createPair(weth.address, renbtc.address); // { gasLimit: ethers.utils.hexlify(6e6) });
    await factory.createPair(weth.address, dai.address); //, { gasLimit: ethers.utils.hexlify(6e6) });
  } else {
    renbtc = { address: kovan.renbtc };
    shifterRegistry = { address: kovan.shifterRegistry };
    factory = { address: kovan.factory };
    const uniswapContract = new ethers.Contract(factory.address, Factory.abi, new ethers.providers.InfuraProvider('kovan'));
    renbtcExchange = { address: await uniswapContract.getExchange(renbtc.address) };
  } 
  await deployer.deploy(CurveToken, 'Curve.fi wBTC/renBTC', 'wBTC+renBTC', 8, 0)
  await deployer.deploy(WBTC);
  const wbtc = await WBTC.deployed();
  const curveToken = await CurveToken.deployed();
  await deployer.deploy(Curvefi, [ wbtc.address, renbtc.address ], [ wbtc.address, renbtc.address ], curveToken.address, '100', ethers.utils.parseEther('0').toString())
  const curve = await Curvefi.deployed();
  await curveToken.set_minter(curve.address);
  const shifterPool = await ShifterPool.deployed();
  await deployer.deploy(CurveAdapter, getAddress(Curvefi, deployer.network_id));
  await deployer.deploy(UniswapAdapter, erc20Adapter.address, (deployer.network === 'test' || deployer.network === 'ganache' || deployer.network === 'kovan') ? ethers.utils.parseEther('1').toString() : ethers.utils.parseEther('100').toString());
  await deployer.deploy(SimpleBurnLiquidationModule, router.address, erc20Adapter.address);
  await deployer.deploy(LiquidityToken, shifterPool.address, renbtc.address, 'zeroBTC', 'zeroBTC', 8);
  await deployer;
  const liquidityToken = await LiquidityToken.deployed();
  const uniswapAdapter = await UniswapAdapter.deployed();
  const curveAdapter = await CurveAdapter.deployed();
  const simpleBurnLiquidationModule = await SimpleBurnLiquidationModule.deployed();
  await shifterPool.deployBorrowProxyImplementation();
  await shifterPool.deployAssetForwarderImplementation();
  await shifterPool.setup(shifterRegistry.address, '1000', ethers.utils.parseEther('0.01'), ...((v) => [ v.map((v) => ({ moduleType: v.moduleType, target: v.target, sigs: v.sigs })), v.map((v) => v.module) ])([{
    moduleType: ModuleTypes.BY_ADDRESS,
    target: renbtc.address,
    sigs: Zero.getSignatures(DAI.abi),
    module: {
      isPrecompiled: false,
      assetSubmodule: erc20Adapter.address,
      repaymentSubmodule: erc20Adapter.address,
      liquidationSubmodule: NO_SUBMODULE
    }
  }, {
    moduleType: ModuleTypes.BY_ADDRESS,
    target: router.address,
    sigs: Zero.getSignatures(UniswapV2Router01.abi),
    module: {
      isPrecompiled: false,
      assetSubmodule: uniswapAdapter.address,
      repaymentSubmodule: '0x' + Array(40).fill('0').join(''),
      liquidationSubmodule: simpleBurnLiquidationModule.address
    }
  }, {
    moduleType: ModuleTypes.BY_ADDRESS,
    target: getAddress(Curvefi),
    sigs: Zero.getSignatures(Curvefi.abi),
    module: {
      isPrecompiled: false,
      assetSubmodule: curveAdapter.address,
      repaymentSubmodule: NO_SUBMODULE,
      liquidationSubmodule: simpleBurnLiquidationModule.address
    }
  }, {
    moduleType: ModuleTypes.BY_ADDRESS,
    target: (await DAI.deployed()).address,
    sigs: Zero.getSignatures(DAI.abi),
    module: {
      isPrecompiled: false,
      assetSubmodule: erc20Adapter.address,
      repaymentSubmodule: erc20Adapter.address,
      liquidationSubmodule: NO_SUBMODULE
    }
  }]),
  [{
    token: renbtc.address,
    liqToken: liquidityToken.address
  }]);
  // setup uni and the liquidity pool with some liqudity
  if (isNetworkOrFork(deployer.network, 'test') || isNetworkOrFork(deployer.network, 'ganache')) {
    const amount = ethers.utils.bigNumberify('0xffffffffffffffffffffffffffffffffffffffff');
    const provider = new ethers.providers.Web3Provider(dai.contract.currentProvider);
    const [ truffleAddress ] = await provider.send('eth_accounts', []);
    from = truffleAddress;
    await Promise.all([ [ renbtc.address, 8, '1000' ], [ dai.address, 18, '7724680' ] ].map(async ([ token, decimals, amount ]) => {
      const tokenWrapped = new ethers.Contract(token, DAI.abi, provider.getSigner());
      await (await tokenWrapped.mint(from, ethers.utils.parseUnits(amount, decimals))).wait();
      const routerWrapped = new ethers.Contract(router.address, UniswapV2Router01.abi, provider.getSigner());
      await (await tokenWrapped.approve(router.address, ethers.utils.parseUnits(amount, decimals))).wait();
      await (await routerWrapped.addLiquidityETH(tokenWrapped.address, ethers.utils.parseUnits(amount, decimals), '1', ethers.utils.parseEther('10'), truffleAddress, String(Date.now() * 2), {
        value: ethers.utils.hexlify(ethers.utils.parseEther('10'))
      })).wait();
    }));
    const renbtcWrapped = new ethers.Contract(renbtc.address, ShifterERC20Mock.abi, provider.getSigner());
    await (await renbtcWrapped.mint(from, ethers.utils.parseUnits('10', 8))).wait();
    const zero = new ZeroMock(dai.contract.currentProvider);
    zero.network.shifterPool = shifterPool.address;
    await (await zero.approveLiquidityToken(renbtc.address)).wait();
    await (await zero.addLiquidity(renbtc.address, ethers.utils.parseUnits('5', 8).toString())).wait();
  }
};
