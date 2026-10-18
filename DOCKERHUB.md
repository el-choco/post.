# 🐳 post. auf Docker Hub veröffentlichen

Version 1.5.5 aktualisiert die Mail-Liste automatisch, wenn eine geöffnete Nachricht nicht mehr verfügbar ist. Seit Version 1.5.4 bleiben ungenutzte IMAP-Verbindungen fünf Minuten erhalten; die Diagnose trennt Netzwerk- und Sitzungsaufbau. Seit Version 1.5.3 gibt es Verbesserungen für die Übernahme freier IMAP-Verbindungen und den Abbruch verlassener Listenabrufe. Seit Version 1.5.2 gibt es das Diagnoseprotokoll in den Einstellungen. Seit Version 1.5.1 gibt es Verbesserungen am Mailabruf und der Fehleranzeige (siehe PERFORMANCE.md). Seit Version 1.5.0 gibt es den Theme-Editor für Farben, Schriftart und Schriftgröße. Seit Version 1.4.0 gibt es die optionale ONLYOFFICE-Anbindung (siehe ONLYOFFICE.md). Seit Version 1.3.0 gibt es den Dateimanager mit verschlüsseltem privatem Speicher, Google Drive und OneDrive. Die Dateieinrichtung steht in FILES.md. Die Anbieter-Konfiguration steht in [CALENDAR.md](CALENDAR.md).

Die Anwendung verwendet zwei Images:

| Bestandteil               | Repository                      |
| ------------------------- | ------------------------------- |
| Oberfläche und Nginx      | `paquele/post-webmail-frontend` |
| API, IMAP/SMTP und SQLite | `paquele/post-webmail-backend`  |

Die Befehle im Projektverzeichnis ausführen. Docker muss laufen und Linux-Container verwenden. Zum Bauen werden die Projektdateien einschließlich beider `package-lock.json` benötigt.

## 🔑 1. Bei Docker Hub anmelden

Auf Docker Hub die beiden Repositories `post-webmail-frontend` und `post-webmail-backend` im Namespace `paquele` anlegen. Sichtbarkeit nach Bedarf wählen; bei privaten Repositories benötigt auch der Server eine Anmeldung.

```sh
docker login --username paquele
```

Bei der Passwortabfrage einen Docker-Hub-Zugriffstoken mit Schreibberechtigung verwenden. Den Token nur in der interaktiven Abfrage eingeben, nicht in Projektdateien oder Befehle schreiben.

## 🏗️ 2. Images bauen und veröffentlichen

Die Compose-Datei verwendet standardmäßig `latest`. Für eine nachvollziehbare Veröffentlichung beide Images ausdrücklich als Version `1.5.5` und `latest` bauen:

```sh
docker build --pull -t paquele/post-webmail-frontend:1.5.5 -t paquele/post-webmail-frontend:latest ./frontend
docker build --pull -t paquele/post-webmail-backend:1.5.5 -t paquele/post-webmail-backend:latest ./backend

docker push paquele/post-webmail-frontend:1.5.5
docker push paquele/post-webmail-backend:1.5.5
docker push paquele/post-webmail-frontend:latest
docker push paquele/post-webmail-backend:latest
```

Damit werden beide Images für die Architektur der verwendeten Docker-Engine gebaut und hochgeladen. Ein Fehler muss vor dem nächsten Schritt behoben werden.

### 🏷️ Zusätzlich als `latest` veröffentlichen

Nach erfolgreichem Build und Upload von `1.5.5`:

```sh
docker tag paquele/post-webmail-frontend:1.5.5 paquele/post-webmail-frontend:latest
docker tag paquele/post-webmail-backend:1.5.5 paquele/post-webmail-backend:latest
docker push paquele/post-webmail-frontend:latest
docker push paquele/post-webmail-backend:latest
```

Versions-Tags für spätere Updates erhöhen, beispielsweise auf `1.5.6`. `latest` kann anschließend auf die neue Version zeigen. Ein veröffentlichtes Versions-Tag möglichst nicht nachträglich ersetzen.

## 🌍 Optional: AMD64 und ARM64 gemeinsam veröffentlichen

Diese Variante ersetzt den Build und Upload aus Schritt 2. Sie erstellt Images für Intel/AMD-Server und ARM64-Geräte. Docker Desktop bringt die benötigte Emulation mit; auf anderen Build-Rechnern müssen passende native Build-Nodes oder QEMU eingerichtet sein. Der native SQLite-Build kann unter Emulation länger dauern.

Einmalig einen Buildx-Builder erstellen:

```sh
docker buildx create --name post-webmail-builder --driver docker-container --use --bootstrap
```

Ist der Builder bereits vorhanden, stattdessen auswählen:

```sh
docker buildx use post-webmail-builder
docker buildx inspect --bootstrap
```

Beide Images mit Versions- und `latest`-Tag bauen und direkt hochladen:

```sh
docker buildx build --pull --platform linux/amd64,linux/arm64 --tag paquele/post-webmail-frontend:1.5.5 --tag paquele/post-webmail-frontend:latest --push ./frontend
docker buildx build --pull --platform linux/amd64,linux/arm64 --tag paquele/post-webmail-backend:1.5.5 --tag paquele/post-webmail-backend:latest --push ./backend
```

Die Images werden direkt in die Registry geschrieben und müssen anschließend zum lokalen Start gepullt werden. Mit dieser Variante ist der separate `docker tag`/`docker push`-Schritt nicht nötig.

## 🚀 3. Auf dem Server starten

Für den Betrieb mit fertigen Images werden nur `docker-compose.yml` und bei eigenen Einstellungen eine `.env` benötigt. Die Build-Datei und der Quellcode müssen nicht auf dem Server liegen.

Beispiel für die `.env`:

```dotenv
DOCKERHUB_NAMESPACE=paquele
WEBMAIL_VERSION=1.5.5
WEBMAIL_PORT=8886
# Nur setzen, wenn du bereits dieses Datenverzeichnis verwendest:
# WEBMAIL_DATA_DIR=/mnt/seagate/webmail/data
```

**Eine bestehende `.env` ergänzen, nicht durch die Beispieldatei überschreiben.** Das bisherige Datenverzeichnis und den Compose-Projektnamen beibehalten, damit dieselbe Datenbank verwendet wird. Auch ein standardmäßig verwendetes Docker-Volume hängt am Compose-Projektnamen. Vor dem Update eine konsistente Sicherung des vollständigen Datenverzeichnisses inklusive `secret.key` erstellen.

```sh
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

Die Webmail ist unter `http://SERVER-IP:8886` erreichbar. Für Internetzugriff HTTPS über einen Reverse-Proxy verwenden. Bei privaten Images vorher auf dem Server `docker login --username paquele` ausführen.

## 🔄 4. Spätere Updates

Nach Veröffentlichung einer neuen Version `WEBMAIL_VERSION` in der Server-`.env` anpassen:

```dotenv
WEBMAIL_VERSION=1.5.5
```

Danach:

```sh
docker compose pull
docker compose up -d
```

Die Container werden bei geänderten Images ersetzt; das konfigurierte Datenvolume bleibt eingebunden. Kein `docker compose down -v` verwenden, wenn die Daten erhalten bleiben sollen. Die Startseite fordert eine erneute Browserprüfung an; eine bereits geöffnete Seite bei Bedarf mit STRG+F5 aktualisieren.

## 🔍 Kontrolle und Protokolle

```sh
docker buildx imagetools inspect paquele/post-webmail-frontend:1.5.5
docker buildx imagetools inspect paquele/post-webmail-backend:1.5.5
docker compose logs --tail=100
```

## 📚 Docker-Dokumentation

- [Images veröffentlichen](https://docs.docker.com/reference/cli/docker/compose/push/)
- [Docker-Login](https://docs.docker.com/reference/cli/docker/login/)
- [Buildx und Registry-Upload](https://docs.docker.com/reference/cli/docker/buildx/build/)
- [Mehrere Plattformen](https://docs.docker.com/build/building/multi-platform/)
