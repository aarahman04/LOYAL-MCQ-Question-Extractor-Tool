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
 * Level   : _source_file (or slug) starting with "kg3" -> kg3/, else level-1/
 * Subject : from the slug --
 *   english : contains  eng | vowels | sight-words | drag-and-drop
 *                       | eng-reading | reading-vocabulary
 *   gk      : contains  gk
 *   science : contains  sci
 *   math    : everything else
 *
 * Note on "reading": bare `reading` does NOT route to English. Only
 * `eng-reading` / `reading-vocabulary` do — so number-reading MATH exercises
 * like `reading-numbers-till-30` correctly land under math/.
 *
 * Usage:  node organize.js [inputDir=output] [outDir=seed-data]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const INPUT = process.argv[2] || "output";
const OUTDIR = process.argv[3] || "seed-data";

// ---- classification --------------------------------------------------------

function levelFor(slug, sourceFile) {
  const s = String(sourceFile || "").toLowerCase();
  const sl = String(slug || "").toLowerCase();
  return s.startsWith("kg3") || sl.startsWith("kg3") ? "kg3" : "level-1";
}

// `reading` alone is intentionally NOT an English signal (reading-numbers is
// math). Only eng-reading / reading-vocabulary route to English.
const ENGLISH_TOKENS = [
  "eng",
  "vowels",
  "sight-words",
  "drag-and-drop",
  "eng-reading",
  "reading-vocabulary",
];

function subjectFor(slug) {
  const s = String(slug || "").toLowerCase();
  if (ENGLISH_TOKENS.some((t) => s.includes(t))) return "english";
  if (s.includes("gk")) return "gk";
  if (s.includes("sci")) return "science";
  return "math";
}

// ---- main ------------------------------------------------------------------

function main() {
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
  let total = 0;
  const readingNumbers = []; // files touched by the reading-numbers -> math rule

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
    const level = levelFor(slug, data._source_file);
    const subject = subjectFor(slug);

    const destDir = path.join(OUTDIR, level, subject);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(srcPath, path.join(destDir, file));

    const key = `${level}/${subject}`;
    counts[key] = (counts[key] || 0) + 1;
    total++;
    if (slug.includes("reading-numbers")) readingNumbers.push(`${key}/${file}`);
  }

  // carry the CSV summary to the seed-data root (matches the target tree)
  const csvSrc = path.join(INPUT, "_summary.csv");
  if (fs.existsSync(csvSrc)) fs.copyFileSync(csvSrc, path.join(OUTDIR, "_summary.csv"));

  // ---- report --------------------------------------------------------------
  console.log(`\nOrganized ${total} exercise file(s) into ${OUTDIR}/\n`);
  const keys = Object.keys(counts).sort();
  const width = keys.reduce((w, k) => Math.max(w, k.length), 0);
  for (const k of keys) {
    console.log(`  ${k.padEnd(width)}  ${String(counts[k]).padStart(3)}`);
  }
  console.log(`  ${"".padEnd(width, "-")}  ---`);
  console.log(`  ${"total".padEnd(width)}  ${String(total).padStart(3)}`);
  if (fs.existsSync(csvSrc)) console.log(`\n  + _summary.csv -> ${OUTDIR}/_summary.csv`);
  if (readingNumbers.length) {
    console.log(`\n  reading-numbers-* routed to math (not english): ${readingNumbers.length} file(s)`);
  }
  console.log("");
}

main();
