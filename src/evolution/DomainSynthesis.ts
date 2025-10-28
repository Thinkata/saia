import { Metrics } from "../metrics";
import { DomainSignature } from "../cells/CellFactory";
import { canonicalize, tokenizeNormalized, jaccardIndex, fuzzyStringSim } from "../utils/text";

const STOPWORDS = new Set<string>([
  "the","a","an","and","or","but","of","in","on","for","to","with","by","is","are","was","were","be","as","at","it","this","that","these","those","from","into","over","about","how","what","why","which","when","who","whom","because","than","then","there","here","you","your","we","our","they","their","i","me","my","he","she","him","her","his","hers","them","us","do","does","did","can","could","should","would","will","just","not","no","yes","if","else","let","make","using","use","used","based","like","also","more","most","very","much","many"
]);

function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

function normalizeDomain(raw: string): string {
  const d = canonicalize(String(raw || ""));
  // remove weak suffixes after canonicalization
  return d.replace(/-(basics|beginner|beginners|intro|introduction|guide|guides|tutorial|tutorials|fundamentals|overview)$/g, "").replace(/^-+|-+$/g, "");
}

export class DomainSynthesis {
  // Discover candidate domains dynamically from model-suggested domains (priority) and token frequency
  static discover(maxNew: number = 3, minCount: number = 3, minSuggested: number = 2): DomainSignature[] {
    const detailed: any = Metrics.detailed();
    const recent = detailed.recent || [];
    const counts: Record<string, number> = {};
    const suggestedCounts: Record<string, { n: number; tags: Set<string> }> = {};
    for (const e of recent) {
      // Prefer explicit domain suggestion from the model if present
      if (typeof e.domain === 'string' && e.domain.trim().length > 0) {
        const d = normalizeDomain(e.domain);
        counts[d] = (counts[d] ?? 0) + 3; // weight suggested domains higher
        const entry = (suggestedCounts[d] ||= { n: 0, tags: new Set<string>() });
        entry.n += 1;
        if (Array.isArray(e.tags)) for (const t of e.tags) entry.tags.add(String(t).toLowerCase());
        continue;
      }
      const text = `${e.prompt || ""} ${e.response || ""}`;
      for (const tok of tokenize(text)) {
        counts[tok] = (counts[tok] ?? 0) + 1;
      }
    }
    const sorted = Object.entries(counts)
      .filter(([, n]) => n >= minCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxNew);

    const sigs: DomainSignature[] = [];
    // First, include any model-suggested domains that meet minSuggested, prioritized by frequency
    const suggestedSorted = Object.entries(suggestedCounts).sort((a, b) => (b[1].n - a[1].n));
    for (const [domain, info] of suggestedSorted) {
      if (info.n >= minSuggested) {
        const id = domain.replace(/[^a-z0-9]/g, "-");
        const domainWords = tokenizeNormalized(domain);
        const rawTags = Array.from(info.tags);
        const tagList = [...new Set([...domainWords, ...rawTags.flatMap(t => tokenizeNormalized(String(t)))])].slice(0, 12);
        const tags = tagList.length ? tagList : domainWords;
        sigs.push({
          id,
          tags,
          temperature: 0.4,
          systemPrompt: `You specialize in tasks related to "${domain}". Provide focused, expert, and concise responses.`,
        });
      }
    }
    // Then, backfill from token frequency until maxNew is met
    for (const [tok] of sorted) {
      const id = tok.replace(/[^a-z0-9]/g, "-");
      const baseTokens = tokenizeNormalized(tok);
      const tags = Array.from(new Set(baseTokens.flatMap(t => [t, `${t}s`, `${t}ing`, `${t}ed`])));
      if (sigs.find(s => s.id === id)) continue;
      if (sigs.length >= maxNew) break;
      sigs.push({
        id,
        tags,
        temperature: 0.4,
        systemPrompt: `You specialize in tasks related to "${tok}". Provide focused, expert, and concise responses.`,
      });
    }
    return sigs;
  }

  // Identify redundant cells by fuzzy/canonical name similarity and tag Jaccard; keep best performer
  static findRedundantCells(allCellIds: string[]): string[] {
    const detailed: any = Metrics.detailed();
    const perCell: Record<string, any> = detailed.perCell || {};
    const ids = allCellIds.slice();
    const redundant: string[] = [];
    const used = new Set<string>();
    const nameSimThresh = Number(process.env.MERGE_MIN_NAME_SIM || 0.88);
    const tagSimThresh = Number(process.env.MERGE_MIN_TAG_JACCARD || 0.5);
    const minObs = Number(process.env.MERGE_MIN_OBS || 5);
    const tagMap: Record<string, Set<string>> = {};
    for (const id of ids) {
      const rec = (perCell[id] || {});
      const capabilityTokens = new Set<string>((rec.tags || rec.capabilities || []).flatMap((t: string) => tokenizeNormalized(String(t))));
      tagMap[id] = capabilityTokens;
    }
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i]!; if (used.has(a)) continue;
      let winner = a;
      for (let j = i + 1; j < ids.length; j++) {
        const b = ids[j]!; if (used.has(b)) continue;
        const sa = canonicalize(a.replace(/^cell-/, ''));
        const sb = canonicalize(b.replace(/^cell-/, ''));
        const nameSim = fuzzyStringSim(sa, sb);
        const tagSim = jaccardIndex(tagMap[a] || new Set(), tagMap[b] || new Set());
        const obsA = (perCell[a]?.count ?? 0); const obsB = (perCell[b]?.count ?? 0);
        if (nameSim >= nameSimThresh && tagSim >= tagSimThresh && obsA >= minObs && obsB >= minObs) {
          // choose winner: higher SAI, then lower avgLatency, then higher count
          const aSAI = perCell[a]?.SAI ?? 0; const bSAI = perCell[b]?.SAI ?? 0;
          const aLat = perCell[a]?.avgLatency ?? Number.MAX_SAFE_INTEGER; const bLat = perCell[b]?.avgLatency ?? Number.MAX_SAFE_INTEGER;
          const aCnt = perCell[a]?.count ?? 0; const bCnt = perCell[b]?.count ?? 0;
          winner = (aSAI > bSAI) || (aSAI === bSAI && aLat < bLat) || (aSAI === bSAI && aLat === bLat && aCnt >= bCnt) ? a : b;
          const loser = winner === a ? b : a;
          redundant.push(loser);
          used.add(loser);
        }
      }
      used.add(winner);
    }
    return redundant;
  }
}


