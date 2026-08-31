namespace QuotesApi.Services.BackgroundTasks;

// BackgroundService (not the raw IHostedService) because this is exactly the
// shape it's designed for: one continuous loop for the lifetime of the host.
// IHostedService's StartAsync/StopAsync pair would work too, but we'd be
// hand-rolling the "run a loop, stop it on shutdown" plumbing BackgroundService
// already gives us via ExecuteAsync(CancellationToken).
public sealed class QueuedHostedService : BackgroundService
{
    private readonly IBackgroundTaskQueue _queue;
    private readonly ILogger<QueuedHostedService> _logger;

    public QueuedHostedService(IBackgroundTaskQueue queue, ILogger<QueuedHostedService> logger)
    {
        _queue = queue;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Background task queue worker starting.");

        while (true)
        {
            // TryDequeue first: once shutdown begins, stoppingToken is
            // cancelled and DequeueAsync's wait would throw immediately -
            // checking the non-blocking path first means anything already
            // sitting in the channel still gets run instead of abandoned.
            if (_queue.TryDequeue(out var queuedItem))
            {
                // A work item found via the non-blocking path might have been
                // sitting in the queue since before shutdown was requested.
                // Once stoppingToken has already fired, drain it with an
                // uncancelled token so it actually completes instead of being
                // aborted the instant it starts - we already promised to run
                // it by pulling it off the queue. An item that was already
                // *executing* when shutdown began still sees stoppingToken
                // below and can cut itself short cooperatively; this only
                // applies to ones that hadn't started yet.
                var executionToken = stoppingToken.IsCancellationRequested
                    ? CancellationToken.None
                    : stoppingToken;

                await RunWorkItemAsync(queuedItem!, executionToken);
                continue;
            }

            // Nothing queued, and we're shutting down: stop waiting for work
            // that was never going to arrive, rather than blocking StopAsync
            // until the host's shutdown timeout forces the process down.
            if (stoppingToken.IsCancellationRequested)
                break;

            Func<CancellationToken, Task> workItem;
            try
            {
                workItem = await _queue.DequeueAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Cancelled while waiting for the *next* item - loop back so
                // the TryDequeue/IsCancellationRequested checks above decide
                // whether there's still a last item to drain or it's time to stop.
                continue;
            }

            await RunWorkItemAsync(workItem, stoppingToken);
        }

        _logger.LogInformation("Background task queue worker stopped.");
    }

    private async Task RunWorkItemAsync(Func<CancellationToken, Task> workItem, CancellationToken cancellationToken)
    {
        try
        {
            // The token still reaches the work item so one that's actually
            // running when shutdown starts can observe it and cut its own
            // work short - it just isn't used to avoid *starting* a
            // still-queued item once dequeued via TryDequeue above.
            await workItem(cancellationToken);
        }
        catch (Exception ex)
        {
            // One bad work item must not take down the worker - everything
            // still in the queue behind it still deserves to run.
            _logger.LogError(ex, "Unhandled exception executing a background work item.");
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Background task queue worker stopping; draining any queued work first.");
        await base.StopAsync(cancellationToken);
    }
}
