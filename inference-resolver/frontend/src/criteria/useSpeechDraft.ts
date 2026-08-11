import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  onerror:
    | ((
        this: SpeechRecognitionLike,
        ev: { error: string; message?: string },
      ) => void)
    | null;
  onresult:
    | ((
        this: SpeechRecognitionLike,
        ev: {
          resultIndex: number;
          results: ArrayLike<{
            isFinal: boolean;
            0: { transcript: string };
            length: number;
          }>;
        },
      ) => void)
    | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechDraftSupported(): boolean {
  return getSpeechRecognitionCtor() != null;
}

const QUESTION_START =
  /^(who|what|when|where|why|how|which|whose|whom|is|are|am|was|were|do|does|did|can|could|will|would|shall|should|may|might|must|have|has|had|isn't|aren't|don't|doesn't|didn't|won't|wouldn't|can't|couldn't)\b/i;

function capitalizeLead(s: string): string {
  const m = s.match(/^([^A-Za-z]*)([A-Za-z])([\s\S]*)$/);
  if (!m) return s;
  return `${m[1]}${m[2].toUpperCase()}${m[3]}`;
}

/** Capitalize sentence starts and add terminal . / ? when missing. */
export function formatSpeechDraft(
  raw: string,
  opts: { final?: boolean } = {},
): string {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";

  // Capitalize after .?! (and start).
  text = text.replace(
    /(^|[.?!]\s+)([a-z])/g,
    (_, boundary: string, ch: string) => `${boundary}${ch.toUpperCase()}`,
  );
  text = capitalizeLead(text);

  if (opts.final && !/[.?!…]$/.test(text)) {
    text += QUESTION_START.test(text) ? "?" : ".";
  }
  return text;
}

type UseSpeechDraftOptions = {
  onDraft: (text: string) => void;
  /** Called after a final transcript is applied. */
  onFinal?: () => void;
};

export function useSpeechDraft({ onDraft, onFinal }: UseSpeechDraftOptions) {
  const [supported] = useState(() => speechDraftSupported());
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDraftRef = useRef(onDraft);
  const onFinalRef = useRef(onFinal);
  onDraftRef.current = onDraft;
  onFinalRef.current = onFinal;

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const intentionalStop = useRef(false);

  useEffect(() => {
    if (!supported) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    rec.onstart = () => {
      setListening(true);
      setError(null);
    };

    rec.onend = () => {
      setListening(false);
      intentionalStop.current = false;
    };

    rec.onerror = (ev) => {
      if (ev.error === "aborted" || ev.error === "no-speech") {
        setListening(false);
        return;
      }
      if (ev.error === "not-allowed") {
        setError("Mic blocked — allow microphone for this site.");
      } else {
        setError(ev.message || `Speech error: ${ev.error}`);
      }
      setListening(false);
    };

    rec.onresult = (ev) => {
      let interim = "";
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const piece = ev.results[i][0]?.transcript ?? "";
        if (ev.results[i].isFinal) finalText += piece;
        else interim += piece;
      }
      if (finalText.trim()) {
        onDraftRef.current(formatSpeechDraft(finalText, { final: true }));
        onFinalRef.current?.();
      } else if (interim.trim()) {
        onDraftRef.current(formatSpeechDraft(interim, { final: false }));
      }
    };

    recRef.current = rec;
    return () => {
      intentionalStop.current = true;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, [supported]);

  const stop = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    intentionalStop.current = true;
    try {
      rec.stop();
    } catch {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
    setListening(false);
  }, []);

  const discard = useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      intentionalStop.current = true;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
    }
    setListening(false);
    setError(null);
  }, []);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec || listening) return;
    setError(null);
    try {
      rec.start();
    } catch {
      // Already started or race — ignore.
    }
  }, [listening]);

  return { supported, listening, error, start, stop, discard };
}
