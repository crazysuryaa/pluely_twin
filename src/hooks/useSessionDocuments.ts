import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type SessionDocument,
  type SessionDocumentKind,
  MAX_EVIDENCE_FILES,
  SESSION_DOCUMENTS_KEY,
  estimateTokens,
  loadSessionDocuments,
  remainingBudget,
  saveSessionDocuments,
  truncateToTokens,
} from "@/lib/session-documents";

const fileToBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

export const useSessionDocuments = () => {
  const [documents, setDocuments] = useState<SessionDocument[]>(loadSessionDocuments);
  const [busyKind, setBusyKind] = useState<SessionDocumentKind | null>(null);
  const [errors, setErrors] = useState<Partial<Record<SessionDocumentKind, string>>>({});

  // Keep in sync if another window changes the documents.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SESSION_DOCUMENTS_KEY) setDocuments(loadSessionDocuments());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const commit = useCallback((next: SessionDocument[]) => {
    setDocuments(next);
    saveSessionDocuments(next);
  }, []);

  const uploadDocument = useCallback(
    async (kind: SessionDocumentKind, file: File) => {
      setErrors((prev) => ({ ...prev, [kind]: undefined }));
      // Resume and JD hold one file each: a new upload replaces the old one.
      const current = loadSessionDocuments();
      const kept = kind === "evidence" ? current : current.filter((d) => d.kind !== kind);
      if (kind === "evidence" && kept.filter((d) => d.kind === "evidence").length >= MAX_EVIDENCE_FILES) {
        setErrors((prev) => ({ ...prev, [kind]: `Up to ${MAX_EVIDENCE_FILES} evidence files` }));
        return;
      }
      const budget = remainingBudget(kept, kind);
      if (budget <= 0) {
        setErrors((prev) => ({ ...prev, [kind]: "Evidence token budget is used up; remove a file first" }));
        return;
      }

      setBusyKind(kind);
      try {
        const extracted = await invoke<string>("extract_document_text", {
          fileName: file.name,
          dataBase64: await fileToBase64(file),
        });
        const { text, truncated } = truncateToTokens(extracted, budget);
        commit([
          ...kept,
          {
            id: crypto.randomUUID(),
            kind,
            name: file.name,
            text,
            tokens: estimateTokens(text),
            truncated,
          },
        ]);
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          [kind]: typeof err === "string" ? err : "Could not read this file",
        }));
      } finally {
        setBusyKind(null);
      }
    },
    [commit]
  );

  const removeDocument = useCallback(
    (id: string) => commit(loadSessionDocuments().filter((d) => d.id !== id)),
    [commit]
  );

  return { documents, busyKind, errors, uploadDocument, removeDocument };
};
