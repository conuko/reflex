import type { TicketInput } from "./state";

// Turns an issue from the issue corpus into a ticket, the way a customer would
// have sent it: the title becomes the subject and the body one customer
// message. Issue-form headings would leak the gold label ("### What happened?"
// appears only on bugs, "### What would you like?" only on feature requests,
// "### Workaround" names a signal), so every heading line goes, but the text
// under it stays. Markup a customer's message wouldn't carry goes too.

/** Code blocks longer than this many lines keep only their first and last lines. */
export const LONG_BLOCK_MAX_LINES = 20;
const LONG_BLOCK_HEAD_LINES = 10;
const LONG_BLOCK_TAIL_LINES = 5;

const FENCE = /^ {0,3}(?:```|~~~)/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const CHECKBOX = /^(\s*[-*+]) \[[ xX]\] /;

export function issueToTicket({ title, body }: { title: string; body: string }): TicketInput {
  return { subject: title.trim(), messages: [{ from: "customer", text: normalizeBody(body) }] };
}

export function normalizeBody(body: string): string {
  const text = body
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<img\b[^>]*>/gi, "");

  const out: string[] = [];
  // The lines of the fenced code block being read, opening fence included.
  let block: string[] | null = null;
  for (const line of text.split("\n")) {
    if (block) {
      block.push(line);
      if (FENCE.test(line)) {
        out.push(...collapseBlock(block));
        block = null;
      }
    } else if (FENCE.test(line)) {
      block = [line];
    } else if (!HEADING.test(line)) {
      out.push(line.replace(CHECKBOX, "$1 "));
    }
  }
  if (block) out.push(...collapseBlock(block));

  return out
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Keeps a long log readable and inside the state budget: the first and last
// lines usually hold the command and the error.
function collapseBlock(block: string[]): string[] {
  const closed = block.length > 1 && FENCE.test(block.at(-1) ?? "");
  const inner = block.slice(1, closed ? -1 : undefined);
  if (inner.length <= LONG_BLOCK_MAX_LINES) return block;

  const omitted = inner.length - LONG_BLOCK_HEAD_LINES - LONG_BLOCK_TAIL_LINES;
  return [
    block[0] ?? "```",
    ...inner.slice(0, LONG_BLOCK_HEAD_LINES),
    `[... ${omitted} lines omitted ...]`,
    ...inner.slice(-LONG_BLOCK_TAIL_LINES),
    ...(closed ? [block.at(-1) ?? "```"] : []),
  ];
}
