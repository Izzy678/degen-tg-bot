/**
 * Rate limiter utility to stay within free tier limits
 * Helius free tier: 10 requests/second, 1M credits/month
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if request is allowed and wait if needed
   */
  async checkLimit(key: string = 'default'): Promise<void> {
    const now = Date.now();
    const requests = this.requests.get(key) || [];

    // Remove old requests outside the window
    const validRequests = requests.filter(
      (timestamp) => now - timestamp < this.config.windowMs,
    );

    // Check if we're at the limit
    if (validRequests.length >= this.config.maxRequests) {
      const oldestRequest = validRequests[0];
      const waitTime = this.config.windowMs - (now - oldestRequest);

      if (waitTime > 0) {
        console.log(
          `[RateLimiter] Rate limit reached, waiting ${waitTime}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    // Add current request
    validRequests.push(now);
    this.requests.set(key, validRequests);
  }

  /**
   * Clear old entries periodically
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, requests] of this.requests.entries()) {
      const validRequests = requests.filter(
        (timestamp) => now - timestamp < this.config.windowMs,
      );
      if (validRequests.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, validRequests);
      }
    }
  }
}

// Helius free tier: 10 requests/second
export const heliusRateLimiter = new RateLimiter({
  maxRequests: 8, // Stay under 10 to be safe
  windowMs: 1000, // 1 second window
});

// Cleanup every minute
setInterval(() => {
  heliusRateLimiter.cleanup();
}, 60000);
