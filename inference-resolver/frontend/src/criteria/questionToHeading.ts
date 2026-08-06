/**
 * Turn a single question (or sentence) into a display heading.
 *
 * Examples:
 *   "Where is Los Angeles?" → "Where Los Angeles Is"
 *   "Will the Red Sox make the playoffs?" → "Whether the Red Sox Will Make the Playoffs"
 *   "Is Pluto a planet?" → "Whether Pluto Is a Planet"
 *   "Does the Fed raise rates?" → "Whether the Fed Raises Rates"
 */

const SMALL = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "on",
  "to",
  "for",
  "vs",
  "vs.",
  "via",
  "by",
  "at",
  "as",
  "from",
  "into",
  "over",
  "with",
  "without",
]);

const MODALS = new Set([
  "will",
  "would",
  "can",
  "could",
  "should",
  "might",
  "may",
  "shall",
  "must",
]);

const BE = new Set(["is", "are", "was", "were", "am", "be", "been", "being"]);
const DO = new Set(["do", "does", "did"]);
const HAVE = new Set(["have", "has", "had"]);
const WH = new Set(["where", "what", "who", "whom", "whose", "why", "when", "how", "which"]);

const DET = new Set(["the", "a", "an", "this", "that", "these", "those", "my", "our", "your"]);

/** Words that usually start the predicate after a short subject. */
const PREDICATE_START = new Set([
  "make",
  "makes",
  "made",
  "making",
  "get",
  "gets",
  "got",
  "getting",
  "go",
  "goes",
  "went",
  "going",
  "come",
  "comes",
  "came",
  "coming",
  "take",
  "takes",
  "took",
  "taking",
  "give",
  "gives",
  "gave",
  "giving",
  "find",
  "finds",
  "found",
  "finding",
  "win",
  "wins",
  "won",
  "winning",
  "lose",
  "loses",
  "lost",
  "losing",
  "reach",
  "reaches",
  "reached",
  "raise",
  "raises",
  "raised",
  "fall",
  "falls",
  "fell",
  "falling",
  "rise",
  "rises",
  "rose",
  "rising",
  "cause",
  "causes",
  "caused",
  "become",
  "becomes",
  "became",
  "remain",
  "remains",
  "remained",
  "start",
  "starts",
  "started",
  "end",
  "ends",
  "ended",
  "begin",
  "begins",
  "began",
  "happen",
  "happens",
  "happened",
  "exist",
  "exists",
  "existed",
  "mean",
  "means",
  "meant",
  "need",
  "needs",
  "needed",
  "want",
  "wants",
  "wanted",
  "seem",
  "seems",
  "seemed",
  "look",
  "looks",
  "looked",
  "run",
  "runs",
  "ran",
  "running",
  "play",
  "plays",
  "played",
  "playing",
  "beat",
  "beats",
  "beaten",
  "hit",
  "hits",
  "affect",
  "affects",
  "affected",
  "change",
  "changes",
  "changed",
  "lead",
  "leads",
  "led",
  "help",
  "helps",
  "helped",
  "stop",
  "stops",
  "stopped",
  "keep",
  "keeps",
  "kept",
  "know",
  "knows",
  "knew",
  "think",
  "thinks",
  "thought",
  "believe",
  "believes",
  "believed",
  "say",
  "says",
  "said",
  "show",
  "shows",
  "showed",
  "shown",
  "prove",
  "proves",
  "proved",
  "use",
  "uses",
  "used",
  "work",
  "works",
  "worked",
  "live",
  "lives",
  "lived",
  "die",
  "dies",
  "died",
  "grow",
  "grows",
  "grew",
  "grown",
  "fail",
  "fails",
  "failed",
  "pass",
  "passes",
  "passed",
  "miss",
  "misses",
  "missed",
  "join",
  "joins",
  "joined",
  "leave",
  "leaves",
  "left",
  "enter",
  "enters",
  "entered",
  "exit",
  "exits",
  "exited",
  "qualify",
  "qualifies",
  "qualified",
  "clinch",
  "clinches",
  "clinched",
  "finish",
  "finishes",
  "finished",
  "still",
  "already",
  "ever",
  "never",
  "really",
  "actually",
  "even",
  "also",
  "just",
  "only",
  "not",
  "n't",
  "likely",
  "able",
  "unable",
  "about",
  "around",
  "nearly",
  "almost",
  "more",
  "less",
  "better",
  "worse",
  "best",
  "worst",
]);

function titleWord(w: string): string {
  if (!w) return w;
  if (/^[A-Z]{2,}$/.test(w)) return w;
  if (/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(w)) return w;
  // Preserve internal caps like iPhone, but title-case ordinary words
  if (w.length > 1 && /[a-z]/.test(w[0]) && /[A-Z]/.test(w.slice(1))) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function titlePhrase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const bare = w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9']+$/g, "");
      const lower = bare.toLowerCase();
      if (SMALL.has(lower)) {
        const lead = w.slice(0, w.indexOf(bare));
        const trail = w.slice(w.indexOf(bare) + bare.length);
        return `${lead}${lower}${trail}`;
      }
      if (/^[A-Z]{2,}$/.test(bare)) return w;
      return titleWord(w);
    })
    .join(" ");
}

function expandContractions(s: string): string {
  return s
    .replace(/\b(who|what|where|when|why|how|which)'s\b/gi, "$1 is")
    .replace(/\b(who|what|where|when|why|how|which)'re\b/gi, "$1 are")
    .replace(/\b(who|what|where|when|why|how|which)'ll\b/gi, "$1 will")
    .replace(/\b(who|what|where|when|why|how|which)'d\b/gi, "$1 would")
    .replace(/\bwhats\b/gi, "what is")
    .replace(/\bwheres\b/gi, "where is")
    .replace(/\bwhos\b/gi, "who is")
    .replace(/\bhows\b/gi, "how is")
    .replace(/\bwhys\b/gi, "why is")
    .replace(/\bwhens\b/gi, "when is")
    .replace(/\bgonna\b/gi, "going to")
    .replace(/\bwanna\b/gi, "want to")
    .replace(/\bgotta\b/gi, "got to")
    .replace(/\bimma\b/gi, "i am going to")
    .replace(/\bbout\b/gi, "about")
    .replace(/\bcuz\b/gi, "because")
    .replace(/\bit's\b/gi, "it is")
    .replace(/\bthat's\b/gi, "that is")
    .replace(/\bthere's\b/gi, "there is")
    .replace(/\bhere's\b/gi, "here is")
    .replace(/\bwhat's\b/gi, "what is")
    .replace(/\bwho's\b/gi, "who is")
    .replace(/\bwhere's\b/gi, "where is")
    .replace(/\bwhen's\b/gi, "when is")
    .replace(/\bwhy's\b/gi, "why is")
    .replace(/\bhow's\b/gi, "how is")
    .replace(/\bwon't\b/gi, "will not")
    .replace(/\bcan't\b/gi, "cannot")
    .replace(/\bshan't\b/gi, "shall not")
    .replace(/\b(\w+)n't\b/gi, "$1 not");
}

function looksProper(token: string): boolean {
  if (!token) return false;
  if (/^[A-Z]/.test(token)) return true;
  if (/^[A-Z0-9]{2,}$/.test(token)) return true;
  return false;
}

/**
 * Split "the Red Sox make the playoffs" into subject / predicate.
 */
export function splitSubjectPredicate(rest: string): {
  subject: string;
  predicate: string;
} {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { subject: "", predicate: "" };
  if (tokens.length === 1) return { subject: tokens[0], predicate: "" };

  // Prefer the first clear predicate verb after at least one subject token.
  for (let j = 1; j < tokens.length; j++) {
    if (PREDICATE_START.has(tokens[j].toLowerCase())) {
      return {
        subject: tokens.slice(0, j).join(" "),
        predicate: tokens.slice(j).join(" "),
      };
    }
  }

  let i = 0;
  if (DET.has(tokens[0].toLowerCase())) {
    i = 1;
    while (i < tokens.length && looksProper(tokens[i])) i += 1;
    if (i === 1) i = Math.min(2, tokens.length);
  } else if (looksProper(tokens[0])) {
    i = 1;
    while (i < tokens.length && looksProper(tokens[i])) i += 1;
    // "United States of America remains …"
    while (
      i + 1 < tokens.length &&
      SMALL.has(tokens[i].toLowerCase()) &&
      looksProper(tokens[i + 1])
    ) {
      i += 2;
      while (i < tokens.length && looksProper(tokens[i])) i += 1;
    }
  } else {
    i = 1;
  }

  if (i > tokens.length) i = tokens.length;
  // Keep a pure NP intact (e.g. "Los Angeles") — empty predicate is fine.
  if (i === tokens.length) {
    return { subject: tokens.join(" "), predicate: "" };
  }

  return {
    subject: tokens.slice(0, i).join(" "),
    predicate: tokens.slice(i).join(" "),
  };
}

function thirdPerson(verb: string): string {
  const v = verb.toLowerCase();
  if (!v) return verb;
  if (v === "have") return "Has";
  if (v === "do") return "Does";
  if (v === "go") return "Goes";
  if (v.endsWith("y") && v.length > 1 && !/[aeiou]y$/i.test(v)) {
    return titleWord(`${v.slice(0, -1)}ies`);
  }
  if (/(?:s|sh|ch|x|z|o)$/i.test(v)) return titleWord(`${v}es`);
  return titleWord(`${v}s`);
}

function isQuestionLike(text: string): boolean {
  const t = text.trim();
  if (t.endsWith("?")) return true;
  const first = t.split(/\s+/)[0]?.toLowerCase() ?? "";
  return (
    WH.has(first) ||
    MODALS.has(first) ||
    BE.has(first) ||
    DO.has(first) ||
    HAVE.has(first)
  );
}

function joinHeading(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function questionToHeading(text: string): string {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return "";

  const expanded = expandContractions(raw);
  const cleaned = expanded.replace(/\?+$/, "").trim();
  if (!cleaned) return "";

  // Informal / future: "whats gonna happen with detroit"
  // → "What Will Happen with Detroit"
  const happen = cleaned.match(
    /^(what)\s+(?:(?:is\s+)?going\s+to|will)\s+happen(?:\s+(with|to|in|for|about))?\s*(.*)$/i,
  );
  if (happen) {
    const prep = happen[2] ? happen[2].toLowerCase() : "";
    const rest = (happen[3] || "").trim();
    return joinHeading("What Will Happen", prep, titlePhrase(rest));
  }

  const whatHappens = cleaned.match(
    /^(what)\s+happens(?:\s+(with|to|in|for|about))?\s*(.*)$/i,
  );
  if (whatHappens) {
    const prep = whatHappens[2] ? whatHappens[2].toLowerCase() : "";
    const rest = (whatHappens[3] || "").trim();
    return joinHeading("What Happens", prep, titlePhrase(rest));
  }

  const tokens = cleaned.split(/\s+/);
  const first = tokens[0].toLowerCase();
  const rest = tokens.slice(1).join(" ");

  // Avoid WH+be mistaking "going to …" as a nominative: "What is going to X"
  // → "What Will X" when X starts with a verb-ish word.
  if (
    WH.has(first) &&
    tokens.length >= 4 &&
    tokens[1].toLowerCase() === "is" &&
    tokens[2].toLowerCase() === "going" &&
    tokens[3].toLowerCase() === "to"
  ) {
    const after = tokens.slice(4).join(" ");
    return joinHeading(titleWord(first), "Will", titlePhrase(after));
  }

  // --- WH + be: Where is Los Angeles → Where Los Angeles Is
  // Why is the sky blue → Why the Sky Is Blue
  if (WH.has(first) && tokens.length >= 3 && BE.has(tokens[1].toLowerCase())) {
    const be = titleWord(tokens[1]);
    const after = tokens.slice(2).join(" ");
    const { subject, predicate } = splitSubjectPredicate(after);
    if (predicate) {
      return joinHeading(
        titleWord(first),
        titlePhrase(subject),
        be,
        titlePhrase(predicate),
      );
    }
    return joinHeading(titleWord(first), titlePhrase(after), be);
  }

  // --- WH + modal: When will the Red Sox make the playoffs
  // → When the Red Sox Will Make the Playoffs
  if (WH.has(first) && tokens.length >= 3 && MODALS.has(tokens[1].toLowerCase())) {
    const modal = titleWord(tokens[1]);
    const { subject, predicate } = splitSubjectPredicate(tokens.slice(2).join(" "));
    return joinHeading(
      titleWord(first),
      titlePhrase(subject),
      modal,
      titlePhrase(predicate),
    );
  }

  // --- WH + do/does/did: What does DNA code for → What DNA Codes For
  if (WH.has(first) && tokens.length >= 3 && DO.has(tokens[1].toLowerCase())) {
    const aux = tokens[1].toLowerCase();
    const after = tokens.slice(2).join(" ");
    const { subject, predicate } = splitSubjectPredicate(after);
    if (predicate) {
      const [verb, ...tail] = predicate.split(/\s+/);
      const headed =
        aux === "does"
          ? thirdPerson(verb)
          : aux === "did"
            ? titleWord(verb)
            : titleWord(verb);
      return joinHeading(
        titleWord(first),
        titlePhrase(subject),
        headed,
        titlePhrase(tail.join(" ")),
      );
    }
    return joinHeading(titleWord(first), titlePhrase(after));
  }

  // --- WH + have/has/had: Why has inflation fallen
  if (WH.has(first) && tokens.length >= 3 && HAVE.has(tokens[1].toLowerCase())) {
    const have = titleWord(tokens[1]);
    const { subject, predicate } = splitSubjectPredicate(tokens.slice(2).join(" "));
    return joinHeading(
      titleWord(first),
      titlePhrase(subject),
      have,
      titlePhrase(predicate),
    );
  }

  // --- Bare WH leftover: How come … / What about …
  if (WH.has(first) && rest) {
    return joinHeading(titleWord(first), titlePhrase(rest));
  }

  // --- Yes/no modal: Will the Red Sox make the playoffs
  // → Whether the Red Sox Will Make the Playoffs
  if (MODALS.has(first) && rest) {
    const modal = titleWord(first);
    const { subject, predicate } = splitSubjectPredicate(rest);
    return joinHeading("Whether", titlePhrase(subject), modal, titlePhrase(predicate));
  }

  // --- Yes/no be: Is Pluto a planet → Whether Pluto Is a Planet
  if (BE.has(first) && rest) {
    const be = titleWord(first);
    const { subject, predicate } = splitSubjectPredicate(rest);
    return joinHeading("Whether", titlePhrase(subject), be, titlePhrase(predicate));
  }

  // --- Yes/no do/does/did: Does the Fed raise rates
  if (DO.has(first) && rest) {
    const aux = first;
    const { subject, predicate } = splitSubjectPredicate(rest);
    if (predicate) {
      const [verb, ...tail] = predicate.split(/\s+/);
      const headed =
        aux === "does" ? thirdPerson(verb) : titleWord(verb);
      return joinHeading(
        "Whether",
        titlePhrase(subject),
        headed,
        titlePhrase(tail.join(" ")),
      );
    }
    return joinHeading("Whether", titlePhrase(rest));
  }

  // --- Yes/no have/has/had
  if (HAVE.has(first) && rest) {
    const have = titleWord(first);
    const { subject, predicate } = splitSubjectPredicate(rest);
    return joinHeading("Whether", titlePhrase(subject), have, titlePhrase(predicate));
  }

  if (isQuestionLike(raw)) {
    return titlePhrase(cleaned);
  }

  // Statement: keep original casing aside from trimming ?
  return cleaned.replace(/\?+$/, "").trim();
}
