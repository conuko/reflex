# Reflex user guide

This guide shows what you can do with Reflex, with a screenshot for every step. It is for support leads, product managers and developers who use the app or show it to others.

Reflex is the support inbox of a fictional B2B platform. For each new ticket, the model Jev answers 14 questions. A versioned policy turns the answers into a priority and a squad. The inbox explains each priority rule by rule.

![The Reflex inbox with 180 demo tickets, sorted by priority](images/inbox.png)

## Pages of this guide

The guide has two pages:

| Page                                                | Read it when you want to                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Tutorial: triage tickets with Reflex](tutorial.md) | Learn the full flow once, from the inbox to the evaluation. It takes 20 minutes. |
| [Screen reference](reference.md)                    | Look up what a label, an icon, a field or a number on a page means.              |

To install and start Reflex, see [Getting started](../../README.md#getting-started) in the README.

## Before you start

You need these parts of Reflex:

- The app at http://localhost:3000, started with `pnpm dev`.
- The worker, started with `pnpm worker`. The worker triages new tickets from **Try it** and from the intake API.
- The demo data, loaded with `pnpm seed:demo`: 180 tickets in 40 workspaces.

The inbox, the policy editor, the demand page and the evaluation page work without the worker. New tickets wait in the queue until the worker runs.

## How a ticket gets its priority

Every ticket goes through the same steps:

1. A ticket arrives through the intake API or the **Try it** page.
2. Full-text search finds up to 10 existing issues in the ticket's tracker that the ticket might repeat.
3. Jev reads the ticket and answers 14 questions in one request: the type, the product area, the reach, the frustration, six yes/no flags, the duplicate, and three questions about non-goals.
4. The policy combines Jev's answers with facts that Jev never sees: the workspace's plan, open incidents, and the demand on the linked issue.
5. The policy returns a priority, a squad, the reasons to review the ticket, and a trace of every rule it checked.
6. The inbox shows the result a second later. A person accepts it or sets a different priority.

Jev decides nothing on its own. It only answers questions, and the policy decides. For this reason, a policy change recomputes every ticket from the stored answers and asks Jev nothing. The reasons for this design are in [ADR-0001](../adr/0001-model-judges-policy-decides.md).

## Terms

This guide uses these terms. The project glossary is in [GLOSSARY.md](../../GLOSSARY.md).

| Term         | Meaning                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Ticket       | A customer's request: a subject and one or more messages from one workspace.                                          |
| Workspace    | A customer account. It has a plan (Free, Business or Enterprise), an annual revenue (ARR) and a tracker.              |
| Tracker      | One of the two fictional issue trackers, `librechat` or `lobehub`. A ticket can only duplicate issues of its tracker. |
| Issue        | A known bug or feature request in a tracker, such as `librechat#2106`.                                                |
| Jev          | The model that answers the questions about each ticket. Reflex uses version `jev-1.13.0`.                             |
| Judgment     | Jev's answers to the 14 questions for one ticket, with a probability for each answer.                                 |
| Policy       | The rules and thresholds that turn a judgment into a priority. Each save makes a new version.                         |
| Triage       | The policy's result for one ticket: the priority, the squad, the review reasons and the trace.                        |
| Priority     | **Urgent**, **High**, **Medium**, **Low** or **Won't do**.                                                            |
| Squad        | The team that gets the ticket, such as **Agents** or **Billing**.                                                     |
| Needs review | The policy is not sure enough, so a person must check the ticket.                                                     |
| Incident     | 5 or more related tickets in 30 minutes. While the incident is open, its tickets are Urgent.                          |
| Demand       | How many workspaces ask about an issue, and their combined ARR.                                                       |
| Non-goal     | Something the product will not build: self-hosting, native mobile apps or media generation.                           |

All companies, workspaces, tickets and issues in Reflex are fictional.
