# 📝 ONLYOFFICE in post. — 1.4.0

## Deutsch

ONLYOFFICE ist optional. Die normale `docker-compose.yml` startet weiterhin nur Webmail und Backend. **`docker-compose.onlyoffice.yml` ist eine vollständige alternative Stack-Datei** mit zusätzlichem Dokumentserver; sie benötigt die aktuelle Frontend- und Backend-Version 1.4.0.

### Was funktioniert?

- PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP und RTF direkt in der Dateivorschau ansehen und bearbeiten.
- Große Dokumentansicht: zunächst Vorschau, danach **Bearbeiten**. Die gespeicherte Datei lässt sich weiterhin herunterladen, auch wenn der optionale Editor nicht aktiviert ist.
- Bilder und Text bleiben in der bisherigen eigenen Vorschau. ZIP-Dateien und andere nicht unterstützte Formate bleiben Downloads.
- Zurückspeichern in die gleiche Datei im privaten Speicher, Google Drive oder OneDrive. Die Datei-ID bleibt erhalten.
- Ältere `.doc`, `.xls`, `.ppt` und Vorlagen können angesehen werden. Für die Bearbeitung zuerst eine moderne DOCX-, XLSX- oder PPTX-Datei verwenden. Wir überschreiben keine Originaldatei mit einem anderen Dateiformat.
- Native Google-Dokumente, Google-Tabellen und Google-Präsentationen weiterhin beim Anbieter öffnen. Es geht hier um normale hochgeladene Office-Dateien in Drive/OneDrive.
- Schreibgeschützte Dateien bleiben schreibgeschützt.

### 1. Dateien aktualisieren und Images veröffentlichen

Den Inhalt von `post-webmail-1.4.0.zip` in den Server-Projektordner übertragen. Vorhandene `.env`, Datenvolume, Datenbank, gespeicherte Dateien und `secret.key` beibehalten. Build-/Push-Befehle stehen in [UPDATE-1.4.0.md](UPDATE-1.4.0.md).

### 2. Schlüssel erstellen

Auf deinem Server einmal ausführen:

```bash
openssl rand -hex 32
```

Die Ausgabe ist dein privater Schlüssel. **Denselben Schlüssel** in Portainer als `ONLYOFFICE_JWT_SECRET` eintragen. Die Compose-Datei gibt ihn automatisch an Backend und Dokumentserver weiter. Mindestens 32 Zeichen; nicht veröffentlichen. Für eine Compose-Installation den Schlüssel in deiner privaten `.env` speichern. Während laufender Bearbeitungen nicht ändern.

### 3. Nginx Proxy Manager

Einen zusätzlichen Proxy Host anlegen, zum Beispiel `office.deine-domain.de`:

| Einstellung | Wert |
|---|---|
| Forward Scheme | `http` |
| Forward Hostname / IP | IP deines Webmail-Servers |
| Forward Port | `8888` bzw. dein `ONLYOFFICE_PORT` |
| Websockets Support | aktivieren |
| SSL | gültiges Zertifikat für die Office-Subdomain |
| Force SSL | aktivieren |

Die Webmail behält ihre bisherige Subdomain und ihren Port. Die Office-Subdomain muss auch vom Browser erreichbar sein. `http://onlyoffice` ist ausschließlich eine interne Docker-Adresse und darf nicht als Browser-Adresse eingetragen werden.

### 4. Vorhandenen Portainer-Stack erweitern

**Den vorhandenen Webmail-Stack bearbeiten**, damit sein bestehendes Datenvolume erhalten bleibt. Im Editor die vollständige Datei `docker-compose.onlyoffice.yml` einsetzen. Bestehende Einstellungen für Port, Datenverzeichnis und OAuth beibehalten. Diese Environment variables ergänzen bzw. ändern:

```dotenv
WEBMAIL_VERSION=1.4.0
ONLYOFFICE_URL=https://office.deine-domain.de
ONLYOFFICE_JWT_SECRET=DEIN_ZUVOR_ERSTELLTER_SCHLUESSEL
ONLYOFFICE_PORT=8888
ONLYOFFICE_VERSION=9.4.0.1
ONLYOFFICE_MAX_FILE_MB=50
```

Die Beispielwerte für Domain und Schlüssel durch deine eigenen Werte ersetzen. `ONLYOFFICE_ENABLED`, die interne Dokumentserver-Adresse und die interne Rückspeicher-Adresse setzt die optionale Stack-Datei bereits passend. **Update the stack → Re-pull image and redeploy**. Der erste Start des Dokumentservers kann mehrere Minuten dauern.

### Alternative: Docker Compose

Die obigen Werte in `.env` eintragen. Aus dem vorhandenen Projektordner und mit demselben Compose-Projektnamen wie bisher:

```bash
docker compose -f docker-compose.onlyoffice.yml pull &&
docker compose -f docker-compose.onlyoffice.yml up -d
docker compose -f docker-compose.onlyoffice.yml ps
```

Wenn die Installation bisher von Portainer verwaltet wurde, das Update dort durchführen. Eine zweite Installation mit anderem Projektnamen hätte ein anderes Standardvolume. `docker compose down -v` ist für dieses Update nicht nötig.

### 5. Benutzen und kontrollieren

1. Webmail mit **STRG + F5** neu laden.
2. **Dateien** öffnen und eine PDF-, DOCX-, XLSX- oder PPTX-Datei öffnen.
3. Die Vorschau zeigt ONLYOFFICE. **Bearbeiten** wählen und eine kleine Änderung machen.
4. Im Editor speichern und anschließend die Vorschau schließen. Warten, bis das Zurückspeichern abgeschlossen ist.
5. Datei erneut öffnen und die Änderung prüfen. Bei Clouds zusätzlich beim Anbieter kontrollieren.

Die Anzeige **Zuletzt zurückgespeichert** nennt den Zeitpunkt der letzten bestätigten Rückspeicherung und bedeutet, dass unser Backend die Datei zurückgeschrieben hat. Die interne Autospeicherung des Editors allein ist noch keine Bestätigung für die Speicherung im Zielordner. Beim Schließen wartet post. bis zu 90 Sekunden auf den Abschluss. Danach kann die Speicherung im Hintergrund weiterlaufen; bitte eine Fehlermeldung beachten.

### Konflikte und Wiederherstellung

Beim Öffnen wird der aktuelle Dateistand erfasst. Wird die Originaldatei während der Bearbeitung geändert, gelöscht oder anderweitig verändert, überschreibt post. einen erkannten Konflikt nicht. Die zusammengebaute bearbeitete Datei bleibt als verschlüsselte Wiederherstellungskopie erhalten. In der Vorschau lässt sie sich herunterladen. Nach dem Schließen erscheint sie auch in der Dateiansicht; **Im privaten Speicher sichern** legt sie unter **Wiederhergestellte Dokumente** ab.

Wiederherstellungskopien werden **sieben Tage** aufbewahrt und danach bereinigt. Schlägt bereits das Abholen vom Dokumentserver fehl, kann unser Backend noch keine solche Kopie besitzen. Der Editor meldet dann einen Speicherfehler; Browserfenster möglichst offen lassen und Verbindung prüfen.

Lokale Dateien werden mit einer atomaren Prüfung des ursprünglichen Dateistands ersetzt. Clouds werden vor dem Schreiben auf Änderungen geprüft; ein vorhandener ETag wird zusätzlich über `If-Match` übermittelt. Wenn ein Anbieter keinen ETag liefert oder die Bedingung nicht unterstützt, kann die vorgelagerte Prüfung ein sehr enges Änderungsfenster zwischen Prüfung und Schreiben nicht vollständig ausschließen.

### Speicher und Sicherheit

- Der Standard ist **50 MiB pro Dokument**; einstellbar von 1 bis 100 MiB über `ONLYOFFICE_MAX_FILE_MB`. Der normale Upload-Grenzwert bleibt davon unabhängig.
- Verschlüsselte Arbeits- und Wiederherstellungskopien zählen zur privaten Speicherquote. Bis zu 20 aktive Upload-/Arbeitskopien pro Konto können reserviert werden.
- Eine Bearbeitungssitzung gilt bis zu 24 Stunden. Danach Dokument schließen und erneut öffnen. Pro Konto und Datei wird eine neue parallele Bearbeitung blockiert, solange die vorherige aktiv ist.
- Der Dokumentserver erhält nur zeitlich begrenzte, signierte Dokumentzugriffe; keine Mail-, Google- oder Microsoft-Passwörter/OAuth-Tokens. Speicher-Callbacks benötigen zusätzlich seine JWT-Signatur.
- Lokale Originaldateien und unsere Arbeitskopien liegen verschlüsselt im Webmail-Volume. **ONLYOFFICE verarbeitet entschlüsselte Dokumente und kann sie in seinen eigenen Cache-Volumes halten.** Auch diese Volumes und deren Backups schützen. Es ist keine Ende-zu-Ende-Verschlüsselung.
- Der Download einer gespeicherten Editor-Datei ist auf die konfigurierten Dokumentserver-Adressen und deren Cache-Pfade begrenzt. Private Docker-Adressen sind für ONLYOFFICE erlaubt, damit es das Backend erreichen kann. Die Sicherheitsgrenzen der Google-/OneDrive-Verbindungen werden dadurch nicht verändert.
- Die Integration aktiviert keinen externen KI-Dienst. Vorhandene Cloud-Berechtigungen genügen für normale Dateien innerhalb des bereits autorisierten Bereichs.

### Fehler prüfen

| Problem | Prüfen |
|---|---|
| Dokumenteditor noch nicht aktiviert | Optionale Stack-Datei und aktuelle Backend-Version verwenden |
| Noch nicht vollständig eingerichtet | URL, gemeinsamer JWT-Schlüssel mit mindestens 32 Zeichen, keine ungültige URL |
| Editor lädt nicht | Office-Subdomain, Zertifikat, NPM-Ziel/Port, Websockets, Dokumentserver-Logs |
| Dokument kann nicht geladen werden | Backend-Netzwerkalias `backend`, gemeinsames Stack-Netzwerk, JWT-Schlüssel |
| Speichern scheitert | Backend-Logs, Cloud-Berechtigungen, Quote, Wiederherstellungshinweis |
| Image wird nicht aktualisiert | `WEBMAIL_VERSION=1.4.0` im Stack und beide Webmail-Images erneut herunterladen |

```bash
docker logs --tail=80 post-webmail-onlyoffice-1
docker logs --tail=80 post-webmail-backend-1
```

Die Containernamen hängen vom tatsächlichen Stacknamen ab. `ONLYOFFICE_VERSION` ist die unabhängige Version des Dokumentservers; `WEBMAIL_VERSION` die Version von post.

### Quellen und Prüfung

Die Anbindung orientiert sich an der offiziellen [Docker-Konfiguration](https://github.com/ONLYOFFICE/Docker-DocumentServer), [Editor-API](https://api.onlyoffice.com/docs/docs-api/usage-api/config/) und [Speicher-Callbacks](https://api.onlyoffice.com/docs/docs-api/usage-api/callback-handler/). Dokumentserver 9.4.0.1 ist als separater Image-Tag vorgesehen.

Automatisierte Prüfungen decken JWT, Zugriffsschutz, verschlüsselte Arbeitskopien, lokale Speicherung, Konflikte, Wiederherstellung und Google-/OneDrive-Schreibaufrufe ab. Cloud-Antworten und Dokumentserver-Callbacks werden dabei simuliert. Ein vollständiger Test mit dem echten ONLYOFFICE-Container war lokal mangels laufender Docker-Engine nicht möglich; der obige kleine Speichertest ist deshalb nach der Installation erforderlich.

## English

ONLYOFFICE is optional. The regular Compose file runs webmail only. **`docker-compose.onlyoffice.yml` is a complete alternative stack**, adding the document server. Both webmail images must be version 1.4.0.

PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP and RTF can be viewed and edited. Images/text retain the existing preview. Legacy DOC/XLS/PPT and templates are view-only; use a modern Office copy to edit. Native Google documents remain with their provider. Normal uploaded Office files in Drive/OneDrive are supported; read-only permissions are preserved.

### Setup

1. Upload the release files while preserving `.env`, your existing volume/database/files and `secret.key`. Build/push instructions: [UPDATE-1.4.0.md](UPDATE-1.4.0.md).
2. Generate a private secret with `openssl rand -hex 32`. Use the same `ONLYOFFICE_JWT_SECRET` for the backend and document server; the optional Compose file shares it automatically.
3. In Nginx Proxy Manager, add an Office subdomain forwarding over HTTP to your server on port 8888. Enable Websockets and a valid HTTPS certificate/Force SSL.
4. **Edit your existing Portainer stack**, replace its editor contents with `docker-compose.onlyoffice.yml`, preserve the existing port/storage/OAuth variables, and set the environment variables in the example above using your own domain and secret. Set `WEBMAIL_VERSION=1.4.0`. Update the stack and re-pull images.
5. Alternatively, set these values in `.env` and use the Compose commands above with the existing project name. A Portainer-managed stack should be updated in Portainer.
6. Reload with CTRL + F5, open a document under Files, choose Edit, make a small change, save/close, and reopen it to verify persistence. Check the provider too when editing a cloud file.

The first document-server startup can take several minutes. `ONLYOFFICE_URL` must be the browser-accessible HTTPS Office origin. The optional stack uses `http://onlyoffice` and `http://backend:3000` internally. The editor's own autosave is not yet confirmation that the storage provider has received the file. Closing waits up to 90 seconds for the save callback, then offers background saving.

### Recovery and limits

Recognized concurrent changes preserve the original and retain the assembled document as an encrypted recovery copy. Download it in the preview or keep it in private storage from the recovery banner under Files. Recovery copies expire after **seven days**. If retrieving the edited file from the document server itself fails, the backend cannot yet hold a recovery copy.

Local replacement checks the original revision atomically. Cloud writes check the revision beforehand and send `If-Match` when an ETag is available. Providers without a usable ETag/conditional write leave a small race window between checking and writing.

The default document limit is 50 MiB, configurable from 1 to 100 MiB. Working/recovery copies count towards the private quota; up to 20 concurrent reservations are allowed per mailbox. Editing sessions last up to 24 hours. A second active editing session for the same mailbox/file is blocked.

Our local originals and working copies remain encrypted. **ONLYOFFICE processes plaintext documents and may retain them in its own cache volumes**, so protect those volumes/backups too. JWT protects document access and callbacks; the document server never receives mailbox passwords or provider OAuth tokens. Private Docker access is allowed for the editor/backend connection only; cloud network checks remain unchanged. No external AI service is enabled by this integration.

Automated tests use simulated document-server callbacks and cloud responses. A real ONLYOFFICE container could not be tested locally because Docker Engine was not running. Perform the save/reopen check after deployment. Document-server and webmail version variables are independent.
