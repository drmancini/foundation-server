/*
 *
 * Statistics (Updated)
 *
 */

const https = require('https');
const utils = require('./utils');
const fs = require('fs')
const nodemailer = require("nodemailer");
const axios = require('axios');
const { Console } = require('console');
const { id } = require('apicache');
const Algorithms = require('foundation-stratum').algorithms;

////////////////////////////////////////////////////////////////////////////////

// Main Statistics Function
const PoolStatistics = function (logger, client, poolConfig, portalConfig) {

  const _this = this;
  process.setMaxListeners(0);

  this.pool = poolConfig.name;
  this.client = client;
  this.poolConfig = poolConfig;
  this.portalConfig = portalConfig;
  this.forkId = process.env.forkId;

  const logSystem = 'Pool';
  const logComponent = poolConfig.name;
  const logSubCat = `Thread ${parseInt(_this.forkId) + 1}`;

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
  this.calculateHistoricalInfo = function (results, blockType) {
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
      commands.push(['zadd', `${_this.pool}:statistics:${blockType}:historical`, potentialTimestamp / 1000 | 0, JSON.stringify(output)]);
    }

    return commands;
  };

  // Handle Coin Gecko Information in Redis
  this.handleCoingeckoData = function (blockType, callback, handler) {
    const coinName = _this.poolConfig[blockType].coin.name.toLowerCase() || '';
    let commands = [];

    if (coinName == 'raptoreum') {
      const getCoin = async () => {
        try {
          return await axios.get('https://api.coingecko.com/api/v3/coins/' + coinName);
        } catch (error) {
          console.error(error);
        }
      }

      const getData = async () => {
        const apiData = await getCoin()

        if (apiData.data) {
          const data = apiData.data.market_data.current_price;
          const change24h = apiData.data.market_data.price_change_percentage_24h;
          const change7d = apiData.data.market_data.price_change_percentage_7d;
          const change30d = apiData.data.market_data.price_change_percentage_30d;
          const change60d = apiData.data.market_data.price_change_percentage_60d;

          for (const [key, value] of Object.entries(data)) {
            commands.push(['hset', `${_this.pool}:coin:${blockType}`, key, value]);
          }
          commands.push(['hset', `${_this.pool}:coin:${blockType}`, 'price24h', change24h]);
          commands.push(['hset', `${_this.pool}:coin:${blockType}`, 'price7d', change7d]);
          commands.push(['hset', `${_this.pool}:coin:${blockType}`, 'price30d', change30d]);
          commands.push(['hset', `${_this.pool}:coin:${blockType}`, 'price60d', change60d]);

          callback(commands);
        }
      }
      getData();
    }
  };

  // Add new Users to Redis
  this.handleUsersInfo = function (blockType, callback, handler) {
    const minPayment = _this.poolConfig.primary.payments.minPayment || 1;
    const commands = [];
    const usersLookups = [
      ['hgetall', `${_this.pool}:workers:${blockType}:shared`],
      ['hgetall', `${_this.pool}:miners:${blockType}`]
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
          commands.push(['hset', `${_this.pool}:miners:${blockType}`, miner, output]);
        }
      };
      callback(commands);
    }, handler);
  };

  // Handle Blocks Information in Redis
  this.handleBlocksInfo = function (blockType, callback, handler) {
    const commands = [];
    const blocksLookups = [
      ['smembers', `${_this.pool}:blocks:${blockType}:confirmed`]];
    _this.executeCommands(blocksLookups, (results) => {
      const blocks = results[0].sort((a, b) => JSON.parse(a).time - JSON.parse(b).time);
      if (blocks.length > 100) {
        blocks.slice(0, blocks.length - 100).forEach((block) => {
          commands.push(['srem', `${_this.pool}:blocks:${blockType}:confirmed`, block]);
        });
      }
      callback(commands);
    }, handler);
  };

  // Handle Old Blocks rewards
  this.handleBlockRewards = function (daemon, blockType, callback, handler) {
    const commands = [];
    const blocksLookups = [
      ['smembers', `${_this.pool}:blocks:${blockType}:confirmed`]];
    _this.executeCommands(blocksLookups, (results) => {
      const blocks = results[0].sort((a, b) => JSON.parse(a).time - JSON.parse(b).time).slice(59, 75);
      // const blocks = results[0]
      blocks.forEach((element) => {
        const originalBlock = element;
        const block = JSON.parse(element);
        const newBlock = {
          time: block.time,
          height: block.height,
          hash: block.hash,
          identifier: block.identifier, 
          reward: block.reward,
          transaction: block.transaction, 
          difficulty: block.difficulty,
          luck: block.luck,
          worker: block.worker,
          solo: block.solo,
          round: block.round
        };
        const rpcParams = [
          block.hash,
          2
        ];

        // commands.push(['srem', `${_this.pool}:blocks:${blockType}:confirmed `, originalBlock]);

        daemon.cmd('getblock', rpcParams, true, (result) => {
          const testCommands = [];
          const transactions = result.response.tx.filter(id => id.txid == block.transaction);

          transactions[0].vout.forEach(transaction => {
            if (transaction.n == 1) {
              newBlock.nodeReward = transaction.valueSat;
            }

            if (transaction.n == 2) {
              newBlock.founderReward = transaction.valueSat;
            }
          });
          commands.push(['sadd', `${_this.pool}:blocks:${blockType}:confirmednew`, JSON.stringify(newBlock)]);
          callback(commands);
          console.log('asdasd');
        });
      });
    }, handler);

  };


  // Handle Hashrate Information in Redis
  this.handleHashrateInfo = function (blockType, callback) {
    const commands = [];
    const windowTime = (((Date.now() / 1000) - _this.hashrateWindow) | 0).toString();
    commands.push(['zremrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:hashrate`, 0, `(${windowTime}`]);
    commands.push(['zremrangebyscore', `${_this.pool}:rounds:${blockType}:current:solo:hashrate`, 0, `(${windowTime}`]);
    callback(commands);
  };

  // Get Historical Information from Redis
  this.handleHistoricalInfo = function (blockType, callback, handler) {
    const dateNow = Date.now();
    const windowTime = (dateNow / 1000 - _this.hashrateWindow | 0).toString();
    const windowHistorical = (dateNow / 1000 - _this.historicalWindow | 0).toString();
    const historicalLookups = [
      ['hgetall', `${_this.pool}:statistics:${blockType}:network`],
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:hashrate`, windowTime, '+inf'],
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:solo:hashrate`, windowTime, '+inf'],
      ['zremrangebyscore', `${_this.pool}:statistics:${blockType}:historical`, 0, `(${windowHistorical}`],
      ['zrevrangebyscore', `${_this.pool}:statistics:${blockType}:historical`, '+inf', '-inf', 'WITHSCORES', 'LIMIT', 0, 1]];
    _this.executeCommands(historicalLookups, (results) => {
      const commands = _this.calculateHistoricalInfo(results, blockType);
      callback(commands);
    }, handler);
  };

  // Get Mining Statistics from Daemon
  this.handleMiningInfo = function (daemon, blockType, callback, handler) {
    const commands = [];
    daemon.cmd('getmininginfo', [], true, (result) => {
      if (result.error) {
        logger.error('Statistics', _this.pool, `Error with statistics daemon: ${JSON.stringify(result.error)}`);
        handler(result.error);
      } else {
        const data = result.response;
        commands.push(['hset', `${_this.pool}:statistics:${blockType}:network`, 'difficulty', data.difficulty]);
        commands.push(['hset', `${_this.pool}:statistics:${blockType}:network`, 'hashrate', data.networkhashps]);
        commands.push(['hset', `${_this.pool}:statistics:${blockType}:network`, 'height', data.blocks]);
        callback(commands);
      }
    });
  };

  this.mailer = async function () {
    // Generate test SMTP service account from ethereal.email
    // Only needed if you don't have a real mail account for testing
    let testAccount = await nodemailer.createTestAccount();
  
    // create reusable transporter object using the default SMTP transport
    let transporter = nodemailer.createTransport({
      sendmail: true,
	    newline: 'unix',
	    path: '/usr/sbin/sendmail',
      secure: false,
      // host: "localhost",
      // port: 465,
      // secure: true, // true for 465, false for other ports
      // auth: {
      //   user: "info", // generated ethereal user
      //   pass: "lopata", // generated ethereal password
      // },
      // tls: {
      //   // do not fail on invalid certs
      //   rejectUnauthorized: false,
      // },
    });
  
    // send mail with defined transport object
    let info = await transporter.sendMail({
      from: '"Raptoreum zone" <info@raptoreum.zone>', // sender address
      to: "michal.pobuda@me.com", // list of receivers
      subject: "Hello", // Subject line
      text: "Hello world?", // plain text body
      html: "<b>Hello world?</b>", // html body
    });
  
    console.log("Message sent: %s", info.messageId);
    // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>
  
    // Preview only available when sending through an Ethereal account
    console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
    // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...
  };

  // Handle Offline Workers in Redis
  this.handleOfflineWorkers = function (blockType, callback, handler) {
    const workerLookups = [
      ['hgetall', `${_this.pool}:workers:${blockType}:shared`],
      ['hgetall', `${_this.pool}:miners:${blockType}`]
    ];
    _this.executeCommands(workerLookups, (results) => {
      const commands = [];
      const workers = results[0] || {};
      const miners = results[1] || {};
      const workersOffline = [];
      const workersOnline = [];
      const minersToNotify = [];
      const dateNow = Date.now() / 1000 | 0;

      for (const [key, value] of Object.entries(workers)) {
        const worker = JSON.parse(value);
        if (worker.offline === 'true') {
          workersOffline.push(key)
        } else if (!worker.offline) {
          workersOnline.push({
            worker: worker.worker,
            time: worker.time
          })
        }
      };

      for (const [key, value] of Object.entries(miners)) {
        const miner = JSON.parse(value);
        if (miner.alertsEnabled === 'true' && miner.alertLimit > 0) {
          minersToNotify.push({
            miner: key,
            limit: miner.alertLimit,
            email: miner.email
          });
        }
      };
      
      minersToNotify.forEach((miner) => {
        const minerWorkers = workersOnline.filter((worker) => worker.worker.split('.')[0] === miner.miner);
        
        minerWorkers.forEach((worker) => {
          if (worker.time < dateNow - miner.limit * 2) {
            const workerObject = {
              time: worker.time,
              worker: worker.worker,
              ip: JSON.parse(workers[worker.worker]).ip,
              offline: true
            };            
            commands.push(['hset', `${ _this.pool }:workers:${ blockType }:shared`, worker.worker, JSON.stringify(workerObject)]);
            console.log('Worker ' + worker.worker + ' is offline ... sending an email alert');
            // _this.mailer().catch(console.error);
          }
        });
      }); 
      callback(commands);
    }, handler);
  };

  // Handle Payments Information in Redis
  this.handlePaymentsInfo = function (blockType, callback, handler) {
    const commands = [];
    const paymentsLookups = [
      ['zrangebyscore', `${_this.pool}:payments:${blockType}:records`, '-inf', '+inf']];
    _this.executeCommands(paymentsLookups, (results) => {
      const records = results[0].sort((a, b) => JSON.parse(a).time - JSON.parse(b).time);
      if (records.length > 100) {
        records.slice(0, records.length - 100).forEach((record) => {
          commands.push(['zrem', `${_this.pool}:payments:${blockType}:records`, record]);
        });
      }
      callback(commands);
    }, handler);
  };

  // Handle Worker Minute-snapshots in Redis 
  this.handleWorkerInfo = function (blockType, callback, handler) {
    const dateNow = Date.now();
    const oneMinute = 1 * 60 * 1000;
    const minuteEnd = Math.floor(dateNow / oneMinute) * oneMinute;
    const minuteStart = minuteEnd - oneMinute;
    const workerLookups = [
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:hashrate`, `(${minuteStart / 1000}`, minuteEnd / 1000],
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:snapshots`, minuteEnd / 1000, minuteEnd / 1000]
    ];
    _this.executeCommands(workerLookups, (results) => {
      const commands = [];
      const snapshotWorkers = [];
      const snapshots = [];

      if (results[1]) {
        results[1].forEach((snapshot) => {
          snapshots.push(JSON.parse(snapshot));
        });
      };

      if (results[0]) {
        results[0].forEach((share) => {
          share = JSON.parse(share);
          const workerIndex = snapshotWorkers.findIndex(worker => worker.worker === share.worker);
          if (workerIndex === -1) {
            const objectTemplate = {
              worker: share.worker,
              valid: share.type === 'valid' ? 1 : 0,
              stale: share.type === 'stale' ? 1 : 0,
              invalid: share.type === 'invalid' ? 1 : 0,
              time: minuteEnd / 1000,
              work: share.type === 'valid' ? share.work : 0,
            };
            snapshotWorkers.push(objectTemplate);
          } else {
            if (share.type === 'valid') {
              snapshotWorkers[workerIndex].valid += 1;
              snapshotWorkers[workerIndex].work += share.work;
            }
            if (share.type === 'stale') {
              snapshotWorkers[workerIndex].stale += 1;
            }
            if (share.type === 'invalid') {
              snapshotWorkers[workerIndex].invalid += 1;
            }
          }
        });
      };

      snapshotWorkers.forEach((worker) => {
        if (!snapshots.find((snapshot) => snapshot.worker === worker.worker)) {
          // console.log(worker);
          commands.push(['zadd', `${_this.pool}:rounds:${blockType}:current:shared:snapshots`, minuteEnd / 1000, JSON.stringify(worker)]);
        }
      });
      callback(commands);
    }, handler);
  };

  // Handle Worker Ten-minute-snapshots in Redis 
  this.handleWorkerInfo2 = function (blockType, callback, handler) {
    const dateNow = Date.now();
    const tenMinutes = 10 * 60 * 1000;
    const tenMinutesEnd = Math.floor(dateNow / tenMinutes) * tenMinutes;
    const tenMinutesStart = tenMinutesEnd - tenMinutes;
    const oneDay = 24 * 60 * 60 * 1000;
    const oneDayAgo = tenMinutesEnd - oneDay;
    const workerLookups = [
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:snapshots`, `(${tenMinutesStart / 1000}`, tenMinutesEnd / 1000],
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:historicals`, tenMinutesEnd / 1000, tenMinutesEnd / 1000]];
    _this.executeCommands(workerLookups, (results) => {
      const commands = [];
      const historicals = [];
      const historicalWorkers = [];

      if (results[1]) {
        results[1].forEach((historical) => {
          historicals.push(JSON.parse(historical));
        });
      };

      if (results[0]) {
        results[0].forEach((snapshot) => {
          snapshot = JSON.parse(snapshot);
          const workerIndex = historicalWorkers.findIndex(worker => worker.worker === snapshot.worker);
          if (workerIndex === -1) {
            const objectTemplate = {
              worker: snapshot.worker,
              valid: snapshot.valid,
              stale: snapshot.stale,
              invalid: snapshot.invalid,
              time: tenMinutesEnd / 1000,
              work: snapshot.work,
            };
            historicalWorkers.push(objectTemplate);
          } else {
            historicalWorkers[workerIndex].valid += snapshot.valid,
              historicalWorkers[workerIndex].stale += snapshot.stale,
              historicalWorkers[workerIndex].invalid += snapshot.invalid,
              historicalWorkers[workerIndex].work += snapshot.work
          };
        });
      };

      historicalWorkers.forEach((worker) => {
        if (!historicals.find((historical) => historical.worker === worker.worker)) {
          // console.log(worker);
          commands.push(['zadd', `${_this.pool}:rounds:${blockType}:current:shared:historicals`, tenMinutesEnd / 1000, JSON.stringify(worker)]);
          commands.push(['zremrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:snapshots`, 0, tenMinutesStart / 1000]);
          commands.push(['zremrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:historicals`, 0, `(${oneDayAgo / 1000}`]);
        }
      });
      callback(commands);
    }, handler);
  };

  // Execute Redis Commands
  /* istanbul ignore next */
  this.executeCommands = function (commands, callback, handler) {
    _this.client.multi(commands).exec((error, results) => {
      if (error) {
        logger.error(logSystem, logComponent, logSubCat, `Error with redis statistics processing ${JSON.stringify(error)}`);
        handler(error);
      } else {
        callback(results);
      }
    });
  };

  // Start Interval Initialization
  /* istanbul ignore next */
  this.handleIntervals = function (daemon, blockType) {

    // Handle Coingecko Data
    // setInterval(() => {
    //   _this.handleCoingeckoData(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating Raptoreum data from Coingecko.`);
    //       }
    //     }, () => { });
    //   }, () => { });
    // }, 1 * 60 * 1000);

    // Handle User Info Interval
    // setInterval(() => {
    //   _this.handleUsersInfo(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating user statistics for ${blockType} configuration.`);
    //       }
    //     }, () => { });
    //   }, () => { });
    // }, _this.usersInterval * 1000);

    // Solve old blocks
    setInterval(() => {
      _this.handleBlockRewards(daemon, blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating network statistics for ${blockType} configuration.`);
          }
        }, () => { });
      }, () => { });
    }, 5 * 1000);

    // Handle Worker Mining History
    // setInterval(() => {
    //   _this.handleWorkerInfo(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating worker snapshots for ${blockType} configuration.`);
    //       }
    //     }, () => { });
    //   }, () => { });
    // }, 10 * 1000); // every 20 seconds

    // Handle Offline Worker Tagging 
    // setInterval(() => {
    //   _this.handleOfflineWorkers(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating offline worker tagginng for ${blockType} configuration.`);
    //       }
    //     }, () => { });
    //   }, () => { });
    // }, 10 * 1000); // every minute

    // setInterval(() => {
    //   _this.handleWorkerInfo2(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating historical worker snapshots for ${blockType} configuration.`);
    //       }
    //     }, () => { });
    //   }, () => { });
    // }, 1 * 60 * 1000); // every 3 minutes

    // KEEP DISABLED
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
    // setInterval(() => {
    //   _this.handleHashrateInfo(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating hashrate statistics for ${blockType} configuration.`);
    //       }
    //     }, () => { });
    //   });
    // }, _this.hashrateInterval * 1000);

    // Handle Historical Data Interval
    // setInterval(() => {
    //   _this.handleHistoricalInfo(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating historical statistics for ${blockType} configuration.`);
    //       }
    //     }, () => { });
    //   }, () => { });
    // }, _this.historicalInterval * 1000);

    // Handle Mining Info Interval
    // setInterval(() => {
    //   _this.handleMiningInfo(daemon, blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating network statistics for ${blockType} configuration.`);
    //       }
    //     }, () => { });
    //   }, () => { });
    // }, _this.refreshInterval * 1000);

    // KEEP DISABLED
    // Handle Payment Info Interval
    // setInterval(() => {
    //   _this.handlePaymentsInfo(blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating payments statistics for ${ blockType } configuration.`);
    //       }
    //     }, () => {});
    //   }, () => {});
    // }, _this.paymentsInterval * 1000);
  };

  // Start Interval Initialization
  /* istanbul ignore next */
  this.setupStatistics = function (poolStratum) {
    if (poolStratum.primary.daemon) {
      _this.handleIntervals(poolStratum.primary.daemon, 'primary');
      if (_this.poolConfig.auxiliary && _this.poolConfig.auxiliary.enabled && poolStratum.auxiliary.daemon) {
        _this.handleIntervals(poolStratum.auxiliary.daemon, 'auxiliary');
      }
    }
  };
};

module.exports = PoolStatistics;
