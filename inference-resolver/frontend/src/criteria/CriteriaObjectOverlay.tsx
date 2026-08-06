import { useEffect, useState } from "react";
import type { CriteriaObject } from "./types";

function criteriaPayload(criteria: CriteriaObject) {
  return {
    prompt_hash: criteria.prompt_hash,
    inquiry_type: criteria.inquiry_type,
    logic_fragment: criteria.logic_fragment,
    resolution_mode: criteria.resolution_mode,
    required_ports: criteria.required_ports,
    port_layers: criteria.port_layers,
    port_parameters: criteria.port_parameters,
    port_applicability: criteria.port_applicability,
    answerhood: criteria.answerhood,
    presuppositions: criteria.presuppositions,
    prompt_fixes: criteria.prompt_fixes,
    prompt_leaves_open: criteria.prompt_leaves_open,
    version: criteria.version,
  };
}

export function CriteriaObjectOverlay({
  criteria,
  onClose,
}: {
  criteria: CriteriaObject;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(criteriaPayload(criteria), null, 2);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className="answer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Criteria object"
    >
      <button
        type="button"
        className="answer-overlay-backdrop"
        aria-label="Dismiss criteria object"
        onClick={onClose}
      />
      <div className="answer-overlay-panel criteria-object-overlay-panel">
        <div className="answer-overlay-top">
          <div className="section-title" style={{ marginTop: 0 }}>
            Criteria object
          </div>
          <div className="criteria-object-overlay-actions">
            <button type="button" className="secondary answer-overlay-close" onClick={onCopy}>
              {copied ? "Copied" : "Copy JSON"}
            </button>
            <button type="button" className="secondary answer-overlay-close" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="answer-overlay-body criteria-object-overlay-body">
          <pre className="mono criteria-object-json-hero">{json}</pre>
        </div>
      </div>
    </div>
  );
}
