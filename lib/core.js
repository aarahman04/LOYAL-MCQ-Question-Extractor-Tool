/*
 * LOYAL MCQ – Question Extractor core
 * -----------------------------------
 * Environment-agnostic logic shared by the Node CLI (extract.js) and the
 * browser UI (extractor-ui/index.html). This module never touches the file
 * system or the DOM directly; the only environment-specific bit — running the
 * inline `questions` array to get a real JS value — is injected as
 * `opts.evalArray(code)` by each caller (Node uses `vm`, the browser uses a
 * sandboxed `Function`).
 *
 * Exposed as `module.exports` under Node and as `window.LoyalExtractorCore`
 * in the browser (UMD).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LoyalExtractorCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var VERSION = "1.0.0";

  // Quiz type constants (also used as `type` values in the output JSON).
  var TYPES = {
    MCQ: "mcq",
    AUDIO: "audio",
    DRAG_DROP: "drag_drop",
    TAP_SELECT: "tap_select",
  };

  // ----- small helpers ------------------------------------------------------

  function pad3(n) {
    return String(n).padStart(3, "0");
  }

  var ENTITIES = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };

  function decodeEntities(s) {
    if (s == null) return s;
    return String(s).replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, function (m) {
      return ENTITIES[m];
    });
  }

  function stripHtml(s) {
    if (s == null) return s;
    return decodeEntities(String(s).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  }

  // Pull the first present field from a list of possible names.
  function pick(obj, names) {
    for (var i = 0; i < names.length; i++) {
      if (obj != null && obj[names[i]] !== undefined) return obj[names[i]];
    }
    return undefined;
  }

  function isBlank(v) {
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  }

  // ----- slug / title -------------------------------------------------------

  function baseName(filename) {
    var f = String(filename).replace(/\\/g, "/");
    f = f.substring(f.lastIndexOf("/") + 1);
    return f;
  }

  function stripExt(name) {
    return name.replace(/\.[a-z0-9]+$/i, "");
  }

  // level_1_addition_upto_30.html -> addition-upto-30
  // Strips a leading level/kg token (level info comes from folder structure),
  // then slugifies the remainder.
  function slugFromFilename(filename) {
    var name = stripExt(baseName(filename)).toLowerCase();
    // remove a single leading "level<n>" / "level-<n>" / "kg<n>" prefix
    name = name.replace(/^(level|lvl|kg|grade)[-_\s]?\d+[-_\s]*/, "");
    var slug = name
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return slug || "exercise";
  }

  var GENERIC_TITLES = [
    "",
    "loyal m.c.q's",
    "loyal mcq's",
    "loyal mcq",
    "loyal m.c.q",
    "document",
    "quiz",
    "untitled",
    "loading...",
  ];

  function htmlTitle(html) {
    var m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (!m) return null;
    var t = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
    if (GENERIC_TITLES.indexOf(t.toLowerCase()) !== -1) return null;
    return t || null;
  }

  function titleCase(slug) {
    return slug
      .split("-")
      .filter(Boolean)
      .map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join(" ");
  }

  // Prefer the HTML <title> when it is meaningful; fall back to the slug.
  function titleFor(html, slug) {
    return htmlTitle(html) || titleCase(slug);
  }

  // ----- inline <script> extraction ----------------------------------------

  // Returns the text of every inline <script> (those without a src=).
  function extractInlineScripts(html) {
    var scripts = [];
    var re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var attrs = m[1] || "";
      if (/\bsrc\s*=/.test(attrs)) continue; // external script, skip
      scripts.push(m[2]);
    }
    return scripts;
  }

  // Balanced extraction of the array literal after `questions = [ ... ]`,
  // string-literal aware so brackets inside strings don't confuse the scan.
  function extractQuestionsArrayLiteral(code) {
    var m = /questions\s*=\s*\[/.exec(code);
    if (!m) return null;
    var start = m.index + m[0].length - 1; // index of the opening '['
    var i = start;
    var depth = 0;
    var quote = null;
    for (; i < code.length; i++) {
      var ch = code[i];
      if (quote) {
        if (ch === "\\") {
          i++;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) return code.slice(start, i + 1);
      }
    }
    return null;
  }

  // Choose the inline script that declares/assigns `questions`.
  function pickQuestionScript(scripts) {
    var declRe = /(?:const|let|var)\s+questions\s*=/;
    var anyRe = /\bquestions\s*=/;
    var declared = scripts.filter(function (s) {
      return declRe.test(s);
    });
    if (declared.length) return declared.join("\n;\n");
    var any = scripts.filter(function (s) {
      return anyRe.test(s);
    });
    if (any.length) return any.join("\n;\n");
    return null;
  }

  // Build the ordered list of code candidates to try (first non-empty wins).
  function questionCodeCandidates(html) {
    var scripts = extractInlineScripts(html);
    var candidates = [];
    var primary = pickQuestionScript(scripts);
    if (primary) candidates.push(primary);
    if (scripts.length) candidates.push(scripts.join("\n;\n"));
    // literal-array fallback (works when the array is a plain literal)
    var joined = scripts.join("\n;\n") || html;
    var literal = extractQuestionsArrayLiteral(joined) || extractQuestionsArrayLiteral(html);
    if (literal) candidates.push("var questions = " + literal + ";");
    return candidates;
  }

  // ----- quiz-type detection ------------------------------------------------

  function parseDropboxes(html) {
    var boxes = [];
    var re = /<div\b[^>]*class=["'][^"']*\bdropbox\b[^"']*["'][^>]*>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      var tag = m[0];
      var box = /data-box=["']([^"']*)["']/i.exec(tag);
      var ph = /data-placeholder=["']([^"']*)["']/i.exec(tag);
      boxes.push({
        box: box ? box[1].trim().toLowerCase() : "",
        placeholder: ph ? decodeEntities(ph[1]).trim() : "",
      });
    }
    return boxes;
  }

  var WORD_ORDER_BOXES = ["first", "second", "third", "forth", "fourth", "fifth", "sixth"];

  function classifyDragMode(boxes) {
    var names = boxes.map(function (b) {
      return b.box;
    });
    if (names.some(function (n) { return WORD_ORDER_BOXES.indexOf(n) !== -1; })) return "word_order";
    if (names.indexOf("left") !== -1 || names.indexOf("right") !== -1) return "two_box_sort";
    if (boxes.length >= 4) return "word_order";
    if (boxes.length === 2) return "two_box_sort";
    return null;
  }

  function boxLabelsFrom(boxes) {
    var labels = { left: "", right: "" };
    boxes.forEach(function (b) {
      if (b.box === "left") labels.left = b.placeholder;
      if (b.box === "right") labels.right = b.placeholder;
    });
    return labels;
  }

  function detectFromHtml(html) {
    var boxes = parseDropboxes(html);
    var loadsAudio = /audio\.js|audio_style\.css/i.test(html);
    var loadsTap = /tap_select\.(?:js|css)/i.test(html) || /initTapSelectQuiz\s*\(/.test(html);
    var loadsDnd =
      /drag_and_drop\.js|dnd\.css/i.test(html) ||
      /initTwoBoxSortQuiz\s*\(|initDragDropQuiz\s*\(/.test(html) ||
      boxes.length > 0;

    var type = TYPES.MCQ;
    var mode = null;
    if (loadsAudio) {
      type = TYPES.AUDIO;
    } else if (loadsTap) {
      type = TYPES.TAP_SELECT;
    } else if (loadsDnd) {
      type = TYPES.DRAG_DROP;
      mode = classifyDragMode(boxes);
    }
    return { type: type, mode: mode, dropboxes: boxes, boxLabels: boxLabelsFrom(boxes) };
  }

  // Refine detection using the actual data shape. This makes the tool robust
  // when a file's CSS/JS includes are missing or misleading (e.g. a stray
  // `initMCQQuiz(questions)` in a drag-and-drop file).
  function refineWithData(detection, questions) {
    var q = (questions || []).find(function (x) {
      return x && typeof x === "object";
    });
    if (!q) return detection;

    var hasVoice = pick(q, ["voice"]) !== undefined;
    var hasKey = pick(q, ["key"]) !== undefined && typeof q.key === "object";
    var hasItems = Array.isArray(q.items);
    var hasCount = typeof q.count === "number";

    // Data shape is authoritative for ambiguous / default MCQ detections.
    if (hasVoice) detection.type = TYPES.AUDIO;
    else if (hasKey) {
      detection.type = TYPES.DRAG_DROP;
      if (!detection.mode) detection.mode = dragModeFromKey(q.key);
    } else if ((hasItems || hasCount) && detection.type !== TYPES.DRAG_DROP) {
      detection.type = TYPES.TAP_SELECT;
    }

    if (detection.type === TYPES.DRAG_DROP && !detection.mode) {
      detection.mode = dragModeFromKey(q.key) || "two_box_sort";
    }
    return detection;
  }

  function dragModeFromKey(key) {
    if (!key || typeof key !== "object") return null;
    var vals = Object.keys(key).map(function (k) {
      return String(key[k]).toLowerCase();
    });
    if (vals.some(function (v) { return WORD_ORDER_BOXES.indexOf(v) !== -1; })) return "word_order";
    if (vals.indexOf("left") !== -1 || vals.indexOf("right") !== -1) return "two_box_sort";
    return null;
  }

  // ----- tap-select prompt / scene handling ---------------------------------

  var SCENE_RE = /<span[^>]*class=["'][^"']*tap-scene[^"']*["'][^>]*>([\s\S]*?)<\/span>/i;

  function splitScene(raw) {
    var scene = null;
    var s = String(raw == null ? "" : raw);
    var m = SCENE_RE.exec(s);
    if (m) {
      scene = m[1].replace(/<[^>]+>/g, "").trim() || null;
      s = s.replace(SCENE_RE, " ");
    }
    var prompt = stripHtml(s);
    return { prompt: prompt, scene: scene };
  }

  // ----- position words (word order) ----------------------------------------

  var POSITION_INDEX = {
    first: 0, second: 1, third: 2, forth: 3, fourth: 3,
    fifth: 4, sixth: 5, seventh: 6, eighth: 7,
    "1st": 0, "2nd": 1, "3rd": 2, "4th": 3, "5th": 4, "6th": 5,
  };

  function positionIndex(pos) {
    var p = String(pos).toLowerCase().trim();
    if (p in POSITION_INDEX) return POSITION_INDEX[p];
    var n = parseInt(p, 10);
    return isNaN(n) ? -1 : n - 1;
  }

  // ----- per-question mappers -----------------------------------------------
  // Each returns a fully-formed question object; warnings are pushed onto
  // the shared `warnings` array and, when a question is malformed, a
  // `_warning` field is attached to it.

  function baseQuestion(index) {
    return {
      slug: "q" + pad3(index + 1),
      prompt: "",
      type: "",
      options: null,
      correct_answer: null,
      explanation: null,
      media: null,
      difficulty: 1,
      order_index: index + 1,
    };
  }

  function expl(q) {
    var e = pick(q, ["explanation", "explain", "reason"]);
    return isBlank(e) ? null : e;
  }

  function mapMCQ(q, index, ctx, warnings) {
    var out = baseQuestion(index);
    out.type = TYPES.MCQ;
    var prompt = pick(q, ["question", "prompt"]);
    var options = pick(q, ["options", "choices"]);
    var correct = pick(q, ["correct", "answer", "correct_answer"]);

    out.prompt = ctx.stripHtml ? stripHtml(prompt) : (prompt == null ? "" : String(prompt));
    out.options = { choices: Array.isArray(options) ? options.slice() : [] };
    out.correct_answer = correct == null ? null : correct;
    out.explanation = expl(q);

    var probs = [];
    if (isBlank(prompt)) probs.push("missing prompt");
    if (!Array.isArray(options) || options.length < 2) probs.push("needs >=2 options");
    if (isBlank(correct)) probs.push("missing correct answer");
    else if (Array.isArray(options) && options.indexOf(correct) === -1)
      probs.push("correct answer not among options");
    attachWarn(out, index, probs, warnings);
    return out;
  }

  function mapAudio(q, index, ctx, warnings) {
    var out = baseQuestion(index);
    out.type = TYPES.AUDIO;
    var prompt = pick(q, ["question", "prompt"]);
    var options = pick(q, ["options", "choices"]);
    var correct = pick(q, ["correct", "answer", "correct_answer"]);
    var voice = pick(q, ["voice", "word", "tts_word"]);
    var lang = pick(q, ["lang", "tts_lang"]);

    out.prompt = prompt == null ? "Listen and choose the correct word." : String(prompt);
    out.options = { choices: Array.isArray(options) ? options.slice() : [] };
    out.correct_answer = correct == null ? null : correct;
    out.explanation = expl(q);
    out.media = {
      audio: null,
      use_tts: true,
      tts_word: voice == null ? null : voice,
      tts_lang: lang == null ? "en-US" : lang,
    };

    var probs = [];
    if (!Array.isArray(options) || options.length < 2) probs.push("needs >=2 options");
    if (isBlank(correct)) probs.push("missing correct answer");
    if (isBlank(voice)) probs.push("missing voice/tts word");
    attachWarn(out, index, probs, warnings);
    return out;
  }

  function mapTwoBoxSort(q, index, ctx, warnings) {
    var out = baseQuestion(index);
    out.type = TYPES.DRAG_DROP;
    var prompt = pick(q, ["question", "prompt"]);
    var options = pick(q, ["options", "choices"]);
    var key = pick(q, ["key"]) || {};
    var labelA = ctx.boxLabels && ctx.boxLabels.left ? ctx.boxLabels.left : "Box A";
    var labelB = ctx.boxLabels && ctx.boxLabels.right ? ctx.boxLabels.right : "Box B";

    var items = (Array.isArray(options) ? options : []).map(function (label, i) {
      return { id: String(i + 1), label: label };
    });
    var idOf = {};
    items.forEach(function (it) {
      idOf[it.label] = it.id;
    });
    var aIds = [];
    var bIds = [];
    var probs = [];
    (Array.isArray(options) ? options : []).forEach(function (label) {
      var side = String(key[label] == null ? "" : key[label]).toLowerCase();
      if (side === "left") aIds.push(idOf[label]);
      else if (side === "right") bIds.push(idOf[label]);
      else probs.push("'" + label + "' has no left/right key");
    });

    out.prompt = prompt == null ? "" : String(prompt);
    out.options = {
      mode: "two_box_sort",
      items: items,
      box_a: { label: labelA, correct_items: aIds },
      box_b: { label: labelB, correct_items: bIds },
    };
    var answerObj = {};
    answerObj[labelA] = aIds;
    answerObj[labelB] = bIds;
    out.correct_answer = JSON.stringify(answerObj);
    out.explanation = expl(q);

    if (isBlank(prompt)) probs.push("missing prompt");
    if (!Array.isArray(options) || options.length < 1) probs.push("no options");
    attachWarn(out, index, probs, warnings);
    return out;
  }

  function mapWordOrder(q, index, ctx, warnings) {
    var out = baseQuestion(index);
    out.type = TYPES.DRAG_DROP;
    var prompt = pick(q, ["question", "prompt"]);
    var options = pick(q, ["options", "choices"]);
    var key = pick(q, ["key"]) || {};

    var words = Array.isArray(options) ? options.slice() : [];
    var order = [];
    var probs = [];
    Object.keys(key).forEach(function (word) {
      var idx = positionIndex(key[word]);
      if (idx < 0) probs.push("'" + word + "' has unknown position '" + key[word] + "'");
      else order[idx] = word;
    });
    var correctOrder = [];
    for (var i = 0; i < order.length; i++) {
      if (order[i] !== undefined) correctOrder.push(order[i]);
    }

    out.prompt = prompt == null ? "" : String(prompt);
    out.options = { mode: "word_order", words: words, correct_order: correctOrder };
    out.correct_answer = JSON.stringify(correctOrder);
    out.explanation = expl(q);

    if (isBlank(prompt)) probs.push("missing prompt");
    if (!words.length) probs.push("no words");
    if (correctOrder.length !== words.length)
      probs.push("correct_order length (" + correctOrder.length + ") != words (" + words.length + ")");
    attachWarn(out, index, probs, warnings);
    return out;
  }

  function mapTapSelect(q, index, ctx, warnings) {
    var out = baseQuestion(index);
    out.type = TYPES.TAP_SELECT;
    var rawPrompt = pick(q, ["question", "prompt"]);
    var items = Array.isArray(q.items) ? q.items : [];
    var isCount = typeof q.count === "number" || items.every(function (it) {
      return typeof it === "string";
    });
    var probs = [];

    if (isCount) {
      // COUNT mode: { question, count, items:[emoji...] }
      out.prompt = rawPrompt == null ? "" : String(rawPrompt);
      out.options = {
        mode: "count",
        target_count: typeof q.count === "number" ? q.count : null,
        items: items.slice(),
      };
      out.correct_answer = typeof q.count === "number" ? String(q.count) : null;
      if (typeof q.count !== "number") probs.push("count mode without numeric count");
      if (!items.length) probs.push("no items to count");
    } else {
      // MATCH mode: { question(+scene span), items:[{label,correct}] }
      var split = splitScene(rawPrompt);
      var choices = items.map(function (it) {
        return it && typeof it === "object" ? it.label : it;
      });
      var correctLabels = items
        .filter(function (it) {
          return it && typeof it === "object" && it.correct;
        })
        .map(function (it) {
          return it.label;
        });
      out.prompt = split.prompt;
      out.options = { mode: "match", choices: choices, scene_emoji: split.scene, correct_choices: correctLabels };
      out.correct_answer =
        correctLabels.length === 1 ? correctLabels[0] : JSON.stringify(correctLabels);
      if (!choices.length) probs.push("no choices");
      if (!correctLabels.length) probs.push("no correct choice flagged");
    }
    out.explanation = expl(q);
    if (isBlank(rawPrompt)) probs.push("missing prompt");
    attachWarn(out, index, probs, warnings);
    return out;
  }

  function attachWarn(out, index, probs, warnings) {
    if (probs && probs.length) {
      var msg = probs.join("; ");
      out._warning = msg;
      warnings.push("Q" + (index + 1) + ": " + msg);
    }
  }

  // ----- main entry ---------------------------------------------------------

  function mapQuestion(q, index, detection, ctx, warnings) {
    if (q == null || typeof q !== "object") {
      var out = baseQuestion(index);
      out.type = detection.type;
      out._warning = "not an object";
      warnings.push("Q" + (index + 1) + ": not an object");
      return out;
    }
    switch (detection.type) {
      case TYPES.AUDIO:
        return mapAudio(q, index, ctx, warnings);
      case TYPES.TAP_SELECT:
        return mapTapSelect(q, index, ctx, warnings);
      case TYPES.DRAG_DROP:
        return detection.mode === "word_order"
          ? mapWordOrder(q, index, ctx, warnings)
          : mapTwoBoxSort(q, index, ctx, warnings);
      case TYPES.MCQ:
      default:
        return mapMCQ(q, index, ctx, warnings);
    }
  }

  function runEval(evalArray, candidates) {
    var lastErr = null;
    for (var i = 0; i < candidates.length; i++) {
      try {
        var val = evalArray(candidates[i]);
        if (Array.isArray(val) && val.length) return { value: val, error: null };
      } catch (e) {
        lastErr = e;
      }
    }
    return { value: null, error: lastErr };
  }

  /**
   * Extract one exercise from an HTML string.
   *
   * @param {string} html      full HTML text of the file
   * @param {string} filename  file name (basename used for slug/source)
   * @param {object} opts
   *   - evalArray(code): REQUIRED. Runs `code` (which ends by declaring/using
   *     `questions`) and returns the resulting array. Node -> vm, browser ->
   *     sandboxed Function.
   *   - now: ISO timestamp string (defaults to new Date().toISOString())
   *   - stripHtml: strip inline HTML from MCQ/audio prompts (default false =
   *     preserve, e.g. <strong> tags)
   *   - questionsPerAttempt: default 25
   * @returns {object} result envelope
   */
  function extract(html, filename, opts) {
    opts = opts || {};
    if (typeof opts.evalArray !== "function") {
      throw new Error("extract() requires opts.evalArray(code)");
    }
    var now = opts.now || new Date().toISOString();
    var ctx = {
      stripHtml: !!opts.stripHtml,
      boxLabels: null,
    };
    var perAttempt = opts.questionsPerAttempt || 25;
    var base = baseName(filename);
    var slug = slugFromFilename(base);
    var warnings = [];

    var detection = detectFromHtml(html);
    var candidates = questionCodeCandidates(html);

    if (!candidates.length) {
      return failure(base, slug, detection, "no inline questions array found");
    }

    var res = runEval(opts.evalArray, candidates);
    if (!res.value) {
      var reason = res.error ? "questions array eval failed: " + res.error.message : "questions array not found or empty";
      return failure(base, slug, detection, reason);
    }

    var questions = res.value;
    refineWithData(detection, questions);
    ctx.boxLabels = detection.boxLabels;

    var mapped = questions.map(function (q, i) {
      return mapQuestion(q, i, detection, ctx, warnings);
    });

    var hasExplanations = mapped.some(function (m) {
      return !isBlank(m.explanation);
    });

    var total = mapped.length;
    var data = {
      _source_file: base,
      _extracted_at: now,
      _quiz_type_detected: detection.type,
      _question_count: total,
      exercise: {
        slug: slug,
        title: titleFor(html, slug),
        quiz_type: detection.type,
        questions_per_attempt: total <= perAttempt ? total : perAttempt,
        total_questions: total,
        is_free: false,
        order_index: 0,
      },
      questions: mapped,
    };

    return {
      ok: true,
      status: warnings.length ? "warning" : "ok",
      detection: detection,
      warnings: warnings,
      error: null,
      data: data,
      meta: {
        slug: slug,
        title: data.exercise.title,
        quiz_type: detection.type,
        mode: detection.mode || "",
        question_count: total,
        has_explanations: hasExplanations,
      },
    };
  }

  function failure(base, slug, detection, reason) {
    return {
      ok: false,
      status: "failed",
      detection: detection,
      warnings: [],
      error: reason,
      data: null,
      meta: {
        slug: slug,
        title: "",
        quiz_type: detection ? detection.type : "",
        mode: detection && detection.mode ? detection.mode : "",
        question_count: 0,
        has_explanations: false,
      },
    };
  }

  // ----- level / subject classification -------------------------------------
  // Shared by the CLI (organize.js) and the Organize web page so the two never
  // drift. Edit the arrays below to extend — no other code changes needed.

  // Level families: each maps a set of prefix spellings to an output-folder
  // template ({N} = the detected number, any number). "leve" is a common
  // misspelling of "level" seen in the source files.
  var LEVEL_FAMILIES = [
    { words: ["kg"], folder: "kg{N}" },
    { words: ["level", "leve", "lvl"], folder: "level-{N}" },
    // e.g. { words: ["grade", "gr"], folder: "grade-{N}" },
  ];

  // Subject keyword rules, checked top to bottom; first match wins, else
  // DEFAULT_SUBJECT. Keywords are simple case-insensitive substrings.
  var SUBJECT_RULES = [
    { subject: "english", keywords: ["eng", "vowel", "sight-word", "vocabulary", "adjective", "noun", "adverb", "scrambled"] },
    { subject: "gk", keywords: ["gk", "general-knowledge", "fruits"] },
    { subject: "science", keywords: ["sci", "science", "living"] },
  ];
  var DEFAULT_SUBJECT = "math";
  var UNCLASSIFIED = "_unclassified";

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Detect the level folder (e.g. "kg3", "level-1") from the source filename
  // and/or slug. Returns null when no known level prefix is present.
  function detectLevel(slug, sourceFile) {
    var hay = (String(sourceFile || "") + " " + String(slug || "")).toLowerCase();
    for (var i = 0; i < LEVEL_FAMILIES.length; i++) {
      var fam = LEVEL_FAMILIES[i];
      // longest spelling first so "level" wins over the "leve" typo variant
      var words = fam.words.slice().sort(function (a, b) { return b.length - a.length; }).map(escapeRe).join("|");
      var m = hay.match(new RegExp("(?:" + words + ")[-_ ]?(\\d+)"));
      if (m) return fam.folder.replace("{N}", m[1]);
    }
    return null;
  }

  function detectSubject(slug) {
    var s = String(slug || "").toLowerCase();
    for (var i = 0; i < SUBJECT_RULES.length; i++) {
      var rule = SUBJECT_RULES[i];
      for (var j = 0; j < rule.keywords.length; j++) {
        if (s.indexOf(rule.keywords[j]) !== -1) return rule.subject;
      }
    }
    return DEFAULT_SUBJECT;
  }

  // ----- CSV ----------------------------------------------------------------

  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  var CSV_HEADER = [
    "filename",
    "slug",
    "quiz_type",
    "mode",
    "question_count",
    "has_explanations",
    "status",
    "warnings",
  ];

  function csvRow(result, sourceFile) {
    return [
      sourceFile,
      result.meta.slug,
      result.meta.quiz_type,
      result.meta.mode,
      result.meta.question_count,
      result.meta.has_explanations ? "yes" : "no",
      result.status,
      result.ok ? result.warnings.length + " warning(s)" : result.error,
    ]
      .map(csvCell)
      .join(",");
  }

  function buildCsv(rows) {
    return [CSV_HEADER.join(",")].concat(rows).join("\n") + "\n";
  }

  return {
    VERSION: VERSION,
    TYPES: TYPES,
    extract: extract,
    // helpers exposed for callers / tests
    slugFromFilename: slugFromFilename,
    titleFor: titleFor,
    detectFromHtml: detectFromHtml,
    // level / subject classification (organize.js + Organize UI)
    LEVEL_FAMILIES: LEVEL_FAMILIES,
    SUBJECT_RULES: SUBJECT_RULES,
    DEFAULT_SUBJECT: DEFAULT_SUBJECT,
    UNCLASSIFIED: UNCLASSIFIED,
    detectLevel: detectLevel,
    detectSubject: detectSubject,
    extractInlineScripts: extractInlineScripts,
    questionCodeCandidates: questionCodeCandidates,
    csvRow: csvRow,
    csvCell: csvCell,
    buildCsv: buildCsv,
    CSV_HEADER: CSV_HEADER,
  };
});
