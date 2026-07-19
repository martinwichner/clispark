# `clispark add`: Nachträgliches Hinzufügen von Commands

## Kontext

Seit dem M13-Brainstorming (2026-07-18) als eigener, größerer Backlog-Punkt vorgemerkt, der bewusst NICHT nur grob eingetragen wurde, sondern ein eigenes, ausführlicheres Design-Gespräch brauchte — anders als die übrigen M13-Punkte. Zentrale offene Fragen von damals: wie wird der Subcommand-Pfad abgefragt, wie generisch muss das über Sprachen hinweg sein, und passt das eher zu M12b oder ist es eigenständig.

Mit M12b (.NET-Template, 2026-07-19 abgeschlossen) gibt es jetzt zwei echte `LanguagePack`-Konsumenten (Node/oclif, .NET/System.CommandLine) mit strukturell unterschiedlichen Command-Discovery-Mechanismen (Node: dateisystembasiert, Ordnerstruktur = Pfad; .NET: reflection-/attributbasiert, `[CommandPath]`-Attribut = Pfad, Ordnerstruktur bleibt flach). Das beantwortet die offene Frage: `clispark add` ist ein eigenständiges Feature, das auf der bestehenden `LanguagePack`-Architektur aufbaut — kein Teil von M12b, aber direkt von dessen zwei echten Sprach-Implementierungen profitierend, um die Abstraktion nicht nur an einem Fall zu entwerfen (gleiches Prinzip wie bei M12a/M12b selbst).

## Scope

**Diese Session deckt ab:**
1. Neues drittes `LanguagePack`-Vertical-Slice-Interface `CommandGenerator`, analog zu `UpdateAdapter` (M11 Tier 3) und `RegistryChecker` (M12a) — Pflichtparameter, kein Default, explizite Verdrahtung.
2. Konkrete Implementierung für **beide** bestehenden Sprachen (Node/oclif UND .NET/System.CommandLine) gleichzeitig — bewusste Abweichung vom M12a/M12b-Split, da beide Konsumenten bereits existieren und die Abstraktion diesmal nicht spekulativ an nur einem Fall entworfen werden muss.
3. Neuer interaktiver `clispark add`-Befehl (rein `@clack/prompts`-basiert, kein Scripting-/Flag-Modus).

**Explizit nicht Teil dieser Arbeit:**
- **Benannte Flags** (`--name`) — nur positionale Argumente, das einzige Muster, das beide Templates bereits in ihren Beispiel-Commands zeigen und das bereits getestet ist.
- **Weitere Parameter-Typen** (Datei-/URL-/Custom-Typen aus `Args.file()`/`Args.url()`/`Args.custom()` bzw. deren .NET-Äquivalente) — nur die vier Typen, die beide Templates schon als Beispiele demonstrieren: String, Integer, Boolean, String-mit-erlaubten-Werten (Enum).
- **Nicht-interaktiver/scriptbarer Modus** — kein Vorbild im bisherigen Projekt, würde eine eigene Flag-Grammatik für Pfade+Parameterlisten brauchen.
- **PowerShell** — noch kein dritter `LanguagePack`-Konsument, kein Teil dieser Session.
- **Automatischer Build/Testlauf nach dem Generieren** — `clispark add` erzeugt nur die Dateien, analog dazu dass der Scaffold-Wizard auch nur einmalig installiert/baut, ohne automatisch Tests laufen zu lassen.
- **Nachträgliches Entfernen eines Commands** (`clispark remove`) — nicht angefragt, nicht Teil dieser Session.

## Architektur

Neues Interface `CommandGenerator` (in `src/languages/command-generator.ts`), analog zum bestehenden `RegistryChecker`/`UpdateAdapter`-Muster:

```ts
export interface ExistingCommandNode {
  /** Full space-separated invocation path, e.g. "task list". */
  path: string;
  /** Display label for the recursive selection menu, e.g. "task > list". */
  displayLabel: string;
  children: ExistingCommandNode[];
}

export type ParameterType = 'string' | 'integer' | 'boolean' | 'enum';

export interface ParameterSpec {
  name: string;
  type: ParameterType;
  required: boolean;
  /** Only present when type === 'enum'. */
  allowedValues?: string[];
}

export interface CommandSpec {
  /** Full path segments, e.g. ['task', 'export']. */
  pathSegments: string[];
  parameters: ParameterSpec[];
}

export interface GeneratedFiles {
  commandFile: string;
  testFile: string;
}

export interface CommandGenerator {
  listExistingCommands(targetDir: string): Promise<ExistingCommandNode[]>;
  generateCommand(targetDir: string, spec: CommandSpec): Promise<GeneratedFiles>;
}
```

`LanguagePack` bekommt ein neues Pflichtfeld `commandGenerator: CommandGenerator`. Zwei konkrete Implementierungen: `src/languages/command-generators/node-oclif.ts`, `src/languages/command-generators/dotnet.ts`.

**Bewusst verworfene Alternative:** die Generierungslogik direkt im generischen `add.ts` mit einem `if (pack.id === 'node') ... else if (pack.id === 'dotnet') ...` unterzubringen, statt ein neues Pack-Interface einzuführen. Widerspricht dem einzigen tragenden Architekturprinzip seit M11 Tier 3 ("ein neues Sprach-Pack braucht nur ein neues Objekt, keine Änderung am generischen Code") — verworfen.

**Kritischer Grundsatz:** Generierte Commands sind **Nutzer-Eigentum**, genau wie die mitgelieferten Beispiel-Commands (`hello.ts`/`HelloCommand.cs` etc.) — sie landen **nicht** in `coreFilePaths` des jeweiligen `UpdateAdapter`. `clispark update` darf sie nie anfassen, überschreiben oder löschen.

## Node/oclif: `CommandGenerator`-Implementierung

**`listExistingCommands`:** Scannt `src/commands/**/*.ts` (ohne `*.test.ts`) rekursiv. Pfad ergibt sich direkt aus der Ordnerstruktur (`src/commands/task/list.ts` → `"task list"`) — kein Dateiinhalt muss geparst werden.

**`generateCommand`:** Für `pathSegments: ['task', 'export']`:
- Datei: `src/commands/task/export.ts`
- Klasse: `Export extends BaseCommand` (letztes Pfadsegment, PascalCase — spiegelt das bestehende Namensmuster von `task/complete.ts`s `Complete`-Klasse)
- `static args`, aufgebaut aus den `ParameterSpec`s:
  - `string` → `Args.string({ description, required })`
  - `integer` → `Args.integer({ description, required })`
  - `boolean` → `Args.boolean({ description, required })`
  - `enum` → `Args.string({ description, required, options: allowedValues })`
- `run()`: `await this.parse(Export); this.log(...)` gibt die empfangenen Werte aus (Platzhalter-Body)
- Testdatei: `src/commands/task/export.test.ts`, nach `hello.test.ts`-Muster (`runCommand()`, prüft nur, dass der Erfolgspfad ohne Fehler durchläuft und die erwartete Ausgabe enthält)

Fehlt ein Zwischenordner (z.B. `src/commands/task/` existiert noch nicht, weil `task` bisher kein Command ist), wird er automatisch angelegt — oclifs eigene Discovery braucht keine echte `task.ts`-Datei, damit `task export` funktioniert (topic-Verhalten, bereits am bestehenden `task`/`task list`/`task complete`-Trio erkennbar: eine implizite Topic-Hilfe reicht).

## .NET: `CommandGenerator`-Implementierung

**`listExistingCommands`:** Liest alle `src/Commands/*.cs`-Dateien und extrahiert `[CommandPath("...")]` per Regex (gleiches Prinzip wie die bereits bestehende Regex-basierte `.csproj`-Bearbeitung im `UpdateAdapter` — kein Compiler/Reflection zur Generierungszeit nötig, da noch nicht gebaut).

**`generateCommand`:** Für `pathSegments: ['task', 'export']`:
- Datei: `src/Commands/TaskExportCommand.cs` (PascalCase-Verkettung des vollen Pfads + `Command`-Suffix — flache Ordnerstruktur wie bei den bestehenden Beispiel-Commands, KEIN verschachtelter `Task/`-Unterordner)
- Klasse: `TaskExportCommand : ICliCommand`, `[CommandPath("task export")]`
- `Build()` baut die Argumente aus den `ParameterSpec`s:
  - `string` → `new Argument<string>(name)` (+ `Arity = ArgumentArity.ZeroOrOne` bei optional)
  - `integer` → `new Argument<int>(name)` (+ Arity bei optional)
  - `boolean` → bei required: `new Argument<bool>(name)`; bei optional: `new Argument<bool?>(name) { Arity = ArgumentArity.ZeroOrOne }` (optionaler Fall mirrort `TaskListCommand.cs`s `all`-Argument; required-Fall ist neu, aber dieselbe Arity-Logik wie bei `string`/`integer`, keine neue API)
  - `enum` → `new Argument<string>(name)` + `.AcceptOnlyFromAmong(...allowedValues)`
- `SetAction`: gibt die empfangenen Werte aus (Platzhalter-Body)
- Testdatei: `tests/TaskExportCommandTests.cs`, nach `HelloCommandTests.cs`-Muster (`.Build()` → `.Parse()` → `.Invoke()`, prüft Exit-Code 0 im Erfolgsfall)

Da .NETs Discovery reflection-basiert ist (`CommandDiscovery.RegisterAll`, aus M12b), muss die generierte Datei nichts an einer Elterndatei ändern — fehlende Zwischenknoten (z.B. `task` selbst) werden zur Laufzeit automatisch als leere Container erzeugt, exakt wie in M12b implementiert.

## Wizard-Ablauf

Neuer Befehl `clispark add` (registriert wie `update`/`releasenotes`: liest zuerst `.clispark/manifest.json`, löst darüber das Pack auf — kein Sprachauswahl-Prompt nötig, da die Sprache des Projekts bereits feststeht). Fehlt das Manifest, derselbe `UserError` wie bei `update`/`releasenotes` heute schon.

1. `pack.commandGenerator.listExistingCommands(targetDir)` aufrufen.
2. **Rekursive Pfad-Auswahl:** Auswahlmenü mit "Neuer Top-Level-Command" plus einem Eintrag pro vorhandenem Command (verschachtelt dargestellt, z.B. `task > list`). Bei Auswahl eines bestehenden Commands erneut fragen: "Direktes Subcommand hier anlegen" vs. "Unter einem Subcommand von X anlegen" (bei vorhandenen Kindern) — rekursiv, beliebig tief, endet erst wenn der Nutzer "hier" wählt oder ein Blatt ohne Kinder erreicht ist.
3. **Name** des neuen Commands (letztes Pfadsegment) abfragen. Validierung: `^[a-z][a-zA-Z0-9]*$` (einzelnes Wort, beginnt lowercase — passt zu allen bestehenden Beispiel-Command-Namen `hello`/`task`/`list`/`complete`, macht die PascalCase-Ableitung für Klassennamen eindeutig, keine Bindestriche wie bei npm-Projektnamen üblich). Zusätzlich: Pfad darf nicht bereits existieren (Vergleich gegen die Liste aus Schritt 1).
4. **Parameter-Schleife:** "Weiteren Parameter hinzufügen?" (Ja/Nein-Schleife). Pro Parameter: Name (gleiche Validierung `^[a-z][a-zA-Z0-9]*$` wie beim Command-Namen, muss innerhalb des Commands eindeutig sein — wird sowohl als oclif-`args`-Objektschlüssel als auch als .NET-Variablenname verwendet) → Pflicht/Optional → Typ (String/Integer/Boolean/Enum) → bei Enum zusätzlich: erlaubte Werte als kommagetrennte Texteingabe.
5. **Zusammenfassung + Bestätigung** (voller Pfad, alle Parameter mit Typ) vor dem tatsächlichen Schreiben.
6. `pack.commandGenerator.generateCommand(targetDir, spec)` aufrufen, Erfolg melden: erzeugte Dateipfade auflisten (analog zur bestehenden `formatUpdateSummary`-Ausgabe von `clispark update`).

## Ergebnis

Nach diesem Feature: ein Nutzer kann ein bereits gescaffoldetes Node- oder .NET-Projekt interaktiv um einen neuen Top-Level- oder beliebig tief verschachtelten Subcommand erweitern, inkl. Parametern (String/Integer/Boolean/Enum, Pflicht/Optional) und einer mitgelieferten Testdatei — ohne manuell die sprachspezifischen Boilerplate-Konventionen (oclif `Args`/`BaseCommand` bzw. `System.CommandLine`/`ICliCommand`/`[CommandPath]`) nachschlagen zu müssen. `LanguagePack` bekommt damit sein drittes generisches Erweiterungsfeld; ein künftiges PowerShell-Pack bräuchte für dieses Feature "nur" eine eigene `CommandGenerator`-Implementierung, keine Änderung an `add.ts` selbst.
