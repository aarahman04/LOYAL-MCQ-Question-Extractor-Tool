#!/usr/bin/env node
/*
 * audit-images.js
 * ---------------
 * Resolves every image reference in the extracted output against the real
 * files in the source repo, so broken references surface now rather than when
 * a child sees a missing image.
 *
 * Reports:
 *   - unique files referenced vs total references (i.e. how much reuse)
 *   - references per file, most-reused first
 *   - every reference that resolves to nothing, with the questions affected
 *   - files present in the repo that nothing references (dead weight)
 *
 * Usage:
 *   node audit-images.js <source-repo-root> [outputDir=output] [--json report.json]
 *
 * Example:
 *   node audit-images.js /path/to/NEW_LOYAL_QUIZ output
 */
"use strict";

const fs = require("fs");
const path = require("path");

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      walk(full, out);
    } else if (e.isFile() && IMAGE_EXT.test(e.name)) out.push(full);
  }
  return out;
}

// Case-insensitive index of every image in the repo, keyed by normalised
// relative path and also by bare filename (for last-resort matching).
function buildIndex(root) {
  const files = walk(root);
  const byRel = new Map();
  const byName = new Map();
  for (const f of files) {
    const rel = path.relative(root, f).replace(/\\/g, "/");
    byRel.set(rel.toLowerCase(), rel);
    const base = path.basename(f).toLowerCase();
    if (!byName.has(base)) byName.set(base, []);
    byName.get(base).push(rel);
  }
  return { files, byRel, byName };
}

/*
 * Source HTML lives at <root>/question/<...>/file.html and references images
 * with paths relative to that HTML file (e.g. "../../image/set/1.png").
 * Resolve against the HTML's own directory, then fall back to a filename match.
 */
function resolveRef(ref, htmlRelDir, index, root) {
  const cleaned = String(ref).trim().replace(/^\.\//, "");
  const joined = path.posix.normalize(path.posix.join(htmlRelDir, cleaned));
  const hit = index.byRel.get(joined.toLowerCase());
  if (hit) return { rel: hit, how: "path" };

  // try without the leading traversal, relative to repo root
  const bare = cleaned.replace(/^(\.\.\/)+/, "");
  const hit2 = index.byRel.get(bare.toLowerCase());
  if (hit2) return { rel: hit2, how: "root-relative" };

  const name = path.posix.basename(cleaned).toLowerCase();
  const named = index.byName.get(name);
  if (named && named.length === 1) return { rel: named[0], how: "filename" };
  // A same-named file elsewhere is NOT proof this reference is fine — the
  // path itself is wrong. Report it as suspect instead of silently binding.
  if (named && named.length > 1) return { rel: null, how: "ambiguous", candidates: named.length, matches: named };

  return null;
}

// Find the source HTML for an exercise so refs resolve relative to it.
function htmlDirIndex(root) {
  const map = new Map(); // basename -> relative dir
  (function w(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        w(full);
      } else if (/\.html?$/i.test(e.name)) {
        map.set(e.name, path.relative(root, dir).replace(/\\/g, "/"));
      }
    }
  })(root);
  return map;
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--json");
  const jsonIdx = process.argv.indexOf("--json");
  const jsonOut = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null;
  const root = args[0];
  const outDir = args[1] && !args[1].endsWith(".json") ? args[1] : "output";

  if (!root || !fs.existsSync(root)) {
    console.error("Usage: node audit-images.js <source-repo-root> [outputDir] [--json report.json]");
    process.exit(1);
  }

  const index = buildIndex(root);
  const htmlDirs = htmlDirIndex(root);

  const refs = []; // { slug, question, ref, resolved }
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(outDir, f), "utf8"));
    const ex = data.exercise || data;
    const srcHtml = data._source_file;
    const htmlDir = htmlDirs.get(srcHtml) || "";
    for (const q of data.questions || []) {
      const src = q.media && q.media.source_path;
      if (!src) continue;
      refs.push({
        slug: ex.slug, question: q.slug, ref: src, htmlDir,
        resolved: resolveRef(src, htmlDir, index, root),
        storage: q.media.path,
      });
    }
  }

  // ---- aggregate ----
  const byFile = new Map(); // resolved rel -> [refs]
  const broken = [];
  const ambiguous = [];
  for (const r of refs) {
    if (!r.resolved) { broken.push(r); continue; }
    if (!r.resolved.rel) { ambiguous.push(r); continue; }
    const k = r.resolved.rel;
    if (!byFile.has(k)) byFile.set(k, []);
    byFile.get(k).push(r);
  }
  const referenced = new Set(byFile.keys());
  const orphans = index.files
    .map((f) => path.relative(root, f).replace(/\\/g, "/"))
    .filter((rel) => !referenced.has(rel));

  // storage-path collisions: same storage path from different source files
  const storageMap = new Map();
  for (const r of refs) {
    if (!r.resolved || !r.resolved.rel) continue;
    if (!storageMap.has(r.storage)) storageMap.set(r.storage, new Set());
    storageMap.get(r.storage).add(r.resolved.rel);
  }
  const collisions = [...storageMap.entries()].filter(([, s]) => s.size > 1);

  // one source file landing on several storage paths => duplicate uploads
  const fanout = [...byFile.entries()]
    .map(([rel, rs]) => ({ rel, paths: new Set(rs.map((r) => r.storage)) }))
    .filter((x) => x.paths.size > 1);

  const C = { r: "\x1b[31m", y: "\x1b[33m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" };
  const col = process.stdout.isTTY ? (c, s) => c + s + C.x : (c, s) => s;

  console.log(col(C.b, "\nImage reference audit"));
  console.log(col(C.d, "  source repo : ") + root);
  console.log(col(C.d, "  output dir  : ") + outDir + "\n");

  console.log(`  ${String(refs.length).padStart(5)}  image references in ${files.length} exercise file(s)`);
  console.log(`  ${String(referenced.size).padStart(5)}  unique files actually referenced`);
  console.log(`  ${String(index.files.length).padStart(5)}  image files present in the repo`);
  console.log(`  ${String(orphans.length).padStart(5)}  repo images referenced by nothing`);
  const reuse = refs.length - broken.length - ambiguous.length;
  console.log(col(C.d, `\n  reuse factor: ${(reuse / Math.max(referenced.size, 1)).toFixed(1)}× — ${reuse} live references across ${referenced.size} files`));

  const byHow = {};
  for (const r of refs) { const h = r.resolved ? r.resolved.how : "broken"; byHow[h] = (byHow[h] || 0) + 1; }
  console.log(col(C.b, "\nHow references resolved"));
  for (const k of Object.keys(byHow).sort()) console.log(col(C.d, `  ${String(byHow[k]).padStart(5)}  ${k}`));

  console.log(col(C.b, "\nBroken references"));
  if (!broken.length) console.log(col(C.g, "  ✓ none — every reference resolves to a real file"));
  else {
    console.log(col(C.r, `  ✗ ${broken.length} reference(s) resolve to nothing:`));
    const byExercise = new Map();
    for (const b of broken) {
      if (!byExercise.has(b.slug)) byExercise.set(b.slug, []);
      byExercise.get(b.slug).push(b);
    }
    for (const [slug, list] of byExercise) {
      console.log(col(C.r, `    ${slug}`) + col(C.d, ` (${list.length})`));
      for (const b of list.slice(0, 6)) console.log(col(C.d, `      ${b.question}  ${b.ref}`));
      if (list.length > 6) console.log(col(C.d, `      … ${list.length - 6} more`));
    }
  }

  console.log(col(C.b, "\nAmbiguous references") + col(C.d, " (path wrong; a same-named file exists elsewhere)"));
  if (!ambiguous.length) console.log(col(C.g, "  \u2713 none"));
  else {
    console.log(col(C.y, `  \u26a0 ${ambiguous.length} reference(s) need a human to pick the right file:`));
    const byEx = new Map();
    for (const a of ambiguous) { if (!byEx.has(a.slug)) byEx.set(a.slug, []); byEx.get(a.slug).push(a); }
    for (const [slug, list] of byEx) {
      console.log(col(C.y, `    ${slug}`) + col(C.d, ` (${list.length})`));
      for (const a of list.slice(0, 4)) {
        console.log(col(C.d, `      ${a.question}  ${a.ref}  \u2192 ${a.resolved.candidates} same-named candidates`));
      }
      if (list.length > 4) console.log(col(C.d, `      \u2026 ${list.length - 4} more`));
    }
  }

  console.log(col(C.b, "\nMost-reused files"));
  const top = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  for (const [rel, rs] of top) {
    const exercises = new Set(rs.map((r) => r.slug)).size;
    console.log(col(C.d, `  ${String(rs.length).padStart(4)}×  `) + rel + col(C.d, `  (${exercises} exercise(s))`));
  }

  console.log(col(C.b, "\nUpload implications"));
  console.log(col(C.d, `  unique objects to upload: `) + referenced.size +
    col(C.d, `  (vs ${reuse} references — uploading per-reference would waste ${reuse - referenced.size} objects)`));
  if (fanout.length) {
    console.log(col(C.y, `  ⚠ ${fanout.length} source file(s) map to more than one storage path — they would upload twice:`));
    for (const f of fanout.slice(0, 8)) {
      console.log(col(C.d, `      ${f.rel} → ${f.paths.size} paths`));
    }
    if (fanout.length > 8) console.log(col(C.d, `      … ${fanout.length - 8} more`));
  } else {
    console.log(col(C.g, "  ✓ every source file maps to exactly one storage path (1 upload each)"));
  }
  if (collisions.length) {
    console.log(col(C.r, `  ✗ ${collisions.length} storage path(s) claimed by different source files — would overwrite:`));
    for (const [p, s] of collisions.slice(0, 8)) console.log(col(C.d, `      ${p}  ← ${s.size} different files`));
    if (collisions.length > 8) console.log(col(C.d, `      … ${collisions.length - 8} more`));
  } else {
    console.log(col(C.g, "  ✓ no storage-path collisions"));
  }

  if (orphans.length) {
    console.log(col(C.b, "\nUnreferenced repo images") + col(C.d, " (not migrated)"));
    for (const o of orphans.slice(0, 8)) console.log(col(C.d, "      " + o));
    if (orphans.length > 8) console.log(col(C.d, `      … ${orphans.length - 8} more`));
  }
  console.log("");

  if (jsonOut) {
    const report = {
      total_references: refs.length,
      unique_files_referenced: referenced.size,
      repo_image_count: index.files.length,
      broken: broken.map((b) => ({ slug: b.slug, question: b.question, ref: b.ref })),
      ambiguous: ambiguous.map((a) => ({ slug: a.slug, question: a.question, ref: a.ref, candidates: a.resolved.matches })),
      orphans,
      per_file: [...byFile.entries()].map(([rel, rs]) => ({
        file: rel, references: rs.length,
        exercises: [...new Set(rs.map((r) => r.slug))],
        storage_paths: [...new Set(rs.map((r) => r.storage))],
      })).sort((a, b) => b.references - a.references),
    };
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
    console.log("  JSON report → " + jsonOut + "\n");
  }

  process.exit(broken.length || ambiguous.length ? 4 : 0);
}

main();
