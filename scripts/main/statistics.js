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

  // Calculate Historical Information
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

  // Handle Worker Minute-snapshots in Redis 
  this.handleWorkerInfo = function(blockType, callback, handler) {
    const dateNow = Date.now();
    const oneMinute = 1 * 60 * 1000;
    const minuteEnd = Math.floor(dateNow / oneMinute) * oneMinute;
    const minuteStart = minuteEnd - oneMinute;
    const workerLookups = [
      ['zrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:shared:hashrate`, 0, minuteEnd / 1000],
      ['zrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:shared:snapshots`, minuteEnd / 1000, minuteEnd / 1000]
    ];
    _this.executeCommands(workerLookups, (results) => {
      const commands = [];
      const snapshotShares = [];
      const snapshotWorkers = [];
      const previousShares = [];
      const snapshots = [];

      results[0].forEach((share) => {
        share = JSON.parse(share);
        if (share.time > minuteStart) {
          
          snapshotShares.push(share);
        } else if (share.time <= minuteStart) {
          const workerIndex = previousShares.findIndex(worker => worker.worker === share.worker);
          if (workerIndex != -1 && previousShares[workerIndex].time < share.time) {
            previousShares[workerIndex].time = share.time;
            previousShares[workerIndex].valid = share.types.valid;
            previousShares[workerIndex].stale = share.types.stale;
            previousShares[workerIndex].invalid = share.types.invalid;
          } else if (workerIndex === -1) {
            const workerObject = {
              worker: share.worker,
              valid: share.types.valid,
              stale: share.types.stale,
              invalid: share.types.invalid,
              time: share.time
            };
            previousShares.push(workerObject);
          }          
        }
      });

      console.log(previousShares);

      results[1].forEach((snapshot) => {
        snapshots.push(JSON.parse(snapshot));
      });

      if (snapshotShares.length > 0) {
      //   const workers = [];
      //   snapshotShares.forEach((snapshotShare) => {
      //     const workerIndex = workers.findIndex(worker => worker.worker === snapshotShare.worker);

      //     // test snapshots somewhere
      //     if (workerIndex == -1) {
      //       console.log('new');
      //       // Find last worker share ...
      //       let previousShare;
      //       if (previousShares.filter((share) => share.worker === snapshotShare.worker).length > 0) {
      //         // ... either from previous snapshot
      //         previousShare = previousShares.sort((a, b) => b.time - a.time)[0];
      //       } else {
      //         // ... or first share from current snapshot
      //         previousShare = snapshotShares
      //           .filter((share) => share.worker === snapshotShare.worker)
      //           .sort((a, b) => a.time - b.time)[0];
      //       }   
          
      //       const objectTemplate = {
      //         worker: snapshotShare.worker,
      //         work: snapshotShare.work || 0,
      //         time: minuteEnd / 1000 | 0,
      //         validMin: previousShare.types.valid || 0,
      //         validMax: snapshotShare.types.valid || 0,
      //         staleMin: previousShare.types.stale || 0,
      //         staleMax: snapshotShare.types.stale || 0,
      //         invalidMin: previousShare.types.invalid || 0,
      //         invalidMax: snapshotShare.types.invalid || 0,
      //       };
      //       workers.push(objectTemplate);
      //     } else {
      //       workers[workerIndex].work += snapshotShare.work;
      //       if (workers[workerIndex].validMax < snapshotShare.types.valid) {
      //         workers[workerIndex].validMax = snapshotShare.types.valid;
      //       }
      //       if (workers[workerIndex].invalidMax < snapshotShare.types.invalid) {
      //         workers[workerIndex].invalidMax = snapshotShare.types.invalid;
      //       }
      //       if (workers[workerIndex].staleMax < snapshotShare.types.stale) {
      //         workers[workerIndex].staleMax = snapshotShare.types.stale;
      //       }
      //     }
      //   });

      //   workers.forEach((worker) => {
      //     worker.valid = worker.validMax - worker.validMin;
      //     worker.stale = worker.staleMax - worker.staleMin;
      //     worker.invalid = worker.invalidMax - worker.invalidMin;
      //     delete worker.validMin;
      //     delete worker.validMax;
      //     delete worker.staleMin;
      //     delete worker.staleMax;
      //     delete worker.invalidMin;
      //     delete worker.invalidMax;

      //     console.log(worker);
      //     if (snapshots.filter(snapshot => snapshot.worker == worker.worker).length == 0) {
      //       commands.push(['zadd', `${ _this.pool }:rounds:${ blockType }:current:shared:snapshots`, minuteEnd / 1000, JSON.stringify(worker)]);  
      //     }
          
      //   });
      }
      callback(commands);
    }, handler);
  };

  // Handle Worker Ten-minute-snapshots in Redis 
  this.handleWorkerInfo2 = function(blockType, callback, handler) {
  //   const dateNow = Date.now();
  //   const tenMinutes = 10 * 60 * 1000;
  //   const oneDay = 24 * 60 * 60 * 1000;
  //   const tenMinutesEnd = Math.floor(dateNow / tenMinutes) * tenMinutes;
  //   const tenMinutesStart = tenMinutesEnd - tenMinutes;
  //   const oneDayAgo = tenMinutesEnd - oneDay;
  const workerLookups = [];
    // const workerLookups = [
      // ['zrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:shared:snapshots`, `(${ tenMinutesStart / 1000 }`, tenMinutesEnd / 1000],
  //     ['zrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:shared:historical`, tenMinutesEnd / 1000, tenMinutesEnd / 1000]];
    _this.executeCommands(workerLookups, (results) => {
  //     const workerData = results[0] || []; // no solo
  //     const snapshots = results[1] || [];
  //     const workers = [];
      const commands = [];

  //     if (snapshots.length == 0) {
  //       workerData.forEach((entry) => {
  //       const workerObject = JSON.parse(entry);
  //       const workerFound = workers.findIndex(element => element.worker == workerObject.worker)
  //       if (workerFound == -1) {
  //         const objectTemplate = {
  //           worker: workerObject.worker,
  //           work: workerObject.work || 0,
  //           timestamp: tenMinutesEnd / 1000,
  //           valid: workerObject.valid || 0,
  //           stale: workerObject.stale || 0,
  //           invalid: workerObject.invalid || 0,
  //         };
  //         workers.push(objectTemplate);
  //         } else {
  //           workers[workerFound].work += workerObject.work;
  //           workers[workerFound].valid += workerObject.valid;
  //           workers[workerFound].stale += workerObject.stale;
  //           workers[workerFound].invalid += workerObject.invalid;
  //         }
  //       });

  //       workers.forEach((entry) => {
  //         commands.push(['zadd', `${ _this.pool }:rounds:${ blockType }:current:shared:historical`, tenMinutesEnd / 1000, JSON.stringify(entry)]);
  //       });

  //       commands.push(['zremrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:shared:snapshots`, 0, tenMinutesEnd / 1000]);
  //       commands.push(['zremrangebyscore', `${ _this.pool }:rounds:${ blockType }:current:shared:historical`, 0, `(${ oneDayAgo / 1000 }`]);
  //     }

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

    // Handle Worker Mining History
    // setInterval(() => {
    //   _this.handleWorkerInfo(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating worker snapshots for ${ blockType } configuration.`);
    //       }
    //     }, () => {});
    //   }, () => {});
    // }, 10 * 1000); // every 20 seconds

    // setInterval(() => {
    //   _this.handleWorkerInfo2(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating historical worker snapshots for ${ blockType } configuration.`);
    //       }
    //     }, () => {});
    //   }, () => {});
    // },  3 * 60 * 1000); // every 3 minutes

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
