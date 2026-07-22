#!/usr/bin/env node
/*
 * organize.js
 * -----------
 * Sorts the extracted exercise JSON (from ./output) into a seed-data/ tree
 * grouped by level and subject:
 *
 *   seed-data/<level>/<subject>/<slug>.json
 *   seed-data/_summary.csv
 *
 * Nothing about the levels or subjects is hardcoded to a fixed set — both are
 * auto-detected, so new levels (Level 5, KG 2, …) "just work" and new subject
 * keywords are a one-line array edit.
 *
 * ── Level detection ────────────────────────────────────────────────────────
 * The level prefix is pulled from the source filename / slug by pattern, for
 * any number:
 *   kg3_ | kg-3_            -> kg3/
 *   kg2_                    -> kg2/
 *   level_1_ | level1_
 *     | lvl1_ | leve1_      -> level-1/     (leve = common misspelling of level)
 *   level_2_               -> level-2/     … and so on for any number.
 * If no level prefix is found, a warning is printed and the file goes to
 * _unclassified/.
 *
 * ── Subject detection ──────────────────────────────────────────────────────
 * The slug is scanned against keyword rules, in order; the first rule with a
 * matching keyword wins, otherwise "math".
 *
 * Both rule sets live in lib/core.js (LEVEL_FAMILIES / SUBJECT_RULES) as simple
 * arrays so the CLI and the Organize web page share one source of truth — edit
 * them there to extend; no other code changes needed.
 *
 * Usage:  node organize.js [inputDir=output] [outDir=seed-data]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("./lib/core");

const UNCLASSIFIED = core.UNCLASSIFIED;
const levelFor = core.detectLevel; // (slug, sourceFile) -> "kg3" | "level-1" | null
const subjectFor = core.detectSubject; // (slug) -> "english" | "math" | ...

// ── main ────────────────────────────────────────────────────────────────────

function main() {
  const INPUT = process.argv[2] || "output";
  const OUTDIR = process.argv[3] || "seed-data";

  if (!fs.existsSync(INPUT)) {
    console.error(`Input folder not found: ${INPUT}\nRun the extractor first (e.g. node extract.js <src> -o output).`);
    process.exit(1);
  }

  // start clean so re-runs don't leave stale files behind
  if (fs.existsSync(OUTDIR)) fs.rmSync(OUTDIR, { recursive: true, force: true });
  fs.mkdirSync(OUTDIR, { recursive: true });

  const jsonFiles = fs
    .readdirSync(INPUT)
    .filter((f) => f.toLowerCase().endsWith(".json")) // skips _summary.csv
    .sort();

  const counts = {}; // "level/subject" -> n
  const unclassified = []; // files with no detectable level
  let total = 0;

  for (const file of jsonFiles) {
    const srcPath = path.join(INPUT, file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(srcPath, "utf8"));
    } catch (e) {
      console.error(`  ! skipping ${file}: invalid JSON (${e.message})`);
      continue;
    }

    const slug = (data.exercise && data.exercise.slug) || path.basename(file, ".json");
    const detectedLevel = levelFor(slug, data._source_file);
    const level = detectedLevel || UNCLASSIFIED;
    const subject = subjectFor(slug);

    if (!detectedLevel) unclassified.push({ file, source: data._source_file });

    const destDir = path.join(OUTDIR, level, subject);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcPath, path.join(destDir, file));

    const key = `${level}/${subject}`;
    counts[key] = (counts[key] || 0) + 1;
    total++;
  }

  // carry the CSV summary to the seed-data root (matches the target tree)
  const csvSrc = path.join(INPUT, "_summary.csv");
  if (fs.existsSync(csvSrc)) fs.copyFileSync(csvSrc, path.join(OUTDIR, "_summary.csv"));

  // ── report ────────────────────────────────────────────────────────────────
  if (unclassified.length) {
    console.warn(`\n⚠ ${unclassified.length} file(s) had no detectable level prefix -> ${UNCLASSIFIED}/:`);
    for (const u of unclassified) console.warn(`    ${u.file}  (source: ${u.source || "?"})`);
  }

  console.log(`\nOrganized ${total} exercise file(s) into ${OUTDIR}/\n`);
  const keys = Object.keys(counts).sort();
  const width = keys.reduce((w, k) => Math.max(w, k.length), 0);
  for (const k of keys) {
    console.log(`  ${k.padEnd(width)}  ${String(counts[k]).padStart(3)}`);
  }
  console.log(`  ${"".padEnd(width, "-")}  ---`);
  console.log(`  ${"total".padEnd(width)}  ${String(total).padStart(3)}`);
  if (fs.existsSync(csvSrc)) console.log(`\n  + _summary.csv -> ${OUTDIR}/_summary.csv`);
  console.log("");
}

main();
