/*
 * LOYAL QUIZ – v2 output transformation
 * -------------------------------------
 * Converts the RAW question objects parsed out of the source HTML into the
 * target format described in LOYAL_QUIZ_Question_Format.md.
 *
 * This module performs NO HTML parsing of its own — lib/core.js still does all
 * of that. This is purely a transformation of the output shape, plus the
 * validation and content analysis that goes with it.
 *
 * The central rule: every question carries two sibling fields —
 *   options     render-safe, sent to the browser
 *   answer_key  never sent, contains ONLY IDs
 * so the render payload is structurally incapable of leaking the answer.
 *
 * ID convention: prefixed IDs (c1/i1/b1/w1), not bare a/b/c. Choice *text* in
 * this corpus is sometimes a bare letter ("a" is a sight word), so letter IDs
 * would collide with displayed content and defeat leak-detection (validation
 * rule 4). The spec allows any stable ID.
 *
 * Exposed as module.exports (Node) and window.LoyalTransform (browser).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LoyalTransform = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "2.0.0";

  // ---------------------------------------------------------------- helpers

  function pad3(n) { return String(n).padStart(3, "0"); }

  var ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
  function decodeEntities(s) {
    return String(s == null ? "" : s).replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, function (m) { return ENTITIES[m]; });
  }
  function stripTags(s) { return String(s == null ? "" : s).replace(/<[^>]+>/g, ""); }
  function textOf(s) { return decodeEntities(stripTags(s)).replace(/\s+/g, " ").trim(); }
  function pick(o, names) {
    for (var i = 0; i < names.length; i++) if (o != null && o[names[i]] !== undefined) return o[names[i]];
    return undefined;
  }
  function isBlank(v) { return v === undefined || v === null || (typeof v === "string" && v.trim() === ""); }

  // Grapheme-aware split so multi-codepoint emoji ("❤️", flags) stay intact.
  var SEGMENTER = (typeof Intl !== "undefined" && Intl.Segmenter)
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  function graphemes(s) {
    var str = String(s == null ? "" : s);
    if (SEGMENTER) {
      var out = [];
      var it = SEGMENTER.segment(str)[Symbol.iterator]();
      for (var r = it.next(); !r.done; r = it.next()) out.push(r.value.segment);
      return out;
    }
    return Array.from(str);
  }

  // "⭐⭐⭐" -> { emoji: "⭐", count: 3 }; mixed/!emoji -> null
  function repeatedEmoji(s) {
    var g = graphemes(String(s == null ? "" : s).trim());
    if (!g.length) return null;
    var first = g[0];
    for (var i = 1; i < g.length; i++) if (g[i] !== first) return null;
    if (/^[\w\s.,!?'"()\-+=/\\:;]$/.test(first)) return null; // plain ASCII, not emoji
    return { emoji: first, count: g.length };
  }

  // Size token from a rem value. Normative table from the spec:
  //   < 1.6 sm | 1.6–2.2 md | 2.2–3.0 lg | > 3.0 xl
  // (The prose example mapping 3.6rem -> "lg" is treated as illustrative; the
  //  table is the rule. Source uses 1.4 / 2.4 / 3.6 -> sm / lg / xl.)
  function sizeToken(rem) {
    var v = parseFloat(rem);
    if (!isFinite(v)) return null;
    if (v < 1.6) return "sm";
    if (v <= 2.2) return "md";
    if (v <= 3.0) return "lg";
    return "xl";
  }

  var SIZED_SPAN = /^\s*<span[^>]*font-size:\s*([\d.]+)rem[^>]*>([\s\S]*?)<\/span>\s*$/i;

  // ------------------------------------------------------- choice structuring

  /*
   * Turn one raw tap-select choice into a structured token.
   * Handles the three shapes present in the corpus:
   *   "<span style='font-size:3.6rem'>🍓</span>" -> { emoji, size }
   *   "⭐⭐"                                      -> { emoji, count }
   *   "3" / "triangle"                            -> { text }
   */
  function tapChoiceToken(rawChoice, warn) {
    var s = String(rawChoice == null ? "" : rawChoice);
    var m = SIZED_SPAN.exec(s);
    if (m) {
      var size = sizeToken(m[1]);
      var inner = textOf(m[2]);
      if (!size) { warn("unmappable font-size '" + m[1] + "rem' in choice " + JSON.stringify(s)); size = "md"; }
      var rep = repeatedEmoji(inner);
      var tok = { emoji: rep ? rep.emoji : inner, size: size };
      if (rep && rep.count > 1) tok.count = rep.count;
      return tok;
    }
    var plain = textOf(s);
    var r = repeatedEmoji(plain);
    if (r) return { emoji: r.emoji, count: r.count };
    return { text: plain };
  }

  // ------------------------------------------------------------ media mapping

  function mediaFor(rawImage, ctx, report) {
    if (isBlank(rawImage)) return null;
    var src = String(rawImage).trim();
    var file = src.replace(/\\/g, "/").split("/").pop();
    var webp = file.replace(/\.[a-z0-9]+$/i, ".webp");
    report.imagesTotal++;
    report.imagesMissingAlt++; // no source file in this corpus carries alt text
    return {
      kind: "image",
      // storage path, never a full URL — the app builds the URL at render time
      path: "questions/" + ctx.level + "/" + ctx.subject + "/" + ctx.slug + "/" + webp,
      alt: "", // never invent alt text; reported for manual authoring
      source_path: src, // where the original lives, for the image migration step
    };
  }

  // --------------------------------------------------------- question mappers
  // Each returns { slug, type, prompt, options, answer_key, explanation, media,
  // order_index } — note: no `difficulty` (dropped by design).

  function baseQ(index) {
    return {
      slug: "q" + pad3(index + 1),
      type: "",
      prompt: "",
      options: null,
      answer_key: null,
      explanation: null,
      media: null,
      order_index: index + 1,
    };
  }

  function explOf(q) {
    var e = pick(q, ["explanation", "explain", "reason"]);
    return isBlank(e) ? null : String(e);
  }

  function mapMCQ(raw, i, ctx, report, fail) {
    var out = baseQ(i);
    out.type = "mcq";
    out.prompt = String(pick(raw, ["question", "prompt"]) || "");
    var rawChoices = pick(raw, ["options", "choices"]) || [];
    var correct = pick(raw, ["correct", "answer", "correct_answer"]);

    var choices = (Array.isArray(rawChoices) ? rawChoices : []).map(function (c, k) {
      return { id: "c" + (k + 1), text: String(c) };
    });
    out.options = { choices: choices };

    var idx = (Array.isArray(rawChoices) ? rawChoices : []).findIndex(function (c) {
      return String(c) === String(correct);
    });
    out.answer_key = { correct: idx >= 0 ? [choices[idx].id] : [] };
    if (idx < 0) fail(i, "correct answer " + JSON.stringify(correct) + " is not among the choices");
    out.explanation = explOf(raw);
    out.media = mediaFor(raw.image, ctx, report);
    return out;
  }

  function mapAudio(raw, i, ctx, report, fail) {
    var out = baseQ(i);
    out.type = "audio";
    out.prompt = String(pick(raw, ["question", "prompt"]) || "Listen and choose the correct word.");
    var rawChoices = pick(raw, ["options", "choices"]) || [];
    var correct = pick(raw, ["correct", "answer", "correct_answer"]);
    var voice = pick(raw, ["voice", "word", "tts_word"]);
    var lang = pick(raw, ["lang", "tts_lang"]) || "en-US";

    var choices = (Array.isArray(rawChoices) ? rawChoices : []).map(function (c, k) {
      return { id: "c" + (k + 1), text: String(c) };
    });
    // NOTE: browser TTS requires sending the spoken word to the client, and the
    // spoken word IS the answer — so audio questions are inherently
    // unprotectable while we use Web Speech. Accepted for launch. The format
    // already allows swapping `tts` for an opaque `audio_url` later with no
    // migration (see LOYAL_QUIZ_Question_Format.md §2).
    out.options = {
      choices: choices,
      tts: { text: voice == null ? null : String(voice), lang: String(lang) },
    };
    var idx = (Array.isArray(rawChoices) ? rawChoices : []).findIndex(function (c) {
      return String(c) === String(correct);
    });
    out.answer_key = { correct: idx >= 0 ? [choices[idx].id] : [] };
    if (idx < 0) fail(i, "correct answer " + JSON.stringify(correct) + " is not among the choices");
    out.explanation = explOf(raw);
    out.media = mediaFor(raw.image, ctx, report);
    return out;
  }

  function mapTwoBox(raw, i, ctx, report, fail) {
    var out = baseQ(i);
    out.type = "drag_drop";
    out.prompt = String(pick(raw, ["question", "prompt"]) || "");
    var rawItems = pick(raw, ["options", "choices"]) || [];
    var key = pick(raw, ["key"]) || {};

    var items = (Array.isArray(rawItems) ? rawItems : []).map(function (label, k) {
      return { id: "i" + (k + 1), label: String(label) };
    });
    var boxes = [
      { id: "b1", label: (ctx.boxLabels && ctx.boxLabels.left) || "Box A" },
      { id: "b2", label: (ctx.boxLabels && ctx.boxLabels.right) || "Box B" },
    ];
    var placements = {};
    (Array.isArray(rawItems) ? rawItems : []).forEach(function (label, k) {
      var side = String(key[label] == null ? "" : key[label]).toLowerCase();
      if (side === "left") placements[items[k].id] = "b1";
      else if (side === "right") placements[items[k].id] = "b2";
      else fail(i, "item " + JSON.stringify(label) + " has no left/right placement");
    });

    out.options = { mode: "two_box_sort", items: items, boxes: boxes };
    out.answer_key = { placements: placements };
    out.explanation = explOf(raw);
    out.media = mediaFor(raw.image, ctx, report);
    return out;
  }

  function mapWordOrder(raw, i, ctx, report, fail) {
    var out = baseQ(i);
    out.type = "drag_drop";
    out.prompt = String(pick(raw, ["question", "prompt"]) || "");
    var rawWords = pick(raw, ["options", "choices"]) || [];
    var key = pick(raw, ["key"]) || {};

    // IDs follow PRESENTATION order (the scrambled array), never the correct
    // order — otherwise w1..wN would themselves spell out the answer.
    var words = (Array.isArray(rawWords) ? rawWords : []).map(function (w, k) {
      return { id: "w" + (k + 1), text: String(w) };
    });
    var idByText = {};
    words.forEach(function (w) { if (!(w.text in idByText)) idByText[w.text] = w.id; });

    var POS = { first: 0, second: 1, third: 2, forth: 3, fourth: 3, fifth: 4, sixth: 5, seventh: 6, eighth: 7 };
    var slots = [];
    Object.keys(key).forEach(function (word) {
      var p = String(key[word]).toLowerCase().trim();
      var at = p in POS ? POS[p] : (parseInt(p, 10) - 1);
      var id = idByText[word];
      if (!id) { fail(i, "answer word " + JSON.stringify(word) + " is not among the presented words"); return; }
      if (!(at >= 0)) { fail(i, "unknown position " + JSON.stringify(key[word]) + " for " + JSON.stringify(word)); return; }
      slots[at] = id;
    });
    var order = slots.filter(function (x) { return x !== undefined; });

    out.options = { mode: "word_order", words: words };
    out.answer_key = { order: order };
    out.explanation = explOf(raw);
    out.media = mediaFor(raw.image, ctx, report);
    return out;
  }

  function mapTapSelect(raw, i, ctx, report, fail) {
    var out = baseQ(i);
    out.type = "tap_select";
    var rawItems = Array.isArray(raw.items) ? raw.items : [];
    var isCount = typeof raw.count === "number" ||
      (rawItems.length > 0 && rawItems.every(function (it) { return typeof it === "string"; }));
    var warn = function (msg) { report.sizeWarnings.push(ctx.slug + " q" + pad3(i + 1) + ": " + msg); };

    // The scene emoji ("🚗🚗🚗") is render data and lives in options.
    var promptRaw = String(pick(raw, ["question", "prompt"]) || "");
    var scene = null;
    var sceneMatch = /<span[^>]*class=["'][^"']*tap-scene[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(promptRaw);
    if (sceneMatch) {
      var rep = repeatedEmoji(textOf(sceneMatch[1]));
      scene = rep ? { emoji: rep.emoji, count: rep.count } : { text: textOf(sceneMatch[1]) };
      promptRaw = promptRaw.replace(sceneMatch[0], " ");
    }
    out.prompt = textOf(promptRaw);

    if (isCount) {
      var rep2 = repeatedEmoji(rawItems.join(""));
      out.options = {
        mode: "count",
        emoji: rep2 ? rep2.emoji : (rawItems[0] != null ? String(rawItems[0]) : null),
        item_count: rawItems.length,
      };
      out.answer_key = { target_count: typeof raw.count === "number" ? raw.count : null };
      if (typeof raw.count !== "number") fail(i, "count mode without a numeric count");
      if (!rawItems.length) fail(i, "count mode with no items");
    } else {
      var choices = rawItems.map(function (it, k) {
        var label = it && typeof it === "object" ? it.label : it;
        var tok = tapChoiceToken(label, warn);
        tok.id = "c" + (k + 1);
        // put id first for readability
        var ordered = { id: tok.id };
        if (tok.emoji !== undefined) ordered.emoji = tok.emoji;
        if (tok.text !== undefined) ordered.text = tok.text;
        if (tok.size !== undefined) ordered.size = tok.size;
        if (tok.count !== undefined) ordered.count = tok.count;
        return ordered;
      });
      var correctIds = [];
      rawItems.forEach(function (it, k) {
        if (it && typeof it === "object" && it.correct) correctIds.push("c" + (k + 1));
      });
      out.options = { mode: "match", choices: choices };
      if (scene) out.options.scene = scene;
      out.answer_key = { correct: correctIds };
      if (!choices.length) fail(i, "match mode with no choices");
      if (!correctIds.length) fail(i, "match mode with no correct choice flagged");
    }
    out.explanation = explOf(raw);
    out.media = mediaFor(raw.image, ctx, report);
    return out;
  }

  // ------------------------------------------------- reading-comprehension

  // Prompts in these sets look like:
  //   <div ...>PASSAGE</div><br><span ...>3. Question text</span>
  // Several distinct passages usually share one file, so questions are grouped
  // under a passage_id (spec §Reading comprehension, Option B) rather than a
  // single exercise-level passage.
  var RC_SPLIT = /^\s*(<div[^>]*>[\s\S]*?<\/div>)\s*(?:<br\s*\/?>\s*)*([\s\S]*)$/i;
  var RC_MIN_PASSAGE_CHARS = 60;

  function analyzeReadingComprehension(prompts) {
    if (prompts.length < 3) return null;
    var parts = [];
    var matched = 0;
    for (var i = 0; i < prompts.length; i++) {
      var m = RC_SPLIT.exec(prompts[i]);
      if (!m) { parts.push(null); continue; }
      // keep <br> as line breaks so the passage reads as authored
      var passage = decodeEntities(
        stripTags(String(m[1]).replace(/<br\s*\/?>/gi, "\n"))
      ).split("\n").map(function (l) { return l.replace(/\s+/g, " ").trim(); })
        .filter(Boolean).join("\n");
      var question = textOf(m[2]);
      if (passage.length < RC_MIN_PASSAGE_CHARS) { parts.push(null); continue; }
      matched++;
      parts.push({ passage: passage, question: question });
    }
    // require a strong majority so we never mangle a normal exercise
    if (matched < prompts.length * 0.8) return null;
    return parts;
  }

  // Group near-identical passages; the LONGEST variant becomes canonical.
  function groupPassages(parts, report, slug) {
    var groups = []; // { canonical, variants:{}, id }
    function words(p) {
      return String(p).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    }
    // Word-set (Jaccard) similarity — drift is usually an inserted or reworded
    // phrase somewhere in the middle, which a prefix comparison would miss.
    function similar(a, b) {
      if (a === b) return true;
      var A = words(a), B = words(b);
      if (!A.length || !B.length) return false;
      var setB = Object.create(null);
      B.forEach(function (w) { setB[w] = true; });
      var setA = Object.create(null);
      A.forEach(function (w) { setA[w] = true; });
      var inter = 0;
      Object.keys(setA).forEach(function (w) { if (setB[w]) inter++; });
      var union = Object.keys(setA).length + Object.keys(setB).length - inter;
      return union > 0 && inter / union >= 0.8;
    }
    parts.forEach(function (p) {
      if (!p) return;
      for (var i = 0; i < groups.length; i++) {
        if (similar(groups[i].canonical, p.passage)) {
          if (p.passage.length > groups[i].canonical.length) groups[i].canonical = p.passage;
          groups[i].variants[p.passage] = (groups[i].variants[p.passage] || 0) + 1;
          p._group = i;
          return;
        }
      }
      var g = { canonical: p.passage, variants: {} };
      g.variants[p.passage] = 1;
      groups.push(g);
      p._group = groups.length - 1;
    });
    groups.forEach(function (g, i) {
      g.id = "p" + (i + 1);
      var vs = Object.keys(g.variants);
      if (vs.length > 1) {
        report.passageDrift.push({
          slug: slug, passage_id: g.id, variants: vs.length,
          canonical_chars: g.canonical.length,
        });
      }
    });
    return groups;
  }

  function stripLeadingNumber(s) { return String(s).replace(/^\s*\d+\s*[.)]\s*/, ""); }

  // ------------------------------------------------------ position-bias check

  function positionBias(questions) {
    var counts = {}, total = 0, n = 0;
    questions.forEach(function (q) {
      var ch = q.options && q.options.choices;
      if (!Array.isArray(ch) || !ch.length) return;
      var correct = q.answer_key && q.answer_key.correct;
      if (!Array.isArray(correct) || correct.length !== 1) return;
      var idx = ch.findIndex(function (c) { return c.id === correct[0]; });
      if (idx < 0) return;
      counts[idx] = (counts[idx] || 0) + 1;
      total++;
      n = Math.max(n, ch.length);
    });
    if (!total) return null;
    var topPos = null, topCount = 0;
    Object.keys(counts).forEach(function (k) { if (counts[k] > topCount) { topCount = counts[k]; topPos = +k; } });
    return {
      total: total, positions: counts, top_position: topPos,
      top_share: topCount / total, biased: topCount / total > 0.5,
    };
  }

  // ------------------------------------------------------------- title review

  function titleNeedsReview(title, slug) {
    var t = String(title || "");
    if (!t) return true;
    if (/\b(leve1|level\s*\d|lvl\s*\d|kg\s*-?\s*\d)\b/i.test(t)) return true; // carries a level prefix
    // Trailing bare digit glued to a word ("Eng Sight Words1", "Part2") — the
    // machine-generated signature. A spaced trailing number is NOT flagged:
    // "Number Bonds to 10" / "Add Upto 20" are legitimate authored titles and
    // flagging them buries the real cases (71 of 86 were false positives).
    if (/[A-Za-z]\d+$/.test(t.trim())) return true;
    if (/\b[a-z]+[A-Z]/.test(t)) return true; // odd capitalisation
    // machine-derived title-casing of the slug (every word capitalised, matches slug)
    var fromSlug = String(slug || "").split("-").filter(Boolean)
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
    if (t === fromSlug) return true;
    return false;
  }

  // --------------------------------------------------------------- validation

  function collectDisplayStrings(options) {
    var out = [];
    (function walk(v) {
      if (v == null) return;
      if (Array.isArray(v)) return v.forEach(walk);
      if (typeof v === "object") {
        Object.keys(v).forEach(function (k) {
          if (k === "id") return; // ids are not displayed content
          walk(v[k]);
        });
        return;
      }
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    })(options);
    return out;
  }

  function validateQuestion(q, errors) {
    var where = q.slug + ": ";
    var opts = q.options || {};
    var ak = q.answer_key || {};

    // 10. prompt present
    if (isBlank(q.prompt)) errors.push(where + "empty prompt");

    // gather ids present in options
    var ids = [];
    (function walk(v) {
      if (v == null) return;
      if (Array.isArray(v)) return v.forEach(walk);
      if (typeof v === "object") {
        if (typeof v.id === "string") ids.push(v.id);
        Object.keys(v).forEach(function (k) { walk(v[k]); });
      }
    })(opts);

    // 3. ids unique within the question
    var seen = {};
    ids.forEach(function (id) {
      if (seen[id]) errors.push(where + "duplicate id '" + id + "'");
      seen[id] = true;
    });

    // 2. no option field named/containing "correct" or "answer"
    (function walkKeys(v) {
      if (v == null || typeof v !== "object") return;
      if (Array.isArray(v)) return v.forEach(walkKeys);
      Object.keys(v).forEach(function (k) {
        if (/correct|answer/i.test(k)) errors.push(where + "options contains answer-ish field '" + k + "'");
        walkKeys(v[k]);
      });
    })(opts);

    // 11. no style= attribute anywhere in options
    collectDisplayStrings(opts).forEach(function (s) {
      if (/style\s*=/i.test(s)) errors.push(where + "options value contains a style= attribute");
    });

    // referenced ids + rule 4 (answer_key must not contain displayed content)
    var display = {};
    collectDisplayStrings(opts).forEach(function (s) { display[s] = true; });
    var refs = [];
    if (Array.isArray(ak.correct)) refs = refs.concat(ak.correct);
    if (Array.isArray(ak.order)) refs = refs.concat(ak.order);
    if (ak.placements && typeof ak.placements === "object") {
      Object.keys(ak.placements).forEach(function (k) { refs.push(k); refs.push(ak.placements[k]); });
    }
    refs.forEach(function (id) {
      if (typeof id !== "string") return;
      // 1. every referenced id exists in options
      if (ids.indexOf(id) === -1) errors.push(where + "answer_key references unknown id '" + id + "'");
      // 4. no displayed content in the answer key
      if (display[id]) errors.push(where + "answer_key value '" + id + "' also appears as displayed content");
    });

    // type-specific
    if (q.type === "mcq" || q.type === "audio") {
      var n = (opts.choices || []).length;
      // 5. choice counts 2–4
      if (n < 2 || n > 4) errors.push(where + "has " + n + " choices (expected 2–4)");
      if (!Array.isArray(ak.correct) || ak.correct.length === 0) errors.push(where + "no correct answer in answer_key");
    }
    if (opts.mode === "word_order") {
      // 6. order is a permutation of the word ids
      var wids = (opts.words || []).map(function (w) { return w.id; }).sort().join(",");
      var oids = (ak.order || []).slice().sort().join(",");
      if (wids !== oids) errors.push(where + "answer_key.order is not a permutation of the word ids");
    }
    if (opts.mode === "two_box_sort") {
      // 7. placements cover every item exactly once
      var iids = (opts.items || []).map(function (i) { return i.id; }).sort().join(",");
      var pids = Object.keys(ak.placements || {}).sort().join(",");
      if (iids !== pids) errors.push(where + "placements do not cover every item exactly once");
      var bids = (opts.boxes || []).map(function (b) { return b.id; });
      Object.keys(ak.placements || {}).forEach(function (k) {
        if (bids.indexOf(ak.placements[k]) === -1) errors.push(where + "placement for '" + k + "' targets unknown box");
      });
    }
    if (opts.mode === "count") {
      if (typeof ak.target_count !== "number") errors.push(where + "count mode without numeric target_count");
    }
  }

  function validateExercise(ex, errors) {
    // 8. total_questions matches the array length
    if (ex.total_questions !== ex.questions.length) {
      errors.push("exercise: total_questions (" + ex.total_questions + ") != questions.length (" + ex.questions.length + ")");
    }
    // 9. questions_per_attempt <= total_questions
    if (ex.questions_per_attempt > ex.total_questions) {
      errors.push("exercise: questions_per_attempt (" + ex.questions_per_attempt + ") > total_questions (" + ex.total_questions + ")");
    }
    ex.questions.forEach(function (q) { validateQuestion(q, errors); });
  }

  // ------------------------------------------------------------------ entry

  /**
   * Build the v2 exercise object from RAW parsed questions.
   *
   * @param {object} input
   *   raw          {array}  raw question objects (from the source HTML)
   *   detection    {object} core detection { type, mode, boxLabels }
   *   slug, title  {string}
   *   level, subject {string}
   *   sourceFile   {string} original .html filename
   *   extractedAt  {string} ISO timestamp (deterministic: source mtime)
   *   perAttempt   {number} default 25
   * @returns {object} { data, report }
   */
  function toV2(input) {
    var raw = input.raw || [];
    var detection = input.detection || {};
    var report = {
      slug: input.slug,
      questionErrors: [],
      validationErrors: [],
      sizeWarnings: [],
      passageDrift: [],
      imagesTotal: 0,
      imagesMissingAlt: 0,
      readingComprehension: null,
      bias: null,
      titleNeedsReview: false,
      typeCounts: {},
    };
    var ctx = {
      slug: input.slug,
      level: input.level,
      subject: input.subject,
      boxLabels: detection.boxLabels,
    };
    function fail(i, msg) { report.questionErrors.push("q" + pad3(i + 1) + ": " + msg); }

    var mapper;
    switch (detection.type) {
      case "audio": mapper = mapAudio; break;
      case "tap_select": mapper = mapTapSelect; break;
      case "drag_drop": mapper = detection.mode === "word_order" ? mapWordOrder : mapTwoBox; break;
      default: mapper = mapMCQ;
    }

    var questions = raw.map(function (q, i) {
      var mapped = mapper(q && typeof q === "object" ? q : {}, i, ctx, report, fail);
      report.typeCounts[mapped.type] = (report.typeCounts[mapped.type] || 0) + 1;
      return mapped;
    });

    // ---- reading comprehension (MCQ-shaped sets only) ----
    var passages = null;
    var shuffle = true;
    if (detection.type === "mcq") {
      var parts = analyzeReadingComprehension(raw.map(function (q) {
        return String(pick(q || {}, ["question", "prompt"]) || "");
      }));
      if (parts) {
        var groups = groupPassages(parts, report, input.slug);
        if (groups.length) {
          passages = groups.map(function (g) { return { id: g.id, text: g.canonical }; });
          questions.forEach(function (q, i) {
            var p = parts[i];
            if (!p) { q._needs_review = "passage could not be separated from the prompt"; return; }
            q.prompt = stripLeadingNumber(p.question);
            q.passage_id = groups[p._group].id;
          });
          shuffle = false;
          report.readingComprehension = { passages: groups.length, questions: questions.length };
        }
      }
    }

    var total = questions.length;
    var perAttempt = input.perAttempt || 25;
    // order matters for reading comprehension: serve the whole set, in order
    var qpa = shuffle ? Math.min(perAttempt, total) : total;

    var needsReview = titleNeedsReview(input.title, input.slug);
    report.titleNeedsReview = needsReview;

    var data = {
      _source_file: input.sourceFile,
      _extracted_at: input.extractedAt,
      slug: input.slug,
      title: input.title,
      level: input.level,
      subject: input.subject,
      quiz_type: detection.type,
      questions_per_attempt: qpa,
      total_questions: total,
      shuffle: shuffle,
      is_free: false,
      order_index: 0,
      questions: questions,
    };
    if (needsReview) data.title_needs_review = true;
    if (passages) data.passages = passages;

    // ---- analysis + validation ----
    report.bias = positionBias(questions);
    validateExercise(data, report.validationErrors);
    report.validationErrors = report.questionErrors
      .map(function (e) { return e; })
      .concat(report.validationErrors);

    return { data: data, report: report };
  }

  return {
    VERSION: VERSION,
    toV2: toV2,
    // exposed for tests
    sizeToken: sizeToken,
    repeatedEmoji: repeatedEmoji,
    tapChoiceToken: tapChoiceToken,
    titleNeedsReview: titleNeedsReview,
    positionBias: positionBias,
    validateExercise: validateExercise,
    analyzeReadingComprehension: analyzeReadingComprehension,
  };
});
