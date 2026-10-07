import type { TriagePriority } from "@/lib/priorities";

// The inbox's keys (plan M5) as a pure function of the inbox state and one
// key press, with no React, so every binding is unit-tested:
//
//   j / k (or ↓ / ↑)  next / previous ticket
//   Enter             open the selected ticket
//   Esc               close the open ticket
//   1 to 5            Urgent, High, Medium, Low, Won't do
//   a                 accept the suggested triage
//   ⌘K or Ctrl+K      open or close the command palette
//
// While typing in a field, or while the palette is open, only ⌘K counts.

export type KeymapState = {
  rowIds: readonly string[];
  selectedId: string | null;
  panelOpen: boolean;
  paletteOpen: boolean;
};

export type KeyPress = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export type InboxAction =
  | { type: "select"; id: string }
  | { type: "open"; id: string }
  | { type: "close" }
  | { type: "setPriority"; id: string; priority: TriagePriority }
  | { type: "accept"; id: string }
  | { type: "togglePalette" }
  | { type: "none" };

export const PRIORITY_BY_KEY: Readonly<Record<string, TriagePriority>> = {
  "1": "urgent",
  "2": "high",
  "3": "medium",
  "4": "low",
  "5": "wont_do",
};

const NONE: InboxAction = { type: "none" };

export function keymap(state: KeymapState, press: KeyPress, focusedInInput: boolean): InboxAction {
  const { metaKey = false, ctrlKey = false, altKey = false, shiftKey = false } = press;
  if ((metaKey || ctrlKey) && !altKey && !shiftKey && press.key.toLowerCase() === "k") {
    return { type: "togglePalette" };
  }
  if (focusedInInput || state.paletteOpen || metaKey || ctrlKey || altKey) return NONE;

  const { rowIds, selectedId } = state;
  const index = selectedId === null ? -1 : rowIds.indexOf(selectedId);
  const selected = index === -1 ? null : selectedId;
  const select = (at: number): InboxAction => {
    const id = rowIds[Math.min(Math.max(at, 0), rowIds.length - 1)];
    return id === undefined ? NONE : { type: "select", id };
  };

  switch (press.key) {
    case "j":
    case "ArrowDown":
      return select(index + 1);
    case "k":
    case "ArrowUp":
      return select(index === -1 ? 0 : index - 1);
    case "Enter":
      return selected === null ? NONE : { type: "open", id: selected };
    case "Escape":
      return state.panelOpen ? { type: "close" } : NONE;
    case "a":
      return selected === null ? NONE : { type: "accept", id: selected };
    default: {
      const priority = PRIORITY_BY_KEY[press.key];
      return priority && selected !== null ? { type: "setPriority", id: selected, priority } : NONE;
    }
  }
}

/** Whether the key event comes from a field the user types in. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
