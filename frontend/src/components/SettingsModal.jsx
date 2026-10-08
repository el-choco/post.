import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  UserRound,
  Folder,
  Check,
  Monitor,
  Mail,
  PenLine,
  Users,
  Server,
  Images,
  LoaderCircle,
} from "lucide-react";
import { api, post } from "../api";
import { useStore } from "../store";
import Dialog from "./Dialog";
import defaults from "../lib/preferences.json";
import { desktopNotification, playSound } from "../lib/notifications";
const sections = {
  interface: [
    ["language", ["de", "en"]],
    ["timezone", "timezone"],
    ["timeFormat", ["24", "12"]],
    ["dateFormat", ["dd.MM.yyyy", "yyyy-MM-dd", "MM/dd/yyyy", "dd/MM/yyyy"]],
    ["shortDate"],
    ["nextAfterAction"],
    ["refreshInterval", [0, 30, 60, 120, 300, 600]],
  ],
  mailbox: [
    ["layout", ["right", "bottom", "list"]],
    ["markReadDelay", [-1, 0, 2, 5, 10, 30]],
    ["pageSize", "number"],
    ["checkAllFolders"],
    ["browserNotifications"],
    ["desktopNotifications"],
    ["soundNotifications"],
    ["notificationDuration", [0, 5, 10, 30]],
  ],
  display: [
    ["messageNewWindow"],
    ["showEmailAddress"],
    ["showHtml"],
    ["externalImages", ["ask", "always", "never"]],
    ["sendReceipts", ["ask", "never"]],
    ["inlineAttachments"],
    ["displayEmoticons"],
    ["collapseQuotes", "number"],
  ],
  compose: [
    ["composeNewWindow"],
    ["composeHtml", ["never", "always", "reply"]],
    ["draftInterval", [0, 30, 60, 120, 300]],
    ["requestMdn"],
    ["requestDsn"],
    ["replySameFolder"],
    ["replyPosition", ["above", "below"]],
    ["forwardMode", ["inline", "attachment"]],
    ["htmlFont", ["Arial", "Georgia", "Verdana", "Courier New"]],
    ["htmlFontSize", [10, 12, 14, 16, 18, 20]],
    ["replyAllDefault", ["all", "sender"]],
    ["composeEmoticons"],
    ["autoLinks"],
    ["keepFormatting"],
    ["signatureMode", ["always", "new", "reply", "never"]],
    ["signatureBelowQuote"],
    ["stripOriginalSignature"],
    ["signatureSeparator"],
    ["spellcheckBeforeSend"],
    ["spellcheckSkipSymbols"],
    ["spellcheckSkipDigits"],
  ],
  contacts: [
    ["defaultAddressBook", "book"],
    ["contactDisplay", ["display", "firstLast", "lastFirst"]],
    ["contactSort", ["first", "last", "display"]],
    ["contactPageSize", "number"],
    ["contactFormMode", ["home", "work"]],
    ["autocompletePrimaryOnly"],
    ["collectRecipientsBook", "book"],
    ["trustedSendersBook", "book"],
  ],
  special: [
    ["realFolderNames"],
    ["draftsFolder", "folder"],
    ["sentFolder", "folder"],
    ["spamFolder", "folder"],
    ["trashFolder", "folder"],
    ["archiveFolder", "folder"],
    [
      "archiveStructure",
      [
        "none",
        "year",
        "month",
        "thunderbird",
        "sender",
        "folder",
        "yearFolder",
        "monthFolder",
      ],
    ],
  ],
  server: [
    ["readOnDelete"],
    ["flagDeleted"],
    ["hideDeleted"],
    ["deleteSpamDirectly"],
    ["readOnArchive"],
    ["emptyTrashOnLogout", ["never", "all", "30", "60", "90"]],
    ["expungeInboxOnLogout"],
  ],
};
const icons = {
  interface: Monitor,
  mailbox: Mail,
  display: Images,
  compose: PenLine,
  contacts: Users,
  special: Folder,
  server: Server,
  visibleFolders: Folder,
  identity: UserRound,
};
export default function SettingsModal({ onClose, folders, initial, onSaved }) {
  const { t, i18n } = useTranslation();
  const { user } = useStore();
  const [settings, setSettings] = useState({ ...defaults, ...initial }),
    [tab, setTab] = useState("interface"),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [books, setBooks] = useState([]),
    [testNotice, setTestNotice] = useState("");
  useEffect(() => {
    if (user.demo) {
      let data = [];
      try {
        data = JSON.parse(localStorage.getItem("demoAddressBooks"))?.books || [
          { id: 1, name: "Persönlich", isDefault: 1 },
        ];
      } catch {}
      const timer = setTimeout(() => setBooks(data), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    api("/address-books")
      .then((data) => {
        if (!cancelled) setBooks(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [user.demo]);
  const update = async (key, value) => {
    if (key === "desktopNotifications" && value) {
      const granted = await desktopNotification(
        "post.",
        t("prefs.notificationTest"),
        settings.notificationDuration,
        true,
      );
      if (!granted) {
        setTestNotice(t("prefs.notificationDenied"));
        return;
      }
    }
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const optionLabel = (key, value) => {
    if (key === "signatureMode" && value === "reply")
      return t("prefs.signatureReplies");
    if (key === "language") return value === "de" ? "Deutsch" : "English";
    if (key === "layout") return t(`layout_${value}`);
    if (["htmlFont", "dateFormat"].includes(key)) return value;
    if (key === "htmlFontSize") return value + " px";
    if (key === "timeFormat") return value === "24" ? "07:30" : "7:30 AM";
    if (["refreshInterval", "draftInterval"].includes(key))
      return value === 0
        ? t("prefs.off")
        : t("prefs.seconds", { count: value });
    if (key === "markReadDelay")
      return value === -1
        ? t("prefs.never")
        : value === 0
          ? t("prefs.immediate")
          : t("prefs.afterSeconds", { count: value });
    if (key === "notificationDuration")
      return value === 0
        ? t("prefs.manualClose")
        : t("prefs.afterSeconds", { count: value });
    if (key === "emptyTrashOnLogout")
      return ["never", "all"].includes(value)
        ? t("prefs." + value)
        : t("prefs.olderDays", { count: value });
    if (key === "archiveStructure" && value === "sender")
      return t("prefs.options.senderArchive");
    return t("prefs.options." + value);
  };
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const saved = user.demo
        ? settings
        : await post("/settings", settings, "PUT");
      await i18n.changeLanguage(saved.language);
      await onSaved(saved);
      onClose();
    } catch (e) {
      setError(t(e.message));
    } finally {
      setSaving(false);
    }
  }
  async function test(key) {
    if (key === "soundNotifications") playSound();
    else if (key === "desktopNotifications") {
      if (
        !(await desktopNotification(
          "post.",
          t("prefs.notificationTest"),
          settings.notificationDuration,
          true,
        ))
      ) {
        setTestNotice(t("prefs.notificationDenied"));
        return;
      }
    }
    setTestNotice(t("prefs.notificationTest"));
  }
  function field([key, type]) {
    const check = type === undefined;
    const values = Array.isArray(type)
      ? type
      : type === "timezone"
        ? [
            ...new Set([
              "Europe/Berlin",
              "UTC",
              settings.timezone,
              ...(Intl.supportedValuesOf?.("timeZone") || []),
            ]),
          ]
        : type === "folder"
          ? folders.filter((f) => f.selectable !== false).map((f) => f.path)
          : type === "book"
            ? books.map((b) => String(b.id))
            : [];
    return (
      <div className={`preference-row ${check ? "is-toggle" : ""}`} key={key}>
        <label htmlFor={"pref-" + key}>{t("prefs." + key)}</label>
        <div className="preference-control">
          {check ? (
            <input
              id={"pref-" + key}
              type="checkbox"
              role="switch"
              checked={settings[key]}
              onChange={(e) => update(key, e.target.checked)}
            />
          ) : type === "number" ? (
            <input
              id={"pref-" + key}
              type="number"
              min={key === "collapseQuotes" ? 0 : 5}
              max={key === "collapseQuotes" ? 10000 : 200}
              value={settings[key]}
              onChange={(e) => update(key, Number(e.target.value))}
              required
            />
          ) : (
            <select
              id={"pref-" + key}
              value={settings[key]}
              onChange={(e) =>
                update(
                  key,
                  typeof defaults[key] === "number"
                    ? Number(e.target.value)
                    : e.target.value,
                )
              }
            >
              {["folder", "book"].includes(type) && (
                <option value="">
                  {t(
                    type === "folder"
                      ? "prefs.autoFolder"
                      : key === "defaultAddressBook"
                        ? "personalBook"
                        : "prefs.off",
                  )}
                </option>
              )}
              {values.map((value) => (
                <option key={value} value={value}>
                  {type === "folder" || type === "timezone"
                    ? value
                    : type === "book"
                      ? books.find((b) => String(b.id) === value)?.isDefault
                        ? t("personalBook")
                        : books.find((b) => String(b.id) === value)?.name
                      : optionLabel(key, value)}
                </option>
              ))}
            </select>
          )}
          {[
            "browserNotifications",
            "desktopNotifications",
            "soundNotifications",
          ].includes(key) && (
            <button
              type="button"
              className="text-button"
              onClick={() => test(key)}
            >
              {t("prefs.test")}
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <Dialog title={t("settings")} onClose={onClose} wide>
      <form onSubmit={save} className="preferences-form">
        <div className="settings-content">
          <aside className="settings-nav">
            <p>{t("settingsHint")}</p>
            {Object.entries(icons).map(([key, Icon]) => (
              <button
                type="button"
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => {
                  setTab(key);
                  setTestNotice("");
                }}
              >
                <Icon size={17} />
                {t(
                  ["identity", "visibleFolders"].includes(key)
                    ? key
                    : "prefs.tabs." + key,
                )}
              </button>
            ))}
          </aside>
          <div className="settings-fields">
            <span className="eyebrow">post. · {t("settings")}</span>
            <h3>
              {t(
                ["identity", "visibleFolders"].includes(tab)
                  ? tab
                  : "prefs.tabs." + tab,
              )}
            </h3>
            {sections[tab]?.map(field)}
            {tab === "display" && (
              <p className="muted preference-hint">{t("prefs.imagesHint")}</p>
            )}
            {tab === "compose" && (
              <p className="muted preference-hint">{t("prefs.composeHint")}</p>
            )}
            {tab === "server" && (
              <p className="muted preference-hint">
                {t("prefs.maintenanceHint")}
              </p>
            )}
            {tab === "visibleFolders" && (
              <>
                <p className="muted">{t("folderHelp")}</p>
                <div className="folder-settings">
                  {folders.map((folder) => (
                    <label key={folder.path}>
                      <Folder size={17} />
                      <span>{folder.path}</span>
                      <input
                        type="checkbox"
                        checked={!settings.hiddenFolders.includes(folder.path)}
                        onChange={() =>
                          update(
                            "hiddenFolders",
                            settings.hiddenFolders.includes(folder.path)
                              ? settings.hiddenFolders.filter(
                                  (path) => path !== folder.path,
                                )
                              : [...settings.hiddenFolders, folder.path],
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
              </>
            )}
            {tab === "identity" && (
              <>
                {["name", "replyTo", "signature"].map((key) => (
                  <label key={key}>
                    {t(key === "name" ? "displayName" : key)}
                    {key === "signature" ? (
                      <textarea
                        rows="7"
                        value={settings[key]}
                        onChange={(e) => update(key, e.target.value)}
                      />
                    ) : (
                      <input
                        type={key === "replyTo" ? "email" : "text"}
                        value={settings[key]}
                        onChange={(e) => update(key, e.target.value)}
                      />
                    )}
                  </label>
                ))}
              </>
            )}
            {testNotice && (
              <p className="notice" role="status">
                {testNotice}
              </p>
            )}
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        <footer className="dialog-footer">
          <button type="button" className="secondary" onClick={onClose}>
            {t("cancel")}
          </button>
          <button className="primary" disabled={saving}>
            {saving ? (
              <LoaderCircle className="spinner" size={17} />
            ) : (
              <Check size={17} />
            )}{" "}
            {t(saving ? "saving" : "save")}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
