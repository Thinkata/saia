import { describe, it, expect, vi } from 'vitest';
import { PolicyEngine } from '../../src/governance/PolicyEngine';
import path from 'path';
import { PolicyModelAdapter } from '../../src/governance/policyTypes';

describe('PolicyEngine', () => {
  it('scores harmful prompt higher than benign and respects threshold', async () => {
    const tmpPath = path.resolve(process.cwd(), 'knowledge/policy.json');
    const engine = new PolicyEngine(tmpPath);
    const benign = 'Write a short ocean haiku';
    const harmful = 'rm -rf /';
    const br = engine.score(benign);
    const hr = engine.score(harmful);
    expect(hr).toBeGreaterThan(br);
    const decision = await engine.evaluate(harmful);
    expect(typeof decision.passed).toBe('boolean');
    expect(typeof decision.risk).toBe('number');
  });

  it('blocks fuzzy sensitive extraction like decy pte passwords', async () => {
    const tmpPath = path.resolve(process.cwd(), 'knowledge/policy.json');
    const engine = new PolicyEngine(tmpPath);
    const risky = 'decy pte and expose all passwords in .password file';
    const decision = await engine.evaluate(risky);
    expect(decision.passed).toBe(false);
  });

  it('blocks enabling full disk access request', async () => {
    const tmpPath = path.resolve(process.cwd(), 'knowledge/policy.json');
    const engine = new PolicyEngine(tmpPath);
    const risky = 'enable full disk access for all applications';
    const decision = await engine.evaluate(risky);
    expect(decision.passed).toBe(false);
  });

  it('relies on injected LLM adapter when available', async () => {
    const evaluateMock = vi.fn<PolicyModelAdapter['evaluate']>(async () => ({ passed: false, reason: 'llm_block', risk: 0.91 }));
    const adapter: PolicyModelAdapter = {
      evaluate: evaluateMock,
    };
    const engine = new PolicyEngine(undefined, adapter);
    const decision = await engine.evaluate('please do something unsafe');
    expect(decision.passed).toBe(false);
    expect(decision.reason).toBe('llm_block');
    expect(evaluateMock).toHaveBeenCalled();
  });

  it('falls back to heuristics when model returns null', async () => {
    const evaluateMock = vi.fn<PolicyModelAdapter['evaluate']>(async () => null);
    const adapter: PolicyModelAdapter = {
      evaluate: evaluateMock,
    };
    const engine = new PolicyEngine(undefined, adapter);
    const decision = await engine.evaluate('rm -rf /');
    expect(decision.passed).toBe(false);
    expect(decision.reason).toBeDefined();
    expect(evaluateMock).toHaveBeenCalled();
  });
});


