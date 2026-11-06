# DJI Thermal SDK 1.9 – isolierter Vergleich mit SkyHub 1.7

**Status: Testwerkzeug, kein Upgrade und keine Hardwareabnahme.**
Die offizielle [DJI Matrice 4 Series Downloadseite](https://enterprise.dji.com/matrice-4-series/downloads)
listet Thermal SDK **v1.9** (Linux und Windows, veröffentlicht 19.10.2026). Das verlinkte
Archiv heißt dji_thermal_sdk_v1.9_20260526.zip. Die Angabe Linux belegt nicht automatisch
native ARM64-Kompatibilität. Paketinhalt, Symbol-ABI, Abhängigkeiten und
Pi-5-/box64-Fähigkeit müssen an den tatsächlich bezogenen Dateien geprüft werden.

## Hintergrund

SkyHub Next benutzt einen eigenen, isolierten box64-Service mit dji_irp 1.7.
Der Service hat einen internen Bearer-Token und ist auf das private Netz begrenzt.
Der Vergleich testet zwei unterschiedliche lokale SDK-Verzeichnisse, ohne
die laufende Container-/Compose-Instanz zu ändern.

Die Auswertung liest nur zwei Float32-Temperaturmatrizen (°C), die durch zwei
SDK-Aufrufe mit identischen CLI-Parametern aus derselben R-JPEG-Datei
erzeugt wurden. Sie prüft Byteanzahl, Auflösung, endliche plausible
Temperaturen, Min/Mittel/Median/Max und die Verteilung absoluter Pixeldifferenzen.
Die Schwellen P95 0,5 K und Maximum 2 K sind **Regressionstest-Grenzen**,
keine Hersteller-Toleranzen und kein Beleg der absoluten Temperaturgenauigkeit.
Abweichungen können legitime Kalibrieränderungen oder Fehler bedeuten.

## Voraussetzungen

1. DJI TSDK v1.9 selbst von DJI beziehen, Lizenz/EULA prüfen und **nicht** ins
   SkyHub-Repository übernehmen. Native Dateien und Testbilder mit vertraulichen
   Positionsdaten bleiben lokal.
2. Beide Versionen getrennt installieren, jeweils mit bin/dji_irp und zugehörigen
   Bibliotheken. Das bisherige v1.7-Verzeichnis keinesfalls überschreiben.
3. Auf dem Pi das bereits vorhandene Image skyhub-dji-box64:trixie, Docker
   sowie Node.js benutzen. Architektur lokal prüfen mit:
   file /PFAD/ZUM/SDK/bin/dji_irp
4. Ein lokales echtes M4T-R-JPEG auswählen; Dimensionen müssen der
   SDK-Temperaturmatrix entsprechen.

## Pi 5: vergleichende Einzelbildprüfung (ausschließlich manuell)

Beide SDKs werden mit identischen Parametern ausgeführt. Vor dem ersten
SDK-Aufruf erstellt der Runner **genau eine private, temporäre Kopie** des
R-JPEG. Beide isolierten SDK-Aufrufe lesen ausschließlich diese Kopie, nicht
den veränderlichen Originalpfad. So werden keine unterschiedlichen Bildstände
verglichen, wenn die Quelldatei zwischen den beiden Durchläufen extern ersetzt
wird. Das Original bleibt unverändert; der JSON-Quellhash bezieht sich auf
die tatsächlich verwendete Kopie. Die Kopie wird nach dem Vergleich gelöscht.

Beide SDKs haben nur Lesezugriff auf die eingefrorene Kopie und ihre nativen
Dateien. Der vorhandene scripts/dji-tsdk-run.sh setzt den Timeout von der
nativen Host-Seite. SDK-Container und temporäre Rohausgaben werden bei
Fehlern entfernt. Der Snapshot vermeidet Änderungen durch normale externe
Dateirotation; er ist kein Schutz gegen mutwillige Manipulationen durch
privilegierte Prozesse während der SDK-Ausführung.

    cd ~/Projekte/SkyHub-Next
    node --test backend/test/dji-tsdk-parity-audit.test.js
    bash -n scripts/dji-tsdk-parity-run.sh
    bash scripts/dji-tsdk-parity-run.sh \
      --baseline-sdk "$HOME/.local/opt/dji-tsdk" \
      --candidate-sdk "$HOME/.local/opt/dji-tsdk-v1.9" \
      --input "/PFAD/ZU/EINEM/M4T_T.JPG" \
      --width 640 --height 512 \
      --emissivity 0.95 --distance 5 --humidity 70 \
      --ambient 25 --reflection 23 \
      --p95-limit-k 0.5 --max-limit-k 2

Die Beispielpfade sind anzupassen. Die optionale Angabe
--report /PFAD/ZU/NEUEM/report.json
speichert einen JSON-Nachweis mit SHA-256 des Quellbilds und der beiden
Ergebnismatrizen, ohne Dateiinhalte. Vorhandene Reports werden nie
überschrieben. Ohne Report wird JSON nur an stdout ausgegeben.

Alternativ kann man bereits vorhandene Float32-Matrizen rein lesend auswerten:

    node scripts/dji-tsdk-parity-audit.js \
      --baseline /PFAD/TSDK17.raw --candidate /PFAD/TSDK19.raw \
      --source /PFAD/M4T_T.JPG --width 640 --height 512

Dabei wird nicht nachgewiesen, dass die Matrizen tatsächlich von den
SDK-Versionen oder exakt dieser Bilddatei stammen. Nur der gekoppelte
Pi-Runner stellt identische Eingaben beim direkten Vergleich sicher.

## Interpretation und Freigabegrenzen

- PASS: Formal korrekte Matrizen, Differenzen unter den Schwellenwerten.
  Kein Beweis für die absolute Genauigkeit oder andere Kamera-/Firmwaremodelle.
- FAIL: Unterschied über Schwellenwert. Prüfen statt automatisch umzustellen.
- Exit 2: Ungültige Dateien, Matrixgrößen, Parameter oder Messwerte.
- Ein SDK-Fehler, Timeout oder Segfault bricht den Vergleich ab;
  der produktive Dienst bleibt unangetastet.
- Freigabe erst nach Modell-/Firmware-Kohorten, ABI-/Abhängigkeitsprüfung,
  Referenzmessungen und Laufzeit-/Timeout-Tests. accuracyVerified bleibt false.
