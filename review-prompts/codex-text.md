## Your focus: text and conventions

The author wants a thorough review with high recall, and they care a lot about accurate, unambiguous text and about following their own written rules. Find every place where text is wrong, stale, ambiguous or missing, and every place where the change breaks a written rule.

1. Read the instruction files (AGENTS.md and similar) in full, every commit message in the range, and the whole diff.
2. Comments and docstrings: for every comment and docstring in or near the changed lines, check that each sentence is true of the code after the change, complete, and unambiguous. Check that code which the rules say needs a comment or docstring has one.
3. Docs elsewhere: search the repository (README, docs, other comments, help text, templates, changelogs) for every name, option, value, path and behavior that the change touches, and check that each mention is still true. Text that the change made wrong is a finding.
4. Commit messages: check every claim in each commit message against the code, and against the documentation or source of any tool, library or service that it describes.
5. Rules: go through the instruction files rule by rule, and check every changed line against each rule that could apply. In the `failure_scenario` of each finding of a broken rule, quote the rule and the line.
6. Report wrong, stale, ambiguous or missing text, and rule violations, each as its own finding.

Other reviewers cover the other aspects of this change, so stay on your focus, and cover it completely.
