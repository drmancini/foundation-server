/*
 *
 * Statistics (Updated)
 *
 */

const https = require('https');
const utils = require('./utils');
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
      ['hgetall', `${_this.pool}:workers:${blockType}:solo`],
      ['hgetall', `${_this.pool}:miners:${blockType}`]
    ];
    _this.executeCommands(usersLookups, (results) => {
      const sharedWorkers = results[0] || {};
      const soloWorkers = results[1] || {};
      const miners = results[2] || {};

      for (const [key, value] of Object.entries(sharedWorkers)) {
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

      for (const [key, value] of Object.entries(soloWorkers)) {
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
  // this.handleBlockRewards = function (daemon, blockType, callback, handler) {
  //   const commands = [];
  //   const blocksLookups = [
  //     ['smembers', `${_this.pool}:blocks:${blockType}:confirmed`]];
  //   _this.executeCommands(blocksLookups, (results) => {
  //     const blocks = results[0].sort((a, b) => JSON.parse(a).time - JSON.parse(b).time).slice(119, 135);
  //     // const blocks = results[0]
  //     blocks.forEach((element) => {
  //       const originalBlock = element;
  //       const block = JSON.parse(element);
  //       const newBlock = {
  //         time: block.time,
  //         height: block.height,
  //         hash: block.hash,
  //         identifier: block.identifier, 
  //         reward: block.reward,
  //         transaction: block.transaction, 
  //         difficulty: block.difficulty,
  //         luck: block.luck,
  //         worker: block.worker,
  //         solo: block.solo,
  //         round: block.round
  //       };
  //       const rpcParams = [
  //         block.hash,
  //         2
  //       ];

  //       // commands.push(['srem', `${_this.pool}:blocks:${blockType}:confirmed `, originalBlock]);

  //       daemon.cmd('getblock', rpcParams, true, (result) => {
  //         const testCommands = [];
  //         const transactions = result.response.tx.filter(id => id.txid == block.transaction);

  //         transactions[0].vout.forEach(transaction => {
  //           if (transaction.n == 1) {
  //             newBlock.nodeReward = transaction.valueSat;
  //           }

  //           if (transaction.n == 2) {
  //             newBlock.founderReward = transaction.valueSat;
  //           }
  //         });
  //         commands.push(['sadd', `${_this.pool}:blocks:${blockType}:confirmednew`, JSON.stringify(newBlock)]);
  //         callback(commands);
  //         console.log('asdasd');
  //       });
  //     });
  //   }, handler);

  // };


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

  // Tag Offline Workers in Redis
  this.handleOfflineTags = function(blockType, callback, handler) {
    const workerLookups = [
      ['hgetall', `${_this.pool}:miners:${blockType}`],
      ['hgetall', `${_this.pool}:workers:${blockType}:shared`]
    ];
    _this.executeCommands(workerLookups, (results) => {
      const commands = [];
      const dateNow = Date.now() / 1000 | 0;
      const tenMinutes = 60 * 10; // change to 10 * 60
      const offlineCutoff = dateNow - tenMinutes;
      const minerNotifications = [];
      const miners = results[0] || {};
      const workers = results[1] || {};

      // Find all subscribed miners with notifications set 
      for (const [key, value] of Object.entries(miners)) {
        const miner = JSON.parse(value);
        if (miner.subscribed == true && miner.activityAlerts == true) {
          minerNotifications.push({
            miner: key,
            token: miner.token,
            alertLimit: miner.alertLimit,
            email: miner.email
          });
        };
      }

      for (const [key, value] of Object.entries(workers)) {
        const workerObject = JSON.parse(value);
        const worker = key;
        const miner = worker.split('.')[0];
        const toNotify = minerNotifications.find(element => element.miner == miner);
        
        if (toNotify && workerObject.offline == false && workerObject.time < offlineCutoff) {
          const minerIndex = minerNotifications.map(object => object.miner).indexOf(miner);
          
          // if (workerObject.time < dateNow - minerNotifications[minerIndex].alertLimit) {
          if (workerObject.time < dateNow - minerNotifications[minerIndex].alertLimit * 60) {

            const workerName = worker.split('.')[1];
            if (minerNotifications[minerIndex].workers === undefined) {
              minerNotifications[minerIndex].workers = [ workerName ];
            } else {
              minerNotifications[minerIndex].workers.push(workerName);
            }

            workerObject.offline = true;
            commands.push(['hset', `${ _this.pool }:workers:${ blockType }:shared`, worker, JSON.stringify(workerObject)]);
          }
        } 
      };

      const mailReplacementsX = {
        inactiveMiners: 'inactiveWorkers',
        isOrAre: 'is',
        minerAddress: 'notification.miner',
        dashboardLink: `https://raptoreum.zone/miners/${ notification.miner }`,
        minerList: 'minerList',
        unsubscribeLink: 'mailUnsubscribe'
      };
      utils.mailer('michal.pobuda@me.com', 'subject', 'https://api.raptoreum.zone/v2/miner/unsubscribeEmail', 'inactivity', mailReplacementsX).catch(console.error);

      if (minerNotifications.length > 0) {
        minerNotifications.forEach((notification) => {
          if (notification.workers != undefined) {
            const minerList = notification.workers.join(', ');
            const inactiveWorkers = notification.workers.length;
            const mailEmail = notification.email; // notification.email
            const workerText = inactiveWorkers > 1 ? ' workers went offline' : ' worker went offline';
            const mailSubject = inactiveWorkers + workerText;
            const mailTemplate = 'inactivity';
            const mailUnsubscribe = `https://api.raptoreum.zone/v2/miner/unsubscribeEmail?address=${ notification.miner }&token=${ notification.token }`;
            const mailReplacements = {
              inactiveMiners: inactiveWorkers,
              isOrAre: inactiveWorkers > 1 ? 'are' : 'is',
              minerAddress: notification.miner,
              dashboardLink: `https://raptoreum.zone/miners/${ notification.miner }`,
              minerList: minerList,
              unsubscribeLink: mailUnsubscribe
            };
            utils.mailer(mailEmail, mailSubject, mailUnsubscribe, mailTemplate, mailReplacements).catch(console.error);
          }
        });
      };
    callback(commands);
    }, handler);
  };

  // Notify Offline Workers

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
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:snapshots`, minuteEnd / 1000, minuteEnd / 1000],
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:solo:hashrate`, `(${minuteStart / 1000}`, minuteEnd / 1000],
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:solo:snapshots`, minuteEnd / 1000, minuteEnd / 1000]
    ];
    _this.executeCommands(workerLookups, (results) => {
      const commands = [];
      const sharedSnapshotWorkers = [];
      const sharedSnapshots = [];
      const soloSnapshotWorkers = [];
      const soloSnapshots = [];

      if (results[1]) {
        results[1].forEach((snapshot) => {
          sharedSnapshots.push(JSON.parse(snapshot));
        });
      };

      if (results[3]) {
        results[3].forEach((snapshot) => {
          soloSnapshots.push(JSON.parse(snapshot));
        });
      };

      if (results[0]) {
        results[0].forEach((share) => {
          share = JSON.parse(share);
          const workerIndex = sharedSnapshotWorkers.findIndex(worker => worker.worker === share.worker);
          if (workerIndex === -1) {
            const objectTemplate = {
              worker: share.worker,
              valid: share.type === 'valid' ? 1 : 0,
              stale: share.type === 'stale' ? 1 : 0,
              invalid: share.type === 'invalid' ? 1 : 0,
              time: minuteEnd / 1000,
              work: share.type === 'valid' ? share.work : 0,
            };
            sharedSnapshotWorkers.push(objectTemplate);
          } else {
            if (share.type === 'valid') {
              sharedSnapshotWorkers[workerIndex].valid += 1;
              sharedSnapshotWorkers[workerIndex].work += share.work;
            }
            if (share.type === 'stale') {
              sharedSnapshotWorkers[workerIndex].stale += 1;
            }
            if (share.type === 'invalid') {
              sharedSnapshotWorkers[workerIndex].invalid += 1;
            }
          }
        });
      };

      if (results[2]) {
        results[2].forEach((share) => {
          share = JSON.parse(share);
          const workerIndex = soloSnapshotWorkers.findIndex(worker => worker.worker === share.worker);
          if (workerIndex === -1) {
            const objectTemplate = {
              worker: share.worker,
              valid: share.type === 'valid' ? 1 : 0,
              stale: share.type === 'stale' ? 1 : 0,
              invalid: share.type === 'invalid' ? 1 : 0,
              time: minuteEnd / 1000,
              work: share.type === 'valid' ? share.work : 0,
            };
            soloSnapshotWorkers.push(objectTemplate);
          } else {
            if (share.type === 'valid') {
              soloSnapshotWorkers[workerIndex].valid += 1;
              soloSnapshotWorkers[workerIndex].work += share.work;
            }
            if (share.type === 'stale') {
              soloSnapshotWorkers[workerIndex].stale += 1;
            }
            if (share.type === 'invalid') {
              soloSnapshotWorkers[workerIndex].invalid += 1;
            }
          }
        });
      };

      sharedSnapshotWorkers.forEach((worker) => {
        if (!sharedSnapshots.find((snapshot) => snapshot.worker === worker.worker)) {
          commands.push(['zadd', `${_this.pool}:rounds:${blockType}:current:shared:snapshots`, minuteEnd / 1000, JSON.stringify(worker)]);
        }
      });

      soloSnapshotWorkers.forEach((worker) => {
        if (!soloSnapshots.find((snapshot) => snapshot.worker === worker.worker)) {
          commands.push(['zadd', `${_this.pool}:rounds:${blockType}:current:solo:snapshots`, minuteEnd / 1000, JSON.stringify(worker)]);
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
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:historicals`, tenMinutesEnd / 1000, tenMinutesEnd / 1000],
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:solo:snapshots`, `(${tenMinutesStart / 1000}`, tenMinutesEnd / 1000],
      ['zrangebyscore', `${_this.pool}:rounds:${blockType}:current:solo:historicals`, tenMinutesEnd / 1000, tenMinutesEnd / 1000]];
    _this.executeCommands(workerLookups, (results) => {
      const commands = [];
      const sharedHistoricals = [];
      const soloHistoricals = [];
      const sharedHistoricalWorkers = [];
      const soloHistoricalWorkers = [];

      if (results[1]) {
        results[1].forEach((historical) => {
          sharedHistoricals.push(JSON.parse(historical));
        });
      };

      if (results[3]) {
        results[3].forEach((historical) => {
          soloHistoricals.push(JSON.parse(historical));
        });
      };

      if (results[0]) {
        results[0].forEach((snapshot) => {
          snapshot = JSON.parse(snapshot);
          const workerIndex = sharedHistoricalWorkers.findIndex(worker => worker.worker === snapshot.worker);
          if (workerIndex === -1) {
            const objectTemplate = {
              worker: snapshot.worker,
              valid: snapshot.valid,
              stale: snapshot.stale,
              invalid: snapshot.invalid,
              time: tenMinutesEnd / 1000,
              work: snapshot.work,
            };
            sharedHistoricalWorkers.push(objectTemplate);
          } else {
            sharedHistoricalWorkers[workerIndex].valid += snapshot.valid,
            sharedHistoricalWorkers[workerIndex].stale += snapshot.stale,
            sharedHistoricalWorkers[workerIndex].invalid += snapshot.invalid,
            sharedHistoricalWorkers[workerIndex].work += snapshot.work
          };
        });
      };

      if (results[2]) {
        results[2].forEach((snapshot) => {
          snapshot = JSON.parse(snapshot);
          const workerIndex = soloHistoricalWorkers.findIndex(worker => worker.worker === snapshot.worker);
          if (workerIndex === -1) {
            const objectTemplate = {
              worker: snapshot.worker,
              valid: snapshot.valid,
              stale: snapshot.stale,
              invalid: snapshot.invalid,
              time: tenMinutesEnd / 1000,
              work: snapshot.work,
            };
            soloHistoricalWorkers.push(objectTemplate);
          } else {
            soloHistoricalWorkers[workerIndex].valid += snapshot.valid,
            soloHistoricalWorkers[workerIndex].stale += snapshot.stale,
            soloHistoricalWorkers[workerIndex].invalid += snapshot.invalid,
            soloHistoricalWorkers[workerIndex].work += snapshot.work
          };
        });
      };

      sharedHistoricalWorkers.forEach((worker) => {
        if (!sharedHistoricals.find((historical) => historical.worker === worker.worker)) {
          // console.log(worker);
          commands.push(['zadd', `${_this.pool}:rounds:${blockType}:current:shared:historicals`, tenMinutesEnd / 1000, JSON.stringify(worker)]);
          commands.push(['zremrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:snapshots`, 0, tenMinutesStart / 1000]);
          commands.push(['zremrangebyscore', `${_this.pool}:rounds:${blockType}:current:shared:historicals`, 0, `(${oneDayAgo / 1000}`]);
        }
      });

      soloHistoricalWorkers.forEach((worker) => {
        if (!soloHistoricals.find((historical) => historical.worker === worker.worker)) {
          // console.log(worker);
          commands.push(['zadd', `${_this.pool}:rounds:${blockType}:current:solo:historicals`, tenMinutesEnd / 1000, JSON.stringify(worker)]);
          commands.push(['zremrangebyscore', `${_this.pool}:rounds:${blockType}:current:solo:snapshots`, 0, tenMinutesStart / 1000]);
          commands.push(['zremrangebyscore', `${_this.pool}:rounds:${blockType}:current:solo:historicals`, 0, `(${oneDayAgo / 1000}`]);
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
    setInterval(() => {
      _this.handleCoingeckoData(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating Raptoreum data from Coingecko.`);
          }
        }, () => { });
      }, () => { });
    }, 1 * 60 * 1000);

    // Handle User Info Interval
    setInterval(() => {
      _this.handleUsersInfo(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating user statistics for ${blockType} configuration.`);
          }
        }, () => { });
      }, () => { });
    }, _this.usersInterval * 1000);

    // Solve old blocks
    // setInterval(() => {
    //   _this.handleBlockRewards(daemon, blockType, (results) => {
    //     _this.executeCommands(results, () => {
    //       if (_this.poolConfig.debug) {
    //         logger.debug('Statistics', _this.pool, `Finished updating network statistics for ${blockType} configuration.`);
    //       }
    //     }, () => { });
    //   }, () => { });
    // }, 5 * 1000);

    // Handle Worker Mining History
    setInterval(() => {
      _this.handleWorkerInfo(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating worker snapshots for ${blockType} configuration.`);
          }
        }, () => { });
      }, () => { });
    }, 20 * 1000); // every 20 seconds

    // Handle Offline Worker Tagging 
    setInterval(() => {
      _this.handleOfflineTags(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating offline worker tagginng for ${blockType} configuration.`);
          }
        }, () => { });
      }, () => { });
    }, 60 * 1000); // every minute

    setInterval(() => {
      _this.handleWorkerInfo2(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating historical worker snapshots for ${blockType} configuration.`);
          }
        }, () => { });
      }, () => { });
    }, 3 * 60 * 1000); // every 3 minutes

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
    setInterval(() => {
      _this.handleHashrateInfo(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating hashrate statistics for ${blockType} configuration.`);
          }
        }, () => { });
      });
    }, _this.hashrateInterval * 1000);

    // Handle Historical Data Interval
    setInterval(() => {
      _this.handleHistoricalInfo(blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating historical statistics for ${blockType} configuration.`);
          }
        }, () => { });
      }, () => { });
    }, _this.historicalInterval * 1000);

    // Handle Mining Info Interval
    setInterval(() => {
      _this.handleMiningInfo(daemon, blockType, (results) => {
        _this.executeCommands(results, () => {
          if (_this.poolConfig.debug) {
            logger.debug('Statistics', _this.pool, `Finished updating network statistics for ${blockType} configuration.`);
          }
        }, () => { });
      }, () => { });
    }, _this.refreshInterval * 1000);

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
