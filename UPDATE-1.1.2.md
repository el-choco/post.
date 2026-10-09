# 📬 post. 1.1.2 installieren

Diese Version öffnet Kontakte und Einstellungen in der Hauptfläche. In der Listenansicht öffnet sich eine Mail mit „Zurück zur Liste“. Anhänge stehen unter dem Mailkopf und lassen sich herunterladen. Die HTML-Vorschau und die Antwortleiste überlagern sich nicht mehr.

## Dateien übertragen

Das Paket `post-webmail-1.1.2.zip` enthält den vollständigen benötigten Build-Quellcode. Keine Datenbanken, Zugangsdaten, persönlichen Kontakte oder `.env` sind enthalten. Den Inhalt in den Projektordner des Build-Servers übertragen, beispielsweise `/mnt/seagate/webmail`.

Die bestehende `.env` und das Datenverzeichnis beibehalten. Auf dem bisherigen Server die vorhandene Volume-Zuordnung nicht ändern. Für das Bauen und Veröffentlichen sind die beiden Projektordner `frontend` und `backend` ausreichend; die Befehle unten verwenden keine Compose-Datei.

## Images bauen, prüfen und hochladen

Die Schritte auf dem Build-Server ausführen. Bei einem Fehler vor dem nächsten Schritt stoppen.

```bash
cd /mnt/seagate/webmail

docker build --pull --no-cache -t paquele/post-webmail-frontend:1.1.2 ./frontend
docker build --pull --no-cache -t paquele/post-webmail-backend:1.1.2 ./backend

docker run --rm --entrypoint cat paquele/post-webmail-frontend:1.1.2 /usr/share/nginx/html/version.json
docker run --rm --entrypoint node paquele/post-webmail-backend:1.1.2 -p 'require("./package.json").version'

docker login --username paquele
docker push paquele/post-webmail-frontend:1.1.2
docker push paquele/post-webmail-backend:1.1.2
```

Beide Prüfungen müssen Version `1.1.2` anzeigen. Ein manuelles Umbenennen alter Images mit `docker tag webmail-frontend …` ist nicht erforderlich. Die frisch gebauten Images tragen bereits den richtigen Namen.

## Portainer-Testinstallation aktualisieren

Im bestehenden Stack die beiden Image-Zeilen auf diese Werte setzen:

```yaml
image: paquele/post-webmail-frontend:1.1.2
```

```yaml
image: paquele/post-webmail-backend:1.1.2
```

Wenn der Stack die Variable `WEBMAIL_VERSION` verwendet, stattdessen `WEBMAIL_VERSION=1.1.2` in den Stack-Umgebungsvariablen setzen. Anschließend den Stack aktualisieren und die Images erneut abrufen lassen. Vorhandene Ports und Volumes beibehalten.

## Laufende Installation prüfen

Bei der genannten Testinstallation:

```bash
curl -fsS http://37.201.118.206:33411/version.json
curl -fsS http://37.201.118.206:33411/api/health
```

Beide Antworten müssen `1.1.2` enthalten. Die Loginseite und die Mailansicht zeigen ebenfalls `v1.1.2`. Danach die Seite mit STRG + F5 neu laden.

Das Erstellen und Hochladen der Images verändert keine laufenden Container. Erst das Aktualisieren des Portainer-Stacks verwendet die neue Version.
