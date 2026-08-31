using System.Threading.Channels;

namespace QuotesApi.Services.BackgroundTasks;

public sealed class BackgroundTaskQueue : IBackgroundTaskQueue
{
    private readonly Channel<Func<CancellationToken, Task>> _channel;

    public BackgroundTaskQueue(int capacity)
    {
        // Bounded + Wait: a producer that outpaces the drain loop is made to
        // wait for room instead of the queue growing without limit (DropWrite/
        // DropOldest would silently discard work, which is worse than a slower
        // request for anything callers actually care gets done).
        _channel = Channel.CreateBounded<Func<CancellationToken, Task>>(
            new BoundedChannelOptions(capacity)
            {
                FullMode = BoundedChannelFullMode.Wait,
            });
    }

    public async ValueTask QueueBackgroundWorkItemAsync(Func<CancellationToken, Task> workItem)
    {
        ArgumentNullException.ThrowIfNull(workItem);
        await _channel.Writer.WriteAsync(workItem);
    }

    public async ValueTask<Func<CancellationToken, Task>> DequeueAsync(CancellationToken cancellationToken)
    {
        return await _channel.Reader.ReadAsync(cancellationToken);
    }

    public bool TryDequeue(out Func<CancellationToken, Task>? workItem)
    {
        return _channel.Reader.TryRead(out workItem);
    }
}
