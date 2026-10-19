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
import mailErrorsDe from "./locales/mailErrors.de.json";
import mailErrorsEn from "./locales/mailErrors.en.json";
import diagnosticsDe from "./locales/diagnostics.de.json";
import diagnosticsEn from "./locales/diagnostics.en.json";
import attachmentSaveDe from "./locales/attachmentSave.de.json";
import attachmentSaveEn from "./locales/attachmentSave.en.json";
import identityDe from "./locales/identity.de.json";
import identityEn from "./locales/identity.en.json";
i18n.use(initReactI18next).init({
  resources: {
    de: {
      translation: {
        ...de,
        multiuser: identityDe,
        ...featuresDe,
        ...mailErrorsDe,
        calendar: calendarDe,
        files: filesDe,
        office: officeDe,
        theme: themeDe,
        diagnostics: diagnosticsDe,
        attachmentSave: attachmentSaveDe,
      },
    },
    en: {
      translation: {
        ...en,
        multiuser: identityEn,
        ...featuresEn,
        ...mailErrorsEn,
        calendar: calendarEn,
        files: filesEn,
        office: officeEn,
        theme: themeEn,
        diagnostics: diagnosticsEn,
        attachmentSave: attachmentSaveEn,
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
