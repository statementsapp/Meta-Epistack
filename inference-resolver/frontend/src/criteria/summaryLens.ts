import type {
  AnswerAssertion,
  AnswerSection,
  GatheredFind,
} from "./types";

export type LensKind =
  | "claim"
  | "assertion"
  | "section"
  | "check"
  | "defeater"
  | "risk";

export type LensTarget = {
  id: string;
  kind: LensKind;
  label: string;
  body: string;
  url?: string;
  /** Text used for matching / scoring */
  haystack: string;
  salience: number;
};

export type SummarySpan = {
  id: string;
  start: number;
  end: number;
  text: string;
  targetIds: string[];
};

export type LexiconEntry = {
  phrase: string;
  targetIds: string[];
};

const STOP = new Set(
  [
    "a",
    "an",
    "the",
    "of",
    "to",
    "in",
    "on",
    "at",
    "vs",
    "is",
    "are",
    "and",
    "or",
    "with",
    "under",
    "about",
    "was",
    "were",
    "has",
    "had",
    "been",
    "by",
    "for",
    "from",
    "as",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "be",
    "not",
    "no",
    "but",
    "than",
    "into",
    "over",
    "also",
    "more",
    "most",
    "such",
    "may",
    "can",
    "will",
    "would",
    "could",
    "should",
    "given",
    "current",
    "rather",
    "full",
    "versus",
    "within",
    "between",
    "among",
    "across",
    "while",
    "when",
    "where",
    "which",
    "who",
    "whom",
    "their",
    "there",
    "here",
    "have",
    "having",
    "does",
    "did",
    "do",
    "us",
    "usa",
    "u.s",
    "u.s.",
    "china",
    "chinese",
    "policy",
    "evidence",
    "shows",
    "leaving",
    "remain",
    "remains",
    "unmet",
    "direct",
  ].map((s) => s.toLowerCase()),
);

function salienceScore(s: string | undefined): number {
  if (s === "high") return 3;
  if (s === "medium") return 2;
  if (s === "low") return 1;
  return 1;
}

function kindBoost(kind: LensKind): number {
  if (kind === "claim") return 4;
  if (kind === "assertion") return 3;
  if (kind === "section") return 2;
  if (kind === "check") return 2;
  if (kind === "defeater") return 2;
  return 1;
}

/** Extract memorable phrases from a blob for lexicon. */
function phrasesFrom(text: string, max = 8): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out: string[] = [];

  for (const m of t.matchAll(
    /\b\d{1,3}(?:\.\d+)?\s*%|\b\d+\s*nm\b|\b\d{4}\b|\bFLOPS?\b|\bSMIC\b|\bTSMC\b/gi,
  )) {
    out.push(m[0].trim());
  }

  for (const m of t.matchAll(/\b[A-Z][A-Za-z0-9+/.-]{2,24}\b/g)) {
    const w = m[0];
    if (!STOP.has(w.toLowerCase())) out.push(w);
  }

  const words = t.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i].replace(/^[^\w%]+|[^\w%]+$/g, "");
    const b = words[i + 1].replace(/^[^\w%]+|[^\w%]+$/g, "");
    if (!a || !b) continue;
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    if (STOP.has(al) && STOP.has(bl)) continue;
    if (a.length < 3 && !/\d|%/.test(a)) continue;
    const bi = `${a} ${b}`;
    if (bi.length >= 5 && bi.length <= 40) out.push(bi);
    if (i < words.length - 2) {
      const c = words[i + 2].replace(/^[^\w%]+|[^\w%]+$/g, "");
      if (c && c.length >= 3) {
        const tri = `${a} ${b} ${c}`;
        if (tri.length <= 48 && !STOP.has(c.toLowerCase())) out.push(tri);
      }
    }
  }

  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const p of out) {
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    if (STOP.has(k)) continue;
    if (k.length < 2) continue;
    seen.add(k);
    uniq.push(p);
    if (uniq.length >= max * 3) break;
  }
  return uniq.sort((a, b) => b.length - a.length).slice(0, max);
}

export function buildLensTargets(input: {
  finds: GatheredFind[];
  assertions: AnswerAssertion[];
  sections: AnswerSection[];
  checks: { statement: string }[];
  defeaterHunts: { statement: string }[];
  risks: string[];
}): LensTarget[] {
  const targets: LensTarget[] = [];

  for (const f of input.finds) {
    const body = f.claim || f.quoted_or_paraphrase || f.source_title;
    if (!(body || "").trim()) continue;
    targets.push({
      id: `claim:${f.id}`,
      kind: "claim",
      label: "claim",
      body: body.trim(),
      url: f.source_url || undefined,
      haystack: [
        f.claim,
        f.source_title,
        f.quoted_or_paraphrase,
        f.need_statement,
      ]
        .filter(Boolean)
        .join(" "),
      salience: salienceScore(f.salience),
    });
  }

  input.assertions.forEach((a, i) => {
    const body = a.basis ? `${a.statement} — ${a.basis}` : a.statement;
    if (!body.trim()) return;
    targets.push({
      id: `assertion:${i}`,
      kind: "assertion",
      label: "detail",
      body: body.trim(),
      haystack: `${a.statement} ${a.basis} ${(a.defeaters ?? []).map((d) => d.text).join(" ")}`,
      salience: 2,
    });
  });

  input.sections.forEach((s, i) => {
    const body = [s.body, ...(s.items ?? [])].filter(Boolean).join(" ");
    if (!body.trim() && !(s.title || s.port)) return;
    targets.push({
      id: `section:${i}`,
      kind: "section",
      label: "detail",
      body: (body || s.title || s.port).trim(),
      haystack: `${s.title} ${s.port} ${s.body} ${(s.items ?? []).join(" ")}`,
      salience: 2,
    });
  });

  input.checks.forEach((c, i) => {
    if (!c.statement.trim()) return;
    targets.push({
      id: `check:${i}`,
      kind: "check",
      label: "check",
      body: c.statement.trim(),
      haystack: c.statement,
      salience: 2,
    });
  });

  input.defeaterHunts.forEach((d, i) => {
    if (!d.statement.trim()) return;
    targets.push({
      id: `hunt:${i}`,
      kind: "defeater",
      label: "defeater",
      body: d.statement.trim(),
      haystack: d.statement,
      salience: 2,
    });
  });

  input.risks.forEach((r, i) => {
    if (!r.trim()) return;
    targets.push({
      id: `risk:${i}`,
      kind: "risk",
      label: "risk",
      body: r.trim(),
      haystack: r,
      salience: 1,
    });
  });

  return targets;
}

export function buildLexicon(targets: LensTarget[]): LexiconEntry[] {
  const map = new Map<string, Set<string>>();
  for (const t of targets) {
    const phrases = phrasesFrom(t.haystack, t.kind === "claim" ? 10 : 6);
    for (const p of phrases) {
      const k = p.toLowerCase();
      if (!map.has(k)) map.set(k, new Set());
      map.get(k)!.add(t.id);
    }
  }
  return [...map.entries()]
    .map(([phrase, ids]) => ({
      phrase,
      targetIds: [...ids],
    }))
    .sort((a, b) => b.phrase.length - a.phrase.length);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Longest-match non-overlapping spans inside summary. */
export function annotateSummary(
  summary: string,
  lexicon: LexiconEntry[],
  maxSpans = 10,
): SummarySpan[] {
  if (!summary.trim() || !lexicon.length) return [];
  const taken: { start: number; end: number }[] = [];
  const spans: SummarySpan[] = [];

  const overlaps = (start: number, end: number) =>
    taken.some((t) => start < t.end && end > t.start);

  for (const entry of lexicon) {
    if (spans.length >= maxSpans) break;
    const needle = entry.phrase.toLowerCase();
    if (needle.length < 2) continue;
    if (
      !/\d|%|nm|flops/i.test(needle) &&
      !needle.includes(" ") &&
      (STOP.has(needle) || needle.length < 4)
    ) {
      continue;
    }

    const re = new RegExp(
      `(?<![\\w%])${escapeRegExp(needle)}(?![\\w%])`,
      "gi",
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(summary)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      taken.push({ start, end });
      spans.push({
        id: `span-${start}-${end}`,
        start,
        end,
        text: summary.slice(start, end),
        targetIds: entry.targetIds,
      });
      if (spans.length >= maxSpans) break;
    }
  }

  return spans.sort((a, b) => a.start - b.start);
}

export function scoreTarget(
  spanText: string,
  target: LensTarget,
  findIdHits?: Set<string>,
): number {
  const hay = target.haystack.toLowerCase();
  const needle = spanText.toLowerCase();
  let score = kindBoost(target.kind) + target.salience;

  if (hay.includes(needle)) score += 8;
  else {
    const tokens = needle
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t));
    let hits = 0;
    for (const t of tokens) {
      if (hay.includes(t)) hits += 1;
    }
    if (tokens.length) score += (hits / tokens.length) * 6;
    else return -1;
  }

  if (findIdHits && target.kind === "claim") {
    const fid = target.id.replace(/^claim:/, "");
    if (findIdHits.has(fid)) score += 5;
  }

  if (/\d/.test(needle) && hay.includes(needle.replace(/\s+/g, ""))) {
    score += 3;
  }

  return score;
}

export function pickTarget(
  span: SummarySpan,
  targets: LensTarget[],
  assertions: AnswerAssertion[],
): LensTarget | null {
  const byId = new Map(targets.map((t) => [t.id, t]));
  const findIdHits = new Set<string>();
  for (const a of assertions) {
    for (const fid of a.find_ids ?? []) findIdHits.add(fid);
  }

  let best: LensTarget | null = null;
  let bestScore = 0;
  const threshold = 8;

  for (const id of span.targetIds) {
    const t = byId.get(id);
    if (!t) continue;
    const s = scoreTarget(span.text, t, findIdHits);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }

  if (!best || bestScore < threshold) {
    for (const t of targets) {
      const s = scoreTarget(span.text, t, findIdHits);
      if (s > bestScore) {
        bestScore = s;
        best = t;
      }
    }
  }

  if (!best || bestScore < threshold) return null;
  return best;
}

/** Filter spans that have no resolvable target above threshold. */
export function resolveSpans(
  spans: SummarySpan[],
  targets: LensTarget[],
  assertions: AnswerAssertion[],
): { span: SummarySpan; target: LensTarget }[] {
  const out: { span: SummarySpan; target: LensTarget }[] = [];
  for (const span of spans) {
    const target = pickTarget(span, targets, assertions);
    if (!target) continue;
    out.push({
      span: { ...span, targetIds: [target.id] },
      target,
    });
  }
  return out;
}
