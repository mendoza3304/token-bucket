# token-bucket

Bursty rate limiting for JavaScript. A leaky-bucket-style limiter that refills tokens monotonically based on a clock you control.

## Usage

```js
import { TokenBucket } from 'token-bucket';

const bucket = new TokenBucket({
  capacity: 10,       // max tokens held at once (burst size)
  refillRate: 2,      // tokens added per millisecond
  clock: Date.now,    // any () => number returning current time
});

const result = bucket.tryConsume(3);
// { ok: true, remaining: 7, deficit: 0 }

if (!result.ok) {
  const wait = bucket.timeUntilAvailable(3);
  // milliseconds until the request can be satisfied
}
```

Exported names: `TokenBucket` (class). Methods: `tryConsume(cost = 1)` returning `{ ok, remaining, deficit }`, `timeUntilAvailable(cost = 1)` returning a number (or `Infinity`), and `tokens` / `capacity` / `refillRate` getters.

## Why

Most rate limiters either give you a flat "N per second" with no bursting, or a sliding window that needs to remember every event. A token bucket splits the difference: steady long-term rate, bounded short-term burst, constant memory, O(1) per call.

The deliberate trade-off here is determinism over real-time accuracy. The clock is a constructor argument so tests can drive refill math exactly. If you pass `Date.now`, you get wall-clock behavior; if you pass a fake, you get reproducible results. This means the library never sleeps or measures elapsed time itself — it trusts whatever the clock returns, including (deliberately) a clock that jumps backwards, which is treated as zero elapsed time so no tokens are granted.

## Awkward edges

- **Zero refill rate** is allowed (a pure "budget" bucket that never refills). `timeUntilAvailable` returns `Infinity` in that case when tokens are insufficient — handle it before waiting.
- **Cost above capacity** also returns `Infinity` from `timeUntilAvailable`; the bucket can never hold that many tokens at once.
- **Clock units are your problem.** If your clock returns milliseconds and you set `refillRate` to `0.001`, you get one token per second. The library does not assume or convert units.
- **Clock skew backwards** does not refill the bucket. This is intentional: better to under-serve than to hand out tokens due to NTP drift.
