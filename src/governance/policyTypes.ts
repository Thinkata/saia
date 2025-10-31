export type PolicyDecision = {
  passed: boolean;
  reason?: string;
  risk?: number;
};

export interface PolicyModelAdapter {
  evaluate(input: string): Promise<PolicyDecision | null>;
  readonly name?: string;
}

