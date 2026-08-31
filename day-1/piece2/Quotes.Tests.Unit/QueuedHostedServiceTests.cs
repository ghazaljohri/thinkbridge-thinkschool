using System.Diagnostics;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using QuotesApi.Services.BackgroundTasks;

namespace Quotes.Tests.Unit;

public sealed class QueuedHostedServiceTests
{
    private static QueuedHostedService CreateService(IBackgroundTaskQueue queue) =>
        new(queue, NullLogger<QueuedHostedService>.Instance);

    // A bare `Task.WhenAny(task, Task.Delay(longTimeout))` leaves that timer
    // running for its full duration even after `task` wins, since nothing
    // ever cancels the loser - across many tests in one process those
    // abandoned timers pile up. Tying the delay to a CancellationTokenSource
    // that's always disposed means the timer is torn down the moment it's no
    // longer needed either way.
    private static async Task WaitWithTimeoutAsync(Task task, TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource();
        var delay = Task.Delay(timeout, cts.Token);
        var completed = await Task.WhenAny(task, delay);
        await cts.CancelAsync();

        completed.Should().BeSameAs(task, "the work item should have completed before the timeout");
    }

    [Fact]
    public async Task StartAsync_WorkItemQueuedAfterStart_IsExecuted()
    {
        // Arrange
        var queue = new BackgroundTaskQueue(capacity: 10);
        var service = CreateService(queue);
        var executed = new TaskCompletionSource();
        await service.StartAsync(CancellationToken.None);

        // Act
        await queue.QueueBackgroundWorkItemAsync(_ =>
        {
            executed.SetResult();
            return Task.CompletedTask;
        });

        // Assert
        await WaitWithTimeoutAsync(executed.Task, TimeSpan.FromSeconds(15));

        await service.StopAsync(CancellationToken.None);
        service.Dispose();
    }

    [Fact]
    public async Task ExecuteAsync_WorkItemThrows_StillExecutesTheNextQueuedItem()
    {
        // Arrange
        var queue = new BackgroundTaskQueue(capacity: 10);
        var service = CreateService(queue);
        var secondItemExecuted = new TaskCompletionSource();
        await service.StartAsync(CancellationToken.None);

        // Act
        await queue.QueueBackgroundWorkItemAsync(_ => throw new InvalidOperationException("boom"));
        await queue.QueueBackgroundWorkItemAsync(_ =>
        {
            secondItemExecuted.SetResult();
            return Task.CompletedTask;
        });

        // Assert - the throwing first item didn't stop the worker loop
        await WaitWithTimeoutAsync(secondItemExecuted.Task, TimeSpan.FromSeconds(15));

        await service.StopAsync(CancellationToken.None);
        service.Dispose();
    }

    [Fact]
    public async Task StopAsync_ItemsAlreadyQueuedBeforeShutdown_AreDrainedBeforeTheWorkerStops()
    {
        // Arrange
        var queue = new BackgroundTaskQueue(capacity: 10);
        var service = CreateService(queue);
        var firstExecuted = new TaskCompletionSource();
        var secondExecuted = new TaskCompletionSource();

        // Both items are queued before the worker ever starts, so they're
        // sitting in the channel the instant shutdown begins.
        await queue.QueueBackgroundWorkItemAsync(_ =>
        {
            firstExecuted.SetResult();
            return Task.CompletedTask;
        });
        await queue.QueueBackgroundWorkItemAsync(_ =>
        {
            secondExecuted.SetResult();
            return Task.CompletedTask;
        });

        // Act - start and immediately request shutdown, before the loop
        // would otherwise have had time to drain the queue on its own.
        await service.StartAsync(CancellationToken.None);
        var stopTask = service.StopAsync(CancellationToken.None);

        // Assert - both queued items ran to completion. Awaited with a
        // timeout guard rather than checked synchronously the instant
        // StopAsync returns, so this proves what actually happened instead
        // of just what had happened by one particular instant.
        await WaitWithTimeoutAsync(firstExecuted.Task, TimeSpan.FromSeconds(15));
        await WaitWithTimeoutAsync(secondExecuted.Task, TimeSpan.FromSeconds(15));
        await stopTask;
        service.Dispose();
    }

    [Fact]
    public async Task StopAsync_QueueEmpty_ReturnsPromptlyInsteadOfWaitingForNewWork()
    {
        // Arrange
        var queue = new BackgroundTaskQueue(capacity: 10);
        var service = CreateService(queue);
        await service.StartAsync(CancellationToken.None);
        var stopwatch = Stopwatch.StartNew();

        // Act
        await service.StopAsync(CancellationToken.None);
        service.Dispose();

        // Assert - shutdown isn't blocked on DequeueAsync waiting for work
        // that was never coming.
        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(1));
    }
}
