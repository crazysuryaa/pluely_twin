// Commenter (Twin) text is shown exactly as typed: Markdown rendering would
// collapse newlines/indentation and wrap long lines, which mangles code.
export const VerbatimText = ({ text }: { text: string }) => (
  <pre className="m-0 w-full max-w-full overflow-x-auto whitespace-pre font-mono text-[12.5px] leading-relaxed text-[#e2e4e7] [tab-size:4]">
    {text}
  </pre>
);
