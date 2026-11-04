## Rules for every reviewer

This is a review only. You may run read-only commands, builds, type checkers, linters, tests and scratch scripts (put scratch files under /tmp).

Running the build, the type checker, the linter or the tests is not a review, and checks that pass are not evidence that there are no defects: most defects worth finding are ones that no test covers. Spend most of your effort reading the code and the text, and reasoning about them.

Do not drop a candidate because the change looks intentional, because the tradeoff looks acceptable, or because it seems unlikely or minor. Report it as a finding, say how likely or severe you think it is, and let the author decide. A risk that you noticed belongs in a finding, not in the overall verdict. Report every finding that survives; do not stop after the first few.

Ignore the `Model-output:` and `Session-file:` lines in the commits.

## Output format

Your final message is the whole review, because only that message is saved. Start it with one or two sentences of overall verdict (or more, where your focus asks for more). End it with the findings, most severe first, as one JSON array in a code block that is fenced and marked `json`, in this shape:

```json
[
  {
    "file": "path/to/file",
    "line": 42,
    "summary": "One sentence that states the defect.",
    "failure_scenario": "The concrete inputs or situation, what goes wrong, how likely or severe it is, and how you verified it."
  }
]
```

Each finding is an object with exactly these four keys:

- `file`: the path of the file that the finding is about, relative to the top directory of the repository, as it is at HEAD.
- `line`: the number (counting from 1) of the line in `file` at HEAD that the finding is about, as a JSON number. For a finding about several lines, use the first of them.
- `summary`: one sentence that states the defect.
- `failure_scenario`: the concrete inputs or situation, what goes wrong, how likely or severe you think it is, and how you verified it (or what you could not verify). If you suggest an alternative, end with it and its benefit.

A finding that is about no line at HEAD (for example, a deleted line or file, a missing file, or a commit message) uses the file and line at HEAD that are closest to the problem, and its `failure_scenario` says where the problem really is.

The JSON must be valid: inside a string, escape each `"` and `\`, and write each line break as `\n`; write no comments or trailing commas. If no finding survives, end with an empty array (`[]`) in the same kind of code block.
