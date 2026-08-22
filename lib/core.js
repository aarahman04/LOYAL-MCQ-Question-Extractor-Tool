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
  //
  // IMAGE is not a separate engine in the source site — picture exercises run
  // on the MCQ engine (`initMCQQuiz`). They are a distinct *content* type all
  // the same: the child matches a word to a picture, so every question needs
  // an image attached in the database. Detected from the data, not the
  // includes (see refineWithData / imageShare).
  var TYPES = {
    MCQ: "mcq",
    IMAGE: "image",
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

  // Balanced extraction of the array literal after `<name> = [ ... ]`,
  // string-literal aware so brackets inside strings don't confuse the scan.
  // `name` defaults to the conventional `questions`; pass a regex source to
  // pick up a bank stored under some other name.
  function extractQuestionsArrayLiteral(code, name) {
    var m = new RegExp((name || "questions") + "\\s*=\\s*\\[").exec(code);
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

  // Identifiers handed to an engine: `initMCQQuiz(bank)` -> "bank". Whatever a
  // page passes to its engine IS its question array, whatever it called the
  // variable — the most reliable name to look for after `questions` itself.
  function initCallArgs(html) {
    var out = [];
    var re = /(^|[^\w.$])init[A-Za-z0-9_]*Quiz\s*\(\s*([A-Za-z_$][\w$]*)\s*[),]/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      if (out.indexOf(m[2]) === -1) out.push(m[2]);
    }
    return out;
  }

  // Names an array literal is assigned to: `const bank = [` -> "bank".
  function assignedArrayNames(code) {
    var out = [];
    var re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g;
    var m;
    while ((m = re.exec(code)) !== null) {
      if (out.indexOf(m[1]) === -1) out.push(m[1]);
    }
    return out;
  }

  // Declare a no-op for every init*Quiz the page calls, so running the inline
  // script never dies on a ReferenceError for an engine the sandbox has not
  // heard of. `var` in sloppy mode hoists to the sandbox global, and the guard
  // leaves a real definition (or a host-provided stub) alone.
  function initStubPreamble(html) {
    var names = calledInits(html);
    if (!names.length) return "";
    return names
      .map(function (n) {
        return 'if (typeof ' + n + ' === "undefined") { var ' + n + " = function () {}; }";
      })
      .join("\n") + "\n";
  }

  // Build the ordered list of code candidates to try (first non-empty wins).
  // Ordered most-conventional first, so a file that follows the house style
  // costs one evaluation and the fallbacks only run for unusual structures.
  function questionCodeCandidates(html) {
    var scripts = extractInlineScripts(html);
    var stubs = initStubPreamble(html);
    var candidates = [];
    var primary = pickQuestionScript(scripts);
    if (primary) candidates.push(stubs + primary);
    if (scripts.length) candidates.push(stubs + scripts.join("\n;\n"));

    var joined = scripts.join("\n;\n") || html;

    // The bank lives under another name and is handed to the engine:
    // `const bank = [...]; initMCQQuiz(bank);`
    initCallArgs(html).forEach(function (name) {
      if (name === "questions") return;
      candidates.push(stubs + joined + "\n;var questions = " + name + ";");
    });

    // Literal-array fallbacks: the conventional name first, then any other
    // array literal the file declares (last resort — the array is taken as
    // written, without executing anything that builds it).
    var literal = extractQuestionsArrayLiteral(joined) || extractQuestionsArrayLiteral(html);
    if (literal) candidates.push("var questions = " + literal + ";");
    assignedArrayNames(joined).forEach(function (name) {
      if (name === "questions") return;
      var lit = extractQuestionsArrayLiteral(joined, name);
      if (lit) candidates.push("var questions = " + lit + ";");
    });
    return candidates;
  }

  // ----- image reference resolution -----------------------------------------
  // The source files were hand-written over a long stretch, so the picture
  // field is spelled several ways: `image`, `img`, `imageUrl`, `image_url`,
  // `picture`, `photo`, a `{ src: ... }` object, an array of paths, or a bare
  // <img> tag inside the prompt. One resolver, used by detection, the v1
  // mappers and the v2 transformer, so all three agree on what counts as a
  // picture question.

  // Checked in this order; first key that yields a usable reference wins.
  // Matching is on a normalized key (lowercased, non-alphanumerics dropped),
  // so `imageUrl`, `image_url`, `Image-URL` and `IMAGEURL` are all the same
  // key. The generic tail (media/src/url/file) is only safe because the VALUE
  // must still look like an image — see looksLikeImageRef.
  var IMAGE_KEYS = [
    "image", "img", "imageurl", "imagesrc", "imagepath", "imagefile",
    "picture", "pictureurl", "pic", "photo", "figure",
    "thumbnail", "thumb", "media", "src", "url", "file",
  ];

  var IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)(?:[?#][^\s"']*)?$/i;
  var DATA_IMAGE_RE = /^data:image\//i;
  var IMAGE_FOLDER_RE = /(^|\/)(images?|imgs?|pictures?|photos?|assets)\//i;
  var IMG_TAG_RE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i;

  function normKey(k) {
    return String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function valueByNormalizedKey(obj, wanted) {
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      if (normKey(keys[i]) === wanted) return obj[keys[i]];
    }
    return undefined;
  }

  // A string is an image reference when it carries an image extension, is a
  // data: image URI, or sits under an image/ folder (some references omit the
  // extension). Anything else — a word, a URL to a page — is rejected, which
  // is what keeps the generic `src`/`url`/`file` keys from false-positives.
  function looksLikeImageRef(s) {
    if (typeof s !== "string") return false;
    var v = s.trim();
    if (!v) return false;
    if (DATA_IMAGE_RE.test(v)) return true;
    if (IMAGE_EXT_RE.test(v)) return true;
    return IMAGE_FOLDER_RE.test(v.replace(/\\/g, "/"));
  }

  function resolveImageValue(v, depth) {
    if (v == null) return null;
    var d = depth || 0;
    if (typeof v === "string") {
      var s = v.trim();
      if (!s) return null;
      var tag = IMG_TAG_RE.exec(s);       // field holds markup: "<img src='a.png'>"
      if (tag) return tag[1].trim();
      return looksLikeImageRef(s) ? s : null;
    }
    if (d >= 3) return null;              // stop runaway nesting
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) {
        var hit = resolveImageValue(v[i], d + 1);
        if (hit) return hit;
      }
      return null;
    }
    if (typeof v === "object") {
      // { src }, { url }, { path }, { image: { src } }, …
      var inner = pick(v, ["src", "url", "path", "href", "file", "image", "value"]);
      return resolveImageValue(inner, d + 1);
    }
    return null;
  }

  /**
   * The picture a raw question points at, whatever the source file called the
   * field. Returns the reference exactly as written (the v2 transformer needs
   * the original path to derive the storage path), or null when the question
   * carries no picture.
   */
  function imageRefOf(q) {
    if (!q || typeof q !== "object") return null;
    for (var i = 0; i < IMAGE_KEYS.length; i++) {
      var raw = valueByNormalizedKey(q, IMAGE_KEYS[i]);
      if (raw === undefined) continue;
      var hit = resolveImageValue(raw, 0);
      if (hit) return hit;
    }
    // Last resort: the picture is inlined in the prompt markup rather than
    // carried in a field of its own.
    var prompt = pick(q, ["question", "prompt"]);
    if (typeof prompt === "string") {
      var m = IMG_TAG_RE.exec(prompt);
      if (m) return m[1].trim();
    }
    return null;
  }

  // Share of questions that carry a picture. Used to tell a picture exercise
  // from an ordinary MCQ bank that happens to illustrate a few questions.
  function imageShare(questions) {
    var list = (questions || []).filter(function (q) {
      return q && typeof q === "object";
    });
    if (!list.length) return 0;
    var n = 0;
    for (var i = 0; i < list.length; i++) if (imageRefOf(list[i])) n++;
    return n / list.length;
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

  // ----- engine signals -----------------------------------------------------
  //
  // Every exercise page in the source site is a static file that wires itself
  // to exactly one engine by linking that engine's script. That link is the
  // single most reliable thing on the page — a file cannot run on an engine it
  // does not load — so detection reads it first and only falls back to weaker
  // evidence when it is absent.
  //
  // Tiers, strongest first:
  //   1. script    the <script src> engine file the page loads
  //   2. style     the engine's own stylesheet
  //   3. init      the init*Quiz(...) call
  //   4. markup    DOM hooks the engine requires
  //   5. data      the shape of the question objects (refineWithData)
  //
  // Add an engine by adding one row to ENGINES; nothing else changes.

  var ENGINES = [
    {
      type: TYPES.AUDIO,
      scripts: ["audio.js"],
      styles: ["audio_style.css"],
      inits: ["initAudioQuiz"],
      markup: [/\bid=["']playBtn["']/i],
    },
    {
      type: TYPES.TAP_SELECT,
      scripts: ["tap_select.js", "tapselect.js", "tap-select.js"],
      styles: ["tap_select.css", "tapselect.css", "tap-select.css"],
      inits: ["initTapSelectQuiz"],
      markup: [/\bid=["']tap-grid["']/i],
    },
    {
      type: TYPES.DRAG_DROP,
      scripts: ["drag_and_drop.js", "draganddrop.js", "drag-and-drop.js", "dnd.js"],
      styles: ["dnd.css", "drag_and_drop.css"],
      inits: ["initTwoBoxSortQuiz", "initDragDropQuiz"],
      markup: [/class=["'][^"']*\bdropbox\b/i, /class=["'][^"']*\btwo-targets\b/i],
    },
    // MCQ last: it is the shared quiz shell, so its script/stylesheet are also
    // loaded by pages that run a more specific engine on top. A specific
    // engine therefore always wins within a tier.
    {
      type: TYPES.MCQ,
      scripts: ["script.js", "mcq.js"],
      styles: [],           // question.css is the shared shell, not a signal
      inits: ["initMCQQuiz"],
      markup: [],
    },
  ];

  // Linked file basenames, lowercased, with any ?query / #hash removed.
  // Attribute-parsed rather than regex-matched over the whole document, so a
  // filename mentioned in a comment or a string is not mistaken for a link.
  function linkedFiles(html, tagRe, attrRe) {
    var out = [];
    var m;
    tagRe.lastIndex = 0;
    while ((m = tagRe.exec(html)) !== null) {
      var attr = attrRe.exec(m[0]);
      if (!attr) continue;
      var file = String(attr[1]).replace(/\\/g, "/").split("/").pop();
      file = file.split("?")[0].split("#")[0].trim().toLowerCase();
      if (file) out.push(file);
    }
    return out;
  }

  function linkedScripts(html) {
    return linkedFiles(html, /<script\b[^>]*>/gi, /\bsrc\s*=\s*["']([^"']+)["']/i);
  }

  function linkedStyles(html) {
    return linkedFiles(html, /<link\b[^>]*>/gi, /\bhref\s*=\s*["']([^"']+)["']/i);
  }

  // Called init*Quiz(...) functions, ignoring the engine's own definition
  // (`function initMCQQuiz(` / `window.initMCQQuiz =`) so reading an engine
  // file inline does not count as using it.
  function calledInits(html) {
    var out = [];
    var re = /(^|[^\w.$])(init[A-Za-z0-9_]*Quiz)\s*\(/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var before = html.slice(Math.max(0, m.index - 12), m.index + m[0].length - m[2].length - 1);
      if (/\bfunction\s*$/.test(before)) continue;
      if (out.indexOf(m[2]) === -1) out.push(m[2]);
    }
    return out;
  }

  function hasAny(list, wanted) {
    for (var i = 0; i < wanted.length; i++) {
      if (list.indexOf(wanted[i]) !== -1) return true;
    }
    return false;
  }

  /**
   * Engine evidence found in the markup, by tier. Each tier maps to the list
   * of engine types it points at — in ENGINES order, so the most specific
   * engine in a tier comes first and a generic co-linked shell comes last.
   */
  function engineSignals(html) {
    var scripts = linkedScripts(html);
    var styles = linkedStyles(html);
    var inits = calledInits(html);
    var tiers = { script: [], style: [], init: [], markup: [] };

    ENGINES.forEach(function (e) {
      if (hasAny(scripts, e.scripts)) tiers.script.push(e.type);
      if (hasAny(styles, e.styles)) tiers.style.push(e.type);
      if (hasAny(inits, e.inits)) tiers.init.push(e.type);
      if (e.markup.some(function (re) { return re.test(html); })) tiers.markup.push(e.type);
    });
    return { tiers: tiers, scripts: scripts, styles: styles, inits: inits };
  }

  var TIER_ORDER = ["script", "style", "init", "markup"];

  function detectFromHtml(html) {
    var boxes = parseDropboxes(html);
    var signals = engineSignals(html);

    // First tier with any evidence decides; within it the most specific engine
    // wins (ENGINES order), so a drag-and-drop page that also carries a stray
    // `initMCQQuiz(questions)` is still drag-and-drop.
    var type = null;
    var source = "default";
    for (var i = 0; i < TIER_ORDER.length && !type; i++) {
      var hits = signals.tiers[TIER_ORDER[i]];
      if (hits.length) {
        type = hits[0];
        source = TIER_ORDER[i];
      }
    }
    if (!type) type = TYPES.MCQ; // nothing linked at all — assume the shell

    var mode = type === TYPES.DRAG_DROP ? classifyDragMode(boxes) : null;
    return {
      type: type,
      mode: mode,
      // how the type was decided, so callers can tell a positively identified
      // file from a defaulted one (surfaced as a warning by extract())
      type_source: source,
      signals: signals.tiers,
      dropboxes: boxes,
      boxLabels: boxLabelsFrom(boxes),
    };
  }

  /*
   * What the question objects themselves look like. Returns the engine the
   * data implies, or null when the shape says nothing (a plain
   * question/options/correct object fits both mcq and image).
   */
  function engineFromData(questions) {
    var q = (questions || []).find(function (x) {
      return x && typeof x === "object";
    });
    if (!q) return null;
    if (pick(q, ["voice", "tts_word"]) !== undefined) return TYPES.AUDIO;
    if (q.key !== undefined && q.key && typeof q.key === "object") return TYPES.DRAG_DROP;
    if (Array.isArray(q.items) || typeof q.count === "number") return TYPES.TAP_SELECT;
    return null;
  }

  /*
   * Refine detection with the shape of the parsed data.
   *
   * The markup decides which engine a file runs on — a page cannot run on an
   * engine it does not link. So the data does NOT overrule a positive markup
   * signal; it fills the gap when the markup was silent (`type_source` is
   * "default"), and when the two disagree the disagreement is recorded on
   * `detection.conflict` for the caller to warn about, rather than one
   * silently winning.
   *
   * The data always supplies detail the markup cannot: the drag-and-drop mode,
   * and the mcq -> image promotion (a content refinement within one engine,
   * not an engine change).
   */
  function refineWithData(detection, questions) {
    var fromData = engineFromData(questions);

    if (fromData) {
      if (detection.type_source === "default") {
        detection.type = fromData;
        detection.type_source = "data";
      } else if (fromData !== detection.type) {
        detection.conflict =
          "markup says " + detection.type + " (from the " + detection.type_source +
          "), question data looks like " + fromData;
      }
    }

    if (detection.type === TYPES.DRAG_DROP && !detection.mode) {
      var q = (questions || []).find(function (x) { return x && typeof x === "object"; });
      detection.mode = dragModeFromKey(q && q.key) || "two_box_sort";
    }

    // An MCQ bank whose questions all carry a picture is a picture exercise:
    // the child matches a word to an image. It gets its own type so the seed
    // row is tagged correctly and every question is guaranteed a media block.
    // Only MCQ is promoted — audio, tap-select and drag-drop are already
    // picture-capable and keep their engine's type.
    if (detection.type === TYPES.MCQ && imageShare(questions) >= IMAGE_TYPE_MIN_SHARE) {
      detection.type = TYPES.IMAGE;
    }
    return detection;
  }

  // Deliberately high: an MCQ bank that illustrates a handful of its questions
  // stays "mcq". The tolerance below 1.0 only absorbs a few broken or
  // text-only entries inside an otherwise all-picture bank. In this corpus the
  // split is clean — picture banks sit at 100%, the one partly-illustrated
  // bank at 16%.
  var IMAGE_TYPE_MIN_SHARE = 0.8;

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

  // A picture question answers like an MCQ; only the type and the attached
  // media differ. v1 keeps the reference as written — the storage path is a
  // v2 concern (see transform.js storagePathFor).
  function mapImage(q, index, ctx, warnings) {
    var out = mapMCQ(q, index, ctx, warnings);
    out.type = TYPES.IMAGE;
    var ref = imageRefOf(q);
    out.media = ref ? { kind: "image", source_path: ref } : null;
    if (!ref) {
      out._warning = out._warning ? out._warning + "; missing image" : "missing image";
      warnings.push("Q" + (index + 1) + ": missing image");
    }
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
      case TYPES.IMAGE:
        return mapImage(q, index, ctx, warnings);
      case TYPES.MCQ:
      default:
        return mapMCQ(q, index, ctx, warnings);
    }
  }

  // Fields that mark an array as a question bank rather than some other array
  // the file happens to declare (a word list, an emoji palette, …). Checked
  // because the later candidates guess at names, so a wrong guess must be
  // rejected rather than extracted as an exercise.
  var QUESTION_FIELDS = [
    "question", "prompt", "options", "choices", "correct", "answer",
    "items", "count", "voice", "key", "image",
  ];

  function looksLikeQuestionBank(arr) {
    if (!Array.isArray(arr) || !arr.length) return false;
    return arr.some(function (q) {
      if (!q || typeof q !== "object" || Array.isArray(q)) return false;
      return QUESTION_FIELDS.some(function (f) { return q[f] !== undefined; });
    });
  }

  function runEval(evalArray, candidates) {
    var lastErr = null;
    for (var i = 0; i < candidates.length; i++) {
      try {
        var val = evalArray(candidates[i]);
        if (looksLikeQuestionBank(val)) return { value: val, error: null };
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

    // Never guess silently. A file that links no engine, or whose data
    // contradicts the engine it links, is extracted anyway — but it is
    // reported so a new or malformed structure is reviewed rather than
    // quietly filed as the default MCQ.
    if (detection.type_source === "default") {
      warnings.push(
        "quiz type: nothing identified an engine (no engine script, stylesheet, " +
        "init call, DOM hook, or recognisable data shape) — defaulted to " + detection.type
      );
    }
    if (detection.conflict) warnings.push("quiz type: " + detection.conflict);

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
      // the raw parsed question objects, before any output mapping. The v2
      // transformer needs these because the v1 mappers drop fields (notably
      // `image`). Never written to the v1 JSON.
      rawQuestions: questions,
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
    { words: ["kg", "kindergarten"], folder: "kg{N}" },
    { words: ["level", "leve", "lvl"], folder: "level-{N}" },
    { words: ["grade", "gr"], folder: "grade-{N}" },
  ];

  // Subject keyword rules, checked top to bottom; first match wins, else
  // DEFAULT_SUBJECT.
  //
  // Keywords match whole WORDS, not substrings. Substring matching silently
  // mislabels real files — "eng" appears inside "lengths", "strength" and
  // "challenge", so `level_1_math_challenge.html` used to be filed as English.
  // A keyword may be several words ("sight-word"), in which case it matches a
  // run of consecutive words. Simple plurals are folded on both sides, so
  // "noun" matches "nouns" and "maths" matches "math".
  var SUBJECT_RULES = [
    { subject: "math", keywords: ["math", "maths", "mathematics", "numeracy"] },
    { subject: "english", keywords: ["eng", "english", "vowel", "consonant", "sight-word", "vocabulary", "adjective", "noun", "pronoun", "adverb", "verb", "preposition", "antonym", "synonym", "scrambled"] },
    { subject: "gk", keywords: ["gk", "general-knowledge", "fruits"] },
    { subject: "science", keywords: ["sci", "science", "living"] },
  ];
  var DEFAULT_SUBJECT = "math";
  var UNCLASSIFIED = "_unclassified";

  // "Level 1 Maths" / "level_1_eng" / "kg3-vowels" -> ["level","1","maths"], …
  function words(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  // Crude but symmetric plural folding: applied to BOTH the keyword and the
  // text, so only the pair needs to agree, never English grammar.
  function fold(w) {
    return w.replace(/ies$/, "y").replace(/(?:es|s)$/, "");
  }

  // Word sequence as a delimited string, for whole-word / phrase matching.
  function wordKey(s) {
    return "-" + words(s).map(fold).join("-") + "-";
  }

  function hasPhrase(key, phrase) {
    var p = words(phrase).map(fold).join("-");
    return p ? key.indexOf("-" + p + "-") !== -1 : false;
  }

  /**
   * Detect the level folder ("kg3", "level-1", "grade-2") from the source
   * filename and/or slug. Matches a level word joined to its number
   * ("level1", "kg-3") or standing next to it ("Level 1 Maths"). Returns null
   * when no known level word is present.
   */
  function detectLevel(slug, sourceFile) {
    var toks = words(sourceFile).concat(words(slug));
    for (var i = 0; i < LEVEL_FAMILIES.length; i++) {
      var fam = LEVEL_FAMILIES[i];
      // longest spelling first so "level" wins over the "leve" typo variant
      var spellings = fam.words.slice().sort(function (a, b) { return b.length - a.length; });
      for (var t = 0; t < toks.length; t++) {
        for (var s = 0; s < spellings.length; s++) {
          var w = spellings[s];
          // "level1" / "kg3" — word and number in one token
          var joined = new RegExp("^" + w + "(\\d+)$").exec(toks[t]);
          if (joined) return fam.folder.replace("{N}", joined[1]);
          // "level 1" / "kg_3" — number in the next token
          if (toks[t] === w && /^\d+$/.test(toks[t + 1] || "")) {
            return fam.folder.replace("{N}", toks[t + 1]);
          }
        }
      }
    }
    return null;
  }

  /**
   * Subject from a slug / filename / folder name.
   *
   * @param {string} slug     text to search for subject keywords
   * @param {*} [fallback]    returned when nothing matches; defaults to
   *                          DEFAULT_SUBJECT. Pass `null` to find out whether
   *                          a match happened at all, so callers can try a
   *                          second source (e.g. filename, then folder) before
   *                          settling for the default.
   */
  function detectSubject(slug, fallback) {
    var key = wordKey(slug);
    for (var i = 0; i < SUBJECT_RULES.length; i++) {
      var rule = SUBJECT_RULES[i];
      for (var j = 0; j < rule.keywords.length; j++) {
        if (hasPhrase(key, rule.keywords[j])) return rule.subject;
      }
    }
    return arguments.length > 1 ? fallback : DEFAULT_SUBJECT;
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
    // engine table — add a row to teach the tool a new engine
    ENGINES: ENGINES,
    // picture-question detection (shared with the v2 transformer)
    imageRefOf: imageRefOf,
    imageShare: imageShare,
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
