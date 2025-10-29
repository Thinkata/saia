## Self-Adaptive Intelligence Architecture (SAIA)

This repo is a minimal, local, developer-friendly prototype of an AI‑Native system. Unlike agentic libraries that compose tools and prompts inside a single process, SAIA treats the infrastructure itself as cognitive: it learns, governs, and evolves at runtime under stability guarantees.
- Modular GenAI cells
- Orchestrator patterns (round-robin, random, keyword) and adaptive routing
- Governance SAGA stub (policy check + signed action/events)
- Metrics (latency, success, policy, per-cell, EMA, SAI)
- Express server exposing `/act`, `/metrics`, `/metrics/detailed`, Level 3 `/evolve`, `/evolution/state`

Companion article: [Stability Through Continuous Adaptation – AI‑Native Overview](https://thinkata.com/news/insights/ai-native-overview)

### How SAIA differs from agent frameworks
- **Infrastructure-level governance**: Policies enforced at runtime outside agent code with cryptographically signed audit trails (actions, tools, patterns). Update governance rules without redeploying agents.

- **Formally stable evolution**: Pattern changes accepted only when they satisfy a Lyapunov-style stability criterion (ΔV = αΔsuccess − βΔcomplexity < 0). SAIA provides mathematical guarantees that architectural changes won't degrade system reliability.

- **Self-adaptive routing infrastructure**: Epsilon-greedy bandit continuously learns optimal cell-to-prompt mappings from production feedback. Unlike static routing, SAIA's routing adapts automatically while maintaining provable stability bounds.

- **Emergent cell synthesis**: Cells autonomously specialize through observed domain clustering and merge when redundant (similarity + overlap thresholds). Goes beyond fixed agent roles to enable organic capability evolution.

- **Governance-integrated observability**: Unified metrics expose routing confidence, EMA success, policy compliance, and adaptation state. All events (actions, evolutions, tool calls) carry cryptographic signatures for regulatory audit.

### AI‑Native Principles → Implementation (Mapping)
- **Intelligent Composability**: specialized cells coordinated by adaptive routers
  - Cells: `src/agents/GenAICell.ts`, synthesized via `src/cells/CellFactory.ts`
  - Routing: classic in `src/patterns/Orchestrator.ts`, adaptive in `src/adaptation/LearningRouter.ts` (ε‑greedy bandit), feedback in `src/adaptation/FeedbackController.ts`
  - Domain emergence: `src/evolution/DomainSynthesis.ts` (observes domains, creates/merges cells)
- **Governed Autonomy**: runtime policy and tool governance independent of agents
  - Request policy: `src/governance/PolicyEngine.ts` + `verifyPolicy` in `src/governance/SAGA.ts` (risk scoring + threshold)
  - Tool governance: `src/tools/GovernedToolRunner.ts` with allowlist in `verifyToolCall` (env `TOOLS_ALLOW`, `TOOLS_ALLOW_NETWORK`)
  - Signed logs: action, pattern, and tool events signed in `src/governance/SAGA.ts`
- **Provable Stability**: pattern changes gated by Lyapunov‑style criterion
  - Stability assessor: `src/evolution/StabilityAssessor.ts` (ΔV = αΔsuccess − βΔcomplexity)
  - Evolution loop: `src/evolution/SelfDevelopmentEngine.ts` persists state, applies changes only when stable
- **Comprehensive Observability**: end‑to‑end metrics and auditable logs
  - Metrics API: `src/metrics/index.ts` (`/metrics`, `/metrics/detailed`)
  - Logs: `logs/actions.jsonl`, `logs/pattern_events.jsonl`, `logs/tool_events.jsonl` (signed entries)

### Stability Through Continuous Adaptation
Like the “spinning top” analogy in the companion article, SAIA maintains stability by moving: it learns routing policies from outcomes, governs actions at runtime, and evolves patterns only under stability guarantees. Feedback loops (EMA success, ε‑greedy routing, Lyapunov checks) enable controlled evolution without sacrificing reliability. See the [companion article](https://thinkata.com/news/insights/ai-native-overview) for the conceptual framing.


- LearningRouter for adaptive routing (`success_rate`, `keyword`, `rl_bandit`)
- FeedbackController with EMA updates and bounded parameter tuning
- Capabilities manifest per cell for emergent specialization hooks
- Expanded metrics with EMA success, router confidence, SAI, adaptation steps
- `/metrics/detailed` endpoint for adaptive stats

- PatternRegistry with `src/patterns/registry.json` to define orchestration templates
- StabilityAssessor with Lyapunov-style constraint (ΔV = αΔsuccess − βΔcomplexity, α=1.0, β=0.5)
- SelfDevelopmentEngine that evaluates global EMA and pattern complexity, persists `knowledge/state.json`, and triggers signed evolution events
- New endpoints:
  - `POST /evolve` (manual trigger; passes SAGA verify and stability check)
  - `GET /evolution/state` (active pattern id and global EMA)
- Signed evolution events appended to `logs/pattern_events.jsonl`

### Quick Start
1. Install dependencies:
```bash
npm install
```
2. Copy `.env.example` to `.env` and set values.
   - If `OPENAI_API_KEY` is not set, the system runs in stub mode and returns a local echo response.
3. Build and start:
```bash
npm run build && npm start
```

Server starts on `http://localhost:3000` by default.

### Security
- Adaptive Policy Engine blocks risky prompts before orchestration; blocked requests return HTTP 400 with `{ policy: { passed: false } }`.
- Tool execution is governed:
  - Allowlist via `TOOLS_ALLOW` env (comma-separated ids). Network tools are disabled unless `TOOLS_ALLOW_NETWORK=1`.
  - All tool events are signed and appended to `logs/tool_events.jsonl`.
- File IO is sandboxed to the workspace with traversal and hidden-path guards:
  - `file.write` rejects absolute, hidden (`.^`), and `..` paths; enforces workspace root.
  - `file.read.range` rejects hidden/env paths and clamps size/offsets.
  - `log.append` writes only under `./logs`.
  - `search.regex` skips symlinks and heavy dirs (`node_modules`, `.git`, `dist`, `.nuxt`, `.next`, `.cache`), and continues on per-file errors.
- Production hardening:
  - `/env/snapshot` is disabled when `NODE_ENV=production`.
  - Use a reverse proxy for TLS and add rate limiting and CORS as needed at the edge.

### Endpoints
- `POST /act` body:
```json
{ "prompt": "Write a haiku about the ocean.", "router": "round_robin" }
```
Response example (truncated):
```json
{
  "requestId": "...",
  "router": "round_robin",
  "cellId": "cell-creative",
  "response": "...",
  "signatureAlgo": "HMAC-SHA256",
  "signature": "...",
  "policy": { "passed": true },
  "metrics": { "latencyMs": 123, "success": true, "timestamp": "2025-01-01T00:00:00.000Z" }
}
```

- `GET /metrics` returns current summary including totals and per-cell aggregates.
 - `GET /metrics/detailed` returns per-cell adaptive stats (EMA success, confidence, SAI, steps).
 - `POST /evolve` triggers a governed evolution attempt (signed if applied).
 - `GET /evolution/state` returns active pattern and global EMA success.

### Project Structure
```
saia-level1/
├── src/
│   ├── agents/GenAICell.ts
│   ├── adaptation/
│   │   ├── FeedbackController.ts
│   │   └── LearningRouter.ts
│   ├── evolution/
│   │   ├── SelfDevelopmentEngine.ts
│   │   └── StabilityAssessor.ts
│   ├── patterns/
│   │   ├── Orchestrator.ts
│   │   ├── PatternRegistry.ts
│   │   └── registry.json
│   ├── governance/SAGA.ts
│   ├── metrics/index.ts
│   └── index.ts
├── knowledge/state.json (generated)
├── logs/actions.jsonl
├── logs/pattern_events.jsonl (generated)
├── scripts/simulate.ts
├── .env.example
├── package.json
└── README.md
```

### Notes
- Action logs are appended to `logs/actions.jsonl` with timestamp, hash, policy, signature, router strategy, adaptation reason.
- Evolution events (when applied) are signed and appended to `logs/pattern_events.jsonl`.
- Metrics are in-memory and exported under `/metrics`. Global EMA success is used by evolution.
- Cells have ephemeral memory per-instance; `knowledge/state.json` persists a small snapshot (perf and active pattern) for continuity.
- Router strategies can be selected via `ROUTER_STRATEGY` env var or per-request (classic) or adaptive strategies.

### Environment variables (selected)
- OPENAI_API_KEY, OPENAI_MODEL, OPENAI_ENDPOINT, PORT
- SAIA_SECRET (signing)
- LATENCY_SLO_MS (SAI normalization)
- ROUTER_STRATEGY (classic only)
- RL_EPSILON, RL_DECAY, TAG_GUARD_THRESHOLD

Adaptive RL schedule (optional):
- RL_EPSILON0 (default: RL_EPSILON)
- RL_MIN_EPSILON (default: 0.08)
- RL_EPSILON_DECAY (per-step exp decay factor, default: 0)
- RL_WARMUP_STEPS (keep ε at RL_EPSILON0 for first N steps)
- RL_DRIFT_WINDOW (recent window for drift detection, default: 30)
- RL_DRIFT_DROP (reward drop threshold to spike ε, default: 0.08)
- RL_SPIKE_EPSILON (peak ε during spike, default: 0.30)
- RL_SPIKE_DECAY (exp decay of spike ε, default: 0.01)
- RL_SPIKE_STEPS (spike duration, default: 20)

Consolidation thresholds (optional):
- MERGE_MIN_NAME_SIM (default: 0.88)
- MERGE_MIN_TAG_JACCARD (default: 0.5)
- MERGE_MIN_OBS (default: 5)

### Level 2/3 Upgrade Path
- Level 2: adaptive behavioral policies, learned routing, expanded governance.
- Level 3: pattern synthesis and reversible reconfiguration under Lyapunov constraint.
- Future: richer capability graphs, multi-signer policies, durable telemetry, and safe structural evolution.

### Simulation
Run a quick adaptation simulation (ensure the server is running):
```bash
npm run simulate
```
This sends 20 varied prompts to `/act` and prints `/metrics/detailed` to show adaptation.

### Testing & Coverage
- Unit tests (with coverage):
```bash
npm run test:unit
```
- System tests (requires server running in another terminal):
```bash
# Terminal 1
npm start
# Terminal 2
npm run test:system
```
Coverage uses V8 and writes `coverage/` with text + lcov reports.

### CI
GitHub Actions build:
- Type-checks and builds
- Starts the server for system tests
- Runs unit tests with coverage and system tests
Artifacts include test logs and coverage reports.

### Example Curl
```bash
# Act
curl -s -X POST http://localhost:3000/act \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Summarize SAIA Level 1 in one sentence."}' | jq

# Evolution state
curl -s http://localhost:3000/evolution/state | jq

# Attempt evolution (may or may not apply per stability check)
curl -s -X POST http://localhost:3000/evolve | jq
```

