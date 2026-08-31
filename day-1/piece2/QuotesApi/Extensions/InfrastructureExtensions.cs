using QuotesApi.Services;
using QuotesApi.Services.BackgroundTasks;
using Microsoft.EntityFrameworkCore;
using QuotesApi.Data;
using QuotesApi.Queries;
using QuotesApi.Repositories;

namespace QuotesApi.Extensions;

public static class InfrastructureExtensions
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? "Data Source=quotes.db";

        services.AddDbContext<AppDbContext>(options =>
            options.UseSqlite(connectionString));

        services.AddScoped<IQuoteRepository, QuoteRepository>();
        services.AddScoped<ICollectionRepository, CollectionRepository>();
        services.AddScoped<ICollectionQueries, CollectionQueries>();

        services.AddSingleton<IClock, SystemClock>();

        // Capacity of 100: enough to absorb a burst without an endpoint
        // blocking on QueueBackgroundWorkItemAsync under normal load, small
        // enough that a stuck worker fails loudly (callers start waiting on
        // BoundedChannelFullMode.Wait) instead of memory growing unbounded.
        services.AddSingleton<IBackgroundTaskQueue>(_ => new BackgroundTaskQueue(capacity: 100));
        services.AddHostedService<QueuedHostedService>();

        return services;
    }

    public static async Task ApplyMigrationsAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
    }
}
