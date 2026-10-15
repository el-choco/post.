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
| 📬 Postfach | Listenansicht, Lesebereich unten oder rechts; seitenweiser Abruf und getrennte Hintergrundprüfung |
| ↔️ Oberfläche | Verschiebbare Ordnerleiste, Lesebereiche und Spalten |
| 🌗 Darstellung | Heller und dunkler Modus |
| 🎨 Theme-Editor | Eigene Farben für Hell/Dunkel, vier Farbvorlagen, lokale Schriftarten und skalierbare Schriftgröße; Vorschau und Zurücksetzen |
| 🔍 Suche | Ordnerübergreifende Suche mit animierter Suchanzeige |
| ✍️ Nachrichten | HTML/Klartext, Antworten, Weiterleiten, Cc/Bcc und Anhänge |
| 📁 Ordner | Hierarchie, Unterordner, Erstellen, Löschen und Sichtbarkeit |
| 🗂️ Archiv | Frei wählbarer Archivordner und verschiedene Ablagestrukturen |
| 👥 Kontakte | Adressbücher, Gruppen, Kontaktbilder und erweiterte Kontaktinformationen |
| 📅 Kalender | Persönliche SQLite-Kalender, CalDAV, Google/Microsoft-Anbindung, ICS, Monats-/Wochen-/Terminansicht; Tagesfeld anklicken und Termine im Popup erstellen/bearbeiten |
| 📁 Dateien | Privater verschlüsselter Dateispeicher, Google Drive und OneDrive; Datei-/Ordner-Upload, Drag & Drop, Ordner, Downloads, Umbenennen, Verschieben, Papierkorb, Vorschau, Listen-/Kachelansicht |
| 📝 Dokumente | Optional: ONLYOFFICE-Vorschau und Bearbeitung für PDF, DOCX, XLSX und PPTX; Zurückspeichern in privaten Speicher, Google Drive oder OneDrive |
| 📥 Import | Google-/Outlook-CSV, einschließlich Kontakten ohne E-Mail-Adresse |
| 📤 Export | Kontakte als CSV/vCard; Nachrichten als EML |
| 🩺 Diagnose | Mail-Ladezeiten, Fehlercodes und einzelne Abrufschritte pro Postfach; Filter und JSON-Download |
| ⚙️ Einstellungen | Sprache, Darstellung, Identität, Signatur, Spezialordner und Benachrichtigungen |

### ⚡ Mailabruf und Fehlerdiagnose

Unter **Einstellungen → Diagnose** findest du seit Version 1.5.2 Ladezeiten, Fehlercodes, Anfrage-IDs und die einzelnen Schritte des Mailabrufs. Mit **Protokoll herunterladen** kannst du die Einträge als JSON sichern. Pro Postfach werden bis zu 1000 Einträge für sieben Tage in der bestehenden SQLite-Datenbank aufbewahrt; die Aufzeichnung beginnt mit diesem Update. Passwörter, Tokens, Mail-Inhalte, Betreffzeilen, Suchbegriffe und Ordnernamen werden nicht aufgenommen. Es werden keine Daten automatisch an einen externen Diagnosedienst versendet.

Die normale Mail-Liste lädt nur die benötigte Seite. Hintergrundprüfungen verwenden eine getrennte Verbindung. Bei ausgeschalteter Prüfung aller Ordner wird nur der Posteingang im Hintergrund geprüft; andere Ordnerzähler aktualisieren sich beim Öffnen. Fehler bleiben mit aufklappbaren Details sichtbar. Hinweise zu Zeitgrenzen, großen Anhängen und Diagnose: [PERFORMANCE.md](PERFORMANCE.md).

### 🧭 Welche Variante passt zu deinem Server?

| Variante | Stack-Datei | Enthalten |
|---|---|---|
| 📬 Webmail ohne ONLYOFFICE | [docker-compose.yml](docker-compose.yml) | E-Mail, Kontakte, Kalender und Dateien; eigene Bild-/Textvorschau, Office-Dateien herunterladen |
| 📝 Webmail mit ONLYOFFICE | [docker-compose.onlyoffice.yml](docker-compose.onlyoffice.yml) | Alles aus der Standardvariante plus Dokumentvorschau und Bearbeitung mit zusätzlichem ONLYOFFICE-Container |

**Eine der beiden vollständigen Stack-Dateien verwenden.** Die ONLYOFFICE-Datei enthält bereits Frontend und Backend; dafür keinen zweiten Webmail-Stack anlegen und die Dateien nicht zusammenführen.

Bei wenig freiem RAM die Standardvariante wählen. ONLYOFFICE nennt **mindestens 4 GB RAM** für seine Docker-Installation; Betriebssystem, Webmail und weitere Dienste benötigen zusätzlich Speicher. Für einen gemeinsamen Server sind **8 GB oder mehr eine praktische Empfehlung**, abhängig von Dokumentgröße und gleichzeitiger Nutzung. Die Standardvariante benötigt keinen Dokumentserver und kann später erweitert werden. [ONLYOFFICE-Systemanforderungen](https://helpcenter.onlyoffice.com/docs/installation/docs-community-install-docker.aspx).

### 🚀 Installation mit Docker Compose

Die optionale Kalenderanbindung und OAuth-Einrichtung sind in [CALENDAR.md](CALENDAR.md) beschrieben. Client-ID und Client-Secret für Google/Microsoft können direkt über **Kalender → Kalender hinzufügen → Kalender verbinden** eingegeben werden. Google benötigt dafür eine HTTPS-Domain. Der persönliche Kalender funktioniert ohne zusätzliche Konfiguration.

Der Bereich **Dateien** bietet sofort einen privaten Speicher auf deinem Server. Optional kannst du über **Dateien → Cloud hinzufügen** Google Drive oder OneDrive verbinden. Dafür die zusätzlichen Datei-Berechtigungen und Rücksprungadressen beim Anbieter einrichten; die Kalenderverbindung bleibt getrennt. Anleitung, Speichergrenzen und Proxy-Hinweise stehen in [FILES.md](FILES.md). Standard: 1 GB pro Datei und 5 GB privater Speicher pro Postfach. Lokale Dateiinhalte werden verschlüsselt im bestehenden Datenvolume gespeichert; Dateinamen und Metadaten liegen in SQLite.

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

### 📝 Installation mit ONLYOFFICE

Die Webmail-Images müssen die ONLYOFFICE-Einbindung enthalten (**ab v1.4.0**). Für eine neue Installation die vollständige [docker-compose.onlyoffice.yml](docker-compose.onlyoffice.yml) verwenden. Eine vorhandene Installation im **gleichen Projekt bzw. bestehenden Portainer-Stack** erweitern und das vorhandene Datenvolume beibehalten.

1. Auf dem Server mit `openssl rand -hex 32` einen zufälligen Schlüssel erzeugen.
2. Eine eigene Office-Subdomain anlegen, z. B. `office.example.com`. Im Nginx Proxy Manager auf **HTTP → Docker-Server-IP → Port 8888** weiterleiten, **Websockets Support** aktivieren und ein gültiges SSL-Zertifikat mit **Force SSL** einrichten. Bei anderem `ONLYOFFICE_PORT` den Proxy-Port entsprechend ändern. Die Webmail behält ihre eigene Adresse und ihren bisherigen Port.
3. Die folgenden Variablen in der `.env` bzw. unter **Environment variables** des Portainer-Stacks setzen:

```dotenv
WEBMAIL_VERSION=1.5.2
WEBMAIL_PORT=8886
ONLYOFFICE_URL=https://office.example.com
ONLYOFFICE_JWT_SECRET=HIER_DEN_ERZEUGTEN_SCHLUESSEL_EINTRAGEN
ONLYOFFICE_PORT=8888
ONLYOFFICE_VERSION=9.4.0.1
ONLYOFFICE_MAX_FILE_MB=50
```

Domain und Schlüssel ersetzen; eigene Ports und die gewünschte verfügbare Webmail-Version beibehalten. `latest` ist ebenfalls möglich. Der Office-Port muss frei sein. Den Schlüssel nicht veröffentlichen.

**Docker Compose:** Aus dem bisherigen Projektverzeichnis starten:

```bash
docker compose -f docker-compose.onlyoffice.yml up -d
```

**Portainer:** Im bestehenden Stack unter **Editor** die vollständige `docker-compose.onlyoffice.yml` einsetzen, vorhandene Daten-/Port-/OAuth-Einstellungen behalten und **Update the stack → Re-pull image and redeploy** wählen. Bei einer Neuinstallation diese Datei bereits beim Anlegen des Stacks verwenden.

Die optionale Stack-Datei setzt automatisch `ONLYOFFICE_ENABLED=true`, `ONLYOFFICE_INTERNAL_URL=http://onlyoffice` und `ONLYOFFICE_CALLBACK_BASE_URL=http://backend:3000`. Diese drei Werte müssen dafür nicht in der `.env` eingetragen werden. Nur `ONLYOFFICE_ENABLED=true` in der normalen Datei startet noch keinen Dokumentserver.

Nach dem ersten Start einige Minuten warten, die Webmail mit **STRG + F5** neu laden und unter **Dateien** eine PDF-, DOCX-, XLSX- oder PPTX-Datei öffnen. **Bearbeiten** wählen, eine kleine Änderung speichern, die Vorschau schließen und die Datei erneut öffnen. Änderungen werden in dieselbe Datei im privaten Speicher, Google Drive oder OneDrive zurückgeschrieben. Native Google-Dokumente weiterhin beim Anbieter bearbeiten; Bilder und Text behalten ihre eigene Vorschau.

ONLYOFFICE verarbeitet die Dokumente entschlüsselt und kann sie in seinen eigenen Cache-Volumes halten. Auch diese Volumes und Backups schützen. Einrichtung, Speichergrenzen und Wiederherstellung erklärt [ONLYOFFICE.md](ONLYOFFICE.md).

**Zur Standardvariante zurückkehren:** Laufende Bearbeitungen erst speichern und schließen. `ONLYOFFICE_ENABLED=false` setzen und im selben Stack wieder die vollständige normale Compose-Datei verwenden. In Portainer beim Update den entfernten ONLYOFFICE-Dienst ebenfalls entfernen lassen. Bei Docker Compose:

```bash
docker compose -f docker-compose.onlyoffice.yml stop onlyoffice
docker compose -f docker-compose.yml up -d --remove-orphans
```

Damit läuft kein zusätzlicher Dokumentserver mehr. Die benannten Datenvolumes bleiben erhalten; `--remove-orphans` entfernt im gleichen Compose-Projekt die Container von Diensten, die nicht mehr in der gewählten Datei stehen.

### ⚙️ Alle Variablen der `.env`

Für Docker Compose die [`.env.example`](.env.example) als `.env` neben der gewählten Compose-Datei speichern und anpassen. In **Portainer** dieselben Werte unter den **Environment variables des Stacks** eintragen. Nicht jede Variable muss befüllt werden; die Standardvariante funktioniert ohne OAuth-/Office-Zugangsdaten. Die `.env` mit echten Schlüsseln und Secrets nicht veröffentlichen.

#### Webmail und privater Dateispeicher

| Variable | Bedeutung | Standard |
|---|---|---|
| `DOCKERHUB_NAMESPACE` | Namensraum der bereitgestellten Webmail-Images; normalerweise beibehalten | `paquele` |
| `WEBMAIL_VERSION` | Image-Version für Frontend und Backend; z. B. `1.5.2` oder `latest` | `latest` |
| `WEBMAIL_PORT` | Freier Port auf dem Docker-Host für die Webmail | `8886` |
| `WEBMAIL_DATA_DIR` | Optionaler Host-Datenordner statt des benannten Volumes; enthält Datenbank, Schlüssel und lokale Dateien | Docker-Volume `webmail_data` |
| `FILES_MAX_UPLOAD_MB` | Maximale Größe einer einzelnen hochgeladenen Datei in MiB; unabhängig vom Office-Limit | `1024` (1 GiB) |
| `FILES_QUOTA_MB` | Private Speicherquote pro Postfach in MiB; Papierkorb und verschlüsselte Cloud-/Office-Arbeitskopien zählen mit | `5120` (5 GiB) |

Ein eigener Host-Datenordner muss für den Backend-Benutzer mit UID **1000** schreibbar sein. Bei einem Update dieselbe Datenablage und denselben Compose-Projektnamen beibehalten. Größen als positive ganze Zahlen angeben; **1024 MiB = 1 GiB**. Für temporäre Arbeitskopien Platz innerhalb der Quote lassen.

#### Kalender und Cloud-Verbindungen: optionale Servervorgaben

**Du kannst die OAuth-Daten direkt beim Verbinden in der Webmail eingeben. Dann dürfen die folgenden Servervorgaben leer bleiben bzw. fehlen.** Die über die Oberfläche gespeicherten Einstellungen gelten pro Postfach und haben Vorrang vor den Servervorgaben. Eine Dateiverbindung ohne eigene OAuth-Konfiguration kann die Kalenderkonfiguration desselben Anbieters übernehmen; die Berechtigungen und Anmeldungen für Kalender und Dateien bleiben getrennt.

| Variable | Bedeutung | Standard |
|---|---|---|
| `PUBLIC_BASE_URL` | Öffentliche HTTPS-Adresse der **Webmail**, z. B. `https://post.example.com`, ohne Unterpfad; Grundlage der OAuth-Rücksprungadressen, wenn Servervorgaben verwendet werden | leer |
| `GOOGLE_CLIENT_ID` | Optionale Google-OAuth-Client-ID als Vorgabe für Kalender/Drive | leer |
| `GOOGLE_CLIENT_SECRET` | Zugehöriges Google-Client-Secret; kein Mail-/App-Passwort | leer |
| `MICROSOFT_CLIENT_ID` | Optionale Microsoft-OAuth-Anwendungs-ID als Vorgabe für Kalender/OneDrive | leer |
| `MICROSOFT_CLIENT_SECRET` | Zugehöriger Microsoft-Client-Secret-Wert | leer |
| `MICROSOFT_TENANT_ID` | Microsoft-Verzeichnis bzw. Mandant für die Servervorgabe; eine konkrete Tenant-ID ist ebenfalls möglich | `common` |
| `ALLOW_PRIVATE_CALDAV` | `true` erlaubt zusätzlich CalDAV-Verbindungen zu privaten/internen Serveradressen; nur bei Bedarf aktivieren | `false` |

Wenn du Servervorgaben nutzt, für den jeweiligen Anbieter auch `PUBLIC_BASE_URL` und beide Client-Zugangsdaten setzen. Bei Einrichtung über die Oberfläche dort die Webmail-Adresse und Zugangsdaten angeben. OAuth-Daten werden verschlüsselt in SQLite gespeichert. Lokale Kalender und privater Dateispeicher brauchen keine OAuth-App. Anbieter-Konfiguration, Berechtigungen und genaue Callback-Adressen stehen in [CALENDAR.md](CALENDAR.md) und [FILES.md](FILES.md).

#### ONLYOFFICE

| Variable | Bedeutung | Standard / Verhalten |
|---|---|---|
| `ONLYOFFICE_ENABLED` | Aktiviert die Office-Einbindung im Backend; startet selbst keinen Container | `false` in der normalen Datei; in der optionalen Datei fest `true` |
| `ONLYOFFICE_URL` | Öffentliche HTTPS-Adresse des Dokumentservers, z. B. `https://office.example.com`; vom Browser erreichbar, ohne Unterpfad | leer; für ONLYOFFICE erforderlich |
| `ONLYOFFICE_INTERNAL_URL` | Adresse, unter der unser Backend den Dokumentserver intern erreicht | normale Datei: Office-URL als Fallback; optionale Datei: fest `http://onlyoffice` |
| `ONLYOFFICE_CALLBACK_BASE_URL` | Adresse unseres **Webmail-Backends**, unter der ONLYOFFICE Dokumente abruft und Speicher-Callbacks sendet; nicht die Office-Subdomain | normale Datei: `PUBLIC_BASE_URL` als Fallback; optionale Datei: fest `http://backend:3000` |
| `ONLYOFFICE_JWT_SECRET` | Gemeinsamer zufälliger Schlüssel für Webmail-Backend und ONLYOFFICE, mindestens 32 Zeichen; `openssl rand -hex 32` erzeugt ihn | leer; für ONLYOFFICE erforderlich |
| `ONLYOFFICE_MAX_FILE_MB` | Maximale Dokumentgröße für Vorschau/Bearbeitung in MiB, ganze Zahl von `1` bis `100`; normale Uploads können größer sein | `50` |
| `ONLYOFFICE_VERSION` | Version des separaten ONLYOFFICE-Images, unabhängig von `WEBMAIL_VERSION`; nur die optionale Datei verwendet sie | `9.4.0.1` |
| `ONLYOFFICE_PORT` | Freier Host-Port des Dokumentservers; Zielport im Nginx Proxy Manager | `8888`; nur die optionale Datei verwendet ihn |

Die optionale Datei überschreibt die drei Werte **ENABLED**, **INTERNAL_URL** und **CALLBACK_BASE_URL** fest. Die entsprechenden Einträge in `.env` werden dabei nicht verwendet. Ein vorhandener externer Dokumentserver kann stattdessen mit der normalen Datei und passenden Office-Variablen eingebunden werden.

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
| 🎨 Theme-Editor | Farben für Hell/Dunkel, Schriftart, Schriftgröße, Vorschau und Zurücksetzen |
| 📬 Postfachansicht | Layout, Seitengröße und Zeitpunkt der Lesemarkierung |
| 🔔 Benachrichtigungen | Hinweise in der Webmail, Desktop-Mitteilungen und Ton |
| 👁️ Nachrichtendarstellung | HTML/Klartext, externe Bilder, Emoticons und lange Zitate |
| ✍️ Nachrichtenerstellung | Formatierung, Entwurfsspeicherung, Antwort- und Signaturregeln |
| 👥 Kontakte | Standardadressbuch, Anzeige, Sortierung und Autovervollständigung |
| 📁 Spezialordner | Entwürfe, Gesendet, Spam, Papierkorb und Archiv |
| 🗂️ Archiv | Aufteilung und Ablagestruktur |
| 🛠️ Serververhalten | Löschen, Lesemarkierung und Bereinigung beim Abmelden |
| 👤 Absenderidentität | Anzeigename, Antwortadresse und Signatur |

### 🎨 Dein eigenes Theme

Unter **Einstellungen → Theme-Editor** kannst du die Oberfläche anpassen:

- **Farben:** Akzent, Hintergrund, Flächen und Text; heller und dunkler Modus haben eigene Farben.
- **Vorlagen:** Blau, Lavendel, Mint oder Rosé als Ausgangspunkt wählen.
- **Schrift:** Standard/System, Arial, Verdana, Georgia oder Monospace; verwendet werden lokal verfügbare Schriften bzw. passende Ersatzschriften.
- **Größe:** 14–20 px als Basis; Überschriften, Listen und Beschriftungen werden proportional skaliert.
- **Vorschau:** Änderungen erscheinen sofort. Erst **Speichern** übernimmt sie dauerhaft; Verlassen der Einstellungen ohne Speichern verwirft die Vorschau.
- **Zurücksetzen:** **Standard wiederherstellen** setzt beide Farbmodi und die Schrift zurück. Danach speichern, um den Standard dauerhaft zu übernehmen.

Das Theme wird pro Postfach in SQLite gespeichert und bei der Anmeldung auf anderen Geräten geladen. In der Demo bleibt es lokal im Browser. Bei wenig Textkontrast bietet der Editor eine passende Textfarbe an. HTML-Mails und ONLYOFFICE-Dokumente behalten ihre eigene Formatierung. Für den Theme-Editor sind keine zusätzlichen Container, `.env`-Variablen oder Schrift-Downloads nötig.

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
| 📬 Mailbox | List view, bottom or right reading pane; page-sized fetching and separate background checks |
| ↔️ Interface | Resizable folder sidebar, reading panes and columns |
| 🌗 Appearance | Light and dark mode |
| 🎨 Theme editor | Separate light/dark colors, four presets, local fonts and adjustable font size; live preview and reset |
| 🔍 Search | Cross-folder search with an animated progress indicator |
| ✍️ Messages | HTML/plain text, replies, forwarding, Cc/Bcc and attachments |
| 📁 Folders | Hierarchy, subfolders, creation, deletion and visibility |
| 🗂️ Archive | Configurable archive folder and filing structures |
| 👥 Contacts | Address books, groups, contact pictures and detailed profiles |
| 📅 Calendars | Personal SQLite calendars, CalDAV, Google/Microsoft connections, ICS, month/week/agenda views; click a day cell to create or edit events in a popup |
| 📁 Files | Encrypted private storage, Google Drive and OneDrive; file/folder uploads, drag and drop, folders, downloads, rename, move, trash, previews and list/grid views; compact toolbar in the page header |
| 📝 Documents | Optional ONLYOFFICE viewing/editing for PDF, DOCX, XLSX and PPTX; save back to private storage, Google Drive or OneDrive |
| 📥 Import | Google/Outlook CSV, including contacts without email addresses |
| 📤 Export | Contacts as CSV/vCard; messages as EML |
| 🩺 Diagnostics | Mail request timings, error codes and loading steps per mailbox; filters and JSON export |
| ⚙️ Settings | Language, appearance, identity, signature, special folders and notifications |

### ⚡ Mail loading and diagnostics

Since version 1.5.2, **Settings → Diagnostics** shows request durations, error codes, request IDs and individual mail loading steps. **Download log** exports the entries as JSON. Up to 1000 entries per mailbox are retained for seven days in the existing SQLite database; recording starts with this update. Passwords, tokens, message contents, subjects, search terms and folder names are excluded. No data is automatically sent to an external diagnostic service.

Unfiltered lists fetch only the requested page. Background checks use a separate connection. Disabling all-folder checks polls only INBOX; other counters update when opened. Errors remain visible with expandable details. See [PERFORMANCE.md](PERFORMANCE.md) for deadlines, large attachments and troubleshooting.

### 🧭 Choose your installation

| Variant | Stack file | Includes |
|---|---|---|
| 📬 Webmail without ONLYOFFICE | [docker-compose.yml](docker-compose.yml) | Mail, contacts, calendars and files; built-in image/text previews, Office file downloads |
| 📝 Webmail with ONLYOFFICE | [docker-compose.onlyoffice.yml](docker-compose.onlyoffice.yml) | All standard features plus document previews and editing through an additional ONLYOFFICE container |

**Choose one complete stack file.** The ONLYOFFICE file already includes frontend and backend; do not create a second webmail stack or combine the two files.

Choose the standard variant when available RAM is limited. ONLYOFFICE lists **at least 4 GB RAM** for its Docker installation; the operating system, webmail and other services need additional memory. **8 GB or more is a practical recommendation** for a shared server, depending on document size and concurrent use. The standard variant needs no document server and can be extended later. [ONLYOFFICE system requirements](https://helpcenter.onlyoffice.com/docs/installation/docs-community-install-docker.aspx).

### 🚀 Installation with Docker Compose

Optional calendar connections and OAuth setup are described in [CALENDAR.md](CALENDAR.md). Enter Google/Microsoft client credentials directly through **Calendar → Add calendar → Connect calendar**. Google requires an HTTPS domain. The personal calendar works without additional configuration.

**Files** provides private storage on your server immediately. Optionally connect Google Drive or OneDrive through **Files → Add cloud storage**. Register the additional file permissions and callback URLs; calendar connections remain separate. See [FILES.md](FILES.md) for setup, limits and reverse-proxy settings. Defaults: 1 GB per file and 5 GB private storage per mailbox. Local file contents are encrypted in the existing data volume; filenames and metadata are stored in SQLite.

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

### 📝 Install with ONLYOFFICE

Use webmail images containing the ONLYOFFICE integration (**v1.4.0 or later**). For a new installation, use the complete [docker-compose.onlyoffice.yml](docker-compose.onlyoffice.yml). Extend an existing installation in the **same Compose project or existing Portainer stack**, keeping its data volume.

1. Generate a random key on the server with `openssl rand -hex 32`.
2. Create a separate Office subdomain such as `office.example.com`. In Nginx Proxy Manager, forward to **HTTP → Docker server IP → port 8888**, enable **Websockets Support**, and configure a valid SSL certificate with **Force SSL**. If you change `ONLYOFFICE_PORT`, change the proxy target port too. Webmail keeps its own address and existing port.
3. Set these values in `.env` or the Portainer stack's **Environment variables**:

```dotenv
WEBMAIL_VERSION=1.5.2
WEBMAIL_PORT=8886
ONLYOFFICE_URL=https://office.example.com
ONLYOFFICE_JWT_SECRET=REPLACE_WITH_YOUR_GENERATED_KEY
ONLYOFFICE_PORT=8888
ONLYOFFICE_VERSION=9.4.0.1
ONLYOFFICE_MAX_FILE_MB=50
```

Replace the domain and key; retain your chosen ports and available webmail version. You can also use `latest`. The Office port must be available. Keep the key private.

**Docker Compose:** Run from your existing project directory:

```bash
docker compose -f docker-compose.onlyoffice.yml up -d
```

**Portainer:** In the existing stack's **Editor**, paste the complete `docker-compose.onlyoffice.yml`, retain the existing data/port/OAuth settings, and select **Update the stack → Re-pull image and redeploy**. For a new installation, use this file when creating the stack.

The optional stack automatically sets `ONLYOFFICE_ENABLED=true`, `ONLYOFFICE_INTERNAL_URL=http://onlyoffice` and `ONLYOFFICE_CALLBACK_BASE_URL=http://backend:3000`. These three values do not need `.env` entries for this stack. Setting only `ONLYOFFICE_ENABLED=true` with the normal file does not start a document server.

Allow a few minutes for initial startup, reload webmail with **CTRL + F5**, and open a PDF, DOCX, XLSX or PPTX under **Files**. Choose **Edit**, save a small change, close the preview and reopen the file. Changes are saved to the same file in private storage, Google Drive or OneDrive. Continue editing native Google documents at the provider; images and text keep their existing previews.

ONLYOFFICE processes decrypted documents and may retain them in its own cache volumes. Protect these volumes and backups too. See [ONLYOFFICE.md](ONLYOFFICE.md) for detailed setup, limits and recovery.

**Return to the standard variant:** Save and close active editing sessions first. Set `ONLYOFFICE_ENABLED=false` and replace the stack with the complete normal Compose file in the same project. In Portainer, also remove the deleted ONLYOFFICE service during the update. With Docker Compose:

```bash
docker compose -f docker-compose.onlyoffice.yml stop onlyoffice
docker compose -f docker-compose.yml up -d --remove-orphans
```

The additional document server no longer runs. Named data volumes are retained; `--remove-orphans` removes containers in the same Compose project whose services are absent from the selected file.

### ⚙️ Every `.env` variable explained

For Docker Compose, save [`.env.example`](.env.example) as `.env` next to the chosen Compose file and adjust it. In **Portainer**, enter the same values in the **stack's Environment variables**. Not every variable needs a value; the standard variant works without OAuth or Office credentials. Do not publish `.env` files containing real keys or secrets.

#### Webmail and private file storage

| Variable | Purpose | Default |
|---|---|---|
| `DOCKERHUB_NAMESPACE` | Namespace of the provided webmail images; normally leave unchanged | `paquele` |
| `WEBMAIL_VERSION` | Image version for frontend and backend, such as `1.5.2` or `latest` | `latest` |
| `WEBMAIL_PORT` | Available Docker host port for webmail | `8886` |
| `WEBMAIL_DATA_DIR` | Optional host data directory instead of the named volume; holds the database, key and local files | Docker volume `webmail_data` |
| `FILES_MAX_UPLOAD_MB` | Maximum size of one uploaded file in MiB; independent of the Office limit | `1024` (1 GiB) |
| `FILES_QUOTA_MB` | Private storage quota per mailbox in MiB; includes trash and encrypted cloud/Office working copies | `5120` (5 GiB) |

A custom host directory must be writable by the backend user with UID **1000**. Keep the same data location and Compose project name when updating. Set sizes as positive integers; **1024 MiB = 1 GiB**. Leave space within the quota for temporary working copies.

#### Calendars and cloud connections: optional server defaults

**You can enter OAuth credentials directly when connecting in webmail. These server defaults may then remain blank or be omitted.** Settings saved through the interface apply per mailbox and take precedence over server defaults. A file connection without its own OAuth configuration can fall back to the same provider's calendar configuration; calendar/file permissions and authorization remain separate.

| Variable | Purpose | Default |
|---|---|---|
| `PUBLIC_BASE_URL` | Public HTTPS **webmail** address, such as `https://post.example.com`, with no subpath; basis for OAuth callbacks when using server defaults | blank |
| `GOOGLE_CLIENT_ID` | Optional Google OAuth client ID as a calendar/Drive default | blank |
| `GOOGLE_CLIENT_SECRET` | Matching Google client secret; not a mail/app password | blank |
| `MICROSOFT_CLIENT_ID` | Optional Microsoft OAuth application ID as a calendar/OneDrive default | blank |
| `MICROSOFT_CLIENT_SECRET` | Matching Microsoft client secret value | blank |
| `MICROSOFT_TENANT_ID` | Microsoft directory/tenant for the server default; a specific tenant ID can also be used | `common` |
| `ALLOW_PRIVATE_CALDAV` | `true` additionally allows CalDAV connections to private/internal server addresses; enable only if needed | `false` |

When using server defaults, set `PUBLIC_BASE_URL` and both client credentials for the provider. When configuring through the interface, enter the webmail address and credentials there. OAuth credentials are stored encrypted in SQLite. Local calendars and private file storage need no OAuth application. Provider setup, permissions and exact callback addresses are documented in [CALENDAR.md](CALENDAR.md) and [FILES.md](FILES.md).

#### ONLYOFFICE

| Variable | Purpose | Default / behavior |
|---|---|---|
| `ONLYOFFICE_ENABLED` | Enables Office integration in the backend; does not start a container by itself | `false` in the normal file; fixed `true` in the optional file |
| `ONLYOFFICE_URL` | Public HTTPS document server address, such as `https://office.example.com`; browser-accessible, with no subpath | blank; required for ONLYOFFICE |
| `ONLYOFFICE_INTERNAL_URL` | Address used by our backend to reach the document server internally | normal file: falls back to the Office URL; optional file: fixed `http://onlyoffice` |
| `ONLYOFFICE_CALLBACK_BASE_URL` | Our **webmail backend** address where ONLYOFFICE fetches documents and sends save callbacks; not the Office subdomain | normal file: falls back to `PUBLIC_BASE_URL`; optional file: fixed `http://backend:3000` |
| `ONLYOFFICE_JWT_SECRET` | Shared random key for the webmail backend and ONLYOFFICE, at least 32 characters; generate with `openssl rand -hex 32` | blank; required for ONLYOFFICE |
| `ONLYOFFICE_MAX_FILE_MB` | Maximum document size for viewing/editing in MiB; integer from `1` to `100`; ordinary uploads may be larger | `50` |
| `ONLYOFFICE_VERSION` | Version of the separate ONLYOFFICE image, independent of `WEBMAIL_VERSION`; used only by the optional file | `9.4.0.1` |
| `ONLYOFFICE_PORT` | Available document server host port; target port in Nginx Proxy Manager | `8888`; used only by the optional file |

The optional file fixes **ENABLED**, **INTERNAL_URL** and **CALLBACK_BASE_URL**, overriding any `.env` entries for those three settings. An existing external document server can instead be connected through the normal file with appropriate Office variables.

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
| 🎨 Theme editor | Light/dark colors, font, font size, live preview and reset |
| 📬 Mailbox view | Layout, page size and read-marking delay |
| 🔔 Notifications | In-app notices, desktop notifications and sounds |
| 👁️ Message display | HTML/plain text, external images, emoticons and long quotations |
| ✍️ Message composition | Formatting, draft saving, reply and signature rules |
| 👥 Contacts | Default address book, display, sorting and autocomplete |
| 📁 Special folders | Drafts, Sent, Spam, Trash and Archive |
| 🗂️ Archive | Subdivision and filing structure |
| 🛠️ Server behavior | Deletion, read marking and cleanup on sign-out |
| 👤 Sender identity | Display name, reply-to address and signature |

### 🎨 Make the theme your own

Open **Settings → Theme editor** to customize the interface:

- **Colors:** Accent, background, surfaces and text; light and dark modes have separate colors.
- **Presets:** Start with Blue, Lavender, Mint or Rose.
- **Font:** Default/System, Arial, Verdana, Georgia or Monospace; available local fonts or suitable fallbacks are used.
- **Size:** A 14–20 px base size; headings, lists and labels scale proportionally.
- **Preview:** Changes appear immediately. Choose **Save** to keep them; leaving settings without saving discards the preview.
- **Reset:** **Restore defaults** resets both color modes and the font. Save to keep the restored defaults.

Themes are stored per mailbox in SQLite and loaded when signing in on other devices. The demo stores them locally in the browser. When text contrast is low, the editor offers a suitable text color. HTML emails and ONLYOFFICE documents retain their own formatting. No additional containers, `.env` variables or font downloads are needed.

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

