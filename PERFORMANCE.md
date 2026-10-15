# ⚡ Mailabruf / Mail loading — 1.5.2

## Deutsch

### Diagnoseprotokoll ab 1.5.2

**Einstellungen → Diagnose** zeigt die letzten 200 passenden Einträge; der JSON-Download enthält bis zu 1000 gespeicherte Einträge des angemeldeten Postfachs. Filter: alle Abrufe, Fehler oder mindestens drei Sekunden. Die Fehlermeldung bietet außerdem einen direkten Einstieg über **Diagnose öffnen**.

Gespeichert werden Zeitpunkt, Webmail-Version, API-Pfad ohne Parameter, Status, Anfrage-ID, Fehlercode und Schrittzeiten. Dazu gehören Warten auf einen laufenden Cache-Abruf, Verbindungswarteschlange, Verbindungsaufbau einschließlich Anmeldung, Ordnerfreigabe, Statusabfrage, Liste, Suche, Mailabruf und Aufbereitung. Beim Timeout noch laufende Schritte sind gekennzeichnet. Schritte können ineinander liegen; ihre Zeiten nicht addieren. Eine Antwort aus dem Cache benötigt keine IMAP-Schritte.

Die neue SQLite-Tabelle wird beim Start automatisch angelegt. Die Ansicht schließt Einträge ab sieben Tagen aus; die Bereinigung läuft beim Start, beim Schreiben und stündlich. Pro Postfach werden höchstens 1000 Einträge behalten. Es werden keine Passwörter, Tokens, Mail-Adressen, Mail-Inhalte, Betreffzeilen, Suchbegriffe oder Ordnernamen übernommen. Die Tabelle enthält lediglich die interne Postfachzuordnung. Der Export ist mit der bestehenden Anmeldung geschützt und enthält nur eigene Einträge. Es gibt keinen automatischen externen Versand.

Browserseitige Mailfehler werden ohne Rohfehlermeldung an das eigene Backend gemeldet. Damit können auch Proxy-Fehler sichtbar werden. Bei vollständig unerreichbarem Backend kann diese Meldung nicht gespeichert werden; dann helfen die weiterhin sichtbaren Fehlerdetails und die Proxy-Logs. Browser- und Servereintrag können dieselbe Anfrage-ID haben und denselben Fehler aus zwei Perspektiven zeigen. Das Protokoll beginnt erst nach dem Update; frühere Fehler lassen sich damit nicht nachträglich erfassen.

### Mailabruf


Der direkte Mailabruf und Hintergrundprüfungen verwenden getrennte IMAP-Verbindungen. Pro Postfach und Backend-Prozess werden höchstens zwei wiederverwendbare Verbindungen gehalten; Befehle auf derselben Verbindung laufen weiterhin nacheinander.

Die normale Mail-Liste lädt nur die benötigte Seite über Nachrichtennummern. Sie ermittelt nicht mehr zuerst sämtliche Nachrichten-IDs des Ordners. Bei Filtern wie „ungelesen“ oder ausgeblendeten gelöschten Nachrichten bleibt eine Suche notwendig. Die Ordnerliste lädt die Ordnerstruktur ohne zusätzliche Statusabfrage für jeden Ordner.

Bei deaktiviertem **Alle Ordner auf neue Nachrichten prüfen** prüft die Hintergrundabfrage nur den Posteingang. Zähler anderer Ordner werden beim Öffnen aktualisiert. Sie werden nicht mehr bei jedem Laden der Ordnerleiste vollständig abgefragt. Eine unveränderte Hintergrundprüfung lädt die Mail-Liste nicht erneut. Bei Anbietern ohne Änderungskennung werden die Listen spätestens nach zwei Minuten bei einer erfolgreichen Hintergrundprüfung aufgefrischt.

Mail-Metadaten werden kurzzeitig im Arbeitsspeicher zwischengespeichert. Die vorhandene SQLite-Datenbank speichert Einstellungen, Kontakte und andere Anwendungsdaten; dieses Update fügt keinen dauerhaften Speicher für Mail-Inhalte hinzu. Große Nachrichten laden weiterhin ihren vollständigen MIME-Inhalt einschließlich Anhängen. Langsame Anbieter, Netzwerkprobleme und große Anhänge können den Abruf deshalb weiterhin verzögern.

Direkte IMAP-Leseaufträge für Listen und Nachrichten haben ein Zeitbudget von 30 Sekunden einschließlich Wartezeit in der Verbindungswarteschlange. Hintergrundaufträge haben 60 Sekunden. Das Frontend begrenzt Mail-Leseanfragen zusätzlich. Ein Abbruch beim Wechsel einer geöffneten Nachricht gibt deren aktive Leseverbindung frei. Senden, Verschieben und andere Schreibaktionen werden nicht automatisch wiederholt und erhalten durch dieses Update keine neue Lese-Zeitgrenze.

### Fehler nachvollziehen

Ein Mailfehler bleibt sichtbar, bis du ihn schließt. **Fehlerdetails anzeigen** enthält Zeitpunkt, API-Pfad, HTTP-Status und – falls vom Server geliefert – eine Anfrage-ID. HTML-Fehlerseiten eines Proxys führen zu einer verständlichen Meldung statt zu „Unexpected token“.

Ab drei Sekunden Antwortzeit schreibt das Backend für Mail-API-Aufrufe eine Zeile mit `event: "slow_mail_api"`, `durationMs`, Status und Anfrage-ID. Der Eintrag enthält keine Suchbegriffe, Ordnernamen, Betreffzeilen oder Mail-Inhalte. Beispiel für den vorhandenen Portainer-Stack:

```bash
docker logs --since=10m post-webmail-backend-1
```

Für weitere Diagnose Fehlerdetails und passende Logzeile aufheben. Die Tests verwenden simulierte IMAP-Server und lokale API-Aufrufe; die tatsächliche Geschwindigkeit beim Anbieter muss nach dem Update auf dem eigenen Server geprüft werden.

## English

### Diagnostic log since 1.5.2

**Settings → Diagnostics** shows the latest 200 matching entries. The JSON export includes up to 1000 stored entries for the signed-in mailbox. Filter all requests, errors, or requests taking at least three seconds. Mail error banners also offer an **Open diagnostics** shortcut.

Entries contain time, app version, fixed API path without parameters, status, request ID, allowlisted error code and phase timings. Phases cover cache waits, the connection queue, connection/sign-in, folder locks, status, listing, search, message fetching and parsing. Nested phases overlap and should not be added together. In-progress phases are marked at timeout; cache hits may have no IMAP phases.

The SQLite table is created automatically at startup. The view excludes entries older than seven days; cleanup runs at startup, on writes and hourly. Each mailbox retains at most 1000 entries. Passwords, tokens, email addresses, message contents, subjects, search terms and folder names are excluded. Only the internal mailbox association is stored. Viewing/exporting requires the existing session and is account-scoped. There is no automatic external transmission.

Browser mail errors are reported to your own backend without raw error messages, which can capture proxy failures as well. A fully unreachable backend cannot store those reports; use the on-screen details and proxy logs in that case. Server and browser entries may describe the same error with a shared request ID. Recording begins after the update, without retrospective entries.

### Mail loading


Interactive mail requests and background checks use separate reusable IMAP connections, with at most two connections per mailbox and backend process. Commands on each connection remain sequential.

Unfiltered mail lists fetch only the requested page by sequence number instead of searching every message UID first. Read/unread and deleted-message filters still require a search. The folder tree loads names without requesting every folder's status. With **Check all folders for new messages** disabled, background polling checks only INBOX; other counters update when those folders are opened. Unchanged polling does not reload the list. Providers without a change revision receive a fallback list refresh after two minutes during a successful background check.

Metadata caches are short-lived and held in memory. SQLite continues to store application data, settings and contacts; this update does not persist message bodies. Opening a message still downloads the complete MIME content, including attachments. Large messages and provider or network delays can therefore still slow down loading.

Interactive IMAP list/message reads have a 30-second budget including queue time; background reads have 60 seconds. The browser also limits mail read requests. Cancelling an active message read releases its connection. Sending and other writes are not automatically replayed or given the new read deadline.

Mail errors remain visible until dismissed. **Show error details** displays the time, API path, HTTP status and request ID when available. Invalid JSON or HTML proxy errors produce a readable message instead of a JSON syntax error. Mail API responses taking at least three seconds produce a `slow_mail_api` backend log entry with duration, status and request ID, without query strings or mail contents. Use the command above for the existing Portainer stack. Tests use simulated IMAP and local API calls; verify actual provider performance after deploying.
