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

  // API Endpoint for /miner/chart2 for miner [address]
  // fill snapshots without data with zeroes
  // calculate moving average based on parameter
  this.minerChart2 = function(pool, address, blockType, isSolo, worker, callback) {
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const tenMinutes = 1000 * 60 * 10;
    const maxSteps = 24 * 6;
    const lastTimestamp = Math.floor(Date.now() / tenMinutes) * tenMinutes;
    if (blockType == '') {
      blockType = 'primary';
    }
    const solo = isSolo ? 'solo' : 'shared';

    const commands = [
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:historical`, 0, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:snapshots`, 0, '+inf']];
    _this.executeCommands(commands, (results) => {
      const historical = results[0] || {};
      const snapshots = results[1] || {};
      
      const workerArray = [];
      const movingAverageArray = [];

      for (const [key, value] of Object.entries(historical)) {
        const snapshot = JSON.parse(value);
        
        // We want Miner Stats
        if (snapshot.worker.split('.')[0] == address && worker === '') {
          const temp = workerArray.find((obj, index) => {
            if (obj.timestamp == snapshot.timestamp) {
              workerArray[index].work += snapshot.work;
              workerArray[index].validShares += snapshot.valid;
              workerArray[index].staleShares += snapshot.stale;
              workerArray[index].invalidShares += snapshot.invalid;
              return true;
            }
          });

          if (!temp) {
            const tempObject = {
              timestamp: snapshot.timestamp,
              work: snapshot.work,
              validShares: snapshot.valid,
              staleShares: snapshot.stale,
              invalidShares: snapshot.invalid
            };
            workerArray.push(tempObject);
          }
        // We want Worker Stats
        } else if (snapshot.worker == address + '.' + worker && worker != '') {
          const tempObject = {
            timestamp: snapshot.timestamp,
            work: snapshot.work,
            validShares: snapshot.valid,
            staleShares: snapshot.stale,
            invalidShares: snapshot.invalid
          };
          workerArray.push(tempObject);
        }
      };
      
      workerArray.forEach((element) => {
        element.hashrate = element.work * multiplier / (tenMinutes / 1000);
        delete element.work;
        movingAverageArray.push(element.hashrate);
        if (movingAverageArray.length > 5) {
          movingAverageArray.shift();
        }
        const movingAverageSum = movingAverageArray.reduce((partialSum, a) => partialSum + a, 0);
        element.averageHashrate = movingAverageSum / movingAverageArray.length;
      });
      callback(200, workerArray);
    }, callback);
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
      const miner = JSON.parse(results[0]) || {};

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
    const minPayment = _this.poolConfigs[pool].primary.payments.minPayment;
    const payoutLimit = body.payoutLimit;

    if (minPayment > payoutLimit) {
      callback(400, {
        result: 'error'
      });
    }

    const solo = isSolo ? 'solo' : 'shared';
    if (blockType == '') {
      blockType = 'primary';
    }
    const address = body.address;
    const ipHash = md5(body.ipAddress);
    const dateNow = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    let validated = false;
    
    const commands = [
      ['hgetall', `${ pool }:workers:${ blockType }:${ solo }`],
      ['hget', `${ pool }:miners:${ blockType }`, address],
    ];
    
    _this.executeCommands(commands, (results) => {
      let minerObject = JSON.parse(results[1]);

      for (const [key, value] of Object.entries(results[0])) {
        const worker = JSON.parse(value);
        const miner = worker.worker.split('.')[0] || '';
        
        if (miner === address && (worker.time * 1000) >= (dateNow - twentyFourHours)) {
          if (ipHash == worker.ip_hash) {
            validated = true;
            minerObject.payoutLimit
          } 
        }
      }

      if (validated == true) {
        minerObject.payoutLimit = payoutLimit;
        const commands2 = [
          ['hset', `${ pool }:miners:${ blockType }`, address, JSON.stringify(minerObject)],
        ];
        
        _this.executeCommands(commands2, (results) => {
          if (results[0] == 0) {
            callback(200, {
              result: 'ok'
            });
          } else {
            callback(400, {
              result: 'error'
            });
          }
        }, callback);
      } else {
        callback(200, {
          result: 'no change'
        });
      }
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

  // API Endpoint for /miner/stats2 for miner [address]
  this.minerStats2 = function(pool, address, blockType, isSolo, callback) {
    const solo = isSolo ? 'solo' : 'shared';
    if (blockType == '') {
      blockType = 'primary';
    }
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const hashrateWindowTime = (((Date.now() / 1000) - hashrateWindow) | 0).toString();
    const hashrate12Window = 60 * 60 * 12;
    const hashrate12WindowTime = (((Date.now() / 1000) - hashrate12Window) | 0);
    const hashrate24Window = 60 * 60 * 24;
    // const hashrate24WindowTime = (((Date.now() / 1000) - hashrate24Window) | 0);
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    
    const commands = [
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:historical`, 0, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:snapshots`, 0, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:hashrate`, hashrateWindowTime, '+inf']];
    _this.executeCommands(commands, (results) => {
      let hashrateData = 0;
      let hashrate12Data = 0; // change to round hashrate
      let hashrate24Data = 0;
      let valid = 0;
      let invalid = 0;
      let stale = 0;

      const historical = results[0] || {};
      for (const [key, value] of Object.entries(historical)) {
        const snapshot = JSON.parse(value);
        if (snapshot.worker.split('.')[0] == address) {
          valid += snapshot.valid;
          stale += snapshot.stale;
          invalid += snapshot.invalid;
          hashrate24Data += /^-?\d*(\.\d+)?$/.test(snapshot.work) ? parseFloat(snapshot.work) : 0;
          if (snapshot.timestamp > hashrate12WindowTime) {
            hashrate12Data += /^-?\d*(\.\d+)?$/.test(snapshot.work) ? parseFloat(snapshot.work) : 0;
          }
        }
      };

      const snapshots = results[1] || {};
      let maxSnapshotTime = 0;
      for (const [key, value] of Object.entries(snapshots)) {
        const snapshot = JSON.parse(value);
        if (snapshot.time > maxSnapshotTime) {
          maxSnapshotTime = snapshot.time;
        }
        if (snapshot.worker.split('.')[0] == address) {
          valid += snapshot.valid;
          stale += snapshot.stale;
          invalid += snapshot.invalid;
          hashrate24Data += /^-?\d*(\.\d+)?$/.test(snapshot.work) ? parseFloat(snapshot.work) : 0;
          hashrate12Data += /^-?\d*(\.\d+)?$/.test(snapshot.work) ? parseFloat(snapshot.work) : 0;
        }
      };

      const shares = results[2] || {};
      for (const [key, value] of Object.entries(shares)) {
        const share = JSON.parse(value);
        if (share.worker.split('.')[0] == address) {
          hashrateData += share.work;
        }
      };

      callback(200, {
        validShares: valid,
        invalidShares: invalid,
        staleShares: stale,
        currentHashrate: (multiplier * hashrateData) / hashrateWindow,
        averageHalfDayHashrate: (multiplier * hashrate12Data) / hashrate12Window,
        averageDayHashrate: (multiplier * hashrate24Data) / hashrate24Window,
      });
    }, callback);
  };

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
    const historyDays = 100 * 24 * 60 * 60 * 1000; // 100 days
    const commands = [
      ['smembers', `${ pool }:blocks:${blockType}:confirmed`],
      ['smembers', `${ pool }:blocks:${blockType}:pending`]];
    _this.executeCommands(commands, (results) => {
      let output;
      let luckSum = 0;
      
      const confirmedBlocks = results[0].map(block => JSON.parse(block)) || [];
      const pendingBlocks = results[1].map(block => JSON.parse(block)) || [];
      const blocks = confirmedBlocks.concat(pendingBlocks);

      blocks.filter((block) => block.time > dateNow - historyDays).forEach((block) => luckSum += block.luck);
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

  // API Endpoint for /pool/topMiners
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
      ['hgetall', `${ pool }:miners:${ blockType }`],
    ];
    _this.executeCommands(commands, (results) => {
      const workers = [];
      for (const [key, value] of Object.entries(results[0])) {
        const worker = JSON.parse(value);
        if (worker.time > onlineWindowTime) {
          workers.push(worker.worker);
        }
      };

      const shares = [];
      results[1].forEach((entry) => {
        const share = JSON.parse(entry);
        const work = /^-?\d*(\.\d+)?$/.test(share.work) ? parseFloat(share.work) : 0;
        const miner = share.worker.split('.')[0];
        minerIndex = shares.findIndex((obj => obj.miner == miner));
        if (minerIndex == -1) {
          minerObject = {
            miner: miner,
            work: work
          };
          shares.push(minerObject);
        } else {
          shares[minerIndex].work += work;
        }
      });

      const miners = [];
      for (const [key, value] of Object.entries(results[2])) {
        const index = topMiners.indexOf((element) => element.miner = key);
        const miner = JSON.parse(value);
        topMiners[index].firstJoined = miner.firstJoined;
      };

      const topMiners = shares.sort((a,b) => b.work - a.work).slice(0, 10);

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

    let type, endpoint, method, blockType, isSolo, address, worker, page;
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
      worker = utils.validateInput(req.query.worker || '');
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
          case (endpoint === 'chart2' && address.length > 0):
            _this.minerChart2(pool, address, blockType, isSolo, worker, (code, message) => callback(code, message));
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
          case (endpoint === 'stats2' && address.length > 0):
            _this.minerStats2(pool, address, blockType, isSolo, (code, message) => callback(code, message));
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
