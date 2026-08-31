using QuotesApi.Models;
using Microsoft.AspNetCore.Authorization;
using QuotesApi.Repositories;
using QuotesApi.Services;
using QuotesApi.Services.BackgroundTasks;

namespace QuotesApi.Extensions;

public static class QuoteEndpointExtensions
{
    public static void MapQuoteEndpoints(this WebApplication app)
    {
        app.MapGet("/api/quotes", async (
            int? page,
            int? size,
            IQuoteRepository repository,
            CancellationToken cancellationToken) =>
        {
            var currentPage = page ?? 1;
            var pageSize = size ?? 10;

            if (currentPage < 1 || pageSize < 1 || pageSize > 100)
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    ["page"] = currentPage < 1
                        ? ["Page must be at least 1."]
                        : [],
                    ["size"] = pageSize < 1 || pageSize > 100
                        ? ["Size must be between 1 and 100."]
                        : []
                });
            }

            var (items, total) = await repository.GetPagedAsync(
                currentPage, pageSize, cancellationToken);

            return Results.Ok(new
            {
                page = currentPage,
                size = pageSize,
                total,
                items
            });
        });

        app.MapPost("/api/quotes", async (
            QuoteRequest request,
            IQuoteRepository repository,
            IClock clock,
            IBackgroundTaskQueue backgroundTaskQueue,
            ILogger<Program> logger,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var quote = Quote.Create(
                    request.Author,
                    request.Text,
                    clock.UtcNow);

                var created = await repository.AddAsync(
                    quote,
                    cancellationToken);

                logger.LogInformation(
                    "Created quote {QuoteId} by {Author}",
                    created.Id,
                    created.Author);

                // Stands in for a real slow, non-critical side effect (an
                // outbound webhook, a search-index update) - queued rather
                // than awaited so the response below doesn't wait on it.
                await backgroundTaskQueue.QueueBackgroundWorkItemAsync(async workCancellationToken =>
                {
                    await Task.Delay(TimeSpan.FromSeconds(2), workCancellationToken);
                    logger.LogInformation(
                        "Notified subscribers of new quote {QuoteId}",
                        created.Id);
                });

                return Results.Created(
                    $"/api/quotes/{created.Id}",
                    created);
            }
            catch (ArgumentException ex)
            {
                return Results.ValidationProblem(
                    new Dictionary<string, string[]>
                    {
                        [ex.ParamName ?? "request"] = [ex.Message]
                    });
            }
        }).RequireAuthorization("can-edit-quotes");

        app.MapGet("/api/quotes/{id:int}", async (
            int id,
            IQuoteRepository repository,
            CancellationToken cancellationToken) =>
        {
            var quote = await repository.GetByIdAsync(
                id,
                cancellationToken);

            return quote is null
                ? Results.NotFound()
                : Results.Ok(quote);
        });

        app.MapDelete("/api/quotes/{id:int}", async (
            int id,
            IQuoteRepository repository,
            IAuthorizationService authorizationService,
            HttpContext httpContext,
            ILogger<Program> logger,
            CancellationToken cancellationToken) =>
        {
            var quote = await repository.GetByIdAsync(
                id,
                cancellationToken);

            if (quote is null)
                return Results.NotFound();

            var authorizationResult = await authorizationService.AuthorizeAsync(
                httpContext.User,
                quote,
                "can-delete-own-quote");

            if (!authorizationResult.Succeeded)
                return Results.Forbid();

            var deleted = await repository.DeleteAsync(
                id,
                cancellationToken);

            if (!deleted)
                return Results.NotFound();

            logger.LogInformation(
                "Deleted quote {QuoteId}",
                id);

            return Results.NoContent();
        }).RequireAuthorization();
    }

    public sealed record QuoteRequest(
        string Author,
        string Text);
}
