import logger from './logger.js';

/**
 * Metrics Collector
 * Tracks latency, error rates, and provider response codes
 * No PII tracking - privacy-first design
 */
class MetricsCollector {
  constructor() {
    this.metrics = {
      requests: {}, // endpoint -> count
      errors: {}, // endpoint -> { code -> count }
      latencies: {}, // endpoint -> [times]
      rateLimitExceeded: {}, // endpoint -> count
    };
    this.windowSize = 1000; // Keep last 1000 latency samples per endpoint
  }

  /**
   * Record a successful request
   */
  recordRequest(endpoint, statusCode) {
    if (!this.metrics.requests[endpoint]) {
      this.metrics.requests[endpoint] = { total: 0, [statusCode]: 0 };
    }

    this.metrics.requests[endpoint].total++;
    this.metrics.requests[endpoint][statusCode] = (this.metrics.requests[endpoint][statusCode] || 0) + 1;
  }

  /**
   * Record an error
   */
  recordError(endpoint, errorCode) {
    if (!this.metrics.errors[endpoint]) {
      this.metrics.errors[endpoint] = {};
    }

    this.metrics.errors[endpoint][errorCode] = (this.metrics.errors[endpoint][errorCode] || 0) + 1;
  }

  /**
   * Record request latency
   */
  recordLatency(endpoint, latencyMs) {
    if (!this.metrics.latencies[endpoint]) {
      this.metrics.latencies[endpoint] = [];
    }

    this.metrics.latencies[endpoint].push(latencyMs);

    // Keep only last N samples
    if (this.metrics.latencies[endpoint].length > this.windowSize) {
      this.metrics.latencies[endpoint].shift();
    }
  }

  /**
   * Record rate limit exceeded
   */
  recordRateLimitExceeded(endpoint) {
    if (!this.metrics.rateLimitExceeded[endpoint]) {
      this.metrics.rateLimitExceeded[endpoint] = 0;
    }

    this.metrics.rateLimitExceeded[endpoint]++;
  }

  /**
   * Get metrics snapshot for monitoring
   */
  getMetrics() {
    const metrics = {
      timestamp: new Date().toISOString(),
      endpoints: {},
    };

    for (const endpoint of Object.keys(this.metrics.requests)) {
      const latencies = this.metrics.latencies[endpoint] || [];
      const errors = this.metrics.errors[endpoint] || {};

      metrics.endpoints[endpoint] = {
        requests: this.metrics.requests[endpoint],
        errors,
        latency: {
          count: latencies.length,
          min: latencies.length > 0 ? Math.min(...latencies) : 0,
          max: latencies.length > 0 ? Math.max(...latencies) : 0,
          avg: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b) / latencies.length) : 0,
          p95: this.percentile(latencies, 0.95),
          p99: this.percentile(latencies, 0.99),
        },
        rateLimitExceeded: this.metrics.rateLimitExceeded[endpoint] || 0,
      };
    }

    return metrics;
  }

  /**
   * Get metrics for specific endpoint
   */
  getEndpointMetrics(endpoint) {
    const latencies = this.metrics.latencies[endpoint] || [];
    const errors = this.metrics.errors[endpoint] || {};
    const requests = this.metrics.requests[endpoint] || { total: 0 };

    return {
      endpoint,
      timestamp: new Date().toISOString(),
      requests: requests.total,
      errors: this.sumErrors(errors),
      errorBreakdown: errors,
      latency: {
        count: latencies.length,
        min: latencies.length > 0 ? Math.min(...latencies) : 0,
        max: latencies.length > 0 ? Math.max(...latencies) : 0,
        avg: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b) / latencies.length) : 0,
        p95: this.percentile(latencies, 0.95),
        p99: this.percentile(latencies, 0.99),
      },
      rateLimitExceeded: this.metrics.rateLimitExceeded[endpoint] || 0,
      successRate: requests.total > 0 ? Math.round((requests[200] || 0) / requests.total * 100) : 0,
    };
  }

  /**
   * Calculate percentile from array
   */
  percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Sum all error counts
   */
  sumErrors(errorObj) {
    return Object.values(errorObj).reduce((sum, count) => sum + count, 0);
  }

  /**
   * Reset metrics (useful for testing)
   */
  reset() {
    this.metrics = {
      requests: {},
      errors: {},
      latencies: {},
      rateLimitExceeded: {},
    };
  }

  /**
   * Log metrics summary periodically
   */
  logSummary(interval = 300000) {
    setInterval(() => {
      const metrics = this.getMetrics();
      logger.info('Metrics summary', metrics);
    }, interval);
  }
}

// Export singleton instance
export const metricsCollector = new MetricsCollector();
