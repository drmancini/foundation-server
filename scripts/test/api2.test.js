/*
 *
 * API (Updated)
 *
 */

const redis = require('redis-mock');
jest.mock('redis', () => jest.requireActual('redis-mock'));

const sequelizeMock = require('sequelize-mock');
const sequelize = new sequelizeMock();

const events = require('events');
const poolConfig = require('../../configs/pools/example.js');
const portalConfig = require('../../configs/main/example.js');
const PoolApi = require('../main/api2');

const client = redis.createClient({
  'port': portalConfig.redis.port,
  'host': portalConfig.redis.host,
});
client._maxListeners = 0;
client._redisMock._maxListeners = 0;
const poolConfigs = { Pool1: poolConfig };

////////////////////////////////////////////////////////////////////////////////

function mockRequest(pool, type, endpoint, blockType, isSolo, address, worker, page) {
  return {
    params: { pool: pool, type: type, endpoint: endpoint },
    query: { blockType: blockType, isSolo: isSolo, address: address, worker: worker, page: page] }
  };
}

function mockResponse() {
  const response = new events.EventEmitter();
  response.writeHead = (code, headers) => {
    response.emit('header', [code, headers]);
  };
  response.end = (payload) => response.emit('end', payload);
  return response;
}

function mockBuildBlock(height, hash, reward, transaction, difficulty, worker, solo) {
  return JSON.stringify({
    height: height,
    hash: hash,
    reward: reward,
    transaction: transaction,
    difficulty: difficulty,
    worker: worker,
    solo: solo
  });
}

function mockSetupClient(client, commands, pool, callback) {
  client.multi(commands).exec(() => callback());
}

////////////////////////////////////////////////////////////////////////////////

describe('Test API functionality', () => {

  beforeEach((done) => {
    client.flushall(() => done());
  });

  test('Test initialization of API', () => {
    const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
    expect(typeof poolApi.handleApiV3).toBe('function');
    expect(typeof poolApi.handleApiV2).toBe('function');
  });

  test('Test unknownPool API endpoint', (done) => {
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(404);
      expect(processed.body).toBe('The requested pool was not found. Verify your input and try again');
      done();
    });
    mockSetupClient(client, [], 'Pool1', () => {
      const request = mockRequest();
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test unknownMethod API endpoint [1]', (done) => {
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(405);
      expect(processed.body).toBe('The requested endpoint does not exist. Verify your input and try again');
      done();
    });
    mockSetupClient(client, [], 'Pool1', () => {
      const request = mockRequest('Pool1', 'unknown', 'unknown', null, null, null, null, null);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test unknownMethod API endpoint [2]', (done) => {
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(405);
      expect(processed.body).toBe('The requested endpoint does not exist. Verify your input and try again');
      done();
    });
    mockSetupClient(client, [], 'Pool1', () => {
      const request = mockRequest('Pool1', 'miner', 'unknown', null, null, null, null, null);
      const poolConfigsCopy = JSON.parse(JSON.stringify(poolConfigs));
      const poolApi = new PoolApi(client, sequelize, poolConfigsCopy, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test request without parameters', (done) => {
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(404);
      expect(processed.body).toBe('The requested pool was not found. Verify your input and try again');
      done();
    });
    mockSetupClient(client, [], 'Pool1', () => {
      const request = mockRequest('Pool2', null, null, null, null, null, null, null);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test minerBlocks API endpoint', (done) => {
    const commands = [
      ['sadd', 'Pool1:blocks:primary:confirmed', mockBuildBlock(180, 'hash', 12.5, 'txid', 8, 'worker', false)],
      ['sadd', 'Pool1:blocks:primary:kicked', mockBuildBlock(181, 'hash', 12.5, 'txid', 8, 'worker', false)],
      ['sadd', 'Pool1:blocks:primary:pending', mockBuildBlock(182, 'hash', 12.5, 'txid', 8, 'worker', false)],
      ['hset', 'Pool1:statistics:primary:network', 'height', JSON.stringify(123)],
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(200);
      expect(Object.keys(processed.body).length).toBe(1);
      expect(processed.body.result.data.length).toBe(3);
      expect(processed.body.result.data[0].height).toBe(182);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const request = mockRequest('Pool1', 'miner', 'blocks', 'primary', false, 'worker', null, null);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test minerChart API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const request = mockRequest('Pool1', 'miner', 'chart', 'primary', false, null, null, null);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test minerDetails API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const request = mockRequest('Pool1', 'miner', 'details', 'primary', false, 'worker', null, null);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test minerPayments API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'miner', 'payments', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test minerPayoutSettings API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'miner', 'payoutSettings', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

});
