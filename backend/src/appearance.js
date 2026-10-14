const defaults = require("./preferences.json").appearance;
const fonts = ["system", "arial", "verdana", "georgia", "mono"];
function normalizeAppearance(value, current = defaults) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const base = current && typeof current === "object" ? current : defaults;
  const result = {
    font: fonts.includes(input.font)
      ? input.font
      : fonts.includes(base.font)
        ? base.font
        : defaults.font,
    fontSize:
      Number.isInteger(input.fontSize) &&
      input.fontSize >= 14 &&
      input.fontSize <= 20
        ? input.fontSize
        : Number.isInteger(base.fontSize) &&
            base.fontSize >= 14 &&
            base.fontSize <= 20
          ? base.fontSize
          : defaults.fontSize,
  };
  for (const mode of ["light", "dark"]) {
    result[mode] = {};
    for (const key of ["accent", "background", "surface", "text"]) {
      const color = input[mode]?.[key];
      const fallback = base[mode]?.[key];
      result[mode][key] =
        typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
          ? color.toLowerCase()
          : typeof fallback === "string" && /^#[0-9a-f]{6}$/i.test(fallback)
            ? fallback.toLowerCase()
            : defaults[mode][key];
    }
  }
  return result;
}
module.exports = { normalizeAppearance };
