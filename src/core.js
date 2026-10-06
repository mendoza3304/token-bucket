/**
 * TokenBucket — bursty rate limiting with monotonic token refills.
 *
 * Why monotonic: tokens are refilled based on elapsed time reported by the
 * injected clock function. The caller controls the clock, which keeps the
 * algorithm deterministic and testable without sleeping.
 */

/**
 * A leaky-bucket-style rate limiter.
 *
 * The bucket holds up to `capacity` tokens. Every refill interval adds
 * `refillRate` tokens, prorated by elapsed time. Requests consume tokens;
 * when there aren't enough, the bucket reports the deficit so the caller can
 * decide whether to wait, drop, or reject.
 *
 * All time is in whatever unit the caller's `clock` returns. If clock is in
 * milliseconds, refillRate and capacity both operate in milliseconds. Be
 * consistent.
 */
export class TokenBucket {
  /**
   * @param {object} options
   * @param {number} options.capacity   Maximum tokens the bucket can hold.
   * @param {number} options.refillRate Tokens added per time unit. Prorated.
   * @param {(now?: number) => number} [options.clock]   Clock returning current time. Default: Date.now.
   * @param {number} [options.initialTokens] Starting tokens; defaults to full capacity.
   */
  constructor({ capacity, refillRate, clock, initialTokens }) {
    if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0) {
      throw new RangeError('capacity must be a positive finite number');
    }
    if (typeof refillRate !== 'number' || !Number.isFinite(refillRate) || refillRate < 0) {
      throw new RangeError('refillRate must be a non-negative finite number');
    }
    this._capacity = capacity;
    this._refillRate = refillRate;
    this._clock = typeof clock === 'function' ? clock : Date.now;
    const start =
      typeof initialTokens === 'number' && Number.isFinite(initialTokens)
        ? Math.min(initialTokens, capacity)
        : capacity;
    this._tokens = start;
    this._lastRefill = this._clock();
    if (typeof this._lastRefill !== 'number' || !Number.isFinite(this._lastRefill)) {
      throw new RangeError('clock() must return a finite number');
    }
  }

  /** Current token count (after applying pending refills). */
  get tokens() {
    this._refill();
    return this._tokens;
  }

  /** Maximum capacity. */
  get capacity() {
    return this._capacity;
  }

  /** Refill rate per time unit. */
  get refillRate() {
    return this._refillRate;
  }

  /**
   * Apply pending refill based on elapsed time since last update.
   * Idempotent and cheap if called repeatedly without time advancing.
   * @private
   */
  _refill() {
    const now = this._clock();
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      throw new RangeError('clock() must return a finite number');
    }
    // Clock going backwards means no refill (treat elapsed as 0). This avoids
    // accidentally granting tokens due to clock skew and keeps monotonic intent.
    const elapsed = now > this._lastRefill ? now - this._lastRefill : 0;
    if (elapsed > 0 && this._refillRate > 0) {
      const added = elapsed * this._refillRate;
      // Clamp to capacity so accumulated bursts can't exceed the ceiling.
      this._tokens = Math.min(this._capacity, this._tokens + added);
      this._lastRefill = now;
    } else if (elapsed > 0) {
      // Even with zero refillRate, advance the timestamp so tokens stay frozen
      // at their current value rather than retroactively accruing later.
      this._lastRefill = now;
    }
  }

  /**
   * Try to consume `cost` tokens.
   *
   * @param {number} [cost=1] Tokens to consume.
   * @returns {{ok: boolean, remaining: number, deficit: number}}
   *   - ok: true if tokens were consumed.
   *   - remaining: tokens left after the attempt (0 if denied).
   *   - deficit: tokens still needed to satisfy this request (0 if ok).
   */
  tryConsume(cost = 1) {
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
      throw new RangeError('cost must be a non-negative finite number');
    }
    if (cost === 0) {
      this._refill();
      return { ok: true, remaining: this._tokens, deficit: 0 };
    }
    this._refill();
    if (this._tokens >= cost) {
      this._tokens -= cost;
      return { ok: true, remaining: this._tokens, deficit: 0 };
    }
    return { ok: false, remaining: this._tokens, deficit: cost - this._tokens };
  }

  /**
   * Time units the caller must wait before `tryConsume(cost)` will succeed.
   * Returns 0 if tokens are already sufficient. Returns Infinity when
   * refillRate is 0 and tokens are insufficient (no way to ever catch up).
   *
   * @param {number} [cost=1]
   * @returns {number}
   */
  timeUntilAvailable(cost = 1) {
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
      throw new RangeError('cost must be a non-negative finite number');
    }
    if (cost > this._capacity) {
      // Bucket can never hold this many tokens at once.
      return Infinity;
    }
    this._refill();
    if (this._tokens >= cost) return 0;
    const needed = cost - this._tokens;
    if (this._refillRate === 0) return Infinity;
    return needed / this._refillRate;
  }
}
