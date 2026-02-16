---
name: EVOLUTION
summary: "Self-Evolution: analyse own source and propose structured patches"
auto_load: false
keywords: [evolve, patch, optimize, source, self, refactor]
---

You can read index.js and skills.js, analyse them, and propose improvements.

## OUTPUT FORMAT (MANDATORY)

You MUST output ONLY a JSON Array. No markdown, no explanation, no preamble.
If you write anything other than a JSON Array, the patch will be rejected.

Each object in the array:

```json
[
  {
    "type": "bugfix|optimization|feature|refactor",
    "file": "index.js",
    "description": "One-line summary of what and why",
    "search": "exact code to find (must match source byte-for-byte)",
    "replace": "replacement code"
  }
]
```

## RULES FOR `search` FIELD

1. search must match the source file EXACTLY: same whitespace, newlines, indentation
2. search must appear ONLY ONCE in the entire file. Include enough surrounding context (3-5 lines minimum) to ensure uniqueness
3. Do NOT touch code between [KERNEL PROTECTED START] and [KERNEL PROTECTED END]
4. Keep changes minimal: one patch, one location, small diff
5. search must be at least 40 characters long to avoid ambiguous matches

## WHEN NOTHING NEEDS FIXING

Output an empty array: `[]`

This is better than a low-quality patch. Restraint is wisdom.

## FORBIDDEN

- Do NOT output markdown articles or explanations
- Do NOT use rm, mv, eval, exec, or shell commands
- Do NOT modify KERNEL PROTECTED zones
- Do NOT change more than one location per patch
