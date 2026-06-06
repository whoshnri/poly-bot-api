export const MAX_OPERATION_FAILURES = 6;

export class CircuitBreakerError extends Error {
  readonly failureCount: number;

  constructor(failureCount: number) {
    super(
      `Circuit breaker tripped after ${failureCount} operation failure(s). Aborting this run.`,
    );
    this.name = "CircuitBreakerError";
    this.failureCount = failureCount;
  }
}

export function incrementFailureCount(current: number, failed: boolean): number {
  return failed ? current + 1 : current;
}

export function shouldTripCircuitBreaker(failureCount: number): boolean {
  return failureCount >= MAX_OPERATION_FAILURES;
}
