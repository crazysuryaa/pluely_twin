import { useRef } from "react";
import { FileTextIcon, Loader2, UploadIcon, XIcon } from "lucide-react";
import { Button, Label } from "@/components";
import { useSessionDocuments } from "@/hooks/useSessionDocuments";
import {
  ACCEPTED_DOCUMENT_TYPES,
  DOCUMENT_TOKEN_BUDGETS,
  MAX_EVIDENCE_FILES,
  type SessionDocumentKind,
} from "@/lib/session-documents";

const SLOTS: { kind: SessionDocumentKind; label: string; hint: string }[] = [
  { kind: "resume", label: "Resume", hint: "One file; uploading again replaces it" },
  { kind: "jd", label: "Job description", hint: "One file; uploading again replaces it" },
  { kind: "evidence", label: "Other evidence", hint: `Up to ${MAX_EVIDENCE_FILES} files, shared budget` },
];

const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

export const SessionDocuments = () => {
  const { documents, busyKind, errors, uploadDocument, removeDocument } = useSessionDocuments();
  const inputs = useRef<Partial<Record<SessionDocumentKind, HTMLInputElement | null>>>({});

  return (
    <div className="space-y-3">
      {SLOTS.map(({ kind, label, hint }) => {
        const docs = documents.filter((d) => d.kind === kind);
        const used = docs.reduce((sum, d) => sum + d.tokens, 0);
        const busy = busyKind === kind;
        return (
          <div key={kind} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <Label className="text-xs font-medium">{label}</Label>
                <p className="text-[10px] text-muted-foreground">
                  {hint} · {formatTokens(used)}/{formatTokens(DOCUMENT_TOKEN_BUDGETS[kind])} tokens
                </p>
              </div>
              <input
                ref={(el) => {
                  inputs.current[kind] = el;
                }}
                type="file"
                accept={ACCEPTED_DOCUMENT_TYPES}
                className="hidden"
                aria-label={`Upload ${label}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // allow re-uploading the same file
                  if (file) void uploadDocument(kind, file);
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                disabled={busy}
                onClick={() => inputs.current[kind]?.click()}
              >
                {busy ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <UploadIcon className="mr-1.5 h-3 w-3" />
                )}
                {docs.length > 0 && kind !== "evidence" ? "Replace" : "Upload"}
              </Button>
            </div>

            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-white/[0.03] px-2 py-1.5"
              >
                <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs" title={doc.name}>
                  {doc.name}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  ~{formatTokens(doc.tokens)}
                </span>
                {doc.truncated && (
                  <span
                    className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] text-amber-400"
                    title="Longer than the token budget; the end was cut"
                  >
                    trimmed
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${doc.name}`}
                  onClick={() => removeDocument(doc.id)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-red-500/15 hover:text-red-400"
                >
                  <XIcon className="h-3 w-3" />
                </button>
              </div>
            ))}

            {errors[kind] && <p className="text-[10px] text-red-400">{errors[kind]}</p>}
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground">
        txt, md, pdf, doc, docx or rtf. Text is extracted on this device and sent with every AI request
        in this session.
      </p>
    </div>
  );
};
