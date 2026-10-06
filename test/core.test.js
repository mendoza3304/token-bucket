import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from '../src/index.js';

// A controllable clock: returns `t`, advancing only when set.
function fakeClock(start = 0) {
  let t = start;
  return () => t; // closure captures `t`; setter below mutates it.
}

// Convenience: clock with an explicit setter for readability in tests.
function steppedClock(start = 0) {
  let t = start;
  const fn = () => t;
  fn.advance = (dt) => { t += dt; return t; };
  fn.set = (v) => { t = v; return t; };
  fn.now = () => t;
  return fn;
}

test('constructor validates capacity', () => {
  assert.throws(() => new TokenBucket({ capacity: 0, refillRate: 1 }), RangeError);
  assert.throws(() => new TokenBucket({ capacity: -1, refillRate: 1 }), RangeError);
  assert.throws(() => new TokenBucket({ capacity: NaN, refillRate: 1 }), RangeError);
  assert.throws(() => new TokenBucket({ capacity: Infinity, refillRate: 1 }), RangeError);
});

test('constructor validates refillRate', () => {
  assert.throws(() => new TokenBucket({ capacity: 10, refillRate: -1 }), RangeError);
  assert.throws(() => new TokenBucket({ capacity: 10, refillRate: NaN }), RangeError);
  assert.throws(() => new TokenBucket({ capacity: 10, refillRate: Infinity }), RangeError);
});

test('starts full by default', () => {
  const c = steppedClock(100);
  const b = new TokenBucket({ capacity: 10, refillRate: 1, clock: c });
  assert.equal(b.tokens, 10);
  assert.equal(b.capacity, 10);
  assert.equal(b.refillRate, 1);
});

test('initialTokens caps to capacity', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 5, refillRate: 1, clock: c, initialTokens: 999 });
  assert.equal(b.tokens, 5);
});

test('initialTokens can start below capacity', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 10, refillRate: 1, clock: c, initialTokens: 3 });
  assert.equal(b.tokens, 3);
});

test('tryConsume succeeds when enough tokens', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 5, refillRate: 1, clock: c });
  const r = b.tryConsume(3);
  assert.deepEqual(r, { ok: true, remaining: 2, deficit: 0 });
});

test('tryConsume denied with correct deficit when short', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 5, refillRate: 1, clock: c, initialTokens: 2 });
  const r = b.tryConsume(5);
  assert.equal(r.ok, false);
  assert.equal(r.deficit, 3);
  assert.equal(r.remaining, 2);
});

test('tryConsume default cost is 1', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 2, refillRate: 1, clock: c });
  assert.deepEqual(b.tryConsume(), { ok: true, remaining: 1, deficit: 0 });
});

test('tryConsume(0) succeeds and reports remaining without consuming', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 5, refillRate: 1, clock: c, initialTokens: 4 });
  const r = b.tryConsume(0);
  assert.equal(r.ok, true);
  assert.equal(r.remaining, 4);
  assert.equal(r.deficit, 0);
});

test('refill prorates by elapsed time', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 10, refillRate: 2, clock: c, initialTokens: 0 });
  c.advance(3); // 3 units * 2 tokens/unit = 6
  assert.equal(b.tokens, 6);
});

test('refill clamps at capacity', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 10, refillRate: 100, clock: c, initialTokens: 5 });
  c.advance(1); // would add 100
  assert.equal(b.tokens, 10);
});

test('clock going backwards does not grant tokens', () => {
  const c = steppedClock(100);
  const b = new TokenBucket({ capacity: 10, refillRate: 1, clock: c, initialTokens: 0 });
  c.set(50); // backwards
  assert.equal(b.tokens, 0);
  c.set(52); // forward from original lastRefill (100), elapsed=0 -> stays 0
  assert.equal(b.tokens, 0);
});

test('zero refillRate freezes tokens indefinitely', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 5, refillRate: 0, clock: c, initialTokens: 3 });
  c.advance(1000);
  assert.equal(b.tokens, 3);
  const r = b.tryConsume(4);
  assert.equal(r.ok, false);
  assert.equal(r.deficit, 1);
});

test('timeUntilAvailable returns 0 when already enough', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 10, refillRate: 1, clock: c, initialTokens: 5 });
  assert.equal(b.timeUntilAvailable(3), 0);
});

test('timeUntilAvailable computes needed-over-rate wait', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 10, refillRate: 2, clock: c, initialTokens: 1 });
  // need 5, have 1, deficit 4, rate 2 -> wait 2
  assert.equal(b.timeUntilAvailable(5), 2);
});

test('timeUntilAvailable is Infinity when refillRate is 0 and short', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 10, refillRate: 0, clock: c, initialTokens: 3 });
  assert.equal(b.timeUntilAvailable(4), Infinity);
});

test('timeUntilAvailable is Infinity when cost exceeds capacity', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 5, refillRate: 10, clock: c });
  assert.equal(b.timeUntilAvailable(6), Infinity);
});

test('burst then steady refill restores availability', () => {
  const c = steppedClock(0);
  const b = new TokenBucket({ capacity: 4, refillRate: 1, clock: c });
  // Burst: drain completely.
  assert.equal(b.tryConsume(4).ok, true);
  // Immediately denied for another.
  assert.equal(b.tryConsume(1).ok, false);
  // After 1 unit, exactly 1 token available.
  c.advance(1);
  assert.equal(b.tryConsume(1).ok, true);
});
