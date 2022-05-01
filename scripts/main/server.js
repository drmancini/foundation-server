/*
 *
 * Server (Updated)
 *
 */

const apicache = require('apicache');
const bodyParser = require('body-parser');
const compress = require('compression');
const cors = require('cors');
const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const rateLimit = require('express-rate-limit');
const PoolApi = require('./api.js');
const PoolApi2 = require('./api2.js');

////////////////////////////////////////////////////////////////////////////////

// Main Server Function
const PoolServer = function (logger, client, sequelize) {

  const _this = this;
  process.setMaxListeners(0);

  this.client = client;
  this.sequelize = sequelize;
  this.poolConfigs = JSON.parse(process.env.poolConfigs);
  this.portalConfig = JSON.parse(process.env.portalConfig);

  // Handle Errors with API Responses
  this.handleErrors = function(api, error, res) {
    logger.error('Server', 'Website', `API call threw an unknown error: (${ error })`);
    api.buildResponse(500, 'The server was unable to handle your request. Verify your input or try again later', res);
  };

  // Build Server w/ Middleware
  this.buildServer = function() {

    // Build Main Server
    const app = express();
    const api = new PoolApi(_this.client, _this.poolConfigs, _this.portalConfig);
    const api2 = new PoolApi2(_this.client, _this.sequelize, _this.poolConfigs, _this.portalConfig);
    const api3 = new PoolApi2(_this.client, _this.sequelize, _this.poolConfigs, _this.portalConfig);
    const limiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 100 });
    const cache = apicache.options({}).middleware;

    // Establish Middleware
    app.set('trust proxy', 1);
    app.use(bodyParser.json());
    app.use(limiter);
    app.use(cache('1 minute'));
    app.use(compress());
    app.use(cors());

    // Handle API Requests
    /* istanbul ignore next */
    app.get('/api/v1/:pool/:endpoint?', (req, res) => {
      api.handleApiV1(req, (code, message) => {
        api.buildResponse(code, message, res);
      });
    });

    // Handle v2 API Requests
    /* istanbul ignore next */
    app.get('/api/v2/:pool/:type/:endpoint?', (req, res) => {
      api2.handleApiV2(req, (code, message) => {
        api2.buildResponse(code, message, res);
      });
    });

    // Handle v3 API PUT Requests
    /* istanbul ignore next */
    app.put('/api/v3/:pool/:type/:endpoint?', (req, res) => {
      api2.handleApiV3(req, (code, message) => {
        api2.buildResponse(code, message, res);
      });
    });

    // ERRORS - Handles API Errors
    /* istanbul ignore next */
    /* eslint-disable-next-line no-unused-vars */
    app.use((err, req, res, next) => {
      _this.handleErrors(api, err, res);
      _this.handleErrors(api2, err, res);
      _this.handleErrors(api3, err, res);
    });

    // Handle Health Check
    /* istanbul ignore next */
    app.get('/health/', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 'status': 'OK' }));
    });

    // Set Existing Server Variable
    /* istanbul ignore next */
    if (_this.portalConfig.server.tls) {
      const options = {
        key: fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.apikey)),
        cert: fs.readFileSync(path.join('./certificates', _this.portalConfig.tls.apicert)),
      };
      logger.debug('Server', 'Website', 'Enabling TLS/SSL encryption on API endpoints');
      this.server = https.createServer(options, app);
    } else {
      this.server = http.createServer(app);
    }
  };

  // Start Worker Capabilities
  this.setupServer = function(callback) {
    _this.buildServer();
    _this.server.listen(_this.portalConfig.server.port, _this.portalConfig.server.host, () => {
      logger.debug('Server', 'Website',
        `Website started on ${ _this.portalConfig.server.host }:${ _this.portalConfig.server.port}`);
      callback();
    });
  };
};

module.exports = PoolServer;
