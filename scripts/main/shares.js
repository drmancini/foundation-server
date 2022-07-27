/*
 *
 * Shares (Updated)
 *
 */

const utils = require('./utils');

////////////////////////////////////////////////////////////////////////////////

// Main Shares Function
const PoolShares = function (logger, client, poolConfig, portalConfig) {

  const _this = this;
  process.setMaxListeners(0);

  this.pool = poolConfig.name;
  this.client = client;
  this.poolConfig = poolConfig;
  this.portalConfig = portalConfig;
  this.forkId = process.env.forkId;

  // Handle Round Values
  this.curHeight = 0;
  this.minHeight = 0;

  const logSystem = 'Pool';
  const logComponent = poolConfig.name;
  const logSubCat = `Thread ${ parseInt(_this.forkId) + 1 }`;

  // Handle Client Messages
  _this.client.on('ready', () => {});
  _this.client.on('error', (error) => {
    logger.error(logSystem, logComponent, logSubCat, `Redis client had an error: ${ JSON.stringify(error) }`);
  });
  _this.client.on('end', () => {
    logger.error(logSystem, logComponent, logSubCat, 'Connection to redis database has been ended');
  });

  // Handle Times Updates
  this.handleTimes = function(lastShare, lastBlockTime) {
    const dateNow = Date.now();
    const roundTime = dateNow - lastBlockTime;
    const lastTime = lastShare.time || dateNow;

    // Check for Continous Primary Mining
    let times = lastShare.times || 0;
    const timeChange = utils.roundTo(Math.max(dateNow - lastTime, 0) / 1000, 4);
    
    if (timeChange < 900) {
      times = times + timeChange;
    }

    if (times > roundTime) {
      times = roundTime;
    }

    return times;
  };

  // Handle Effort Updates
  this.handleEffort = function(shares, worker, shareData, shareType, blockDifficulty, isSoloMining) {

    // Calculate Work Sum from Shared/Solo Mining
    let difficulties = 0;
    Object.keys(shares).forEach((share) => {
      const shareInfo = JSON.parse(shares[share]);
      const workValue = /^-?\d*(\.\d+)?$/.test(shareInfo.work) ? parseFloat(shareInfo.work) : 0;
      if (isSoloMining && share === worker && shareInfo.solo) {
        difficulties += workValue;
      } else if (!isSoloMining && !shareInfo.solo) {
        difficulties += workValue;
      }
    });

    // Calculate Effort for Shared/Solo Mining
    const effort = shareType === "valid" ? (difficulties + shareData.difficulty) : difficulties;
    return effort / blockDifficulty * 100;
  };

  // Handle Type Updates
  this.handleTypes = function(lastShare, shareType) {

    // Increment Type of Last Share Submitted
    const types = { valid: 0, invalid: 0, stale: 0 };
    const lastTypes = lastShare.types || types;
    lastTypes[shareType] += 1;

    return lastTypes;
  };

  // Manage Shares Calculations
  this.calculateShares = function(results, shareData, shareType, blockType, isSoloMining) {

    let shares;
    let lastBlockTime;
    const commands = [];
    const dateNow = Date.now();
    const difficulty = shareType === 'valid' ? shareData.difficulty : 0;
    const minerType = isSoloMining ? 'solo' : 'shared';
    const identifier = shareData.identifier || '';
    const ipLength = shareData.ip.split(':').length - 1;
    const ip = shareData.ip.split(':')[ipLength];

    const worker = ['share', 'primary'].includes(blockType) ? shareData.addrPrimary : shareData.addrAuxiliary;
    const blockDifficulty = ['share', 'primary'].includes(blockType) ? shareData.blockDiffPrimary : shareData.blockDiffAuxiliary;

    // Establish Previous Share Data: 
    if (isSoloMining) {
      shares = (['share', 'primary'].includes(blockType)) ? (results[2] || {}) : (results[3] || {});
    } else {
      shares = (['share', 'primary'].includes(blockType)) ? (results[0] || {}) : (results[1] || {});
    }

    if (!isSoloMining) {
      shares = (['share', 'primary'].includes(blockType)) ? (results[4].blockTime || 0) : (results[5].blockTime || 0);
    } 

    // Establish Last Share Data for Miner
    const lastShare = JSON.parse(shares[worker] || '{}');

    // Handle Round Height Updates
    if (shareData.height > _this.curHeight) _this.curHeight = shareData.height;
    if (!isSoloMining && shareData.height < _this.curHeight) shareType = "stale";
    

    // Calculate Updated Share Data
    const times = _this.handleTimes(lastShare, lastBlockTime, shareType);
    const effort = _this.handleEffort(shares, worker, shareData, shareType, blockDifficulty, isSoloMining);
    const types = _this.handleTypes(lastShare, shareType);
    let workIncrement = difficulty;
    const work = workIncrement + (lastShare.work || 0);

    // Build Output Share
    const outputShare = {
      time: dateNow,
      effort: effort,
      identifier: identifier,
      round: shareData.height,
      solo: isSoloMining,
      times: times,
      types: types,
      type: shareType,
      work: work,
      worker: worker,
    };

    // Update Last Share if Orphaned
    if (lastShare.round === 'orphan') {
      lastShare.round = shareData.height;
    }

    // Reset Share Data (If Necessary)
    if (!isSoloMining && shareData.height < _this.minHeight) {
      logger.warning(logSystem, logComponent, logSubCat, `Resetting share data for ${ worker } due to rounds overlapping.`);
      outputShare.effort = shareData.difficulty / blockDifficulty * 100;
      outputShare.times = 0;
      outputShare.types = { valid: 0, invalid: 0, stale: 0 };
      outputShare.work = difficulty;
      workIncrement = 0;
    }

    // Build Worker Activity Data
    const workerShare = {
      time: dateNow / 1000 | 0,
      worker: worker,
      ip: ip,
      offline: false
    };

    // Build Secondary Output (Solo)
    const hashrateShare = JSON.parse(JSON.stringify(outputShare));
    hashrateShare.work = difficulty;

    // No Shared Effort if Solo Share
    if (shareType === 'valid' && isSoloMining) {
      commands.push(['zadd', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:hashrate`, dateNow / 1000 | 0, JSON.stringify(hashrateShare)]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, worker, JSON.stringify(outputShare)]);
      commands.push(['hincrby', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:work`, worker, work]);
      commands.push(['hset', `${ _this.pool }:workers:${ blockType }:${ minerType }`, worker, JSON.stringify(workerShare)]);

    // Handle Shared Effort, Share Updates
    } else if (shareType === 'valid') {
      commands.push(['zadd', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:hashrate`, dateNow / 1000 | 0, JSON.stringify(hashrateShare)]);
      commands.push(['hincrby', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:counts`, 'valid', 1]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, worker, JSON.stringify(outputShare)]);
      commands.push(['hincrbyfloat', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:work`, worker, parseFloat(workIncrement)]);
      commands.push(['hset', `${ _this.pool }:workers:${ blockType }:${ minerType }`, worker, JSON.stringify(workerShare)]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:counts`, 'effort', effort]);

    // Handle Stale Shares Submitted
    } else if (shareType === 'stale') {
      commands.push(['zadd', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:hashrate`, dateNow / 1000 | 0, JSON.stringify(hashrateShare)]);
      commands.push(['hincrby', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:counts`, 'stale', 1]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, worker, JSON.stringify(outputShare)]);
      commands.push(['hset', `${ _this.pool }:workers:${ blockType }:${ minerType }`, worker, JSON.stringify(workerShare)]);

    // Handle Invalid Shares Submitted
    } else {
      commands.push(['zadd', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:hashrate`, dateNow / 1000 | 0, JSON.stringify(hashrateShare)]);
      commands.push(['hincrby', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:counts`, 'invalid', 1]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, worker, JSON.stringify(outputShare)]);
      commands.push(['hset', `${ _this.pool }:workers:${ blockType }:${ minerType }`, worker, JSON.stringify(workerShare)]);
    }

    return commands;
  };

  // Manage Blocks Calculations
  this.calculateBlocks = function(results, shareData, shareType, blockValid, isSoloMining) {

    let shares;
    const commands = [];
    const dateNow = Date.now();
    const blockType = shareData.blockType;
    const difficulty = (shareType === 'valid' ? shareData.difficulty : -shareData.difficulty);
    const minerType = isSoloMining ? 'solo' : 'shared';
    const identifier = shareData.identifier || '';
    const ipLength = shareData.ip.split(':').length - 1;
    const ip = shareData.ip.split(':')[ipLength];

    const worker = ['share', 'primary'].includes(blockType) ? shareData.addrPrimary : shareData.addrAuxiliary;
    const blockDifficulty = ['share', 'primary'].includes(blockType) ? shareData.blockDiffPrimary : shareData.blockDiffAuxiliary;

    // Establish Previous Share Data
    if (isSoloMining) {
      shares = (['share', 'primary'].includes(blockType)) ? (results[2] || {}) : (results[3] || {});
    } else {
      shares = (['share', 'primary'].includes(blockType)) ? (results[0] || {}) : (results[1] || {});
    }

    // Establish Last Share Data for Miner
    const lastShare = JSON.parse(shares[worker] || '{}');
    const luck = _this.handleEffort(shares, worker, shareData, shareType, blockDifficulty, isSoloMining);

    // Build Output Block
    const outputBlock = {
      time: dateNow,
      height: shareData.height,
      hash: shareData.hash,
      reward: shareData.reward,
      nodeReward: shareData.smartnodeReward, // added
      founderReward: shareData.founderReward, // added
      identifier: identifier,
      transaction: shareData.transaction,
      difficulty: blockDifficulty,
      luck: luck,
      worker: worker,
      solo: isSoloMining,
      round: shareData.height,
    };

    // Build Primary Output (Solo)
    const outputShare = {
      time: dateNow,
      effort: 0,
      identifier: identifier,
      round: shareData.height,
      solo: isSoloMining,
      times: 0,
      types: { valid: 0, invalid: 0, stale: 0 },
      work: difficulty,
      worker: worker,
    };

    // Build Worker Activity Data
    const workerShare = {
      time: dateNow / 1000 | 0,
      worker: worker,
      ip: ip,
      offline: false
    };
    
    // Build Secondary Output (Solo)
    const roundShare = JSON.parse(JSON.stringify(outputShare));
    roundShare.effort = luck;
    roundShare.times = lastShare.times;
    roundShare.types = lastShare.types;
    roundShare.work = difficulty + (lastShare.work || 0);

    // Check for Multiple Workers (Solo);
    const workers = Object.keys(results[2] || {}).filter((result) => {
      const address = worker ? worker.split('.')[0] : '';
      return result.split('.')[0] === address;
    });

    // Update Round Value (If Necessary)
    if (!isSoloMining && blockValid && shareData.height > _this.minHeight) {
      _this.minHeight = shareData.height;
    }

    // Don't Restart Round if Solo Block, Just Reset Workers
    if (blockValid && isSoloMining) {
      commands.push(['sadd', `${ _this.pool }:blocks:${ blockType }:pending`, JSON.stringify(outputBlock)]);
      commands.push(['hincrby', `${ _this.pool }:blocks:${ blockType }:counts`, 'valid', 1]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:round-${ shareData.height }:shares`, worker, JSON.stringify(roundShare)]);
      workers.forEach((result) => {
        outputShare.worker = result;
        commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, result, JSON.stringify(outputShare)]);
        commands.push(['hset', `${ _this.pool }:workers:${ blockType }:${ minerType }`, worker, JSON.stringify(workerShare)]);
      });

    // Handle Round Updates if Shared Block
    } else if (blockValid) {
      commands.push(['sadd', `${ _this.pool }:blocks:${ blockType }:pending`, JSON.stringify(outputBlock)]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:previous`, 'blockTime', outputBlock.time]);
      commands.push(['hset', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:previous`, 'height', shareData.height]);
      commands.push(['hincrby', `${ _this.pool }:blocks:${ blockType }:counts`, 'valid', 1]);
      commands.push(['rename', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:counts`, `${ _this.pool }:rounds:${ blockType }:round-${ shareData.height }:counts`]);
      commands.push(['rename', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:shares`, `${ _this.pool }:rounds:${ blockType }:round-${ shareData.height }:shares`]);
      commands.push(['rename', `${ _this.pool }:rounds:${ blockType }:current:${ minerType }:work`, `${ _this.pool }:rounds:${ blockType }:round-${ shareData.height }:work`]);
      process.send({ pool: _this.pool, type: 'roundUpdate' });

    // Handle Invalid Block Submitted
    } else if (shareData.transaction) {
      commands.push(['hincrby', `${ _this.pool }:blocks:${ blockType }:counts`, 'invalid', 1]);
    }

    return commands;
  };

  // Manage Worker Times
  this.buildSharesCommands = function(results, shareData, shareType, blockValid, isSoloMining) {
    let commands = [];
    commands = commands.concat(_this.calculateShares(results, shareData, shareType, 'primary', isSoloMining));
    if (_this.poolConfig.auxiliary && _this.poolConfig.auxiliary.enabled) {
      commands = commands.concat(_this.calculateShares(results, shareData, shareType, 'auxiliary', isSoloMining));
    }
    return commands;
  };

  // Build Redis Commands
  this.buildCommands = function(results, shareData, shareType, blockValid, callback, handler) {
    let commands = [];
    const isSoloMining = utils.checkSoloMining(_this.poolConfig, shareData);
    commands = commands.concat(_this.buildSharesCommands(results, shareData, shareType, blockValid, isSoloMining));
    commands = commands.concat(_this.calculateBlocks(results, shareData, shareType, blockValid, isSoloMining));
    this.executeCommands(commands, callback, handler);
    return commands;
  };

  // Execute Redis Commands
  /* istanbul ignore next */
  this.executeCommands = function(commands, callback, handler) {
    _this.client.multi(commands).exec((error, results) => {
      if (error) {
        logger.error(logSystem, logComponent, logSubCat, `Error with redis share processing ${ JSON.stringify(error) }`);
        handler(error);
      } else {
        callback(results);
      }
    });
  };

  // Handle Share Submissions
  /* istanbul ignore next */
  this.handleShares = function(shareData, shareType, blockValid, callback, handler) {
    const shareLookups = [
      ['hgetall', `${ _this.pool }:rounds:primary:current:shared:shares`],
      ['hgetall', `${ _this.pool }:rounds:auxiliary:current:shared:shares`],
      ['hgetall', `${ _this.pool }:rounds:primary:current:solo:shares`],
      ['hgetall', `${ _this.pool }:rounds:auxiliary:current:solo:shares`],
      ['hgetall', `${ _this.pool }:rounds:primary:current:shared:previous`],
      ['hgetall', `${ _this.pool }:rounds:auxiliary:current:shared:previous`]];
    this.executeCommands(shareLookups, (results) => {
      _this.buildCommands(results, shareData, shareType, blockValid, callback, handler);
    }, handler);
  };
};

module.exports = PoolShares;
