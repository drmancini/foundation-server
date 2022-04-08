/*
 *
 * Stratum (Updated)
 *
 */

const Stratum = require('foundation-stratum');
const { Sequelize, Op } = require('sequelize');
const SharesCheckModel = require('../../models/shares_check.model');

////////////////////////////////////////////////////////////////////////////////

// Main Stratum Function
const PoolStratum = function (logger, poolConfig, portalConfig, poolShares, poolStatistics, sequelize) {

  // test
  this.sequelize = sequelize;
  const sequelizeSharesCheck = SharesCheckModel(sequelize, Sequelize);
  // const sequelizeBlocks = BlocksModel(sequelize, Sequelize);
  /* istanbul ignore next */
  // if (typeof(sequelizeShares) === 'function' && typeof(sequelizeBlocks) === 'function') {
  if (typeof(sequelizeSharesCheck) === 'function') {
    this.sequelize.sync({ force: false })
  };

  const _this = this;
  process.setMaxListeners(0);

  this.pool = poolConfig.name;
  this.poolConfig = poolConfig;
  this.portalConfig = portalConfig;
  this.poolShares = poolShares;
  this.poolStatistics = poolStatistics;
  this.forkId = process.env.forkId;

  const logSystem = 'Pool';
  const logComponent = poolConfig.name;
  const logSubCat = `Thread ${ parseInt(_this.forkId) + 1 }`;

  // Determine Block Viability
  this.checkPrimary = function(shareData, blockValid) {
    if (shareData.blockType === 'primary' && !blockValid && shareData.transaction) {
      logger.error(logSystem, logComponent, logSubCat, 'We thought a primary block was found but it was rejected by the daemon.');
    } else if (shareData.blockType === 'primary' && blockValid) {
      logger.special(logSystem, logComponent, logSubCat, `Primary block found: ${ shareData.hash } by ${ shareData.addrPrimary }`);
    }
  };

  // Determine Block Viability
  this.checkAuxiliary = function(shareData, blockValid) {
    if (shareData.blockType === 'auxiliary' && !blockValid) {
      logger.error(logSystem, logComponent, logSubCat, 'We thought an auxiliary block was found but it was rejected by the daemon.');
    } else if (shareData.blockType === 'auxiliary' && blockValid) {
      logger.special(logSystem, logComponent, logSubCat, `Auxiliary block found: ${ shareData.hash } by ${ shareData.addrAuxiliary }`);
    }
  };

  // Determine Share Viability
  this.checkShare = function(shareData, shareType) {
    if (['stale', 'invalid'].includes(shareType)) {
      logger.debug(logSystem, logComponent, logSubCat, 'We thought a share was found but it was rejected by the daemon.');
    } else if (shareData.blockType !== 'auxiliary') {
      logger.debug(logSystem, logComponent, logSubCat, `Share accepted at difficulty ${ shareData.difficulty }/${ shareData.shareDiff } by ${ shareData.addrPrimary } [${ shareData.ip }]`);
    }
  };

  // Handle Worker Authentication
  this.authorizeWorker = function(ip, port, addrPrimary, addrAuxiliary, password, callback) {
    _this.checkAuxiliaryWorker(addrAuxiliary, (auxAuthorized) => {
      if (auxAuthorized) {
        _this.checkPrimaryWorker(addrPrimary, (primaryAuthorized) => {
          const authString = primaryAuthorized ? 'Authorized' : 'Unauthorized ';
          logger.debug(logSystem, logComponent, logSubCat, `${ authString } ${ addrPrimary }:${ password } [${ ip }:${ port }]`);
          callback({ error: null, authorized: primaryAuthorized, disconnect: false });
        });
      } else {
        callback({ error: null, authorized: auxAuthorized, disconnect: false });
      }
    });
  };

  // Check for Valid Primary Worker Address
  this.checkPrimaryWorker = function(workerName, callback) {
    const address = workerName.split('.')[0];
    _this.poolStratum.primary.daemon.cmd('validateaddress', [address], false, (results) => {
      const isValid = results.filter((result) => {
        return result.response.isvalid;
      }).length > 0;
      callback(isValid);
    });
  };

  // Check for Valid Auxiliary Worker Address
  this.checkAuxiliaryWorker = function(workerName, callback) {
    if (workerName && _this.poolConfig.auxiliary && _this.poolConfig.auxiliary.enabled) {
      const address = workerName.split('.')[0];
      _this.poolStratum.auxiliary.daemon.cmd('validateaddress', [address], false, (results) => {
        const isValid = results.filter((result) => {
          return result.response.isvalid;
        }).length > 0;
        callback(isValid);
      });
    } else if (_this.poolConfig.auxiliary && _this.poolConfig.auxiliary.enabled) {
      callback(false);
    } else {
      callback(true);
    }
  };

  // Handle Share Submissions
  /* istanbul ignore next */
  this.handleShares = function(shareData, shareType, blockValid, callback) {
    _this.poolShares.handleShares(shareData, shareType, blockValid, () => {
      _this.checkPrimary(shareData, blockValid);
      _this.checkAuxiliary(shareData, blockValid);
      _this.checkShare(shareData, shareType);
      callback();
    }, () => {});
  };

  // Handle Stratum Events
  this.handleEvents = function(poolStratum) {
    poolStratum.on('banIP', (ip) => {
      _this.poolStratum.stratum.addBannedIP(ip);
    });
    poolStratum.on('log', (severity, text) => {
      logger[severity](logSystem, logComponent, logSubCat, text);
    });
    poolStratum.on('difficultyUpdate', (workerName, diff) => {
      logger.debug(logSystem, logComponent, logSubCat, `Difficulty update to ${ diff } for worker: ${ JSON.stringify(workerName) }`);
    });
    poolStratum.on('share', (shareData, shareType, blockValid, callback) => {

      // Save Share Data Check to Historic Database
      if (shareType == 'stale' || shareType == 'invalid') {
        sequelizeSharesCheck
          .create({
            pool: _this.pool,
            blockValid: blockValid,
            share: shareData,
            share_type: shareType,
            //miner_type: minerType,
            //ip_hash: md5(ip), // will ask for user IP to confirm settings (min. payment)
            //ip_hint: '*.*.*.' + ip.split('.')[3], // will give this as hint to user
          });
      }

      _this.handleShares(shareData, shareType, blockValid, callback);
    });
    return poolStratum;
  };

  // Handle Stratum Statistics
  /* istanbul ignore next */
  this.handleStatistics = function(poolStratum) {
    if (_this.forkId === '0') {
      _this.poolStatistics.setupStatistics(poolStratum);
    }
  };

  // Build Pool from Configuration
  this.setupStratum = function(callback) {
    let poolStratum = Stratum.create(_this.poolConfig, _this.portalConfig, _this.authorizeWorker, callback);
    poolStratum = _this.handleEvents(poolStratum);
    poolStratum.setupPool();
    _this.handleStatistics(poolStratum);
    this.poolStratum = poolStratum;
  };
};

module.exports = PoolStratum;
