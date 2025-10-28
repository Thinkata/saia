// Utility text similarity and normalization helpers with no external deps

export function canonicalize(input: string): string {
  const lower = (input || "").toLowerCase().trim();
  // collapse non-alphanumerics to single hyphen, trim hyphens
  const collapsed = lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // simple alias rules (avoid domain-specific lists, just common punctuation removal)
  return collapsed;
}

export function tokenizeNormalized(text: string): string[] {
  const s = canonicalize(text);
  return s.split(/-+/).filter(Boolean);
}

// Jaro-Winkler similarity (0..1)
export function jaroWinkler(a: string, b: string): number {
  a = (a || "").toLowerCase();
  b = (b || "").toLowerCase();
  if (a === b) return 1;
  const mDist = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches: boolean[] = new Array(a.length).fill(false);
  const bMatches: boolean[] = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - mDist);
    const end = Math.min(i + mDist + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  // Winkler bonus for common prefix up to 4 chars
  let l = 0;
  while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++;
  const p = 0.1;
  return jaro + l * p * (1 - jaro);
}

// Normalized Levenshtein similarity (1 - distance/maxLen)
export function levenshteinSim(a: string, b: string): number {
  a = a || ""; b = b || "";
  if (a === b) return 1;
  const n = a.length, m = b.length;
  if (n === 0 || m === 0) return 0;
  const dp: number[] = new Array(m + 1);
  for (let j = 0; j <= m; j++) dp[j] = j;
  for (let i = 1; i <= n; i++) {
    let prev: number = dp[0]!; dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp: number = dp[j]!;
      const ins = dp[j]! + 1;
      const del = dp[j - 1]! + 1;
      const sub = prev + (a[i - 1] === b[j - 1] ? 0 : 1);
      dp[j] = Math.min(ins, del, sub);
      prev = tmp;
    }
  }
  const dist: number = dp[m]!;
  return Math.max(0, 1 - dist / Math.max(n, m));
}

// Jaccard index over token sets
export function jaccardIndex(tokensA: string[] | Set<string>, tokensB: string[] | Set<string>): number {
  const A = tokensA instanceof Set ? tokensA : new Set(tokensA);
  const B = tokensB instanceof Set ? tokensB : new Set(tokensB);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}

export function fuzzyStringSim(a: string, b: string): number {
  const jw = jaroWinkler(a, b);
  const lv = levenshteinSim(a, b);
  return 0.6 * jw + 0.4 * lv; // weighted blend
}


