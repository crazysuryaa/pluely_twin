import { describe, expect, it } from "vitest";
import {
  buildSessionDocumentsPrompt,
  remainingBudget,
  truncateToTokens,
  type SessionDocument,
} from "./session-documents";

const doc = (over: Partial<SessionDocument>): SessionDocument => ({
  id: "x", kind: "evidence", name: "notes.txt", text: "t", tokens: 1, truncated: false, ...over,
});

describe("session documents", () => {
  it("keeps text under budget and cuts long text at a line break", () => {
    expect(truncateToTokens("short", 10)).toEqual({ text: "short", truncated: false });
    const long = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const { text, truncated } = truncateToTokens(long, 20); // 80 chars
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(text)).toBe(true);
    expect(text.endsWith("\n")).toBe(false);
  });

  it("shares the evidence budget across evidence files only", () => {
    const docs = [doc({ kind: "evidence", tokens: 1500 }), doc({ kind: "resume", tokens: 2500 })];
    expect(remainingBudget(docs, "evidence")).toBe(2500);
    expect(remainingBudget(docs, "resume")).toBe(3000);
  });

  it("builds labeled sections in resume, JD, evidence order", () => {
    const prompt = buildSessionDocumentsPrompt([
      doc({ kind: "evidence", name: "project.md", text: "Built X" }),
      doc({ kind: "jd", text: "Senior engineer" }),
      doc({ kind: "resume", text: "Jane Doe" }),
    ]);
    const order = ["CANDIDATE RESUME:", "JOB DESCRIPTION:", "SUPPORTING EVIDENCE:"].map((h) => prompt.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(prompt).toContain("--- project.md ---\nBuilt X");
  });

  it("returns nothing when no documents are uploaded", () => {
    expect(buildSessionDocumentsPrompt([])).toBe("");
  });
});
