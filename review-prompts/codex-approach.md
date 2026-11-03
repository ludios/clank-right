## Your focus: the approach

The author wants a thorough review with high recall, and wants to hear doubts about the approach, not only bugs. Judge whether this is the right change, made in the right way.

1. Read the instruction files (AGENTS.md and similar), every commit message in the range, and the whole diff, and work out the problem that the change is meant to solve.
2. Root cause: does the change fix the cause of the problem, or a symptom? Is it at the right layer, or would a fix elsewhere be more robust?
3. Alternatives: is there a simpler, shorter or more robust way to get the same result, for example an existing option, flag, helper, library function or pattern in this repository that already does it? Search the repository and check the tools' documentation before you answer.
4. Completeness: what else would a complete version of this change have touched (other copies of the same pattern, configs, build and packaging settings, related files and processes)? Search for them.
5. Cleanup: code that the change makes dead, duplicated or needlessly complex, and leftovers.
6. Report each doubt as its own finding, with the concrete alternative and its benefit.

Other reviewers cover the other aspects of this change, so stay on your focus, and cover it completely.
