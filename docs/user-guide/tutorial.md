# Tutorial: triage tickets with Reflex

In this tutorial, you go through the full flow of Reflex once. You read and correct triages, send your own ticket, change the policy and start an incident. At the end, you check the feature demand and the evaluation. It takes about 20 minutes.

To look up a single label or field, see the [Screen reference](reference.md).

## Before you start

Make sure that:

- The app runs at http://localhost:3000 (`pnpm dev`).
- The worker runs in a second terminal (`pnpm worker`). Parts 3 and 5 need it.
- The demo data is loaded (`pnpm seed:demo`).

> [!NOTE]
> The tutorial changes the demo data: it sets priorities, creates an issue, adds tickets and saves policy versions. `pnpm seed:demo` resets all of these changes.

Your screen can show other numbers than the screenshots. The ages of the tickets change with the time, and your own clicks change the counts.

## Part 1: Read a triage

### Step 1: Open the inbox

Open http://localhost:3000. The inbox shows all tickets, sorted by priority from **Urgent** to **Won't do**, and newest first inside each priority.

![The inbox: navigation (1), views (2), keyboard hints (3) and a ticket row (4)](images/inbox.png)

The navigation on the left (1) opens the five pages of Reflex. The views (2) filter the list. The keyboard hints (3) list the keys of the inbox. Each row (4) is one ticket. The row shows the priority icon, the subject, the linked issue, the type and area, the workspace and the age.

### Step 2: Open a ticket

1. Scroll to the **High** tickets.
2. Click **IT helpdesk agent just says 'Something went wrong'**.

The ticket opens in a panel on the right. The list gets narrower and shows only the priority, the subject and the age.

![The inbox with the IT helpdesk ticket open in the panel on the right](images/inbox-ticket-open.png)

You can also use the keyboard. Press `j` or `↓` to select the next ticket, `k` or `↑` for the previous one, and `Enter` to open it. `Esc` closes the panel. The URL changes to `/inbox?t=<ticket id>`, so you can share a link to the open ticket.

### Step 3: Read why the ticket has its priority

Look at **Why this priority** in the panel.

![The top of the ticket panel: priority buttons, the policy's suggestion and the rules the policy checked](images/ticket-triage.png)

The policy checks its rules from top to bottom. The first rule that matches sets the priority:

- The first three rules (5) did not apply. Each has a dash and a cross for the condition that failed. Data exposure and data loss are at 2%, and no incident is open.
- The rule **A bug that blocks many users with no workaround: High** (6) applied. All three conditions are met: the reach is the whole workspace, **Blocked** is yes and **Has a workaround** is no.
- Each bar (7) shows Jev's probability. The red line is the yes threshold of 50%. **Blocked** is at 52%, so it counts as yes, but only just.
- The result (8) is **High**.

Because 52% is in the uncertain band from 35% to 65%, the policy sends the ticket to review (9). The amber outline on the **Blocked** bar marks the uncertain answer.

### Step 4: Check Jev's answers and the duplicate

Scroll down in the panel to **Routing and flags** and **Duplicate of**.

![Routing and flags with Jev's answers, and the issue that Jev linked](images/ticket-routing.png)

**Routing and flags** shows every answer that Jev gave:

- The squad (1) is **Agents**, because the ticket is a bug in the area **Agents**.
- Type, area and reach (2) show Jev's choice and its probability.
- The yes/no flags (3) show Jev's probability of yes. A bold label means yes.

**Duplicate of** shows that Jev linked the ticket to `librechat#2106` (5). Jev picked it from the search results (6) with a probability of 100%. The demand line counts the tickets and workspaces that are linked to this issue.

## Part 2: Correct a triage

### Step 5: Accept the triage

You checked the ticket, and **High** is correct. With the ticket open, press `a`.

![The accepted ticket: "Checked by a person" in the panel, and the row without the review icon](images/inbox-accepted.png)

The panel shows **Checked by a person** (1). In the list (2), the subject is no longer bold and the review icon is gone. The count of **Needs review** goes down by one.

An accepted ticket still follows the policy. If a later policy version changes its priority, the ticket moves.

### Step 6: Work the review queue

Click the **Needs review** tab (1).

![The Needs review view: only tickets that a person must check](images/inbox-needs-review.png)

The list shows only the tickets that the policy sends to review and that no person checked yet. To work the queue from the keyboard, press `j` to select a ticket, `Enter` to open it, and `a` to accept it.

### Step 7: Set a different priority

The ticket **Is the platform down?** reports that nobody in the customer's company can sign in. Two partner companies have the same problem. The policy says **High**, but you want **Urgent**.

1. Open **Is the platform down?**.
2. Press `1`, or click **Urgent**.

![A priority set by a person: Urgent is selected, and the policy still suggests High](images/ticket-set-by-person.png)

**Urgent** is now selected (1). The line below (2) says **Set by a person; the policy suggests High.** The note in **Why this priority** (3) explains that a recompute leaves the ticket alone.

At the bottom of the panel, **Changed by people** records your change:

![The record of the change: priority High to Urgent](images/ticket-changed-by-people.png)

The keys `1` to `5` set **Urgent**, **High**, **Medium**, **Low** and **Won't do**. A priority that a person sets is an override: policy changes never move the ticket again.

### Step 8: Create an issue when no candidate fits

The ticket **Nobody can sign in after we rotated our SAML certificate** is in review because the duplicate match is uncertain.

1. Open the ticket.
2. Scroll to **Duplicate of**.

![Jev's candidates for the SAML ticket: none of them at 55%, the closest issue at 44%](images/ticket-candidates.png)

The ticket is not linked (1). Jev gives 55% to "none of them" (2). The closest candidate (3) is about a redirect loop after a release. That is a different problem, so you create a new issue:

1. Click **Create a new issue from this ticket**.
2. Optional: change the title. The ticket's subject is the default.
3. Click **Create and link**.

![The new issue librechat#2142, linked by a person](images/ticket-issue-created.png)

Reflex creates the issue in the ticket's tracker and links the ticket to it (1). The body of the issue is the customer's first message, copied without changes. The new issue shows on the **Feature demand** page with the badge **created here**.

When a candidate is the same problem, click **Link** next to it instead. To link an issue that is not in the list, use **Link another librechat issue** and search by title or ID.

### Step 9: Use the command palette

Press `⌘K` on macOS or `Ctrl+K` on Windows and Linux.

![The command palette with actions for the selected ticket](images/command-palette.png)

The palette has the same actions as the keys: set a priority, accept, and open or close the ticket. It also switches the view and goes to the other pages. Type to filter the commands, and press `Enter` to run one.

## Part 3: Send your own ticket

The worker must run for this part.

### Step 10: Send a ticket

1. In the navigation, click **Try it**.
2. In **Workspace**, select a workspace. This example uses **Alderbrook Freight (Business, librechat)**.
3. In **Subject**, type `Our sales agent can't find the new price list`.
4. In **The customer's message**, type this text:

   ```text
   Since this morning our sales agent answers every question about the new price list with "I couldn't find anything about that." I uploaded the price list to the Sales collection in the knowledge library yesterday. Older documents in the same collection still work. Can you check what is going on?
   ```

   ![The Try it form with the subject and the message filled in](images/try-it-form.png)

5. Click **Triage it**.

The triage shows on the right after about a second:

![The triage of the new ticket: Low, from the rule "A bug: Low", with two review reasons](images/try-it-result.png)

Jev reads a bug in the knowledge library that affects one team. No rule above **A bug: Low** matches, so the result is **Low**. The answer **Used to work** and the duplicate match are uncertain, so the ticket needs review. The ticket also shows in the inbox, with the source **Try it**.

Jev can answer a little differently in your run. The policy explains the result in the same way.

### Step 11: Add a customer reply

The customer writes again with worse news.

1. In **Add a customer reply**, type this text:

   ```text
   Update: it is worse than we thought. The whole Sales collection now shows 0 documents, and all 40 files we uploaded are gone. Everyone in the company uses this agent, and we have no other copies of some of these files.
   ```

2. Click **Add reply**.

Jev reads the whole thread again, and the triage changes:

![After the reply: Urgent, and the list of answers that the reply changed](images/try-it-reply.png)

The priority is now **Urgent** (1). **What the reply changed** (2) compares Jev's answers after two messages with the answers after one. **Data loss** goes from 11% to 97%, and the reach goes from one team to the whole workspace. In **Why this priority** (3), the rule **Customer data may be lost: Urgent** applies. The result shows **(was Low)**.

## Part 4: Change the policy

### Step 12: Preview a change

1. In the navigation, click **Policy**.
2. Under **Plans**, turn on **Enterprise workspaces go up one level, up to High**.

The preview on the right computes the change for every ticket, without a request to Jev:

![The policy preview: the change moves 23 tickets](images/policy-preview.png)

The change moves 23 tickets (1). The table (3) shows from which priority to which: 19 tickets go from **Low** to **Medium**, and 4 go from **Medium** to **High**. Tickets with a priority set by a person stay as they are (2). The list (4) shows some of the tickets that move. Click a subject to open the ticket in the inbox.

### Step 13: Save the policy as a new version

1. Click **Save as version 2**.

   The new version is in force at once, and the worker recomputes every ticket:

   ![The versions list: v2 is in force, and v1 has a Load button](images/policy-saved.png)

2. In the navigation, click **Inbox**.
3. Click the tab **Moved by policy v2**.

![The view "Moved by policy v2": 23 tickets, each with its old and new priority](images/inbox-moved.png)

The tab (1) shows the tickets whose priority changed after the save. Each row has a badge with the old and the new priority (2).

### Step 14: Roll back the change

Saved versions never change. To go back, you save the old values as a new version.

1. On the **Policy** page, under **Versions**, click **Load** next to **v1**.
2. Check the preview. It moves the same 23 tickets back.
3. Click **Save as version 3**.

![v1 loaded into the form: the switch is off, and the preview moves 23 tickets back](images/policy-load.png)

Version 3 is in force and has the same values as version 1.

## Part 5: Handle an incident

The worker must run for this part.

### Step 15: Simulate an incident

1. In the navigation, click **Try it**.
2. Under **Simulate an incident**, click **Simulate incident**.

   ![The confirmation: 6 tickets sent](images/try-it-incident-sent.png)

   Reflex sends six reports of the same agent outage through the intake. The worker triages them, and the spike detector counts them.

3. In the navigation, click **Inbox**.

   A few seconds later, a red banner shows on top of every page (1):

   ![The incident banner and six new Urgent tickets about the agent outage](images/incident.png)

   Jev linked the reports to the same issue, `librechat#2106`, so they count as related. Five related tickets within 30 minutes open an incident, and all its tickets become **Urgent**.

4. Open **Agents time out on every run**.

![The rule "Part of an open incident: Urgent" applies](images/ticket-incident.png)

The rule **Part of an open incident: Urgent** applies (1). The result shows the priority before the incident (2). The incident closes when the group has fewer than 5 tickets in the last 30 minutes. The worker checks this every 5 minutes. Then the tickets go back to their normal priority.

## Part 6: Track demand and accuracy

### Step 16: See the feature demand

In the navigation, click **Feature demand**.

![The demand per issue: tickets, workspaces, plans, ARR and a 14-day trend](images/demand.png)

The table counts the tickets that are linked to each issue. It shows how many workspaces ask, their plans, their combined ARR and the tickets per day over the last 14 days. The issue with the most workspaces is at the top.

Below the table, **Asked for, but we won't build it** groups the tickets that ask for a non-goal:

![Three non-goals with the tickets that ask for them](images/demand-wont-do.png)

### Step 17: Check how well Jev does

In the navigation, click **Evaluation**.

![The evaluation: the test runs and the go/no-go gate](images/evaluation.png)

The page compares Jev's answers on 120 hand-labeled test tickets with plain-code baselines. The gate passes 7 of 8 checks.

Scroll down to **What Jev got wrong**. The table lists every test item where Jev's type, area or duplicate differs from the label:

![What Jev got wrong: each item with the wrong field, the label and Jev's answer](images/evaluation-misses.png)

Click an item, such as `adversarial-06`:

![One evaluation item: Jev's answers next to the gold label and the baselines](images/evaluation-item.png)

The item page shows what Jev saw, what it answered in each run, and what the baselines answered. Red cells are wrong answers. In this item, Jev picked the area **Other** instead of **Chat**, but it found the injection in the last message.

## Next steps

You now know the full flow of Reflex. To continue:

- Look up every label and field in the [Screen reference](reference.md).
- Send tickets from another system through the intake API: see [Send tickets to Reflex](../../README.md#send-tickets-to-reflex).
- Read why Jev only answers and the policy decides: see [ADR-0001](../adr/0001-model-judges-policy-decides.md).
- Reset the demo data: run `pnpm seed:demo`.
