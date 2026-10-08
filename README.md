# 📬 post. — a calmer inbox

🐳 **Docker** · 🗄️ **SQLite** · 🌗 **Light & Dark Mode** · 🇩🇪 **Deutsch** · 🇬🇧 **English**

[🇩🇪 Deutsche Anleitung](#deutsch) · [🇬🇧 English documentation](#english)

---

## Deutsch

> **Dein Postfach. Dein Platz.**
>
> Modernes Webmail mit einer blauen Oberfläche, flexiblen Ansichten und einer einfachen Anmeldung.

### ✨ Funktionen

| Bereich | Funktionen |
|---|---|
| 🔐 Anmeldung | E-Mail-Adresse und Passwort oder App-Passwort; automatische IMAP-/SMTP-Erkennung |
| 📬 Postfach | Listenansicht, Lesebereich unten oder rechts |
| ↔️ Oberfläche | Verschiebbare Ordnerleiste, Lesebereiche und Spalten |
| 🌗 Darstellung | Heller und dunkler Modus |
| 🔍 Suche | Ordnerübergreifende Suche mit animierter Suchanzeige |
| ✍️ Nachrichten | HTML/Klartext, Antworten, Weiterleiten, Cc/Bcc und Anhänge |
| 📁 Ordner | Hierarchie, Unterordner, Erstellen, Löschen und Sichtbarkeit |
| 🗂️ Archiv | Frei wählbarer Archivordner und verschiedene Ablagestrukturen |
| 👥 Kontakte | Adressbücher, Gruppen, Kontaktbilder und erweiterte Kontaktinformationen |
| 📥 Import | Google-/Outlook-CSV, einschließlich Kontakten ohne E-Mail-Adresse |
| 📤 Export | Kontakte als CSV/vCard; Nachrichten als EML |
| ⚙️ Einstellungen | Sprache, Darstellung, Identität, Signatur, Spezialordner und Benachrichtigungen |

### 🚀 Installation mit Docker Compose

**Voraussetzungen:**

- Docker mit Docker Compose und Linux-Containern
- Ein E-Mail-Konto mit aktiviertem IMAP
- Passwort oder App-Passwort des E-Mail-Kontos

Die Datei [docker-compose.yml](docker-compose.yml) herunterladen und in ihrem Verzeichnis ausführen:

```bash
docker compose up -d
```

Anschließend im Browser öffnen:

```text
http://SERVER-IP:8886
```

Auf dem eigenen Rechner:

```text
http://localhost:8886
```

Datenbank und Verschlüsselungsschlüssel werden beim ersten Start automatisch angelegt.

### 🧩 Installation über Portainer

Für eine Docker-Standalone-Umgebung:

1. **Stacks → Add stack → Web editor** öffnen.
2. Einen Stack-Namen vergeben, beispielsweise `post-webmail`.
3. Den Inhalt der [docker-compose.yml](docker-compose.yml) einfügen.
4. Bei Bedarf die unten beschriebenen Umgebungsvariablen ergänzen.
5. **Deploy the stack** auswählen.

Danach die Webmail unter `http://SERVER-IP:8886` öffnen.

### ⚙️ Optionale Konfiguration

Für Docker Compose eine `.env` neben der Compose-Datei erstellen:

```dotenv
WEBMAIL_PORT=8886

# Optional: eigener Datenordner auf dem Docker-Host
# WEBMAIL_DATA_DIR=/pfad/zu/webmail/data
```

| Variable | Bedeutung | Standard |
|---|---|---|
| `WEBMAIL_PORT` | Port der Weboberfläche | `8886` |
| `WEBMAIL_DATA_DIR` | Optionaler Datenordner auf dem Docker-Host | Persistentes Docker-Volume |

In Portainer diese Werte unter den Umgebungsvariablen des Stacks eintragen.

Ein eigener Datenordner muss für den Backend-Benutzer mit UID **1000** schreibbar sein.

### 🔐 Anmeldung

Melde dich mit deiner **E-Mail-Adresse und deinem Passwort oder App-Passwort** an.

Die Anwendung ermittelt die IMAP- und SMTP-Einstellungen automatisch und prüft die Verbindung.

Bei Zwei-Faktor-Anmeldung wird häufig ein App-Passwort benötigt. IMAP muss beim Mailanbieter aktiviert sein.

> Konten, die ausschließlich OAuth2 erlauben, werden derzeit nicht unterstützt. Individuelle Server ohne passende Autokonfiguration können möglicherweise nicht automatisch erkannt werden.

### 🖥️ Dein Postfach, deine Ansicht

Wähle zwischen drei Ansichten:

| Ansicht | Beschreibung |
|---|---|
| 📋 Liste | Nachrichtenliste mit separatem Maildialog |
| ⬇️ Lesebereich unten | Nachrichtenliste oben, Vorschau darunter |
| ➡️ Lesebereich rechts | Nachrichtenliste links, Vorschau daneben |

Weitere Möglichkeiten:

- Breite der Ordnerleiste verändern
- Größe des Lesebereichs verändern
- Spalten per Drag-and-drop umsortieren
- Spaltenbreiten anpassen
- Anzahl der Nachrichten pro Seite einstellen
- Zwischen heller und dunkler Darstellung wechseln

### ⌨️ Mehrfachauswahl

| Bedienung | Funktion |
|---|---|
| `STRG` / `CMD` + Klick | Einzelne Nachrichten auswählen oder abwählen |
| `SHIFT` + Klick | Zusammenhängenden Bereich auswählen |
| `STRG` + `SHIFT` + Klick | Bereich zur bestehenden Auswahl hinzufügen |

Das Auswahlmenü bietet **Alle, Keine, Gelesene und Ungelesene** für die aktuelle Seite.

### 💌 Nachrichten

- Neue Nachrichten schreiben
- Antworten und allen antworten
- Nachrichten weiterleiten
- HTML- und Klartextnachrichten erstellen
- Empfänger, Cc und Bcc verwenden
- Anhänge bis insgesamt **20 MB** hinzufügen
- Empfangene Anhänge herunterladen
- Nachrichten als gelesen oder ungelesen markieren
- Sterne setzen
- Nachrichten verschieben, archivieren oder als Spam ablegen
- Nachrichten als EML exportieren
- Quelltext anzeigen
- Nachrichten drucken

Das Löschen verschiebt Nachrichten normalerweise in den Papierkorb. Endgültiges Löschen erfordert eine Bestätigung.

### ✍️ Nachrichtenerstellung und Signatur

- Persönlicher Absendername und Antwortadresse
- Individuelle Signatur
- Einstellbare Schrift und Schriftgröße für HTML-Nachrichten
- Antwort oberhalb oder unterhalb der Originalnachricht
- Einstellbare Signaturposition
- Weiterleitung als eingebetteter Text oder EML-Anhang
- Automatische Umwandlung von URLs in Links
- Rechtschreibprüfung mit Browserunterstützung
- Optionen für Lese- und Zustellbestätigungen
- Automatische Entwurfsspeicherung

> Anhänge werden derzeit nicht dauerhaft mit Entwürfen gespeichert. Nach erneutem Öffnen eines Entwurfs gegebenenfalls wieder anhängen.

### 🔍 Suche in allen Ordnern

Die Suche durchsucht alle auswählbaren Ordner, einschließlich ausgeblendeter Ordner.

Verfügbare Suchfelder:

- **Alle** — einschließlich Nachrichtentext
- **Betreff**
- **Von**
- **An**

Eine animierte Anzeige zeigt, dass die Suche läuft. Ergebnisse werden seitenweise angezeigt.

Die Suchdauer hängt von der Postfachgröße und der Geschwindigkeit des Mailservers ab.

### 📁 Ordner und Archiv

- Aufklappbare Ordnerhierarchie
- Ordner ein- und ausblenden
- Eigene Ordner und Unterordner erstellen
- Übergeordneten Ordner im Erstellungsdialog auswählen
- Eigene Ordner nach Bestätigung löschen
- Spezialordner individuell zuordnen

Beim Löschen eines Ordners werden auch dessen Nachrichten und Unterordner entfernt. Systemordner sind geschützt.

Für das Archiv stehen verschiedene Strukturen zur Verfügung:

- Ohne Unterteilung
- Nach Jahr oder Monat
- Monat im Thunderbird-Format
- Nach Absender-E-Mail-Adresse
- Nach Originalordner
- Jahr und Originalordner
- Jahr, Monat und Originalordner

Ist noch kein Archivordner eingestellt, erscheint bei der ersten Verwendung ein Auswahldialog.

### 👥 Kontakte und Adressbücher

Die Kontaktansicht besteht aus drei Bereichen:

**Adressbücher und Gruppen → Kontaktliste → Kontaktdetails**

- Eigene Adressbücher erstellen und löschen
- Kontakte anlegen, bearbeiten und löschen
- Kontakte zwischen Adressbüchern verschieben
- Kontakte in Gruppen organisieren
- Standardadressbuch auswählen
- Kontakte suchen, sortieren und drucken
- Kontakte als CSV oder vCard exportieren
- E-Mails direkt an einen Kontakt schreiben

Das persönliche Standardadressbuch bleibt erhalten. Beim Löschen eines Adressbuchs werden dessen Kontakte nach Bestätigung entfernt. Das Löschen einer Gruppe entfernt nur die Gruppenzuordnung.

**Kontaktinformationen:**

- Vorname, weitere Vornamen und Nachname
- Titel und Namenszusatz
- Mehrere E-Mail-Adressen
- Mehrere Telefonnummern mit Typ
- Mehrere Anschriften
- Firma, Abteilung und Position
- Geburtstag und weitere persönliche Informationen
- Notizen und zusätzliche Felder
- Kontaktbild als PNG, JPEG oder WebP bis **500 KB**

**Kontakte ohne E-Mail-Adresse werden ebenfalls unterstützt.**

### 📥 CSV-Import aus Google und Outlook

Unter **Kontakte → CSV importieren**:

1. CSV-Datei auswählen.
2. Vorschau und erkannte Kontaktanzahl prüfen.
3. Zieladressbuch auswählen.
4. Duplikatbehandlung festlegen.
5. Import starten.

| Eigenschaft | Unterstützung |
|---|---|
| Trennzeichen | Komma, Semikolon und Tabulator |
| Zeichencodierung | UTF-8, UTF-16 und Windows-1252 |
| Besondere Inhalte | Zitierte Felder und mehrzeilige Notizen |
| Maximale Dateigröße | 10 MB |
| Maximale Kontaktanzahl | 10.000 pro Import |

Kontakte ohne E-Mail-Adresse werden übernommen. Personen mit derselben E-Mail-Adresse bleiben getrennte Kontakte.

Die Option **„Identische Kontakte überspringen“** verhindert den erneuten Import vollständig identischer Datensätze.

Nicht zugeordnete Angaben und ungültige E-Mail-Werte bleiben bei ansonsten gültigen Kontakten als Zusatzfelder erhalten.

### ⚙️ Einstellungen

| Bereich | Möglichkeiten |
|---|---|
| 🖥️ Benutzeroberfläche | Sprache, Zeitzone, Zeit- und Datumsformat, kurze Datumsanzeige |
| 📬 Postfachansicht | Layout, Seitengröße und Zeitpunkt der Lesemarkierung |
| 🔔 Benachrichtigungen | Hinweise in der Webmail, Desktop-Mitteilungen und Ton |
| 👁️ Nachrichtendarstellung | HTML/Klartext, externe Bilder, Emoticons und lange Zitate |
| ✍️ Nachrichtenerstellung | Formatierung, Entwurfsspeicherung, Antwort- und Signaturregeln |
| 👥 Kontakte | Standardadressbuch, Anzeige, Sortierung und Autovervollständigung |
| 📁 Spezialordner | Entwürfe, Gesendet, Spam, Papierkorb und Archiv |
| 🗂️ Archiv | Aufteilung und Ablagestruktur |
| 🛠️ Serververhalten | Löschen, Lesemarkierung und Bereinigung beim Abmelden |
| 👤 Absenderidentität | Anzeigename, Antwortadresse und Signatur |

### 🖼️ Externe Bilder

Für externe Bilder stehen drei Einstellungen zur Verfügung:

- **Fragen:** Bilder zunächst blockieren und bei Bedarf laden.
- **Immer:** Externe Bilder automatisch laden.
- **Nie:** Externe Bilder blockieren.

Aktive Inhalte und externe Stylesheets bleiben blockiert.

> Das Laden externer Bilder kann für den Absender erkennbar sein.

### 🔔 Benachrichtigungen

Hinweise in der Webmail, Desktop-Mitteilungen und Benachrichtigungston sind getrennt einstellbar.

Desktop-Mitteilungen benötigen eine Browserfreigabe. Die Webmail muss geöffnet bleiben; Browser können Prüfintervalle in Hintergrund-Tabs verzögern.

### 🗄️ Speicherung und Sicherheit

E-Mails und ihre Ordner bleiben auf dem IMAP-Server.

SQLite speichert unter anderem:

- Konten und verschlüsselte Zugangsdaten
- Benutzereinstellungen
- Adressbücher, Kontakte und Gruppen
- Entwürfe und Bestätigungsprotokolle

Die Anwendungsdaten werden persistent gespeichert. Datenbank und `secret.key` bei Sicherungen gemeinsam aufbewahren.

Zugangsdaten werden mit **AES-256-GCM** verschlüsselt. Mailserver-Verbindungen verwenden TLS. HTML-Nachrichten werden bereinigt und isoliert dargestellt.

Für Zugriff über das Internet **HTTPS über einen Reverse-Proxy** verwenden. Das Compose-Setup selbst liefert HTTP.

### 🎨 Demo

Über **„Demo ansehen“** auf der Anmeldeseite lässt sich die Oberfläche mit Beispieldaten ausprobieren.

Die Demo verbindet sich mit keinem Mailserver und versendet keine Nachrichten.

---

## English

> **Your inbox. Your space.**
>
> Modern webmail with a blue interface, flexible layouts and a simple sign-in experience.

### ✨ Features

| Area | Features |
|---|---|
| 🔐 Sign-in | Email address and password or app password; automatic IMAP/SMTP discovery |
| 📬 Mailbox | List view, bottom reading pane or right reading pane |
| ↔️ Interface | Resizable folder sidebar, reading panes and columns |
| 🌗 Appearance | Light and dark mode |
| 🔍 Search | Cross-folder search with an animated progress indicator |
| ✍️ Messages | HTML/plain text, replies, forwarding, Cc/Bcc and attachments |
| 📁 Folders | Hierarchy, subfolders, creation, deletion and visibility |
| 🗂️ Archive | Configurable archive folder and filing structures |
| 👥 Contacts | Address books, groups, contact pictures and detailed profiles |
| 📥 Import | Google/Outlook CSV, including contacts without email addresses |
| 📤 Export | Contacts as CSV/vCard; messages as EML |
| ⚙️ Settings | Language, appearance, identity, signature, special folders and notifications |

### 🚀 Installation with Docker Compose

**Requirements:**

- Docker with Docker Compose and Linux containers
- An email account with IMAP enabled
- Your account password or app password

Download [docker-compose.yml](docker-compose.yml) and run this command from its directory:

```bash
docker compose up -d
```

Then open:

```text
http://SERVER-IP:8886
```

On your own computer:

```text
http://localhost:8886
```

The database and encryption key are created automatically on first startup.

### 🧩 Installation with Portainer

For a Docker Standalone environment:

1. Open **Stacks → Add stack → Web editor**.
2. Choose a stack name, such as `post-webmail`.
3. Paste the contents of [docker-compose.yml](docker-compose.yml).
4. Add the environment variables described below if needed.
5. Select **Deploy the stack**.

Then open the webmail at `http://SERVER-IP:8886`.

### ⚙️ Optional configuration

For Docker Compose, create a `.env` file next to the Compose file:

```dotenv
WEBMAIL_PORT=8886

# Optional: custom data directory on the Docker host
# WEBMAIL_DATA_DIR=/path/to/webmail/data
```

| Variable | Purpose | Default |
|---|---|---|
| `WEBMAIL_PORT` | Web interface port | `8886` |
| `WEBMAIL_DATA_DIR` | Optional data directory on the Docker host | Persistent Docker volume |

In Portainer, enter these values in the stack’s environment variables.

A custom data directory must be writable by the backend user with UID **1000**.

### 🔐 Sign-in

Sign in with your **email address and password or app password**.

The application automatically discovers the IMAP and SMTP settings and checks the connection.

Accounts with two-factor authentication often require an app password. IMAP must be enabled by your email provider.

> Accounts requiring OAuth2 exclusively are not currently supported. Custom servers without suitable autoconfiguration may not be discovered automatically.

### 🖥️ Your mailbox, your layout

Choose between three views:

| View | Description |
|---|---|
| 📋 List | Message list with a separate message dialog |
| ⬇️ Bottom reading pane | Message list above, preview below |
| ➡️ Right reading pane | Message list on the left, preview on the right |

Additional options:

- Resize the folder sidebar
- Resize the reading pane
- Reorder columns using drag-and-drop
- Adjust column widths
- Set the number of messages per page
- Switch between light and dark mode

### ⌨️ Multiple selection

| Action | Result |
|---|---|
| `CTRL` / `CMD` + click | Select or deselect individual messages |
| `SHIFT` + click | Select a continuous range |
| `CTRL` + `SHIFT` + click | Add a range to the current selection |

The selection menu provides **All, None, Read and Unread** for the current page.

### 💌 Messages

- Compose new messages
- Reply and reply to all
- Forward messages
- Compose HTML and plain-text messages
- Use recipients, Cc and Bcc
- Add attachments up to **20 MB combined**
- Download received attachments
- Mark messages as read or unread
- Add stars
- Move, archive or file messages as spam
- Export messages as EML
- View message source
- Print messages

Deleting normally moves messages to Trash. Permanent deletion requires confirmation.

### ✍️ Composition and signatures

- Custom sender name and reply-to address
- Personal signature
- Configurable HTML font and font size
- Replies above or below the original message
- Configurable signature placement
- Forwarding as embedded text or an EML attachment
- Automatic conversion of URLs into links
- Spellchecking with browser support
- Options for read and delivery receipts
- Automatic draft saving

> Draft attachments are not currently stored permanently. You may need to attach them again after reopening a draft.

### 🔍 Search across folders

Search covers all selectable folders, including hidden folders.

Available search fields:

- **All** — including message text
- **Subject**
- **From**
- **To**

An animated indicator shows that a search is running. Results are displayed across pages.

Search duration depends on mailbox size and mailserver performance.

### 📁 Folders and archive

- Expandable folder hierarchy
- Show or hide folders
- Create custom folders and subfolders
- Select a parent folder in the creation dialog
- Delete custom folders after confirmation
- Assign special folders individually

Deleting a folder also removes its messages and subfolders. System folders are protected.

Available archive structures:

- No subdivision
- By year or month
- Thunderbird-style month folders
- By sender email address
- By original folder
- Year and original folder
- Year, month and original folder

If no archive folder has been configured, a selection dialog appears on first use.

### 👥 Contacts and address books

The contact interface has three sections:

**Address books and groups → Contact list → Contact details**

- Create and delete custom address books
- Create, edit and delete contacts
- Move contacts between address books
- Organize contacts into groups
- Choose a default address book
- Search, sort and print contacts
- Export contacts as CSV or vCard
- Compose messages directly to a contact

The personal default address book is preserved. Deleting an address book removes its contacts after confirmation. Deleting a group only removes the group membership.

**Contact information:**

- First name, additional names and last name
- Titles and name suffixes
- Multiple email addresses
- Multiple phone numbers with types
- Multiple postal addresses
- Company, department and job title
- Birthday and other personal details
- Notes and additional fields
- Contact picture in PNG, JPEG or WebP format up to **500 KB**

**Contacts without email addresses are supported.**

### 📥 CSV import from Google and Outlook

Under **Contacts → Import CSV**:

1. Select a CSV file.
2. Review the preview and detected contact count.
3. Choose the destination address book.
4. Select the duplicate-handling option.
5. Start the import.

| Property | Support |
|---|---|
| Delimiters | Commas, semicolons and tabs |
| Encoding | UTF-8, UTF-16 and Windows-1252 |
| Special content | Quoted fields and multiline notes |
| Maximum file size | 10 MB |
| Maximum contact count | 10,000 per import |

Contacts without email addresses are included. People sharing an email address remain separate contacts.

**“Skip identical contacts”** prevents importing fully identical records again.

Unmapped details and invalid email values are retained as additional fields when the contact otherwise contains valid contact information.

### ⚙️ Settings

| Area | Options |
|---|---|
| 🖥️ User interface | Language, timezone, time/date formats and short dates |
| 📬 Mailbox view | Layout, page size and read-marking delay |
| 🔔 Notifications | In-app notices, desktop notifications and sounds |
| 👁️ Message display | HTML/plain text, external images, emoticons and long quotations |
| ✍️ Message composition | Formatting, draft saving, reply and signature rules |
| 👥 Contacts | Default address book, display, sorting and autocomplete |
| 📁 Special folders | Drafts, Sent, Spam, Trash and Archive |
| 🗂️ Archive | Subdivision and filing structure |
| 🛠️ Server behavior | Deletion, read marking and cleanup on sign-out |
| 👤 Sender identity | Display name, reply-to address and signature |

### 🖼️ External images

Three settings are available:

- **Ask:** Block images initially and load them when requested.
- **Always:** Load external images automatically.
- **Never:** Block external images.

Active content and external stylesheets remain blocked.

> Loading external images may be visible to the sender.

### 🔔 Notifications

In-app notices, desktop notifications and notification sounds can be configured separately.

Desktop notifications require browser permission. The webmail must remain open; browsers may delay checks in background tabs.

### 🗄️ Storage and security

Emails and their folders remain on the IMAP server.

SQLite stores data including:

- Accounts and encrypted credentials
- User preferences
- Address books, contacts and groups
- Drafts and receipt records

Application data is stored persistently. Keep the database and `secret.key` together when creating backups.

Credentials are encrypted using **AES-256-GCM**. Mailserver connections use TLS. HTML messages are sanitized and displayed in isolation.

For internet access, use **HTTPS through a reverse proxy**. The Compose setup itself serves HTTP.

### 🎨 Demo

Select **“View demo”** on the sign-in page to explore the interface using sample data.

The demo does not connect to a mailserver or send messages.

---

📬 **post. — a calmer inbox.**