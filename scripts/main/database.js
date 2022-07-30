/*
 *
 * Database (Updated)
 *
 */

const fs = require('fs');
const path = require('path');
const redis = require('redis');
const Sequelize = require('sequelize');

////////////////////////////////////////////////////////////////////////////////

// Main Database Function
const PoolDatabase = function(portalConfig) {

  const _this = this;
  this.portalConfig = portalConfig;

  // Connect to Redis Client
  /* istanbul ignore next */
  this.buildRedisClient = function() {

    // Build Connection Options
    const connectionOptions = {};
    connectionOptions.port = _this.portalConfig.redis.port;
    connectionOptions.host = _this.portalConfig.redis.host;

    // Check if Authentication is Set
    if (_this.portalConfig.redis.password !== '') {
      connectionOptions.password = _this.portalConfig.redis.password;
    }

    // Check if TLS Configuration is Set
    if (_this.portalConfig.redis.tls) {
      connectionOptions.tls = {};
      connectionOptions.tls.key = fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.key));
      connectionOptions.tls.cert = fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.cert));
      connectionOptions.tls.ca = fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.ca));
    }

    return redis.createClient(connectionOptions);
  };

  // Check Redis Client Version
  this.checkRedisClient = function(client) {
    client.info((error, response) => {
      if (error) {
        console.log('Redis version check failed');
        return;
      }
      let version;
      const settings = response.split('\r\n');
      settings.forEach(line => {
        if (line.indexOf('redis_version') !== -1) {
          version = parseFloat(line.split(':')[1]);
          return;
        }
      });
      if (!version || version <= 2.6) {
        console.log('Could not detect redis version or your redis client is out of date');
      }
      return;
    });
  };

  /* istanbul ignore next */
  this.connectSequelize = function() {

    // Build Connection Options
    const database = _this.portalConfig.postgresql.database;
    const username = _this.portalConfig.postgresql.user;
    const password = _this.portalConfig.postgresql.password;
    
    const connectionOptions = {};
    connectionOptions.host = _this.portalConfig.postgresql.host;
    connectionOptions.port = _this.portalConfig.postgresql.port;
    connectionOptions.dialect = 'postgres';
    connectionOptions.logging = false;
    connectionOptions.pool = {
      idle: 200000,
      acquire: 1000000
    };

    const sequelize = new Sequelize(database, username, password, connectionOptions);




    const sequelizePayments = PaymentsModel(sequelize, Sequelize);
    sequelizePayments  
            .create({
              pool: 'ddd',
              block_type: 'ddd',
              miner: 'ddd',
              paid: 123,
              transaction: 'ddd',
              time: 123,
            });

    return sequelize;
  };
};

module.exports = PoolDatabase;
