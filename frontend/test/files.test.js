import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uploadPath,
  fileSelection,
  droppedFiles,
  fileSize,
} from "../src/lib/files.js";
import { oauthCallbackUrl } from "../src/lib/calendarOAuth.js";
test("folder uploads preserve relative paths and reject traversal", () => {
  assert.deepEqual(uploadPath("Fotos/2026/Urlaub.jpg"), [
    "Fotos",
    "2026",
    "Urlaub.jpg",
  ]);
  for (const path of [
    "../outside.txt",
    "/etc/passwd",
    "a\\b",
    "a//b",
    "bad:name",
  ])
    assert.throws(() => uploadPath(path));
  assert.equal(fileSize(1024 ** 3, "en-GB"), "1 GB");
  assert.equal(
    oauthCallbackUrl("google", "https://mail.example.org", "files"),
    "https://mail.example.org/api/files/oauth/google/callback",
  );
});
test("CTRL+SHIFT extends a selection and SHIFT supports reverse ranges", () => {
  const rows = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(
    [...fileSelection(rows, new Set(["d"]), "c", "a", true)],
    ["d", "a", "b", "c"],
  );
  assert.deepEqual(
    [...fileSelection(rows, new Set(["d"]), "b", "c", false)],
    ["b", "c"],
  );
});
test("dragged directories include empty folders and all readEntries batches", async () => {
  let batch = 0;
  const file = { name: "note.txt" },
    empty = {
      name: "empty",
      isDirectory: true,
      createReader: () => ({ readEntries: (done) => done([]) }),
    };
  const directory = {
    name: "Folder",
    isDirectory: true,
    createReader: () => ({
      readEntries: (done) =>
        done(
          batch++ === 0
            ? [{ name: "note.txt", isFile: true, file: (done) => done(file) }]
            : batch === 2
              ? [empty]
              : [],
        ),
    }),
  };
  const result = await droppedFiles({
    items: [{ kind: "file", webkitGetAsEntry: () => directory }],
  });
  assert.deepEqual(result.directories, ["Folder", "Folder/empty"]);
  assert.equal(result.files[0].path, "Folder/note.txt");
});
