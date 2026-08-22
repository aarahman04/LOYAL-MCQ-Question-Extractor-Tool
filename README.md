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

# CLI: write straight into <out>/<level>/<subject>/ instead of a flat folder
node extract.js ./question -o ./seed-data --tree

# Web UI: serve it, then open the printed URL and drag your HTML files in
npm run ui        # -> http://localhost:5173/extractor-ui/

# Tests (self-contained, no sample files needed)
npm test

# Regression check against the real quiz site (needs the source repo)
npm run test:corpus -- /path/to/NEW_LOYAL_QUIZ
```

---

## What it handles

Every exercise page wires itself to exactly one engine by **linking that
engine's script**. A page cannot run on an engine it does not load, so that
link is the primary signal; everything else is a fallback for when it is
missing.

| Tier | Signal | Why it ranks there |
|---|---|---|
| 1 | `<script src>` engine file | Definitive — the engine the page actually runs |
| 2 | engine stylesheet | Strong: `audio_style.css`, `tap_select.css`, `dnd.css` |
| 3 | `init*Quiz(...)` call | Weaker: several drag-and-drop files carry a stray `initMCQQuiz` |
| 4 | DOM hooks | `#tap-grid`, `.dropbox`, `.two-targets`, `#playBtn` |
| 5 | question data shape | `voice` / `key` / `items` / `count` — fills in only when 1–4 are silent |

The first tier with any evidence decides. Within a tier the **most specific**
engine wins, so the shared MCQ shell never outvotes a specific engine that is
loaded on top of it. Links are read as parsed attributes, not matched against
the whole document, so an engine named in a comment or a string is not mistaken
for a link; the basename is compared with any `?query` / `#hash` stripped.

| Engine | Script | Output `quiz_type` |
|------|---------------|---------------|
| **MCQ** (2–4 options) | `script.js` | `mcq` |
| **Picture MCQ** | `script.js` + a picture on ≥80% of questions | `image` |
| **Audio / sight words** (Web-Speech TTS) | `audio.js` | `audio` |
| **Drag-drop · two-box sort** | `drag_and_drop.js`, `key` values `left`,`right` | `drag_drop` (`mode: two_box_sort`) |
| **Drag-drop · word order** | `drag_and_drop.js`, `key` values `first`…`forth` | `drag_drop` (`mode: word_order`) |
| **Tap-select · match / count** | `tap_select.js`, `items`/`count` | `tap_select` (`mode: match` \| `count`) |

Teaching the tool a new engine is one row in the `ENGINES` table in
`lib/core.js` — script names, stylesheet names, init function names, DOM hooks.
Nothing else changes.

**It never guesses silently.** `detection.type_source` records which tier
decided. When no tier could identify the engine the file is still extracted (as
`mcq`) but the run reports *"nothing identified an engine"*. When the markup and
the question data disagree — a page that links `tap_select.js` but whose
questions carry `voice` — the **markup wins** and the disagreement is reported,
rather than one side silently overriding the other. Both show up as warnings
against the file, so a new or malformed structure surfaces for review instead of
being filed as the default.

### Finding the question array

The house style is `const questions = [...]` handed to `initMCQQuiz(questions)`,
but the tool does not depend on it. Candidates are tried in order: the inline
script that declares `questions`; all inline scripts together; **whatever
identifier is passed to the `init*Quiz(...)` call** (`const bank = […];
initMCQQuiz(bank)` works); then the raw array literal, under `questions` or
under any other name the file declares. Every `init*Quiz` the page calls is
stubbed before evaluation, so an engine the tool has never heard of raises no
`ReferenceError`. A candidate is only accepted when it yields objects that carry
question fields, so a decorative word or emoji list is never mistaken for a
question bank.

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

## Output format (v2)

Default output follows `LOYAL_QUIZ_Question_Format.md`. The central rule: every
question has two sibling fields —

| Field | Sent to browser | Contains |
|---|---|---|
| `options` | yes | everything needed to render |
| `answer_key` | **never** | **only IDs** — no text, emoji, or content |

so the render payload is structurally incapable of leaking the answer. Grading
compares IDs, not strings.

```jsonc
{
  "_source_file": "level_1_eng_adjectives.html",
  "_extracted_at": "2026-07-22T09:00:00.000Z",   // source mtime → idempotent
  "slug": "eng-adjectives", "title": "Adjectives",
  "level": "level-1", "subject": "english",       // from filename, slug, then folder
  "quiz_type": "mcq",
  "questions_per_attempt": 25, "total_questions": 100,
  "shuffle": true, "is_free": false, "order_index": 0,
  "questions": [
    { "slug": "q001", "type": "mcq",
      "prompt": "Identify the adjective: The brown dog is happy.",
      "options": { "choices": [ {"id":"c1","text":"the"}, {"id":"c2","text":"brown"} ] },
      "answer_key": { "correct": ["c2"] },
      "explanation": "…", "media": null, "order_index": 1 }
  ]
}
```

Per type: **mcq/image/audio** → `choices:[{id,text}]` + `answer_key.correct:[id]`
(image additionally requires a `media` block; audio also carries
`options.tts:{text,lang}`); **two-box sort** →
`items:[{id,label}]` + `boxes:[{id,label}]` + `answer_key.placements`;
**word order** → `words:[{id,text}]` (IDs in *presentation* order, never the
correct order) + `answer_key.order`; **tap-select match** →
`choices:[{id,emoji,size|count}]`; **tap-select count** → `{mode,emoji,item_count}`
+ `answer_key.target_count`. `difficulty` is dropped.

**IDs** are prefixed (`c1`, `i1`, `b1`, `w1`) rather than bare `a`/`b`/`c`:
choice *text* in this corpus is sometimes a single letter ("a" is a sight word),
so letter IDs would collide with displayed content and defeat leak detection.

**Size tokens** come from the source rem value — `<1.6` `sm`, `1.6–2.2` `md`,
`2.2–3.0` `lg`, `>3.0` `xl`. The corpus uses 1.4 / 2.4 / 3.6 → `sm` / `lg` / `xl`.

**Picture exercises** get their own type. The source site runs them on the MCQ
engine, but a *picture* exercise is a different thing to seed: the prompt is the
image, so the row needs an image attached to every question. When an MCQ-shaped
bank has a picture on **≥80%** of its questions the exercise becomes
`quiz_type: "image"`, every question becomes `type: "image"`, and a missing
`media` block is a validation error rather than a silently absent field. A bank
that merely illustrates a few of its questions stays `mcq` (in this corpus the
split is clean: picture banks sit at 100%, the one partly-illustrated bank at
16%). Answers work exactly as in MCQ — `options.choices` + `answer_key`.

The picture field is resolved by **shape, not by name**: `image`, `img`,
`imageUrl`, `image_url`, `imageSrc`, `imagePath`, `picture`, `pic`, `photo`,
`figure`, `thumbnail`, plus generic `media` / `src` / `url` / `file` — key
matching ignores case and separators, so `Image-URL` works too. The value may be
a path, a `data:image/…` URI, a `{ src }` / `{ url }` / `{ path }` object, an
array (first usable entry wins), or a literal `<img src="…">` tag; an `<img>`
inlined in the prompt is used as a last resort. Generic keys are only accepted
when the **value** looks like an image (image extension, `data:image/` URI, or a
path under an `image/`-style folder), so a `url` pointing at a page is not
mistaken for a picture. See `core.imageRefOf`.

**Media** is a storage path, never a URL:
`questions/{level}/{subject}/{slug}/{file}.webp`, plus `source_path` pointing at
the original for the image-conversion step. `alt` is left `""` — never invented —
and the count of missing alt text is reported.

**`shuffle`** is an enum, not a boolean:

| value | meaning |
|---|---|
| `question` | default — draw individual questions at random |
| `group` | draw whole passage groups at random, preserving question order inside each group |
| `none` | fixed order |

Under `group` the engine adds whole groups until it reaches or just exceeds
`questions_per_attempt`, so a child always gets **complete** passages — never a
slice — with different ones on each retake.

**Reading comprehension**: when a large block of prompt text repeats across
questions, the passages are lifted to an exercise-level `passages:[{id,text}]`
array, each question keeps a `passage_id`, prompts are stripped of the passage
and the leading question number, and the exercise becomes `shuffle: "group"`
with the normal 25-question attempt. Where copies had drifted, the *longest*
variant becomes canonical and the drift is reported.

**Image dedupe**: the storage path is a pure function of the image's own source
path, so a file reused by many questions (or many exercises) always maps to one
object — the upload script uploads each unique file **once** and many questions
point at the same path. In this corpus that is 2,151 references → 803 unique
objects.

**Alt text** is derived from the filename only when the filename is genuinely
descriptive (`Big Bear.png` → `"Big Bear"`). Bare numbers (`105.png`), generic
placeholders (`image1.png`) and exercise slugs
(`lvl_1_eng_identify_image_verbs(3).jpg`) yield `""` — a wrong description is
worse than none for a screen reader. Pass `--no-alt` to disable. The report
prints derived vs still-empty counts.

### Legacy format

`--format v1` emits the original shape for side-by-side comparison during
migration. Everything else about the run is identical.

### Validation

Every exercise is checked against 12 assertions (IDs referenced in `answer_key`
exist in `options`; no answer-ish field inside `options`; IDs unique; no
displayed content in the answer key; MCQ/audio/image have 2–4 choices; `order`
is a permutation of the word IDs; `placements` cover every item once;
`total_questions` matches; `questions_per_attempt <= total_questions`; no empty
prompt; no `style=` in `options`; every `image` question carries a `media`
block). Failures are printed per exercise and the process exits non-zero.

The end-of-run report covers: files processed, questions converted, per-type
counts, validation failures, answer-position warnings, images missing alt text,
titles flagged for review, and reading-comprehension sets.

Validation failures do **not** abort the run — every file is processed and the
failures are listed at the end (exit code 3), so all content bugs can be fixed
in one pass.

---

## Image audit (`audit-images.js`)

Resolves every image reference against the real files in the source repo, so
broken references surface now rather than when a child sees a missing image.

```bash
node audit-images.js /path/to/NEW_LOYAL_QUIZ output [--json report.json]
```

Reports unique files vs total references (reuse factor), how each reference
resolved, references that resolve to nothing, references whose path is wrong but
where a same-named file exists elsewhere (**ambiguous** — needs a human to pick),
most-reused files, upload implications (unique objects, any file that would
upload twice, storage-path collisions), and repo images nothing references.
Exits non-zero when anything is broken or ambiguous.

---

## Legacy output (v1)

<details><summary>The original per-exercise shape, still available via <code>--format v1</code></summary>

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

</details>

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
- **Subject** — first matching rule wins, else `math`: math (`math`, `maths`,
  `mathematics`, `numeracy`), english (`eng`, `english`, `vowel`, `consonant`,
  `sight-word`, `vocabulary`, `adjective`, `noun`, `pronoun`, `adverb`, `verb`,
  `preposition`, `antonym`, `synonym`, `scrambled`), gk (`gk`,
  `general-knowledge`, `fruits`), science (`sci`, `science`, `living`). The
  extractor searches the **filename** first, then the slug, then the containing
  folder — a file handed over in a scratch folder whose name carries no keyword
  is still classified from its own name rather than silently falling back to
  `math`.

Keywords match **whole words, not substrings**. This matters: `eng` appears
inside *lengths*, *strength* and *challenge*, so substring matching filed
`level_1_math_challenge.html` under English. Multi-word keywords
(`sight-word`, `general-knowledge`) match a run of consecutive words, and simple
plurals are folded on both sides so `noun` matches *nouns* and `maths` matches
*math*. The same word-aware matching reads levels, so `Level 1 Maths`,
`level_1_…`, `lvl1_…`, `leve1_…` (the misspelling in the source files) and
`KG-3_English` all resolve, as does any number — `level_12_…` → `level-12/`.

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
audit-images.js       resolves image references against the real repo files
scripts/serve-ui.js   zero-dependency static server for the UI
test/run.js           self-contained test suite (npm test)
test/corpus.js        regression check against the real quiz site (npm run test:corpus)
```

## Notes on the source corpus

Run against the current `NEW_LOYAL_QUIZ/question` tree the tool extracts every
file: **161 files, 15,483 questions — mcq 117, image 27, tap_select 10,
drag_drop 4, audio 3**, 0 failures. All 161 are identified from their linked
engine script (`type_source: "script"`), with no markup/data conflicts and no
file falling back to a lower tier. `npm run test:corpus -- <path>` reproduces
this and exits non-zero on any misclassification.

Two genuine source-data defects are flagged, not fixed:

- `level1_sci_living&non.html` q100 — the `correct` value isn't among its options.
- `level_1_eng_drag_and_drop_scrambled_words.html` q021 — the key says `"Four"`
  but the word shown is `"four"`, so the answer can never be placed.

`example.html` in the drag-drop folder is a template and extracts as a small
word-order exercise; ignore its output if you don't want it seeded.
