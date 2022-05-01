/*
 *
 * Statistics (Updated)
 *
 */

const utils = require('./utils');
const { Sequelize, Op } = require('sequelize');
const SharesModel = require('../../models/shares.model');
const Algorithms = require('foundation-stratum').algorithms;

////////////////////////////////////////////////////////////////////////////////

// Main Statistics Function
const PoolStatistics = function (logger, client, sequelize, poolConfig, portalConfig) {

  const _this = this;
  process.setMaxListeners(0);

  this.pool = poolConfig.name;
  this.client = client;
  this.sequelize = sequelize;
  this.poolConfig = poolConfig;
  this.portalConfig = portalConfig;
  this.forkId = process.env.forkId;

  const sequelizeShares = SharesModel(sequelize, Sequelize);
  if (typeof(sequelizeShares) === 'function') {
    this.sequelize.sync({ force: false })
  };

  const logSystem = 'Pool';
  const logComponent = poolConfig.name;
  const logSubCat = `Thread ${ parseInt(_this.forkId) + 1 }`;

  // Current Statistics Intervals
  _this.blocksInterval = _this.poolConfig.statistics.blocksInterval || 20;
  _this.hashrateInterval = _this.poolConfig.statistics.hashrateInterval || 20;
  _this.historicalInterval = _this.poolConfig.statistics.historicalInterval || 1800;
  _this.refreshInterval = _this.poolConfig.statistics.refreshInterval || 20;
  _this.paymentsInterval = _this.poolConfig.statistics.paymentsInterval || 20;
  _this.usersInterval = _this.poolConfig.statistics.usersInterval || 600;

  // Current Statistics Windows
  _this.hashrateWindow = _this.poolConfig.statistics.hashrateWindow || 300;
  _this.historicalWindow = _this.poolConfig.statistics.historicalWindow || 86400;

  // Calculate Historical Information TEST
  this.calculateHistoricalInfo = function(results, blockType) {
    const commands = [];
    const dateNow = Date.now();
    const algorithm = _this.poolConfig.primary.coin.algorithms.mining;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    
    const tenMinutes = 10 * 60 * 1000;
    const potentialTimestamp = Math.floor(dateNow / tenMinutes) * tenMinutes;
    const lastTimestamp = results[4][1] * 1000;

    if (lastTimestamp < potentialTimestamp || isNaN(lastTimestamp)) {
      // Build Historical Output
      const output = {
        time: potentialTimestamp,
        hashrate: {
          shared: utils.processIdentifiers(results[1], multiplier, _this.hashrateWindow),
          solo: utils.processIdentifiers(results[2], multiplier, _this.hashrateWindow),
        },
        network: {
          difficulty: parseFloat((results[0] || {}).difficulty || 0),
          hashrate: parseFloat((results[0] || {}).hashrate || 0),
        },
        status: {
          miners: utils.combineMiners(results[1], results[2]),
          workers: utils.combineWorkers(results[1], results[2]),
        },
      };

      // Handle Historical Updates
      commands.push(['zadd', `${ _this.pool }:statistics:${ blockType }:historical`, potentialTimestamp / 1000 | 0, JSON.stringify(output)]);
    } 

    return commands;
  };

  // Handle Users Information in Redis
  this.handleUsersInfo = function(blockType, callback, handler) {
    const minPayment = _this.poolConfig.primary.payments.minPayment || 1;
    const commands = [];
    const usersLookups = [
      ['hgetall', `${ _this.pool }:workers:${ blockType }:shared`],
      ['hgetall', `${ _this.pool }:miners:${ blockType }`]
    ];
    _this.executeCommands(usersLookups, (results) => {
      const workers = results[0] || {};
      const miners = results[1] || {};
      for (const [key, value] of Object.entries(workers)) {
        const workerObject = JSON.parse(value);
        const worker = workerObject.worker;
        const miner = worker.split('.')[0];
        if (!(miner in miners)) {
          const minerObject = {
            firstJoined: workerObject.time,
            payoutLimit: minPayment
          }
          const output = JSON.stringify(minerObject);
          commands.push(['hset', `${ _this.pool }:miners:${ blockType }`, miner, output]);  
        }
      };
      callback(commands);
    }, handler);
  };

  // Handle Blocks Information in Redis
  this.handleBlocksInfo = function(blockType, callback, handler) {
    const commands = [];
    const blocksLookups = [
      ['smembers', `${ _this.pool }:blocks:${ blockType }:confirmed`]];
    _this.executeCommands(blocksLookups, (results) => {
      const blocks = results[0].sort((a, b) => JSON.parse(a).time - JSON.parse(b).time);
      if (blocks.length > 100) {
        blocks.slice(0, blocks.length - 100).forEach((block) => {
          commands.push(['srem', `${ _this.pool }:blocks:${ blockType }:confirmed`, block]);
        });
      }
      callback(commands);
    }, handler);
  };

  // Handle Hashrate Information in Redis
  this.handleHashrateInfo = function(blockType, callback) {
    const commands = [];
    const windowTime = (((Date.now() / 1000) - _this.hashrateWindow) | 0).toString();
    commands.push(['zremrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:shared:hashrate`, 0, `(${ windowTime }`]);
    commands.push(['zremrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:solo:hashrate`, 0, `(${ windowTime }`]);
    callback(commands);
  };

  // Get Historical Information from Redis
  this.handleHistoricalInfo = function(blockType, callback, handler) {
    const windowTime = (((Date.now() / 1000) - _this.hashrateWindow) | 0).toString();
    const windowHistorical = (((Date.now() / 1000) - _this.historicalWindow) | 0).toString();
    const historicalLookups = [
      ['hgetall', `${ _this.pool }:statistics:${ blockType }:network`],
      ['zrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:shared:hashrate`, windowTime, '+inf'],
      ['zrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:solo:hashrate`, windowTime, '+inf'],
      ['zremrangebyscore', `${ _this.pool }:statistics:${ blockType }:historical`, 0, `(${ windowHistorical }`],
      ['zrevrangebyscore', `${ _this.pool }:statistics:${ blockType }:historical`, '+inf', '-inf', 'WITHSCORES', 'LIMIT', 0, 1]]; 
    _this.executeCommands(historicalLookups, (results) => {
      const commands = _this.calculateHistoricalInfo(results, blockType);
      callback(commands);
    }, handler);
  };

  // Get Mining Statistics from Daemon
  this.handleMiningInfo = function(daemon, blockType, callback, handler) {
    const commands = [];
    daemon.cmd('getmininginfo', [], true, (result) => {
      if (result.error) {
        logger.error('Statistics', _this.pool, `Error with statistics daemon: ${ JSON.stringify(result.error) }`);
        handler(result.error);
      } else {
        const data = result.response;
        commands.push(['hset', `${ _this.pool }:statistics:${ blockType }:network`, 'difficulty', data.difficulty]);
        commands.push(['hset', `${ _this.pool }:statistics:${ blockType }:network`, 'hashrate', data.networkhashps]);
        commands.push(['hset', `${ _this.pool }:statistics:${ blockType }:network`, 'height', data.blocks]);
        callback(commands);
      }
    });
  };

  // Handle Payments Information in Redis
  this.handlePaymentsInfo = function(blockType, callback, handler) {
    const commands = [];
    const paymentsLookups = [
      ['zrangebyscore', `${ _this.pool }:payments:${ blockType }:records`, '-inf', '+inf']];
    _this.executeCommands(paymentsLookups, (results) => {
      const records = results[0].sort((a, b) => JSON.parse(a).time - JSON.parse(b).time);
      if (records.length > 100) {
        records.slice(0, records.length - 100).forEach((record) => {
          commands.push(['zrem', `${ _this.pool }:payments:${ blockType }:records`, record]);
        });
      }
      callback(commands);
    }, handler);
  };

  // Execute Redis Commands
  /* istanbul ignore next */
  this.executeCommands = function(commands, callback, handler) {
    _this.client.multi(commands).exec((error, results) => {
      if (error) {
        logger.error(logSystem, logComponent, logSubCat, `Error with redis statistics processing ${ JSON.stringify(error) }`);
        handler(error);
      } else {
        callback(results);
      }
    });
  };

  // Start Interval Initialization
  /* istanbul ignore next */
  this.handleIntervals = function(daemon, blockType) {

    // Handle User Info Interval
    setInterval(() => {
      _this.handleUsersInfo(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating user statistics for ${ blockType } configuration.`);
          }
        }, () => {});
      }, () => {});
    }, _this.usersInterval * 1000);

    // Handle Blocks Info Interval
    // This merely deletes blocks if there's more than 100 confirmed ... no need for this until I reach 10% share
    // setInterval(() => {
    //   _this.handleBlocksInfo(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating blocks statistics for ${ blockType } configuration.`);
    //       }
    //     }, () => {});
    //   }, () => {});
    // }, _this.blocksInterval * 1000);

    // Handle Hashrate Data Interval
    setInterval(() => {
      _this.handleHashrateInfo(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating hashrate statistics for ${ blockType } configuration.`);
          }
        }, () => {});
      });
    }, _this.hashrateInterval * 1000);

    // Delete old shares cache
    setInterval(() => {
      sequelizeShares
        .destroy({
          where: {
            share: {
              time: {
                [Op.lte]: (Date.now() - (_this.historicalWindow * 1000)),
              }
            }
          }
        })
        .then(() => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished deleting share cache for ${ blockType } configuration.`);
          }
        })
    }, _this.historicalInterval * 1000);

    // Handle Historical Data Interval
    setInterval(() => {
      _this.handleHistoricalInfo(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating historical statistics for ${ blockType } configuration.`);
          }
        }, () => {});
      }, () => {});
    }, _this.historicalInterval * 1000);

    // Handle Mining Info Interval
    setInterval(() => {
      _this.handleMiningInfo(daemon, blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating network statistics for ${ blockType } configuration.`);
          }
        }, () => {});
      }, () => {});
    }, _this.refreshInterval * 1000);

    // Handle Payment Info Interval
    setInterval(() => {
      _this.handlePaymentsInfo(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating payments statistics for ${ blockType } configuration.`);
          }
        }, () => {});
      }, () => {});
    }, _this.paymentsInterval * 1000);
  };

  // Start Interval Initialization
  /* istanbul ignore next */
  this.setupStatistics = function(poolStratum) {
    if (poolStratum.primary.daemon) {
      _this.handleIntervals(poolStratum.primary.daemon, 'primary');
      if (_this.poolConfig.auxiliary && _this.poolConfig.auxiliary.enabled && poolStratum.auxiliary.daemon) {
        _this.handleIntervals(poolStratum.auxiliary.daemon, 'auxiliary');
      }
    }
  };
};

module.exports = PoolStatistics;
