#!/usr/bin/env node
/*
 * Corpus regression check — run the extractor over the real quiz site and
 * assert every file landed where it belongs.
 *
 *   node test/corpus.js /path/to/NEW_LOYAL_QUIZ
 *
 * Unlike `npm test` (self-contained fixtures) this needs the source repo, so
 * it is a separate command rather than part of the default suite.
 *
 * The expectations are derived INDEPENDENTLY of lib/core.js:
 *   - quiz type   <- the engine <script src> the page links (a page cannot run
 *                    on an engine it does not load)
 *   - level/subject <- the folder the file sits in, via the table below
 * so a regression in the detection rules shows up as a mismatch rather than
 * agreeing with itself.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../lib/core");
const transform = require("../lib/transform");
const { makeEvalArray } = require("../extract");

const ROOT = process.argv[2];
if (!ROOT) {
  console.error("Usage: node test/corpus.js <path-to-NEW_LOYAL_QUIZ>");
  process.exit(1);
}
if (!fs.existsSync(path.join(ROOT, "question"))) {
  console.error(`No question/ folder under ${ROOT} — is that the quiz site?`);
  process.exit(1);
}

// Source-tree folder -> the bucket its files belong in. Add a row when the
// site grows a new section.
const FOLDERS = [
  [/^question\/KG-3_English\//i, "kg3", "english"],
  [/^question\/KG-3_math\//i, "kg3", "math"],
  [/^question\/Level 1 Maths\//i, "level-1", "math"],
  [/^question\/level-1\/English\//i, "level-1", "english"],
  [/^question\/level-1_Science\//i, "level-1", "science"],
  [/^question\/level_1_GK\//i, "level-1", "gk"],
];

// Linked engine script -> engine family. `image` is a refinement of `mcq`
// (same engine, picture content), so both are accepted for script.js.
const ENGINE_OF_SCRIPT = {
  "script.js": ["mcq", "image"],
  "audio.js": ["audio"],
  "tap_select.js": ["tap_select"],
  "drag_and_drop.js": ["drag_drop"],
};

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.html?$/i.test(e.name)) files.push(p);
  }
})(path.join(ROOT, "question"));
files.sort();

const evalArray = makeEvalArray();
const problems = [];       // extractor regressions -> fail the run
const contentDefects = []; // defects in the source quiz files -> report only
const counts = {};
let questions = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const base = path.basename(file);
  const html = fs.readFileSync(file, "utf8");

  const result = core.extract(html, base, { evalArray, now: "2026-01-01T00:00:00Z" });
  if (!result.ok) {
    problems.push(`${rel}\n    failed to extract: ${result.error}`);
    continue;
  }

  // ---- expected engine, straight off the linked script ----
  const linked = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => m[1].split("/").pop().split("?")[0].toLowerCase())
    .filter((s) => ENGINE_OF_SCRIPT[s]);
  if (!linked.length) {
    problems.push(`${rel}\n    links no known engine script — expectations cannot be checked`);
  } else {
    const want = ENGINE_OF_SCRIPT[linked[0]];
    if (!want.includes(result.meta.quiz_type)) {
      problems.push(`${rel}\n    quiz_type ${result.meta.quiz_type}, but it links ${linked[0]} (expected ${want.join(" or ")})`);
    }
  }
  if (result.detection.type_source !== "script") {
    problems.push(`${rel}\n    type decided by the ${result.detection.type_source} tier, not the linked script`);
  }
  if (result.detection.conflict) {
    problems.push(`${rel}\n    ${result.detection.conflict}`);
  }

  // ---- expected level/subject, straight off the folder ----
  const folder = FOLDERS.find(([re]) => re.test(rel));
  const dir = path.dirname(path.relative(path.join(ROOT, "question"), file)).replace(/[\\/]/g, " ");
  const level =
    core.detectLevel(result.meta.slug, base) || core.detectLevel("", dir) || core.UNCLASSIFIED;
  const subject =
    core.detectSubject(base.replace(/[\\/_.]+/g, " "), null) ||
    core.detectSubject(result.meta.slug, null) ||
    core.detectSubject(dir, null) ||
    core.DEFAULT_SUBJECT;
  if (!folder) {
    problems.push(`${rel}\n    folder not covered by the expectations table`);
  } else {
    if (level !== folder[1]) problems.push(`${rel}\n    level ${level}, folder says ${folder[1]}`);
    if (subject !== folder[2]) problems.push(`${rel}\n    subject ${subject}, folder says ${folder[2]}`);
  }

  // ---- the v2 payload must validate ----
  const t = transform.toV2({
    raw: result.rawQuestions,
    detection: result.detection,
    slug: result.meta.slug,
    title: result.meta.title,
    level,
    subject,
    sourceFile: base,
    extractedAt: "2026-01-01T00:00:00Z",
    detectLevel: core.detectLevel,
    detectSubject: core.detectSubject,
    imageRefOf: core.imageRefOf,
  });
  // Validation errors are almost always defects in the source content (a
  // `correct` value that is not among the options, a key that disagrees with
  // the words shown). They are reported, but they are not extractor
  // regressions, so they do not fail the run.
  t.report.validationErrors.forEach((e) => contentDefects.push(`${rel}  ${e}`));

  counts[result.meta.quiz_type] = (counts[result.meta.quiz_type] || 0) + 1;
  questions += result.meta.question_count;
}

const byType = Object.keys(counts).sort().map((k) => `${k} ${counts[k]}`).join(", ");
console.log(`\n${files.length} file(s), ${questions} question(s)  →  ${byType}`);

if (contentDefects.length) {
  console.log(`\n\x1b[33m${contentDefects.length} defect(s) in the source content\x1b[0m  (flagged, not fixed)`);
  contentDefects.forEach((d) => console.log("  ⚠ " + d));
}

if (problems.length) {
  console.error(`\n\x1b[31m${problems.length} classification problem(s)\x1b[0m`);
  problems.forEach((p) => console.error("  ✗ " + p));
  process.exit(1);
}
console.log("\n\x1b[32mevery file classified as its folder and linked engine say it should be\x1b[0m\n");
