// Agent architecture types — core, vertical-agnostic.
// VerticalProfile = the industry-specific layer that sits on top of the universal
// FrontDesk core rules. Profiles are prompt templates, NOT trained models: every
// vertical uses the same Realtime model and only differs in injected instructions.

// Canonical business-type ids. These match the values stored in businesses.business_type.
// 'other' is accepted at the DB level and resolves to the 'generic' vertical (see registry).
export type VerticalId =
  | 'generic'
  | 'restaurant'
  | 'auto_repair'
  | 'salon'
  | 'clinic'
  | 'tutoring'
  | 'home_services';

// Core caller details that post-call extraction can assess deterministically (they map to fields
// ExtractionResult already returns). Richer vertical details (party size, address, reason) live in
// notes/description and are NOT assessed here — see assessCollection() in call-pipeline/extraction.
export type CollectableField = 'name' | 'phone' | 'date' | 'time' | 'service';

export interface VerticalProfile {
  /** Stable id — matches businesses.business_type (except 'generic', the fallback). */
  id: VerticalId;
  /** Human label for UI dropdowns. */
  label: string;
  /** One-line description of the business kind. */
  description: string;
  /** Common caller intents the front desk should expect in this vertical. */
  commonIntents: string[];
  /** How this industry names things — guides the agent's word choice. */
  terminology: string;
  /** Recommended knowledge-base categories (also surfaced in the KB UI). */
  knowledgeCategories: string[];
  /** Service/reason interpretation examples — how vague phrases map to intent here. */
  interpretationExamples: string[];
  /** What to prioritise collecting for an appointment / service request in this vertical. */
  collectionPriorities: string;
  /**
   * Core fields the front desk should capture for an actionable request — the MINIMUM completeness
   * schema and single source of truth for post-call completeness checks (assessCollection). The
   * prompt renders these (promptBuilder.renderCoreFields) ALONGSIDE collectionPriorities, which
   * remains the complementary, vertical-specific guidance (party size, vehicle, location, …) — the
   * two are complementary, not duplicates. Keep them consistent. 'phone' is optional everywhere
   * (product rule: never block a captured request on a missing phone).
   */
  requiredFields: CollectableField[];
  /** Nice-to-have core fields (not flagged as missing for staff). */
  optionalFields: CollectableField[];
  /** Things the agent must NOT assume or fabricate for this vertical. */
  forbiddenAssumptions: string[];
  /** Default wording when the relevant knowledge is missing. */
  fallbackWording: string;

  // ── Profile-setup suggestions (defaults only — the owner can add/remove/customize) ──
  /** Suggested request types the owner can start from in the Profile tab. */
  suggestedRequestTypes: string[];
  /** Suggested caller details the front desk should collect. */
  suggestedDetailFields: string[];
  /** Optional vertical-specific tone suggestions (falls back to the universal set). */
  suggestedToneTags?: string[];
  /** Optional one-line hint shown at the top of the Profile setup. */
  profileSetupHint?: string;
}

// A flattened business_knowledge row, as injected into the prompt.
export interface KnowledgeRow {
  id: string;
  category: string;
  question: string;
  answer: string;
}
