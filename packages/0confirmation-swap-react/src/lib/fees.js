import axios from 'axios';
import BN from 'bignumber.js';
import {ChainId, Token, WETH, Route, Pair} from "@uniswap/sdk";
import {RenVM} from '@0confirmation/renvm';
import {ethers} from 'ethers';
import {InfuraProvider} from '@ethersproject/providers';

const { RenJS } = RenVM;

const renBTC = new Token (ChainId.MAINNET, '0xeb4c2781e4eba804ce9a9803c67d0893436bb27d', 18);
const getPair = async() =>  (await Pair.fetchData(renBTC, WETH[renBTC.chainId]));
const getRoute = async() => new Route([await getPair()], WETH[renBTC.chainId]);
export var getPrice = async() => new BN((await getRoute()).midPrice.toSignificant(5)*10000000000);

let renjs = new RenJS('mainnet')
let btcGatewayAddress = renjs.network.addresses.gateways.BTCGateway.artifact.networks[1].address

const abi =[{
    type: 'function',
    name: 'mintFee',
    stateMutability: 'view',
    inputs:[],
    outputs:[{
        type:'uint256',
        name:'some-output-name-doesnt-matter'}]}]
;
const renGatewayContract = new ethers.Contract(btcGatewayAddress, abi, new InfuraProvider('mainnet','2f1de898efb74331bf933d3ac469b98d' ))

export let getFast = async () => (await axios.get('https://ethgasstation.info/api/ethgasAPI.json')).data.fast;
var gasEstimate=new  BN('1.46e6');
var divisorForGwei =new BN('1e8');
var oneEther =new BN('1e18');
var baseMintFee =new BN('0.0007');

export const PERCENTAGE_PRECISION = 2;
export const PRETTY_AMOUNT_PRECISION = 4;
export const ETH_GAS_FEE_PRECISION = 6;
export const GAS_PRICE_PRECISION = 2;

const addData = (o, fast, ethGasFee) => {
  const result = addPercentages(addAggregateFees(o));
  result.fastGasPrice = new BN(fast).dividedBy(10).toFixed(GAS_PRICE_PRECISION);
  result.totalGasCostEth = ethGasFee.toFixed(ETH_GAS_FEE_PRECISION);
  return result;
};

const addPercentages = (o) => Object.keys(o).reduce((r, v) => {
  r[v] = {
    prettyAmount: o[v].amount.toFixed(PRETTY_AMOUNT_PRECISION),
    percentage: o[v].ratio.multipliedBy(100).toFixed(PERCENTAGE_PRECISION) + '%',
    ...o[v]
  };
  return r;
}, {});

const addAggregateFees = (o) => {
  return {
    ...o,
      loanFee: ['daoFee', 'keeperFee', 'liquidityPoolFee'].reduce((r, v) => {
        r.amount = r.amount.plus(o[v].amount);
        r.ratio = r.ratio.plus(o[v].ratio);
        return r;
      }, {
          amount: new BN(0),
          ratio: new BN(0)
      }),
      totalFees: Object.keys(o).reduce((r, v) => {
        r.amount = r.amount.plus(o[v].amount);
        r.ratio = r.ratio.plus(o[v].ratio);
        return r;
      }, {
        amount: new BN(0),
        ratio: new BN(0)
      })
    };
};

export const DEFAULT_FEES = addData({
  keeperFee: {
    ratio: new BN('0.001'),
    amount: new BN('0')
  },
  daoFee: {
    ratio: new BN('0'),
    amount: new BN('0')
  },
  btcGasFee: {
    ratio: new BN('0'),
    amount: new BN('0')
  },
  mintFee: {
    ratio: new BN('0'),
    amount: new BN('0')
  },
  liquidityPoolFee: {
    ratio: new BN('0.001'),
    amount: new BN('0')
  },
  baseFee: {
    amount: new BN('0.0007'),
    ratio: new BN('0')
  }
}, 0, 0);

export const getFees = async (swapAmount) => {
  const mintFeeProportion = new BN(String(await renGatewayContract.mintFee())).dividedBy(new BN('1e8'));
  const mintFee = mintFeeProportion.multipliedBy(swapAmount);
  const fast = new BN(await getFast());
  const ethGasFee = gasEstimate.multipliedBy(divisorForGwei).multipliedBy(fast).dividedBy(oneEther);
  const btcGasFee = ethGasFee.multipliedBy(await getPrice());
  const btcGasFeeProportion = btcGasFee.dividedBy(swapAmount);
  const keeperFeeProportion = DEFAULT_FEES.keeperFee.ratio;
  const keeperFee = keeperFeeProportion.multipliedBy(swapAmount);
  const daoFeeProportion = DEFAULT_FEES.daoFee.ratio;
  const daoFee = daoFeeProportion.multipliedBy(swapAmount);
  const liquidityPoolFeeProportion = DEFAULT_FEES.liquidityPoolFee.ratio;
  const liquidityPoolFee = liquidityPoolFeeProportion.multipliedBy(swapAmount);
  const baseFee = DEFAULT_FEES.baseFee.amount.multipliedBy('1');
  const baseFeeProportion = new BN(baseFee).dividedBy(swapAmount);
  const totalFeeProportion = [ mintFeeProportion, btcGasFeeProportion, keeperFeeProportion, daoFeeProportion, liquidityPoolFeeProportion, baseFeeProportion ].reduce((r, v) => r.plus(v), new BN(0));
  const totalFee = totalFeeProportion.multipliedBy(swapAmount);
  return addData({
    mintFee: {
      ratio: mintFeeProportion,
      amount: mintFee
    },
    btcGasFee: {
      ratio: btcGasFeeProportion,
      amount: btcGasFee
    },
    keeperFee: {
      ratio: keeperFeeProportion,
      amount: keeperFee
    },
    daoFee: {
      amount: daoFee,
      ratio: daoFeeProportion
    },
    liquidityPoolFee: {
      ratio: liquidityPoolFeeProportion,
      amount: liquidityPoolFee
    },
    baseFee: {
      amount: baseFee,
      ratio: baseFeeProportion
    },
    totalFee: {
      ratio: totalFeeProportion,
      amount: totalFee
    }
  }, fast, ethGasFee);
};

  
//Fee in swapped to asset = Fee in BTC * getPrice of swapped to Asset in BTC