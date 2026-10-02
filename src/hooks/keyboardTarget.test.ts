// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isTypingTarget } from "./keyboardTarget";
describe("session composer keyboard isolation", () => {
  it("keeps recording and scroll shortcuts out of text inputs", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    const editor = document.createElement("div"); editor.setAttribute("contenteditable", "true");
    const span = editor.appendChild(document.createElement("span"));
    expect(isTypingTarget(span)).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});
