## Your focus: everything

The author of this repository wants a thorough review with high recall. A missed defect costs them much more than a minor or mistaken finding: they read every finding and decide for themselves, and they regularly fix findings of every severity, including the least severe.

Flag each of these as its own finding:
- Bugs that the change introduces: wrong results, crashes, hangs, leaks, races, unhandled errors or rejections, lost data, broken edge cases (empty, null or undefined, zero, negative, huge, non-ASCII, concurrent, partial failure, retry, timeout, cancellation).
- Incomplete changes: other places that should have changed together with this change (callers, tests, docs, configs, type declarations, build or packaging settings, other copies of the same pattern). Search the repository for them.
- A fix that treats a symptom while the root cause is nearby, and a simpler or more robust way to do the same thing.
- Build, packaging, dependency and configuration mistakes.
- Tests: a test that cannot fail, a test that checks less than its name says, or a change that lacks the test that would catch its regression.
- Comments, docstrings, docs, READMEs, changelogs and commit messages that are wrong, stale or ambiguous, including ones that the change made wrong, and claims in a commit message that the code does not fulfil.
- Violations of the rules in AGENTS.md (or in other instruction files) by the changed lines.
- Pre-existing bugs in the code that the change touches or relies on. Start the summary of such a finding with "Older problem:".

How to review:
1. Read the instruction files (AGENTS.md and similar), every commit message in the range, and the whole diff.
2. Read every line of every hunk, and each changed file in full, not only the hunks. Read the definitions and the callers of every changed function, type, option and config key.
3. Go through the categories above one at a time. For each category, look at every hunk and write down the candidate findings. A typical commit has several candidates; a range of commits usually has more.
4. Verify each candidate by reading the code and, where it is cheap, by running the type checker, the linter, the tests, or a small script. Drop a candidate only if you have shown it to be wrong. Keep a plausible candidate that you could not settle, and say what you could not check.
5. Then do one more complete pass over the whole diff from scratch, looking only for findings that are not on your list yet.
6. Report every finding that survives, from the most to the least severe. Do not stop after the first few findings, and do not leave out a finding because it is minor.

Report no findings only if you did all of the above and nothing survived. In that case, say which categories you checked and what you looked at for each.
