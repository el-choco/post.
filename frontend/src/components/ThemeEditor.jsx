import { useTranslation } from "react-i18next";
import { Moon, Sun, RotateCcw, Mail, Check, Paintbrush } from "lucide-react";
import { useStore } from "../store";
import {
  appearanceDefaults,
  appearanceVariables,
  normalizeAppearance,
  fontFamilies,
  themePresets,
  contrastRatio,
  contrastText,
} from "../lib/appearance";

export default function ThemeEditor({ value, onChange }) {
  const { t } = useTranslation();
  const { darkMode, toggleDarkMode } = useStore();
  const theme = normalizeAppearance(value);
  const mode = darkMode ? "dark" : "light",
    palette = theme[mode];
  const setPalette = (next) => onChange({ ...theme, [mode]: next });
  const chooseMode = (dark) => {
    if (dark !== darkMode) toggleDarkMode();
  };
  return (
    <div className="theme-editor">
      <p className="muted">{t("theme.hint")}</p>
      <div className="theme-mode" role="group" aria-label={t("theme.mode")}>
        <button
          type="button"
          className={!darkMode ? "active" : ""}
          aria-pressed={!darkMode}
          onClick={() => chooseMode(false)}
        >
          <Sun size={16} />
          {t("light")}
        </button>
        <button
          type="button"
          className={darkMode ? "active" : ""}
          aria-pressed={darkMode}
          onClick={() => chooseMode(true)}
        >
          <Moon size={16} />
          {t("dark")}
        </button>
      </div>
      <h4>{t("theme.presets")}</h4>
      <div className="theme-presets">
        {Object.entries(themePresets).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            className="theme-preset"
            onClick={() => setPalette({ ...preset[mode] })}
            aria-label={t("theme.preset", { name: t(`theme.names.${key}`) })}
          >
            <span className="theme-preset-swatches" aria-hidden="true">
              {["accent", "background", "surface"].map((color) => (
                <i key={color} style={{ background: preset[mode][color] }} />
              ))}
            </span>
            {t(`theme.names.${key}`)}
          </button>
        ))}
      </div>
      <h4>{t("theme.colors")}</h4>
      <div className="theme-colors">
        {["accent", "background", "surface", "text"].map((key) => (
          <label className="theme-color" key={key}>
            <span>{t(`theme.${key}`)}</span>
            <div>
              <input
                type="color"
                value={palette[key]}
                onChange={(e) =>
                  setPalette({ ...palette, [key]: e.target.value })
                }
                aria-label={t(`theme.${key}`)}
              />
              <code>{palette[key].toUpperCase()}</code>
            </div>
          </label>
        ))}
      </div>
      {contrastRatio(palette.text, palette.surface) < 4.5 && (
        <div className="notice error theme-contrast" role="status">
          <span>{t("theme.contrast")}</span>
          <button
            type="button"
            className="primary"
            onClick={() =>
              setPalette({ ...palette, text: contrastText(palette.surface) })
            }
          >
            {t("theme.fixContrast")}
          </button>
        </div>
      )}
      <div className="theme-type">
        <label>
          {t("theme.font")}
          <select
            value={theme.font}
            onChange={(e) => onChange({ ...theme, font: e.target.value })}
          >
            {Object.keys(fontFamilies).map((font) => (
              <option key={font} value={font}>
                {t(`theme.fonts.${font}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("theme.fontSize")}
          <select
            value={theme.fontSize}
            onChange={(e) =>
              onChange({ ...theme, fontSize: Number(e.target.value) })
            }
          >
            {[14, 15, 16, 17, 18, 19, 20].map((size) => (
              <option key={size} value={size}>
                {size} px{size === 16 ? ` · ${t("theme.standard")}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <section
        className="theme-preview"
        style={appearanceVariables(theme, darkMode)}
        aria-label={t("theme.preview")}
      >
        <header>
          <span>
            <Mail size={18} />
            post.
          </span>
          <span className="theme-preview-chip">
            <Check size={14} />
            {t("theme.preview")}
          </span>
        </header>
        <div className="theme-preview-body">
          <aside>
            <span className="theme-preview-compose">
              <Paintbrush size={15} />
              {t("compose")}
            </span>
            <span>{t("inbox")}</span>
          </aside>
          <div>
            <strong>{t("theme.previewTitle")}</strong>
            <p>{t("theme.previewText")}</p>
            <span className="theme-preview-secondary">
              {t("theme.previewDetail")}
            </span>
          </div>
        </div>
      </section>
      <div className="theme-reset-row">
        <p className="muted">{t("theme.saveHint")}</p>
        <button
          type="button"
          className="primary"
          onClick={() => onChange(normalizeAppearance(appearanceDefaults))}
        >
          <RotateCcw size={16} />
          {t("theme.reset")}
        </button>
      </div>
    </div>
  );
}
