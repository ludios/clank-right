## Rules for every reviewer

This is a review only: do not modify, stage or commit any tracked file, and do not push. You may run read-only commands, builds, type checkers, linters, tests and scratch scripts (put scratch files under /tmp).

Running the build, the type checker, the linter or the tests is not a review, and checks that pass are not evidence that there are no defects: most defects worth finding are ones that no test covers. Spend most of your effort reading the code and the text, and reasoning about them.

Do not drop a candidate because the change looks intentional, because the tradeoff looks acceptable, or because it seems unlikely or minor. Report it as a finding, say how likely or severe you think it is, and let the author decide. A risk that you noticed belongs in a finding, not in the overall verdict. Report every finding that survives; do not stop after the first few.

Do not check the `Model-output:` and `Session-file:` lines in the commit messages: not whether they are there, and not what they say. The sandbox is meant to hide the session files that they name.

## Output format

End your final message with the findings, most severe first, in exactly this format (one blank line between findings):

- [P0|P1|P2|P3] Title in the imperative mood — path/to/file:START-END
  One or two paragraphs: the concrete inputs or situation, what goes wrong, and how you verified it (or what you could not verify).

P0: drop everything to fix; P1: urgent; P2: normal; P3: low. Before the findings, write one or two sentences of overall verdict.
