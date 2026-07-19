using Serilog.Core;
using Serilog.Events;

namespace Cli.Logging;

/// <summary>Masks known sensitive property names before they reach any sink. Mirrors the Node template's SENSITIVE_LOG_KEYS/pino redact.</summary>
public sealed class SensitivePropertyEnricher(IReadOnlyCollection<string> sensitiveKeys) : ILogEventEnricher
{
    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        foreach (var actualKey in logEvent.Properties.Keys.ToList())
        {
            if (sensitiveKeys.Any(k => string.Equals(k, actualKey, StringComparison.OrdinalIgnoreCase)))
            {
                logEvent.AddOrUpdateProperty(propertyFactory.CreateProperty(actualKey, "***REDACTED***"));
            }
        }
    }
}
