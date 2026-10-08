import test from "node:test";
import assert from "node:assert/strict";
globalThis.localStorage = {
  getItem: () => null,
  setItem() {},
  removeItem() {},
};
const { messageKey, selectRange } = await import("../src/api.js");
const rows = [
  { folder: "INBOX", uid: 1 },
  { folder: "Archive", uid: 1 },
  { folder: "INBOX", uid: 2 },
  { folder: "INBOX", uid: 3 },
];
test("equal UIDs in different folders are independent", () => {
  assert.notEqual(messageKey(rows[0]), messageKey(rows[1]));
});
test("shift range works in both directions and replaces selection", () => {
  const selected = selectRange(
    rows,
    new Set([messageKey(rows[3])]),
    messageKey(rows[2]),
    messageKey(rows[0]),
  );
  assert.deepEqual([...selected], rows.slice(0, 3).map(messageKey));
});
test("CTRL + SHIFT adds a range without losing previous selection", () => {
  const selected = selectRange(
    rows,
    new Set([messageKey(rows[3])]),
    messageKey(rows[0]),
    messageKey(rows[1]),
    true,
  );
  assert.equal(selected.size, 3);
  assert.ok(selected.has(messageKey(rows[3])));
});
test("stale range anchors safely select the clicked message", () => {
  assert.deepEqual(
    [...selectRange(rows, new Set(), "stale", messageKey(rows[1]))],
    [messageKey(rows[1])],
  );
});
