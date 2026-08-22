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


// ==========================================================================
//  v2 format (lib/transform.js)
// ==========================================================================
const transform = require("../lib/transform");

function v2(html, name, extra) {
  const r = core.extract(html, name, { evalArray, now });
  return transform.toV2(Object.assign({
    raw: r.rawQuestions, detection: r.detection, slug: r.meta.slug,
    title: r.meta.title, level: "level-1", subject: "english",
    sourceFile: name, extractedAt: now, imageRefOf: core.imageRefOf,
  }, extra || {}));
}
function noErrors(t, label) {
  ok(t.report.validationErrors.length === 0,
    label + " (errors: " + JSON.stringify(t.report.validationErrors) + ")");
}

// ---- MCQ: ids + answer_key, no answer inside options ----
(function () {
  const t = v2(`<html><body><script>const questions=[
    {question:"Identify the adjective",options:["the","brown","is"],correct:"brown",explanation:"E"}];
    initMCQQuiz(questions);</script></body></html>`, "level_1_eng_adjectives.html");
  const q = t.data.questions[0];
  eq(q.options.choices, [{id:"c1",text:"the"},{id:"c2",text:"brown"},{id:"c3",text:"is"}], "v2 mcq: choices are {id,text}");
  eq(q.answer_key, { correct: ["c2"] }, "v2 mcq: answer_key holds an id array");
  ok(q.difficulty === undefined, "v2 mcq: difficulty dropped");
  ok(q.correct_answer === undefined, "v2 mcq: no correct_answer field");
  ok(!JSON.stringify(q.options).includes("brown\",\"correct"), "v2 mcq: options carry no answer marker");
  eq(t.data.quiz_type, "mcq", "v2 mcq: exercise quiz_type");
  eq(t.data.shuffle, "question", "v2 mcq: shuffle enum defaults to \"question\"");
  noErrors(t, "v2 mcq: validation clean");
})();

// ---- audio: tts inside options ----
(function () {
  const t = v2(`<html><head><link rel="stylesheet" href="../css/audio_style.css"></head><body><script>
    const SW=["the","at"]; const questions=SW.map((w,i)=>({question:"Listen",voice:w,
      options:[w,SW[(i+1)%SW.length]],correct:w,lang:"en-US"}));
    </script><script src="../js/audio.js"></script></body></html>`, "level_1_eng_sight_words1.html");
  const q = t.data.questions[0];
  eq(q.options.tts, { text: "the", lang: "en-US" }, "v2 audio: tts block in options");
  eq(q.answer_key, { correct: ["c1"] }, "v2 audio: answer_key id");
  ok(q.media === null, "v2 audio: media null (tts is not media)");
  ok(t.report.bias && t.report.bias.biased, "v2 audio: position bias detected (all answers first)");
})();

// ---- drag-drop two-box: boxes array + placements ----
(function () {
  const t = v2(`<html><head><link rel="stylesheet" href="../css/dnd.css"></head><body>
    <div class="dropbox" data-box="left" data-placeholder="Proper Noun"></div>
    <div class="dropbox" data-box="right" data-placeholder="Common Noun"></div>
    <script src="../js/drag_and_drop.js"></script><script>const questions=[
    {question:"Drag",options:["girl","Washington"],key:{"girl":"right","Washington":"left"},explanation:"E"}];
    initTwoBoxSortQuiz(questions);</script></body></html>`, "level_1_eng_dnd_proper.html");
  const q = t.data.questions[0];
  eq(q.options.boxes, [{id:"b1",label:"Proper Noun"},{id:"b2",label:"Common Noun"}], "v2 two_box: boxes is an array");
  eq(q.options.items, [{id:"i1",label:"girl"},{id:"i2",label:"Washington"}], "v2 two_box: items");
  eq(q.answer_key, { placements: { i1: "b2", i2: "b1" } }, "v2 two_box: placements map ids");
  ok(!/correct/i.test(JSON.stringify(q.options)), "v2 two_box: no 'correct' inside options");
  noErrors(t, "v2 two_box: validation clean");
})();

// ---- word order: ids follow PRESENTATION order ----
(function () {
  const t = v2(`<html><head><link rel="stylesheet" href="../css/dnd.css"></head><body>
    <div class="dropbox" data-box="first"></div><div class="dropbox" data-box="second"></div>
    <div class="dropbox" data-box="third"></div><div class="dropbox" data-box="forth"></div>
    <script src="../js/drag_and_drop.js"></script><script>const questions=[
    {question:"Order",options:["bark","The","can","dog"],
     key:{"The":"first","dog":"second","can":"third","bark":"forth"},explanation:"E"}];
    initTwoBoxSortQuiz(questions);</script></body></html>`, "level_1_eng_scrambled.html");
  const q = t.data.questions[0];
  eq(q.options.words, [{id:"w1",text:"bark"},{id:"w2",text:"The"},{id:"w3",text:"can"},{id:"w4",text:"dog"}],
    "v2 word_order: ids follow presentation order");
  eq(q.answer_key, { order: ["w2","w4","w3","w1"] }, "v2 word_order: order is ids in correct sequence");
  ok(q.answer_key.order.join(",") !== "w1,w2,w3,w4", "v2 word_order: ids do not leak the answer");
  noErrors(t, "v2 word_order: validation clean");
})();

// ---- tap-select match: size + count tokens, no inline HTML ----
(function () {
  const t = v2(`<html><head><link rel="stylesheet" href="../css/tap_select.css"></head><body><script>
    const questions=[{question:"Tap the biggest",items:[
      {label:"<span style='font-size:3.6rem'>\u{1F353}</span>",correct:true},
      {label:"<span style='font-size:2.4rem'>\u{1F353}</span>",correct:false},
      {label:"<span style='font-size:1.4rem'>\u{1F353}</span>",correct:false}],explanation:"E"}];
    initTapSelectQuiz(questions);</script></body></html>`, "kg3_math_big_small.html");
  const q = t.data.questions[0];
  eq(q.options.choices[0], { id:"c1", emoji:"\u{1F353}", size:"xl" }, "v2 tap match: 3.6rem -> xl token");
  eq(q.options.choices[1].size, "lg", "v2 tap match: 2.4rem -> lg");
  eq(q.options.choices[2].size, "sm", "v2 tap match: 1.4rem -> sm");
  ok(!/style=/i.test(JSON.stringify(q.options)), "v2 tap match: no style= survives in options");
  eq(q.answer_key, { correct: ["c1"] }, "v2 tap match: answer_key id");
  noErrors(t, "v2 tap match: validation clean");
})();

(function () {
  const t = v2(`<html><head><link rel="stylesheet" href="../css/tap_select.css"></head><body><script>
    const questions=[{question:"Tap fewer",items:[{label:"⭐",correct:true},{label:"⭐⭐",correct:false}],explanation:"E"}];
    initTapSelectQuiz(questions);</script></body></html>`, "kg3_math_more_less.html");
  const q = t.data.questions[0];
  eq(q.options.choices, [{id:"c1",emoji:"⭐",count:1},{id:"c2",emoji:"⭐",count:2}],
    "v2 tap match: repeated emoji -> {emoji,count}");
})();

// ---- tap-select count mode ----
(function () {
  const t = v2(`<html><head><link rel="stylesheet" href="../css/tap_select.css"></head><body><script>
    const questions=[{question:"Tap 6 stars",count:6,items:["\u{1F31F}","\u{1F31F}","\u{1F31F}","\u{1F31F}","\u{1F31F}","\u{1F31F}","\u{1F31F}"],explanation:"E"}];
    initTapSelectQuiz(questions);</script></body></html>`, "kg3_math_tap_and_count.html");
  const q = t.data.questions[0];
  eq(q.options, { mode:"count", emoji:"\u{1F31F}", item_count:7 }, "v2 tap count: options {mode,emoji,item_count}");
  eq(q.answer_key, { target_count: 6 }, "v2 tap count: answer_key target_count");
  noErrors(t, "v2 tap count: validation clean");
})();

// ---- media: storage path + source_path, empty alt ----
(function () {
  const t = v2(`<html><body><script>const questions=[
    {question:"Q",options:["a","b"],correct:"a",image:"../../image/set/1.png"}];
    initMCQQuiz(questions);</script></body></html>`, "level_1_eng_imgs.html", { level:"level-1", subject:"english" });
  const m = t.data.questions[0].media;
  eq(m.kind, "image", "v2 media: kind");
  eq(m.path, "questions/shared/set/1.webp", "v2 media: path derives from the SOURCE path (dedupe), .webp, no URL");
  eq(m.source_path, "../../image/set/1.png", "v2 media: source_path preserved for migration");
  eq(m.alt, "", "v2 media: alt left empty, never invented");
  eq(t.report.imagesMissingAlt, 1, "v2 media: missing-alt counted");
})();

// ---- validation catches a bad answer reference ----
(function () {
  const t = v2(`<html><body><script>const questions=[
    {question:"Q",options:["a","b"],correct:"zzz"}];initMCQQuiz(questions);</script></body></html>`, "level_1_bad.html");
  ok(t.report.validationErrors.length > 0, "v2 validation: unmatched correct answer is reported");
  ok(/not among the choices/.test(t.report.validationErrors.join(" ")), "v2 validation: message is specific");
})();

// ---- reading comprehension: passage lifted, prompts cleaned ----
(function () {
  const P = '<div style="text-align:center;">Ted gets a pen.<br>The pen is red.<br>He draws ten red hens.<br>Ted is happy today.</div><br>';
  const qs = [1,2,3,4].map(n => `{question:${JSON.stringify(P + '<span style="color:red;">' + n + '. Question ' + n + '?</span>')},options:["a","b"],correct:"a"}`).join(",");
  const t = v2(`<html><body><script>const questions=[${qs}];initMCQQuiz(questions);</script></body></html>`, "leve1_eng_vowels_E.html");
  ok(Array.isArray(t.data.passages) && t.data.passages.length === 1, "v2 rc: one passage lifted to exercise");
  ok(/Ted gets a pen/.test(t.data.passages[0].text), "v2 rc: passage text extracted");
  eq(t.data.questions[0].prompt, "Question 1?", "v2 rc: prompt stripped of passage AND leading number");
  eq(t.data.questions[0].passage_id, "p1", "v2 rc: question linked by passage_id");
  eq(t.data.shuffle, "group", "v2 rc: shuffle enum is \"group\"");
  eq(t.data.questions_per_attempt, Math.min(25, t.data.total_questions),
    "v2 rc: normal attempt length (not the whole set), engine rounds to whole passages");
})();

// ---- title review heuristics ----
(function () {
  ok(transform.titleNeedsReview("Leve1 Eng Vowels E", "x"), "v2 title: level prefix flagged");
  ok(transform.titleNeedsReview("Eng Sight Words1", "x"), "v2 title: glued trailing digit flagged");
  ok(!transform.titleNeedsReview("Number Bonds to 10", "x"), "v2 title: spaced trailing number NOT flagged");
  ok(!transform.titleNeedsReview("Adjectives", "eng-adjectives-x"), "v2 title: clean title not flagged");
})();

// ---- size token table ----
(function () {
  eq(transform.sizeToken(1.4), "sm", "v2 size: 1.4rem -> sm");
  eq(transform.sizeToken(2.0), "md", "v2 size: 2.0rem -> md");
  eq(transform.sizeToken(2.4), "lg", "v2 size: 2.4rem -> lg");
  eq(transform.sizeToken(3.6), "xl", "v2 size: 3.6rem -> xl");
})();


// ---- shuffle enum + group semantics ----
(function () {
  const t = v2(`<html><body><script>const questions=[{question:"Q",options:["a","b"],correct:"a"}];
    initMCQQuiz(questions);</script></body></html>`, "level_1_x.html");
  eq(t.data.shuffle, "question", "shuffle enum: plain exercise -> 'question'");
})();

// ---- image storage paths dedupe across exercises ----
(function () {
  const mk = (name) => v2(`<html><body><script>const questions=[
    {question:"Q",options:["a","b"],correct:"a",image:"../../image/level_1_math/number_line_1_to_50.jpg"}];
    initMCQQuiz(questions);</script></body></html>`, name,
    { detectLevel: core.detectLevel, detectSubject: core.detectSubject });
  const a = mk("level_1_number_line_upto_30.html").data.questions[0].media.path;
  const b = mk("level_1_number_line_upto_50.html").data.questions[0].media.path;
  eq(a, b, "media dedupe: same source file -> identical storage path across exercises");
  eq(a, "questions/level-1/math/level_1_math/number_line_1_to_50.webp", "media dedupe: path shape");
})();

// ---- alt text derived from descriptive filenames only ----
(function () {
  const alt = (img) => v2(`<html><body><script>const questions=[
    {question:"Q",options:["a","b"],correct:"a",image:${JSON.stringify(img)}}];
    initMCQQuiz(questions);</script></body></html>`, "level_1_eng_x.html").data.questions[0].media.alt;
  eq(alt("../img/Identify level 1 eng/Big Bear.png"), "Big Bear", "alt: descriptive filename -> alt text");
  eq(alt("../img/set/6 eggs.png"), "6 eggs", "alt: keeps leading number when words follow");
  eq(alt("../img/set/105.png"), "", "alt: numeric filename -> empty, never invented");
  eq(alt("../img/set/image1.png"), "", "alt: generic imageN -> empty");
  eq(alt("../img/set/lvl_1_eng_identify_image_verbs(3).jpg"), "", "alt: exercise slug -> empty, not a description");
})();

// ---- validation rejects a bad shuffle value / group without passages ----
(function () {
  const errs = [];
  transform.validateExercise({ shuffle: "sometimes", total_questions: 0, questions_per_attempt: 0, questions: [] }, errs);
  ok(errs.some((e) => /shuffle must be one of/.test(e)), "validation: unknown shuffle value rejected");
  const errs2 = [];
  transform.validateExercise({ shuffle: "group", total_questions: 0, questions_per_attempt: 0, questions: [] }, errs2);
  ok(errs2.some((e) => /requires a passages array/.test(e)), "validation: shuffle 'group' needs passages");
})();

// ==========================================================================
//  picture ("image") exercises
// ==========================================================================

// ---- the picture field, however the source file spells it ----
(function () {
  const ref = (q) => core.imageRefOf(q);
  eq(ref({ image: "../image/a/1.png" }), "../image/a/1.png", "imageRef: image");
  eq(ref({ img: "../image/a/1.jpg" }), "../image/a/1.jpg", "imageRef: img");
  eq(ref({ imageUrl: "../image/a/1.webp" }), "../image/a/1.webp", "imageRef: imageUrl");
  eq(ref({ image_url: "../image/a/1.gif" }), "../image/a/1.gif", "imageRef: image_url");
  eq(ref({ "Image-SRC": "../image/a/1.svg" }), "../image/a/1.svg", "imageRef: key case/separators ignored");
  eq(ref({ picture: "../image/a/1.png" }), "../image/a/1.png", "imageRef: picture");
  eq(ref({ photo: "../image/a/1.png" }), "../image/a/1.png", "imageRef: photo");
  eq(ref({ image: { src: "../image/a/1.png" } }), "../image/a/1.png", "imageRef: { src } object");
  eq(ref({ media: { kind: "image", url: "../image/a/1.png" } }), "../image/a/1.png", "imageRef: nested media object");
  eq(ref({ image: ["../image/a/1.png", "../image/a/2.png"] }), "../image/a/1.png", "imageRef: array -> first usable");
  eq(ref({ image: '<img src="../image/a/1.png" alt="x">' }), "../image/a/1.png", "imageRef: field holding an <img> tag");
  eq(ref({ question: 'Match this <img src="../image/a/1.png">' }), "../image/a/1.png", "imageRef: <img> inlined in the prompt");
  eq(ref({ image: "../image/KG_3_Vowel_A/1" }), "../image/KG_3_Vowel_A/1", "imageRef: extensionless path under image/");
  eq(ref({ image: "data:image/png;base64,AAAA" }), "data:image/png;base64,AAAA", "imageRef: data URI");
  // non-images must not be mistaken for pictures
  eq(ref({ url: "https://example.com/page" }), null, "imageRef: generic url that is not an image -> null");
  eq(ref({ src: "cat" }), null, "imageRef: bare word -> null");
  eq(ref({ question: "Which word matches?", options: ["a", "b"] }), null, "imageRef: text-only question -> null");
  eq(ref(null), null, "imageRef: non-object -> null");
})();

// ---- an all-picture MCQ bank becomes its own type ----
(function () {
  const html = `<!doctype html><html><head><title>Vowel A — Picture Words</title>
    <link rel="stylesheet" href="../../css/question.css"></head><body><script>
    const questions = [
      { question:"Which word matches the picture?", image:"../../image/KG_3_Vowel_A/1.png", options:["mat","cat"], correct:"cat", explanation:"cat" },
      { question:"Which word matches the picture?", image:"../../image/KG_3_Vowel_A/2.png", options:["hat","cat"], correct:"hat", explanation:"hat" }
    ];
    </script><script src="../../js/script.js"></script>
    <script>initMCQQuiz(questions);</script></body></html>`;
  const r = run(html, "kg3_eng_vowel_a.html");
  eq(r.meta.quiz_type, "image", "image: all-picture MCQ bank detected as image");
  eq(r.data.questions[0].type, "image", "image: v1 question type");
  eq(r.data.questions[0].media, { kind: "image", source_path: "../../image/KG_3_Vowel_A/1.png" }, "image: v1 keeps the reference as written");

  const t = v2(html, "kg3_eng_vowel_a.html", { level: "kg3", subject: "english",
    detectLevel: core.detectLevel, detectSubject: core.detectSubject });
  eq(t.data.quiz_type, "image", "v2 image: exercise quiz_type");
  eq(t.data.questions[0].type, "image", "v2 image: question type");
  eq(t.data.questions[0].media.kind, "image", "v2 image: media kind");
  eq(t.data.questions[0].media.path, "questions/kg3/english/KG_3_Vowel_A/1.webp", "v2 image: storage path");
  eq(t.data.questions[0].answer_key, { correct: ["c2"] }, "v2 image: answers like an MCQ");
  noErrors(t, "v2 image: validation clean");
})();

// ---- detection survives a differently-spelled picture field ----
(function () {
  const html = `<html><body><script>const questions=[
    {question:"Which word matches the picture?", imageUrl:"../image/set/1.png", options:["mat","cat"], correct:"cat"},
    {question:"Which word matches the picture?", imageUrl:"../image/set/2.png", options:["hat","cat"], correct:"hat"}];
    initMCQQuiz(questions);</script></body></html>`;
  const t = v2(html, "kg3_eng_vowel_x.html", { level: "kg3", subject: "english",
    detectLevel: core.detectLevel, detectSubject: core.detectSubject });
  eq(t.data.quiz_type, "image", "image alias: imageUrl bank still detected");
  eq(t.data.questions[1].media.source_path, "../image/set/2.png", "image alias: media mapped from imageUrl");
})();

// ---- a mostly-text MCQ bank stays "mcq" ----
(function () {
  const qs = [];
  for (let i = 0; i < 10; i++) {
    qs.push(`{question:"Q${i}",options:["a","b"],correct:"a"${i === 0 ? ',image:"../image/set/1.png"' : ""}}`);
  }
  const t = v2(`<html><body><script>const questions=[${qs.join(",")}];
    initMCQQuiz(questions);</script></body></html>`, "level_1_eng_x.html");
  eq(t.data.quiz_type, "mcq", "image: 1-of-10 illustrated bank stays mcq");
  eq(t.data.questions[0].media.kind, "image", "image: the illustrated question still gets media");
})();

// ---- other engines keep their own type even when every question has a picture ----
(function () {
  const t = v2(`<html><head><link rel="stylesheet" href="../css/tap_select.css"></head><body><script>
    const questions=[{question:"Tap the ball",image:"../image/set/1.png",items:["🏀","🍎"],correct:"🏀"},
                     {question:"Tap the apple",image:"../image/set/2.png",items:["🏀","🍎"],correct:"🍎"}];
    </script><script src="../js/tap_select.js"></script></body></html>`, "kg3_math_tap.html");
  eq(t.data.quiz_type, "tap_select", "image: tap-select with pictures keeps its engine type");
})();

// ---- a picture question with no picture is a validation error ----
(function () {
  const errs = [];
  transform.validateQuestion({ slug: "q001", type: "image", prompt: "P",
    options: { choices: [{ id: "c1", text: "a" }, { id: "c2", text: "b" }] },
    answer_key: { correct: ["c1"] }, media: null }, errs);
  ok(errs.some((e) => /image question without a media/.test(e)), "v2 image: missing media rejected");
})();

// ---- subject detection prefers the filename over the containing folder ----
(function () {
  eq(core.detectSubject("kg3 eng vowel a html", null), "english", "subject: filename keyword wins");
  eq(core.detectSubject("some scratch folder", null), null, "subject: null fallback when nothing matches");
  eq(core.detectSubject("some scratch folder"), "math", "subject: default fallback unchanged");
})();

// ==========================================================================
//  engine detection: the linked <script> is the primary signal
// ==========================================================================

const MCQ_DATA = `const questions=[{question:"Q1",options:["a","b"],correct:"a"},
                                  {question:"Q2",options:["a","b"],correct:"b"}];`;

// ---- the engine script alone decides, with no stylesheet and no init call ----
(function () {
  const only = (src, data) =>
    run(`<html><head><link rel="stylesheet" href="../../css/question.css"></head><body>
      <script>${data || MCQ_DATA}</script>
      <script src="${src}"></script></body></html>`, "level_1_eng_x.html");

  eq(only("../../js/script.js").meta.quiz_type, "mcq", "engine: script.js -> mcq");
  eq(only("../../js/audio.js", `const questions=[{question:"Listen",voice:"the",options:["the","at"],correct:"the"}];`)
    .meta.quiz_type, "audio", "engine: audio.js -> audio");
  eq(only("../../js/tap_select.js", `const questions=[{question:"Tap",items:[{label:"A",correct:true}]}];`)
    .meta.quiz_type, "tap_select", "engine: tap_select.js -> tap_select");
  eq(only("../../js/drag_and_drop.js", `const questions=[{question:"Sort",options:["a","b"],key:{a:"left",b:"right"}}];`)
    .meta.quiz_type, "drag_drop", "engine: drag_and_drop.js -> drag_drop");

  // path shape and cache-busting query strings must not matter
  eq(only("/js/tap_select.js?v=3", `const questions=[{question:"Tap",items:[{label:"A",correct:true}]}];`)
    .meta.quiz_type, "tap_select", "engine: absolute path + ?query still matches");
  eq(only("js\\\\tap_select.js", `const questions=[{question:"Tap",items:[{label:"A",correct:true}]}];`)
    .meta.quiz_type, "tap_select", "engine: backslash path still matches");
})();

// ---- the script tier outranks a misleading stylesheet / stray init ----
(function () {
  const r = run(`<html><head>
      <link rel="stylesheet" href="../css/dnd.css"></head><body>
      <div class="dropbox" data-box="left" data-placeholder="L"></div>
      <div class="dropbox" data-box="right" data-placeholder="R"></div>
      <script>${MCQ_DATA}</script>
      <script src="../js/tap_select.js"></script>
      <script>initMCQQuiz(questions);</script></body></html>`, "level_1_eng_x.html");
  eq(r.meta.quiz_type, "tap_select", "engine: linked script beats dnd.css + dropboxes + stray initMCQQuiz");
  eq(r.detection.type_source, "script", "engine: type_source reports the deciding tier");
})();

// ---- an engine name that is only mentioned, never linked, is not a signal ----
(function () {
  const r = run(`<html><head><link rel="stylesheet" href="../css/question.css"></head><body>
      <!-- this page used to load audio.js and tap_select.css -->
      <script>/* see drag_and_drop.js for the sorting variant */ ${MCQ_DATA}</script>
      <script src="../js/script.js"></script></body></html>`, "level_1_eng_x.html");
  eq(r.meta.quiz_type, "mcq", "engine: names inside comments/strings are not links");
})();

// ---- falls down the tiers when the script tag is absent ----
(function () {
  const styleOnly = run(`<html><head><link rel="stylesheet" href="../css/tap_select.css"></head><body>
      <script>const questions=[{question:"Tap",items:[{label:"A",correct:true}]}];</script></body></html>`, "x.html");
  eq(styleOnly.detection.type_source, "style", "engine: stylesheet tier used when no script linked");
  eq(styleOnly.meta.quiz_type, "tap_select", "engine: stylesheet tier resolves the type");

  const initOnly = run(`<html><body>
      <script>const questions=[{question:"Tap",items:[{label:"A",correct:true}]};
      initTapSelectQuiz(questions);</script></body></html>`, "x.html");
  eq(initOnly.meta.quiz_type, "tap_select", "engine: init-call tier when nothing is linked");

  const markupOnly = run(`<html><body><div id="tap-grid"></div>
      <script>const questions=[{question:"Tap",items:[{label:"A",correct:true}]}];</script></body></html>`, "x.html");
  eq(markupOnly.detection.type_source, "markup", "engine: DOM-hook tier when nothing else is present");
  eq(markupOnly.meta.quiz_type, "tap_select", "engine: #tap-grid resolves the type");
})();

// ---- nothing identifies an engine: extract anyway, but say so ----
(function () {
  // plain question/options/correct fits both mcq and image, so the data tier
  // cannot resolve it either — it stays "default" and is reported as such
  const r = run(`<html><body><script>${MCQ_DATA}</script></body></html>`, "x.html");
  eq(r.detection.type_source, "default", "engine: an MCQ-shaped file with no markup stays undecided");
  // a distinctive data shape does resolve it
  const tap = run(`<html><body><script>const questions=[{question:"Tap",items:[{label:"A",correct:true}]}];</script></body></html>`, "x.html");
  eq(tap.detection.type_source, "data", "engine: distinctive data shape resolves an unmarked file");
  eq(tap.meta.quiz_type, "tap_select", "engine: data tier picks tap_select");

  const bare = run(`<html><body><script>const questions=[{prompt:"P",options:["a","b"],correct:"a"}];</script></body></html>`, "x.html");
  eq(bare.meta.quiz_type, "mcq", "engine: unidentifiable file still extracts as mcq");
  ok(bare.warnings.some((w) => /nothing identified an engine/.test(w)), "engine: defaulted type is warned about");
})();

// ---- markup and data disagree: markup wins, disagreement is reported ----
(function () {
  const r = run(`<html><body>
      <script>const questions=[{question:"Listen",voice:"the",options:["the","at"],correct:"the"}];</script>
      <script src="../js/tap_select.js"></script></body></html>`, "x.html");
  eq(r.meta.quiz_type, "tap_select", "engine: linked script is not overruled by the data shape");
  ok(r.warnings.some((w) => /question data looks like audio/.test(w)), "engine: markup/data conflict is warned about");
})();

// ==========================================================================
//  question-array discovery
// ==========================================================================

// ---- the bank lives under a different name, handed to the engine ----
(function () {
  const r = run(`<html><body><script>
      const bank = [{question:"Q1",options:["a","b"],correct:"a"},
                    {question:"Q2",options:["a","b"],correct:"b"}];
      window.addEventListener("DOMContentLoaded", () => initMCQQuiz(bank));
      </script><script src="../js/script.js"></script></body></html>`, "level_1_eng_x.html");
  ok(r.ok, "discovery: bank under another name extracts");
  eq(r.meta.question_count, 2, "discovery: all questions found via the init-call argument");
})();

// ---- an engine the sandbox has never heard of must not kill extraction ----
(function () {
  const r = run(`<html><body><script>
      const questions=[{question:"Q1",options:["a","b"],correct:"a"}];
      initBrandNewMatchingQuiz(questions);
      </script><script src="../js/script.js"></script></body></html>`, "level_1_eng_x.html");
  ok(r.ok, "discovery: unknown init*Quiz function is stubbed, not a ReferenceError");
  eq(r.meta.question_count, 1, "discovery: questions still extracted");
})();

// ---- a decorative array is not mistaken for a question bank ----
(function () {
  const r = run(`<html><body><script>
      const EMOJI = ["🍎","🍌","🍇"];
      const bank = [{question:"Q1",options:["a","b"],correct:"a"}];
      initMCQQuiz(bank);
      </script></body></html>`, "level_1_eng_x.html");
  eq(r.meta.question_count, 1, "discovery: word/emoji list rejected, real bank used");
  ok(!r.ok || r.data.questions[0].prompt === "Q1", "discovery: extracted the question objects");
})();

// ==========================================================================
//  level / subject classification
// ==========================================================================

// ---- keywords match whole words, never substrings ----
(function () {
  const sub = (s) => core.detectSubject(s, null);
  // the bug this replaced: "eng" inside lengths / strength / challenge
  eq(sub("level_1_math_measure_lengths.html"), "math", "subject: 'lengths' is not English");
  eq(sub("level_2_math_challenge.html"), "math", "subject: 'challenge' is not English");
  eq(sub("level_1_math_strength.html"), "math", "subject: 'strength' is not English");
  eq(sub("level_1_gk_scissors.html"), "gk", "subject: 'scissors' is not Science");
  // and the real keywords still match, including plurals
  eq(sub("level_1_eng_adjectives.html"), "english", "subject: plural keyword matches");
  eq(sub("kg3_eng_vowel_a.html"), "english", "subject: eng token");
  eq(sub("level1_sci_animals.html"), "science", "subject: sci token");
  eq(sub("level_1_gk_fruits.html"), "gk", "subject: gk token");
  // folder names from the source tree
  eq(sub("KG-3_English"), "english", "subject: folder KG-3_English");
  eq(sub("Level 1 Maths"), "math", "subject: folder 'Level 1 Maths'");
  eq(sub("level-1_Science"), "science", "subject: folder level-1_Science");
  eq(sub("level_1_GK"), "gk", "subject: folder level_1_GK");
  eq(sub("KG-3_math"), "math", "subject: folder KG-3_math");
  eq(sub("some scratch folder"), null, "subject: no keyword -> null with an explicit fallback");
})();

// ---- level families, joined or separated, plus the grade family ----
(function () {
  const lvl = (s) => core.detectLevel("", s);
  eq(lvl("kg3_eng_vowel_a.html"), "kg3", "level: kg3 joined");
  eq(lvl("KG-3_English"), "kg3", "level: KG-3 separated");
  eq(lvl("level_1_addition.html"), "level-1", "level: level_1");
  eq(lvl("Level 1 Maths"), "level-1", "level: 'Level 1' with a space");
  eq(lvl("leve1_eng_vowels.html"), "level-1", "level: 'leve' misspelling");
  eq(lvl("lvl1_sci_animals.html"), "level-1", "level: lvl abbreviation");
  eq(lvl("level_12_x.html"), "level-12", "level: any number, not a fixed set");
  eq(lvl("grade_2_eng_nouns.html"), "grade-2", "level: grade family");
  eq(lvl("random_file.html"), null, "level: no level word -> null");
})();

console.log("\n" + (failed ? "\x1b[31m" : "\x1b[32m") + passed + " passed, " + failed + " failed\x1b[0m\n");
process.exit(failed ? 1 : 0);
