# M12: Language-Pack-Architektur + .NET-Template

> **Update (2026-07-19, vor M12b-Umsetzung):** M12a ist seit diesem Datum bereits abgeschlossen (`v1.10.0`). Der Abschnitt "Offene Recherchepunkte für die Umsetzung" wurde durch echte Recherche aufgelöst und durch den Abschnitt "M12b: Geklärte Punkte vor Umsetzung" ersetzt/ergänzt — dort stehen jetzt die tatsächlichen Antworten statt offener Fragen. Der Rest des Dokuments (Architektur, .NET-Template-Inhalt, NuGet-Adapter/Checker) bleibt inhaltlich wie am 18.07. entworfen und gilt weiterhin, bis auf die dort explizit vermerkten Änderungen (XML-Update-Strategie, Target Framework).

## Kontext

M11 Tier 3 (2026-07-18 gemergt, v1.9.0) hat das Update-System vom oclif/TypeScript-Template entkoppelt, aber bewusst nur das Update-System — Scaffold-Engine und Wizard blieben explizit Node/npm-spezifisch, als separate, spätere Design-Session zurückgestellt.

Auslöser dieser Session: der Nutzer hat jetzt echte Nachfrage für zwei weitere Sprachen (.NET, PowerShell) bestätigt, mit dem expliziten Ziel, dass sich beliebig weitere Sprachen später einfach ergänzen lassen — nicht nur diese zwei.

## Scope

**Diese Session deckt ab:**
1. Die generische "Language Pack"-Architektur (Wizard-Sprachauswahl, Scaffold-Engine-Generalisierung, Registry-Check-Abstraktion)
2. Das .NET-Template als ersten echten Konsumenten dieser Architektur — bewusst zusammen mit der Architektur entworfen, damit das Interface nicht rein spekulativ entsteht (gleiches Prinzip wie beim `UpdateAdapter`, der erst mit einem echten zweiten Fall seine Generizität beweisen kann)

**Explizit nicht Teil dieser Session:**
- Das PowerShell-Template selbst — kommt als separate, günstigere Folge-Session, sobald das Muster durch das .NET-Template bewiesen ist (PowerShell dient hier nur als Sanity-Check, dass die Architektur wirklich für eine dritte, strukturell andere Sprache trägt — siehe "PowerShell-Sanity-Check" unten)
- Jegliche Release-Automatisierung/CI-CD für generierte Projekte (siehe "Bewusst nicht Teil dieser Arbeit")
- Volle .NET-Command-Registrierungs-Feinarchitektur über das hier beschriebene Maß hinaus — Details, die sich erst bei der Implementierung ergeben, gehören in den Implementierungsplan, nicht hierher

## Architektur-Überblick

Neues Interface `LanguagePack` (in `src/languages/pack.ts`) bündelt alles Sprachspezifische, das heute in `scaffold.ts`/`wizard.ts`/`cli.ts` fest verdrahtet ist:

```ts
interface LanguagePack {
  id: string;                              // 'node' | 'dotnet' | ...
  displayName: string;                     // Wizard-Auswahlliste
  templateDir: string;                     // ersetzt das heute feste TEMPLATE_DIR
  scaffoldCommands: ScaffoldCommand[];      // z.B. dotnet restore/build; leer für interpretierte Sprachen
  validateProjectName(value: string): string | undefined;  // sprachspezifische Namenskonvention
  updateAdapter: UpdateAdapter;             // bereits bestehendes Interface aus M11 Tier 3, unverändert
  registry: LanguageRegistry;               // Name-Check + Prompt-Copy, siehe unten
}

interface LanguageRegistry {
  defaultUrl: string;
  promptLabel: string;                      // z.B. "Custom npm registry URL" vs. "Custom NuGet feed URL"
  checkNameAvailability(name: string, registryUrl: string): Promise<NameCheckResult>;
  applyPrivateIntent(targetDir: string): Promise<void>;  // z.B. "private": true bzw. <IsPackable>false</IsPackable>
}
```

Eine kleine Lookup-Map `LANGUAGE_PACKS: Record<string, LanguagePack>` (`src/languages/index.ts`) verdrahtet die konkreten Packs explizit — gleiches DI-Prinzip wie beim `UpdateAdapter` (Pflichtparameter, kein Default, explizite Verdrahtung an den Einstiegspunkten). `wizard.ts`, `scaffold.ts` und `cli.ts` werden generisch: sie lesen aus dem gewählten/erkannten Pack statt Sprache hart zu verdrahten. Die Wizard-Auswahlliste zeigt ausschließlich Sprachen, für die tatsächlich ein Pack existiert — kein Platzhalter für "coming soon".

**Sprach-Erkennung für `update`/`releasenotes`:** Diese Befehle laufen innerhalb eines bereits gescaffoldeten Projekts und müssen automatisch das richtige Pack wählen, ohne dass der Nutzer es angeben muss. Lösung: `.clispark/manifest.json` bekommt ein neues Feld `language: string`, beim Scaffold gesetzt. `cli.ts` liest das Manifest zuerst, wählt darüber das Pack. **Rückwärtskompatibilität:** Manifeste ohne `language`-Feld (alle heute bereits gescaffoldeten Node-Projekte) werden als `language: 'node'` interpretiert — bestehende Projekte funktionieren mit `clispark update` unverändert weiter, kein Fehler, kein Re-Scaffold nötig.

## Ordnerstruktur

Spiegelt konsequent das bereits bewährte `update/adapter.ts` + `update/adapters/`-Muster:

```
src/
  languages/
    pack.ts                  # LanguagePack-Interface
    registry-checker.ts      # RegistryChecker-Interface + NameCheckResult (verschoben aus registry.ts)
    registry-checkers/
      npm.ts                 # heutige registry.ts-Logik, verschoben
      nuget.ts                # neu
    packs/
      node-oclif.ts           # bündelt templates/node + update/adapters/node-oclif + registry-checkers/npm
      dotnet.ts                 # bündelt templates/dotnet + update/adapters/dotnet + registry-checkers/nuget
    index.ts                  # LANGUAGE_PACKS-Lookup-Map + getPackById()
  update/
    adapters/
      node-oclif.ts            # unverändert
      dotnet.ts                 # neu
  scaffold.ts                   # generalisiert, nimmt LanguagePack als Pflichtparameter
  wizard.ts                     # generalisiert, Sprachauswahl als erste Frage
  cli.ts                        # generalisiert, erkennt Sprache aus Manifest für update/releasenotes

templates/
  node/                        # umbenannt von base/ — "base" war irreführend, sobald mehrere Templates existieren
  dotnet/                       # neu
```

`templates/base/` → `templates/node/`: rein mechanischer Umzug (gleiches Muster wie der M6-`src/update/`-Umzug), aber berührt mehrere Pfad-Referenzen (`TEMPLATE_DIR`, Doku, ggf. Skripte) — als expliziter erster Task im Implementierungsplan vorzusehen.

## Wizard-Ablauf

Neue erste Frage: Sprachauswahl (Liste aus `LANGUAGE_PACKS`). Danach bleibt der Ablauf strukturell wie heute, aber generisch aus dem gewählten Pack gespeist:

1. **Sprache** (neu, zuerst)
2. **Projektname** — Validierung kommt aus `pack.validateProjectName` statt einer global fest codierten npm-Regel (siehe "Projektname-Validierung" unten)
3. **Profil** (Arbeit/Privat) — unverändert, sprachunabhängig
4. **Registry-URL** — Label/Default aus `pack.registry`
5. **Publish-Intent** — Frage bleibt sprachneutral formuliert, Verhalten (Name-Check, "privat markieren") delegiert an `pack.registry`

`WizardAnswers` bekommt ein neues Feld `language: string`.

## Projektname-Validierung

Die heutige `validateProjectName` (npm-Style: lowercase-mit-Bindestrichen) ist für .NET unidiomatisch (dort üblich: PascalCase, z.B. `MyTool`). Validierung wandert deshalb vom globalen `wizard.ts` ins jeweilige `LanguagePack`. Für .NET: eine Eingabe (PascalCase) im Wizard, daraus abgeleitet:
- Projekt-/Assembly-/Namespace-Name: wie eingegeben (`MyTool`)
- NuGet `PackageId`: gleicher Wert als Default, keine erzwungene Punkt-Namespace-Konvention
- `ToolCommandName` (tatsächlich aufgerufener Befehl): lowercased (`mytool`) — eigene Konvention von clispark, keine .NET-SDK-Vorgabe, mirrort aber das npm-bin-name-Verhalten

## Scaffold-Engine-Generalisierung

`scaffold.ts` verliert das feste `TEMPLATE_DIR` sowie die hart codierten `npm install`/`npm run build`-Aufrufe:

- `copyTemplate()`/`scaffoldProject()` nehmen `LanguagePack` als Pflichtparameter (kein Default), nutzen `pack.templateDir`
- `git init`/`git add`/`git commit` bleiben universell im generischen Code
- Install/Build wird eine generische Schleife über `pack.scaffoldCommands` (z.B. `[{cmd:'dotnet',args:['restore']},{cmd:'dotnet',args:['build']}]`; leeres Array für Sprachen ohne Build-Schritt — validiert am PowerShell-Sanity-Check)
- `buildManifest()` bekommt zusätzlich `language: pack.id`
- `replacePlaceholdersInTree()` bleibt unverändert — scannt bereits den kompletten kopierten Baum, ist schon sprachunabhängig

## .NET-Template-Inhalt

**Paketierung:** `dotnet tool install -g`-globales Tool (direktes Äquivalent zu `npx`/globalem npm-Install), Veröffentlichung über NuGet.org.

**Target Framework:** `net10.0` (aktuelles LTS, Stand Juli 2026) — konsistent mit der "immer aktuell"-Haltung des Projekts (Node >=24, TypeScript Everywhere).

**Projektstruktur:** Solution mit zwei Projekten — `src/Cli.csproj` (Haupt-Tool, wird gepackt) + `tests/Cli.Tests.csproj` (xUnit, referenziert das Hauptprojekt) + `Cli.sln`. Entspricht gängiger .NET-Konvention (Tests leben nicht neben dem Code wie bei vitest). **Wichtig:** Datei-/Ordnernamen sind fest, unabhängig vom gewählten Projektnamen (`src/Cli.csproj` heißt immer so) — der Projektname landet nur in MSBuild-Properties (`PackageId`, `AssemblyName`, `RootNamespace`) innerhalb der Dateien. Gleiches Prinzip wie bei `package.json`, dessen Pfad sich nie ändert, nur der `name`-Feldinhalt.

**Auto-Discovery:** Marker-Interface `ICliCommand` (Methode `Command Build()`, liefert ein konfiguriertes `System.CommandLine.Command`) plus `[Command("task list")]`-Attribut zur expliziten Deklaration des Aufrufpfads (Klassenname allein reicht bei verschachtelten Subcommands nicht). `Program.cs` scannt beim Start die Assembly per Reflection nach allen `ICliCommand`-Implementierungen und registriert sie automatisch am `RootCommand` — funktional das Gleiche wie oclifs dateisystembasierte Discovery, nur kompilierungsbedingt über Reflection statt Dateisystem-Scan. Dieses Prinzip ("Command-Datei ablegen → automatisch erkannt") gilt als Architektur-Vorgabe für **jedes** Sprach-Pack, auch wenn die Implementierung pro Sprache zwangsläufig unterschiedlicher Code ist.

**Fehlerbehandlung:** Kein Klassenvererbungsmodell wie oclifs `BaseCommand` (System.CommandLine arbeitet anders), stattdessen ein zentraler Ausführungs-Wrapper um die Root-Command-Invocation: fängt `CliUserException` (Äquivalent zu `UserError`) ab → sauberes `Error: <message>` ohne Stacktrace, Exit-Code 1; alles andere → volle Details. Gleiche UX-Prinzipien wie das etablierte M2.5/M8-Verhalten. Logger wird injiziert über einen leichtgewichtigen `Microsoft.Extensions.DependencyInjection`-Container (kein vollständiger Generic Host).

**Logging (Serilog):** Datei-Sink + `DEBUG`-gesteuertes Live-Konsolen-Streaming, Retention-Sweep, restriktive Datei-Rechte unter Unix — mechanisch die gleiche Logik wie `templates/node/src/logger.ts`, in Serilog-Idiomen. Das .NET-Äquivalent zu `env-paths` (`Xdg.Directories`) und der Redaction-Ansatz (eigener `ILogEventEnricher`) sind geklärt, siehe "M12b: Geklärte Punkte vor Umsetzung" unten.

**Beispiel-Commands:** Analog zu `hello.ts`/`task.ts` — Argumenttyp-Katalog in der ARCHITECTURE.md (Pflicht-String-Argument, optionales Argument mit erlaubten Werten, Boolean-Flag, Integer-Argument, Subcommand-Verschachtelung).

## NuGet-`UpdateAdapter`

Der Adapter-Code selbst ist TypeScript (Teil von clispark, nicht des generierten .NET-Projekts) — er liest/schreibt/parst das `.csproj` des Zielprojekts als XML-Text.

**Was ist "das Manifest"?** Nur `src/Cli.csproj` (nicht das Test-Projekt) — enthält `<Version>`, `<PackageId>`, `<PackAsTool>`, `<ToolCommandName>`, `<TargetFramework>` (Engines-Äquivalent), `<PackageReference>`-Einträge (Dependencies-Äquivalent). `tests/Cli.Tests.csproj` wird wie jede andere Kern-Datei per Content-Hash behandelt (ersetzen/überspringen), kein Feld-Merging.

**`coreFields`:** Nur `{ TargetFramework: string }`. **Nicht** `ToolCommandName`/`PackageId` — das sind Identitäts-Felder, einmalig beim Scaffold gesetzt, analog zu `package.json`s `name`-Feld, das ebenfalls nie in `coreFields` landet.

**Drei-Wege-Merge:** Läuft über die bestehende, generische `reconcileEntry`/`stringEquals`/`deepEquals`-Logik aus `reconcile.ts` — **keine Änderung nötig**. Dependencies (Name→Version-String) und `TargetFramework` (einzelner String statt Objekt wie `engines`) passen 1:1 in die bestehende Merge-Logik.

**XML-Update-Strategie (2026-07-19 entschieden — Änderung gegenüber dem ursprünglichen Entwurf):** Keine DOM-Bibliothek, keine neue npm-Dependency. Da clispark die `.csproj`-Datei selbst erzeugt (Format/Einrückung bekannt und vollständig unter eigener Kontrolle), reicht gezielte Text-/Regex-Ersetzung bekannter Tags (`<Version>`, `<TargetFramework>`, einzelne `<PackageReference>`-Elemente) — der Rest der Datei bleibt byte-identisch, keine Formatierungs-Drift. Die bestehende `UpdateAdapter`-Schnittstelle (`src/update/adapter.ts`) typisiert die Manifest-Repräsentation ohnehin als `unknown`, passt also ohne jede Interface-Änderung: `parseManifestFile(rawContent)` liefert ein Objekt `{ raw: string, version, targetFramework, packageReferences, packageId, toolCommandName }` (Werte per Regex extrahiert), `mergeManifestFile()` läuft unverändert über die bestehende Reconcile-Logik (identisch zum Node-Adapter-Muster), `writeManifestFile()` schreibt die gemergten Werte per gezielter Regex-Ersetzung zurück in den `raw`-String und persistiert das Ergebnis. Ein DOM-Ansatz (z.B. `@xmldom/xmldom`) wurde bewusst verworfen: laut Recherche verändert dessen Reserialisierung teilweise Whitespace/Attribut-Reihenfolge, was hier unnötige Diffs erzeugen würde.

## NuGet-`RegistryChecker`

**Name-Verfügbarkeit:** `GET https://api.nuget.org/v3-flatcontainer/{lowercase-package-id}/index.json` — 200 mit Versions-Array = vergeben, 404 = frei. Direktes Äquivalent zum heutigen npm-Check. Bekannter, seltener NuGet-Fehlerfall (fälschliches "BlobNotFound" trotz existierendem Paket, [NuGet/NuGetGallery#9105](https://github.com/NuGet/NuGetGallery/issues/9105)) — passt zur bestehenden `NameCheckResult`-Semantik: bei uneindeutigem Ergebnis `'unverified'` statt hart zu scheitern, wie der npm-Checker es heute schon macht.

**Publish:** Bewusst **nicht** Teil dieses Scopes (siehe "Bewusst nicht Teil dieser Arbeit") — clispark prüft nur die Namensverfügbarkeit, das eigentliche Veröffentlichen bleibt Sache des Nutzers.

## PowerShell-Sanity-Check

Kein PowerShell-Code in dieser Session, nur Gegenprobe, dass `LanguagePack` wirklich für eine dritte, strukturell andere Sprache trägt: `scaffoldCommands: []` (kein Build-Schritt), ein `.psd1`-Modul-Manifest-`UpdateAdapter` (drittes Datenformat — PowerShell-Data-Syntax statt JSON/XML, passt aber genau in die `unknown`-getypten Interface-Methoden), ein PowerShell-Gallery-`RegistryChecker`, dateisystembasierte Auto-Discovery (dot-sourcing aller Dateien in einem `Public/`-Ordner — näher an oclifs Original-Prinzip als .NETs Reflection-Ansatz). Alles passt ohne Interface-Änderung.

## Bewusst nicht Teil dieser Arbeit

- **Das PowerShell-Template selbst** — separate, günstigere Folge-Session, sobald das Muster durch .NET bewiesen ist.
- **Jegliche Release-Automatisierung für generierte Projekte** (NuGet Trusted Publishing, GitHub-Actions-Publish-Workflows o.ä.) — clispark scaffoldet schon heute keine CI/CD in generierte Node-Projekte, das ändert sich nicht. Der Nutzer kümmert sich selbst um das Publishing seines eigenen Tools.
- **CI/CD-Erweiterung für clispark selbst** (eigenes `.github/workflows` braucht künftig ein .NET SDK für einen Scaffold-Smoke-Test des neuen Templates) — praktischer Umsetzungs-Task, kein Architektur-Thema, gehört in den Implementierungsplan.

## M12b: Geklärte Punkte vor Umsetzung (2026-07-19)

Ersetzt den ursprünglichen "Offene Recherchepunkte"-Abschnitt — alle Punkte wurden per echter Recherche bzw. Nutzerentscheidung aufgelöst, keiner bleibt offen:

- **.NET-Äquivalent zu `env-paths`:** `Xdg.Directories` (NuGet-Paket, ~11 KB, .NET Standard 2.0 + NativeAOT-fähig) — respektiert `XDG_CONFIG_HOME`/`XDG_DATA_HOME` unter Linux, nutzt plattformgerechte Defaults unter Windows/macOS. Direktes Gegenstück zu `env-paths`.
- **pino-artiges `redact` in Serilog:** Recherche bestätigt — kein fertiges Bordmittel oder etabliertes Paket deckt das exakt ab. Braucht einen eigenen kleinen `ILogEventEnricher`, der bekannte sensible Property-Namen (Äquivalent zu `SENSITIVE_LOG_KEYS`) vor dem Schreiben maskiert. Keine neue NuGet-Dependency für clispark selbst nötig (das ist generierter .NET-Code, keine clispark-eigene Abhängigkeit).
- **XML-Lesen/-Schreiben in clispark selbst:** Keine DOM-Bibliothek — gezielte Regex-Ersetzung, siehe Abschnitt "NuGet-`UpdateAdapter`" oben für Details und Begründung.
- **`ci.yml` braucht ein .NET SDK auf den Runnern:** Bestätigt kein Blocker — `ubuntu-latest`-Runner-Images haben aktuell .NET SDK 8.0.x/9.0.x/10.0.x vorinstalliert (Quelle: `actions/runner-images`-Repo, Ubuntu-24.04-Image). Kein zusätzlicher `actions/setup-dotnet`-Schritt zwingend nötig, kann aber für Versions-Determinismus trotzdem sinnvoll sein — Detail für den Implementierungsplan.
- **Target Framework:** `net10.0` entschieden (siehe .NET-Template-Inhalt oben).
- **`.npmrc`/`LanguageRegistry`-Lücke (Fund aus dem M12a-Whole-Branch-Review):** `scaffold.ts`s Custom-Registry-URL-Logik (`copyTemplate()`, aktuell Zeilen 71–72) ist noch npm-spezifisch fest verdrahtet — schreibt immer eine `.npmrc`, unabhängig vom gewählten Pack. **Lösung, als früher Task in den M12b-Implementierungsplan aufgenommen (kein separater Vorab-PR):** `RegistryChecker`-Interface (`src/languages/registry-checker.ts`) bekommt eine neue Methode `applyRegistryUrl(targetDir: string, url: string): Promise<void>`. `scaffold.ts` ruft stattdessen generisch `pack.registry.applyRegistryUrl(targetDir, registryUrl)` auf, wenn `registryUrl && registryUrl !== pack.registry.defaultUrl`. Der npm-Checker (`registry-checkers/npm.ts`) behält das bisherige `.npmrc`-Verhalten unverändert bei (reine Verschiebung, kein Verhaltenswechsel für Node). Der neue NuGet-Checker (`registry-checkers/nuget.ts`) schreibt eine `NuGet.config` mit `<clear/>` gefolgt von genau einer `<add>`-Quelle (der Custom-URL) — spiegelt npms Vollüberschreibungs-Semantik (die `registry=<url>`-Zeile in `.npmrc` überschreibt npms Auflösung ebenfalls vollständig, nicht additiv).

## Ergebnis

Nach diesem Umbau: `LanguagePack` ist die zentrale Erweiterungsstelle für jede weitere Sprache. Ein PowerShell-Pack braucht künftig "nur" ein neues Pack-Objekt (Template, `UpdateAdapter`, `RegistryChecker`, `validateProjectName`) plus Eintrag in `LANGUAGE_PACKS` — keine Änderungen an `wizard.ts`, `scaffold.ts`, `cli.ts` oder `reconcile.ts` selbst. Node bleibt über den bestehenden `node-oclif`-Adapter/Pack unverändert im Verhalten.
