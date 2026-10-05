# Jev is the only model

Reflex uses one model, Jev, everywhere: in the running app, in the demo seed and in the evaluation. There is no other LLM, no local model and no embeddings model. The evaluation measures Jev against hand-written gold labels and shows each number next to reference baselines written in plain code: the majority class, frozen keyword rules, and the top full-text search candidate for duplicates. It also runs Jev twice and with shuffled option order, to measure its consistency. We chose this because Reflex is a showcase for Jev, and because every judgment Reflex needs is already a Jev question. The things Jev is documented as weak at are generating text, counting, comparing dates and doing arithmetic. Those already belong in code: the policy, spike detection, demand aggregates and recompute. The text the app writes, such as a new issue's title and body, is copied from the ticket.

## Considered Options

- **Qwen3.5-9B as a local baseline, run with Ollama.** This would compare Jev with prompting a general open model. But it needs an Ollama upgrade (older versions ignore the answer schema on MLX), a 6.6 GB download, and full runs of 8 to 16 hours overnight. It would also compare Jev with a small local model, which says little to a reader.
- **Claude Opus 5.5 as a frontier baseline.** This would be a strong comparison, but it needs about $35 to $50 of API credit, a second provider, and a second key.
- **Nimble, an open model with Jev's API.** It answers the same question set, but it is still another model, and Reflex evaluates the real Jev.

## Consequences

- The judgment providers are `jev` and `fake`. There is no `qwen` or `claude` provider, no `ollama` or `@anthropic-ai/sdk` dependency, and no `ANTHROPIC_API_KEY`.
- The README compares Jev with gold labels and with plain code. It never claims that Jev beats another LLM, and it says plainly that no other LLM was compared. The `send` seam in `src/lib/judgment/provider.ts` would let someone add such a comparison later.
- The reference baselines are frozen before the test run, just like the question set: keyword rules v0 are derived mechanically from the question criteria, and they get at most three revisions, on dev only.
- Hand-written data, such as the issue corpus and the eval sets, may be drafted with a coding assistant. A person reviews it and commits it before any Jev run on it. No model other than Jev answers an eval item.
