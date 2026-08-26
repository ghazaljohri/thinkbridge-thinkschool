// Characterization test for the real Week-1 API (QuotesApi).
//
// This is deliberately NOT an Angular/Vitest spec run through HttpTestingController
// mocks - it makes real network calls with the platform `fetch`, against a real
// running instance of QuotesApi, before any interceptor/UI code exists. Its job is
// to pin down what the API actually does, so the HttpClient interceptors built
// afterwards (auth header, retry, ProblemDetails -> AppError mapping) are built
// against confirmed behavior instead of a guess about what "a REST API" usually does.
//
// Run with: QuotesApi running on http://localhost:5058 (dotnet run in QuotesApi/),
// then `npm run test:contract` from quotes-web/.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.QUOTES_API_URL ?? 'http://localhost:5058';

test('GET /api/quotes?page=1&size=5 returns the real paged shape', async () => {
  const res = await fetch(`${BASE_URL}/api/quotes?page=1&size=5`);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');

  const body = await res.json();

  assert.equal(typeof body.page, 'number');
  assert.equal(typeof body.size, 'number');
  assert.equal(typeof body.total, 'number');
  assert.ok(Array.isArray(body.items));
  assert.equal(Object.keys(body).sort().join(','), 'items,page,size,total');

  for (const item of body.items) {
    assert.equal(typeof item.id, 'number');
    assert.equal(typeof item.author, 'string');
    assert.equal(typeof item.text, 'string');
    assert.equal(typeof item.isDeleted, 'boolean');
    assert.equal(typeof item.createdAtUtc, 'string');
    assert.equal(Object.keys(item).sort().join(','), 'author,createdAtUtc,id,isDeleted,text');
  }
});

test('an invalid page on that same endpoint comes back as a real ValidationProblemDetails', async () => {
  const res = await fetch(`${BASE_URL}/api/quotes?page=0&size=5`);

  assert.equal(res.status, 400);
  assert.equal(res.headers.get('content-type'), 'application/problem+json');

  const body = await res.json();

  assert.equal(body.status, 400);
  assert.equal(typeof body.title, 'string');
  assert.ok(body.errors && typeof body.errors === 'object');
  assert.ok(Array.isArray(body.errors.page));
  assert.match(body.errors.page[0], /at least 1/i);

  // The untouched `size` field is still a key in `errors`, just with an
  // empty array - the API doesn't omit passing fields. An app error mapper
  // that assumes every key in `errors` has a message would break on this.
  assert.deepEqual(body.errors.size, []);
});

test('an unauthenticated write comes back 401 with an EMPTY body, not ProblemDetails', async () => {
  const res = await fetch(`${BASE_URL}/api/quotes/1`, { method: 'DELETE' });

  assert.equal(res.status, 401);
  assert.equal(res.headers.get('www-authenticate'), 'Bearer');

  const text = await res.text();
  assert.equal(text, '');

  // Confirmed live, not assumed: in this API only the 400 ValidationProblem
  // path returns a JSON body. 401 does not. An interceptor that assumes
  // every 4xx has `error.error.title` to read a friendly message from will
  // either throw trying to parse nothing, or silently show "undefined".
});

test('a missing quote comes back 404 with an EMPTY body too', async () => {
  const res = await fetch(`${BASE_URL}/api/quotes/999999`);

  assert.equal(res.status, 404);
  const text = await res.text();
  assert.equal(text, '');
});
