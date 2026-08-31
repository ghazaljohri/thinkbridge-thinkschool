namespace QuotesApi.Services.BackgroundTasks;

// A work item is a delegate rather than a fixed message type, so any endpoint
// can hand off "run this later, off the request thread" without the queue
// needing to know what kind of work it's carrying.
public interface IBackgroundTaskQueue
{
    // Backpressures the caller (via BoundedChannelFullMode.Wait in the
    // implementation) instead of dropping work when the queue is full - a
    // request that enqueues work waits for room rather than silently losing it.
    ValueTask QueueBackgroundWorkItemAsync(Func<CancellationToken, Task> workItem);

    // Used by QueuedHostedService's main loop: waits for a work item if the
    // queue is empty, honoring cancellationToken so shutdown doesn't hang here.
    ValueTask<Func<CancellationToken, Task>> DequeueAsync(CancellationToken cancellationToken);

    // Non-blocking. Lets the hosted service drain everything already sitting
    // in the queue during shutdown without waiting on DequeueAsync for work
    // that was never going to arrive.
    bool TryDequeue(out Func<CancellationToken, Task>? workItem);
}
