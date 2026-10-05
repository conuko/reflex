# A small hand-written issue corpus instead of GitHub data

The existing issues that tickets are matched against, and the labeled data the evaluation runs on, come from a hand-written issue corpus. It holds about 40 English issues for each of two fictional trackers, `librechat` and `lobehub`, written in the style of issues in those open-source projects. Each issue carries its gold labels (type, area and priority), and a duplicate names the older issue it duplicates. We chose this over fetching the real LibreChat and LobeHub issues from GitHub for two reasons:

- **Size.** That corpus was far larger than this project needs: 11,737 issues, 6.7 MB gzipped.
- **Language.** About 4,500 of the 6,541 LobeHub issues contained Chinese, Japanese or Korean text, which breaks the project's English-only rule.

Writing the issues ourselves also makes every label deliberate. There is no label provenance to reconstruct, and no per-repo label mapping to maintain.

## Considered Options

- **Fetch every issue from GitHub and keep only the English ones later (the original plan).** This gives real labels and real writing. But most of the corpus would be filtered out again, non-English text would be committed, and labels would need provenance tiers and mappings before they could be trusted.
- **Fetch from GitHub and drop non-English issues before caching.** LobeHub would shrink to 1,988 issues and its `priority:high` label to 76, below the planned 100 per level. Thousands of issues that nobody reviews would still remain.

## Consequences

- Nothing in the repo comes from GitHub: there is no GitHub fetch, no `GITHUB_TOKEN` and no `data:fetch`. Pass B (timeline events and label provenance) and the label mapping files are no longer needed.
- The evaluation sets are small: about 80 issues, 12 of them duplicates. Results are directional and have wide confidence intervals, and the README must say so.
- The same people write the issues, their labels and the question set, which risks bias. To limit it, the corpus is written before the questions are tuned and then frozen. Changing an issue or a label takes a reviewed commit.
- The issues follow the style of public projects, but they are fictional and never name the company the app is aimed at.
