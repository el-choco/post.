import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appearanceDefaults,
  normalizeAppearance,
  appearanceVariables,
  applyAppearance,
  contrastRatio,
  contrastText,
  themePresets,
} from "../src/lib/appearance.js";

test("appearance defaults retain the existing light and dark palette", () => {
  assert.deepEqual(normalizeAppearance(null), appearanceDefaults);
  const light = appearanceVariables(null, false),
    dark = appearanceVariables(null, true);
  assert.equal(light["--bg"], "#c1d7f4");
  assert.equal(light["--line"], "#e4eaf3");
  assert.equal(dark["--bg"], "#111a28");
  assert.equal(dark["--tint"], "#263e60");
  assert.equal(light["--ui-font-scale"], "1");
});
test("appearance inputs accept bounded settings and reject injected styles or unknown fonts", () => {
  const value = normalizeAppearance({
    font: "georgia",
    fontSize: 20,
    light: { accent: "#AA00CC", background: "url(https://evil.test)" },
  });
  assert.equal(value.font, "georgia");
  assert.equal(value.light.accent, "#aa00cc");
  assert.equal(value.light.background, appearanceDefaults.light.background);
  assert.deepEqual(value.dark, appearanceDefaults.dark);
  for (const input of [
    null,
    [],
    "invalid",
    { font: "constructor", fontSize: 1000 },
    { fontSize: "20", light: { text: ["#ffffff"] } },
  ])
    assert.deepEqual(normalizeAppearance(input), appearanceDefaults);
  assert.equal(appearanceVariables(value, false)["--ui-font-scale"], "1.25");
});
test("applying and restoring a theme replaces every CSS variable without carrying custom colors over", () => {
  const properties = new Map();
  const root = {
    style: { setProperty: (key, value) => properties.set(key, value) },
  };
  applyAppearance(
    root,
    { ...appearanceDefaults, light: themePresets.mint.light },
    false,
  );
  assert.equal(properties.get("--accent"), themePresets.mint.light.accent);
  applyAppearance(root, null, false);
  assert.equal(properties.get("--accent"), appearanceDefaults.light.accent);
  assert.equal(properties.get("--sidebar"), "#f0f4fa");
  applyAppearance(root, null, true);
  assert.equal(properties.get("--surface"), appearanceDefaults.dark.surface);
});
test("contrast correction chooses readable text on accent colors and pale or dark surfaces", () => {
  assert.equal(contrastRatio("#ffffff", "#000000"), 21);
  for (const color of ["#ffffff", "#000000", "#777777", "#ff00ff", "#e2ddf4"])
    assert.ok(contrastRatio(color, contrastText(color)) >= 4.5);
});
test("saved themes are cached per account; previews, logout and account switches cannot leak them", async () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const { useStore } = await import("../src/store.js");
  useStore.getState().setUser({ id: 1, email: "a@example.test" });
  const custom = normalizeAppearance({
    font: "verdana",
    light: themePresets.rose.light,
  });
  useStore.getState().previewAppearance(custom);
  assert.deepEqual(useStore.getState().appearance, appearanceDefaults);
  useStore.getState().previewAppearance(null);
  assert.equal(useStore.getState().appearancePreview, null);
  useStore.getState().setAppearance(custom);
  useStore.getState().logout();
  assert.deepEqual(useStore.getState().appearance, appearanceDefaults);
  useStore.getState().setUser({ id: 2, email: "b@example.test" });
  assert.deepEqual(useStore.getState().appearance, appearanceDefaults);
  useStore.getState().setUser({ id: 1, email: "a@example.test" });
  assert.deepEqual(useStore.getState().appearance, custom);
  useStore.getState().setAppearance(null);
  assert.deepEqual(
    JSON.parse(values.get("post:appearance:a@example.test")),
    appearanceDefaults,
  );
});
