namespace Cli;

/// <summary>An expected, user-fixable failure — distinct from an unexpected crash. Mirrors clispark's own UserError.</summary>
public sealed class CliUserException(string message) : Exception(message);
