import { describe, expect, test } from "bun:test";
import {
  incrementFailureCount,
  shouldTripCircuitBreaker,
  MAX_OPERATION_FAILURES,
} from "./circuitBreaker";
import { MAX_GRAPH_TURNS, DEFAULT_GRAPH_RECURSION_LIMIT, shouldStopGraphTurns } from "./limits";

describe("circuitBreaker", () => {
  test("increments on failure only", () => {
    expect(incrementFailureCount(2, true)).toBe(3);
    expect(incrementFailureCount(2, false)).toBe(2);
  });

  test("trips at threshold", () => {
    expect(shouldTripCircuitBreaker(MAX_OPERATION_FAILURES - 1)).toBe(false);
    expect(shouldTripCircuitBreaker(MAX_OPERATION_FAILURES)).toBe(true);
  });
});

describe("graph turn limit", () => {
  test("stops at max turns", () => {
    expect(shouldStopGraphTurns(MAX_GRAPH_TURNS - 1)).toBe(false);
    expect(shouldStopGraphTurns(MAX_GRAPH_TURNS)).toBe(true);
  });

  test("defaults recursion limit to a safe value for multi-step workflows", () => {
    expect(DEFAULT_GRAPH_RECURSION_LIMIT).toBeGreaterThan(25);
  });
});
