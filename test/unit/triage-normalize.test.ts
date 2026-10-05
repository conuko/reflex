import { describe, expect, it } from "vitest";

import { loadIssueCorpus } from "@/lib/issue-corpus";
import { issueToTicket, LONG_BLOCK_MAX_LINES, normalizeBody } from "@/lib/triage/normalize";

describe("issueToTicket", () => {
  it("makes the title the subject and the body one customer message", () => {
    expect(issueToTicket({ title: "  Export fails ", body: "It fails." })).toEqual({
      subject: "Export fails",
      messages: [{ from: "customer", text: "It fails." }],
    });
  });
});

describe("normalizeBody", () => {
  it("drops heading lines and keeps the text under them", () => {
    const body = "### What happened?\n\nThe export fails.\n\n## Workaround\nWe copy by hand.";

    expect(normalizeBody(body)).toBe("The export fails.\n\nWe copy by hand.");
  });

  it("keeps lines inside code blocks that look like headings", () => {
    const body = "Our script:\n\n```sh\n# set the key\nexport KEY=1\n```";

    expect(normalizeBody(body)).toBe(body);
  });

  it("keeps a hash that doesn't start a heading", () => {
    expect(normalizeBody("Ticket #42 is still open.\n#hashtag")).toBe(
      "Ticket #42 is still open.\n#hashtag",
    );
  });

  it("drops HTML comments, including multi-line ones", () => {
    expect(normalizeBody("Before<!-- one -->\n<!--\ntemplate\nhelp\n-->\nAfter")).toBe(
      "Before\n\nAfter",
    );
  });

  it("drops Markdown and HTML images", () => {
    expect(
      normalizeBody('See ![screenshot](https://x.test/a.png) and <img src="b.png" alt="b">.'),
    ).toBe("See  and .");
  });

  it("turns checkboxes into plain list items", () => {
    expect(normalizeBody("- [x] Searched issues\n- [ ] Read the docs\n  * [X] Nested")).toBe(
      "- Searched issues\n- Read the docs\n  * Nested",
    );
  });

  it("collapses a long code block to its first and last lines", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const text = normalizeBody(["```", ...lines, "```"].join("\n")).split("\n");

    expect(text).toEqual([
      "```",
      ...lines.slice(0, 10),
      "[... 15 lines omitted ...]",
      ...lines.slice(-5),
      "```",
    ]);
  });

  it("keeps a code block at the limit as it is", () => {
    const body = ["~~~", ...Array.from({ length: LONG_BLOCK_MAX_LINES }, () => "log"), "~~~"].join(
      "\n",
    );

    expect(normalizeBody(body)).toBe(body);
  });

  it("collapses an unclosed long code block too", () => {
    const body = ["```", ...Array.from({ length: 25 }, (_, i) => `l${i}`)].join("\n");

    expect(normalizeBody(body)).toContain("[... 10 lines omitted ...]");
  });

  it("collapses runs of blank lines, trailing spaces and line endings", () => {
    expect(normalizeBody("\r\n\r\nOne  \r\n\r\n\r\n\r\nTwo\r\n")).toBe("One\n\nTwo");
  });

  it("leaves no heading in any corpus issue", () => {
    const withHeadings = loadIssueCorpus().filter((issue) => {
      const [message] = issueToTicket(issue).messages;
      const outsideCode = (message?.text ?? "").replace(/```[\s\S]*?```/g, "");
      return /^ {0,3}#{1,6}\s/m.test(outsideCode);
    });

    expect(withHeadings.map(({ id }) => id)).toEqual([]);
  });
});
