# LOYAL MCQ – Question Extractor Tool

Extracts the `questions` arrays out of the static LOYAL MCQ HTML quiz files and
converts them to structured JSON for seeding a Supabase/Postgres database (for
the rebuilt Next.js app). Ships with a **Node CLI** and a **local web UI** that
share the exact same extraction core (`lib/core.js`), so both produce identical
output.

No build step, no runtime dependencies — just Node 18+.

---

## Quick start

```bash
# CLI: point it at a file or a folder (recurses), JSON lands in ./output
node extract.js "/path/to/NEW_LOYAL_QUIZ/question"

# CLI: custom output folder
node extract.js ./question -o ./seed-json

# Web UI: serve it, then open the printed URL and drag your HTML files in
npm run ui        # -> http://localhost:5173/extractor-ui/

# Tests (self-contained, no sample files needed)
npm test
```

---

## What it handles

Detection is based on the CSS/JS a file loads, its `.dropbox` count, **and** the
shape of the parsed data — so it is not fooled by files that carry a stray
`initMCQQuiz(questions)` call at the bottom (several drag-and-drop files do).

| Type | Detected from | Output `type` |
|------|---------------|---------------|
| **MCQ** (2–4 options) | `initMCQQuiz`, default fallback | `mcq` |
| **Audio / sight words** (Web-Speech TTS) | loads `audio.js` / `audio_style.css`, or `voice` field | `audio` |
| **Drag-drop · two-box sort** | 2 `.dropbox` elements / `key` values `left`,`right` | `drag_drop` (`mode: two_box_sort`) |
| **Drag-drop · word order** | 4 `.dropbox` elements / `key` values `first`…`forth` | `drag_drop` (`mode: word_order`) |
| **Tap-select · match / count** | `initTapSelectQuiz`, `tap_select.js/css`, `items`/`count` | `tap_select` (`mode: match` \| `count`) |

Audio files that build their questions programmatically (`SW.map(...)`) are
**executed** to produce the final array — the array is run with Node's `vm`
module in the CLI (and an equivalent sandboxed `Function` in the browser), never
`eval`. Inline scripts that reference `window`/`document` or call the quiz
engines run against harmless stubs.

### Field aliases handled
- prompt: `question` **or** `prompt`
- correct answer: `correct` **or** `answer`
- Both `initMCQQuiz(questions)` direct calls and `DOMContentLoaded` wrappers.

### Prompts / HTML
Inline HTML in prompts (e.g. `<strong>`) is **preserved by default** — pass
`--strip-html` to strip it instead. For tap-select **match** questions the
`<span class="tap-scene">…</span>` emoji is pulled out into `scene_emoji` and the
prompt is cleaned.

### Slugs & titles
- Slug comes from the filename with a leading `level_1_` / `level1_` / `kg3_`
  prefix stripped (level lives in the folder structure):
  `level_1_addition_upto_30.html` → `addition-upto-30`.
- Title prefers the HTML `<title>` (when it isn't a generic placeholder),
  otherwise a title-cased slug. Titles are a best guess — eyeball them.

---

## Output

One `<slug>.json` per exercise plus a `_summary.csv`, written to the output
folder. Each exercise file:

```json
{
  "_source_file": "level_1_addition_upto_30.html",
  "_extracted_at": "2026-07-22T10:00:00Z",
  "_quiz_type_detected": "mcq",
  "_question_count": 100,
  "exercise": {
    "slug": "addition-upto-30",
    "title": "Add Upto 30",
    "quiz_type": "mcq",
    "questions_per_attempt": 25,
    "total_questions": 100,
    "is_free": false,
    "order_index": 0
  },
  "questions": [ /* … */ ]
}
```

Per-question shapes:

<details><summary><b>mcq</b></summary>

```json
{ "slug": "q001", "prompt": "What is 2 + 11?", "type": "mcq",
  "options": { "choices": ["13", "14"] },
  "correct_answer": "13", "explanation": "2 + 11 = 13",
  "media": null, "difficulty": 1, "order_index": 1 }
```
</details>

<details><summary><b>audio</b></summary>

```json
{ "slug": "q001", "prompt": "Listen and choose the correct word.", "type": "audio",
  "options": { "choices": ["over", "name"] },
  "correct_answer": "over", "explanation": null,
  "media": { "audio": null, "use_tts": true, "tts_word": "over", "tts_lang": "en-US" },
  "difficulty": 1, "order_index": 1 }
```
</details>

<details><summary><b>drag_drop · two_box_sort</b></summary>

```json
{ "slug": "q001", "prompt": "Drag each word to the correct box.", "type": "drag_drop",
  "options": {
    "mode": "two_box_sort",
    "items": [ { "id": "1", "label": "tall" }, { "id": "2", "label": "girl" } ],
    "box_a": { "label": "Adjective", "correct_items": ["1"] },
    "box_b": { "label": "Common Noun", "correct_items": ["2"] } },
  "correct_answer": "{\"Adjective\":[\"1\"],\"Common Noun\":[\"2\"]}",
  "explanation": "…", "media": null, "difficulty": 1, "order_index": 1 }
```
Box labels come from the `data-placeholder` attributes on the `.dropbox` divs.
</details>

<details><summary><b>drag_drop · word_order</b></summary>

```json
{ "slug": "q001", "prompt": "Put the words in order to make a complete sentence.",
  "type": "drag_drop",
  "options": { "mode": "word_order", "words": ["bark","The","can","dog"],
    "correct_order": ["The","dog","can","bark"] },
  "correct_answer": "[\"The\",\"dog\",\"can\",\"bark\"]",
  "explanation": "…", "media": null, "difficulty": 1, "order_index": 1 }
```
</details>

<details><summary><b>tap_select · match</b></summary>

```json
{ "slug": "q001", "prompt": "How many cars?", "type": "tap_select",
  "options": { "mode": "match", "choices": ["3","4","1","2"],
    "scene_emoji": "🚗🚗🚗", "correct_choices": ["3"] },
  "correct_answer": "3", "explanation": "…",
  "media": null, "difficulty": 1, "order_index": 1 }
```
`correct_answer` is the single correct label, or a JSON array string when a
question has more than one correct tile. Some source questions use sized
`<span style="font-size:…">` labels as the visual difference — that HTML is kept
in `choices`/`correct_answer` because it is what distinguishes the options.
</details>

<details><summary><b>tap_select · count</b></summary>

```json
{ "slug": "q001", "prompt": "Tap 6 🌟 stars", "type": "tap_select",
  "options": { "mode": "count", "target_count": 6, "items": ["🌟","🌟","🌟","🌟","🌟","🌟","🌟"] },
  "correct_answer": "6", "explanation": "…",
  "media": null, "difficulty": 1, "order_index": 1 }
```
</details>

### `_summary.csv`
Columns: `filename, slug, quiz_type, mode, question_count, has_explanations,
status, warnings`.

---

## Error handling

- **No `questions` array** → file is skipped, logged, and marked `failed` in the
  console, the CSV, and the UI table.
- **A malformed question** (missing prompt / <2 options / missing correct, etc.)
  → it is still included, with a human-readable `_warning` field on the question;
  the exercise is marked `warning`. Nothing is silently dropped.
- **Type can't be detected** → defaults to `mcq` with a warning.
- Extraction has a layered fallback: run the questions-declaring script → run all
  inline scripts → extract the array literal directly. First one that yields a
  non-empty array wins.

---

## Organizing into a seed tree (`organize.js`)

`organize.js` sorts the extracted JSON (from `output/`) into
`seed-data/<level>/<subject>/<slug>.json` plus `seed-data/_summary.csv`.

```bash
node extract.js "/path/to/question" -o output   # produce output/*.json first
node organize.js                                 # -> seed-data/
node organize.js output seed-data                # explicit in/out dirs
```

Levels and subjects are **auto-detected — nothing is hardcoded to a fixed set**,
so new levels (Level 5, KG-2, …) just work. Both rule sets live as simple arrays
in `lib/core.js` (`LEVEL_FAMILIES` / `SUBJECT_RULES`) — the CLI and the Organize
web page share them.

- **Level** — pulled from the source filename / slug for any number:
  `kg3_`/`kg-3_` → `kg3/`, `level_1_`/`level1_`/`lvl1_`/`leve1_` → `level-1/`,
  `level_2_` → `level-2/`, … No level prefix → a warning + `_unclassified/`.
- **Subject** — first matching keyword wins, else `math`:
  english (`eng`, `vowel`, `sight-word`, `vocabulary`, `adjective`, `noun`,
  `adverb`, `scrambled`), gk (`gk`, `general-knowledge`, `fruits`),
  science (`sci`, `science`, `living`).

---

## Web UI

Two framework-free pages, linked from each other (nav in the header). Both run
entirely in the browser and share `lib/core.js` + `zip.js`.

**Extract** (`extractor-ui/index.html`)
- Drag-and-drop (or click) to load one or many `.html` files.
- **Extract All** fills in detected type, question count, and status per file.
- Click any successful row to **preview** its questions in a readable table.
- **Download All (ZIP)** / **Download CSV Summary**.

**Organize** (`extractor-ui/organize.html`)
- Drop the extracted `.json` files (or pick the files / the whole output folder).
- Table of Filename · Level · Subject · Quiz Type · Question Count · Status.
- **Level** and **Subject** are auto-detected but shown as **editable dropdowns**
  (KG-1…KG-3, Level 1…12 / Math, English, Science, GK) — each with **+ Add new…**
  to type a custom value (e.g. Arabic). You always have final say.
- **Organize All (ZIP)** builds the `seed-data/<level>/<subject>/` tree (with a
  `_manifest.csv`) from your final choices.

Running `npm run ui` (a tiny zero-dependency static server) is the reliable way
to open them; opening the files directly works in most browsers too, and each
page shows a clear hint if the browser blocks the cross-directory script load.

---

## Layout

```
extract.js            CLI extractor (vm-based array evaluator + file walking + output)
organize.js           CLI organizer (output/*.json -> seed-data/ tree)
lib/core.js           shared core: detection, mapping, level/subject rules (UMD)
extractor-ui/
  index.html          Extract page (sandboxed Function evaluator)
  organize.html       Organize page (editable level/subject dropdowns)
  zip.js              shared dependency-free ZIP writer
scripts/serve-ui.js   zero-dependency static server for the UI
test/run.js           self-contained test suite (npm test)
```

## Notes on the source corpus

Run against the current `NEW_LOYAL_QUIZ/question` tree (152 HTML files) the tool
extracts all of them (0 failures, ~14.5k questions): **mcq 139, tap_select 6,
drag_drop 4, audio 3**. The one `warning` is a genuine source-data bug
(`level1_sci_living&non.html`, Q100: the `correct` value isn't among its
options) — flagged, not fixed. `example.html` in the drag-drop folder is a
template and extracts as a small word-order exercise; ignore its output if you
don't want it seeded.
