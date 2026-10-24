import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyOrigin } from './native-task-smoke.mjs';

test('native smoke keeps approved public origins separate from explicit local fixtures', () => {
  assert.equal(classifyOrigin('https://emerald-pham.github.io/funsidething/', 'online').kind, 'public');
  assert.equal(classifyOrigin('https://chain-scanner.web.app/', 'offline').kind, 'public');
  assert.equal(classifyOrigin('http://127.0.0.1:6063', 'local-fixture').kind, 'local-fixture');
  assert.equal(classifyOrigin('http://127.0.0.1:6063/', 'local-fixture').kind, 'local-fixture');
});

test('native smoke refuses origins outside the exact public and literal loopback boundaries', () => {
  for (const origin of [
    'http://localhost:6063',
    'http://127.0.0.1',
    'http://127.0.0.1:6063/path',
    'http://user@127.0.0.1:6063',
    'http://127.0.0.1:6063?fixture=1',
    'http://127.0.0.1:6063#fixture',
    'http://127.0.0.2:6063',
    'https://127.0.0.1:6063',
    'https://unapproved.example/',
  ]) {
    assert.throws(() => classifyOrigin(origin, 'local-fixture'), undefined, 'refuses ' + origin);
  }
  assert.throws(() => classifyOrigin('http://127.0.0.1:6063', 'online'));
  assert.throws(() => classifyOrigin('https://unapproved.example/', 'offline'));
});
