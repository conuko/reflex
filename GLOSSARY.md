# Reflex

Reflex triages incoming customer support tickets for the support and product squads of a B2B AI platform. A model answers questions about each ticket, and an explicit policy turns those answers into a priority and a route.

## Language

### Judgments

**Judgment**:
The answers a judgment provider gave to the question set for one ticket, covering the messages the ticket had at that time.
_Avoid_: Prediction, classification, model output

**Judgment provider**:
A source of judgments: Jev, the baseline, or a fake used in tests. Named after the model it runs (`jev`, `qwen`, `claude`), never after the vendor or the runtime.
_Avoid_: Jev provider (for the general concept), model provider, TypeSafe provider, Ollama provider, local provider

**Jev**:
TypeSafe's System One model, pinned to one version, and the only judgment provider used in the running app.
_Avoid_: TypeSafe (that is the vendor, not the model)

**Baseline**:
The model Jev is compared against in evaluation, answering the same question set. For now Qwen3.5-9B, a general open model run locally; later, optionally, Claude Opus 5.5. It is never used in the running app.
_Avoid_: Claude provider (in prose), reference model, competitor

### Issues

**Issue corpus**:
The hand-written existing issues of two fictional trackers, `librechat` and `lobehub`, each labeled with a type, an area, a priority and, for a duplicate, the issue it duplicates. It is both the set of existing issues a ticket can duplicate and the labeled data for evaluation (ADR-0002).
_Avoid_: GitHub data, dataset, issue dump
