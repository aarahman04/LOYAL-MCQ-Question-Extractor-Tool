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
  const args = { input: null, out: "output", stripHtml: false, pretty: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") args.out = argv[++i];
    else if (a === "--strip-html") args.stripHtml = true;
    else if (a === "--no-pretty") args.pretty = false;
    else if (a === "-h" || a === "--help") args.help = true;
    else if (!args.input) args.input = a;
  }
  return args;
}

const HELP = `LOYAL MCQ – Question Extractor (v${core.VERSION})

Usage:
  node extract.js <file-or-folder> [options]

Options:
  -o, --out <dir>     Output folder (default: ./output)
  --strip-html        Strip inline HTML (e.g. <strong>) from MCQ/audio prompts
                      (default: preserve)
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

  console.log(c(C.bold, `\nLOYAL MCQ Extractor`) + c(C.dim, ` v${core.VERSION}`));
  console.log(c(C.dim, `Input : `) + args.input);
  console.log(c(C.dim, `Output: `) + args.out);
  console.log(c(C.dim, `Files : `) + files.length + "\n");

  const csvRows = [];
  const usedSlugs = new Map();
  const totals = { ok: 0, warning: 0, failed: 0, questions: 0, byType: {} };

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

    const result = core.extract(html, path.basename(file), {
      evalArray,
      now,
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

    // unique output filename by slug
    let outSlug = result.meta.slug;
    if (usedSlugs.has(outSlug)) {
      const n = usedSlugs.get(outSlug) + 1;
      usedSlugs.set(outSlug, n);
      outSlug = outSlug + "-" + n;
    } else {
      usedSlugs.set(outSlug, 1);
    }
    const outPath = path.join(args.out, outSlug + ".json");
    fs.writeFileSync(outPath, JSON.stringify(result.data, null, args.pretty ? 2 : 0));

    totals.questions += result.meta.question_count;
    totals.byType[result.meta.quiz_type] = (totals.byType[result.meta.quiz_type] || 0) + 1;

    const typeLabel = result.meta.quiz_type + (result.meta.mode ? "/" + result.meta.mode : "");
    if (result.warnings.length) {
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
  console.log(c(C.dim, "  CSV   → ") + csvPath + "\n");

  process.exit(totals.failed ? 2 : 0);
}

module.exports = { makeEvalArray, makeStub, listHtmlFiles, parseArgs };

if (require.main === module) {
  main();
}
