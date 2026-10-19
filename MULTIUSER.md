# 👥 post. 2.0 — Benutzer, Verbindungen und Freigaben

## Deutsch

### 🔐 Erste Einrichtung

post. verwendet ab **2.0.0** ein eigenes Benutzerkonto. Das post.-Passwort ist unabhängig vom Mail-/App-Passwort. Ein verbundenes Postfach ist optional: Kontakte, lokale Kalender und privater Dateispeicher funktionieren auch ohne Mailkonto.

Beim ersten Start mit 2.0 erzeugt das Backend im Datenvolume die Datei `admin-setup-token`. Den einmaligen Einrichtungscode auf dem Server auslesen:

```bash
# Im Compose-Projektverzeichnis:
docker compose exec backend cat /app/data/admin-setup-token

# Alternativ für den Portainer-Stack post-webmail:
docker exec post-webmail-backend-1 cat /app/data/admin-setup-token
```

In Portainer funktioniert auch **Containers → Backend → Console → `/bin/sh`**, anschließend `cat /app/data/admin-setup-token`. Bei einem anderen Stack-Namen den tatsächlichen Container-Namen verwenden. Außerhalb von Docker liegt die Datei unter `DATA_DIR/admin-setup-token`.

Die Webmail öffnen, Anzeigename, eigene Anmelde-E-Mail-Adresse, ein neues post.-Passwort mit mindestens zwölf Zeichen und den Einrichtungscode eintragen. Der erste Benutzer wird Administrator; danach wird die Codedatei entfernt. Den Code nicht veröffentlichen. Ohne Zugriff auf den Servercode kann niemand über die öffentliche Registrierungsseite den ersten Administrator anlegen.

Weitere Registrierungen warten auf Freischaltung durch einen Administrator. Unter **Einstellungen → Benutzerverwaltung** lassen sich Benutzer aktivieren, sperren, zu Administratoren machen und für Mail, Kalender oder Dateien berechtigen. Änderungen melden die Sitzungen des betroffenen Benutzers ab. Die Registrierung kann geschlossen werden. Gesperrte Benutzer können sich nicht anmelden. Der letzte aktive Administrator lässt sich nicht sperren oder herabstufen.

Eigene Passwörter ändern Benutzer unter **Einstellungen → Konto & Verbindungen** mit ihrem aktuellen post.-Passwort. Andere Sitzungen werden dabei abgemeldet. Es gibt derzeit keine automatische Passwort-zurücksetzen-E-Mail und keine E-Mail-Verifikation; die Administrator-Freischaltung ist die Zugangskontrolle.

### 🔄 Umstieg von 1.x

1. Vor dem Update das **gesamte Datenvolume** sichern, einschließlich `webmail.db`, gegebenenfalls `webmail.db-wal`/`webmail.db-shm`, `secret.key` und `files/`. Für eine konsistente Kopie das Backend vorher stoppen. `.env` und ONLYOFFICE-Volumes ebenfalls beibehalten.
2. Frontend und Backend gemeinsam auf **2.0.0** aktualisieren. Compose-Datei, Ports und Datenvolume können bleiben. Für einen Rückweg wird das vorherige Datenbackup benötigt; ein Wechsel auf ein altes Image allein ist kein Datenbank-Rollback.
3. Im Browser **STRG + F5**. Alte Mail-Anmeldesitzungen werden beim Umstieg ungültig. Ein eigenes post.-Konto mit dem Einrichtungscode anlegen.
4. **Vor dem Anlegen neuer Daten** unter **Einstellungen → Konto & Verbindungen** das bisherige Mailkonto verbinden. Google/Microsoft können per OAuth2 verbunden werden; andere Anbieter per Mail-/App-Passwort. Erst die erfolgreiche Prüfung der Mailverbindung ordnet den vorhandenen Datenbestand dem neuen Benutzer zu.
5. Vorhandene Kontakte, Kalender, Cloud-Verbindungen, Einstellungen und private Dateien gehören anschließend diesem Benutzer. Weitere frühere Postfächer können von ihren jeweiligen Benutzern auf demselben Weg übernommen werden. Ein bereits zugeordnetes Postfach kann nicht von einem zweiten Benutzer übernommen werden.

Die bloße Registrierung einer passenden E-Mail-Adresse übernimmt **keine** bestehenden Daten. Wenn ein neues post.-Konto bereits eigene Kontakte, Dateien, Verbindungen, zusätzliche Adressbücher/Kalender oder laufende Uploads enthält, wird eine Übernahme mit möglichem Datenverlust abgewiesen. Bestehende Daten werden nicht ungefragt zusammengeführt oder überschrieben. Standardkalender ohne Termine und das automatisch angelegte Standardadressbuch verhindern die Übernahme nicht.

### 🔗 Mail, Kalender und Clouds verbinden

Unter **Einstellungen → Konto & Verbindungen** zuerst Anbieter und Mailadresse auswählen. Für Google oder Microsoft **Mailkonto verbinden** wählen. Fehlende OAuth-Client-Daten können direkt dort hinterlegt werden. Die eigentliche Zustimmung erfolgt auf der Seite des Anbieters. Die Mailadresse wird gegen den verbundenen IMAP-Zugang geprüft.

Derzeit ist **eine aktive Mailverbindung pro post.-Benutzer** vorgesehen. Kalender- und Dateiverbindungen werden weiterhin unabhängig im jeweiligen Bereich eingerichtet. Eine Kalender- oder Drive-Zustimmung allein erteilt keinen Mailzugriff. Die eigene post.-Anmeldung bleibt auch nach Entfernen einer Anbieter-Verbindung erhalten.

| Zweck | Google-Rücksprungadresse | Microsoft-Rücksprungadresse |
|---|---|---|
| Mail | `https://post.example.com/api/mail/oauth/google/callback` | `https://post.example.com/api/mail/oauth/microsoft/callback` |
| Kalender | `https://post.example.com/api/calendar/oauth/google/callback` | `https://post.example.com/api/calendar/oauth/microsoft/callback` |
| Dateien | `https://post.example.com/api/files/oauth/google/callback` | `https://post.example.com/api/files/oauth/microsoft/callback` |

`post.example.com` durch die eigene öffentliche **Webmail-Domain** ersetzen. Die jeweilige Adresse exakt beim OAuth-Client registrieren. Eine HTTPS-Domain verwenden; die ONLYOFFICE-Domain gehört nicht in diese Rücksprungadressen. Lokale Entwicklung über localhost ist ausgenommen.

Google-Mail benötigt den Scope `https://mail.google.com/` für IMAP/SMTP. Dafür gelten Googles Vorgaben für eingeschränkte Scopes, Testnutzer und gegebenenfalls App-Verifizierung. Microsoft-Mail benötigt die delegierten Exchange-Berechtigungen `https://outlook.office.com/IMAP.AccessAsUser.All`, `https://outlook.office.com/SMTP.Send` und `offline_access`. IMAP und gegebenenfalls SMTP AUTH müssen beim Anbieter/Tenant erlaubt sein. Graph-Kalender-/Dateirechte ersetzen diese Exchange-Mailrechte nicht. Siehe [Google XOAUTH2](https://developers.google.com/workspace/gmail/imap/xoauth2-protocol) und [Microsoft IMAP/SMTP OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth/).

Die optionalen `.env`-Vorgaben `PUBLIC_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` und `MICROSOFT_TENANT_ID` gelten nun auch als Mail-Vorgaben. Benutzer können eigene Konfigurationen über die Oberfläche speichern. Kalender und Dateien funktionieren wie in [CALENDAR.md](CALENDAR.md) und [FILES.md](FILES.md) beschrieben. Für andere Mailanbieter bleibt die vorhandene IMAP-/SMTP-Erkennung mit App-Passwort erhalten.

### 📁 Dateien und Ordner freigeben

Im **privaten Speicher** eine Datei oder einen Ordner auswählen und **Freigeben** anklicken. Aktive Benutzer oder Gruppen hinzufügen, Rechte auswählen und speichern:

| Auswahl | Erlaubt |
|---|---|
| Ansehen & herunterladen | Auflisten, Vorschau, Download und ONLYOFFICE-Ansicht |
| Ansehen & bearbeiten | Zusätzlich umbenennen, Ordner erstellen, Dateien hochladen und in ONLYOFFICE bearbeiten |
| Ansehen & löschen | Zusätzlich in den Papierkorb verschieben |
| Ansehen, bearbeiten & löschen | Alle genannten Aktionen; Verschieben innerhalb zugänglicher Ordner desselben Eigentümers |

Empfänger finden die Inhalte unter **Dateien → Mit mir geteilt**. Rechte gelten auch für Unterordner. Direkte und geerbte Benutzer-/Gruppenrechte werden addiert; es gibt keine ausdrücklichen Verweigerungsregeln. Alle zutreffenden Freigaben entfernen, um Zugriff zu widerrufen. Gruppenmitgliedschaften verwalten Administratoren. Nur der Eigentümer verwaltet die Freigaben und seinen Papierkorb; Empfänger können keine eigenen Zugriffe erweitern. Verschieben benötigt Bearbeiten- und Löschen-Rechte am Ausgang sowie Bearbeiten-Rechte am Ziel. Ein Ziel außerhalb der zugänglichen Ordner wird abgewiesen.

Neue Inhalte in freigegebenen Ordnern gehören dem **Ordnereigentümer** und zählen zu dessen Speicherquote. Temporäre Upload-/Office-Kopien zählen zusätzlich beim bearbeitenden Benutzer. Die Freigabe wird beim Download, bei der Übernahme eines Uploads und beim Speichern aus ONLYOFFICE erneut geprüft. Bereits laufende Bearbeitungen können bei entzogenen Rechten nicht in die Originaldatei zurückschreiben. Separate Bearbeitungen behalten die bestehende Versions-/Konfliktprüfung; dies ist keine neue gemeinsame Live-Bearbeitung über Benutzergrenzen hinweg.

post.-Freigaben betreffen den privaten Serverspeicher. Freigaben und Zugriffsrechte in Google Drive oder OneDrive werden weiterhin beim Anbieter verwaltet.

### 🛡️ Daten und Rollen

Jeder Benutzer hat einen eigenen Datenbereich. Benutzerpasswörter werden mit scrypt gehasht; Sitzungskennungen werden gehasht gespeichert. Anbieter-Passwörter und OAuth-/Refresh-Tokens werden serverseitig verschlüsselt abgelegt. Lokale Dateiinhalte bleiben verschlüsselt. Dateinamen und andere Metadaten liegen in SQLite.

Die Administratorrolle gibt in der Anwendung keinen automatischen Lesezugriff auf fremde Mails, Kalender, Kontakte oder Dateien. Administratoren können Benutzer löschen; dabei werden deren lokale Daten und Freigaben entfernt, nicht jedoch Mails oder Cloud-Dateien beim Anbieter. Dieser Vorgang verlangt eine ausdrückliche Bestätigung in der Oberfläche.

Die Verschlüsselung schützt keine Daten vor Personen mit vollständigem Zugriff auf Server und Verschlüsselungsschlüssel. Es handelt sich nicht um Ende-zu-Ende-Verschlüsselung. Datenvolume, Schlüssel und Backups schützen und die Webmail über HTTPS betreiben.

## English

### 🔐 First setup

Starting with **2.0.0**, sign in with a separate post. user account. Your post. password is independent of any email/app password. A mailbox is optional; contacts, local calendars and private files work without one.

On first startup, the backend creates `admin-setup-token` in its data volume. Read it using `docker compose exec backend cat /app/data/admin-setup-token`, or use the backend container's Portainer console and run `cat /app/data/admin-setup-token`. For the stack named `post-webmail`, `docker exec post-webmail-backend-1 cat /app/data/admin-setup-token` also works. Outside Docker, use `DATA_DIR/admin-setup-token`.

Open post., enter your display name, sign-in email, a new post. password of at least twelve characters and the setup code. The first user becomes administrator and the code file is removed. Do not publish the code. Subsequent registrations require administrator approval in **Settings → User administration**. Administrators can close registration, manage groups, approve/disable users, assign roles and allow mail/calendar/file access. User changes revoke that user's sessions. The last active administrator cannot be disabled or demoted.

Users change their own password under **Settings → Account & connections**, supplying their current password. Other sessions are revoked. There is currently no automatic password-reset email or email verification; administrator approval controls admission.

### 🔄 Upgrade from 1.x

1. Back up the **entire data volume** before updating, including SQLite database/WAL files, `secret.key` and `files/`. Stop the backend for a consistent copy. Preserve `.env` and any ONLYOFFICE volumes.
2. Update frontend and backend together to **2.0.0**. Existing Compose configuration, ports and volume can remain. Rolling back requires the previous data backup; switching back to an old image is not a database rollback.
3. Reload with **CTRL + F5**. Old mailbox sessions are invalidated. Create your own post. account using the server setup code.
4. **Before creating new data**, connect the previous mailbox through **Settings → Account & connections**. A successful OAuth/IMAP or app-password connection assigns the existing data to that user.
5. Existing contacts, calendars, cloud connections, preferences and private files are retained. Other previous mailbox owners can follow the same process. A mailbox already assigned to a user cannot be claimed by another user.

Registering a matching email address does not claim existing data. Migration is refused if the new workspace already contains contacts, files, connections, additional address books/calendars or pending uploads that could be lost. Empty automatic default calendars/address books are allowed. Data is not silently merged or overwritten.

### 🔗 Provider connections

Choose the provider and mailbox address in **Settings → Account & connections**, then connect. Enter OAuth client settings there if needed; consent takes place at Google/Microsoft. The address is checked against IMAP access. **One active mailbox per post. user** is currently supported. Calendars and file providers are authorized separately in their own sections. Disconnecting a provider does not remove your post. account.

Register the exact callback addresses in the table above, replacing `post.example.com` with your public HTTPS **webmail** domain. Do not use the ONLYOFFICE domain. Google mail uses `https://mail.google.com/`; restricted-scope verification and test-user requirements may apply. Microsoft uses the delegated Exchange scopes `https://outlook.office.com/IMAP.AccessAsUser.All`, `https://outlook.office.com/SMTP.Send` and `offline_access`. IMAP and SMTP AUTH must be allowed by the provider/tenant. Graph calendar/file permissions do not grant Exchange mail access. See the linked official Google/Microsoft documentation above.

Optional server OAuth defaults in `.env` also apply to mail. Users may save their own client settings in the interface. Existing calendar/file setup remains documented in [CALENDAR.md](CALENDAR.md) and [FILES.md](FILES.md). Other mail providers retain app-password access through automatic IMAP/SMTP discovery.

### 📁 Private file sharing

Select a private file/folder, choose **Share**, add active users or groups and save the desired rights: view/download, edit, delete or edit+delete. Recipients use **Files → Shared with me**. Editing includes renaming, folder creation, uploads and ONLYOFFICE editing. Moving requires edit+delete on the source and edit on the destination; destinations must remain in accessible folders owned by the same user. Only the owner manages sharing and the trash.

Folder rights are inherited. Direct, user and group grants are combined; there are no explicit deny rules. Remove all applicable grants to revoke access. Administrators manage group membership. Uploads into shared folders belong to the folder owner and count against that owner's quota; temporary working copies also count against the acting user's quota. Rights are rechecked for downloads, upload commits and ONLYOFFICE saves. Revoked editors cannot overwrite the original. Existing version/conflict handling remains; this does not introduce simultaneous cross-user live editing.

These ACLs apply to private server storage. Google Drive and OneDrive sharing remains managed by the provider.

### 🛡️ Data and roles

Each user has a separate workspace. Passwords use scrypt hashes and session IDs are stored hashed. Provider passwords and OAuth/refresh credentials are encrypted on the server; private file contents remain encrypted, while metadata stays in SQLite. Administrators have no automatic in-app access to other users' private content. Deleting a user removes local data/shares after explicit confirmation; remote mailbox and cloud contents are not deleted.

This is not end-to-end encryption: someone with full server and encryption-key access can access the data. Protect the data volume, keys and backups and use HTTPS.
