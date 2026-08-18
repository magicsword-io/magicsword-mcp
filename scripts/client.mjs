import { createServer } from 'node:http';
import { once } from 'node:events';
import { MagicSwordApiError, MagicSwordClient, MagicSwordTransportError } from '../dist/client.js';
import { isValidMagicSwordApiKey, normalizeBaseUrl } from '../dist/config.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectReject(promise, ErrorClass, message) {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof ErrorClass, `${message}: received ${error?.constructor?.name ?? typeof error}`);
    return error;
  }
  throw new Error(`${message}: request unexpectedly succeeded`);
}

assert(
  normalizeBaseUrl('https://www.magicsword.io/') === 'https://www.magicsword.io',
  'HTTPS origin normalization failed',
);
assert(normalizeBaseUrl('http://127.0.0.1:3210') === 'http://127.0.0.1:3210', 'localhost HTTP should be allowed');
for (const rejected of [
  'http://example.com',
  'https://user:pass@example.com',
  'https://example.com/api',
  'https://example.com/?token=secret',
]) {
  let didReject = false;
  try {
    normalizeBaseUrl(rejected);
  } catch {
    didReject = true;
  }
  assert(didReject, `unsafe base URL was accepted: ${rejected}`);
}
assert(isValidMagicSwordApiKey('msk_test_smoke_1234567890'), 'valid API key was rejected');
assert(!isValidMagicSwordApiKey('msk_...'), 'placeholder API key was accepted');

const counts = new Map();
let observedAuthorization = '';
const server = createServer((request, response) => {
  const mode = request.headers['user-agent'] ?? 'unknown';
  counts.set(mode, (counts.get(mode) ?? 0) + 1);
  observedAuthorization = request.headers.authorization ?? '';
  response.setHeader('content-type', 'application/json');

  if (mode === 'retry') {
    if (counts.get(mode) === 1) {
      response.statusCode = 503;
      response.setHeader('retry-after', '0');
      response.end(JSON.stringify({ error: 'temporary' }));
      return;
    }
    response.end(
      JSON.stringify({
        org: { id: '00000000-0000-4000-8000-000000000001' },
        key_id: 'key',
        scopes: [],
      }),
    );
    return;
  }
  if (mode === 'post') {
    response.statusCode = 503;
    response.end(JSON.stringify({ error: 'do not retry writes' }));
    return;
  }
  if (mode === 'large') {
    response.end(
      JSON.stringify({
        endpoints: [],
        total: 0,
        limit: 1,
        offset: 0,
        padding: 'x'.repeat(2_000),
      }),
    );
    return;
  }
  if (mode === 'slow') {
    setTimeout(() => {
      if (!response.destroyed) response.end(JSON.stringify({ policies: [] }));
    }, 100);
    return;
  }
  if (mode === 'invalid-json') {
    response.end('{invalid');
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'unexpected test route' }));
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not expose a TCP address');
const baseUrl = `http://127.0.0.1:${address.port}`;
const apiKey = 'msk_test_client_1234567890';

try {
  const retryClient = new MagicSwordClient({
    baseUrl,
    apiKey,
    userAgent: 'retry',
    getRetries: 2,
    retryBaseDelayMs: 1,
  });
  await retryClient.me();
  assert(counts.get('retry') === 2, `GET retry count was ${counts.get('retry')}`);
  assert(observedAuthorization === `Bearer ${apiKey}`, 'API authorization header was not sent');

  const postClient = new MagicSwordClient({
    baseUrl,
    apiKey,
    userAgent: 'post',
    getRetries: 3,
    retryBaseDelayMs: 1,
  });
  await expectReject(postClient.mintEnrollmentToken(), MagicSwordApiError, 'POST 503 handling');
  assert(counts.get('post') === 1, `write request was retried ${counts.get('post')} times`);

  const largeClient = new MagicSwordClient({
    baseUrl,
    apiKey,
    userAgent: 'large',
    responseMaxBytes: 256,
    getRetries: 0,
  });
  await expectReject(largeClient.endpoints(), MagicSwordTransportError, 'oversized response handling');

  const slowClient = new MagicSwordClient({
    baseUrl,
    apiKey,
    userAgent: 'slow',
    requestTimeoutMs: 20,
    getRetries: 1,
    retryBaseDelayMs: 1,
  });
  const timeoutError = await expectReject(slowClient.policies(), MagicSwordTransportError, 'timeout handling');
  assert((counts.get('slow') ?? 0) >= 1, 'timed-out GET did not reach the test server');
  assert(!timeoutError.message.includes(apiKey), 'transport error exposed the API key');

  const invalidClient = new MagicSwordClient({
    baseUrl,
    apiKey,
    userAgent: 'invalid-json',
    getRetries: 0,
  });
  await expectReject(invalidClient.policies(), MagicSwordTransportError, 'invalid JSON handling');
} finally {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
}

console.log('MCP client transport checks passed');
