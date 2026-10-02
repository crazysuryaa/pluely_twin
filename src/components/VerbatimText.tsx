// Commenter (Twin) text is shown exactly as typed: Markdown rendering would
// collapse newlines/indentation and wrap long lines, which mangles code.
// The horizontal scrollbar uses the same color as the panel's vertical one
// (ScrollArea thumb: bg-border); see .verbatim-scroll in global.css.
export const VerbatimText = ({ text }: { text: string }) => (
  <pre className="m-0 w-full max-w-full overflow-x-auto whitespace-pre font-mono verbatim-scroll text-[12.5px] leading-relaxed text-[#e2e4e7] [tab-size:4]">
    {text}
  </pre>
);
