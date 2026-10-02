# The model judges, the policy decides

Jev never outputs a priority. For each ticket it answers a fixed, versioned question set (type, area, reach, blocked, data exposure, duplicate match, and so on). A pure, unit-tested policy function then combines those answers with facts the model never sees (plan, ARR, spikes, demand) to produce the priority, the route and the review reasons. We chose this so every priority can be explained rule by rule, so a policy change recomputes every ticket from stored judgments with zero model calls, and so the model's accuracy can be measured per question against labeled data.

## Considered Options

- **The model outputs the priority directly.** This is simpler end to end, but each answer is opaque, every policy change needs a full re-run, and the model would need business data (plan, ARR) that should stay out of its input.

## Consequences

- Judgments are stored raw and kept, because they are the input to every recompute.
- Changing what a question means requires a new question-set version and a fresh eval. Changing a threshold only requires a new policy version.
