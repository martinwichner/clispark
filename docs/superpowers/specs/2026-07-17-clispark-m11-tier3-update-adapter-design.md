# M11 Tier 3: Update-System vom oclif/TypeScript-Template entkoppeln

## Kontext

Das M11-Code-Qualitäts-Audit (2026-07-17) identifizierte das Update-System (`src/update/manifest.ts`, `update.ts`, `update-package-json.ts`, `reconcile.ts`) als größte strukturelle Bremse der Erweiterbarkeit: `CORE_FILE_PATHS`, `CORE_SCRIPT_NAMES` und die komplette Merge-Logik gehen fest von `package.json` und oclif-spezifischen Feldern (`oclif`-Key) aus.

Auslöser dieser Design-Session: der Nutzer möchte grundsätzlich weitere Sprachen unterstützen (.NET-CLIs, PowerShell), nicht nur Node-Projekte. Ein konkretes zweites Template steht noch nicht an — dieser Meilenstein liefert ausschließlich die Vorbedingung dafür (siehe "Offene Fragen" im Hauptplan), nicht das zweite Template selbst.

## Ziel

`update.ts` und `manifest.ts` sollen nach diesem Umbau keine npm/oclif-Kenntnis mehr im generischen Code enthalten. Alles Format-/Sprachspezifische steckt hinter einem `UpdateAdapter`-Interface, mit genau einer konkreten Implementierung (dem heutigen Node/oclif-Verhalten, unverändert im Ergebnis).

## Architektur

Neues Interface `UpdateAdapter` (bewusst `Update-`, nicht `Template-Adapter` — der Scope ist nur das Update-System, nicht Scaffold-Engine oder Wizard). Es bündelt:

- die Liste der Kern-Dateipfade (bisher `CORE_FILE_PATHS`)
- die Zuordnung Template-Speicherpfad → Zielpfad (bisher `templateSourcePath()`, deckt z.B. den `.gitignore`-Sonderfall ab)
- Lesen/Schreiben des Paket-Manifests im Zielprojekt (bisher hart `package.json`)
- Extrahieren der "Kern-Felder" aus einem frisch gelesenen Manifest (bisher `extractCoreFields()`)
- Drei-Wege-Merge des Paket-Manifests (bisher `mergePackageJson()`)

`update.ts`, `manifest.ts` und `scaffoldProject()`s Manifest-Aufbau nehmen den Adapter injiziert entgegen — gleiches DI-Muster wie die bestehenden `ScaffoldDeps`/`UpdateDeps`. Es gibt aktuell genau einen konkreten Adapter: `src/update/adapters/node-oclif.ts`.

`reconcile.ts` bleibt unverändert — der Drei-Wege-Merge-Algorithmus (`reconcileEntry`, `stringEquals`, `deepEquals`) ist bereits vollständig generisch (arbeitet auf beliebigen Werten mit injizierbarer Vergleichsfunktion).

## Konkrete Änderungen

- **`src/update/adapters/node-oclif.ts`** (neu): enthält den kompletten heutigen npm/oclif-spezifischen Code — `CORE_FILE_PATHS`, `CORE_SCRIPT_NAMES`, `templateSourcePath()`, sowie die Merge-Funktion (heutiges `update-package-json.ts`, inhaltlich fast unverändert, hinter die Interface-Methoden gehängt). `update-package-json.ts` als eigenständige Datei entfällt, geht in dieser Datei auf.
- **`manifest.ts`**: verliert `CORE_FILE_PATHS`, `CORE_SCRIPT_NAMES`, `templateSourcePath()`, `extractCoreFields()` (wandern in den Adapter). `Manifest.coreFields` wechselt von der hart getippten `{ engines: ...; oclif: ... }`-Form zu einem generischen `Record<string, unknown>` — welche Zusatzfelder als "Kern" gelten, bestimmt allein der Adapter. `hashCoreFiles()`/`buildManifest()` nehmen den Adapter als Parameter statt der globalen Konstante zu importieren.
- **`update.ts`**: `updateProject()` bekommt einen Adapter-Parameter (zusätzlich zu den bestehenden `UpdateDeps`), liest/schreibt das Manifest nur noch über Adapter-Methoden. Kein `path.join(targetDir, 'package.json')` mehr im generischen Code.
- **`scaffold.ts`**: `scaffoldProject()`s Aufruf von `buildManifest()` reicht den Adapter durch. `TEMPLATE_DIR`, `npm install`, `npm run build` bleiben unverändert (Scaffold-Engine-Scope, siehe "Bewusst nicht Teil dieser Arbeit").
- **`cli.ts`**: verdrahtet an der Stelle, wo heute implizit "der" Adapter feststeht, explizit den `node-oclif`-Adapter — sichtbare, einfache Anlaufstelle für einen künftigen zweiten Adapter.

## Testing

Bestehende Tests werden auf die neue Struktur angepasst, decken inhaltlich dasselbe Verhalten ab wie heute:
- `manifest.test.ts` (bleibt, testet generischen Teil)
- `update.test.ts` (bleibt, testet generischen Teil mit dem node-oclif-Adapter als Standard-Dependency)
- `update-package-json.test.ts` → `adapters/node-oclif.test.ts` (Umzug, Inhalt weitgehend unverändert)

Neuer Test in `update.test.ts`: ein **Fake-Adapter** (Minimal-Stub mit einer komplett anderen Kern-Dateiliste und anderen Feldnamen als node-oclif) beweist, dass `updateProject()` wirklich generisch ist und nicht implizit doch `package.json`/`oclif`-Feldnamen erwartet. Das ist die entscheidende Verifikation für "wirklich entkoppelt", nicht nur umbenannt — ohne diesen Test ließe sich ein versehentlich stehengebliebener harter Verweis leicht übersehen.

Zusätzlich: echte End-to-End-Verifikation wie bei jedem vorherigen Meilenstein (frischer Scaffold, `update` gegen ein simuliertes Alt-Projekt, `releasenotes` unverändert) — beweist, dass sich am Verhalten für Node/oclif-Projekte nichts geändert hat.

## Bewusst nicht Teil dieser Arbeit

- **Kein zweiter echter Adapter** (.NET/PowerShell) — bleibt spekulativ, bis ein konkretes zweites Template ansteht (YAGNI, wie in den "Offenen Fragen" des Hauptplans festgehalten).
- **Keine Wizard-Sprachauswahl, kein `templateId`-Feld im Manifest** zur Adapter-Auswahl — mit nur einem Adapter unnötig; kommt als kleiner Folgeschritt, sobald ein zweites Template real existiert.
- **`scaffoldProject()`s `npm install`/`npm run build` und `TEMPLATE_DIR`** bleiben hardcodiert — das ist Scaffold-Engine-Scope, nicht Update-System-Scope, und explizit nicht Teil dieser Design-Session (siehe Entscheidung, den Scope auf Tier 3 statt der kompletten Mehr-Sprachen-Architektur zu begrenzen).

## Ergebnis

Nach diesem Umbau: ein neues zweites Template braucht künftig "nur" einen neuen `UpdateAdapter` plus die noch offene Scaffold-/Wizard-Anbindung (separate, spätere Design-Session) — nicht mehr zwingend Änderungen an `update.ts`/`manifest.ts` selbst.
