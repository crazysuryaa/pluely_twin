import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import "@/lib";
import { fetchAIResponse } from "./ai-response.function";
import { deepVariableReplacer } from "./common.function";

const provider = {
  id: "test",
  streaming: false,
  responseContentPath: "choices[0].message.content",
  curl: `curl https://example.com/v1/chat/completions \\
  -H "Authorization: Bearer {{API_KEY}}" \\
  -d '{
    "model": "{{MODEL}}",
    "messages": [{"role": "system", "content": "{{SYSTEM_PROMPT}}"}, {"role": "user", "content": [{"type": "text", "text": "{{TEXT}}"}]}]
  }'`,
} as any;

describe("system prompt delivery", () => {
  let sentBody: any;

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sentBody = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "ok" } }] }),
        };
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("sends the exact system prompt in the system message", async () => {
    const persona = "You are Surya. Speak casually. Price is $100, not $&.";
    const chunks: string[] = [];
    for await (const c of fetchAIResponse({
      provider,
      selectedProvider: {
        provider: "test",
        variables: { api_key: "k", model: "m" },
      },
      systemPrompt: persona,
      userMessage: "hello",
    })) {
      chunks.push(c);
    }

    const system = sentBody.messages.find((m: any) => m.role === "system");
    expect(system.content.startsWith(persona)).toBe(true);
    expect(system.content).not.toContain("{{SYSTEM_PROMPT}}");
    expect(system.content).toContain("double dollar signs ($$)");
    expect(chunks.join("")).toBe("ok");
  });

  it("does not interpret $ patterns in variable values", () => {
    const out = deepVariableReplacer("a {{X}} b", { X: "$& $$ $' $1" });
    expect(out).toBe("a $& $$ $' $1 b");
  });
});
