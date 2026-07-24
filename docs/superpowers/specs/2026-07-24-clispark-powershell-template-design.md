# PowerShell-Template (#82)

## Kontext

M12 (18.–19.07.2026) hat die `LanguagePack`-Architektur eingeführt und mit dem .NET-Template (M12b) als zweitem echten Konsumenten bewiesen. Der M12-Spec enthält bereits einen "PowerShell-Sanity-Check"-Abschnitt, der ohne echten Code bestätigt hat, dass die Architektur grundsätzlich trägt: `scaffoldCommands: []` (kein Build-Schritt), ein `.psd1`-Modul-Manifest als drittes `UpdateAdapter`-Datenformat, ein PowerShell-Gallery-`RegistryChecker`, dateisystembasierte Auto-Discovery über einen `Public/`-Ordner.

Auslöser dieser Session: eine echte Community-Anfrage (#82, @atze187), zunächst nur als Idee, dann am 22.07. zu einem ersten Design konkretisiert, mit drei offenen Rückfragen an den Requester. Am 24.07. hat @atze187 alle drei beantwortet (Modul bestätigt, PowerShell 7+ bevorzugt ohne Non-LTS-.NET-Features, Use-Case firmeninternes Automatisierungs-Tooling lokal+CI mit vollem Logging/Testing) — siehe Issue #82 für den vollständigen Thread. Diese Spec macht daraus ein vollständiges drittes Sprach-Template, vom Umfang her vergleichbar mit M12b.

## Scope

**Ziel:** `powershellPack: LanguagePack` — ein PowerShell-**Modul** mit Cmdlets als drittes Sprach-Template, mit vollem Logging/Error-Handling ohne Opt-out, `clispark add`-Unterstützung und `clispark update`-Unterstützung, analog zu Node/.NET. **Zielversion: PowerShell 7.4+** (real recherchiert, siehe "Offene Punkte" unten — deckt beide aktuell unterstützten .NET-LTS-Linien 7.4/.NET 8 und 7.6/.NET 10 ab, vermeidet gezielt das Non-LTS-Release 7.5/.NET 9).

**Explizit nicht Teil dieser Session:**
- Windows PowerShell 5.1 — bewusst komplett aus dem Scope gestrichen (siehe Community-Feedback oben)
- Automatische Migration/Konvertierung bestehender PowerShell-Skripte in das neue Template-Format
- Alles, was in "Bewusst nicht Teil dieser Arbeit" unten aufgeführt ist

## Architektur-Überblick

`powershellPack` implementiert `LanguagePack` exakt wie `nodeOclifPack`/`dotnetPack`, ohne Änderung an `wizard.ts`/`scaffold.ts`/`update.ts`/`add.ts`/`manifest.ts`:

```ts
export const powershellPack: LanguagePack = {
  id: 'powershell',
  displayName: 'PowerShell (7+)',
  templateDir: path.join(findPackageRoot(), 'templates', 'powershell'),
  scaffoldCommands: [
    { command: 'pwsh', args: ['-NoProfile', '-Command', 'Install-Module -Name PSFramework,Pester -Scope CurrentUser -Force -AllowClobber'] },
  ],
  validateProjectName,
  updateAdapter: powershellAdapter,
  registry: { /* PSGallery-RegistryChecker, siehe unten */ },
  commandGenerator: powershellCommandGenerator,
};
```

**Korrektur gegenüber dem M12-Sanity-Check:** Dort wurde `scaffoldCommands: []` angenommen (kein Build-Schritt nötig). Beim genaueren Hinsehen für diese Spec ein echter Widerspruch zum Kernversprechen "sofort lauffähiges Projekt" (siehe `clispark.plan.md`, Beschreibung): ohne einen automatischen Installationsschritt für `PSFramework`/`Pester` (`RequiredModules` im Manifest) würde ein frisch gescaffoldetes Projekt beim ersten Aufruf mit "module not found" scheitern — der Nutzer müsste manuell `Install-Module` aufrufen, bevor irgendetwas läuft. `scaffoldCommands` bekommt daher doch einen Eintrag, der `Install-Module` für beide Kern-Abhängigkeiten ausführt — das setzt voraus, dass `pwsh` bereits installiert ist (dieselbe Voraussetzung wie für den `UpdateAdapter`-Shell-out oben, und ohnehin zwingend, um das erzeugte PowerShell-Modul selbst überhaupt auszuführen).

Vier Bausteine analog zur bestehenden Struktur: `templates/powershell/` (Template-Inhalt), `src/update/adapters/powershell.ts` (`UpdateAdapter`), `src/languages/registry-checkers/powershell-gallery.ts` (`RegistryChecker`), `src/languages/command-generators/powershell.ts` (`CommandGenerator`).

## Ordnerstruktur (Template)

```
templates/powershell/
  <ProjektName>.psd1        # Modul-Manifest (Kern-Datei, core-verwaltet)
  <ProjektName>.psm1        # Modul-Root: lädt Public/, wendet Proxy-Wrapper an (Kern-Datei)
  Public/
    Get-Hello.ps1            # Beispiel-Cmdlet, analog zu hello.ts/HelloCommand.cs
  Private/                   # Konvention für nicht-exportierte Hilfsfunktionen (leer im Template)
  Logging/
    Initialize-Logging.ps1   # PSFramework-Setup (Redaction, Retention, DEBUG-Streaming — analog logger.ts/CliLoggerFactory.cs)
  tests/
    Get-Hello.Tests.ps1       # Pester-Test fürs Beispiel-Cmdlet
  ARCHITECTURE.md
  README.md
  .gitignore
```

`Public/` = Konvention für exportierte Cmdlets (eine Datei pro Cmdlet, Dateiname = Funktionsname — exakt wie Node's `commands/`-Konvention, näher am oclif-Prinzip als am .NET-Reflection-Ansatz). `Private/` existiert als dokumentierte Konvention für nicht-exportierte Hilfsfunktionen, wird aber nicht automatisch geladen/gewrapped (nur `Public/` durchläuft den Proxy-Mechanismus).

## Wizard-Ablauf

Keine Änderung am Wizard-Flow nötig — `powershellPack` wird einfach als dritte Option in der bestehenden Sprachauswahl registriert (`LANGUAGE_PACKS`). Profil (Arbeit/Privat) und Registry-URL-Frage funktionieren unverändert; für "Arbeit" wird die abgefragte `registryUrl` als internes PowerShell-Repository interpretiert (siehe RegistryChecker unten).

## Projektname-Validierung

PowerShell-Modulnamen folgen praktisch denselben Konventionen wie .NET-Assemblies (PascalCase, keine Sonderzeichen) — `validateProjectName` kann `dotnetPack`s Regex (`^[A-Z][A-Za-z0-9]*$`) 1:1 wiederverwenden. Der Modulname wird gleichzeitig zum `.psd1`/`.psm1`-Dateinamen und zum `RootModule`-Feld im Manifest.

## Auto-Logging/Error-Handling: Function-Proxy-Wrapper

**Das war der als am riskantesten eingestufte Teil — echt prototypt und verifiziert in dieser Session (nicht nur angenommen).**

PowerShell-Funktionen kennen keine Vererbung/Lifecycle-Hooks wie `BaseCommand` (Node/oclif) oder `System.CommandLine`s Invocation-Pipeline (.NET). Die Lösung: beim Modul-Import (`.psm1`-Root-Code) wird jede Datei in `Public/` dot-sourced, die daraus entstehende Funktion per `CommandMetadata`/`ProxyCommand`-API (Teil von `System.Management.Automation`, kein externes Paket) in eine geloggte Wrapper-Funktion umgeschrieben — der Cmdlet-Autor schreibt nie eigenes try/catch oder Logging.

**Technik (echt verifiziert):**
1. Datei dot-sourcen → definiert die Rohfunktion unter ihrem echten Namen (z.B. `Get-Hello`).
2. Funktion umbenennen: `Rename-Item Function:\Get-Hello __orig_Get-Hello` — **Reihenfolge kritisch**: erst umbenennen, *dann* `Get-Command`/`CommandMetadata` gegen den umbenannten Namen bilden. Grund: der von `[System.Management.Automation.ProxyCommand]::GetBegin(...)` generierte Code löst den Ziel-Befehl per `$ExecutionContext.InvokeCommand.GetCommand('<Name>', ...)` **zur Laufzeit erneut nach Namen auf** — würde man die Metadaten vor dem Umbenennen aus dem Original-Namen bilden, würde der fertige Wrapper sich beim Aufruf rekursiv selbst aufrufen (echter Fund, nicht offensichtlich, nur durch Ausprobieren aufgefallen).
3. `[System.Management.Automation.ProxyCommand]::GetParamBlock/GetBegin/GetProcess/GetEnd/GetCmdletBindingAttribute($metadata)` liefern die exakten Bausteine — dieselbe offizielle API, die PowerShells eigenes Remoting/Modul-Proxying für Befehls-Wrapper mit voller Parameter-/Pipeline-Treue nutzt. Kein selbstgebautes Parameter-Weiterreichen (kein naives `@PSBoundParameters`-Splatting), das bei `ValueFromPipeline`/`ValueFromPipelineByPropertyName` sonst leise bricht.
4. Eigene `begin`/`process`/`end`-Blöcke um die generierten Bausteine legen: Start-Log + Stopwatch in `begin`, `try { <generierter Block> } catch { Fehler-Log; throw }` in allen drei Phasen, Abschluss-Log am Ende von `end`. `throw` (nicht Schlucken) — der Aufrufer bekommt die echte Exception weiterhin, nur mit Logging drumherum, exakt wie `BaseCommand.catch()`/`CliUserException` es für Node/.NET tun.
5. `Export-ModuleMember` nur mit den echten `Public/`-Funktionsnamen aufrufen, **nicht** `-Function *` — sonst werden auch die umbenannten `__orig_*`-Funktionen exportiert, was PowerShells "unapproved verb"-Warnung beim Modul-Import auslöst (echter Fund: mit `-Function *` erschien die Warnung, mit der expliziten Namensliste verschwand sie).

**Real verifiziert (dieses Environment, `Get-Hello`/`Invoke-Boom`-Testfunktionen):**
- Erfolgsfall: `started`/`completed`-Logs, Stopwatch-Timing, benannte Parameter UND Pipeline-Input (`ValueFromPipeline`) beide korrekt durchgereicht.
- Fehlerfall: `started`/`failed`-Log, Original-Exception-Message unverändert beim Aufrufer ankommend (`$_.Exception.Message` identisch).
- Keine "unapproved verb"-Warnung nach dem Export-Fix.

**Bekannte Verifikationslücke:** Diese Sandbox hat nur Windows PowerShell 5.1 (Desktop Edition) verfügbar, kein `pwsh` (PowerShell 7+/Core) — der eigentliche Zielrahmen laut @atze187s Feedback. Die genutzte API (`System.Management.Automation.ProxyCommand`/`CommandMetadata`, `Function:`-PSDrive) ist Teil des Kern-`System.Management.Automation`-Assemblys und in beiden Editionen vorhanden, daher hohe Zuversicht — aber **vor dem Implementierungsplan muss dieselbe Prototyp-Sequenz real gegen ein echtes PowerShell-7+-Environment wiederholt werden** (gleiche Disziplin wie M8/M12b: erst real verifizieren, dann in den Plan übernehmen). Bis dahin gilt dieser Abschnitt als "wahrscheinlich richtig, nicht als vollständig für PS7+ bewiesen."

## Command-Naming & `CommandGenerator`

PowerShell erzwingt eine feste Liste "genehmigter Verben" (`Get-Verb`; `Get`/`Set`/`New`/`Remove`/`Invoke`/`Add`/... — mehrere Dutzend, in Kategorien wie Common/Data/Lifecycle/Diagnostic gruppiert). Wizard und `clispark add` fragen Verb (Dropdown, aus der echten `Get-Verb`-Liste) und Substantiv getrennt ab, statt eines freien Command-Namens — Cmdlet-Name wird als `<Verb>-<ProjektPrefix><Noun>` zusammengesetzt (z.B. `Get-MeintoolTaskList`), analog zur bestehenden Node/.NET-Praxis, Präfixe zu nutzen, um Namenskollisionen mit anderen installierten Modulen zu vermeiden.

`generateCommand()` erzeugt: eine neue `Public/<Verb>-<Noun>.ps1`-Datei (Funktionsgerüst mit typisiertem `param()`-Block je nach `ParameterSpec`) plus `tests/<Verb>-<Noun>.Tests.ps1` (Pester-Grundgerüst) — mapped `ParameterType` (`string`/`integer`/`boolean`/`enum`) auf PowerShell-Parametertypen (`[string]`/`[int]`/`[switch]` bzw. `[bool]`/`[ValidateSet(...)]`). `listExistingCommands()` liest die vorhandenen `Public/*.ps1`-Dateinamen (kein AST-Parsing nötig, Dateiname = Cmdlet-Name).

**Zur bereits gelösten "required-nach-optional"-Falle (oclif/`System.CommandLine` lehnen das zur Laufzeit ab, siehe `clispark add`-Design):** PowerShell-Parameterbindung kennt diese Einschränkung strukturell nicht — Parameter werden i.d.R. namentlich gebunden, Positions-Reihenfolge in der Deklaration erzwingt keine Pflicht-vor-optional-Regel wie bei oclif-Args. Kein äquivalenter Fix in `powershellCommandGenerator` nötig; das entsprechende Latch/der entsprechende Test aus dem `clispark add`-Design gilt hier nicht.

**Echter Architektur-Fund beim Plan-Entwurf (gehört hierher, nicht nur in den Plan):** `src/add-wizard.ts` fragt den Command-Namen aktuell hart-kodiert generisch ab (ein einzelnes, mit `^[a-z][a-zA-Z0-9]*$` validiertes Wort — passend für Node/.NET, aber strukturell inkompatibel mit PowerShells Verb+Noun-Konvention, die zwei getrennte, PascalCase-Werte aus einer festen Verb-Liste braucht). `CommandGenerator` bekommt eine neue, optionale Methode `promptCommandIdentity?(pathSegments: string[], existingPaths: Set<string>): Promise<{ pathSegments: string[] }>` — ist sie vorhanden, ruft `add-wizard.ts` sie statt seiner eingebauten generischen Namensabfrage auf; ist sie nicht vorhanden (Node/.NET, unverändert), bleibt das bisherige Verhalten exakt erhalten. Gleiches Generalisierungs-Prinzip wie bei `LanguagePack`/`UpdateAdapter`: die Erweiterung entsteht erst jetzt, mit einem echten dritten Konsumenten, der sie tatsächlich braucht.

**Offene Frage für den Plan:** ob `[switch]` (PowerShell-idiomatisch für Booleans) oder `[bool]` (konsistent mit Node/.NET, wo Booleans immer-optional mit Default `false` sind, siehe `clispark add`-Design) — `[switch]`-Parameter sind in PowerShell strukturell immer optional und binär (gesetzt/nicht gesetzt), was die in `clispark add` bereits gelöste "Boolean-Parameter müssen optional sein"-Anforderung ohnehin automatisch erfüllt. Empfehlung: `[switch]`, da idiomatischer und das Problem strukturell statt durch Konvention löst — zur Bestätigung im Plan.

## Modul-Manifest & `UpdateAdapter`

`.psd1` ist PowerShell-Data-Language-Syntax (eine Hashtable-Literal-Syntax, kein JSON/XML) — drittes Datenformat für `UpdateAdapter`, passt aber unverändert in die `unknown`-typisierten Interface-Methoden (wie im M12-Sanity-Check vorhergesagt).

**Offene Design-Frage, noch nicht entschieden — braucht Bestätigung vor dem Plan:** clispark selbst ist ein reines Node/TypeScript-Programm ohne PowerShell-Laufzeit. `.psd1` von Node aus zu lesen/schreiben/mergen hat zwei plausible Wege:

1. **Regex-/gezielte Zeilen-Bearbeitung** (analog zum `.csproj`-Ansatz aus M12b, der bewusst keine XML-Library brauchte) — funktioniert nur sicher, weil wir die Manifest-Struktur selbst kontrollieren (immer von uns generiert, kein beliebiges Nutzer-`.psd1`), ähnlich robust wie beim `.csproj`.
2. **Shell-out zu einer echten lokalen `pwsh`-Installation** (`Import-PowerShellDataFile` zum Lesen, PowerShell-Code zum Schreiben) — nutzt dieselbe `cross-spawn`-Shell-out-Konvention wie bereits für `npm`/`dotnet` (M2), technisch robuster (kein selbstgebauter Parser für eine echte Sprache), aber setzt voraus, dass `pwsh` auf der Maschine installiert ist, die `clispark update` ausführt.

`coreFilePaths` (Prinzip, exakte Liste gehört in den Plan): das Modul-Manifest (`.psd1`), die Modul-Root-Datei (`.psm1`, enthält den Proxy-Wrapper-Mechanismus) und `Logging/Initialize-Logging.ps1` sind core-verwaltet — `Public/`-Cmdlets und `tests/` sind wie bei Node/.NET immer nutzereigen, nie core-verwaltet.

**Weiterer echter Architektur-Fund (Plan-Entwurf):** PowerShell-Module benennen Manifest und Root-Modul üblicherweise nach dem Modulnamen (`<ProjektName>.psd1`/`.psm1`). `UpdateAdapter.coreFilePaths` ist aber eine **statische** Liste ohne Projektbezug (Interface-Design, siehe `src/update/adapter.ts`) — genau die Lücke, die der #70-Lint-Tooling-Plan-Review bereits unabhängig im Update-System gefunden hat (`coreFilePaths` kennt den tatsächlichen Projektnamen nicht). Diese Spec löst das PowerShell-spezifisch, **ohne** die generische `UpdateAdapter`-Lücke selbst anzugehen (das ist #70s Aufgabe, nicht diese): Manifest und Root-Modul heißen **immer** `Module.psd1`/`Module.psm1` (generatorintern fix, unabhängig vom Projektnamen) — exakt das gleiche Prinzip wie beim .NET-Template, dessen `Cli.csproj`/`Program.cs` ebenfalls unabhängig vom gewählten Projektnamen immer gleich heißen (der Projektname landet nur in Feldern *innerhalb* der Datei, z.B. `PackageId`, nie im Dateinamen selbst). `RootModule = 'Module.psm1'` bleibt im Manifest fix; der eigentliche Projektname lebt nur im `ModuleVersion`-Nachbarfeld-Kontext bzw. im Ordnernamen, den `scaffoldProject()` ohnehin schon aus `projectName` ableitet. Ein späteres `Publish-PSResource` liest den Modulnamen aus dem Ordner-/Manifest-Kontext zum Publish-Zeitpunkt — kein Konflikt mit `clispark update`, das nur mit fixen internen Namen arbeiten muss.

**Empfehlung:** Option 2 (Shell-out) — ein Nutzer, der ein PowerShell-Modul entwickelt/pflegt, hat zwangsläufig bereits `pwsh` installiert (genau wie `npm`/`dotnet` für die anderen Templates vorausgesetzt werden), und ein Hashtable-Literal mit potenziell verschachtelten Strukturen/Kommentaren/Mehrzeilern robust selbst zu parsen ist riskanter als bei XML. Kern-Felder, die reconciled werden müssen: `ModuleVersion`, `FunctionsToExport`, `RequiredModules` (PSFramework/Pester als Kern-Abhängigkeiten, analog zu Node/.NET-Kern-Dependencies).

## PowerShell-Gallery-`RegistryChecker`

`LanguageRegistry` (erweitert `RegistryChecker` um `defaultUrl`/`promptLabel`, siehe `src/languages/pack.ts`): `defaultUrl` = die öffentliche PowerShell-Gallery-API-Basis-URL (genaue Endpunkt-Form hängt von PowerShellGet- vs. PSResourceGet-Entscheidung ab, siehe offener Punkt unten), `promptLabel` = z.B. "Custom PowerShell repository URL (leave empty for the PowerShell Gallery)", analog zu `NUGET_DEFAULT_REGISTRY_URL`/dessen Prompt-Label in `dotnet.ts`.

Name-Verfügbarkeitscheck über die PowerShell-Gallery-API (REST, kein Auth für reine Verfügbarkeitsabfrage nötig, gleiches Prinzip wie die bestehenden npm-/NuGet-`RegistryChecker`). `applyRegistryUrl()`/`applyPrivateIntent()` bilden das bestehende generische `registryUrl`-Konzept auf PowerShellGet/PSResourceGet-Repository-Registrierung ab (`Register-PSRepository`/`Register-PSResourceRepository` als generierter Setup-Hinweis oder Config-Eintrag, konkret bei der Umsetzung gegen echtes PowerShellGet zu verifizieren) — deckt laut @atze187s Use-Case ("company-internal automation") auch private/interne Repositories ab, ohne dass dafür ein neues Konzept nötig ist.

## Testing (Pester)

Pester (PowerShell-Standard-Testframework, analog zu vitest/xUnit) — ein `.Tests.ps1` pro Cmdlet in `tests/`, `Invoke-Pester` als Test-Runner. Auto-generierte Tests importieren das Modul und rufen das Cmdlet direkt auf (kein Mocking-Framework für den ersten Wurf nötig, analog zum einfachen `hello.test.ts`/`HelloCommandTests.cs`-Vorbild).

## Logging (PSFramework)

PSFramework (etablierte Community-Library, analog zu pino/Serilog) für strukturiertes Logging. Spiegelt die bestehenden Logging-Prinzipien aus M2.5/M8: Redaction sensibler Felder (`registryUrl`), Retention-Sweep, `DEBUG`-gesteuertes Live-Streaming, sichtbarer Log-Pfad bei Erfolg und Fehler. Details (genaue PSFramework-API-Aufrufe) gehören in den Implementierungsplan, nicht hierher — Prinzip ist an dieser Stelle wichtiger als die exakte API.

## Bewusst nicht Teil dieser Arbeit

- Windows PowerShell 5.1 (siehe Scope oben)
- Automatisierte CI/CD-Pipeline-Templates für generierte PowerShell-Module (gleiche projektweite Entscheidung wie bei Node/.NET)
- Alles aus #89–#95 (Shell-Autocompletion, `.clisparkrc`, `clispark doctor`, Dependabot/Renovate, CI-Test-Workflow, CodeQL-Sync) — eigenständige Backlog-Items, nicht Teil dieses Templates

## Offene Punkte für den Implementierungsplan

Drei der ursprünglich fünf Punkte wurden noch während dieser Spec-Session real recherchiert (echter Internetzugriff war verfügbar) und sind damit entschieden; zwei bleiben offen für den Plan bzw. brauchen ein noch nicht verfügbares echtes PS7+-Environment:

1. **Echte Verifikation des Function-Proxy-Wrapper-Mechanismus gegen PowerShell 7+/Core** — weiterhin offen, siehe oben (hier nur gegen Windows PowerShell 5.1 Desktop verifiziert, kein `pwsh` in dieser Sandbox verfügbar).
2. ~~Konkrete PowerShell-7.x-Mindestversion~~ **Entschieden (real recherchiert, 24.07.2026 via Microsofts offizieller Support-Lifecycle-Seite):** aktuelle LTS-Version ist PowerShell 7.6.4 (.NET 10.0, Support bis 14.11.2028); die vorherige LTS-Version 7.4.18 (.NET 8.0) ist ebenfalls noch unterstützt (bis 10.11.2026). PowerShell 7.5 (.NET 9.0) ist explizit **kein** LTS-Release ("Stable" only) — genau das, was @atze187 mit "do not propose features of non-LTS .NET versions" meinte. **Mindestversion: PowerShell 7.4+** (nicht 7.6+) — deckt beide aktuell unterstützten LTS-Linien ab, vermeidet aber jede 7.5-exklusive (.NET-9-only) Funktion.
3. ~~`.psd1`-Lese-/Schreib-Strategie~~ **Entschieden:** Hybrid — **Lesen** via `pwsh`-Shell-out (`Import-PowerShellDataFile` + `ConvertTo-Json`, robuste echte Auswertung der PowerShell-Data-Language-Syntax), **Schreiben** via gezielter Regex-Ersetzung direkt in Node (analog zum `.csproj`-Ansatz — sicher, weil wir das Manifest-Format selbst kontrollieren und nur bekannte Einzelfelder ersetzen, kein Aufruf einer PowerShell-Serialisierung nötig).
4. **`[switch]` vs. `[bool]` für Boolean-Command-Parameter** — Empfehlung `[switch]`, siehe oben, weiterhin zur Bestätigung im Plan (keine echte Recherche nötig, reine Konventionsentscheidung).
5. ~~PowerShellGet vs. PSResourceGet~~ **Entschieden (real geprüft, 24.07.2026):** `Microsoft.PowerShell.PSResourceGet` ist der aktuelle, aktiv gepflegte Nachfolger (stabile v1.0.0 auf der Gallery bestätigt) mit den passenden Cmdlets (`Find-PSResource`, `Register-PSResourceRepository`, `Publish-PSResource`, ...). Es ist **nicht** garantiert in PowerShell 7.4+/7.6 vorinstalliert — muss daher genau wie `PSFramework`/`Pester` über den `scaffoldCommands`-Installationsschritt mitinstalliert werden (`Install-Module -Name PSFramework,Pester,Microsoft.PowerShell.PSResourceGet ...`).

## Ergebnis

Vollständiges Design für ein drittes `LanguagePack` (PowerShell 7+, Modul mit Cmdlets), das den riskantesten Mechanismus (Function-Proxy-Wrapper für Auto-Logging/Error-Handling ohne Opt-out) bereits real prototypt und verifiziert hat — inklusive zweier echter, nicht offensichtlicher Fundstellen (Reihenfolge Rename-vs-Metadata, Export-Filter gegen die "unapproved verb"-Warnung), einer echten Korrektur gegenüber dem M12-Sanity-Check (`scaffoldCommands` doch nicht leer) und eines echten, beim Plan-Entwurf entdeckten Architektur-Erweiterungsbedarfs in `add-wizard.ts` (neue optionale `CommandGenerator.promptCommandIdentity()`-Methode). Fünf konkrete offene Punkte bleiben für den Implementierungsplan, mit jeweils einer begründeten Empfehlung, wo eine sinnvoll ist.
