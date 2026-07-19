using System.CommandLine;
using System.Reflection;

namespace Cli;

public static class CommandDiscovery
{
    /// <summary>
    /// Scans the given assembly for every ICliCommand, reads its CommandPathAttribute,
    /// and attaches it to the tree rooted at <paramref name="root"/> — creating bare
    /// container commands for any missing intermediate path segments.
    /// </summary>
    public static void RegisterAll(RootCommand root, Assembly assembly)
    {
        var commandTypes = assembly
            .GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } && typeof(ICliCommand).IsAssignableFrom(t));

        foreach (var type in commandTypes)
        {
            var attribute = type.GetCustomAttribute<CommandPathAttribute>()
                ?? throw new InvalidOperationException($"{type.FullName} implements ICliCommand but has no [CommandPath].");

            var instance = (ICliCommand)Activator.CreateInstance(type)!;
            var command = instance.Build();

            var segments = attribute.Path.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var parent = FindOrCreateParent(root, segments[..^1]);
            parent.Subcommands.Add(command);
        }
    }

    private static Command FindOrCreateParent(RootCommand root, string[] parentSegments)
    {
        Command current = root;
        foreach (var segment in parentSegments)
        {
            var existing = current.Subcommands.FirstOrDefault(c => c.Name == segment);
            if (existing is null)
            {
                existing = new Command(segment);
                current.Subcommands.Add(existing);
            }
            current = existing;
        }
        return current;
    }
}
