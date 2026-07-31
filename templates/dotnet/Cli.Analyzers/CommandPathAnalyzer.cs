using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Cli.Analyzers;

[DiagnosticAnalyzer(LanguageNames.CSharp)]
public sealed class CommandPathAnalyzer : DiagnosticAnalyzer
{
    public const string DiagnosticId = "CLISPARK001";

    private static readonly DiagnosticDescriptor Rule = new(
        DiagnosticId,
        title: "ICliCommand implementers must carry [CommandPath]",
        messageFormat: "'{0}' implements ICliCommand but has no [CommandPath] attribute (checked including inherited base types) -- command discovery will crash at runtime",
        category: "Usage",
        DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => ImmutableArray.Create(Rule);

    public override void Initialize(AnalysisContext context)
    {
        context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
        context.EnableConcurrentExecution();
        context.RegisterSyntaxNodeAction(AnalyzeClassDeclaration, SyntaxKind.ClassDeclaration);
    }

    private static void AnalyzeClassDeclaration(SyntaxNodeAnalysisContext context)
    {
        var classDeclaration = (ClassDeclarationSyntax)context.Node;
        if (context.SemanticModel.GetDeclaredSymbol(classDeclaration) is not INamedTypeSymbol classSymbol) return;
        if (classSymbol.IsAbstract) return;

        var implementsICliCommand = classSymbol.AllInterfaces.Any(i => i.Name == "ICliCommand");
        if (!implementsICliCommand) return;

        if (HasCommandPathAttribute(classSymbol)) return;

        context.ReportDiagnostic(Diagnostic.Create(Rule, classDeclaration.Identifier.GetLocation(), classSymbol.Name));
    }

    // Walks the base-type chain, not just the declared type -- CommandPathAttribute has no
    // [AttributeUsage(Inherited = false)] override, so the CLR default (Inherited = true)
    // applies, and CommandDiscovery.cs's GetCustomAttribute<CommandPathAttribute>() call uses
    // the default inherit:true parameter too. A subclass that inherits [CommandPath] from a
    // base command class works fine at runtime; flagging it here would be a false positive.
    private static bool HasCommandPathAttribute(INamedTypeSymbol? type)
    {
        for (var current = type; current is not null; current = current.BaseType)
        {
            if (current.GetAttributes().Any(a => a.AttributeClass?.Name == "CommandPathAttribute")) return true;
        }
        return false;
    }
}
