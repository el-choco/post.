import preferences from "./preferences.json" with { type: "json" };
export const appearanceDefaults = preferences.appearance;
export const fontFamilies = {
  system: 'Inter, "Segoe UI", Arial, sans-serif',
  arial: "Arial, Helvetica, sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  georgia: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Code", Consolas, "Courier New", monospace',
};
export function normalizeAppearance(value, current = appearanceDefaults) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const base =
    current && typeof current === "object" ? current : appearanceDefaults;
  const fonts = Object.keys(fontFamilies);
  const result = {
    font: fonts.includes(input.font)
      ? input.font
      : fonts.includes(base.font)
        ? base.font
        : appearanceDefaults.font,
    fontSize:
      Number.isInteger(input.fontSize) &&
      input.fontSize >= 14 &&
      input.fontSize <= 20
        ? input.fontSize
        : Number.isInteger(base.fontSize) &&
            base.fontSize >= 14 &&
            base.fontSize <= 20
          ? base.fontSize
          : appearanceDefaults.fontSize,
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
            : appearanceDefaults[mode][key];
    }
  }
  return result;
}
function luminance(color) {
  return color
    .slice(1)
    .match(/../g)
    .map((value) => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    })
    .reduce(
      (total, channel, i) => total + channel * [0.2126, 0.7152, 0.0722][i],
      0,
    );
}
export function contrastRatio(first, second) {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function contrastText(background) {
  return contrastRatio(background, "#ffffff") >=
    contrastRatio(background, "#000000")
    ? "#ffffff"
    : "#000000";
}
export function appearanceVariables(value, dark) {
  const theme = normalizeAppearance(value);
  const mode = dark ? "dark" : "light",
    palette = theme[mode];
  const baseline =
    JSON.stringify(palette) === JSON.stringify(appearanceDefaults[mode]);
  const mix = (a, b, percent) => `color-mix(in srgb, ${a} ${percent}%, ${b})`;
  return {
    "--ui-font-family": fontFamilies[theme.font],
    "--ui-font-scale": String(theme.fontSize / 16),
    "--ui-font-size": `${theme.fontSize}px`,
    "--bg": palette.background,
    "--surface": palette.surface,
    "--text": palette.text,
    "--accent": palette.accent,
    "--accent-hover": baseline
      ? dark
        ? "#a3c7fa"
        : "#2560b6"
      : mix(palette.accent, dark ? "#ffffff" : "#000000", 82),
    "--surface-soft": baseline
      ? dark
        ? "#1d2b41"
        : "#f8fafd"
      : mix(palette.surface, palette.background, 88),
    "--sidebar": baseline
      ? dark
        ? "#152034"
        : "#f0f4fa"
      : mix(palette.surface, palette.background, 75),
    "--muted": baseline
      ? dark
        ? "#97a9c4"
        : "#8090a7"
      : mix(palette.text, palette.surface, 65),
    "--line": baseline
      ? dark
        ? "#2b3c56"
        : "#e4eaf3"
      : mix(palette.text, palette.surface, 16),
    "--tint": baseline
      ? dark
        ? "#263e60"
        : "#e9f1fd"
      : mix(palette.accent, palette.surface, dark ? 20 : 10),
    "--on-accent": baseline ? palette.surface : contrastText(palette.accent),
  };
}
export function applyAppearance(root, value, dark) {
  for (const [key, color] of Object.entries(appearanceVariables(value, dark)))
    root.style.setProperty(key, color);
}
export const themePresets = {
  blue: { light: appearanceDefaults.light, dark: appearanceDefaults.dark },
  violet: {
    light: {
      accent: "#7452bd",
      background: "#e5dcf5",
      surface: "#ffffff",
      text: "#39314b",
    },
    dark: {
      accent: "#bb9bf1",
      background: "#1c1528",
      surface: "#282037",
      text: "#eee7f8",
    },
  },
  mint: {
    light: {
      accent: "#247964",
      background: "#cfe9df",
      surface: "#ffffff",
      text: "#263f36",
    },
    dark: {
      accent: "#7dd4b5",
      background: "#111f1b",
      surface: "#1b2e27",
      text: "#e1f2eb",
    },
  },
  rose: {
    light: {
      accent: "#b34f70",
      background: "#f1dce4",
      surface: "#fffdfd",
      text: "#4d303a",
    },
    dark: {
      accent: "#ef9ebb",
      background: "#25151d",
      surface: "#35212b",
      text: "#f7e6ec",
    },
  },
};
