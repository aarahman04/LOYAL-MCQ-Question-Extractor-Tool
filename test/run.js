/*
 * Self-contained test suite (no external files needed).
 * Exercises every quiz type, the field aliases, the detection edge cases,
 * and the error handling, using inline HTML fixtures.
 *
 *   npm test   (or: node test/run.js)
 */
"use strict";

const core = require("../lib/core");
const { makeEvalArray } = require("../extract");

const evalArray = makeEvalArray();
const now = "2026-07-22T10:00:00Z";
function run(html, name, opts) {
  return core.extract(html, name, Object.assign({ evalArray, now }, opts || {}));
}

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error("  ✗ " + msg); }
}
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), msg + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

// ---------------------------------------------------------------- MCQ
(function () {
  const html = `<!doctype html><html><head><title>Add Upto 30</title>
    <link rel="stylesheet" href="../../css/question.css"></head><body>
    <script>
      const questions = [
        { question: "A <strong>Rectangle</strong> — how many corners?", options: ["4","3","5"], correct: "4", explanation: "Four." },
        { question: "What is 2 + 11?", options: ["13","14"], correct: "13", explanation: "2 + 11 = 13" }
      ];
    </script>
    <script src="../../js/script.js"></script>
    <script>window.addEventListener("DOMContentLoaded", () => { initMCQQuiz(questions); });</script>
  </body></html>`;
  const r = run(html, "level_1_addition_upto_30.html");
  ok(r.ok, "mcq: ok");
  eq(r.meta.quiz_type, "mcq", "mcq: type");
  eq(r.meta.slug, "addition-upto-30", "mcq: slug strips level prefix");
  eq(r.data.exercise.title, "Add Upto 30", "mcq: title from <title>");
  eq(r.data.questions[0].prompt, "A <strong>Rectangle</strong> — how many corners?", "mcq: <strong> preserved by default");
  eq(r.data.questions[0].options.choices, ["4", "3", "5"], "mcq: 3 options handled");
  eq(r.data.questions[0].type, "mcq", "mcq: question type");
  eq(r.data.questions[1].correct_answer, "13", "mcq: correct_answer text");
  eq(r.data.questions[0].order_index, 1, "mcq: order_index 1-based");
  eq(r.data.questions[0].slug, "q001", "mcq: slug q001");

  // --strip-html option
  const r2 = run(html, "x.html", { stripHtml: true });
  eq(r2.data.questions[0].prompt, "A Rectangle — how many corners?", "mcq: --strip-html strips tags");
})();

// ------------------------------------------------ MCQ aliases + direct init
(function () {
  const html = `<html><body><script>
    const questions = [{ prompt: "P?", options: ["a","b"], answer: "b" }];
    initMCQQuiz(questions);
  </script></body></html>`;
  const r = run(html, "level1_quiz.html");
  ok(r.ok, "aliases: ok (direct init, no DOMContentLoaded)");
  eq(r.data.questions[0].prompt, "P?", "aliases: prompt field read");
  eq(r.data.questions[0].correct_answer, "b", "aliases: answer field read");
})();

// ---------------------------------------------------------------- Audio
(function () {
  const html = `<html><head><link rel="stylesheet" href="../../../../css/audio_style.css"></head><body>
    <script>
      const SW = ["over","name","boy"];
      const questions = SW.map((w, i) => {
        const distractor = SW[(i + 1) % SW.length];
        return { question: "Listen and choose the correct word.", voice: w, options: [w, distractor], correct: w, lang: "en-US" };
      });
    </script>
    <script src="../../../../js/audio.js"></script>
  </body></html>`;
  const r = run(html, "level_1_eng_sight_words1.html");
  ok(r.ok, "audio: ok");
  eq(r.meta.quiz_type, "audio", "audio: detected via audio_style.css + SW.map executed");
  eq(r.data._question_count, 3, "audio: 3 generated questions");
  const q = r.data.questions[0];
  eq(q.type, "audio", "audio: q type");
  eq(q.media, { audio: null, use_tts: true, tts_word: "over", tts_lang: "en-US" }, "audio: media block");
  eq(q.options.choices, ["over", "name"], "audio: choices from map");
  eq(q.correct_answer, "over", "audio: correct");
})();

// ------------------------------------------------------- Two-box sort
(function () {
  const html = `<html><head><link rel="stylesheet" href="../../../../css/dnd.css"></head><body>
    <div class="two-targets">
      <div class="dropbox" data-box="left"  data-placeholder="Adjective"></div>
      <div class="dropbox" data-box="right" data-placeholder="Common Noun"></div>
    </div>
    <script src="../../../../js/drag_and_drop.js"></script>
    <script>
      const questions = [
        { question: "Drag each word to the correct box.", options: ["tall","girl"],
          key: { "tall":"left", "girl":"right" }, explanation: "'tall' is an adjective; 'girl' is a common noun." }
      ];
      initTwoBoxSortQuiz(questions);
    </script>
    <script>window.addEventListener("DOMContentLoaded", () => { initMCQQuiz(questions); });</script>
  </body></html>`;
  const r = run(html, "level_1_eng_drag_and_drop_adjective-common_nouns.html");
  ok(r.ok, "two_box: ok");
  eq(r.meta.quiz_type, "drag_drop", "two_box: type (NOT fooled by stray initMCQQuiz)");
  eq(r.detection.mode, "two_box_sort", "two_box: mode via 2 dropboxes");
  const q = r.data.questions[0];
  eq(q.type, "drag_drop", "two_box: q type");
  eq(q.options.mode, "two_box_sort", "two_box: options.mode");
  eq(q.options.items, [{ id: "1", label: "tall" }, { id: "2", label: "girl" }], "two_box: items");
  eq(q.options.box_a, { label: "Adjective", correct_items: ["1"] }, "two_box: box_a from data-placeholder");
  eq(q.options.box_b, { label: "Common Noun", correct_items: ["2"] }, "two_box: box_b from data-placeholder");
  eq(q.correct_answer, JSON.stringify({ Adjective: ["1"], "Common Noun": ["2"] }), "two_box: correct_answer json");
})();

// -------------------------------------------------------- Word order
(function () {
  const html = `<html><head><link rel="stylesheet" href="../../../../css/dnd.css"></head><body>
    <div class="two-targets">
      <div class="dropbox" data-box="first"  data-placeholder=""></div>
      <div class="dropbox" data-box="second" data-placeholder=""></div>
      <div class="dropbox" data-box="third"  data-placeholder=""></div>
      <div class="dropbox" data-box="forth"  data-placeholder=""></div>
    </div>
    <script src="../../../../js/drag_and_drop.js"></script>
    <script>
      const questions = [
        { question: "Put the words in order to make a complete sentence.",
          options: ["bark","The","can","dog"],
          key: { "The":"first", "dog":"second", "can":"third", "bark":"forth" },
          explanation: "'The dog can bark' is the correct order." }
      ];
      initTwoBoxSortQuiz(questions);
    </script>
  </body></html>`;
  const r = run(html, "level_1_eng_drag_and_drop_scrambled_words.html");
  ok(r.ok, "word_order: ok");
  eq(r.detection.mode, "word_order", "word_order: mode via 4 dropboxes");
  const q = r.data.questions[0];
  eq(q.options.mode, "word_order", "word_order: options.mode");
  eq(q.options.words, ["bark", "The", "can", "dog"], "word_order: words (scrambled)");
  eq(q.options.correct_order, ["The", "dog", "can", "bark"], "word_order: correct_order (forth->4th)");
  eq(q.correct_answer, JSON.stringify(["The", "dog", "can", "bark"]), "word_order: correct_answer json");
})();

// ----------------------------------------------------- Tap-select MATCH
(function () {
  const html = `<html><head><link rel="stylesheet" href="../../css/tap_select.css"></head><body>
    <div id="tap-grid" class="tap-grid"></div>
    <script>
      const questions = [
        { question: "How many cars?<br><span class=\\"tap-scene\\">🚗🚗🚗</span>",
          items: [{ label: "3", correct: true }, { label: "4", correct: false }],
          explanation: "There are three (3) cars." }
      ];
      initTapSelectQuiz(questions);
    </script>
  </body></html>`;
  const r = run(html, "kg3_math_how_many.html");
  ok(r.ok, "tap_match: ok");
  eq(r.meta.quiz_type, "tap_select", "tap_match: type");
  eq(r.meta.slug, "math-how-many", "tap_match: slug strips kg3 prefix");
  const q = r.data.questions[0];
  eq(q.type, "tap_select", "tap_match: q type");
  eq(q.prompt, "How many cars?", "tap_match: prompt cleaned (scene stripped)");
  eq(q.options.mode, "match", "tap_match: mode");
  eq(q.options.scene_emoji, "🚗🚗🚗", "tap_match: scene_emoji extracted from span");
  eq(q.options.choices, ["3", "4"], "tap_match: choices from item labels");
  eq(q.correct_answer, "3", "tap_match: correct_answer = correct label");
})();

// ----------------------------------------------------- Tap-select COUNT
(function () {
  const html = `<html><head><link rel="stylesheet" href="../../css/tap_select.css"></head><body>
    <script>
      const questions = [
        { question: "Tap 6 🌟 stars", count: 6, items: ["🌟","🌟","🌟","🌟","🌟","🌟","🌟"], explanation: "six (6) stars." }
      ];
      initTapSelectQuiz(questions);
    </script>
  </body></html>`;
  const r = run(html, "kg3_math_tap_and_count.html");
  ok(r.ok, "tap_count: ok");
  const q = r.data.questions[0];
  eq(q.options.mode, "count", "tap_count: mode");
  eq(q.options.target_count, 6, "tap_count: target_count");
  eq(q.options.items.length, 7, "tap_count: emoji items preserved");
  eq(q.correct_answer, "6", "tap_count: correct_answer = count");
})();

// -------------------------------------------- malformed question -> _warning
(function () {
  const html = `<html><body><script>
    const questions = [
      { question: "Good?", options: ["a","b"], correct: "a" },
      { question: "Missing correct", options: ["a","b"] },
      { question: "Only one option", options: ["a"], correct: "a" }
    ];
    initMCQQuiz(questions);
  </script></body></html>`;
  const r = run(html, "level_1_broken.html");
  ok(r.ok, "malformed: file still ok");
  eq(r.status, "warning", "malformed: status warning");
  ok(!r.data.questions[0]._warning, "malformed: good question has no _warning");
  ok(!!r.data.questions[1]._warning, "malformed: missing-correct flagged with _warning");
  ok(!!r.data.questions[2]._warning, "malformed: single-option flagged with _warning");
  eq(r.data.questions.length, 3, "malformed: malformed questions still included");
})();

// -------------------------------------------- no questions array -> failed
(function () {
  const html = `<html><body><p>no script here</p></body></html>`;
  const r = run(html, "empty.html");
  ok(!r.ok, "empty: failed");
  eq(r.status, "failed", "empty: status failed");
  ok(!!r.error, "empty: has error message");
})();

// -------------------------------------------- unknown engine -> default mcq
(function () {
  const html = `<html><body><script>
    const questions = [{ question: "Q?", options: ["a","b"], correct: "a" }];
  </script></body></html>`;
  const r = run(html, "mystery.html");
  ok(r.ok, "default: ok");
  eq(r.meta.quiz_type, "mcq", "default: unknown engine defaults to mcq");
})();

// -------------------------------------------- literal-array fallback
(function () {
  // an inline script that would throw when executed (references undefined fn),
  // forcing the balanced-array literal fallback path.
  const html = `<html><body><script>
    boomUndefinedFunction();
    const questions = [{ question: "Fallback?", options: ["a","b"], correct: "b" }];
  </script></body></html>`;
  const r = run(html, "level_1_fallback.html");
  ok(r.ok, "fallback: recovered via literal-array extraction");
  eq(r.data.questions[0].correct_answer, "b", "fallback: data correct");
})();

// ---------------------------------------------------------------- CSV
(function () {
  const r = run(`<html><body><script>const questions=[{question:"Q",options:["a","b"],correct:"a"}];initMCQQuiz(questions);</script></body></html>`, "level_1_csv_test.html");
  const row = core.csvRow(r, "level_1_csv_test.html");
  ok(row.split(",")[1] === "csv-test", "csv: slug column");
  ok(core.buildCsv([row]).startsWith("filename,slug,quiz_type"), "csv: header present");
})();

console.log("\n" + (failed ? "\x1b[31m" : "\x1b[32m") + passed + " passed, " + failed + " failed\x1b[0m\n");
process.exit(failed ? 1 : 0);
