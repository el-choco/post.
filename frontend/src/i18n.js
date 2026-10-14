import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import de from "./locales/de.json";
import en from "./locales/en.json";
import featuresDe from "./locales/features.de.json";
import featuresEn from "./locales/features.en.json";
import calendarDe from "./locales/calendar.de.json";
import calendarEn from "./locales/calendar.en.json";
import filesDe from "./locales/files.de.json";
import filesEn from "./locales/files.en.json";
import officeDe from "./locales/office.de.json";
import officeEn from "./locales/office.en.json";
import themeDe from "./locales/theme.de.json";
import themeEn from "./locales/theme.en.json";
i18n.use(initReactI18next).init({
  resources: {
    de: {
      translation: {
        ...de,
        ...featuresDe,
        calendar: calendarDe,
        files: filesDe,
        office: officeDe,
        theme: themeDe,
      },
    },
    en: {
      translation: {
        ...en,
        ...featuresEn,
        calendar: calendarEn,
        files: filesEn,
        office: officeEn,
        theme: themeEn,
      },
    },
  },
  lng: localStorage.getItem("language") || "de",
  fallbackLng: "de",
  interpolation: { escapeValue: false },
});
i18n.on("languageChanged", (language) =>
  localStorage.setItem("language", language),
);
export default i18n;
