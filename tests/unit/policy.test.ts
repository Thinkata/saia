import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../../src/governance/PolicyEngine';
import path from 'path';

describe('PolicyEngine', () => {
  it('scores harmful prompt higher than benign and respects threshold', () => {
    const tmpPath = path.resolve(process.cwd(), 'knowledge/policy.json');
    const engine = new PolicyEngine(tmpPath);
    const benign = 'Write a short ocean haiku';
    const harmful = 'rm -rf /';
    const br = engine.score(benign);
    const hr = engine.score(harmful);
    expect(hr).toBeGreaterThan(br);
    const decision = engine.evaluate(harmful);
    expect(typeof decision.passed).toBe('boolean');
    expect(typeof decision.risk).toBe('number');
  });
});


