namespace Cli;

/// <summary>
/// Declares the full, space-separated invocation path for an <see cref="ICliCommand"/>
/// (e.g. "task list" for a "list" subcommand nested under "task"). The class name alone
/// cannot express nesting, so this is required on every discovered command.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
public sealed class CommandPathAttribute(string path) : Attribute
{
    public string Path { get; } = path;
}
