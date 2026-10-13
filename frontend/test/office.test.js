import { test } from "node:test";
import assert from "node:assert/strict";
import { officeFile } from "../src/lib/office.js";
test("office preview routes supported documents while preserving image/text and native Google previews", () => {
  for (const name of [
    "file.PDF",
    "file.docx",
    "file.xlsx",
    "file.pptx",
    "file.odt",
    "file.ods",
    "file.odp",
  ])
    assert.equal(officeFile({ name }), true);
  for (const item of [
    { name: "notes.txt" },
    { name: "file.pdf", folder: true },
    { name: "file.docx", native: true },
    { name: "photo.pdf", mime: "image/png" },
    { name: "script.docx", mime: "text/plain" },
    { name: "archive.zip" },
  ])
    assert.equal(officeFile(item), false);
});
