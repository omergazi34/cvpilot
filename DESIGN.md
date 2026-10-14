# CVPilot: design notes

## Product constraints that shaped the code

1. **Job seekers paste real, sensitive CVs.** Data stays local: no accounts, no database, no
   analytics. The server binds to `127.0.0.1` by default.
2. **An AI that embellishes a CV hurts its user.** A fabricated skill gets found out in the
   interview. Truthfulness is a hard rule in every prompt, and the UI makes the gaps visible.
3. **Model calls take 10-60 seconds.** A spinner for a minute feels broken, so everything streams.
4. **It should be useful without an API key.** The demo mode is a real rule-based analyser, not a
   placeholder.

## Prompting

- **One system prompt per task**, each with explicit hard rules: what may change (wording, order,
  emphasis), what may not (employers, titles, dates, degrees, skills).
- **Placeholders instead of invented numbers.** "Reduced load time by [%X]" is more useful than a
  made-up "by 40%". The schema has a `placeholders` list with hints, and the UI highlights every
  `[…]` in the rewritten CV so the candidate fills in real numbers before sending it.
- **Gaps are reported, not papered over.** If a posting asks for something the CV doesn't show, the
  rewrite lists it under `changes` as something to address, instead of adding the keyword.
- **Inputs are delimited** (`<cv>`, `<job_posting>`, `<candidate_instructions>`), so pasted content
  is clearly data.
- **Calibrated scoring.** The analysis prompt defines each sub-score and what 85+, 60-84 and <60
  mean, which keeps scores from clustering at 70-80 for every CV.
- **Language handling.** Commentary is always Turkish (the audience); CV content stays in the CV's
  own language unless the user asks for Turkish or English output.

## Structured outputs over parsing prose

Analysis, rewrites and matching are constrained by JSON Schemas built with small helpers (`obj`,
`arr`, `oneOf`). Every object is `additionalProperties: false` with all fields required, and
optional data is represented as `""` or `[]`. The frontend never handles a missing field or
malformed JSON, and enums such as severity (`kritik | orta | dusuk`) map straight to UI styles.
Only the cover letter is free text, because it streams to the screen as it is written.

## Streaming protocol

The browser posts JSON and reads an NDJSON response:

```text
{"type":"phase","phase":"thinking"}
{"type":"phase","phase":"writing"}
{"type":"progress","chars":1840}          (throttled to ~4/s)
{"type":"delta","text":"Sayın İşe Alım…"}  (cover letter only)
{"type":"result","data":{…}}  |  {"type":"error","message":"…"}
```

- NDJSON over a plain `fetch` stream instead of WebSockets or SSE: one request per job, no
  connection management, and it works through any HTTP proxy.
- Validation errors are thrown *before* the stream starts, so they come back as normal 4xx JSON.
  Once streaming has begun, errors arrive as an `error` event.
- If the browser disconnects, an `AbortController` cancels the upstream Claude request so no tokens
  are spent on an answer nobody will read.

## Demo mode

`heuristic.js` returns exactly the AI analysis schema (plus `mode: "demo"`), so a single renderer
serves both modes. It detects standard section headings in Turkish and English, contact details,
bullets, action verbs, weak phrases ("sorumluydum", "helped") and quantified results, and extracts
keywords from a posting (known tech terms, capitalised in-sentence terms, Turkish suffix-aware
stemming).

A Turkish-specific detail: lower-casing uses `İ → i` and then the default lowercase. `tr-TR` locale
lowercasing would turn English terms such as `LINUX` into `lınux` and break matching.

## File intake

- **PDF**: text extraction with `unpdf`. Under 150 characters of text means a scanned image. That
  is flagged as critical, since most ATS would read the file as empty, and transcribed by the model
  when a key is configured.
- **DOCX**: `mammoth` raw text for content, plus the HTML conversion to detect tables and images,
  which many ATS parsers scramble.
- **Icon fonts**: characters in the Unicode Private Use Area come from icon fonts and appear as
  garbage in an ATS. They are counted, reported and replaced.
- **File names**: multer decodes UTF-8 names as latin1 (`Ã–mer.pdf`); `fixFileName` reverses that.

## Export

DOCX output is deliberately plain: one column, standard headings, real bullet lists, no tables or
text boxes. That is the format ATS parsers handle best. A test generates a CV, reads it back with
mammoth and checks that every section appears in the right order.

## Storage

The tracker is a JSON file behind a promise queue: writes are serialised, and each write goes to a
temp file that is then renamed over the original, so a crash never leaves a half-written file.
That is enough for one user on one machine. A hosted version would need a real database and
per-user isolation.

## What I'd change for a hosted version

- Authentication and per-user storage (Postgres), with CVs encrypted at rest.
- Rate limiting and per-user cost caps on AI endpoints.
- Prompt caching for the long system prompts, and an eval suite (e.g. with
  [evalkit](https://github.com/omergazi34/evalkit)) to catch prompt regressions: no fabricated facts,
  calibrated scores, Turkish commentary.
- Move PDF parsing and transcription to a job queue so large uploads don't hold a request open.
