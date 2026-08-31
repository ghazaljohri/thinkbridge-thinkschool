using FluentAssertions;
using QuotesApi.Services.BackgroundTasks;

namespace Quotes.Tests.Unit;

public sealed class BackgroundTaskQueueTests
{
    [Fact]
    public async Task QueueThenDequeue_TwoItems_ReturnsThemInFifoOrder()
    {
        // Arrange
        var queue = new BackgroundTaskQueue(capacity: 10);
        Task First(CancellationToken _) => Task.CompletedTask;
        Task Second(CancellationToken _) => Task.CompletedTask;

        // Act
        await queue.QueueBackgroundWorkItemAsync(First);
        await queue.QueueBackgroundWorkItemAsync(Second);
        var firstDequeued = await queue.DequeueAsync(CancellationToken.None);
        var secondDequeued = await queue.DequeueAsync(CancellationToken.None);

        // Assert
        firstDequeued.Should().Be((Func<CancellationToken, Task>)First);
        secondDequeued.Should().Be((Func<CancellationToken, Task>)Second);
    }

    [Fact]
    public void TryDequeue_QueueEmpty_ReturnsFalse()
    {
        // Arrange
        var queue = new BackgroundTaskQueue(capacity: 10);

        // Act
        var dequeued = queue.TryDequeue(out var workItem);

        // Assert
        dequeued.Should().BeFalse();
        workItem.Should().BeNull();
    }

    [Fact]
    public async Task TryDequeue_ItemQueued_ReturnsTrueAndTheItem()
    {
        // Arrange
        var queue = new BackgroundTaskQueue(capacity: 10);
        Task WorkItem(CancellationToken _) => Task.CompletedTask;
        await queue.QueueBackgroundWorkItemAsync(WorkItem);

        // Act
        var dequeued = queue.TryDequeue(out var workItem);

        // Assert
        dequeued.Should().BeTrue();
        workItem.Should().Be((Func<CancellationToken, Task>)WorkItem);
    }

    [Fact]
    public async Task DequeueAsync_TokenAlreadyCancelledAndQueueEmpty_ThrowsOperationCanceledException()
    {
        // Arrange
        var queue = new BackgroundTaskQueue(capacity: 10);
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        // Act
        var act = () => queue.DequeueAsync(cts.Token).AsTask();

        // Assert
        await act.Should().ThrowAsync<OperationCanceledException>();
    }
}
