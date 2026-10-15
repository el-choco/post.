# 📁 Dateien / Files — post. 1.5.3

## Deutsch

### Privater Dateimanager

Der neue Menüpunkt **Dateien** funktioniert mit jeder Webmail-Anmeldung, auch ohne Google oder Microsoft. Der private Speicher gehört zum angemeldeten Postfach und wird automatisch angelegt.

- Dateien auswählen oder per Drag & Drop hochladen, inklusive ganzer Ordnerstrukturen.
- „Ordner hochladen“ erhält die relative Struktur. Leere Ordner werden beim Ziehen eines Ordners unterstützt; der Ordner-Auswahldialog liefert üblicherweise nur Ordner mit Dateien.
- Ordner und Unterordner erstellen, Dateien/Ordner umbenennen und innerhalb desselben Speichers verschieben.
- Einzelne Dateien herunterladen; Bilder und Text bis 10 MB als Vorschau ansehen. Ordner-ZIP-Downloads und Kopieren zwischen unterschiedlichen Speichern sind nicht enthalten.
- Liste oder Kacheln, Suche im aktuellen Ordner, Details, STRG-/SHIFT-Mehrfachauswahl und weitere Seiten über „Weitere Einträge laden“.
- Lokaler Papierkorb mit Wiederherstellung und bestätigtem endgültigem Löschen. Bei Namenskonflikten ergänzt die lokale Wiederherstellung eine Nummer. Der Papierkorb zählt zum Speicherverbrauch.
- Gleichnamige Uploads werden abgewiesen, ohne vorhandene Dateien zu überschreiben. Andere Dateien der Upload-Liste werden weiter verarbeitet; Fehler stehen je Datei in der Fortschrittsanzeige.

Uploads laufen in 10-MiB-Teilen. „Weitere Uploads abbrechen“ beendet noch nicht gespeicherte Übertragungen und folgende Dateien. Eine bereits gestartete serverseitige Cloud-Übertragung wird abgeschlossen. Im angemeldeten Betrieb kannst du während eines Uploads zu E-Mail oder Kalender wechseln und anschließend zur Fortschrittsanzeige zurückkehren. Beim Abmelden oder Schließen der Seite werden noch laufende Browser-Uploads abgebrochen; bereits gespeicherte Dateien bleiben erhalten. Es gibt kein automatisches Fortsetzen nach einem Browser-/Serverneustart.

### Speicherung und Grenzen

Dateiinhalte und temporäre Upload-Teile werden mit zufälligen Dateischlüsseln und AES-256-GCM verschlüsselt. Diese Dateischlüssel liegen verschlüsselt in SQLite; zum Entschlüsseln wird der bestehende Anwendungsschlüssel (`secret.key` bzw. `SECRET_KEY`) benötigt. Die Dateien liegen unter `/app/data/files`, die Metadaten in `/app/data/webmail.db`. Es ist kein zusätzliches Volume erforderlich. Dateinamen, Größen und Ordnerstruktur sind nicht verschlüsselt. Das ist keine Ende-zu-Ende-Verschlüsselung: Die Anwendung und ein Administrator mit Datenvolume plus Schlüssel können auf Inhalte zugreifen.

Standardgrenzen im Portainer-Stack oder in `.env`:

```dotenv
FILES_MAX_UPLOAD_MB=1024
FILES_QUOTA_MB=5120
```

Werte sind MiB; die zweite Grenze gilt pro Postfach. Lokale Dateien einschließlich Papierkorb zählen zum Kontingent. Gleichzeitige Uploads werden reserviert, maximal 20 pro Konto. Cloud-Uploads benötigen verschlüsselten temporären Platz auf dem Server und werden ebenfalls gegen das verfügbare Kontingent geprüft. Der Cloudanbieter kann zusätzliche Grenzen und Kontingente haben. Abgelaufene Upload-Teile werden nach etwa einer Stunde bei der regelmäßigen Bereinigung entfernt. Für höhere Grenzen muss auch genug freier Speicher auf dem Host vorhanden sein.

Für Backups **das gesamte bestehende Datenvolume einschließlich `files`, Datenbank und `secret.key` sichern**. Für eine konsistente Sicherung den Backend-Container anhalten oder einen konsistenten Volume-Snapshot erstellen. Schlüssel nicht neu erzeugen oder austauschen. Ein Kopieren nur der SQLite-Datei reicht für Dateiinhalte nicht aus.

### Nginx Proxy Manager

Deine bisherige HTTPS-Subdomain weiter verwenden. Der Reverse Proxy muss die einzelnen Upload-Teile zulassen. Falls HTTP 413 beim Hochladen erscheint, im Proxy Host unter **Advanced** ergänzen:

```nginx
client_max_body_size 40m;
proxy_request_buffering off;
```

Die Frontend-Konfiguration erlaubt bereits 40 MB pro Anfrage. Da Dateien in Teilen übertragen werden, muss der Proxy nicht die gesamte 1-GB-Datei in einer Anfrage zulassen. Öffentliche Zugriffe weiterhin über HTTPS führen. Proxy- und Container-Administratoren können während der Verarbeitung auf Klartext zugreifen.

### Google Drive

1. In deiner Google-Cloud-Webanwendung die **Google Drive API** aktivieren.
2. Als autorisierte Redirect-URI ergänzen:

   ```text
   https://DEINE-WEBMAIL-DOMAIN/api/files/oauth/google/callback
   ```

3. Im Bereich **Dateien → Cloud hinzufügen → Google Drive** Client-ID, Client-Secret und die Webmail-Adresse eingeben. Bei bestehender Kalenderkonfiguration können deren Client-ID und gespeichertes Secret als Vorgabe verwendet werden; die Datei-Einrichtung speichert eine eigene Konfiguration.
4. Zugriff auswählen und beim Anbieter bestätigen:
   - **Nur der Ordner „post. Dateien“:** `https://www.googleapis.com/auth/drive.file`. Ein dedizierter Ordner wird angelegt oder wiederverwendet. Vorhandene Dateien außerhalb dieses App-Ordners werden nicht angezeigt. Du kannst Dateien über post. hochladen und dort verwalten.
   - **Mein gesamtes Google Drive:** `https://www.googleapis.com/auth/drive`. Damit werden vorhandene Dateien in „Meine Ablage“ verfügbar. Dieser weitreichende Scope unterliegt zusätzlichen Google-Vorgaben; für öffentliche Apps kann Verifikation und eine Sicherheitsprüfung erforderlich sein. Siehe [Googles Scope-Dokumentation](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Die neue Verbindung wird unabhängig von der Kalender-Verbindung gespeichert. Das erstmalige Verbinden erfolgt im angemeldeten Browser über OAuth mit PKCE, einer zehn Minuten gültigen, einmaligen Autorisierung und serverseitig verschlüsselten Tokens. Bei externen Test-Apps gelten weiterhin Googles Token-Laufzeiten; siehe auch [CALENDAR.md](CALENDAR.md).

Google-Dateien lassen sich hochladen, herunterladen, umbenennen, verschieben und in den Papierkorb legen bzw. wiederherstellen. Änderungen betreffen dein echtes Drive. Google Docs, Tabellen, Präsentationen und Zeichnungen werden beim Download als PDF exportiert; dabei gelten [Googles Export-Grenzen](https://developers.google.com/workspace/drive/api/guides/manage-downloads). Shared Drives, Verknüpfungen und die vollständige Google-Office-Bearbeitung sind nicht Teil dieses Dateimanagers. Für die Original-Bearbeitung „Beim Anbieter öffnen“ verwenden.

### OneDrive

1. In der Microsoft-Entra-Webanwendung diese Redirect-URI ergänzen:

   ```text
   https://DEINE-WEBMAIL-DOMAIN/api/files/oauth/microsoft/callback
   ```

2. Die delegierte Microsoft-Graph-Berechtigung **Files.ReadWrite** und den Scope **offline_access** einrichten. Keine Anwendungsberechtigung für alle Benutzer verwenden. Ein Firmenkonto kann Zustimmung durch seinen Administrator benötigen. [Microsoft-Berechtigungen für Uploads](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0).
3. **Dateien → Cloud hinzufügen → OneDrive** auswählen und Client-Daten eingeben. `common` ist die Vorgabe für persönliche und Firmenkonten; die App-Registrierung muss den jeweiligen Kontotyp erlauben. Anschließend beim Anbieter anmelden.

Es wird das eigene OneDrive des angemeldeten Microsoft-Kontos verwendet. Listen, Ordner, Upload, Download, Umbenennen und Verschieben laufen direkt über Microsoft Graph. Löschen legt Einträge in OneDrives Papierkorb; dessen Anzeige und Wiederherstellung erfolgen über den Link **OneDrive-Papierkorb öffnen** beim Anbieter. Bei Firmenkonten gegebenenfalls das OneDrive-Portal des Unternehmens verwenden. SharePoint-Dokumentbibliotheken und fremde Drives sind nicht eingebunden. [Microsoft zum Löschen](https://learn.microsoft.com/en-us/graph/api/driveitem-delete?view=graph-rest-1.0).

### Verbindungen und Sicherheit

Die private Ablage und Cloudspeicher sind getrennte Speicherorte. Es gibt keine automatische Spiegelung und keinen Hintergrund-Sync zwischen ihnen. Ein Cloud-Upload wird beim Anbieter gespeichert; die temporäre lokale Kopie wird nach Abschluss entfernt. Dateien werden beim Öffnen eines Ordners oder mit Aktualisieren neu geladen.

**Verbindung entfernen** entfernt nur die gespeicherten Tokens und die Anzeige in post.; Cloud-Dateien bleiben bestehen. Die Anbieter-Autorisierung kann zusätzlich im Google-/Microsoft-Konto widerrufen werden. Verbindungen und Zugriffsdaten sind pro Postfach getrennt, Secrets werden nicht an das Frontend zurückgegeben. Die bestehenden Grenzen der Webmail-Sitzungsverwaltung bleiben unverändert. Die Anwendung führt keine Virenprüfung von Uploads durch.

## English

### Private file manager

**Files** works with any signed-in mailbox, independently of Google or Microsoft. Each mailbox has its own private storage.

- File and folder uploads, drag and drop, relative folder structure, upload progress and cancellation of further files.
- Empty folders are supported when dropping directory entries. Folder-picker uploads usually include only folders containing files.
- Create folders, rename and move within the same storage. Conflicting uploads are rejected without overwriting existing files.
- Download individual files; preview images and text up to 10 MB. Folder ZIP downloads and cross-storage copies are not included.
- List/grid view, current-folder search, details, CTRL/SHIFT selection and paginated loading.
- Private trash, restore and confirmed permanent deletion. Trash counts towards quota; restore adds a number if the name conflicts.

Uploads use 10-MiB chunks. Cancelling stops pending browser uploads and further files; a cloud transfer already running on the server finishes first. You can switch sections while uploading and return to progress. Signing out or closing the page aborts browser uploads; saved files remain. Transfers do not automatically resume after browser/server restarts.

### Storage, limits and backups

Local file contents and upload staging are encrypted with random AES-256-GCM file keys. Those keys are encrypted in SQLite using the existing application key. Content is stored under `/app/data/files`, metadata in `/app/data/webmail.db`; no additional volume is needed. Names, sizes and folder hierarchy remain plaintext. This is server-side encryption, not end-to-end encryption; the application and administrators with the volume and key can access contents.

`FILES_MAX_UPLOAD_MB=1024` and `FILES_QUOTA_MB=5120` are defaults in MiB: the first is per file, the second per mailbox. Quota includes private trash and reserved uploads. Cloud uploads temporarily need encrypted local storage and also undergo quota checks. Up to 20 uploads per account may be reserved. Provider limits still apply. Expired upload staging is periodically cleaned after about an hour.

Back up the **complete data volume**, including `files`, SQLite and `secret.key`. Stop the backend or create a consistent snapshot. Never replace the key. Backing up SQLite alone does not preserve file contents.

For Nginx Proxy Manager, keep your HTTPS subdomain. If uploads return HTTP 413, add the two directives shown above to the proxy host's Advanced configuration. The frontend already accepts 40 MB per request; it does not need to accept an entire 1-GB file in one request.

### Cloud setup

For Google, enable the Drive API and register `https://YOUR-DOMAIN/api/files/oauth/google/callback`. Open **Files → Add cloud storage → Google Drive** and enter client details. The dedicated **post. Dateien** folder uses `drive.file`, showing files managed through post. Choose entire-Drive access (`drive`) to browse existing My Drive files; this restricted scope may require app verification/security assessment. See [Google's scope requirements](https://developers.google.com/workspace/drive/api/guides/api-specific-auth). Existing calendar credentials may be prefilled, but file configurations and tokens are independent. Google documents export as PDF subject to provider limits. Shared Drives, shortcuts and Office editing are not included.

For OneDrive, register `https://YOUR-DOMAIN/api/files/oauth/microsoft/callback` and delegated **Files.ReadWrite** with **offline_access**. Open **Files → Add cloud storage → OneDrive**, enter client details and sign in. `common` is the default tenant; registration must allow your account type. Organization policy may require admin consent. The integration targets the signed-in user's own drive, not SharePoint libraries or other drives. Deletions use the provider recycle bin; open OneDrive itself to restore items.

Cloud changes affect real provider files. Local and cloud storage are separate destinations, with no automatic mirroring. Cloud uploads remove their encrypted staging after completion. Folder views refresh on navigation or manually. Removing a connection keeps provider files intact; revoke provider consent separately if desired. Tokens are encrypted per mailbox and never returned to the frontend. There is no antivirus scan. Production OAuth should be tested with your registered applications; automated provider checks use simulated responses.
