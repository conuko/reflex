# Reflex

Reflex triages incoming customer support tickets for the support and product squads of a B2B AI platform. A model answers questions about each ticket, and an explicit policy turns those answers into a priority and a route.

## Language

### Judgments

**Judgment**:
The answers a judgment provider gave to the question set for one ticket, covering the messages the ticket had at that time.
_Avoid_: Prediction, classification, model output

**Judgment provider**:
A source of judgments: Jev (`jev`), or a fake used in tests (`fake`). Named after the model it runs, never after the vendor.
_Avoid_: Jev provider (for the general concept), model provider, TypeSafe provider

**Jev**:
TypeSafe's System One model, pinned to one version, and the only model in Reflex: in the running app, the seed and the evaluation (ADR-0003).
_Avoid_: TypeSafe (that is the vendor, not the model)

**Baseline**:
Plain code that answers the same eval items without a model, so each of Jev's numbers can be shown next to what code alone achieves: the majority class, frozen keyword rules, or the top full-text search candidate for duplicates. A baseline is never a model and never a judgment provider (ADR-0003).
_Avoid_: baseline model, reference model, competitor, Qwen, Claude provider

### Issues

**Issue corpus**:
The hand-written existing issues of two fictional trackers, `librechat` and `lobehub`, each labeled with a type, an area, a priority and, for a duplicate, the issue it duplicates. It is both the set of existing issues a ticket can duplicate and the labeled data for evaluation (ADR-0002).
_Avoid_: GitHub data, dataset, issue dump

**Tracker**:
One of the two fictional products' issue trackers, `librechat` or `lobehub`. Every issue and every workspace belongs to one tracker, and a ticket's duplicate candidates come only from its workspace's tracker.
_Avoid_: repo, project, source (that is where an issue was imported from, such as Linear)
