# Content items needing an author's decision

Findings from the migration extractor that a script should **not** resolve.

The rule applied throughout: *fix contradictions, don't fill gaps.* Where the
file disagrees with itself and one side is clearly right, that is a bug and it
was corrected in the source HTML. Where something is simply absent, supplying it
is authoring, and it is listed here instead.

---

## Open — needs the content author

### `sci-living-non` q100 — the correct answer is not among the options

Source: `question/level-1_Science/level1_sci_living&non.html`, question 100.

```js
{
  question: "What can living things do that non-living things cannot do?",
  options: ["fly", "be carried", "sit still"],
  correct: "grow",
  explanation: "Biological growth and change over time is an exclusive capability of living organisms."
}
```

`"grow"` does not appear in `options`, so the question is unanswerable as
written. It fails validation, because the answer key would have to reference a
choice that does not exist.

**Why this was not auto-fixed.** The obvious repair — add `"grow"` as a fourth
option — is plausible, but it is authoring rather than correction. Three things
cannot be determined from the file:

1. Whether `"grow"` was meant to be **added** as a fourth option, or to
   **replace** one of the existing three.
2. Whether the distractor set is right for the age group. All three current
   options are arguably things a living thing *can* do (a bird flies, a child
   sits still), which makes them weak distractors for "what can living things do
   that non-living things cannot do".
3. Whether the intended answer is `"grow"` at all, or whether the prompt was
   meant to be narrower.

**Decision needed:** the intended option list and correct answer.

**Impact:** 1 question out of 14,583. The exercise still migrates; this question
carries a validation failure and the extractor exits non-zero. It should be
fixed before seeding, but it blocks nothing else.

---

## Fixed in source (for reference)

### `eng-drag-and-drop-scrambled-words` q021 — capitalisation mismatch

**Status: fixed** — `NEW_LOYAL_QUIZ`, branch `claude/loyal-mcq-extractor-j6v6r5`,
commit `98a44b4`.

`options` contained `"four"` while `key` mapped `"Four"` to the first slot, so
the answer could not be resolved to a presented word. Corrected `options` to
`"Four"`. This is a transcription slip with three witnesses in the same object:

```js
// 21) Four five six seven                                    <- code comment
options: ["seven","four","five","six"],                       <- the outlier
key: { "Four":"first", … },                                   <- capital F
explanation: "'Four five six seven' is the correct order."    <- capital F
```

The exercise's own convention also capitalises the sentence-initial word
(`["bark","The","can","dog"]` → `The dog can bark`). Making `options` agree with
the comment, key and explanation corrects the data to match what the author
already wrote three times — it is not an editorial choice.
