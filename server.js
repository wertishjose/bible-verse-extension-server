'use strict';

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const E164_PHONE = /^\+[1-9]\d{7,14}$/;

function requiredEnv(name, env = process.env) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Missing required environment variable: ' + name);
  }
  return value.trim();
}

function positiveInteger(name, fallback, env = process.env) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(name + ' must be a positive integer');
  }
  return parsed;
}

function getConfig(env = process.env) {
  const allowedOrigins = requiredEnv('ALLOWED_ORIGINS', env)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const allowedRecipients = new Set(
    requiredEnv('ALLOWED_RECIPIENTS', env)
      .split(',')
      .map((number) => number.trim())
      .filter((number) => E164_PHONE.test(number))
  );

  if (allowedOrigins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must contain at least one origin');
  }

  if (allowedRecipients.size === 0) {
    throw new Error('ALLOWED_RECIPIENTS must contain E.164 phone numbers');
  }

  const apiKey = requiredEnv('VERSE_API_KEY', env);
  if (apiKey.length < 32) {
    throw new Error('VERSE_API_KEY must be at least 32 characters');
  }

  return {
    accountSid: requiredEnv('TWILIO_ACCOUNT_SID', env),
    authToken: requiredEnv('TWILIO_AUTH_TOKEN', env),
    fromNumber: requiredEnv('TWILIO_PHONE_NUMBER', env),
    apiKey,
    allowedOrigins: new Set(allowedOrigins),
    allowedRecipients,
    requestWindowMs: positiveInteger('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, env),
    requestMax: positiveInteger('RATE_LIMIT_MAX_REQUESTS', 10, env),
    recipientMax: positiveInteger('RECIPIENT_RATE_LIMIT_MAX', 3, env),
    globalDailyMax: positiveInteger('GLOBAL_DAILY_SEND_LIMIT', 25, env)
  };
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(left || '');
  const rightBuffer = Buffer.from(right || '');

  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function clientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function createRateLimiter({ windowMs, max, key }) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = key(req);
    const entry = buckets.get(bucketKey);

    if (!entry || now - entry.startedAt >= windowMs) {
      buckets.set(bucketKey, { startedAt: now, count: 1 });
      return next();
    }

    if (entry.count >= max) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests. Please try again later.'
      });
    }

    entry.count += 1;
    return next();
  };
}

function requireBearerToken(apiKey) {
  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const match = /^Bearer (.+)$/.exec(authorization);

    if (!match || !constantTimeEquals(match[1], apiKey)) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized'
      });
    }

    return next();
  };
}

function validateSendRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('JSON object required');
  }

  if (typeof body.verse !== 'string') {
    throw new Error('Verse must be a string');
  }

  if (typeof body.phoneNumber !== 'string') {
    throw new Error('Phone number must be a string');
  }

  const verse = body.verse.trim().replace(/\s+/g, ' ');
  const phoneNumber = body.phoneNumber.trim();

  if (verse.length === 0 || verse.length > 600) {
    throw new Error('Verse must contain between 1 and 600 characters');
  }

  if (!E164_PHONE.test(phoneNumber)) {
    throw new Error('Phone number must use E.164 format');
  }

  return { verse, phoneNumber };
}

function createApp({ config = getConfig(), twilioClient } = {}) {
  const app = express();
  const client = twilioClient || twilio(config.accountSid, config.authToken);

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.has(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed'));
    },
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600,
    optionsSuccessStatus: 204
  }));

  app.use(express.json({ limit: '16kb', strict: true }));

  const requestLimiter = createRateLimiter({
    windowMs: config.requestWindowMs,
    max: config.requestMax,
    key: (req) => 'ip:' + clientIp(req)
  });

  const recipientLimiter = createRateLimiter({
    windowMs: config.requestWindowMs,
    max: config.recipientMax,
    key: (req) => 'recipient:' + req.body.phoneNumber
  });

  const globalLimiter = createRateLimiter({
    windowMs: 24 * 60 * 60 * 1000,
    max: config.globalDailyMax,
    key: () => 'global'
  });

  app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post(
    '/send-verse',
    requestLimiter,
    requireBearerToken(config.apiKey),
    (req, res, next) => {
      if (!req.is('application/json')) {
        return res.status(415).json({
          success: false,
          error: 'Content-Type must be application/json'
        });
      }
      return next();
    },
    (req, res, next) => {
      try {
        req.validatedBody = validateSendRequest(req.body);
        return next();
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: error.message
        });
      }
    },
    (req, res, next) => {
      if (!config.allowedRecipients.has(req.validatedBody.phoneNumber)) {
        return res.status(403).json({
          success: false,
          error: 'Recipient is not authorized'
        });
      }
      return next();
    },
    recipientLimiter,
    globalLimiter,
    async (req, res) => {
      try {
        await client.messages.create({
          body: req.validatedBody.verse,
          from: config.fromNumber,
          to: req.validatedBody.phoneNumber
        });

        return res.status(202).json({ success: true });
      } catch (error) {
        console.error('SMS delivery failed', { code: error.code || 'unknown' });
        return res.status(502).json({
          success: false,
          error: 'Unable to send verse at this time'
        });
      }
    }
  );

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({
        success: false,
        error: 'Malformed JSON'
      });
    }

    if (error.message === 'Origin not allowed') {
      return res.status(403).json({
        success: false,
        error: 'Origin not allowed'
      });
    }

    return next(error);
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = positiveInteger('PORT', 3000);

  app.listen(port, () => {
    console.log('Bible verse server listening on port ' + port);
  });
}

module.exports = {
  createApp,
  getConfig,
  validateSendRequest
};
