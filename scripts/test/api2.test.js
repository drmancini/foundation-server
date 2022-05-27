/*
 *
 * API (Updated)
 *
 */

const redis = require('redis-mock');
jest.mock('redis', () => jest.requireActual('redis-mock'));

const sequelizeMock = require('sequelize-mock');
jest.mock('sequelize', () => jest.requireActual('sequelize-mock'));
jest.mock('../../models/payments.model', () => jest.requireActual('../../models/payments.mock'));
const sequelize = new sequelizeMock();

const events = require('events');
const poolConfig = require('../../configs/pools/example.js');
const portalConfig = require('../../configs/main/example.js');
const PoolApi = require('../main/api2');
const { primary } = require('../../configs/pools/example.js');

const client = redis.createClient({
  'port': portalConfig.redis.port,
  'host': portalConfig.redis.host,
});
client._maxListeners = 0;
client._redisMock._maxListeners = 0;
const poolConfigs = { Pool1: poolConfig };

////////////////////////////////////////////////////////////////////////////////

function mockRequest(params, query, body, socket) {
  return {
    params: params,
    query: query,
    body: body,
    socket: socket
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
  });

  test('Test unknown Pool API endpoint', (done) => {
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(404);
      expect(processed.body).toBe('The requested pool was not found. Verify your input and try again');
      done();
    });
    mockSetupClient(client, [], 'Pool1', () => {
      const params = {
        pool: 'Pool2',
        type: null,
        endpoint: null
      };
      const request = mockRequest(params, null, null, null);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test /miner with ./unknown API endpoint [1]', (done) => {
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(405);
      expect(processed.body).toBe('The requested endpoint does not exist. Verify your input and try again');
      done();
    });
    mockSetupClient(client, [], 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'miner',
        endpoint: 'unknown'
      };
      const query = {
        blockType: null,
        isSolo: null,
        address: null,
        worker: null,
        page: null
      };
      const body = {
        body: null
      };
      const socket = {
        remoteAddress: null
      };
      const request = mockRequest(params, query, body, socket);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test /unknown API endpoint [2]', (done) => {
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(405);
      expect(processed.body).toBe('The requested endpoint does not exist. Verify your input and try again');
      done();
    });
    mockSetupClient(client, [], 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'unknown',
        endpoint: 'unknown'
      };
      const query = {
        blockType: null,
        isSolo: null,
        address: null,
        worker: null,
        page: null
      };
      const body = {
        body: null
      };
      const socket = {
        remoteAddress: null
      };
      const request = mockRequest(params, query, body, socket);
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
      const params = {
        pool: 'Pool2',
        type: null,
        endpoint: null
      };
      const query = {
        blockType: null,
        isSolo: null,
        address: null,
        worker: null,
        page: null
      };
      const body = {
        body: null
      };
      const socket = {
        remoteAddress: null
      };
      const request = mockRequest(params, query, body, socket);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test /miner/blocks API endpoint', (done) => {
    const commands = [
      ['sadd', 'Pool1:blocks:primary:confirmed', mockBuildBlock(180, 'hash', 12.5, 'txid', 1, 'worker', false)],
      ['sadd', 'Pool1:blocks:primary:confirmed', mockBuildBlock(181, 'hash', 12.6, 'txid', 2, 'worker2', false)],
      ['sadd', 'Pool1:blocks:primary:kicked', mockBuildBlock(182, 'hash', 12.7, 'txid', 3, 'worker', false)],
      ['sadd', 'Pool1:blocks:primary:kicked', mockBuildBlock(183, 'hash', 12.8, 'txid', 4, 'worker2', false)],
      ['sadd', 'Pool1:blocks:primary:pending', mockBuildBlock(184, 'hash', 12.9, 'txid', 5, 'worker', false)],
      ['sadd', 'Pool1:blocks:primary:pending', mockBuildBlock(185, 'hash', 12.0, 'txid', 6, 'worker2', false)],
      ['hset', 'Pool1:statistics:primary:network', 'height', JSON.stringify(200)],
    ];
    const response = mockResponse();
    const expected = [{"difficulty": 5, "hash": "hash", "height": 184, "miner": "worker", "pending": true, "reward": 12.9, "solo": false, "transaction": "txid", "type": "block"}, {"difficulty": 3, "hash": "hash", "height": 182, "miner": "worker", "pending": false, "reward": 12.7, "solo": false, "transaction": "txid", "type": "orphan"}, {"difficulty": 1, "hash": "hash", "height": 180, "miner": "worker", "pending": false, "reward": 12.5, "solo": false, "transaction": "txid", "type": "block"}];
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(200);
      expect(typeof processed.body).toBe('object');
      expect(Object.keys(processed.body).length).toBe(1);      
      expect(processed.body.result.data).toStrictEqual(expected);
      expect(processed.body.result.totalItems).toBe(3);
      expect(processed.body.result.totalPages).toBe(1);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'miner',
        endpoint: 'blocks'
      };
      const query = {
        blockType: 'primary',
        isSolo: null,
        address: 'worker',
        worker: null,
        page: null
      };
      const body = {
        body: null
      };
      const socket = {
        remoteAddress: null
      };
      const request = mockRequest(params, query, body, socket);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /miner/chart API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'miner',
        endpoint: 'chart'
      };
      const query = {
        blockType: 'primary',
        isSolo: false,
        address: null,
        worker: null,
        page: null
      };
      const body = {
        body: null
      };
      const socket = {
        remoteAddress: null
      };
      const request = mockRequest(params, query, body, socket);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /miner/details API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'miner',
        endpoint: 'detaile'
      };
      const query = {
        blockType: 'primary',
        isSolo: false,
        address: null,
        worker: 'worker',
        page: null
      };
      const body = {
        body: null
      };
      const socket = {
        remoteAddress: null
      };
      const request = mockRequest(params, query, body, socket);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /miner/payments API endpoint', (done) => {
    const commands = [
    ];
    const mockPayments = sequelize.define('payments', {
      'pool': 'Pool1',
      'time': 123,
      'paid': 123,
      'transaction': 'txid1',
      'miner': 'mier1'
    });
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'miner',
        endpoint: 'payments'
      };
      const query = {
        blockType: null,
        isSolo: false,
        address: 'worker',
        worker: null,
        page: 0
      };
      const body = {
        body: null
      };
      const socket = {
        remoteAddress: null
      };
      const request = mockRequest(params, query, body, socket);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /miner/payoutSettings API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'miner',
        endpoint: 'payoutSettings'
      };
      const query = {
        blockType: 'primary',
        isSolo: false,
        address: null,
        worker: null,
        page: null
      };
      const body = {
        payoutLimit: 100,
        address: 'worker',
        ipAddress: '1.1.1.1'
      };
      const socket = {
        remoteAddress: null
      };
      const request = mockRequest(params, query, body, socket);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /miner/paymentStats API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'miner',
        endpoint: 'paymentStats'
      };
      const query = {
        blockType: 'primary',
        isSolo: false,
        address: null,
        worker: null,
        page: null
      };
      const body = {
        body: null
      };
      const socket = {
        remoteAddress: null
      };
      const request = mockRequest(params, query, body, socket);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /miner/stats API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'miner',
        endpoint: 'stats'
      };
      const query = {
        blockType: null,
        isSolo: false,
        address: 'worker',
        worker: null,
        page: null
      };
      const body = {
        payoutLimit: 100,
        address: 'worker',
        ipAddress: '1.1.1.1'
      };
      const socket = {
        remoteAddress: null
      };
      const request = mockRequest(params, query, body, socket);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /miner/workers API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'miner', 'workers', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /miner/workerCount API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'miner', 'workerCount', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });
  
  // unfinished
  test('Test /pool/averageLuck API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'pool', 'averageLuck', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /pool/blocks API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'pool', 'blocks', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /pool/coin API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'pool', 'coin', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /pool/clientIP API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'pool', 'clientIP', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /pool/currentLuck API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'pool', 'currentLuck', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /pool/hashrate API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'pool', 'hashrate', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test /pool/hashrateChart API endpoint', (done) => {
    const dateNow = Date.now();
    const commands = [
      ['zadd', 'Pool1:statistics:primary:historical', 1, JSON.stringify({ time: 1,  hashrate: { shared: [{ identifier: 'a', hashrate: 1 }, { identifier: 'b', hashrate: 2 }] } })],
      ['zadd', 'Pool1:statistics:primary:historical', dateNow / 1000 - 30 * 60 | 0, JSON.stringify({ time: dateNow - 30 * 60 * 1000, hashrate: { shared: [{ identifier: 'a', hashrate: 1 }, { identifier: 'b', hashrate: 2 }] } })],
      ['zadd', 'Pool1:statistics:primary:historical', dateNow / 1000 - 20 * 60 | 0, JSON.stringify({ time: dateNow - 20 * 60 * 1000, hashrate: { shared: [{ identifier: 'a', hashrate: 3 }, { identifier: 'b', hashrate: 4 }] } })],
      ['zadd', 'Pool1:statistics:primary:historical', dateNow / 1000 - 40 * 60 | 0, JSON.stringify({ time: dateNow - 40 * 60 * 1000, hashrate: { shared: [{ identifier: 'a', hashrate: 5 }, { identifier: 'b', hashrate: 6 }] } })],
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(Object.keys(processed.body[0]).length).toBe(3);
      expect(processed.body.length).toBe(3);
      expect(processed.body[2].region.b).toBe(4);
      expect(processed.body[0].total).toBe(11);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'pool',
        endpoint: 'hashrateChart'
      };
      const query = {
        blockType: 'primary',
      };
      const request = mockRequest(params, query, null, null);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test /pool/minerCount API endpoint', (done) => {
    const commands = [
      ['hset', 'Pool1:workers:primary:shared', 'worker1', JSON.stringify({ worker: 'worker1', time: 9999999999 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker2.one', JSON.stringify({ worker: 'worker2.one', time: 9999999999 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker3.one', JSON.stringify({ worker: 'worker3.one', time: 9999999999 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker3.two', JSON.stringify({ worker: 'worker3.two',time: 9999999999 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker3.three', JSON.stringify({ worker: 'worker3.three',time: 1 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker4', JSON.stringify({ worker: 'worker4', time: 1 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker5.one', JSON.stringify({ worker: 'worker5.one', time: 1 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker6.one', JSON.stringify({ worker: 'worker6.one', time: 1 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker6.two', JSON.stringify({ worker: 'worker6.two',time: 1 })],
    ];
    const response = mockResponse();
    const expected = {
      'result': 3,
    };
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(200);
      expect(typeof processed.body).toBe('object');
      expect(processed.body).toStrictEqual(expected);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'pool',
        endpoint: 'minerCount'
      };
      const query = {
        blockType: 'primary',
        isSolo: false,
      };
      const request = mockRequest(params, query, null, null);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  // unfinished
  test('Test /pool/topMiners API endpoint', (done) => {
    const commands = [
    ];
    const response = mockResponse();
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      //(pool, type, endpoint, blockType, isSolo, address, worker, page)
      const request = mockRequest('Pool1', 'pool', 'topMiners', null, false, 'worker', null, 0);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });

  test('Test /pool/workerCount API endpoint', (done) => {
    const commands = [
      ['hset', 'Pool1:workers:primary:shared', 'worker1', JSON.stringify({ worker: 'worker1', time: 9999999999 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker2.one', JSON.stringify({ worker: 'worker2.one', time: 9999999999 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker3.one', JSON.stringify({ worker: 'worker3.one', time: 9999999999 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker3.two', JSON.stringify({ worker: 'worker3.two',time: 9999999999 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker3.three', JSON.stringify({ worker: 'worker3.three',time: 1 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker4', JSON.stringify({ worker: 'worker4', time: 1 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker5.one', JSON.stringify({ worker: 'worker5.one', time: 1 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker6.one', JSON.stringify({ worker: 'worker6.one', time: 1 })],
      ['hset', 'Pool1:workers:primary:shared', 'worker6.two', JSON.stringify({ worker: 'worker6.two',time: 1 })],
    ];
    const response = mockResponse();
    const expected = {
      'result': 4,
    };
    response.on('end', (payload) => {
      const processed = JSON.parse(payload);
      expect(processed.statusCode).toBe(200);
      expect(typeof processed.body).toBe('object');
      expect(processed.body).toStrictEqual(expected);
      done();
    });
    mockSetupClient(client, commands, 'Pool1', () => {
      const params = {
        pool: 'Pool1',
        type: 'pool',
        endpoint: 'workerCount'
      };
      const query = {
        blockType: 'primary',
        isSolo: false,
      };
      const request = mockRequest(params, query, null, null);
      const poolApi = new PoolApi(client, sequelize, poolConfigs, portalConfig);
      poolApi.handleApiV2(request, (code, message) => {
        poolApi.buildResponse(code, message, response);
      });
    });
  });
});
