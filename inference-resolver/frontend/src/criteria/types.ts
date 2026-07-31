/** Typed ports on the fixed criteria schema. Schema never changes; only
 *  required_ports and port_parameters vary per prompt. */
import type { CallSummary } from "../types";

export const PORT_IDS = [
  "canonical_form",
  "theorem",
  "observation_map",
  "layer_separation",
  "revision_protocol",
  "meta_exhaustiveness",
  "source_class_ranking",
] as const;

export type PortId = (typeof PORT_IDS)[number];

export interface PortSignature {
  id: PortId;
  label: string;
  typeSignature: string;
  /** What the port demands mechanically. */
  description: string;
  /** Short user-facing statement of the criterion. */
  shortCriterion: string;
  /** Why this is an epistemic criterion, not just a UI field. */
  why: string;
}

/** Fixed catalogue. Always defined; selectively required per criteria. */
export const PORT_CATALOGUE: Record<PortId, PortSignature> = {
  canonical_form: {
    id: "canonical_form",
    label: "Canonical form",
    typeSignature: "Form: Proposition | Partition | QuerySchema",
    description:
      "Restate the prompt as a publicly checkable logical form (proposition, exhaustive partition, or typed query schema).",
    shortCriterion:
      "Fix the question's scope and answer space before attaching any evidence.",
    why: "Without a shared form of the question, parties can talk past each other and no later attachment can be checked for relevance. Fixing the form is what makes disagreement about the answer, rather than about what was asked.",
  },
  theorem: {
    id: "theorem",
    label: "Theorem",
    typeSignature: "Theorem: { statement: Formula; fragment: LogicFragment; proof_sketch?: Derivation }",
    description:
      "A deterministic answer assertion in a declared logic fragment. Preferred over free-form probability language.",
    shortCriterion:
      "Express derivable answer assertions precisely enough to inspect, challenge, and withdraw.",
    why: "Vague confidence talk cannot be audited or revised. An answer assertion stated as a theorem in a known logic can be derived, attacked, or withdrawn as a unit. This is the unit epistemic work actually moves in.",
  },
  observation_map: {
    id: "observation_map",
    label: "Observation map",
    typeSignature: "ObsMap: Formula → ObservablePredicate[]",
    description:
      "Explicit bridge from abstract formulae to checkable observations / measurements.",
    shortCriterion:
      "Specify observable conditions bearing on each empirical answer assertion.",
    why: "Abstract answer assertions float free of the world unless something says what would count as seeing them hold. The map is what makes an answer publicly checkable rather than merely assertable.",
  },
  layer_separation: {
    id: "layer_separation",
    label: "Layer separation",
    typeSignature: "Layers: { intersubjective: Layer; agent_relative?: Layer }",
    description:
      "Keep the publicly checkable layer syntactically separate from any agent-relative layer.",
    shortCriterion:
      "Separate publicly checkable assertions from values, preferences, and personal perspectives.",
    why: "Mixing “what we can jointly verify” with “what holds relative to an agent” lets private stance masquerade as shared fact. Keeping the layers apart prevents that conflation from polluting the public case.",
  },
  revision_protocol: {
    id: "revision_protocol",
    label: "Revision protocol",
    typeSignature: "Protocol: { defeaters: Defeater[]; trigger: Condition; update: Rule }",
    description:
      "Declared defeaters and update rules for each non-trivial assertion made by the eventual answer.",
    shortCriterion:
      "Declare what evidence would defeat each answer assertion and trigger revision.",
    why: "An answer assertion with no stated defeaters is insulated from evidence. Declaring how it would be revised makes the eventual answer responsible to future observation rather than a closed dogma. This refers to statements produced by the answer, not claims ingested from sources.",
  },
  meta_exhaustiveness: {
    id: "meta_exhaustiveness",
    label: "Meta-exhaustiveness",
    typeSignature: "Exhaustiveness: StructuralCover",
    description:
      "Establish that the answer covers the full structure of the answer space. Concrete enumeration is allowed when it strengthens that coverage.",
    shortCriterion:
      "Cover the full structure of the answer space, including material alternatives.",
    why: "A strong answer owns the whole shape of the question: the branches, scenarios, or cases that completeness requires. Structural coverage is the criterion; listing concrete alternatives is fine when it helps prove that coverage.",
  },
  source_class_ranking: {
    id: "source_class_ranking",
    label: "Source class ranking",
    typeSignature: "Ranking: SourceClass[] (priority, independence, failure_modes)",
    description:
      "If the answer relies on distinct evidence classes, it must state how those classes are weighted relative to one another.",
    shortCriterion:
      "Make the answer's weighting of distinct evidence classes explicit and justified.",
    why: "When an answer depends on more than one kind of evidence, the ranking belongs in the answer itself. This is not an upstream retrieval setting; it is a requirement on how the best answer presents and weights what it uses.",
  },
};

/** Plain-English gloss for each declared logic fragment. */
export const LOGIC_FRAGMENT_LABELS: Record<string, { title: string; blurb: string }> = {
  classical_propositional: {
    title: "Classical propositional logic",
    blurb: "True/false answer assertions combined with and / or / not. No quantifying over individuals.",
  },
  first_order: {
    title: "First-order logic",
    blurb: "Adds quantifiers over individuals (all / some) so answer assertions can range over a domain.",
  },
  temporal_bounded: {
    title: "Bounded temporal logic",
    blurb: "Answer assertions are tied to explicit time windows or horizons: past, present, or constrained futures.",
  },
  modal_epistemic: {
    title: "Modal / epistemic logic",
    blurb: "Handles necessity, possibility, and knowledge/belief operators, not just bare fact.",
  },
  comparative_order: {
    title: "Comparative order",
    blurb: "Ranking and better-than relations, rather than absolute true/false verdicts.",
  },
};

export type InquiryType =
  | "factual_closed"
  | "causal_mechanistic"
  | "comparative_evaluative"
  | "historical_reconstruction"
  | "predictive_constrained"
  | "definitional_taxonomic";

export type RejectedType =
  | "preference_aesthetic"
  | "open_future_prediction"
  | "pure_normative"
  | "non_partitionable"
  | "pure_personalization";

export type LogicFragment =
  | "classical_propositional"
  | "first_order"
  | "temporal_bounded"
  | "modal_epistemic"
  | "comparative_order";

export interface SurfaceFeatures {
  tense: "past" | "present" | "future" | "mixed" | "untensed";
  hasQuantifiers: boolean;
  hasModals: boolean;
  hasEvaluativeLanguage: boolean;
  closedness: "closed" | "semi_open" | "open";
}

export interface AnswerhoodSketch {
  direct_answer: string;
  partial_answer: string;
  presupposition_challenge: string;
  partition_licensed: boolean;
  open_answerhood: string;
}

export interface Presupposition {
  text: string;
  status: "accepted" | "contested" | "challengeable";
}

export interface CriteriaObject {
  prompt_hash: string;
  inquiry_type: string;
  logic_fragment: string;
  required_ports: PortId[];
  port_parameters: Record<string, unknown>;
  port_applicability: Record<string, string>;
  port_layers?: Record<string, string>;
  answerhood?: AnswerhoodSketch;
  presuppositions?: Presupposition[];
  prompt_fixes?: string;
  prompt_leaves_open?: string;
  version: string;
  /** UI helper: how a complete answer is judged. */
  completeness_template: string;
  surface_features: SurfaceFeatures;
}

export type BouncerResult =
  | {
      admitted: true;
      inquiry_type: string;
      features: SurfaceFeatures;
      note: string;
    }
  | {
      admitted: false;
      rejected_type: string;
      label: string;
      message: string;
      features: SurfaceFeatures;
    };

export interface DesignResult {
  run_id?: number;
  model?: string;
  bouncer: BouncerResult;
  criteria: CriteriaObject | null;
  calls?: CallSummary[];
  total_tokens?: number;
  total_cost_usd?: number;
  warnings?: string[];
}

export interface AnswerSection {
  port: string;
  title: string;
  body: string;
  items: string[];
}

export interface AnswerAssertion {
  statement: string;
  basis: string;
  defeaters: string[];
}

export interface CriteriaAnswer {
  headline: string;
  summary: string;
  sections: AnswerSection[];
  assertions: AnswerAssertion[];
  residual_uncertainty: string[];
}

export interface AnswerResult {
  run_id: number;
  model: string;
  answer: CriteriaAnswer;
  calls: CallSummary[];
  total_tokens: number;
  total_cost_usd: number;
  warnings?: string[];
}
