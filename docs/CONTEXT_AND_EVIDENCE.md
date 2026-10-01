# Context and Evidence Architecture

## Current state

Pluely Twin now has three context layers for system-audio sessions:

1. Saved system prompt
2. Session Context / Evidence text
3. Chronological conversation history

The existing file attachment path is image-only. It does not currently parse PDF, DOCX, TXT, Markdown, CSV, or other documents.

## Target multi-document evidence model

### Supported inputs

Initial implementation should support:

- PDF
- DOCX
- TXT
- Markdown
- CSV
- JSON

Images remain a separate multimodal input path.

### Storage

Use the existing local SQLite database.

Suggested tables:

```sql
CREATE TABLE evidence_documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  source_path TEXT,
  text_content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE evidence_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  source_label TEXT,
  page_number INTEGER,
  FOREIGN KEY(document_id) REFERENCES evidence_documents(id) ON DELETE CASCADE
);
```

Do not store the original document bytes unless the user explicitly asks for persistence.

### Extraction

Extraction should happen locally.

- TXT / Markdown / CSV / JSON: direct text extraction
- PDF: page-aware text extraction so citations can retain page numbers
- DOCX: paragraph/table text extraction

Extraction failures should be shown per file and should not block other documents.

### Chunking

Recommended first pass:

- roughly 700-1,000 tokens per chunk
- 100-150 token overlap
- preserve document name and page/section metadata
- avoid splitting headings from immediately following content

### Retrieval

Do not inject all uploaded documents into every request.

For each user/transcript turn:

1. Build a query from the current turn plus the immediately preceding turn.
2. Retrieve the most relevant evidence chunks.
3. Add only the top relevant chunks to the model context.
4. Include source labels with each chunk.
5. Ask the model to distinguish supplied evidence from inference.

Initial retrieval can be local lexical/BM25-style scoring. Embeddings can be added later as an optional enhancement.

### Prompt composition

Recommended order:

```text
BASE SYSTEM PROMPT

SESSION CONTEXT

RELEVANT EVIDENCE
[Source: Resume.pdf, page 2]
...

[Source: Job Description.docx]
...

CONVERSATION HISTORY

CURRENT USER / TRANSCRIPT TURN
```

Response-length/language/formatting controls should remain separate from evidence.

### Evidence behavior

The assistant should:

- use evidence when relevant
- not claim unsupported evidence
- preserve source names/page numbers where available
- say when the evidence does not contain the requested fact
- allow the user to enable/disable documents per session

### UI

Add an Evidence tray in the dashboard and live session settings:

```text
Evidence
  Resume.pdf               enabled
  Job Description.docx     enabled
  Project Notes.md         disabled

  + Add documents
  Clear session evidence
```

Show extraction/indexing state for every document.

### Session scope

Support two modes:

- Session only: evidence is attached to the current conversation/session.
- Saved library: evidence persists locally and can be reused in future sessions.

Default should be Session only.

## Context-window management

Conversation history must not grow without bound.

Before the evidence feature ships, add token budgeting with:

- most recent turns preserved verbatim
- older turns summarized when the model context approaches its limit
- system prompt and selected evidence never silently dropped
- source metadata retained when evidence is summarized

This avoids the current long-session risk of eventually exceeding the provider context window.
