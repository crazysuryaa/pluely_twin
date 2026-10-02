import { safeLocalStorage } from "./storage";

export type SessionDocumentKind = "resume" | "jd" | "evidence";

export interface SessionDocument {
  id: string;
  kind: SessionDocumentKind;
  name: string;
  text: string;
  /** Estimated tokens of `text` (after trimming to the budget). */
  tokens: number;
  /** The original was longer than the budget and was cut. */
  truncated: boolean;
}

export const SESSION_DOCUMENTS_KEY = "session_documents";
export const ACCEPTED_DOCUMENT_TYPES = ".txt,.md,.pdf,.doc,.docx,.rtf";

/** Token budgets; "evidence" is shared by all evidence files. */
export const DOCUMENT_TOKEN_BUDGETS: Record<SessionDocumentKind, number> = {
  resume: 3000,
  jd: 2000,
  evidence: 4000,
};
export const MAX_EVIDENCE_FILES = 5;

const CHARS_PER_TOKEN = 4;

export const estimateTokens = (text: string) =>
  Math.ceil(text.length / CHARS_PER_TOKEN);

/** Cut `text` to `maxTokens`, preferring to end on a line break. */
export const truncateToTokens = (
  text: string,
  maxTokens: number
): { text: string; truncated: boolean } => {
  const maxChars = Math.max(0, maxTokens * CHARS_PER_TOKEN);
  if (text.length <= maxChars) return { text, truncated: false };
  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf("\n");
  return {
    text: (lastBreak > maxChars * 0.8 ? cut.slice(0, lastBreak) : cut).trimEnd(),
    truncated: true,
  };
};

/** Tokens still available for `kind`, ignoring the document being replaced. */
export const remainingBudget = (
  docs: SessionDocument[],
  kind: SessionDocumentKind
) => {
  if (kind !== "evidence") return DOCUMENT_TOKEN_BUDGETS[kind];
  const used = docs
    .filter((d) => d.kind === "evidence")
    .reduce((sum, d) => sum + d.tokens, 0);
  return Math.max(0, DOCUMENT_TOKEN_BUDGETS.evidence - used);
};

export const loadSessionDocuments = (): SessionDocument[] => {
  try {
    const raw = safeLocalStorage.getItem(SESSION_DOCUMENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveSessionDocuments = (docs: SessionDocument[]) => {
  safeLocalStorage.setItem(SESSION_DOCUMENTS_KEY, JSON.stringify(docs));
};

const SECTION_TITLES: Record<SessionDocumentKind, string> = {
  resume: "CANDIDATE RESUME",
  jd: "JOB DESCRIPTION",
  evidence: "SUPPORTING EVIDENCE",
};

/** System-prompt section built from the uploaded documents ("" if none). */
export const buildSessionDocumentsPrompt = (
  docs: SessionDocument[] = loadSessionDocuments()
): string => {
  const sections = (["resume", "jd", "evidence"] as const)
    .map((kind) => {
      const ofKind = docs.filter((d) => d.kind === kind && d.text.trim());
      if (ofKind.length === 0) return "";
      const body = ofKind
        .map((d) => (kind === "evidence" ? `--- ${d.name} ---\n${d.text}` : d.text))
        .join("\n\n");
      return `${SECTION_TITLES[kind]}:\n${body}`;
    })
    .filter(Boolean);
  if (sections.length === 0) return "";
  return `${sections.join("\n\n")}\n\nUse these documents when relevant. Do not invent facts that are not supported by the conversation or these documents.`;
};
