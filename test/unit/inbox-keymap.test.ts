import { describe, expect, it } from "vitest";

import type { KeymapState, KeyPress } from "@/components/inbox/keymap";

import { keymap } from "@/components/inbox/keymap";

const rows = ["t1", "t2", "t3"];

const state = (overrides: Partial<KeymapState> = {}): KeymapState => ({
  rowIds: rows,
  selectedId: "t2",
  panelOpen: false,
  paletteOpen: false,
  ...overrides,
});

const press = (key: string, modifiers: Omit<KeyPress, "key"> = {}): KeyPress => ({
  key,
  ...modifiers,
});

describe("the inbox keymap", () => {
  it("moves the selection with j and k, and stops at either end", () => {
    expect(keymap(state(), press("j"), false)).toEqual({ type: "select", id: "t3" });
    expect(keymap(state(), press("k"), false)).toEqual({ type: "select", id: "t1" });
    expect(keymap(state({ selectedId: "t3" }), press("j"), false)).toEqual({
      type: "select",
      id: "t3",
    });
    expect(keymap(state({ selectedId: "t1" }), press("k"), false)).toEqual({
      type: "select",
      id: "t1",
    });
  });

  it("starts at the first ticket when nothing (or a hidden ticket) is selected", () => {
    expect(keymap(state({ selectedId: null }), press("j"), false)).toEqual({
      type: "select",
      id: "t1",
    });
    expect(keymap(state({ selectedId: null }), press("k"), false)).toEqual({
      type: "select",
      id: "t1",
    });
    expect(keymap(state({ selectedId: "gone" }), press("j"), false)).toEqual({
      type: "select",
      id: "t1",
    });
  });

  it("moves with the arrow keys too", () => {
    expect(keymap(state(), press("ArrowDown"), false)).toEqual({ type: "select", id: "t3" });
    expect(keymap(state(), press("ArrowUp"), false)).toEqual({ type: "select", id: "t1" });
  });

  it("does nothing on an empty list", () => {
    expect(keymap(state({ rowIds: [], selectedId: null }), press("j"), false)).toEqual({
      type: "none",
    });
  });

  it("opens the selected ticket with Enter and closes it with Esc", () => {
    expect(keymap(state(), press("Enter"), false)).toEqual({ type: "open", id: "t2" });
    expect(keymap(state({ selectedId: null }), press("Enter"), false)).toEqual({ type: "none" });
    expect(keymap(state({ panelOpen: true }), press("Escape"), false)).toEqual({ type: "close" });
    expect(keymap(state(), press("Escape"), false)).toEqual({ type: "none" });
  });

  it("sets Urgent, High, Medium, Low and Won't do with 1 to 5", () => {
    const priorities = ["1", "2", "3", "4", "5"].map((key) => keymap(state(), press(key), false));

    expect(priorities).toEqual([
      { type: "setPriority", id: "t2", priority: "urgent" },
      { type: "setPriority", id: "t2", priority: "high" },
      { type: "setPriority", id: "t2", priority: "medium" },
      { type: "setPriority", id: "t2", priority: "low" },
      { type: "setPriority", id: "t2", priority: "wont_do" },
    ]);
    expect(keymap(state(), press("6"), false)).toEqual({ type: "none" });
    expect(keymap(state({ selectedId: null }), press("2"), false)).toEqual({ type: "none" });
  });

  it("accepts the selected ticket's triage with a", () => {
    expect(keymap(state(), press("a"), false)).toEqual({ type: "accept", id: "t2" });
    expect(keymap(state({ selectedId: null }), press("a"), false)).toEqual({ type: "none" });
  });

  it("toggles the palette with ⌘K or Ctrl+K, even while typing or with the palette open", () => {
    const toggle = { type: "togglePalette" };

    expect(keymap(state(), press("k", { metaKey: true }), false)).toEqual(toggle);
    expect(keymap(state(), press("k", { ctrlKey: true }), false)).toEqual(toggle);
    expect(keymap(state(), press("K", { metaKey: true }), true)).toEqual(toggle);
    expect(keymap(state({ paletteOpen: true }), press("k", { metaKey: true }), false)).toEqual(
      toggle,
    );
    expect(keymap(state(), press("k", { metaKey: true, shiftKey: true }), false)).toEqual({
      type: "none",
    });
  });

  it("ignores every other key while typing in a field", () => {
    for (const key of ["j", "k", "Enter", "Escape", "1", "5", "a", "ArrowDown"]) {
      expect(keymap(state({ panelOpen: true }), press(key), true)).toEqual({ type: "none" });
    }
  });

  it("leaves keys to the palette while it's open", () => {
    for (const key of ["j", "k", "Enter", "Escape", "2", "a"]) {
      expect(keymap(state({ paletteOpen: true }), press(key), false)).toEqual({ type: "none" });
    }
  });

  it("ignores keys with Ctrl, ⌘ or Alt, and capital letters", () => {
    expect(keymap(state(), press("j", { ctrlKey: true }), false)).toEqual({ type: "none" });
    expect(keymap(state(), press("2", { metaKey: true }), false)).toEqual({ type: "none" });
    expect(keymap(state(), press("a", { altKey: true }), false)).toEqual({ type: "none" });
    expect(keymap(state(), press("J", { shiftKey: true }), false)).toEqual({ type: "none" });
  });
});
