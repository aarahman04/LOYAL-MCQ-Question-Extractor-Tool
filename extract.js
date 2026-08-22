#!/usr/bin/env node
/*
 * LOYAL MCQ – Question Extractor (CLI)
 * ------------------------------------
 * Extracts the `questions` array from static HTML quiz files and converts it
 * to structured JSON for database seeding.
 *
 * Usage:
 *   node extract.js <file-or-folder> [-o output-dir] [--strip-html] [--pretty]
 *
 * Examples:
 *   node extract.js ../NEW_LOYAL_QUIZ/question
 *   node extract.js ./one_file.html -o ./out
 *
 * The inline questions array is run with Node's `vm` module (NOT eval) in a
 * sandbox whose only globals are harmless stubs, so file scripts that wrap the
 * data in `DOMContentLoaded`, call `initMCQQuiz(...)`, or generate questions
 * programmatically (`SW.map(...)`) all execute safely.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const core = require("./lib/core");
const transform = require("./lib/transform");

// ----- vm-based array evaluator ---------------------------------------------

// A universal no-op stub: any property access, call, or construction returns
// itself, so inline scripts that poke at window / document never throw.
function makeStub() {
  const stub = new Proxy(function () {}, {
    get: () => stub,
    set: () => true,
    apply: () => stub,
    construct: () => stub,
    has: () => true,
  });
  return stub;
}

function makeEvalArray() {
  return function evalArray(code) {
    const stub = makeStub();
    const sandbox = {
      window: stub,
      document: stub,
      self: stub,
      navigator: stub,
      localStorage: stub,
      speechSynthesis: stub,
      SpeechSynthesisUtterance: function () {},
      console: { log() {}, warn() {}, error() {} },
      initMCQQuiz() {},
      initTwoBoxSortQuiz() {},
      initTapSelectQuiz() {},
      initDragDropQuiz() {},
      setTimeout() {},
      setInterval() {},
      addEventListener() {},
    };
    vm.createContext(sandbox);
    const wrapped =
      code +
      '\n;globalThis.__RESULT__ = (typeof questions !== "undefined") ? questions : undefined;';
    vm.runInContext(wrapped, sandbox, { timeout: 5000 });
    return sandbox.__RESULT__;
  };
}

// ----- file discovery -------------------------------------------------------

function listHtmlFiles(input) {
  const stat = fs.statSync(input);
  if (stat.isFile()) return [input];
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.html?$/i.test(entry.name)) out.push(full);
    }
  })(input);
  out.sort();
  return out;
}

// ----- CLI args -------------------------------------------------------------

function parseArgs(argv) {
  const args = { input: null, out: "output", stripHtml: false, pretty: true, format: "v2", tree: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") args.out = argv[++i];
    else if (a === "--strip-html") args.stripHtml = true;
    else if (a === "--no-pretty") args.pretty = false;
    else if (a === "--no-alt") args.noAlt = true;
    else if (a === "--tree") args.tree = true;
    else if (a === "--format") args.format = String(argv[++i] || "").toLowerCase();
    else if (a === "--v1" || a === "--legacy") args.format = "v1";
    else if (a === "-h" || a === "--help") args.help = true;
    else if (!args.input) args.input = a;
  }
  return args;
}

const HELP = `LOYAL MCQ – Question Extractor (core v${core.VERSION} / format v${transform.VERSION})

Usage:
  node extract.js <file-or-folder> [options]

Options:
  -o, --out <dir>     Output folder (default: ./output)
  --format v2|v1      Output format (default: v2).
                      v2 = current spec: options + answer_key (IDs only).
                      v1 = legacy shape, kept for migration comparison.
  --v1, --legacy      Shorthand for --format v1
  --strip-html        Strip inline HTML (e.g. <strong>) from MCQ/audio prompts
                      (v1 only; default: preserve)
  --no-alt            Do not derive alt text from image filenames
  --tree              Write <out>/<level>/<subject>/<slug>.json instead of a
                      flat folder (the seed layout, without organize.js)
  --no-pretty         Write minified JSON (default: pretty-printed)
  -h, --help          Show this help

Outputs one <slug>.json per exercise plus a _summary.csv into the output folder.`;

// ----- console helpers ------------------------------------------------------

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};
const color = process.stdout.isTTY;
function c(code, s) {
  return color ? code + s + C.reset : s;
}

// ----- main -----------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    console.log(HELP);
    process.exit(args.input ? 0 : 1);
  }
  if (!fs.existsSync(args.input)) {
    console.error(c(C.red, "Input not found: ") + args.input);
    process.exit(1);
  }

  const files = listHtmlFiles(args.input);
  if (!files.length) {
    console.error(c(C.red, "No .html files found under: ") + args.input);
    process.exit(1);
  }

  fs.mkdirSync(args.out, { recursive: true });
  const evalArray = makeEvalArray();
  const now = new Date().toISOString();
  const v2 = args.format !== "v1";

  console.log(c(C.bold, `\nLOYAL MCQ Extractor`) + c(C.dim, ` core v${core.VERSION} · format ${v2 ? "v" + transform.VERSION : "v1 (legacy)"}`));
  console.log(c(C.dim, `Input : `) + args.input);
  console.log(c(C.dim, `Output: `) + args.out);
  console.log(c(C.dim, `Files : `) + files.length + "\n");

  const csvRows = [];
  const usedSlugs = new Map();
  const totals = { ok: 0, warning: 0, failed: 0, questions: 0, byType: {} };
  // v2 aggregate report
  const agg = {
    validationFailures: [], biased: [], titleReview: [], readingSets: [],
    passageDrift: [], sizeWarnings: [], images: 0, imagesMissingAlt: 0, imagesAltDerived: 0,
  };

  // Level/subject come from the filename first, the slug next, and the folder
  // structure last. The folder alone is not enough: files are often handed to
  // the extractor from a scratch directory whose name carries no subject
  // keyword, and falling back to the folder would silently label them
  // DEFAULT_SUBJECT ("math"). The filename (`kg3_eng_vowel_a.html`) is the one
  // part that travels with the file.
  const inputRoot = fs.statSync(args.input).isFile() ? path.dirname(args.input) : args.input;
  function metaFromPath(file, slug) {
    const rel = path.relative(inputRoot, file);
    const dir = path.dirname(rel).replace(/[\\/]/g, " ");
    const base = path.basename(file).replace(/[\\/_.]+/g, " ");
    return {
      level:
        core.detectLevel(slug, path.basename(file)) ||
        core.detectLevel("", dir) ||
        core.UNCLASSIFIED,
      subject:
        core.detectSubject(base, null) ||
        core.detectSubject(slug, null) ||
        core.detectSubject(dir, null) ||
        core.DEFAULT_SUBJECT,
    };
  }

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    let html;
    try {
      html = fs.readFileSync(file, "utf8");
    } catch (e) {
      console.log(c(C.red, "  ✗ ") + rel + c(C.dim, "  (read error: " + e.message + ")"));
      totals.failed++;
      csvRows.push(
        core.csvRow(
          { ok: false, status: "failed", error: "read error: " + e.message, warnings: [], meta: { slug: "", quiz_type: "", mode: "", question_count: 0, has_explanations: false } },
          path.basename(file)
        )
      );
      continue;
    }

    // Deterministic timestamp (source mtime, not run time) so repeated runs
    // produce byte-identical output — the tool must be idempotent.
    let extractedAt = now;
    try { extractedAt = fs.statSync(file).mtime.toISOString(); } catch (e) { /* keep run time */ }

    const result = core.extract(html, path.basename(file), {
      evalArray,
      now: extractedAt,
      stripHtml: args.stripHtml,
    });
    csvRows.push(core.csvRow(result, path.basename(file)));

    if (!result.ok) {
      totals.failed++;
      console.log(
        c(C.red, "  ✗ ") + rel + c(C.dim, "  → " + result.error)
      );
      continue;
    }

    const meta = metaFromPath(file, result.meta.slug);
    // --tree writes straight into <out>/<level>/<subject>/, so one run of the
    // extractor produces the seed layout without a separate organize step.
    // Flat is the default so `organize.js` keeps working unchanged.
    const outDir = args.tree ? path.join(args.out, meta.level, meta.subject) : args.out;

    // unique output filename by slug, per destination folder
    let outSlug = result.meta.slug;
    const slugKey = path.join(outDir, outSlug);
    if (usedSlugs.has(slugKey)) {
      const n = usedSlugs.get(slugKey) + 1;
      usedSlugs.set(slugKey, n);
      outSlug = outSlug + "-" + n;
    } else {
      usedSlugs.set(slugKey, 1);
    }
    if (args.tree) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, outSlug + ".json");

    let payload = result.data;
    let rep = null;
    if (v2) {
      const t = transform.toV2({
        raw: result.rawQuestions,
        detection: result.detection,
        slug: result.meta.slug,
        title: result.meta.title,
        level: meta.level,
        subject: meta.subject,
        sourceFile: path.basename(file),
        extractedAt,
        // image storage paths derive from the image's own source path so a
        // reused file always maps to one object (one upload, many references)
        detectLevel: core.detectLevel,
        detectSubject: core.detectSubject,
        imageRefOf: core.imageRefOf,
        deriveAlt: !args.noAlt,
      });
      payload = t.data;
      rep = t.report;

      if (rep.validationErrors.length) {
        agg.validationFailures.push({ slug: result.meta.slug, errors: rep.validationErrors });
      }
      if (rep.bias && rep.bias.biased) {
        agg.biased.push({
          slug: result.meta.slug, type: result.meta.quiz_type,
          position: rep.bias.top_position + 1,
          share: Math.round(rep.bias.top_share * 100), total: rep.bias.total,
        });
      }
      if (rep.titleNeedsReview) agg.titleReview.push({ slug: result.meta.slug, title: result.meta.title });
      if (rep.readingComprehension) {
        agg.readingSets.push({ slug: result.meta.slug, shuffle: payload.shuffle,
          per_attempt: payload.questions_per_attempt, ...rep.readingComprehension });
      }
      agg.passageDrift.push(...rep.passageDrift);
      agg.sizeWarnings.push(...rep.sizeWarnings);
      agg.images += rep.imagesTotal;
      agg.imagesMissingAlt += rep.imagesMissingAlt;
      agg.imagesAltDerived += rep.imagesAltDerived;
    }
    fs.writeFileSync(outPath, JSON.stringify(payload, null, args.pretty ? 2 : 0));

    totals.questions += result.meta.question_count;
    totals.byType[result.meta.quiz_type] = (totals.byType[result.meta.quiz_type] || 0) + 1;

    const typeLabel = result.meta.quiz_type + (result.meta.mode ? "/" + result.meta.mode : "");
    if (rep && rep.validationErrors.length) {
      console.log(
        c(C.red, "  ✗ ") + result.meta.slug.padEnd(34) +
          c(C.cyan, "[" + typeLabel + "]").padEnd(24) +
          result.meta.question_count + " q  " +
          c(C.red, rep.validationErrors.length + " validation error(s)")
      );
      for (const e of rep.validationErrors.slice(0, 3)) console.log(c(C.dim, "        - " + e));
      if (rep.validationErrors.length > 3) console.log(c(C.dim, "        … " + (rep.validationErrors.length - 3) + " more"));
      totals.warning++;
    } else if (result.warnings.length) {
      totals.warning++;
      console.log(
        c(C.yellow, "  ⚠ ") +
          result.meta.slug.padEnd(34) +
          c(C.cyan, "[" + typeLabel + "]").padEnd(24) +
          result.meta.question_count + " q  " +
          c(C.yellow, result.warnings.length + " warning(s)")
      );
      for (const w of result.warnings.slice(0, 5)) {
        console.log(c(C.dim, "        - " + w));
      }
      if (result.warnings.length > 5) {
        console.log(c(C.dim, "        … " + (result.warnings.length - 5) + " more"));
      }
    } else {
      totals.ok++;
      console.log(
        c(C.green, "  ✓ ") +
          result.meta.slug.padEnd(34) +
          c(C.cyan, "[" + typeLabel + "]").padEnd(24) +
          result.meta.question_count + " q"
      );
    }
  }

  // write CSV
  const csvPath = path.join(args.out, "_summary.csv");
  fs.writeFileSync(csvPath, core.buildCsv(csvRows));

  // summary
  console.log("\n" + c(C.bold, "Summary"));
  console.log(
    "  " +
      c(C.green, totals.ok + " ok") +
      "   " +
      c(C.yellow, totals.warning + " with warnings") +
      "   " +
      c(C.red, totals.failed + " failed") +
      c(C.dim, "   (" + totals.questions + " questions total)")
  );
  const typeStr = Object.keys(totals.byType)
    .sort()
    .map((t) => t + ": " + totals.byType[t])
    .join("   ");
  if (typeStr) console.log(c(C.dim, "  by type → ") + typeStr);
  console.log(c(C.dim, "  JSON  → ") + args.out + "/*.json");
  console.log(c(C.dim, "  CSV   → ") + csvPath);

  if (v2) {
    const head = (s) => console.log("\n" + c(C.bold, s));

    head("Validation");
    if (!agg.validationFailures.length) {
      console.log(c(C.green, "  ✓ all exercises pass all 12 assertions"));
    } else {
      const n = agg.validationFailures.reduce((s, f) => s + f.errors.length, 0);
      console.log(c(C.red, `  ✗ ${n} failure(s) across ${agg.validationFailures.length} exercise(s)`));
      for (const f of agg.validationFailures) {
        console.log(c(C.red, "    " + f.slug));
        for (const e of f.errors.slice(0, 5)) console.log(c(C.dim, "      - " + e));
        if (f.errors.length > 5) console.log(c(C.dim, `      … ${f.errors.length - 5} more`));
      }
    }

    head(`Answer-position bias  (>50% in one position)`);
    if (!agg.biased.length) console.log(c(C.green, "  ✓ none"));
    else {
      console.log(c(C.yellow, `  ⚠ ${agg.biased.length} exercise(s) — content problem, NOT auto-corrected:`));
      agg.biased.sort((a, b) => b.share - a.share);
      for (const b of agg.biased.slice(0, 15)) {
        console.log(c(C.dim, `      ${b.slug.padEnd(32)} [${b.type}] position ${b.position} holds ${b.share}% of ${b.total}`));
      }
      if (agg.biased.length > 15) console.log(c(C.dim, `      … ${agg.biased.length - 15} more (see _summary.csv)`));
    }

    head("Reading-comprehension sets");
    if (!agg.readingSets.length) console.log(c(C.dim, "  none detected"));
    else {
      for (const r of agg.readingSets) {
        console.log(c(C.cyan, `  • ${r.slug}`) +
          c(C.dim, ` — ${r.passages} passage(s) lifted out of ${r.questions} prompts;`) +
          c(C.dim, ` shuffle:"${r.shuffle}", ${r.per_attempt}/attempt (rounds up to whole passages)`));
      }
      if (agg.passageDrift.length) {
        console.log(c(C.yellow, `  ⚠ ${agg.passageDrift.length} passage(s) had drifted copies — longest variant kept as canonical:`));
        for (const d of agg.passageDrift.slice(0, 10)) {
          console.log(c(C.dim, `      ${d.slug} ${d.passage_id}: ${d.variants} variants → canonical ${d.canonical_chars} chars`));
        }
      }
    }

    head("Images");
    console.log(c(C.dim, `  ${agg.images} reference(s) mapped to storage paths`));
    console.log(c(C.dim, `  alt text: `) + c(C.green, `${agg.imagesAltDerived} derived from filename`) + c(C.dim, "  ·  ") +
      (agg.imagesMissingAlt ? c(C.yellow, `${agg.imagesMissingAlt} still empty (numeric/slug filenames — need a vision pass)`) : c(C.green, "0 empty")));
    console.log(c(C.dim, `  run  node audit-images.js <source-repo> ${args.out}  to resolve references against real files`));

    head("Titles flagged for review");
    if (!agg.titleReview.length) console.log(c(C.green, "  ✓ none"));
    else {
      console.log(c(C.yellow, `  ⚠ ${agg.titleReview.length} machine-derived title(s):`));
      for (const t of agg.titleReview.slice(0, 12)) console.log(c(C.dim, `      ${t.slug.padEnd(32)} "${t.title}"`));
      if (agg.titleReview.length > 12) console.log(c(C.dim, `      … ${agg.titleReview.length - 12} more`));
    }

    if (agg.sizeWarnings.length) {
      head("Unmappable font sizes");
      for (const w of agg.sizeWarnings.slice(0, 10)) console.log(c(C.yellow, "  ⚠ " + w));
    }
  }
  console.log("");

  const hadValidationFailures = agg.validationFailures.length > 0;
  process.exit(totals.failed ? 2 : hadValidationFailures ? 3 : 0);
}

module.exports = { makeEvalArray, makeStub, listHtmlFiles, parseArgs };

if (require.main === module) {
  main();
}
