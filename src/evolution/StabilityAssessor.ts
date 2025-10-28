export class StabilityAssessor {
  private readonly alpha = 1.0; // weight on performance improvement
  private readonly beta = 0.5;  // weight on complexity increase
  private lastPerf = 0.5;
  private lastComplexity = 1;

  getCoefficients() { return { alpha: this.alpha, beta: this.beta }; }

  getLast(): { perf: number; complexity: number } {
    return { perf: this.lastPerf, complexity: this.lastComplexity };
  }

  // Corrected Lyapunov delta: deltaV = beta*Δcomplexity - alpha*Δsuccess (evolve if deltaV < 0)
  computeProspective(prePerf: number, postPerf: number, preCx: number, postCx: number) {
    const dSuccess = postPerf - prePerf; // positive is good
    const dCx = postCx - preCx;          // positive is more complex
    const deltaV = this.beta * dCx - this.alpha * dSuccess;
    return { deltaV, dSuccess, dCx, alpha: this.alpha, beta: this.beta, prePerf, postPerf, preCx, postCx };
  }

  commit(currentPerf: number, currentComplexity: number): void {
    this.lastPerf = currentPerf;
    this.lastComplexity = currentComplexity;
  }
}


