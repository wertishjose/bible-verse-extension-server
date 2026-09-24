const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

const { createApp } = require('../server');

const API_KEY = 'a'.repeat(40);
const RECIPIENT = '+15551234567';

function makeConfig(overrides = {}) {
  return {
    accountSid: 'ACtest',
    authToken: 'test-token',
    fromNumber: '+15557654321',
    apiKey: API_KEY,
    allowedOrigins: new Set(['chrome-extension://test-extension']),
    allowedRecipients: new Set([RECIPIENT]),
    requestWindowMs: 60 * 1000,
    requestMax: 10,
    recipientMax: 2,
    globalDailyMax: 10,
    ...overrides
  };
}

async function startServer(configOverrides = {}) {
  const sent = [];
  const app = createApp({
    config: makeConfig(configOverrides),
    twilioClient: {
      messages: {
        create: async (message) => {
          sent.push(message);
          return { sid: 'SMtest' };
        }
      }
    }
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, sent };
}

function request(server, options = {}) {
  const body = options.body === undefined
    ? undefined
    : (typeof options.body === 'string' ? options.body : JSON.stringify(options.body));

  const headers = { ...options.headers };
  if (body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (body !== undefined) {
    headers['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: options.path || '/send-verse',
      method: options.method || 'POST',
      headers
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: responseBody ? JSON.parse(responseBody) : undefined
        });
      });
    });

    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function authorizedHeaders() {
  return { Authorization: 'Bearer ' + API_KEY };
}

test('rejects unauthenticated SMS requests', async (t) => {
  const { server, sent } = await startServer();
  t.after(() => server.close());

  const response = await request(server, {
    body: { verse: 'John 3:16', phoneNumber: RECIPIENT }
  });

  assert.equal(response.status, 401);
  assert.equal(sent.length, 0);
});

test('rejects malformed and unapproved requests', async (t) => {
  const { server, sent } = await startServer();
  t.after(() => server.close());

  const malformed = await request(server, {
    headers: authorizedHeaders(),
    body: { verse: 42, phoneNumber: RECIPIENT }
  });
  assert.equal(malformed.status, 400);

  const unapproved = await request(server, {
    headers: authorizedHeaders(),
    body: { verse: 'John 3:16', phoneNumber: '+15550000000' }
  });
  assert.equal(unapproved.status, 403);
  assert.equal(sent.length, 0);
});

test('accepts an authorized allowed SMS request', async (t) => {
  const { server, sent } = await startServer();
  t.after(() => server.close());

  const response = await request(server, {
    headers: authorizedHeaders(),
    body: { verse: 'John 3:16', phoneNumber: RECIPIENT }
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.success, true);
  assert.deepEqual(sent, [{
    body: 'John 3:16',
    from: '+15557654321',
    to: RECIPIENT
  }]);
});

test('rate limits repeated SMS requests', async (t) => {
  const { server, sent } = await startServer();
  t.after(() => server.close());

  const options = {
    headers: authorizedHeaders(),
    body: { verse: 'John 3:16', phoneNumber: RECIPIENT }
  };

  assert.equal((await request(server, options)).status, 202);
  assert.equal((await request(server, options)).status, 202);
  assert.equal((await request(server, options)).status, 429);
  assert.equal(sent.length, 2);
});

test('does not retain the insecure verification route', async (t) => {
  const { server } = await startServer();
  t.after(() => server.close());

  const response = await request(server, {
    path: '/verify',
    headers: authorizedHeaders(),
    body: { userId: 'attacker-controlled' }
  });

  assert.equal(response.status, 404);
});

test('blocks requests from an unapproved browser origin', async (t) => {
  const { server, sent } = await startServer();
  t.after(() => server.close());

  const response = await request(server, {
    headers: {
      ...authorizedHeaders(),
      Origin: 'https://untrusted.example'
    },
    body: { verse: 'John 3:16', phoneNumber: RECIPIENT }
  });

  assert.equal(response.status, 403);
  assert.equal(sent.length, 0);
});
