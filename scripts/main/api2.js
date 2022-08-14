/*
 *
 * API (Updated)
 *
 */

const utils = require('./utils');
const Algorithms = require('foundation-stratum').algorithms;
const { Sequelize } = require('sequelize');
const PaymentsModel = require('../../models/payments.model');

////////////////////////////////////////////////////////////////////////////////

// Main API Function
const PoolApi = function (client, sequelize, poolConfigs, portalConfig) {
  const _this = this;

  const sequelizePayments = PaymentsModel(sequelize, Sequelize);
  
  /* istanbul ignore next */
  if (typeof(sequelizePayments) === 'function') {
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

  // checked
  // API Endpoint for /miner/alertSettings for miner [address]
  this.minerAlertSettings = function(pool, body, callback) {
    const dateNow = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const address = body.address;
    const emailPattern = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    const email = emailPattern.test(body.email) ? body.email : null;
    const ipPattern = /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/;
    const ipAddress = ipPattern.test(body.ipAddress) ? body.ipAddress : null;
    const activityAlerts = body.activityAlerts || false;
    const paymentAlerts = body.paymentAlerts || false;
    const alertLimit = body.alertLimit || 10;
    console.log(body);
    const commands = [
      ['hget', `${ pool }:miners:primary`, address],
      ['hgetall', `${ pool }:workers:primary:shared`],
    ];

    _this.executeCommands(commands, (results) => {
      commands.length = 0;
      let minerObject;
      
      if (results[0]) {
        minerObject = JSON.parse(results[0]);
      } else {
        callback(400, {
          error: 'Miner address not found',
          result: null
        });
      };
      
      if (!ipAddress) {
        callback(200, {
          error: 'IP address is invalid',
          result: null
        });
      }

      if (!email && !emailPattern.test(minerObject.email)) {
        callback(200, {
          error: 'Email address not set',
          result: null
        });
      }

      let ipValid = false;

      for (const [key, value] of Object.entries(results[1])) {
        const worker = JSON.parse(value);
        const miner = worker.worker.split('.')[0] || '';
        
        if (miner === address) {
          if ((worker.time * 1000) >= (dateNow - oneDay) && ipAddress === worker.ip) {
            ipValid = true;
          }
        }
      }

      if (ipValid) {
        minerObject.activityAlerts = activityAlerts;
        minerObject.paymentAlerts = paymentAlerts;
        minerObject.alertLimit = alertLimit;
        if (email && email != minerObject.email) {
          const mailEmail = email;
          const mailSubject = 'Confirm Raptoreum zone notification settings';
          const mailTemplate = 'subscribe';
          const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
          const mailUnsubscribe = `https://api.raptoreum.zone/v2/miner/unsubscribeEmail?address=${ address }&token=${ token }`;
          const mailReplacements = {
            minerAddress: address,
            subscribeLink: `https://api.raptoreum.zone/v2/miner/subscribeEmail?address=${ address }&token=${ token }`,
            unsubscribeLink: mailUnsubscribe
          };
          minerObject.subscribed = false;
          minerObject.email = email;
          minerObject.token = token;
          utils.mailer(mailEmail, mailSubject, mailUnsubscribe, mailTemplate, mailReplacements).catch(console.error);
        }

        const commands = [
          ['hset', `${ pool }:miners:primary`, address, JSON.stringify(minerObject)],
        ];

        _this.executeCommands(commands, (results) => {
          if (results[0] == 0) {
            callback(200, {
              error: null,
              result: 'Notification settings changed'
            });
          } else {
            callback(200, {
              error: 'Notification settings unchanged',
              result: null
            });
          }
        }, callback);

      } else {
        callback(200, {
          error: 'IP address does not belong to active miner',
          result: null
        });
      }
    }, callback);
  };

  // API Endpoint for /miner/blocks for miner [address]
  this.minerBlocks = function(pool, address, blockType, callback, ) {

    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';

    }
    const commands = [
      ['smembers', `${ pool }:blocks:${ blockType }:confirmed`],
      ['smembers', `${ pool }:blocks:${ blockType }:kicked`],
      ['smembers', `${ pool }:blocks:${ blockType }:pending`],
      ['hgetall', `${ pool }:statistics:${ blockType }:network`]];
    _this.executeCommands(commands, (results) => {
      const result = {};
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
        error: null,
        result: result
      });
    }, callback);
  };

  // API Endpoint for /miner/chart for miner [address]
  // calculate moving average based on parameter
  this.minerChart = function(pool, address, blockType, isSolo, worker, callback) {
    const tenMinutes = 1000 * 60 * 10;
    const lastTimeSlot = Date.now() - Date.now() % tenMinutes;
    const timeSlots = 145;
    const timeSpan = (timeSlots - 1) * tenMinutes; // total interval in ms
    const firstTimeSlot = lastTimeSlot - timeSpan;
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;

    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }
    const solo = isSolo ? 'solo' : 'shared';

    const commands = [
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:historicals`, 0, '+inf']];
    _this.executeCommands(commands, (results) => {
      let output = [];
      const movingAverageArray = [];

      if (results[0]) {
        results[0].forEach((entry) => {
          const historical = JSON.parse(entry);
          
          if (worker == null || worker == '') {
            if (historical.worker.split('.')[0] === address) {
              const timeIndex = output.findIndex(entry => entry.timestamp === historical.time);
              if(timeIndex == -1) {
                const tempObject = {
                  timestamp: historical.time,
                  work: historical.work,
                  validShares: historical.valid,
                  staleShares: historical.stale,
                  invalidShares: historical.invalid
                }
                output.push(tempObject);
              } else {
                output[timeIndex].work += historical.work;
                output[timeIndex].validShares += historical.valid,
                output[timeIndex].staleShares += historical.stale,
                output[timeIndex].invalidShares += historical.invalid
              }
            }
          } else {
            if (historical.worker.split('.')[0] === address && historical.worker.split('.')[1] === worker) {
              const timeIndex = output.findIndex(entry => entry.timestamp === historical.time);
              if(timeIndex == -1) {
                const tempObject = {
                  timestamp: historical.time,
                  work: historical.work,
                  validShares: historical.valid,
                  staleShares: historical.stale,
                  invalidShares: historical.invalid
                }
                output.push(tempObject);
              } else {
                output[timeIndex].work += historical.work;
                output[timeIndex].validShares += historical.valid,
                output[timeIndex].staleShares += historical.stale,
                output[timeIndex].invalidShares += historical.invalid
              }
            }
          }
        });      
      }

      for (let slot = firstTimeSlot; slot < lastTimeSlot; slot += tenMinutes) {
        // counter ++;
        // console.log(counter);
        const index = output.findIndex(entry => entry.timestamp === slot / 1000);
        if (index == -1) {
          const tempObject = {
            timestamp: slot / 1000,
            work: 0,
            validShares: 0,
            staleShares: 0,
            invalidShares: 0,
          }
          output.push(tempObject);
        }
      }

      output = output.sort((a,b) => (a.timestamp - b.timestamp));
      
      output.forEach((element) => {
        element.hashrate = element.work * multiplier / (tenMinutes / 1000);
        delete element.work;
        movingAverageArray.push(element.hashrate);
        if (movingAverageArray.length > 12) {
          movingAverageArray.shift();
        }
        const movingAverageSum = movingAverageArray.reduce((partialSum, a) => partialSum + a, 0);
        element.averageHashrate = movingAverageSum / movingAverageArray.length;
      });

      callback(200, output);
    }, callback);
  };

  //  API Endpoint dor /miner/details for miner [address]
  this.minerDetails = function(pool, address, blockType, callback) {
    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }
    const commands = [['hget', `${ pool }:miners:${ blockType }`, address]];
    _this.executeCommands(commands, (results) => {
      const miner = JSON.parse(results[0]) || {};
      const hiddenEmail = miner.email != undefined ? miner.email.replace(/(\w{3})[\w.-]+@([\w.]+\w)/, "$1***@$2") : '';
      
      const output = {
        firstJoined: miner.firstJoined,
        payoutLimit: miner.payoutLimit || 0,
        activityAlerts: miner.activityAlerts || false,
        paymentAlerts: miner.paymentAlerts || false,
        alertLimit: miner.alertLimit || null,
        email: hiddenEmail
      }
      
      callback(200, {
        error: null,
        result: output
      });
    }, callback);
  }

  //  API Endpoint dor /miner/payments for miner [address]
  this.minerPayments = function(pool, address, countervalue, page, callback) {
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
            let totalItems = 0
            
            data.forEach((payment) => {
              const outputPayment = {};
              outputPayment.hash = payment.transaction,
              outputPayment.timestamp = payment.time,
              outputPayment.value = payment.paid,
              totalItems ++;
              output.push(outputPayment);
            });

            const totalPages = Math.floor(totalItems / 10) + (totalItems % 10 > 0 ? 1 : 0);

            callback(200, {
              //countervalue: 'konverze do USD',
              data: output,
              totalItems: totalItems,
              totalPages: totalPages,
            });
          });
      });
  };

  // reviewed
  // API Endpoint for /miner/payoutSettings for miner [address]
  this.minerPayoutSettings = function(pool, body, callback) {
    const dateNow = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const minPayment = _this.poolConfigs[pool].primary.payments.minPayment;
    const payoutLimit = body.payoutLimit;
    const address = body.address;
    const ipAddress = body.ipAddress;
    console.log(body);
    if (minPayment > payoutLimit) {
      callback(400, {
        error: 'Payout limit below minimum pool payment',
        result: null
      });
    }

    let ipValid = false;
    
    const commands = [
      ['hget', `${ pool }:miners:primary`, address],
      ['hgetall', `${ pool }:workers:primary:shared`],
    ];
    
    _this.executeCommands(commands, (results) => {
      let minerObject;
      if (results[0]) {
        minerObject = JSON.parse(results[0]);
      } else {
        callback(200, {
          error: 'Miner address not found',
          result: null
        });
      }
      
      commands.length = 0;

      for (const [key, value] of Object.entries(results[1])) {
        const worker = JSON.parse(value);
        const miner = worker.worker.split('.')[0] || '';
        
        if (miner === address) {
          if ((worker.time * 1000) >= (dateNow - twentyFourHours) && ipAddress === worker.ip) {
            console.log('IP valid');
            ipValid = true;
          }
        }
      }

      if (ipValid) {
        minerObject.payoutLimit = payoutLimit;
        const commands = [
          ['hset', `${ pool }:miners:primary`, address, JSON.stringify(minerObject)],
        ];
        _this.executeCommands(commands, (results) => {
          if (results[0] == 0) {
            callback(200, {
              error: null,
              result: 'Payout limit setting changed'
            });
          } else {
            callback(200, {
              error: 'Payout limit setting unchanged',
              result: null
            });
          }
        }, callback);
      } else {
        console.log('IP not valid');
        callback(200, {
          error: 'IP address does not belong to active miner',
          result: null
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

  // API Endpoint for /miner/paymentStats for miner [address]
  this.minerPaymentStats2 = function(pool, address, countervalue, blockType, callback) {
    if (countervalue == '') {
      countervalue = 'usd';
    };
    if (blockType == '') {
      blockType = 'primary';
    };
    const output = {};

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

        output.lastPayment = lastPayment;
        output.stats = {
          averageValue: totalPaid / transactionCount,
          totalPaid: totalPaid,
          transactionCount: transactionCount,
        };
      })
      .finally(() => {
        const commands = [
          ['hgetall', `${ pool }:coin:${ blockType }`]];
        _this.executeCommands(commands, (results) => {
          output.countervalue = results[0][countervalue];
          callback(200, output);
        }, callback);
      });
  };

  // API Endpoint for /miner/stats for miner [address]
  this.minerStats = function(pool, address, blockType, isSolo, worker, callback) {
    const solo = isSolo ? 'solo' : 'shared';
    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }
    const dateNow = Date.now();
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const hashrateWindowTime = (dateNow / 1000 - hashrateWindow | 0).toString();
    const hashrate12Window = 60 * 60 * 12;
    const hashrate12WindowTime = dateNow / 1000 - hashrate12Window | 0;
    const hashrate24Window = 60 * 60 * 24;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    
    const commands = [
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:historicals`, 0, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:hashrate`, hashrateWindowTime, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:snapshots`, 0, '+inf']];
    _this.executeCommands(commands, (results) => {
      let hashrateData = 0;
      let hashrate12Data = 0;
      let hashrate24Data = 0;
      let valid = 0;
      let invalid = 0;
      let stale = 0;
      let maxHistoricalTime = 0;

      if (results[0]) {
        results[0].forEach((entry) => {
          const historical = JSON.parse(entry);
          if (historical.time > maxHistoricalTime) {
            maxHistoricalTime = historical.time;
          }

          if (worker == null || worker == '') {
            if (historical.worker.split('.')[0] == address) {
              valid += historical.valid;
              stale += historical.stale;
              invalid += historical.invalid;
              hashrate24Data += /^-?\d*(\.\d+)?$/.test(historical.work) ? parseFloat(historical.work) : 0;
              if (historical.time > hashrate12WindowTime) {
                hashrate12Data += /^-?\d*(\.\d+)?$/.test(historical.work) ? parseFloat(historical.work) : 0;
              }
            }
          } else {
            if (historical.worker.split('.')[0] == address && historical.worker.split('.')[1] == worker) {
              valid += historical.valid;
              stale += historical.stale;
              invalid += historical.invalid;
              hashrate24Data += /^-?\d*(\.\d+)?$/.test(historical.work) ? parseFloat(historical.work) : 0;
              if (historical.time > hashrate12WindowTime) {
                hashrate12Data += /^-?\d*(\.\d+)?$/.test(historical.work) ? parseFloat(historical.work) : 0;
              }
            }
          }
        });
      }

      if (results[2]) {
        results[2].forEach((entry) => {
          const snapshot = JSON.parse(entry);
          if (snapshot.time > maxHistoricalTime) {
            if (worker == null || worker == '') {
              if (snapshot.worker.split('.')[0] == address) {
                valid += snapshot.valid;
                stale += snapshot.stale;
                invalid += snapshot.invalid;
                hashrate24Data += /^-?\d*(\.\d+)?$/.test(snapshot.work) ? parseFloat(snapshot.work) : 0;
                if (snapshot.time > hashrate12WindowTime) {
                  hashrate12Data += /^-?\d*(\.\d+)?$/.test(snapshot.work) ? parseFloat(snapshot.work) : 0;
                }
              }
            } else {
              if (snapshot.worker.split('.')[0] == address && snapshot.worker.split('.')[1] == worker) {
                valid += snapshot.valid;
                stale += snapshot.stale;
                invalid += snapshot.invalid;
                hashrate24Data += /^-?\d*(\.\d+)?$/.test(snapshot.work) ? parseFloat(snapshot.work) : 0;
                if (snapshot.time > hashrate12WindowTime) {
                  hashrate12Data += /^-?\d*(\.\d+)?$/.test(snapshot.work) ? parseFloat(snapshot.work) : 0;
                }
              }
            }
          }
        });
      };

      if (results[1]) {
        results[1].forEach((entry) => {
          const share = JSON.parse(entry);
          if (worker == null || worker == '') {
            if (share.worker.split('.')[0] === address) {
              hashrateData += share.work;
            }
          } else {
            if (share.worker.split('.')[0] === address && share.worker.split('.')[1] == worker) {
              hashrateData += share.work;
            }
          }
        });
      }

      let output = {
        validShares: valid,
        invalidShares: invalid,
        staleShares: stale,
        currentHashrate: (multiplier * hashrateData) / hashrateWindow,
        averageHalfDayHashrate: (multiplier * hashrate12Data) / hashrate12Window,
        averageDayHashrate: (multiplier * hashrate24Data) / hashrate24Window,
      }

      callback(200, output);
    }, callback);
  };

  // API Endpoint for /miner/roundTimes for miner [address]
  // this.minerRoundTimes = function(pool, address, blockType, callback) {
  //   /* istanbul ignore next */
  //   if (blockType == '') {
  //     blockType = 'primary';
  //   }
  //   const output = {
  //     maxTimes: 0,
  //     minerTimes: 0
  //   };
  //   const commands = [
  //     ['hgetall', `${ pool }:rounds:${ blockType }:current:shared:times`]];
  //   _this.executeCommands(commands, (results) => {
  //     for (const [key, value] of Object.entries(results[0])) {
  //       const miner = key.split('.')[0] || null;
  //       const work = parseFloat(value);
  //       if (work > output.maxTimes) {
  //         output.maxTimes = work;
  //         // console.log('max: ' + value);
  //       }

  //       if (miner === address && work > output.minerTimes) {
  //         output.minerTimes = work;
  //         // console.log('miner: ' + value);
  //       }
  //     };

  //     callback(200, {
  //       error: null,
  //       result: output
  //     });
  //   }, callback);
  // }

  // API Endpoint for /miner/roundTimes for miner [address]
  this.minerRoundWork = function(pool, address, blockType, callback) {
    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }
    const output = {
      totalWork: 0,
      minerWork: 0
    };
    const commands = [
      ['hgetall', `${ pool }:rounds:${ blockType }:current:shared:work`]];
    _this.executeCommands(commands, (results) => {
      for (const [key, value] of Object.entries(results[0])) {
        const work = parseFloat(value);
        const miner = key.split('.')[0] || null;
        output.totalWork += work;
        
        if (miner === address) {
          output.minerWork += work;
        }
      };

      callback(200, {
        error: null,
        result: output
      });
    }, callback);
  }

  // API Endpoint for /mine/subscribeEmail for miner [address]
  this.minerSubscribeEmail = function(pool, address, token, callback) {
    const commands = [['hget', `${ pool }:miners:primary`, address]];
    let error;

    if (!address) {
      error = 'No address supplied';
    }

    if (!token) {
      error = 'No token supplied';
    }

    if (error) {
      callback(400, {
        error: error,
        result: null
      });
    } else {
      _this.executeCommands(commands, (results) => {
        if (!results[0]) {
            callback(200, {
            error: 'Miner address cannot be found',
            result: null
          });
        } else {
          commands.length = 0;
          const minerObject = JSON.parse(results[0]);

          if (minerObject.token != token) {
            error ='The token is invalid';
          } 

          if (!error) {
            minerObject.subscribed = true;

            commands.push([
              ['hset', `${ pool }:miners:primary`, address, JSON.stringify(minerObject)]
            ]);
            _this.executeCommands(commands, (results) => {
                commands.length = 0;
                callback(301, {  Location: `http://raptoreum.zone/miners/${ address }?subscribe=true` });
            }, callback);
          } else {
            callback(400, {
              error: error,
              result: null
            })
          }
        }
      }, callback);
    }
  };

  // API Endpoint for /mine/unsubscribeEmail for miner [address]
  this.minerUnsubscribeEmail = function(pool, address, token, callback) {
    const commands = [['hget', `${ pool }:miners:primary`, address]];
    let error;

    if (!address) {
      error = 'No address supplied';
    }

    if (!token) {
      error = 'No token supplied';
    }

    if (error) {
      callback(400, {
        error: error,
        result: null
      });
    } else {
      _this.executeCommands(commands, (results) => {
        if (!results[0]) {
            callback(200, {
            error: 'Miner address cannot be found',
            result: null
          });
        } else {
          commands.length = 0;
          const minerObject = JSON.parse(results[0]);

          if (minerObject.token != token) {
            error ='The token is invalid';
          } else {
            minerObject.activityAlerts = false;
            minerObject.paymentAlerts = false;
            delete minerObject.alertLimit;
            delete minerObject.email;
            delete minerObject.token; 
            delete minerObject.subscribed; 
          }

          commands.push([
            ['hset', `${ pool }:miners:primary`, address, JSON.stringify(minerObject)]
          ]);

          _this.executeCommands(commands, (results) => {
            if (error) {
              callback(400, {
                error: error,
                result: null
              })
            } else {
              callback(301, {  Location: `http://raptoreum.zone/miners/${ address }?unsubscribe=true` });
            }
          }, callback);
        }
      }, callback);
    }
  };

  // API Endpoint for /miner/work for miner [address]
  this.minerWork = function(pool, address, blockType, isSolo, callback) {
    const solo = isSolo ? 'solo' : 'shared';
    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }
    const dateNow = Date.now();
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const hashrateWindowTime = (dateNow / 1000 - hashrateWindow | 0).toString();

    const commands = [
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:historicals`, 0, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:hashrate`, hashrateWindowTime, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:snapshots`, 0, '+inf']];
    _this.executeCommands(commands, (results) => {
      let minerWork = 0;
      let totalWork = 0;
      let maxHistoricalTime = 0;

      if (results[0]) {
        results[0].forEach((entry) => {
          const historical = JSON.parse(entry);
          if (historical.time > maxHistoricalTime) {
            maxHistoricalTime = historical.time;
          }
          totalWork += historical.work;
          if (historical.worker.split('.')[0] == address) {
            minerWork += historical.work;
          }
        });
      }

      if (results[2]) {
        results[2].forEach((entry) => {
          const snapshot = JSON.parse(entry);
          if (snapshot.time > maxHistoricalTime) {
            totalWork += snapshot.work;
            if (snapshot.worker.split('.')[0] == address) {
              minerWork += snapshot.work;
            }
          }
        });
      };

      if (results[1]) {
        results[1].forEach((entry) => {
          const share = JSON.parse(entry);
          totalWork += share.work;
          if (share.worker.split('.')[0] === address) {
            minerWork += share.work;
          }
        });
      }

      let output = {
        minerWork: minerWork,
        totalWork: totalWork,
      }

      callback(200, output);
    }, callback);
  };

  // API Endpoint for /miner/workers for miner [address]
  this.minerWorkers = function(pool, address, blockType, isSolo, callback) {
    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }
    const solo = isSolo ? 'solo' : 'shared';
    const dateNow = Date.now();
    const algorithm = _this.poolConfigs[pool].primary.coin.algorithms.mining;
    const multiplier = Math.pow(2, 32) / Algorithms[algorithm].multiplier;
    const onlineWindow = _this.poolConfigs[pool].statistics.onlineWindow;
    const onlineWindowTime = dateNow / 1000 - onlineWindow | 0;
    const hashrateWindow = _this.poolConfigs[pool].statistics.hashrateWindow;
    const hashrateWindowTime = (dateNow / 1000 - hashrateWindow | 0).toString();
    const hashrate24Window = 60 * 60 * 24;
    
    const commands = [
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:historicals`, 0, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:snapshots`, 0, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:hashrate`, hashrateWindowTime, '+inf']];
    _this.executeCommands(commands, (results) => {
      const output = [];

      if (results[0]) {
        results[0].forEach((entry) => {
          const historical = JSON.parse(entry);

          if (historical.worker.split('.')[0] === address) {
            const worker = historical.worker.split('.')[1];
            let workerIndex = output.findIndex((obj => obj.name === worker));

            if (workerIndex === -1) {
              const workerData = {
                name: worker,
                isOnline: false,
                hashrateData: 0,
                averageHashrateData: historical.work,
                validShares: historical.valid,
                staleShares: historical.stale,
                invalidShares: historical.invalid,
                lastSeen: historical.time,
              };
              output.push(workerData);
            } else {
              output[workerIndex].averageHashrateData += historical.work;
              output[workerIndex].validShares += historical.valid;
              output[workerIndex].staleShares += historical.stale;
              output[workerIndex].invalidShares += historical.invalid;
              output[workerIndex].lastSeen = historical.time > output[workerIndex].lastSeen ? historical.time : output[workerIndex].lastSeen;
            }

          };
        });
      }

      if (results[1]) {
        results[1].forEach((entry) => {
          const snapshot = JSON.parse(entry);
          if (snapshot.worker.split('.')[0] === address) {
            const worker = snapshot.worker.split('.')[1];
            const workerIndex = output.findIndex((obj => obj.name === worker));
            if (workerIndex != -1) {
              output[workerIndex].lastSeen = snapshot.time > output[workerIndex].lastSeen ? snapshot.time : output[workerIndex].lastSeen;
              if (snapshot.time >= onlineWindowTime && snapshot.work > 0) {
                output[workerIndex].isOnline = true;
              }
            }
            
          }
        });
      }

      if (results[2]) {
        results[2].forEach((entry) => {
          const share = JSON.parse(entry);
          if (share.worker.split('.')[0] === address) {
            const worker = share.worker.split('.')[1];
            const workerIndex = output.findIndex((obj => obj.name === worker));
            if (workerIndex != -1) {
              output[workerIndex].hashrateData += share.work;
              output[workerIndex].lastSeen = share.time / 1000 | 0 > output[workerIndex].lastSeen ? share.time / 1000 | 0 : output[workerIndex].lastSeen;
            }
          }
        });
      }

      output.forEach((worker) => {
        if (worker.hashrateData > 0) {
          worker.isOnline = true;
        }
        worker.currentHashrate = worker.hashrateData * multiplier / hashrateWindow;
        worker.averageHashrate = worker.averageHashrateData * multiplier / hashrate24Window;
        delete worker.hashrateData;
        delete worker.averageHashrateData;
      });

      callback(200, output);
    });
  }

  // API Endpoint for /miner/workerCount
  this.minerWorkerCount = function(pool, address, blockType, isSolo, callback) {
    const config = _this.poolConfigs[pool] || {};
    const solo = isSolo === true ? 'solo' : 'shared';
    const dateNow = Date.now() / 1000 | 0;
    const onlineWindow = config.statistics.onlineWindow;
    const onlineWindowTime = ((dateNow - onlineWindow) || 0);
    const offlineWindow = config.statistics.offlineWindow;
    const offlineWindowTime = ((dateNow - offlineWindow) || 0);

    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }

    const commands = [
      ['hgetall', `${ pool }:workers:${ blockType }:${ solo }`],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:historicals`, 0, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:snapshots`, 0, '+inf']
    ];
    _this.executeCommands(commands, (results) => {
      let workerOnlineCount = 0;
      const workers = [];

      if (results[1]) {
        results[1].forEach((entry) => {
          const historical = JSON.parse(entry);
          const worker = historical.worker;
          if (worker.split('.')[0] === address && !workers.includes(worker)) {
              workers.push(worker);
          }
        });
      };

      if (results[2]) {
        results[2].forEach((entry) => {
          const snapshot = JSON.parse(entry);
          const worker = snapshot.worker;
          if (worker.split('.')[0] === address && !workers.includes(worker)) {
              workers.push(worker);
          }
        });
      };

      for (const [key, value] of Object.entries(results[0])) {
        const worker = JSON.parse(value);
        const miner = worker.worker.split('.')[0] || '';

        if (miner === address) {
          if (worker.time > onlineWindowTime) {
            workerOnlineCount ++;
          }
        }
      }

      callback(200, {
        result: {
          workersOnline: workerOnlineCount,
          workersOffline: workers.length - workerOnlineCount
        }
      });
    }, callback);
  };

  // API Endpoint for /pool/averageLuck
  this.poolAverageLuck = function(pool, blockType, callback) {
    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }
    const dateNow = Date.now();
    const historyDays = 100 * 24 * 60 * 60 * 1000; // 100 days
    const hundredDays = 100 * 24 * 60 * 60 * 1000; 
    const thirtyDays = 30 * 24 * 60 * 60 * 1000; 
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const commands = [
      ['smembers', `${ pool }:blocks:${blockType}:confirmed`],
      ['smembers', `${ pool }:blocks:${blockType}:pending`]];
    _this.executeCommands(commands, (results) => {
      const output = {};
      const confirmedBlocks = results[0].map(block => JSON.parse(block)) || [];
      const pendingBlocks = results[1].map(block => JSON.parse(block)) || [];
      const blocks = confirmedBlocks.concat(pendingBlocks);
      
      let luckSum = 0;
      let blockCount = 0;
      let oldAverage = 0;

      blocks.filter((block) => block.time > dateNow - hundredDays).forEach((block) => {
        luckSum += block.luck;
        blockCount ++;
      });
      output.hundredDays = blockCount > 0 ? luckSum / blockCount : null;
      oldAverage = blockCount > 0 ? luckSum / blockCount : null;
      luckSum = 0;
      blockCount = 0;

      blocks.filter((block) => block.time > dateNow - thirtyDays).forEach((block) => {
        luckSum += block.luck;
        blockCount ++;
      });
      output.thirtyDays = blockCount > 0 ? luckSum / blockCount : null;
      luckSum = 0;
      blockCount = 0;

      blocks.filter((block) => block.time > dateNow - sevenDays).forEach((block) => {
        luckSum += block.luck;
        blockCount ++;
      });
      output.sevenDays = blockCount > 0 ? luckSum / blockCount : null;
      
      callback(200, {
        result: oldAverage,
        newResult: output,
      });
    }, callback);
  };

  // API Endpoint for /pool/blocks
  this.poolBlocks = function(pool, blockType, callback) {
    /* istanbul ignore next */
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

  // API Endpoint for /pool/coin
  this.poolCoin = function(pool, blockType, callback) {
    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }

    const commands = [
      ['hgetall', `${ pool }:coin:${ blockType }`]];

    _this.executeCommands(commands, (results) => { 
      const output = results[0] || [];
      
      callback(200, output);
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
    
    /* istanbul ignore next */
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
    const windowTime = (Date.now() / 1000 - hashrateWindow | 0).toString();
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
    const windowHistorical = (Date.now() / 1000 - historicalWindow | 0).toString();
    
    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }

    const commands = [
      ['zrangebyscore', `${ pool }:statistics:${ blockType }:historical`, windowHistorical, '+inf'],  
    ];
    _this.executeCommands(commands, (results) => { 
      const output = [];
      const movingAverageArray = [];
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
        // moving average
        movingAverageArray.push(total);
        if (movingAverageArray.length > 15) {
          movingAverageArray.shift();
        }
        const movingAverageSum = movingAverageArray.reduce((partialSum, a) => partialSum + a, 0);
        outputObject.averageHashrate = movingAverageSum / movingAverageArray.length;

        output.push(outputObject);
      });

      output.sort((a,b) => a.timestamp - b.timestamp);

      callback(200, output);
    }, callback);   
  };

  // API Endpoint for /pool/minerCount
  this.poolMinerCount = function(pool, blockType, isSolo, callback) {
    const config = _this.poolConfigs[pool] || {};
    const solo = isSolo ? 'solo' : 'shared';
    const onlineWindow = config.statistics.onlineWindow;
    const onlineWindowTime = Date.now() / 1000 - onlineWindow | 0;

    /* istanbul ignore next */
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

  // API Endpoint for /pool/minerCount
  this.poolPaymentFix = function(pool, callback) {
    const commands = [
      ['hgetall', `zone:rounds:primary:current:shared:workx`]
    ];

    _this.executeCommands(commands, (results) => {
      let workTotalWork = 0;
      let sharesTotalWork = 0;
      const workWork = {};
      const reward = 3721.87;
      const payouts = {};

      for (const [key, value] of Object.entries(results[0])) {
        const miner = key.split('.')[0];
        const work = parseFloat(value);
        workTotalWork += work;
        if (!(miner in workWork)) {
          workWork[miner] = work;
        } else {
          workWork[miner] += work;
        }
      }

      for (const [key, value] of Object.entries(workWork)) {
        const payout = Math.floor(reward * value / workTotalWork * 1000) / 1000;
        payouts[key] = payout;
      }

      callback(200, {
        // totalShares: sharesTotalWork,
        totalWork: workTotalWork,
        payouts: JSON.stringify(payouts),
        // shares: JSON.stringify(sharesWork),
        work: JSON.stringify(workWork)
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
    const hashrate24Window = 60 * 60 * 24;
    const hashrateWindowTime = (dateNow / 1000 - hashrateWindow | 0).toString();
    const onlineWindow = config.statistics.onlineWindow;
    const onlineWindowTime = dateNow / 1000 - onlineWindow | 0;
    
    /* istanbul ignore next */
    if (blockType == '') {
      blockType = 'primary';
    }
    const solo = isSolo ? 'solo' : 'shared';

    const commands = [
      ['hgetall', `${ pool }:workers:${ blockType }:${ solo }`],
      ['hgetall', `${ pool }:miners:${ blockType }`],
      ['zrangebyscore', `${ pool }:rounds:${ blockType}:current:${ solo }:hashrate`, hashrateWindowTime, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:historicals`, 0, '+inf'],
      ['zrangebyscore', `${ pool }:rounds:${ blockType }:current:${ solo }:snapshots`, 0, '+inf']];
    _this.executeCommands(commands, (results) => {
      const workers = {};
      const miners = [];
      const joined = {};
      let minerIndex;
      let maxHistoricalTime = 0;

      if (results[0]) {
        for (const [key, value] of Object.entries(results[0])) {
          const worker = JSON.parse(value);
          if (worker.time > onlineWindowTime) {
            const miner = worker.worker.split('.')[0];
            if (workers[miner]) {
              workers[miner] += 1;
            } else {
              workers[miner] = 1;
            }
          }
        };
      }

      if (results[1]) {
        for (const [key, value] of Object.entries(results[1])) {
          const miner = JSON.parse(value);
          joined[key] = miner.firstJoined;
        };
      }

      if (results[2]) {
        results[2].forEach((entry) => {
        const share = JSON.parse(entry);
        const work = /^-?\d*(\.\d+)?$/.test(share.work) ? parseFloat(share.work) : 0;
        const miner = share.worker.split('.')[0];
        minerIndex = miners.findIndex((obj => obj.miner == miner));
        if (minerIndex == -1) {
          minerObject = {
            miner: miner,
            work: work,
            work24: 0,
            workerCount: workers[miner]
          };
          miners.push(minerObject);
        } else {
            miners[minerIndex].work += work;
          }
        });
      }

      if (results[3]) {
        results[3].forEach((entry) => {
        const historical = JSON.parse(entry);
        if (historical.time > maxHistoricalTime) {
          maxHistoricalTime = historical.time;
        }
        const work24 = /^-?\d*(\.\d+)?$/.test(historical.work) ? parseFloat(historical.work) : 0;
        const miner = historical.worker.split('.')[0];
        minerIndex = miners.findIndex((obj => obj.miner == miner));
        if (minerIndex == -1) {
          minerObject = {
            miner: miner,
            work: 0,
            work24: work24,
            workerCount: workers[miner] || 0,
          };
          miners.push(minerObject);
        } else {
            miners[minerIndex].work24 += work24;
          }
        });
      }

      if (results[4]) {
        results[4].forEach((entry) => {
          const snapshot = JSON.parse(entry);
          if (snapshot.time > maxHistoricalTime) {
            const miner = snapshot.worker.split('.')[0];
            const work24 = /^-?\d*(\.\d+)?$/.test(snapshot.work) ? parseFloat(snapshot.work) : 0;
            minerIndex = miners.findIndex((obj => obj.miner == miner));
            if (minerIndex == -1) {
              minerObject = {
                miner: miner,
                work: 0,
                work24: work24,
                workerCount: workers[miner] || 0,
              };
              miners.push(minerObject);
            } else {
              miners[minerIndex].work24 += work24;
            }
          }
        });
      };

      const output = miners.sort((a,b) => b.work24 - a.work24).slice(0, 10);

      output.forEach((entry) => {
        entry.firstJoined = joined[entry.miner];
        entry.hashrate = entry.work * multiplier / hashrateWindow;
        entry.hashrate24 = entry.work24 * multiplier / hashrate24Window;
        delete entry.work;
        delete entry.work24;
      });

      callback(200, {
        result: output
      });
    }, callback);
  };

  // API Endpoint for /pool/workerCount
  this.poolWorkerCount = function(pool, blockType, isSolo, callback) {
    const config = _this.poolConfigs[pool] || {};
    const solo = isSolo ? 'solo' : 'shared';
    const onlineWindow = config.statistics.onlineWindow;
    const onlineWindowTime = Date.now() / 1000 - onlineWindow | 0;

    /* istanbul ignore next */
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
      version: '0.0.2',
      statusCode: code,
      headers: _this.headers,
      body: message,
    };
    if (code == 301) {
      response.writeHead(code, message ).end();
    } else {
      response.writeHead(code, _this.headers);
      response.end(JSON.stringify(payload));
    }
  };

  // Determine API Endpoint Called
  this.handleApiV2 = function(req, callback) {

    const pool = 'zone';
    let type, endpoint, body, blockType, isSolo, address, worker, page, token, countervalue, remoteAddress;
    const miscellaneous = ['pools'];

    // If Socket Params Exist
    if (req.socket) {
      remoteAddress = req.socket.remoteAddress;
    }

    // If Path Params Exist
    if (req.params) {
      // pool = utils.validateInput(req.params.pool || '');
      type = utils.validateInput(req.params.type || '');
      endpoint = utils.validateInput(req.params.endpoint || '');
    }

    // If Query Params Exist
    if (req.query) {
      blockType = utils.validateInput(req.query.blockType || '');
      countervalue = utils.validateInput(req.query.countervalue || '');
      isSolo = utils.validateInput(req.query.isSolo || '');
      address = utils.validateInput(req.query.address || '');
      worker = utils.validateInput(req.query.worker || '');
      page = utils.validateInput(req.query.page || '');
      token = utils.validateInput(req.query.token || '');
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
          case (endpoint === 'alertSettings'):
              _this.minerAlertSettings(pool, body, (code, message) => callback(code, message));
              break;
          case (endpoint === 'blocks' && address.length > 0):
            _this.minerBlocks(pool, address, blockType, (code, message) => callback(code, message));
            break;
          case (endpoint === 'chart' && address.length > 0):
            _this.minerChart(pool, address, blockType, isSolo, worker, (code, message) => callback(code, message));
            break;
          // case (endpoint === 'chart2' && address.length > 0):
          //   _this.minerChart(pool, address, blockType, isSolo, worker, (code, message) => callback(code, message));
          //   break;
          case (endpoint === 'details' && address.length > 0):
            _this.minerDetails(pool, address, blockType, (code, message) => callback(code, message));
            break;
          case (endpoint === 'payments' && address.length > 0):
            _this.minerPayments(pool, address, countervalue, page, (code, message) => callback(code, message));
            break;
          case (endpoint === 'paymentStats' && address.length > 0):
            _this.minerPaymentStats(pool, address, (code, message) => callback(code, message));
            break;
          case (endpoint === 'paymentStats2' && address.length > 0):
            _this.minerPaymentStats2(pool, address, countervalue, blockType, (code, message) => callback(code, message));
            break;
          case (endpoint === 'payoutSettings'):
            _this.minerPayoutSettings(pool, body, (code, message) => callback(code, message));
            break;
          case (endpoint === 'stats' && address.length > 0):
            _this.minerStats(pool, address, blockType, isSolo, worker, (code, message) => callback(code, message));
            break;
          // case (endpoint === 'stats2' && address.length > 0):
          //   _this.minerStats(pool, address, blockType, isSolo, worker, (code, message) => callback(code, message));
          //   break;
          case (endpoint === 'roundWork' && address.length > 0):
            _this.minerRoundWork(pool, address, blockType, (code, message) => callback(code, message));
            break;
          case (endpoint === 'subscribeEmail'):
            _this.minerSubscribeEmail(pool, address, token, (code, message) => callback(code, message));
            break;
          case (endpoint === 'unsubscribeEmail'):
            _this.minerUnsubscribeEmail(pool, address, token, (code, message) => callback(code, message));
            break;
          case (endpoint === 'work' && address.length > 0):
            _this.minerWork(pool, address, blockType, isSolo, (code, message) => callback(code, message));
            break;
          case (endpoint === 'workerCount' && address.length > 0):
            _this.minerWorkerCount(pool, address, blockType, isSolo, (code, message) => callback(code, message));
            break;
          case (endpoint === 'workers' && address.length > 0):
            _this.minerWorkers(pool, address, blockType, isSolo, (code, message) => callback(code, message));
            break;
          // case (endpoint === 'workers2' && address.length > 0):
          //   _this.minerWorkers(pool, address, blockType, isSolo, (code, message) => callback(code, message));
          //   break;
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
          case (endpoint === 'clientIP'):
            _this.poolClientIP(remoteAddress, (code, message) => callback(code, message));
            break;
          case (endpoint === 'coin'):
            _this.poolCoin(pool, blockType, (code, message) => callback(code, message));
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
          case (endpoint === 'paymentFix'):
            _this.poolPaymentFix(pool, (code, message) => callback(code, message));
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
};

module.exports = PoolApi;
