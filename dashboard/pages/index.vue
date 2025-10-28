<template>
  <div class="container">
    <div class="topbar">
      <h1>SAIA Dashboard</h1>
      <div class="top-actions">
        <UButton color="primary" @click="runBaseline">Run Baseline</UButton>
        <UButton color="primary" variant="soft" @click="runDomainEmergence">Domain Emergence</UButton>
        <UButton color="primary" variant="solid" @click="runFull">Run Full Report</UButton>
        <UButton color="gray" variant="soft" @click="openParams = true">Edit RL Params</UButton>
        <UButton color="green" variant="solid" @click="refreshAll">Refresh All</UButton>
      </div>
    </div>

    <section class="main-grid">
      <div class="card">
        <h3>Ad‑hoc Prompt</h3>
        <div class="row">
          <label style="min-width:70px">Router</label>
          <select v-model="adhocRouter" class="sel">
            <option value="round_robin">round_robin</option>
            <option value="random">random</option>
            <option value="keyword">keyword</option>
            <option value="success_rate">success_rate</option>
            <option value="rl_bandit">rl_bandit</option>
          </select>
          <label class="muted small">Synthesize after</label>
          <input type="checkbox" v-model="adhocSynthesize" />
        </div>
        <div class="row">
          <label style="min-width:70px">Prompt</label>
          <textarea v-model="adhocPrompt" class="txt" placeholder="Type an instruction or question..."></textarea>
        </div>
        <div class="row" style="align-items:flex-start">
          <label style="min-width:70px">Tools</label>
          <div style="display:flex; gap:12px; flex:1">
            <div style="display:flex; align-items:center; gap:8px">
              <input type="checkbox" v-model="adhocAutoRecommend" />
              <span class="small">Auto‑recommend</span>
              <span class="muted small">top</span>
              <input class="short small-input" type="number" min="1" max="5" v-model.number="adhocRecommendK" />
            </div>
            <div v-if="!adhocAutoRecommend" style="flex:1; max-height:120px; overflow:auto; border:1px solid #e5e7eb; border-radius:6px; padding:6px">
              <div v-for="t in toolRegistryList" :key="t.id" class="small" style="display:flex; align-items:center; gap:6px; padding:2px 0">
                <input type="checkbox" :value="t.id" v-model="adhocAllow" />
                <span>{{ t.id }}</span>
                <span class="muted">{{ Math.round((t.successRate||0)*100) }}% / {{ t.avgLatency }}ms</span>
              </div>
              <div v-if="!toolRegistryList.length" class="muted small">No tools listed.</div>
            </div>
            <div v-else class="muted small" style="flex:1">Will use knowledge to recommend tools automatically.</div>
            <div style="display:flex; align-items:center; gap:8px">
              <UButton :loading="adhocRunning" color="primary" @click="runAdhoc">Run</UButton>
            </div>
          </div>
        </div>
        <div class="evol-table" style="margin-top:8px; flex:1; overflow:hidden">
          <div v-if="adhocResult" style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; height:100%">
            <div style="display:flex; flex-direction:column; gap:8px">
              <div class="meta small">
                <div><b>Cell</b>: {{ adhocResult.act?.cellId || '-' }}</div>
                <div><b>Router</b>: {{ adhocResult.act?.router || adhocResult.router || adhocRouter }}</div>
                <div><b>Latency</b>: {{ adhocResult.act?.metrics?.latencyMs ?? '-' }} ms</div>
              </div>
              <div class="meta small">
                <div><b>Allowed</b>: {{ (adhocResult.allowedTools||[]).join(', ') || '-' }}</div>
                <div><b>Used Tool</b>: {{ adhocResult.usedToolId || '-' }}</div>
                <div><b>Policy</b>: {{ (adhocResult.act?.policy?.passed ?? true) ? 'pass' : 'fail' }}</div>
              </div>
              <div class="resp resp-scroll">
                <div class="resp-head">
                  <span class="badge">response</span>
                  <div style="flex:1"></div>
                  <UButton size="xs" variant="ghost" @click="respWrap = !respWrap">{{ respWrap ? 'No wrap' : 'Wrap' }}</UButton>
                  <UButton size="xs" variant="ghost" @click="copyResponse">Copy</UButton>
                </div>
                <div class="resp-body">
                  <pre class="resp-text" :class="{ nowrap: !respWrap }">{{ adhocResult.act?.response }}</pre>
                </div>
              </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px">
              <div class="resp" style="flex:1; overflow:auto">
                <div class="resp-head"><span class="badge">metrics</span></div>
                <div class="meta small">
                  <div><b>Total</b>: {{ adhocResult.summary?.total ?? '-' }}</div>
                  <div><b>Success</b>: {{ Math.round((adhocResult.summary?.successRate||0)*100) }}%</div>
                  <div><b>Policy</b>: {{ Math.round((adhocResult.summary?.policyPassRate||0)*100) }}%</div>
                  <div><b>Avg Lat</b>: {{ adhocResult.summary?.avgLatency ?? '-' }} ms</div>
                </div>
                <div class="meta small">
                  <div><b>Tools total</b>: {{ adhocResult.tools?.total ?? 0 }}</div>
                  <div><b>Evo perf</b>: {{ adhocResult.evolution?.perf ?? '-' }}</div>
                </div>
              </div>
              <div class="resp" style="max-height:120px; overflow:auto">
                <div class="resp-head"><span class="badge">recommended</span></div>
                <div class="muted small">{{ (adhocResult.recommended||[]).join(', ') || '-' }}</div>
              </div>
            </div>
          </div>
          <div v-else class="muted small" style="text-align:left">Enter a prompt and click Run to execute an ad‑hoc task end‑to‑end.</div>
        </div>
      </div>
      <div class="card">
        <h3>Metrics (Summary)</h3>
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-value">{{ summary.total }}</div></div>
          <div class="kpi"><div class="kpi-label">Success</div><div class="kpi-value">{{ (summary.successRate*100).toFixed(0) }}%</div></div>
          <div class="kpi"><div class="kpi-label">Policy</div><div class="kpi-value">{{ (summary.policyPassRate*100).toFixed(0) }}%</div></div>
          <div class="kpi"><div class="kpi-label">Avg Lat</div><div class="kpi-value">{{ summary.avgLatency }} ms</div></div>
        </div>
        <div class="charts">
          <div class="chart">
            <Bar :data="barData" :options="barOpts" :key="barKey" />
          </div>
          <div class="chart">
            <Doughnut :data="pieData" :options="pieOpts" :key="pieKey" />
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Metrics (Detailed)</h3>
        <table>
          <thead>
            <tr><th>Cell</th><th>Count</th><th>EMA</th><th>Conf</th><th>SAI</th><th>Avg Lat (ms)</th></tr>
          </thead>
          <tbody>
            <tr v-for="(v, k) in detailed.perCell" :key="k">
              <td>{{ k }}</td>
              <td>{{ v.count }}</td>
              <td>{{ formatPct(v.emaSuccess) }}</td>
              <td>{{ formatPct(v.routerConfidence) }}</td>
              <td>{{ formatPct(v.SAI) }}</td>
              <td>{{ v.avgLatency }}</td>
            </tr>
            <tr v-if="!Object.keys(detailed.perCell || {}).length">
              <td colspan="6" class="muted">No data yet. Run a test to populate metrics.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card exp-card-full">
        <h3>Experiments</h3>
        <div v-if="baseliner" class="exp-results">
          <h4>Baseline Comparison</h4>
          <div class="exp-grid">
            <div v-for="r in baseliner.results" :key="r.strategy" class="exp-card">
              <div class="exp-strategy">{{ r.strategy }}</div>
              <div class="exp-stat"><span class="label">Avg Latency:</span> {{ r.avgLatency }} ms</div>
              <div class="exp-stat"><span class="label">Requests:</span> {{ r.total }}</div>
              <div class="exp-cells">
                <div v-for="(v,k) in r.perCell" :key="k" class="cell-stat">
                  <span>{{ k }}</span>: {{ v.count }} req, {{ v.avgLatency }} ms
                </div>
              </div>
            </div>
          </div>
          <div class="mt">
            <h4>Strategy Comparison (Pass‑only)</h4>
            <table>
              <thead><tr><th>Strategy</th><th>Total</th><th>Pass</th><th>Fail</th><th>Avg Lat (pass)</th></tr></thead>
              <tbody>
                <tr v-for="s in strategyRows" :key="s.name">
                  <td>{{ s.name }}</td>
                  <td>{{ s.total }}</td>
                  <td>{{ s.pass }}</td>
                  <td>{{ s.fail }}</td>
                  <td>{{ s.avgPassLatency }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-if="domainer" class="exp-results">
          <h4>Domain Emergence</h4>
          <div class="exp-grid">
            <div v-for="p in domainer.phases" :key="p.phase" class="exp-card">
              <div class="exp-strategy">{{ p.phase }}</div>
              <div class="exp-stat"><span class="label">Requests:</span> {{ p.total }}</div>
              <div class="exp-cells">
                <div v-for="(cnt,cell) in p.cellsUsed" :key="cell" class="cell-stat">
                  <span>{{ cell }}</span>: {{ cnt }} req
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Experiment Summary</h3>
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Active Config</div><div class="kpi-value small">{{ baseliner?.configPath || domainer?.configPath || '-' }}</div></div>
          <div class="kpi"><div class="kpi-label">ε</div><div class="kpi-value">{{ rl?.epsilon ?? '-' }}</div></div>
          <div class="kpi"><div class="kpi-label">Cells</div><div class="kpi-value">{{ banditCells.length }}</div></div>
          <div class="kpi"><div class="kpi-label">Policy Fail</div><div class="kpi-value">{{ policyFailCount }}</div></div>
        </div>
        <div class="chart"><Bar :data="banditBar" :options="banditOpts" /></div>
      </div>

      <div class="card lyap-card">
        <h3>Policy Outcomes</h3>
        <div class="evol-table">
          <div style="max-height:200px; overflow-y:auto">
            <table>
              <thead><tr><th>Reason</th><th>Count</th></tr></thead>
              <tbody>
                <tr><td><b>Total Fails</b></td><td>{{ policyFailCount }}</td></tr>
                <tr v-for="(c,reason) in policyReasons" :key="reason"><td>{{ reason }}</td><td>{{ c }}</td></tr>
                <tr v-if="!Object.keys(policyReasons).length"><td colspan="2" class="muted">No failures recorded.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card lyap-card">
        <h3>Config & Metrics Snapshot</h3>
        <div class="evol-table">
          <div style="max-height:400px; overflow-y:auto">
            <table>
              <thead><tr><th>Key</th><th>Value</th></tr></thead>
              <tbody>
                <tr><td>LATENCY_SLO_MS</td><td>{{ envSnapshot.LATENCY_SLO_MS }}</td></tr>
                <tr><td>RL_EPSILON / ε0 → min</td><td>{{ envSnapshot.RL_EPSILON }} / {{ envSnapshot.RL_EPSILON0 }} → {{ envSnapshot.RL_MIN_EPSILON }}</td></tr>
                <tr><td>RL_EPSILON_DECAY (per step)</td><td>{{ envSnapshot.RL_EPSILON_DECAY }}</td></tr>
                <tr><td>RL_WARMUP_STEPS</td><td>{{ envSnapshot.RL_WARMUP_STEPS }}</td></tr>
                <tr><td>RL_DECAY (value forgetting)</td><td>{{ envSnapshot.RL_DECAY }}</td></tr>
                <tr><td>TAG_GUARD_THRESHOLD</td><td>{{ envSnapshot.TAG_GUARD_THRESHOLD }}</td></tr>
                <tr><td>DRIFT (win/drop/spike/decay/steps)</td><td>{{ envSnapshot.RL_DRIFT_WINDOW }}/{{ envSnapshot.RL_DRIFT_DROP }}/{{ envSnapshot.RL_SPIKE_EPSILON }}/{{ envSnapshot.RL_SPIKE_DECAY }}/{{ envSnapshot.RL_SPIKE_STEPS }}</td></tr>
                <tr><td>MERGE (name/tag/obs)</td><td>{{ envSnapshot.MERGE_MIN_NAME_SIM }}/{{ envSnapshot.MERGE_MIN_TAG_JACCARD }}/{{ envSnapshot.MERGE_MIN_OBS }}</td></tr>
                <tr><td>Active Config</td><td>{{ baseliner?.configPath || domainer?.configPath || '-' }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card lyap-card">
        <h3>Tools (Recent)</h3>
        <div class="evol-table">
          <div style="max-height:320px; overflow-y:auto">
            <table>
              <thead><tr><th>Tool</th><th>Count</th><th>Success</th><th>Avg Lat (ms)</th></tr></thead>
              <tbody>
                <tr v-for="(v, id) in tools.perTool" :key="id"><td>{{ id }}</td><td>{{ v.count }}</td><td>{{ v.successRate }}%</td><td>{{ v.avgLatency }}</td></tr>
                <tr v-if="!Object.keys(tools.perTool||{}).length"><td colspan="4" class="muted">No tool events.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="mt">
          <h4>Available Tools</h4>
          <div style="max-height:180px; overflow:auto">
            <table>
              <thead><tr><th>Tool</th><th>Success</th><th>Avg Lat</th></tr></thead>
              <tbody>
                <tr v-for="t in toolRegistryList" :key="t.id">
                  <td>{{ t.id }}</td>
                  <td>{{ Math.round((t.successRate||0)*100) }}%</td>
                  <td>{{ t.avgLatency }}</td>
                </tr>
                <tr v-if="!toolRegistryList.length"><td colspan="3" class="muted">No tools listed.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="mt">
          <h4>Recommend Tools</h4>
          <div class="row">
            <UInput v-model="recPrompt" placeholder="Type a prompt for recommendations" />
            <UButton size="sm" @click="runRecs">Recommend</UButton>
          </div>
          <div class="muted small" v-if="recs.length">Top: {{ recs.join(', ') }}</div>
        </div>
      </div>

      <div class="card gov-card">
        <h3>Governance Actions (latest)</h3>
        <div class="list" style="max-height:380px; overflow:auto">
          <div v-for="(a,i) in actions.slice(0,20)" :key="i" class="resp">
            <div class="resp-head">
              <span class="badge">{{ a.cellId }}</span>
              <span class="muted">{{ a.routerStrategy }}</span>
              <span class="muted">{{ (a.ts || a.timestamp || '').slice(11,19) }}</span>
            </div>
            <div class="muted small">
              sig: {{ a.signature?.slice?.(0,12) }}… 
              <span :style="{ color: (a.policy?.passed ?? a.policyResult?.passed) ? '#10b981' : '#ef4444' }">
                policy: {{ (a.policy?.passed ?? a.policyResult?.passed) ? 'pass' : 'fail' }}
              </span>
            </div>
          </div>
          <div v-if="!actions.length" class="muted">No actions sampled yet.</div>
        </div>
      </div>

      <div class="card">
        <h3>Domain → Cell Matrix (recent)</h3>
        <table>
          <thead>
            <tr>
              <th>domain</th>
              <th v-for="c in Object.keys(summary.perCell||{})" :key="c">{{ c }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in domainRows" :key="r.domain">
              <td>{{ r.domain }}</td>
              <td v-for="c in Object.keys(summary.perCell||{})" :key="c">{{ r[c] || 0 }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    

    <UModal v-model="openParams">
      <div class="log-panel">
        <h3>Edit RL Parameters</h3>
        <div class="row">
          <label>epsilon</label><UInput v-model.number="rl.params.epsilon" type="number" step="0.01" />
          <label>decay</label><UInput v-model.number="rl.params.decay" type="number" step="0.01" />
        </div>
        <div class="row">
          <label>epsilon0</label><UInput v-model.number="rl.params.eps0" type="number" step="0.01" />
          <label>minEps</label><UInput v-model.number="rl.params.minEps" type="number" step="0.01" />
        </div>
        <div class="row">
          <label>epsDecay</label><UInput v-model.number="rl.params.epsDecay" type="number" step="0.001" />
          <label>warmupSteps</label><UInput v-model.number="rl.params.warmupSteps" type="number" />
        </div>
        <div class="row">
          <label>driftWindow</label><UInput v-model.number="rl.params.driftWindow" type="number" />
          <label>driftDrop</label><UInput v-model.number="rl.params.driftDrop" type="number" step="0.01" />
        </div>
        <div class="row">
          <label>spikeEpsilon</label><UInput v-model.number="rl.params.spikeEpsilon" type="number" step="0.01" />
          <label>spikeDecay</label><UInput v-model.number="rl.params.spikeDecay" type="number" step="0.001" />
          <label>spikeSteps</label><UInput v-model.number="rl.params.spikeSteps" type="number" />
        </div>
        <div class="row end">
          <UButton @click="saveParams">Save</UButton>
          <UButton variant="ghost" @click="openParams=false">Cancel</UButton>
        </div>
      </div>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
const toast = useToast()
import { Bar, Doughnut, Line } from 'vue-chartjs'
import {
  Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ArcElement, PointElement, LineElement
} from 'chart.js'
ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ArcElement, PointElement, LineElement)

const showLog = ref(false)
const openParams = ref(false)
// removed session log UI; keep styles reused by modal
const summary = ref<any>({ total: 0, successCount: 0, policyPassCount: 0, perCell: {} })
const detailed = ref<any>({ perCell: {} })
const evolution = ref<any>({})
const rl = ref<any>({})
const evolLogs = ref<any[]>([])
const actions = ref<any[]>([])
const domainMatrix = ref<{ matrix: Record<string, Record<string, number>>, total: number }>({ matrix: {}, total: 0 })
const baseliner = ref<any>(null)
const domainer = ref<any>(null)
const envSnapshot = ref<Record<string, any>>({})
const tools = ref<{ total?: number; perTool?: Record<string, { count: number; successRate: number; avgLatency: number }> }>({ total: 0, perTool: {} })
const toolRegistryList = ref<any[]>([])
const recPrompt = ref('')
const recs = ref<string[]>([])
// Ad-hoc state
const adhocPrompt = ref('')
const adhocRouter = ref<'round_robin'|'random'|'keyword'|'success_rate'|'rl_bandit'>('success_rate')
const adhocAutoRecommend = ref(true)
const adhocRecommendK = ref(3)
const adhocAllow = ref<string[]>([])
const adhocSynthesize = ref(false)
const adhocRunning = ref(false)
const adhocResult = ref<any>(null)
const respWrap = ref(true)
const policyFailCount = computed(() => actions.value.filter(a => !(a.policy?.passed ?? a.policyResult?.passed)).length)
const policyReasons = computed(() => {
  const m: Record<string, number> = {}
  for (const a of actions.value) {
    const passed = (a.policy?.passed ?? a.policyResult?.passed)
    if (passed) continue
    const r = a.policy?.reason || a.policyResult?.reason || 'unknown'
    m[r] = (m[r] || 0) + 1
  }
  return m
})
const strategyRows = computed(() => {
  const rows: Array<{ name: string; total: number; pass: number; fail: number; avgPassLatency: number }> = []
  const res = baseliner.value?.results || []
  for (const r of res) {
    let pass = 0, fail = 0
    let latSum = 0
    for (const [cell, v] of Object.entries<any>(r.perCell || {})) {
      if (cell === '(none)' || cell === 'undefined') { fail += v.count || 0; continue }
      pass += v.count || 0
      latSum += (v.count || 0) * (v.avgLatency || 0)
    }
    const avg = pass > 0 ? Math.round(latSum / pass) : 0
    rows.push({ name: r.strategy, total: r.total, pass, fail, avgPassLatency: avg })
  }
  return rows
})

async function getJSON(url: string) {
  const res = await fetch(url)
  return await res.json()
}
async function postJSON(url: string, body: any) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return await res.json()
}

async function synthesize() {
  const res = await postJSON('/evolution/synthesize', {})
  const created = Array.isArray(res.created) ? res.created.join(', ') : String(res.created || '')
  await refreshAll()
  try { (toast as any).add({ title: 'Synthesis complete', description: created ? `Created: ${created}` : 'No new cells synthesized', timeout: 3000 }) } catch {}
}
async function refreshAll() {
  summary.value = await getJSON('/metrics')
  detailed.value = await getJSON('/metrics/detailed')
  evolution.value = await getJSON('/evolution/state')
}
onMounted(refreshAll)

async function fetchDiagnostics() {
  try { rl.value = await getJSON('/router/state') } catch {}
  try { evolLogs.value = await getJSON('/evolution/logs?limit=120') } catch {}
  try { actions.value = await getJSON('/actions/sample?limit=200') } catch {}
  try { domainMatrix.value = await getJSON('/analytics/domain-matrix') } catch {}
  try { envSnapshot.value = await getJSON('/env/snapshot') } catch {}
  try { tools.value = await getJSON('/tools/metrics') } catch {}
  try { toolRegistryList.value = await getJSON('/tools/registry') } catch {}
}
async function saveParams() {
  try {
    const body = rl.value?.params || {}
    await postJSON('/router/params', body)
    await fetchDiagnostics()
    try { (toast as any).add({ title: 'Router params updated' }) } catch {}
    openParams.value = false
  } catch {}
}

async function runRecs() {
  const q = new URLSearchParams({ prompt: recPrompt.value })
  try {
    const r = await getJSON('/tools/recommend?' + q.toString())
    recs.value = Array.isArray(r?.recommend) ? r.recommend : []
  } catch {}
}

async function runBaseline() {
  // Empty body so server reads EXPERIMENT_CONFIG (from .env) instead of client overrides
  baseliner.value = await postJSON('/experiments/baseline', {})
  await fetchDiagnostics()
  await refreshAll()
}

async function runDomainEmergence() {
  domainer.value = await postJSON('/experiments/domain-emergence', {})
  await fetchDiagnostics()
  await refreshAll()
}

async function runFull() {
  const report = await postJSON('/experiments/full', {})
  baseliner.value = report.baseline
  domainer.value = report.domain
  await fetchDiagnostics()
  await refreshAll()
  // Provide a JSON download for paper inclusion
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'saia-full-experiment.json'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  try { (toast as any).add({ title: 'Full report ready', description: 'Downloaded JSON for paper', timeout: 3000 }) } catch {}
}

async function runAdhoc() {
  try {
    adhocRunning.value = true
    const body: any = {
      prompt: adhocPrompt.value,
      router: adhocRouter.value,
      autoRecommend: adhocAutoRecommend.value,
      recommendK: adhocRecommendK.value,
      synthesize: adhocSynthesize.value,
    }
    if (!adhocAutoRecommend.value) body.allow = adhocAllow.value
    const res = await postJSON('/adhoc/run', body)
    adhocResult.value = res
    await fetchDiagnostics()
    await refreshAll()
    try { (toast as any).add({ title: 'Ad‑hoc run complete' }) } catch {}
  } catch (e) {
    try { (toast as any).add({ title: 'Ad‑hoc run failed', description: String(e) }) } catch {}
  } finally {
    adhocRunning.value = false
  }
}

async function copyResponse() {
  try {
    const txt = String(adhocResult.value?.act?.response || '')
    await navigator.clipboard.writeText(txt)
    try { (toast as any).add({ title: 'Response copied' }) } catch {}
  } catch {}
}

const barData = computed(() => {
  const cells = Object.keys(summary.value.perCell || {})
  const counts = cells.map(k => summary.value.perCell[k].count)
  return { labels: cells, datasets: [{ label: 'Requests per cell', data: counts, backgroundColor: '#4f46e5' }] }
})
const barOpts = { responsive: true, maintainAspectRatio: true, aspectRatio: 2, layout: { padding: 8 }, plugins: { legend: { position: 'bottom' } } }
const barKey = computed(() => JSON.stringify(barData.value))

const pieData = computed(() => {
  const cells = Object.keys(summary.value.perCell || {})
  const counts = cells.map(k => summary.value.perCell[k].count)
  const colors = ['#4f46e5', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444']
  return { labels: cells, datasets: [{ data: counts, backgroundColor: cells.map((_, i) => colors[i % colors.length]) }] }
})
const pieOpts = { responsive: true, maintainAspectRatio: true, aspectRatio: 1, layout: { padding: 8 }, plugins: { legend: { position: 'bottom' } } }
const pieKey = computed(() => JSON.stringify(pieData.value))

const latencyData = computed(() => {
  const recent = (detailed.value.recent || []).slice(-20)
  const labels = recent.map((e: any) => e.requestId.slice(0, 6))
  const values = recent.map((e: any) => e.latencyMs)
  return { labels, datasets: [{ label: 'Latency (ms)', data: values, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.2)', tension: 0.3 }] }
})
const lineOpts = { responsive: true, maintainAspectRatio: false }
const latencyKey = computed(() => JSON.stringify(latencyData.value))

function formatPct(x: number) {
  if (typeof x !== 'number') return '-'
  return `${Math.round(x * 100)}%`
}

const banditCells = computed(() => Object.keys(rl.value?.values || {}))
const banditValues = computed(() => banditCells.value.map(k => rl.value.values[k]))
const banditCounts = computed(() => banditCells.value.map(k => rl.value.counts?.[k] ?? 0))
const banditBar = computed(() => ({ labels: banditCells.value, datasets: [ { label: 'Value', data: banditValues.value, backgroundColor: '#10b981' }, { label: 'Count', data: banditCounts.value, backgroundColor: '#3b82f6' } ] }))
const banditOpts = { responsive: true, maintainAspectRatio: true, aspectRatio: 2, plugins: { legend: { position: 'bottom' } } }

const deltaVSeries = computed(() => {
  const xs = evolLogs.value.map((e: any) => e.meta?.timestamp || e.timestamp || '')
  const ys = evolLogs.value.map((e: any) => e.meta?.deltaV ?? e.deltaV ?? 0)
  return { labels: xs, datasets: [{ label: 'ΔV', data: ys, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.2)', tension: 0.3 }] }
})

const domainRows = computed(() => {
  const rows: Array<{ domain: string; [cell: string]: number }> = []
  const m = domainMatrix.value.matrix || {}
  for (const d of Object.keys(m)) rows.push({ domain: d, ...m[d] })
  return rows
})

onMounted(fetchDiagnostics)
</script>

<style scoped>
.container { padding: 16px; padding-bottom: 32px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 1600px; margin: 0 auto; }
.topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.top-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.main-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; background: #fff; overflow: hidden; height: 460px; display: flex; flex-direction: column; }
.exp-card-full { height: 460px; }
.lyap-card { height: 460px; }
.gov-card { height: 460px; }
.row { display: flex; gap: 8px; align-items: center; margin: 8px 0; }
.short :deep(input) { width: 90px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { border-bottom: 1px solid #eee; padding: 6px 8px; text-align: left; }
td.small { font-size: 11px; }
.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; min-height: 220px; }
.chart { position: relative; height: 240px; width: 100%; }
.chart :deep(canvas) { width: 100% !important; height: 100% !important; }
.txt { width: 100%; min-height: 80px; max-height: 160px; flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }
.sel { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px; }
.small-input { width: 70px; border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px; }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(80px, 1fr)); gap: 8px; margin: 8px 0 12px; }
.kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; }
.kpi-label { font-size: 12px; color: #64748b; }
.kpi-value { font-size: 18px; font-weight: 600; }
.muted { color: #64748b; text-align: center; }
.muted.small { font-size: 12px; }
.meta { display: grid; grid-template-columns: repeat(3, auto); gap: 12px; font-size: 12px; color: #334155; margin-top: 8px; }
.meta.small { font-size: 11px; }
.log-panel { width: min(520px, 90vw); padding: 16px; display: grid; gap: 12px; }
.list { display: grid; gap: 8px; max-height: 60vh; overflow: auto; }
.item { display: none; }
.idx { display: none; }
.resp { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; background: #fff; }
.resp-scroll { display: flex; flex-direction: column; flex: 1; min-height: 180px; max-height: 260px; }
.resp-body { overflow: auto; flex: 1; margin-top: 6px; }
.resp-head { display: flex; gap: 8px; align-items: baseline; }
.badge { background: #eef2ff; color: #3730a3; padding: 2px 6px; border-radius: 6px; font-size: 12px; }
.resp-prompt { font-weight: 600; margin-top: 4px; }
.resp-text { white-space: pre-wrap; color: #111827; }
.resp-text.nowrap { white-space: pre; overflow-x: auto; }
.evol-table { overflow: hidden; flex: 1; }
.exp-results { margin-top: 12px; }
.exp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 8px; }
.exp-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; }
.exp-strategy { font-weight: 600; font-size: 14px; color: #1e293b; margin-bottom: 6px; }
.exp-stat { font-size: 12px; color: #475569; margin: 4px 0; }
.exp-stat .label { font-weight: 500; }
.exp-cells { margin-top: 8px; font-size: 11px; color: #64748b; }
.cell-stat { margin: 2px 0; }
.cell-stat span { font-weight: 600; color: #1e293b; }
</style>


