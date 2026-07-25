using System.Globalization;
using Serilog;
using Serilog.Core;
using Xdg.Directories;

namespace Cli.Logging;

public static class CliLoggerFactory
{
    private static readonly string[] SensitiveKeys = ["password", "secret", "token", "apiKey", "registryUrl"];
    private const int RetentionDays = 14;
    private const string SweepMarkerFile = ".last-sweep";
    private static readonly TimeSpan SweepThrottle = TimeSpan.FromHours(24);

    public static (Logger Logger, string LogFilePath) Create(string commandName, string appName)
    {
        var logDir = Path.Combine(BaseDirectory.StateHome, appName, "Log");
        Directory.CreateDirectory(logDir);
        SweepOldLogs(logDir);

        var timestamp = DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss-fffZ", CultureInfo.InvariantCulture);
        var suffix = Guid.NewGuid().ToString("N")[..6];
        var logFilePath = Path.Combine(logDir, $"{commandName}-{timestamp}-{suffix}.log");

        var config = new LoggerConfiguration()
            .Enrich.With(new SensitivePropertyEnricher(SensitiveKeys))
            .WriteTo.File(logFilePath, formatProvider: CultureInfo.InvariantCulture);

        if (Environment.GetEnvironmentVariable("DEBUG") is not null)
        {
            config = config.WriteTo.Console(formatProvider: CultureInfo.InvariantCulture);
        }

        var logger = config.CreateLogger();

        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(logFilePath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }

        return (logger, logFilePath);
    }

    private static void SweepOldLogs(string logDir)
    {
        try
        {
            var markerPath = Path.Combine(logDir, SweepMarkerFile);
            if (File.Exists(markerPath) && DateTime.UtcNow - File.GetLastWriteTimeUtc(markerPath) < SweepThrottle)
            {
                return;
            }

            var cutoff = DateTime.UtcNow.AddDays(-RetentionDays);
            foreach (var file in Directory.GetFiles(logDir))
            {
                if (Path.GetFileName(file) == SweepMarkerFile) continue;
                if (File.GetLastWriteTimeUtc(file) < cutoff)
                {
                    File.Delete(file);
                }
            }

            File.WriteAllText(markerPath, string.Empty);
        }
        catch
        {
            // best-effort; a sweep failure must never affect the surrounding command
        }
    }
}
