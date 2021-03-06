'use strict';

const ethers = require('ethers');
const RpcEngine = require('json-rpc-engine');
const asMiddleware = require('json-rpc-engine/src/asMiddleware');

const providerAsMiddleware = require('eth-json-rpc-middleware/providerAsMiddleware');
const providerFromEngine = require('eth-json-rpc-middleware/providerFromEngine');
const providerCompat = require('./provider-compat');
const personalSignProviderFromGanache = (provider) => {
  provider = providerCompat(provider);
  const engine = new RpcEngine();
  engine.push((req, res, next, end) => {
    if (req.method === 'personal_sign') {
      req.params[0] = ethers.utils.hexlify(ethers.utils.concat([
        ethers.utils.toUtf8Bytes('\x19Ethereum Signed Message:\n'),
        ethers.utils.toUtf8Bytes(String(ethers.utils.arrayify(req.params[0]).length)),
        ethers.utils.arrayify(req.params[0])
      ]));
      req.method = 'eth_sign';
    }
    next();
  });
  engine.push(providerAsMiddleware(provider));
  return makeBaseProvider(providerFromEngine(engine));
};

module.exports = personalSignProviderFromGanache;
