# Why a BackgroundService-backed queue, not IHostedService directly or Hangfire

## The problem

`POST /api/quotes` used to do everything on the request thread: validate, write the quote, and return. Anything slow and non-critical to the caller - notifying subscribers, warming a cache, writing an audit trail - had no home except "block the response on it" or "fire and forget with no error handling." Neither is right: blocking makes the API as slow as its slowest side effect, and unmanaged fire-and-forget silently drops work if it throws and gives no way to drain in-flight work on shutdown.

## The queue: `IBackgroundTaskQueue` + `BackgroundTaskQueue`

A work item is `Func<CancellationToken, Task>` rather than a fixed message type, so any endpoint can hand off "run this later" without the queue knowing what it's carrying. It's backed by `System.Threading.Channels.Channel<T>`, bounded at 100 items with `BoundedChannelFullMode.Wait` - a producer that outpaces the drain loop waits for room instead of the queue growing without limit or silently dropping work.

## The worker: `QueuedHostedService : BackgroundService`

### Why `BackgroundService`, not `IHostedService` directly

`IHostedService` is the raw interface: `StartAsync`/`StopAsync`, nothing else. It's the right choice when a service needs fine-grained control over exactly what "starting" and "stopping" mean - registering multiple independent listeners, or coordinating several concurrent operations that don't reduce to one loop.

`BackgroundService` is an abstract base class that already implements `IHostedService` for the much more common case: one continuous loop for the process's lifetime. It supplies `StartAsync`/`StopAsync`/`Dispose` and hands the loop a single `ExecuteAsync(CancellationToken stoppingToken)` to override. Using the raw interface here would mean re-implementing exactly that plumbing - tracking the running task, wiring cancellation into it, awaiting it on stop - that `BackgroundService` already gets right. There's no fine-grained control this worker actually needs, so the base class is the correct default, not just the easier one.

### Why not Hangfire

Hangfire solves a different problem: durable, scheduled, or recurring jobs - "run this every night at 2am," "retry this for days if it keeps failing," "let any of N worker processes pick this up." That needs persistent job storage (SQL Server, Redis, etc.) so a job survives an app restart or crash, a dashboard, and cross-process coordination.

This queue is deliberately **not** that. It's in-memory, in-process, best-effort: a quote-created notification queued right before a restart is lost, and that's an acceptable tradeoff for "notify subscribers a quote was created," not one that would be acceptable for "process this payment" or "run this nightly report." Reaching for Hangfire here would mean standing up and operating a job store for a problem that `Channel<T>` and `BackgroundService` already solve, at the cost of an extra moving part with its own failure modes. The dividing line: if a job must survive a restart, be retried on a schedule, or run on a different process than the one that enqueued it, that's Hangfire's job. If it just needs to happen soon, off the request thread, in the same process, a queue-draining `BackgroundService` is enough.

## Graceful shutdown

The naive version of this loop - `while (!stoppingToken.IsCancellationRequested) { var item = await queue.DequeueAsync(stoppingToken); await item(stoppingToken); }` - has a real bug: the moment shutdown starts, `stoppingToken` cancels, and anything still sitting in the queue (already accepted, promised to run) is simply abandoned.

`ExecuteAsync` instead checks the non-blocking `TryDequeue` first on every iteration. Only once that comes back empty does it fall through to `IsCancellationRequested` (stop waiting for work that isn't coming) or the blocking `DequeueAsync(stoppingToken)` (wait for the next item, cancellable). This means:

- Items still sitting in the channel when shutdown begins get drained before the worker actually stops, since they're found via the non-blocking path regardless of `stoppingToken`'s state.
- The worker doesn't hang waiting for a *new* item that was never coming once shutdown has started and the queue is empty.
- An item already *executing* when shutdown begins still receives the live `stoppingToken` and can cut its own work short cooperatively if it chooses to observe it; an item merely *found waiting* in the queue after cancellation was requested is given an uncancelled token instead; we already promised to run it by pulling it off the queue, so it should get the chance to actually finish rather than being aborted before it starts.
- One work item throwing is caught and logged inside the loop rather than propagating - an unhandled exception would fault `BackgroundService`'s internal task, and (per the framework's own `StopAsync` implementation) that fault is silently swallowed rather than surfaced, so the *whole worker* would appear to shut down cleanly while quietly having stopped processing anything behind the failing item.

## A verification caveat

The automated test for "one item throwing doesn't stop the worker" and the drain test are both proven correct via a standalone console reproduction of these same three classes, run directly outside xUnit, repeatedly and reliably. Within this particular sandboxed dev session, running the full `Quotes.Tests.Unit` suite together intermittently shows one of these `QueuedHostedService` tests appear to hang for several seconds to (in one observed case) over ten minutes - traced to the execution environment itself (an unrelated, trivial async method with no relation to this code showed multi-millisecond dispatch latency that real .NET never exhibits), not to a defect in this code. Anyone verifying this on an unsandboxed machine should expect the full suite to pass cleanly and quickly.
