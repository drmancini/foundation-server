/*
 *
 * API (Updated)
 *
 */

const utils = require('./utils');
const md5 = require('blueimp-md5');
const Algorithms = require('foundation-stratum').algorithms;
const { Sequelize, Op } = require('sequelize');
const PaymentsModel = require('../../models/payments.model');
const SharesModel = require('../../models/shares.model');

////////////////////////////////////////////////////////////////////////////////

// Main API Function
const PoolApi = function (client, sequelize, poolConfigs, portalConfig) {

  const _this = this;

  const sequelizePayments = PaymentsModel(sequelize, Sequelize);
  const sequelizeShares = SharesModel(sequelize, Sequelize);
  
  /* istanbul ignore next */
  if ((typeof(sequelizePayments) === 'function') || (typeof(sequelizeShares) === 'function')) {
    sequelize.sync({ force: false })
  };
  
  this.client = client;
  this.poolConfigs = poolConfigs;
  this.portalConfig = portalConfig;
  
  this.headers = {
    'Access-Control-Allow-Headers' : 'Content-Type, Access-Control-Allow-Headers, Access-Control-Allow-Origin, Access-Control-Allow-Methods',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT',
    'Content-Type': 'application/json'
  };

  // Main Endpoints
  //////////////////////////////////////////////////////////////////////////////

  // API Endpoint for /blocks/confirmed
  this.handleBlocksConfirmed = function(pool, callback) {
    const commands = [
      ['smembers', `${ pool }:blocks:primary:confirmed`],
      ['smembers', `${ pool }:blocks:auxiliary:confirmed`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: utils.processBlocks(results[0]),
        auxiliary: utils.processBlocks(results[1]),
      });
    }, callback);
  };

  // API Endpoint for /blocks/kicked
  this.handleBlocksKicked = function(pool, callback) {
    const commands = [
      ['smembers', `${ pool }:blocks:primary:kicked`],
      ['smembers', `${ pool }:blocks:auxiliary:kicked`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: utils.processBlocks(results[0]),
        auxiliary: utils.processBlocks(results[1])
      });
    }, callback);
  };

  // API Endpoint for /blocks/pending
  this.handleBlocksPending = function(pool, callback) {
    const commands = [
      ['smembers', `${ pool }:blocks:primary:pending`],
      ['smembers', `${ pool }:blocks:auxiliary:pending`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: utils.processBlocks(results[0]),
        auxiliary: utils.processBlocks(results[1])
      });
    }, callback);
  };

  // API Endpoint for /blocks
  this.handleBlocks = function(pool, callback) {
    const commands = [
      ['smembers', `${ pool }:blocks:primary:confirmed`],
      ['smembers', `${ pool }:blocks:primary:kicked`],
      ['smembers', `${ pool }:blocks:primary:pending`],
      ['smembers', `${ pool }:blocks:auxiliary:confirmed`],
      ['smembers', `${ pool }:blocks:auxiliary:kicked`],
      ['smembers', `${ pool }:blocks:auxiliary:pending`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: {
          confirmed: utils.processBlocks(results[0]),
          kicked: utils.processBlocks(results[1]),
          pending: utils.processBlocks(results[2]),
        },
        auxiliary: {
          confirmed: utils.processBlocks(results[3]),
          kicked: utils.processBlocks(results[4]),
          pending: utils.processBlocks(results[5])
        }
      });
    }, callback);
  };

  // API Endpoint for /blocks/[miner]
  this.handleBlocksSpecific = function(pool, miner, callback) {
    const commands = [
      ['smembers', `${ pool }:blocks:primary:confirmed`],
      ['smembers', `${ pool }:blocks:primary:kicked`],
      ['smembers', `${ pool }:blocks:primary:pending`],
      ['smembers', `${ pool }:blocks:auxiliary:confirmed`],
      ['smembers', `${ pool }:blocks:auxiliary:kicked`],
      ['smembers', `${ pool }:blocks:auxiliary:pending`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: {
          confirmed: utils.listBlocks(results[0], miner),
          kicked: utils.listBlocks(results[1], miner),
          pending: utils.listBlocks(results[2], miner),
        },
        auxiliary: {
          confirmed: utils.listBlocks(results[3], miner),
          kicked: utils.listBlocks(results[4], miner),
          pending: utils.listBlocks(results[5], miner),
        }
      });
    }, callback);
  };

  // API Endpoint for /historical
  this.handleHistorical = function(pool, callback) {
    const historicalWindow = _this.poolConfigs[pool].statistics.historicalWindow;
    const windowHistorical = (((Date.now() / 1000) - historicalWindow) | 0).toString();
    const commands = [
      ['zrangebyscore', `${ pool }:statistics:primary:historical`, windowHistorical, '+inf'],
      ['zrangebyscore', `${ pool }:statistics:auxiliary:historical`, windowHistorical, '+inf']];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: utils.processHistorical(results[0]),
        auxiliary: utils.processHistorical(results[1]),
      });
    }, callback);
  };

  // API Endpoint for /miners/active
  this.handleMinersActive = function(pool, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    const commands = [
      ['hgetall', `${ pool }:rounds:primary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:primary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf']];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: {
          shared: utils.processMiners(results[0], results[1], multiplier, hashrateWindow, true),
          solo: utils.processMiners(results[2], results[3], multiplier, hashrateWindow, true),
        },
        auxiliary: {
          shared: utils.processMiners(results[4], results[5], multiplier, hashrateWindow, true),
          solo: utils.processMiners(results[6], results[7], multiplier, hashrateWindow, true),
        }
      });
    }, callback);
  };

  // API Endpoint for /miners/[miner]
  this.handleMinersSpecific = function(pool, miner, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    const commands = [
      ['hgetall', `${ pool }:payments:primary:balances`],
      ['hgetall', `${ pool }:payments:primary:generate`],
      ['hgetall', `${ pool }:payments:primary:immature`],
      ['hgetall', `${ pool }:payments:primary:paid`],
      ['hgetall', `${ pool }:rounds:primary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:primary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:payments:auxiliary:balances`],
      ['hgetall', `${ pool }:payments:auxiliary:generate`],
      ['hgetall', `${ pool }:payments:auxiliary:immature`],
      ['hgetall', `${ pool }:payments:auxiliary:paid`],
      ['hgetall', `${ pool }:rounds:auxiliary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf']];
    _this.executeCommands(commands, (results) => {

      // Structure Share Data
      const primarySharedShareData = utils.processShares(results[4], miner, 'miner');
      const primarySoloShareData = utils.processShares(results[6], miner, 'miner');
      const auxiliarySharedShareData = utils.processShares(results[12], miner, 'miner');
      const auxiliarySoloShareData = utils.processShares(results[14], miner, 'miner');

      // Structure Times Data
      const primarySharedTimesData = utils.processTimes(results[4], miner, 'miner');
      const auxiliarySharedTimesData = utils.processTimes(results[12], miner, 'miner');

      // Structure Hashrate Data
      const primarySharedHashrateData = utils.processWork(results[5], miner, 'miner');
      const primarySoloHashrateData = utils.processWork(results[7], miner, 'miner');
      const auxiliarySharedHashrateData = utils.processWork(results[13], miner, 'miner');
      const auxiliarySoloHashrateData = utils.processWork(results[15], miner, 'miner');

      // Structure Payments Data
      const primaryBalanceData = utils.processPayments(results[0], miner)[miner];
      const primaryGenerateData = utils.processPayments(results[1], miner)[miner];
      const primaryImmatureData = utils.processPayments(results[2], miner)[miner];
      const primaryPaidData = utils.processPayments(results[3], miner)[miner];
      const auxiliaryBalanceData = utils.processPayments(results[8], miner)[miner];
      const auxiliaryGenerateData = utils.processPayments(results[9], miner)[miner];
      const auxiliaryImmatureData = utils.processPayments(results[10], miner)[miner];
      const auxiliaryPaidData = utils.processPayments(results[11], miner)[miner];

      // Structure Share Type Data
      const primarySharedTypesData = utils.processTypes(results[4], miner, 'miner');
      const primarySoloTypesData = utils.processTypes(results[6], miner, 'miner');
      const auxiliarySharedTypesData = utils.processTypes(results[12], miner, 'miner');
      const auxiliarySoloTypesData = utils.processTypes(results[14], miner, 'miner');

      // Structure Worker Type Data
      const primarySharedWorkerData = utils.listWorkers(results[4], miner);
      const primarySoloWorkerData = utils.listWorkers(results[6], miner);
      const auxiliarySharedWorkerData = utils.listWorkers(results[12], miner);
      const auxiliarySoloWorkerData = utils.listWorkers(results[14], miner);

      // Build Miner Statistics
      callback(200, {
        primary: {
          hashrate: {
            shared: (multiplier * primarySharedHashrateData) / hashrateWindow,
            solo: (multiplier * primarySoloHashrateData) / hashrateWindow,
          },
          payments: {
            balances: primaryBalanceData || 0,
            generate: primaryGenerateData || 0,
            immature: primaryImmatureData || 0,
            paid: primaryPaidData || 0,
          },
          shares: {
            shared: primarySharedTypesData[miner] || {},
            solo: primarySoloTypesData[miner] || {},
          },
          times: {
            shared: primarySharedTimesData[miner] || 0,
          },
          work: {
            shared: primarySharedShareData[miner] || 0,
            solo: primarySoloShareData[miner] || 0,
          },
          workers: {
            shared: primarySharedWorkerData,
            solo: primarySoloWorkerData,
          },
        },
        auxiliary: {
          hashrate: {
            shared: (multiplier * auxiliarySharedHashrateData) / hashrateWindow,
            solo: (multiplier * auxiliarySoloHashrateData) / hashrateWindow,
          },
          payments: {
            balances: auxiliaryBalanceData || 0,
            generate: auxiliaryGenerateData || 0,
            immature: auxiliaryImmatureData || 0,
            paid: auxiliaryPaidData || 0,
          },
          shares: {
            shared: auxiliarySharedTypesData[miner] || {},
            solo: auxiliarySoloTypesData[miner] || {},
          },
          times: {
            shared: auxiliarySharedTimesData[miner] || 0,
          },
          work: {
            shared: auxiliarySharedShareData[miner] || 0,
            solo: auxiliarySoloShareData[miner] || 0,
          },
          workers: {
            shared: auxiliarySharedWorkerData,
            solo: auxiliarySoloWorkerData,
          },
        }
      });
    }, callback);
  };

  // API Endpoint for /miners
  this.handleMiners = function(pool, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    const commands = [
      ['hgetall', `${ pool }:rounds:primary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:primary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf']];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: {
          shared: utils.processMiners(results[0], results[1], multiplier, hashrateWindow, false),
          solo: utils.processMiners(results[2], results[3], multiplier, hashrateWindow, false),
        },
        auxiliary: {
          shared: utils.processMiners(results[4], results[5], multiplier, hashrateWindow, false),
          solo: utils.processMiners(results[6], results[7], multiplier, hashrateWindow, false),
        }
      });
    }, callback);
  };

  // API Endpoint for /payments/balances
  this.handlePaymentsBalances = function(pool, callback) {
    const commands = [
      ['hgetall', `${ pool }:payments:primary:balances`],
      ['hgetall', `${ pool }:payments:auxiliary:balances`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: utils.processPayments(results[0]),
        auxiliary: utils.processPayments(results[1]),
      });
    }, callback);
  };

  // API Endpoint for /payments/generate
  this.handlePaymentsGenerate = function(pool, callback) {
    const commands = [
      ['hgetall', `${ pool }:payments:primary:generate`],
      ['hgetall', `${ pool }:payments:auxiliary:generate`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: utils.processPayments(results[0]),
        auxiliary: utils.processPayments(results[1]),
      });
    }, callback);
  };

  // API Endpoint for /payments/immature
  this.handlePaymentsImmature = function(pool, callback) {
    const commands = [
      ['hgetall', `${ pool }:payments:primary:immature`],
      ['hgetall', `${ pool }:payments:auxiliary:immature`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: utils.processPayments(results[0]),
        auxiliary: utils.processPayments(results[1]),
      });
    }, callback);
  };

  // API Endpoint for /payments/paid
  this.handlePaymentsPaid = function(pool, callback) {
    const commands = [
      ['hgetall', `${ pool }:payments:primary:paid`],
      ['hgetall', `${ pool }:payments:auxiliary:paid`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: utils.processPayments(results[0]),
        auxiliary: utils.processPayments(results[1]),
      });
    }, callback);
  };

  // API Endpoint for /payments/paid
  this.handlePaymentsRecords = function(pool, callback) {
    const commands = [
      ['zrange', `${ pool }:payments:primary:records`, 0, -1],
      ['zrange', `${ pool }:payments:auxiliary:records`, 0, -1]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: utils.processRecords(results[0]),
        auxiliary: utils.processRecords(results[1]),
      });
    }, callback);
  };

  // API Endpoint for /payments
  this.handlePayments = function(pool, callback) {
    const commands = [
      ['hgetall', `${ pool }:payments:primary:balances`],
      ['hgetall', `${ pool }:payments:primary:generate`],
      ['hgetall', `${ pool }:payments:primary:immature`],
      ['hgetall', `${ pool }:payments:primary:paid`],
      ['hgetall', `${ pool }:payments:auxiliary:balances`],
      ['hgetall', `${ pool }:payments:auxiliary:generate`],
      ['hgetall', `${ pool }:payments:auxiliary:immature`],
      ['hgetall', `${ pool }:payments:auxiliary:paid`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: {
          balances: utils.processPayments(results[0]),
          generate: utils.processPayments(results[1]),
          immature: utils.processPayments(results[2]),
          paid: utils.processPayments(results[3]),
        },
        auxiliary: {
          balances: utils.processPayments(results[4]),
          generate: utils.processPayments(results[5]),
          immature: utils.processPayments(results[6]),
          paid: utils.processPayments(results[7]),
        }
      });
    }, callback);
  };

  // API Endpoint for /rounds/current
  this.handleRoundsCurrent = function(pool, callback) {
    const commands = [
      ['hgetall', `${ pool }:rounds:primary:current:shared:shares`],
      ['hgetall', `${ pool }:rounds:primary:current:solo:shares`],
      ['hgetall', `${ pool }:rounds:auxiliary:current:shared:shares`],
      ['hgetall', `${ pool }:rounds:auxiliary:current:solo:shares`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: {
          round: 'current',
          shared: utils.processShares(results[0]),
          solo: utils.processShares(results[1]),
          times: utils.processTimes(results[0]),
        },
        auxiliary: {
          round: 'current',
          shared: utils.processShares(results[2]),
          solo: utils.processShares(results[3]),
          times: utils.processTimes(results[2]),
        }
      });
    }, callback);
  };

  // API Endpoint for /rounds/[height]
  this.handleRoundsHeight = function(pool, height, callback) {
    const commands = [
      ['hgetall', `${ pool }:rounds:primary:round-${ height }:shares`],
      ['hgetall', `${ pool }:rounds:auxiliary:round-${ height }:shares`]];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: {
          round: parseFloat(height),
          times: utils.processTimes(results[0]),
          work: utils.processShares(results[0]),
        },
        auxiliary: {
          round: parseFloat(height),
          times: utils.processTimes(results[1]),
          work: utils.processShares(results[1]),
        }
      });
    }, callback);
  };

  // Helper Function for /rounds
  this.processRounds = function(pool, rounds, blockType, callback, handler) {
    const combined = [];
    if (rounds.length >= 1) {
      const processor = new Promise((resolve,) => {
        rounds.forEach((height, idx) => {
          const commands = [
            ['hgetall', `${ pool }:rounds:${ blockType }:round-${ height }:shares`]];
          _this.executeCommands(commands, (results) => {
            combined.push({
              round: parseFloat(height),
              times: utils.processTimes(results[0]),
              work: utils.processShares(results[0]),
            });
            if (idx === rounds.length - 1) {
              resolve(combined);
            }
          }, handler);
        });
      });
      processor.then((combined) => {
        callback(combined);
      });
    } else {
      callback(combined);
    }
  };

  // API Endpoint for /rounds
  this.handleRounds = function(pool, callback) {
    const keys = [
      ['keys', `${ pool }:rounds:primary:round-*:shares`],
      ['keys', `${ pool }:rounds:auxiliary:round-*:shares`]];
    _this.executeCommands(keys, (results) => {
      const rounds = {};
      const primaryRounds = results[0].map((key) => key.split(':')[3].split('-')[1]);
      const auxiliaryRounds = results[1].map((key) => key.split(':')[3].split('-')[1]);
      _this.processRounds(pool, primaryRounds, 'primary', (combined) => {
        rounds.primary = combined;
        _this.processRounds(pool, auxiliaryRounds, 'auxiliary', (combined) => {
          rounds.auxiliary = combined;
          callback(200, rounds);
        }, callback);
      }, callback);
    }, callback);
  };

  // API Endpoint for /statistics
  /* istanbul ignore next */
  this.handleStatistics = function(pool, callback) {
    const config = _this.poolConfigs[pool] || {};
    const algorithm = config.primary.coin.algorithms.mining;
    const hashrateWindow = config.statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    const commands = [
      ['hgetall', `${ pool }:blocks:primary:counts`],
      ['smembers', `${ pool }:blocks:primary:pending`],
      ['smembers', `${ pool }:blocks:primary:confirmed`],
      ['hgetall', `${ pool }:payments:primary:counts`],
      ['hgetall', `${ pool }:rounds:primary:current:shared:counts`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:statistics:primary:network`],
      ['hgetall', `${ pool }:blocks:auxiliary:counts`],
      ['smembers', `${ pool }:blocks:auxiliary:pending`],
      ['smembers', `${ pool }:blocks:auxiliary:confirmed`],
      ['hgetall', `${ pool }:payments:auxiliary:counts`],
      ['hgetall', `${ pool }:rounds:auxiliary:current:shared:counts`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:statistics:auxiliary:network`],
    ];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: {
          config: {
            coin: config.enabled ? config.primary.coin.name : '',
            symbol: config.enabled ? config.primary.coin.symbol : '',
            algorithm: config.enabled ? config.primary.coin.algorithms.mining : '',
            paymentInterval: config.enabled ? config.primary.payments.paymentInterval : 0,
            minPayment: config.enabled ? config.primary.payments.minPayment : 0,
            recipientFee: config.enabled ? config.primary.recipients.reduce((p_sum, a) => p_sum + a.percentage, 0) : 0,
          },
          blocks: {
            valid: parseFloat(results[0] ? results[0].valid || 0 : 0),
            invalid: parseFloat(results[0] ? results[0].invalid || 0 : 0),
          },
          shares: {
            valid: parseFloat(results[4] ? results[4].valid || 0 : 0),
            stale: parseFloat(results[4] ? results[4].stale || 0 : 0),
            invalid: parseFloat(results[4] ? results[4].invalid || 0 : 0),
          },
          hashrate: {
            shared: (multiplier * utils.processWork(results[5])) / hashrateWindow,
            solo: (multiplier * utils.processWork(results[6])) / hashrateWindow,
          },
          network: {
            difficulty: parseFloat(results[7] ? results[7].difficulty || 0 : 0),
            hashrate: parseFloat(results[7] ? results[7].hashrate || 0 : 0),
            height: parseFloat(results[7] ? results[7].height || 0 : 0),
          },
          payments: {
            last: parseFloat(results[3] ? results[3].last || 0 : 0),
            next: parseFloat(results[3] ? results[3].next || 0 : 0),
            total: parseFloat(results[3] ? results[3].total || 0 : 0),
          },
          status: {
            effort: parseFloat(results[4] ? results[4].effort || 0 : 0),
            luck: utils.processLuck(results[1], results[2]),
            miners: utils.combineMiners(results[5], results[6]),
            workers: utils.combineWorkers(results[5], results[6]),
          },
        },
        auxiliary: {
          config: {
            coin: (config.auxiliary && config.auxiliary.enabled) ? config.auxiliary.coin.name : '',
            symbol: (config.auxiliary && config.auxiliary.enabled) ? config.auxiliary.coin.symbol : '',
            algorithm: (config.auxiliary && config.auxiliary.enabled) ? config.primary.coin.algorithms.mining : '',
            paymentInterval: (config.auxiliary && config.auxiliary.enabled) ? config.auxiliary.payments.paymentInterval : 0,
            minPayment: (config.auxiliary && config.auxiliary.enabled) ? config.auxiliary.payments.minPayment : 0,
            recipientFee: (config.auxiliary && config.auxiliary.enabled) ? config.auxiliary.recipients.reduce((p_sum, a) => p_sum + a.percentage, 0) : 0,
          },
          blocks: {
            valid: parseFloat(results[8] ? results[8].valid || 0 : 0),
            invalid: parseFloat(results[8] ? results[8].invalid || 0 : 0),
          },
          shares: {
            valid: parseFloat(results[12] ? results[12].valid || 0 : 0),
            stale: parseFloat(results[12] ? results[12].stale || 0 : 0),
            invalid: parseFloat(results[12] ? results[12].invalid || 0 : 0),
          },
          hashrate: {
            shared: (multiplier * utils.processWork(results[13])) / hashrateWindow,
            solo: (multiplier * utils.processWork(results[14])) / hashrateWindow,
          },
          network: {
            difficulty: parseFloat(results[15] ? results[15].difficulty || 0 : 0),
            hashrate: parseFloat(results[15] ? results[15].hashrate || 0 : 0),
            height: parseFloat(results[15] ? results[15].height || 0 : 0),
          },
          payments: {
            last: parseFloat(results[11] ? results[11].last || 0 : 0),
            next: parseFloat(results[11] ? results[11].next || 0 : 0),
            total: parseFloat(results[11] ? results[11].total || 0 : 0),
          },
          status: {
            effort: parseFloat(results[12] ? results[12].effort || 0 : 0),
            luck: utils.processLuck(results[9], results[10]),
            miners: utils.combineMiners(results[13], results[14]),
            workers: utils.combineWorkers(results[13], results[14]),
          },
        }
      });
    }, callback);
  };

  // API Endpoint for /workers/active
  this.handleWorkersActive = function(pool, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    const commands = [
      ['hgetall', `${ pool }:rounds:primary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:primary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf']];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: {
          shared: utils.processWorkers(results[0], results[1], multiplier, hashrateWindow, true),
          solo: utils.processWorkers(results[2], results[3], multiplier, hashrateWindow, true),
        },
        auxiliary: {
          shared: utils.processWorkers(results[4], results[5], multiplier, hashrateWindow, true),
          solo: utils.processWorkers(results[6], results[7], multiplier, hashrateWindow, true),
        }
      });
    }, callback);
  };

  // API Endpoint for /workers/[worker]
  this.handleWorkersSpecific = function(pool, worker, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    const commands = [
      ['hgetall', `${ pool }:rounds:primary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:primary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf']];
    _this.executeCommands(commands, (results) => {

      // Structure Share Data
      const primarySharedShareData = utils.processShares(results[0], worker, 'worker');
      const primarySoloShareData = utils.processShares(results[2], worker, 'worker');
      const auxiliarySharedShareData = utils.processShares(results[4], worker, 'worker');
      const auxiliarySoloShareData = utils.processShares(results[6], worker, 'worker');

      // Structure Times Data
      const primarySharedTimesData = utils.processTimes(results[0], worker, 'worker');
      const auxiliarySharedTimesData = utils.processTimes(results[4], worker, 'worker');

      // Structure Hashrate Data
      const primarySharedHashrateData = utils.processWork(results[1], worker, 'worker');
      const primarySoloHashrateData = utils.processWork(results[3], worker, 'worker');
      const auxiliarySharedHashrateData = utils.processWork(results[5], worker, 'worker');
      const auxiliarySoloHashrateData = utils.processWork(results[7], worker, 'worker');

      // Structure Share Type Data
      const primarySharedTypesData = utils.processTypes(results[0], worker, 'worker');
      const primarySoloTypesData = utils.processTypes(results[2], worker, 'worker');
      const auxiliarySharedTypesData = utils.processTypes(results[4], worker, 'worker');
      const auxiliarySoloTypesData = utils.processTypes(results[6], worker, 'worker');

      // Build Worker Statistics
      callback(200, {
        primary: {
          hashrate: {
            shared: (multiplier * primarySharedHashrateData) / hashrateWindow,
            solo: (multiplier * primarySoloHashrateData) / hashrateWindow,
          },
          shares: {
            shared: primarySharedTypesData[worker] || {},
            solo: primarySoloTypesData[worker] || {},
          },
          times: {
            shared: primarySharedTimesData[worker] || 0,
          },
          work: {
            shared: primarySharedShareData[worker] || 0,
            solo: primarySoloShareData[worker] || 0,
          },
        },
        auxiliary: {
          hashrate: {
            shared: (multiplier * auxiliarySharedHashrateData) / hashrateWindow,
            solo: (multiplier * auxiliarySoloHashrateData) / hashrateWindow,
          },
          shares: {
            shared: auxiliarySharedTypesData[worker] || {},
            solo: auxiliarySoloTypesData[worker] || {},
          },
          times: {
            shared: auxiliarySharedTimesData[worker] || 0,
          },
          work: {
            shared: auxiliarySharedShareData[worker] || 0,
            solo: auxiliarySoloShareData[worker] || 0,
          },
        }
      });
    }, callback);
  };

  // API Endpoint for /workers
  this.handleWorkers = function(pool, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    const commands = [
      ['hgetall', `${ pool }:rounds:primary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:primary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:primary:current:solo:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:shared:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:shared:hashrate`, windowTime, '+inf'],
      ['hgetall', `${ pool }:rounds:auxiliary:current:solo:shares`],
      ['zrangebyscore', `${ pool }:rounds:auxiliary:current:solo:hashrate`, windowTime, '+inf']];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        primary: {
          shared: utils.processWorkers(results[0], results[1], multiplier, hashrateWindow, false),
          solo: utils.processWorkers(results[2], results[3], multiplier, hashrateWindow, false),
        },
        auxiliary: {
          shared: utils.processWorkers(results[4], results[5], multiplier, hashrateWindow, false),
          solo: utils.processWorkers(results[6], results[7], multiplier, hashrateWindow, false),
        }
      });
    }, callback);
  };

  //////////////////////////////////////////////////////////////////////////////
  // My New APIs
  //////////////////////////////////////////////////////////////////////////////

  // API Endpoint for /miner/blocks for miner [address]
  this.minerBlocks = function(pool, address, blockType, callback, ) {
    if (blockType == '') {
      blockType = 'primary';

    }
    const commands = [
      ['smembers', `${ pool }:blocks:${ blockType }:confirmed`],
      ['smembers', `${ pool }:blocks:${ blockType }:kicked`],
      ['smembers', `${ pool }:blocks:${ blockType }:pending`],
      ['hgetall', `${ pool }:statistics:${ blockType }:network`]];
    _this.executeCommands(commands, (results) => {
      result = {};
      const currentBlock = results[3].height;

      const confirmed = results[0]
        .map((block) => JSON.parse(block))
        .filter((block) => block.worker.split('.')[0] === address);
      confirmed.forEach((block) => {
        block.pending = false;
        block.miner = block.worker.split('.')[0];
        delete block['worker'];
        block.type = 'block';
      });

      const kicked = results[1]
        .map((block) => JSON.parse(block))
        .filter((block) => block.worker.split('.')[0] === address);
      kicked.forEach((block) => {
        block.pending = false;
        block.miner = block.worker.split('.')[0];
        delete block['worker'];
        block.type = 'orphan';
      });

      //
      const pending = results[2]
        .map((block) => JSON.parse(block))
        .filter((block) => block.worker.split('.')[0] === address);
      pending.forEach((block) => {
        block.pending = currentBlock - block.height < 101 ? true : false;
        block.miner = block.worker.split('.')[0];
        delete block['worker'];
        block.type = 'block';
      });
      
      const data = confirmed
        .concat(kicked, pending)
        .sort((a, b) => (b.height - a.height)); 

      const blockCount = data.length;
      const pageEntries = 10;
      let pageCount = Math.floor(blockCount / pageEntries);
      
      if (blockCount % pageEntries > 0) {
        pageCount += 1;
      }

      result.data = data;
      result.totalPages = pageCount;
      result.totalItems = blockCount;
      
      callback(200, {
        result: result,
      });
    }, callback);
  };

  // API Endpoint for /miner/chart for miner [address]
  this.minerChart = function(pool, address, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const tenMinutes = 1000 * 60 * 10;
    const maxSteps = 24 * 6;
    const lastTimestamp = Math.floor(Date.now() / tenMinutes) * tenMinutes;
    
    sequelizeShares
      .findAll({
        raw: true,
        attributes: ['share', 'share_type'],
        where: {
          pool: pool,
          block_type: 'primary',
          share: {
            worker: {
              [Op.like]: address + '%',
            },
            time: {
              [Op.gte]: 25 * 60 * 60 * 1000,
            },
          }, 
        },
        order: [
          ['share.time', 'asc']
        ],
      })
      .catch((err) => {
        callback(400, [] );
      })
      .then((data) => {
        const output = [];
        const minerHashrateArray = [];
        const movingAverageSteps = 10;
        let firstShare = true;
        let validShares = 0;
        let invalidShares = 0;
        let staleShares = 0;
        let minerWork = 0;
        let timestampDataSteps;
        let workingTimestamp;
        let minerHashrateMA;
        
        data.forEach((share) => {
          const shareTimestamp = share.share.time;

          if (firstShare) {
            if (!shareTimestamp) {
              timestampDataSteps = 0;  
            } else {
              timestampDataSteps = Math.floor((lastTimestamp - shareTimestamp) / tenMinutes) * tenMinutes;
              timestampDataSteps = (timestampDataSteps >= maxSteps) ? maxSteps : timestampDataSteps;
            }
            
            workingTimestamp = lastTimestamp - (timestampDataSteps * tenMinutes);
            
            // fill empty steps with zero values
            if (timestampDataSteps < maxSteps) {
              const missingSteps = maxSteps - timestampDataSteps;
              let tempTimestamp = workingTimestamp - ((maxSteps - timestampDataSteps) * tenMinutes);

              // for (let i = 0; i < missingSteps; i++) {
              for (let i = 0; i < 0; i++) {  
                
                const tempObject = {
                  timestamp: tempTimestamp / 1000,
                  hashrate: 0,
                  averageHashrate: 0,
                  validShares: 0,
                  staleShares: 0,
                  invalidShares: 0
                }
                output.push(tempObject);
                tempTimestamp += tenMinutes;
              }
            }

            firstShare = false;
          }

          if (shareTimestamp >= workingTimestamp && shareTimestamp < (workingTimestamp + tenMinutes)) {
            const work = /^-?\d*(\.\d+)?$/.test(share.share.work) ? parseFloat(share.share.work) : 0;
            
            switch (share.share_type) {
              case 'valid':
                minerWork += work;
                validShares += 1;
                break;
              case 'invalid':
                invalidShares += 1;
                break;
              case 'stale':
                staleShares += 1;
                break;
              default:
                break;
            }
          } else if (shareTimestamp >= (workingTimestamp + tenMinutes)) {
            const minerHashrate = (minerWork * multiplier) / tenMinutes * 1000;
            minerHashrateArray.push(minerHashrate);

            if (minerHashrateArray.length > movingAverageSteps) {
              minerHashrateArray.shift();
            }

            const hashrateArrayLength = minerHashrateArray.length;
            minerHashrateMA = minerHashrateArray.reduce((a, b) => a + b) / hashrateArrayLength;

            const tempObject = {
              timestamp: workingTimestamp / 1000,
              hashrate: minerHashrate,
              averageHashrate: minerHashrateMA,
              validShares: validShares,
              staleShares: staleShares,
              invalidShares: invalidShares
            }

            output.push(tempObject);

            validShares = 0;
            invalidShares = 0;
            staleShares = 0;
            minerWork = 0;
            workingTimestamp += tenMinutes;

          }
        })
        callback(200, output );
      });
  };

  //  API Endpoint dor /miner/details for miner [address]
  this.minerDetails = function(pool, address, blockType, isSolo, callback) {
    if (blockType == '') {
      blockType = 'primary';
    }
    const solo = isSolo ? 'solo' : 'shared';
    const workers = [];
    const commands = [
      ['hget', `${ pool }:miners:${ blockType }`, address],
      ['hgetall', `${ pool }:workers:${ blockType }:${ solo }`],
      ['hgetall', `${ pool }:rounds:${ blockType }:current:${ solo }:shares`],
    ];
    _this.executeCommands(commands, (results) => {
      const miner = JSON.parse(results[0]);

      const shares = results[2] || {};
      for (const [key, value] of Object.entries(shares)) {
        if (key.split('.')[0] === address) {
          const workerObject = {
            worker: key,
            work: JSON.parse(value).work
          }
          workers.push(workerObject);
        }
      }

      workers.sort((a, b) => b.work - a.work);
      const worker = workers[0] || {};

      for (const [key, value] of Object.entries(results[1])) {
        if (key.split('.')[0] === address) {
          const workerData = JSON.parse(value);
          worker.ipHint = workerData.ip_hint;
        }
      }

      const output = {
        firstJoined: miner.firstJoined,
        payoutLimit: miner.payoutLimit || 0,
        ipHint: worker.ipHint
      }
      
      callback(200, {
        result: output
      });
    }, callback);
  }

  //  API Endpoint dor /miner/payments for miner [address]
  this.minerPayments = function(pool, address, page, callback) {
    let totalItems;
    sequelizePayments
      .count({
        where: {
          pool: pool,
        }
      })
      .then((itemCount) => {
        sequelizePayments
          .findAll({
            raw: true,
            attributes: ['transaction', 'paid', 'time'],
            //offset: page * 10,
            //limit: 10,
            where: {
              pool: pool,
              miner: address,
            },
            order: [
              ['time', 'desc']
            ],
          })
          .then((data) => {
            const output = [];
            const totalItems = itemCount;
            const totalPages = Math.floor(totalItems / 10) + (totalItems % 10 > 0 ? 1 : 0);
            
            data.forEach((payment) => {
              const outputPayment = {};
              outputPayment.hash = payment.transaction,
              outputPayment.timestamp = payment.time,
              outputPayment.value = payment.paid,
              output.push(outputPayment);
            });
            callback(200, {
              //countervalue: 'konverze do USD',
              data: output,
              totalItems: totalItems,
              totalPages: totalPages,
            });
          });
      });
  };

  // API Endpoint for /miner/paymentStats for miner [address]
  this.minerPayoutSettings = function(pool, body, blockType, isSolo, callback) {
    let validated = false;
    const dateNow = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const address = body.address;
    const ipHash = md5(body.ipAddress);
    const payoutLimit = body.payoutLimit;
    const solo = isSolo ? 'solo' : 'shared';
    if (blockType == '') {
      blockType = 'primary';
    }

    const commands = [
      ['hgetall', `${ pool }:workers:${ blockType }:${ solo }`],
      ['hget', `${ pool }:miners:${ blockType }`, address],
    ];
    
    _this.executeCommands(commands, (results) => {
      // miners ... payoutLimit
      // workers ... time, worker, ip_hash
      let minerObject = JSON.parse(results[1]);
      console.log(minerObject);

      for (const [key, value] of Object.entries(results[0])) {
        const worker = JSON.parse(value);
        const miner = worker.worker.split('.')[0] || '';
        if (miner === address && worket.time >= (dateNow - twentyFourHours)) {
          if (ipHash == worker.ipHash) {
            console.log('hit');
            validated = true;
          } else {
            console.log('miss');
          }
        }
      }

      if (validated == true) {
        console.log('update payoutLimit');
      }
      
      callback(200, {
        result: 123,
      });
    }, callback);
  };

  // API Endpoint for /miner/paymentStats for miner [address]
  this.minerPaymentStats = function(pool, address, callback) {
    sequelizePayments
      .findAll({
        raw: true,
        attributes: ['transaction', 'paid', 'time'],
        where: {
          pool: pool,
          miner: address,
        },
        order: [
          ['time', 'desc']
        ],
      })
      .then((data) => {
        const transactionCount = data.length;
        const lastPayment = {};
        let totalPaid = 0; 
        let isLastPayment = true;
        data.forEach((payment) => {
          if (isLastPayment) {
              lastPayment.hash = payment.transaction,
              lastPayment.timestamp = payment.time,
              lastPayment.value = payment.paid,
            isLastPayment = false;
          }
          totalPaid += payment.paid
        });
        callback(200, {
          //countervalue: 'honverze do USD',
          lastPayment: lastPayment,
          stats: {
            averageValue: totalPaid / transactionCount,
            totalPaid: totalPaid,
            transactionCount: transactionCount,
          }
        });
      });
  };

  // API Endpoint for /miner/stats for miner [address]
  this.minerStats = function(pool, address, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const hashrateWindowTime = (((Date.now() / 1000) - hashrateWindow) | 0);
    const hashrate12Window = 60 * 60 * 12;
    const hashrate12WindowTime = (((Date.now() / 1000) - hashrate12Window) | 0);
    const hashrate24Window = 60 * 60 * 24;
    const hashrate24WindowTime = (((Date.now() / 1000) - hashrate24Window) | 0);
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    sequelizeShares
      .findAll({
        raw: true,
        attributes: ['share', 'share_type'],
        where: {
          pool: pool,
          share: {
            worker: {
              [Op.like]: address + '%',
            },
            time: {
              [Op.gte]: 24 * 60 * 60 * 1000,
            },
          }, 
        },
        order: [
          ['share.time', 'asc']
        ],
      })
      .then((data) => {
        let hashrateData = 0;
        let hashrate12Data = 0; // change to round hashrate
        let hashrate24Data = 0;
        let valid = 0;
        let invalid = 0;
        let stale = 0;
        
        data.forEach((share) => {
          switch(share.share_type) {
            case 'valid':
              valid += 1;
              
              const work = /^-?\d*(\.\d+)?$/.test(share.share.work) ? parseFloat(share.share.work) : 0;

              if (share.share.time / 1000 > hashrateWindowTime) {
                hashrateData += work;
                hashrate12Data += work;
                hashrate24Data += work;
              } else if (share.share.time / 1000 > hashrate12WindowTime && share.share.time / 1000 <= hashrateWindowTime) {
                hashrate12Data += work;
                hashrate24Data += work;
              } else if (share.share.time / 1000 > hashrate24WindowTime && share.share.time / 1000 <= hashrate12WindowTime) {
                hashrate24Data += work;
              }
              break;
            case 'invalid':
              invalid += 1;
              break;
            case 'stale':
              stale += 1;
              break;
          }
        });

        callback(200, {
          validShares: valid,
          invalidShares: invalid,
          staleShares: stale,
          currentHashrate: (multiplier * hashrateData) / hashrateWindow,
          averageHalfDayHashrate: (multiplier * hashrate12Data) / hashrate12Window,
          averageDayHashrate: (multiplier * hashrate24Data) / hashrate24Window,
        });
      });

    // callback(200, {
    //   primary: {
    //     shared: {
    //       average6Hashrate: 123,
    //       average24Hashrate: 123,
    //       currentHashrate: 123,
    //       invalidShares: 1,
    //       staleShares: 1,
    //       validShares: 1
    //     },
    //     solo: {
    //     },
    //   },
    //   auxiliary: {
    //     shared: {},
    //     solo: {},
    //   }
    // })
  };

  //          workers: utils.combineWorkers(results[5], results[6]),

  // API Endpoint for /miner/workers for miner [address]
  this.minerWorkers = function(pool, address, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const hashrateWindowTime = (((Date.now() / 1000) - hashrateWindow) | 0);
    const hashrate24Window = 60 * 60 * 24;
    sequelizeShares
      .findAll({
        raw: true,
        attributes: ['share', 'share_type'],
        where: {
          pool: pool,
          share: {
            worker: {
              [Op.like]: address + '%',
            },
            time: {
              [Op.gte]: 25 * 60 * 60 * 1000,
            },
          }, 
        },
        order: [
          ['share.time', 'desc']
        ],
      })
      .then((data) => {
        const output = [];
        data.forEach((share) => {
          const worker = share.share.worker.split('.')[1];
          let workerIndex = output.findIndex((obj => obj.name == worker));
          const lastIndex = output.length - 1;

          if (workerIndex == -1) {
            const workerData = {
              name: worker,
              isOnline: false,
              currentHashrate: 0,
              averageHashrate: 0,
              validShares: 0,
              staleShares: 0,
              invalidShares: 0,
              lastSeen: 0,
            };
            output.push(workerData);
            workerIndex = lastIndex + 1;
          }
          
          switch(share.share_type) {
            case 'valid':
              const work = /^-?\d*(\.\d+)?$/.test(share.share.work) ? parseFloat(share.share.work) : 0;
              output[workerIndex].validShares += 1;
              output[workerIndex].averageHashrate += work;
              if (share.share.time / 1000 >= hashrateWindowTime && work > 0) {
                output[workerIndex].currentHashrate += work;
                output[workerIndex].isOnline = true;
              }
              break;
            case 'invalid':
              output[workerIndex].invalidShares += 1;
              break;
            case 'stale':
              output[workerIndex].staleShares += 1;
              break;
          }
          
          if (share.share.time > output[workerIndex].lastSeen) {
            output[workerIndex].lastSeen = share.share.time;
          }          
        });

        output.forEach((worker) => {
          worker.currentHashrate = worker.currentHashrate * multiplier / hashrateWindow;
          worker.averageHashrate = worker.averageHashrate * multiplier / hashrate24Window;
        });
        callback(200, output );
      });
  };

  // API Endpoint for /miner/workerCount
  this.minerWorkerCount = function(pool, address, blockType, isSolo, callback) {
    const config = _this.poolConfigs[pool] || {};
    const solo = isSolo ? 'solo' : 'shared';
    const dateNow = Date.now() / 1000 | 0;
    const onlineWindow = config.statistics.onlineWindow;
    const onlineWindowTime = ((dateNow - onlineWindow) || 0);
    const offlineWindow = config.statistics.offlineWindow;
    const offlineWindowTime = ((dateNow - offlineWindow) || 0);

    if (blockType == '') {
      blockType = 'primary';
    }

    const commands = [
      ['hgetall', `${ pool }:workers:${ blockType }:${ solo }`],
    ];
    _this.executeCommands(commands, (results) => {
      let workerOnlineCount = 0;
      let workerOfflineCount = 0;
      for (const [key, value] of Object.entries(results[0])) {
        const worker = JSON.parse(value);
        const miner = worker.worker.split('.')[0] || '';
        if (miner === address) {
          if (worker.time >= offlineWindowTime && worker.time < onlineWindowTime) {
            workerOfflineCount ++;
          }
          else if (worker.time > onlineWindowTime) {
            workerOnlineCount ++;
          }
        }
      }
      
      callback(200, {
        result: {
          workersOnline: workerOnlineCount,
          workersOffline: workerOfflineCount
        }
      });
    }, callback);
  };

  // API Endpoint for /historical/[miner]
  // primary: {"time":1647200759587,"hashrate":{"shared":[{"identifier":"EU","hashrate":55.75289296213342}],"solo":[{"identifier":"","hashrate":0}]}
  this.handleMinerHistorical = function(pool, miner, callback) {
    sequelizeShares
      .findAll({
        raw:true,
        attributes: ['worker', 'work', 'share_type', 'miner_type', 'identifier', 'time'],
        where: {
          pool: pool,
          worker: {
            [Op.like]: miner + '%',
          },
        }
      })
      .then((data) => {
        callback(200, {
          test: data,
          primary: utils.processMinerHistorical(data, 'primary'),
          auxiliary: utils.processMinerHistorical(data, 'auxiliary'),
        });
      });
  };

  // API Endpoint for /payments/[miner]
  /* istanbul ignore next */
  this.handlePaymentsMinerRecords = function(pool, miner, callback) {
    sequelizePayments
      .findAll({
        raw: true,
        attributes: ['block_type', 'time', 'paid', 'transaction', 'miner'],
        where: {
          pool: pool,
          miner: miner,
        }
      })
      .then((data) => {
        callback(200, {
          primary: utils.processMinerPayments(data, 'primary'),
          auxiliary: utils.processMinerPayments(data, 'auxiliary'),
        });
      });
  };
  
  // API Endpoint for /pool/averageLuck
  this.poolAverageLuck = function(pool, blockType, callback) {
    if (blockType == '') {
      blockType = 'primary';
    }
    const dateNow = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const commands = [
      ['smembers', `${ pool }:blocks:${blockType}:confirmed`],
      ['smembers', `${ pool }:blocks:${blockType}:pending`]];
    _this.executeCommands(commands, (results) => {
      let output;
      let luckSum = 0;
      
      const confirmedBlocks = results[0].map(block => JSON.parse(block)) || [];
      const pendingBlocks = results[1].map(block => JSON.parse(block)) || [];
      const blocks = confirmedBlocks.concat(pendingBlocks);

      blocks.filter((block) => block.time > dateNow - thirtyDays).forEach((block) => luckSum += block.luck);
      const blockCount = blocks.length;
      if (blockCount == 0) {
        output = null;
      } else if (blockCount > 0) {
        output = luckSum / blockCount;
      }
      
      callback(200, {
        result: output,
      });
    }, callback);
  };

  // API Endpoint for /pool/blocks
  this.poolBlocks = function(pool, blockType, callback) {
    if (blockType == '') {
      blockType = 'primary';
    }

    const commands = [
      ['smembers', `${ pool }:blocks:${ blockType }:confirmed`],
      ['smembers', `${ pool }:blocks:${ blockType }:kicked`],
      ['smembers', `${ pool }:blocks:${ blockType }:pending`],
      ['hgetall', `${ pool }:statistics:${ blockType }:network`]];

    _this.executeCommands(commands, (results) => {
      result = {};
      const currentBlock = results[3].height;
      
      const confirmed = results[0]
        .map((block) => JSON.parse(block));
      confirmed.forEach((block) => {
        block.pending = false;
        block.miner = block.worker.split('.')[0];
        delete block['worker'];
        block.type = 'block';
      });

      const kicked = results[1]
        .map((block) => JSON.parse(block));
      kicked.forEach((block) => {
        block.pending = false;
        block.miner = block.worker.split('.')[0];
        delete block['worker'];
        block.type = 'orphan';
      });

      const pending = results[2]
        .map((block) => JSON.parse(block));
      pending.forEach((block) => {
        block.pending = currentBlock - block.height < 101 ? true : false;
        block.miner = block.worker.split('.')[0];
        delete block['worker'];
        block.type = 'block';
      });
      
      const data = confirmed
        .concat(kicked, pending)
        .sort((a, b) => (b.height - a.height)); 

      const blockCount = data.length;
      const pageEntries = 10;
      let pageCount = Math.floor(blockCount / pageEntries);
      
      if (blockCount % pageEntries > 0) {
        pageCount += 1;
      }

      result.data = data;
      result.totalPages = pageCount;
      result.totalItems = blockCount;
      
      callback(200, {
        result: result,
      });
    }, callback);
  };

  // API Endpoint for /pool/clientIP
  this.poolClientIP = function(remoteAddress, callback) {
    callback(200, {
        result: remoteAddress,
      });
  };
  
  // API Endpoint for /pool/currentLuck
  this.poolCurrentLuck = function(pool, blockType, isSolo, callback) {
    if (blockType == '') {
      blockType = 'primary';
    }
    const solo = isSolo ? 'solo' : 'shared';
    const commands = [
      ['hgetall', `${ pool }:rounds:${ blockType }:current:${ solo }:counts`]
    ];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        result: parseFloat(results[0] ? results[0].effort || 0 : 0),
      });
    }, callback);
  };

  // API Endpoint for /pool/hashrate
  this.poolHashrate = function(pool, blockType, isSolo, callback) {
    if (blockType == '') {
      blockType = 'primary';
    }
    const solo = isSolo ? 'solo' : 'shared';
    const config = _this.poolConfigs[pool] || {};
    const algorithm = config.primary.coin.algorithms.mining;
    const hashrateWindow = config.statistics.hashrateWindow;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const windowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    const commands = [
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:hashrate`, windowTime, '+inf']
    ];
    _this.executeCommands(commands, (results) => {
      callback(200, {
        result: {
          total: multiplier * utils.processWork(results[0]) / hashrateWindow,
        },
      });
    }, callback);
  };

  // API Endpoint for /pool/hashrateChart
  this.poolHashrateChart = function(pool, blockType, callback) {
    const historicalWindow = _this.poolConfigs[pool].statistics.historicalWindow;
    const windowHistorical = (((Date.now() / 1000) - historicalWindow) | 0).toString();
    if (blockType == '') {
      blockType = 'primary';
    }

    const commands = [
      ['zrangebyscore', `${ pool }:statistics:${ blockType }:historical`, windowHistorical, '+inf'],  
    ];
    _this.executeCommands(commands, (results) => { 
      const output = [];
      results[0].forEach((entry) => {
        const data = JSON.parse(entry);
        const outputObject = {};
        outputObject.timestamp = data.time;
        outputObject.region = {};
        let total = 0;
        data.hashrate.shared.forEach((identifier) => {
          outputObject.region[identifier.identifier] = identifier.hashrate; 
          total += identifier.hashrate;
        });
        outputObject.total = total;
        output.push(outputObject);
      });
      callback(200, output);
    }, callback);   
  };

  // API Endpoint for /pool/minerCount
  this.poolMinerCount = function(pool, blockType, isSolo, callback) {
    const config = _this.poolConfigs[pool] || {};
    const solo = isSolo ? 'solo' : 'shared';
    const onlineWindow = config.statistics.onlineWindow;
    const onlineWindowTime = (((Date.now() / 1000) - onlineWindow) | 0);

    if (blockType == '') {
      blockType = 'primary';
    }

    const commands = [
      ['hgetall', `${ pool }:workers:${ blockType }:${ solo }`]
    ];
    _this.executeCommands(commands, (results) => {
      const miners = [];
      for (const [key, value] of Object.entries(results[0])) {
        const minerData = JSON.parse(value);
        const miner = minerData.worker.split('.')[0];
        const lastShareTime = minerData.time;
        if (!miners.includes(miner) && lastShareTime >= onlineWindowTime) {
          miners.push(miner);
        }
      }
      
      callback(200, {
        result: miners.length
      });
    }, callback);
  };

  // API Endpoint for /pool/topMiners2
  this.poolTopMiners = function(pool, blockType, isSolo, callback) {
    const config = _this.poolConfigs[pool] || {};
    const algorithm = config.primary.coin.algorithms.mining;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const dateNow = Date.now();
    const hashrateWindow = config.statistics.hashrateWindow;
    const hashrateWindowTime = ((dateNow / 1000) - hashrateWindow | 0);
    const onlineWindow = config.statistics.onlineWindow;
    const onlineWindowTime = ((dateNow / 1000) - onlineWindow | 0);
    if (blockType == '') {
      blockType = 'primary';
    }
    const solo = isSolo ? 'solo' : 'shared';

    const commands = [
      ['hgetall', `${ pool }:workers:${ blockType }:${ solo }`],
      ['zrangebyscore', `${ pool }:rounds:${ blockType}:current:${ solo }:hashrate`, hashrateWindowTime, '+inf'],
    ];
    _this.executeCommands(commands, (results) => {
      const workers = [];
      for (const [key, value] of Object.entries(results[0])) {
        const worker = JSON.parse(value);
        if (worker.time > onlineWindowTime) {
          workers.push(worker.worker);
        }
      };

      const miners = [];
      results[1].forEach((entry) => {
        const share = JSON.parse(entry);
        const work = /^-?\d*(\.\d+)?$/.test(share.work) ? parseFloat(share.work) : 0;
        const miner = share.worker.split('.')[0];
        minerIndex = miners.findIndex((obj => obj.miner == miner));
        if (minerIndex == -1) {
          minerObject = {
            miner: miner,
            work: work
          };
          miners.push(minerObject);
        } else {
          miners[minerIndex].work += work;
        }
      });
      const topMiners = miners.sort((a,b) => b.work - a.work).slice(0, 10);

      topMiners.forEach((miner) => {
        let workerCount = 0;
        workers.forEach((worker) => {
          if (miner.miner == worker.split('.')[0]) {
            workerCount ++;
          }
        })
        miner.workerCount = workerCount;
        miner.hashrate = miner.work * multiplier / hashrateWindow;
        miner.firstJoined = 123;
        delete miner.work;
      });

      callback(200, {
        result: topMiners
      });
    }, callback);
  };

  // API Endpoint for /pool/workerCount
  this.poolWorkerCount = function(pool, blockType, isSolo, callback) {
    const config = _this.poolConfigs[pool] || {};
    const solo = isSolo ? 'solo' : 'shared';
    const onlineWindow = config.statistics.onlineWindow;
    const onlineWindowTime = (((Date.now() / 1000) - onlineWindow) | 0);

    if (blockType == '') {
      blockType = 'primary';
    }

    const commands = [
      ['hgetall', `${ pool }:workers:${ blockType }:${ solo }`]
    ];
    _this.executeCommands(commands, (results) => {
      let workerCount = 0;
      for (const [key, value] of Object.entries(results[0])) {
        const worker = JSON.parse(value);
        if (worker.time > onlineWindowTime) {
          workerCount ++;
        };
      }
      
      callback(200, {
        result: workerCount
      });
    }, callback);
  };

  //////////////////////////////////////////////////////////////////////////////

  // Execute Redis Commands
  /* istanbul ignore next */
  this.executeCommands = function(commands, callback, handler) {
    _this.client.multi(commands).exec((error, results) => {
      if (error) {
        handler(500, 'The server was unable to handle your request. Verify your input or try again later');
      } else {
        callback(results);
      }
    });
  };

  // Build API Payload for each Endpoint
  this.buildResponse = function(code, message, response) {
    const payload = {
      version: '0.0.1',
      statusCode: code,
      headers: _this.headers,
      body: message,
    };
    response.writeHead(code, _this.headers);
    response.end(JSON.stringify(payload));
  };

  // Determine API Endpoint Called
  this.handleApiV2 = function(req, callback) {

    let type, endpoint, method, blockType, isSolo, address, page;
    const miscellaneous = ['pools'];

    // If Path Params Exist
    if (req.params) {
      pool = utils.validateInput(req.params.pool || '');
      type = utils.validateInput(req.params.type || '');
      endpoint = utils.validateInput(req.params.endpoint || '');
    }

    // If Query Params Exist
    if (req.query) {
      method = utils.validateInput(req.query.method || '');
      blockType = utils.validateInput(req.query.blockType || '');
      isSolo = utils.validateInput(req.query.isSolo || '');
      address = utils.validateInput(req.query.address || '');
      page = utils.validateInput(req.query.page || '');
    }

    // Check if Requested Pool Exists
    if (!(pool in _this.poolConfigs) && !(miscellaneous.includes(pool))) {
      callback(404, 'The requested pool was not found. Verify your input and try again');
      return;
    }

    // Select Endpoint from Parameters
    switch (true) {
      case (type === 'miner'):
        switch (true) {
          case (endpoint === 'blocks' && address.length > 0):
            _this.minerBlocks(pool, address, blockType, (code, message) => callback(code, message));
            break;
          case (endpoint === 'chart' && address.length > 0):
            _this.minerChart(pool, address, (code, message) => callback(code, message));
            break;
          case (endpoint === 'details' && address.length > 0):
            _this.minerDetails(pool, address, blockType, isSolo, (code, message) => callback(code, message));
            break;
          case (endpoint === 'payments' && address.length > 0):
            _this.minerPayments(pool, address, page, (code, message) => callback(code, message));
            break;
          case (endpoint === 'paymentStats' && address.length > 0):
            _this.minerPaymentStats(pool, address, (code, message) => callback(code, message));
            break;
          case (endpoint === 'stats' && address.length > 0):
            _this.minerStats(pool, address, (code, message) => callback(code, message));
            break;
          case (endpoint === 'workerCount' && address.length > 0):
            _this.minerWorkerCount(pool, address, blockType, isSolo, (code, message) => callback(code, message));
            break;
          case (endpoint === 'workers' && address.length > 0):
            _this.minerWorkers(pool, address, (code, message) => callback(code, message));
            break;
          default:
            callback(405, 'The requested endpoint does not exist. Verify your input and try again');
            break;
        }
        break;
      case (type === 'pool'):
        switch (true) {
          case (endpoint === 'averageLuck'):
            _this.poolAverageLuck(pool, blockType, (code, message) => callback(code, message));
            break;
          case (endpoint === 'blocks'):
            _this.poolBlocks(pool, blockType, (code, message) => callback(code, message));
            break;
          case (endpoint === 'currentLuck'):
            _this.poolCurrentLuck(pool, blockType, isSolo, (code, message) => callback(code, message));
            break;
          case (endpoint === 'hashrate'):
            _this.poolHashrate(pool, blockType, isSolo, (code, message) => callback(code, message));
            break;
          case (endpoint === 'hashrateChart'):
            _this.poolHashrateChart(pool, blockType, (code, message) => callback(code, message));
            break;
          case (endpoint === 'minerCount'):
            _this.poolMinerCount(pool, blockType, isSolo, (code, message) => callback(code, message));
            break;
          case (endpoint === 'topMiners'):
            _this.poolTopMiners(pool, blockType, isSolo, (code, message) => callback(code, message));
            break;
          case (endpoint === 'workerCount'):
            _this.poolWorkerCount(pool, blockType, isSolo, (code, message) => callback(code, message));
            break;
          default:
            callback(405, 'The requested endpoint does not exist. Verify your input and try again');
            break;
        }
        break;
      default:
        callback(405, 'The requested endpoint does not exist. Verify your input and try again');
      break;
    }
  };

  // Determine API Endpoint Called
  this.handleApiV3 = function(req, callback) {

    let type, endpoint, body, isSolo, blockType, remoteAddress;
    const miscellaneous = ['pools'];

    // If Socket Params Exist
    if (req.socket) {
      remoteAddress = req.socket.remoteAddress;
    }

    // If Path Params Exist
    if (req.params) {
      pool = utils.validateInput(req.params.pool || '');
      type = utils.validateInput(req.params.type || '');
      endpoint = utils.validateInput(req.params.endpoint || '');
    }

    // If Query Params Exist
    if (req.query) {
      method = utils.validateInput(req.query.method || '');
      blockType = utils.validateInput(req.query.blockType || '');
      isSolo = utils.validateInput(req.query.isSolo || '');
      address = utils.validateInput(req.query.address || '');
      page = utils.validateInput(req.query.page || '');
    }

    if (req.body) {
      body = req.body || '';
    }

    // Check if Requested Pool Exists
    if (!(pool in _this.poolConfigs) && !(miscellaneous.includes(pool))) {
      callback(404, 'The requested pool was not found. Verify your input and try again');
      return;
    }

    // Select Endpoint from Parameters
    switch (true) {
      case (type === 'miner'):
        switch (true) {
          case (endpoint === 'payoutSettings'):
            _this.minerPayoutSettings(pool, body, blockType, isSolo, (code, message) => callback(code, message));
            break;
          default:
            callback(405, 'The requested endpoint does not exist. Verify your input and try again');
            break;
        }
        break;
      case (type === 'pool'):
        switch (true) {
          case (endpoint === 'clientIP'):
            _this.poolClientIP(remoteAddress, (code, message) => callback(code, message));
            break;
          default:
            callback(405, 'The requested endpoint does not exist. Verify your input and try again');
            break;
        }
        break;
      default:
        callback(405, 'The requested endpoint does not exist. Verify your input and try again');
      break;
    }
  };
};

module.exports = PoolApi;
