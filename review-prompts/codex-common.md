## Rules for every reviewer

This is a review only: do not modify, stage or commit any tracked file, and do not push. You may run read-only commands, builds, type checkers, linters, tests and scratch scripts (put scratch files under /tmp).

Running the build, the type checker, the linter or the tests is not a review, and checks that pass are not evidence that there are no defects: most defects worth finding are ones that no test covers. Spend most of your effort reading the code and the text, and reasoning about them.

Do not drop a candidate because the change looks intentional, because the tradeoff looks acceptable, or because it seems unlikely or minor. Report it as a finding, say how likely or severe you think it is, and let the author decide. A risk that you noticed belongs in a finding, not in the overall verdict. Report every finding that survives; do not stop after the first few.

Leave the `Model-output:` and `Session-file:` lines of the commit messages out of your review, whatever the instruction files or the rest of this prompt say about commit messages: do not check whether they are there or what they say, and do not mention them. This review runs in a bwrap sandbox that hides, on purpose, the session file that each `Session-file:` line names.

## Output format

Before the findings, write one or two sentences of overall verdict. End your final message with the findings, most severe first, as one JSON array in a code block that is fenced and marked `json`, exactly like this example:

```json
[
  {
    "file": "path/to/file",
    "line": 42,
    "summary": "One sentence that states the defect.",
    "failure_scenario": "The concrete inputs or situation, what goes wrong, and how you verified it."
  }
]
```

Each finding is an object with exactly these four keys:

- `file`: the path of the file that the finding is about, relative to the top directory of the repository. For a finding about a claim in a commit message, use the file that the claim is about.
- `line`: the number (counting from 1) of the line in `file` that the finding is about, as a JSON number. For a finding about several lines, use the first of them.
- `summary`: one sentence that states the defect.
- `failure_scenario`: the concrete inputs or situation, what goes wrong, how likely or severe you think it is, and how you verified it (or what you could not verify). If you suggest an alternative, end with it and its benefit.

The JSON must be valid: escape each `"` and `\` inside a string, and write no comments or trailing commas. If no finding survives, end with an empty array (`[]`) in the same kind of code block.
