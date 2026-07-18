# M12: Language-Pack-Architektur + .NET-Template

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

**Projektstruktur:** Solution mit zwei Projekten — `src/Cli.csproj` (Haupt-Tool, wird gepackt) + `tests/Cli.Tests.csproj` (xUnit, referenziert das Hauptprojekt) + `Cli.sln`. Entspricht gängiger .NET-Konvention (Tests leben nicht neben dem Code wie bei vitest). **Wichtig:** Datei-/Ordnernamen sind fest, unabhängig vom gewählten Projektnamen (`src/Cli.csproj` heißt immer so) — der Projektname landet nur in MSBuild-Properties (`PackageId`, `AssemblyName`, `RootNamespace`) innerhalb der Dateien. Gleiches Prinzip wie bei `package.json`, dessen Pfad sich nie ändert, nur der `name`-Feldinhalt.

**Auto-Discovery:** Marker-Interface `ICliCommand` (Methode `Command Build()`, liefert ein konfiguriertes `System.CommandLine.Command`) plus `[Command("task list")]`-Attribut zur expliziten Deklaration des Aufrufpfads (Klassenname allein reicht bei verschachtelten Subcommands nicht). `Program.cs` scannt beim Start die Assembly per Reflection nach allen `ICliCommand`-Implementierungen und registriert sie automatisch am `RootCommand` — funktional das Gleiche wie oclifs dateisystembasierte Discovery, nur kompilierungsbedingt über Reflection statt Dateisystem-Scan. Dieses Prinzip ("Command-Datei ablegen → automatisch erkannt") gilt als Architektur-Vorgabe für **jedes** Sprach-Pack, auch wenn die Implementierung pro Sprache zwangsläufig unterschiedlicher Code ist.

**Fehlerbehandlung:** Kein Klassenvererbungsmodell wie oclifs `BaseCommand` (System.CommandLine arbeitet anders), stattdessen ein zentraler Ausführungs-Wrapper um die Root-Command-Invocation: fängt `CliUserException` (Äquivalent zu `UserError`) ab → sauberes `Error: <message>` ohne Stacktrace, Exit-Code 1; alles andere → volle Details. Gleiche UX-Prinzipien wie das etablierte M2.5/M8-Verhalten. Logger wird injiziert über einen leichtgewichtigen `Microsoft.Extensions.DependencyInjection`-Container (kein vollständiger Generic Host).

**Logging (Serilog):** Datei-Sink + `DEBUG`-gesteuertes Live-Konsolen-Streaming, Retention-Sweep, restriktive Datei-Rechte unter Unix — mechanisch die gleiche Logik wie `templates/node/src/logger.ts`, in Serilog-Idiomen. Zwei Punkte brauchen kurze Recherche während der Umsetzung (siehe "Offene Recherchepunkte"): das .NET-Äquivalent zu `env-paths`, und der sauberste Weg für pino-artiges `redact` in Serilog.

**Beispiel-Commands:** Analog zu `hello.ts`/`task.ts` — Argumenttyp-Katalog in der ARCHITECTURE.md (Pflicht-String-Argument, optionales Argument mit erlaubten Werten, Boolean-Flag, Integer-Argument, Subcommand-Verschachtelung).

## NuGet-`UpdateAdapter`

Der Adapter-Code selbst ist TypeScript (Teil von clispark, nicht des generierten .NET-Projekts) — er liest/schreibt/parst das `.csproj` des Zielprojekts als XML-Text. Braucht eine neue npm-Abhängigkeit in clispark für XML-Handling.

**Was ist "das Manifest"?** Nur `src/Cli.csproj` (nicht das Test-Projekt) — enthält `<Version>`, `<PackageId>`, `<PackAsTool>`, `<ToolCommandName>`, `<TargetFramework>` (Engines-Äquivalent), `<PackageReference>`-Einträge (Dependencies-Äquivalent). `tests/Cli.Tests.csproj` wird wie jede andere Kern-Datei per Content-Hash behandelt (ersetzen/überspringen), kein Feld-Merging.

**`coreFields`:** Nur `{ TargetFramework: string }`. **Nicht** `ToolCommandName`/`PackageId` — das sind Identitäts-Felder, einmalig beim Scaffold gesetzt, analog zu `package.json`s `name`-Feld, das ebenfalls nie in `coreFields` landet.

**Drei-Wege-Merge:** Läuft über die bestehende, generische `reconcileEntry`/`stringEquals`/`deepEquals`-Logik aus `reconcile.ts` — **keine Änderung nötig**. Dependencies (Name→Version-String) und `TargetFramework` (einzelner String statt Objekt wie `engines`) passen 1:1 in die bestehende Merge-Logik.

**XML-Diff-Risiko:** Naive "Parse zu JS-Objekt → komplett neu serialisieren"-Bibliotheken verlieren Kommentare/Formatierung und erzeugen unnötig große Diffs. Stattdessen: eine DOM-basierte Bibliothek (z.B. `@xmldom/xmldom`), die nur tatsächlich geänderte Knoten mutiert (z.B. nur den `<Version>`-Textknoten oder ein einzelnes `<PackageReference>`-Element), statt die Datei komplett neu aufzubauen.

## NuGet-`RegistryChecker`

**Name-Verfügbarkeit:** `GET https://api.nuget.org/v3-flatcontainer/{lowercase-package-id}/index.json` — 200 mit Versions-Array = vergeben, 404 = frei. Direktes Äquivalent zum heutigen npm-Check. Bekannter, seltener NuGet-Fehlerfall (fälschliches "BlobNotFound" trotz existierendem Paket, [NuGet/NuGetGallery#9105](https://github.com/NuGet/NuGetGallery/issues/9105)) — passt zur bestehenden `NameCheckResult`-Semantik: bei uneindeutigem Ergebnis `'unverified'` statt hart zu scheitern, wie der npm-Checker es heute schon macht.

**Publish:** Bewusst **nicht** Teil dieses Scopes (siehe "Bewusst nicht Teil dieser Arbeit") — clispark prüft nur die Namensverfügbarkeit, das eigentliche Veröffentlichen bleibt Sache des Nutzers.

## PowerShell-Sanity-Check

Kein PowerShell-Code in dieser Session, nur Gegenprobe, dass `LanguagePack` wirklich für eine dritte, strukturell andere Sprache trägt: `scaffoldCommands: []` (kein Build-Schritt), ein `.psd1`-Modul-Manifest-`UpdateAdapter` (drittes Datenformat — PowerShell-Data-Syntax statt JSON/XML, passt aber genau in die `unknown`-getypten Interface-Methoden), ein PowerShell-Gallery-`RegistryChecker`, dateisystembasierte Auto-Discovery (dot-sourcing aller Dateien in einem `Public/`-Ordner — näher an oclifs Original-Prinzip als .NETs Reflection-Ansatz). Alles passt ohne Interface-Änderung.

## Bewusst nicht Teil dieser Arbeit

- **Das PowerShell-Template selbst** — separate, günstigere Folge-Session, sobald das Muster durch .NET bewiesen ist.
- **Jegliche Release-Automatisierung für generierte Projekte** (NuGet Trusted Publishing, GitHub-Actions-Publish-Workflows o.ä.) — clispark scaffoldet schon heute keine CI/CD in generierte Node-Projekte, das ändert sich nicht. Der Nutzer kümmert sich selbst um das Publishing seines eigenen Tools.
- **CI/CD-Erweiterung für clispark selbst** (eigenes `.github/workflows` braucht künftig ein .NET SDK für einen Scaffold-Smoke-Test des neuen Templates) — praktischer Umsetzungs-Task, kein Architektur-Thema, gehört in den Implementierungsplan.

## Offene Recherchepunkte für die Umsetzung

- .NET-Äquivalent zu `env-paths` für plattformkonforme Log-Verzeichnis-Pfade (XDG-Konformität unter Linux insbesondere)
- Sauberster Weg für pino-artiges `redact` in Serilog (vermutlich ein eigener kleiner Enricher, kein fertiges Paket)
- Geeignete npm-Bibliothek für DOM-basiertes XML-Lesen/-Schreiben in clispark selbst (z.B. `@xmldom/xmldom`, noch nicht final geprüft)
- clispark's eigene CI (`ci.yml`) braucht ein .NET SDK auf den Runnern für einen echten Scaffold-Smoke-Test — lokal bereits verfügbar (.NET SDK 9.0.306), auf GitHub-Actions-Runnern in der Regel vorinstalliert, aber vor Umsetzung zu bestätigen
- **Echter Fund aus dem M12a-Whole-Branch-Review (2026-07-18):** `scaffold.ts`s Custom-Registry-URL-Logik (`copyTemplate()`) ist noch npm-spezifisch fest verdrahtet — schreibt immer eine `.npmrc` mit `registry=<url>`-Inhalt, unabhängig vom gewählten Pack. Das widerspricht dem eigentlichen Ziel (generische Schicht bleibt unverändert bei neuen Sprachen): ein NuGet-Feed braucht eine `NuGet.config`, kein `.npmrc`. Der `LanguageRegistry`-Vertrag hat aktuell keine Methode, um eine Registry-URL in eine ökosystem-eigene Konfigurationsdatei zu übersetzen. Für M12a folgenlos (Node bleibt korrekt), aber **vor M12b nachziehen**: entweder `LanguageRegistry` um z.B. `applyRegistryUrl(targetDir, url)` erweitern (analog zu `applyPrivateIntent`) und `scaffold.ts` entsprechend generalisieren, oder explizit als Scope-Erweiterung in den M12b-Plan aufnehmen — nicht erst mittendrin entdecken.

## Ergebnis

Nach diesem Umbau: `LanguagePack` ist die zentrale Erweiterungsstelle für jede weitere Sprache. Ein PowerShell-Pack braucht künftig "nur" ein neues Pack-Objekt (Template, `UpdateAdapter`, `RegistryChecker`, `validateProjectName`) plus Eintrag in `LANGUAGE_PACKS` — keine Änderungen an `wizard.ts`, `scaffold.ts`, `cli.ts` oder `reconcile.ts` selbst. Node bleibt über den bestehenden `node-oclif`-Adapter/Pack unverändert im Verhalten.
