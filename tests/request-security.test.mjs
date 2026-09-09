import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOriginRequest } from '../lib/request-security.ts';

test('same-origin validation accepts Railway forwarded origin', () => {
  const request = new Request('http://0.0.0.0:8080/api/workspace', {
    method: 'POST',
    headers: {
      origin: 'https://orbita.example.com',
      host: '0.0.0.0:8080',
      'x-forwarded-host': 'orbita.example.com',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'same-origin',
    },
  });
  assert.equal(isSameOriginRequest(request), true);
});

test('same-origin validation rejects a different site', () => {
  const request = new Request('http://0.0.0.0:8080/api/workspace', {
    method: 'POST',
    headers: {
      origin: 'https://attacker.example',
      'x-forwarded-host': 'orbita.example.com',
      'x-forwarded-proto': 'https',
      'sec-fetch-site': 'cross-site',
    },
  });
  assert.equal(isSameOriginRequest(request), false);
});
