# ADR 004: IMAP Poller Runs in Thread Executor, Not Native Async

**Status:** Accepted  
**Date:** 2026-01-01  
**Deciders:** bullitt

## Context

The IMAP poller needs to run periodically alongside the FastAPI async event loop. Python's standard library `imaplib` is synchronous (blocking I/O). Options:

1. **Run `imaplib` directly in an async function:** Blocks the event loop during IMAP connections, freezing all HTTP request handling for the duration.
2. **Use an async IMAP library (e.g. `aioimaplib`):** True async but adds a dependency and requires adapting the message-parsing logic.
3. **Run `imaplib` in a thread executor:** `asyncio.get_event_loop().run_in_executor(None, self._poll)` offloads the blocking call to a thread pool, keeping the event loop free.

## Decision

Run the synchronous `imaplib`-based `_poll()` method in the default thread executor via `run_in_executor(None, self._poll)`.

The async `_loop()` task runs inside the FastAPI event loop and handles scheduling (sleep intervals, task cancellation). The blocking IMAP I/O is offloaded to a thread. Results are handled synchronously within `_poll()` — there is no need to return data to the async layer since `process_email()` is also synchronous.

## Consequences

**Positive:**
- No additional async dependencies.
- The event loop remains unblocked during IMAP connections (which can take several seconds on slow networks).
- Standard library `imaplib` is well-tested and supports all required IMAP operations including RFC 6851 MOVE.
- Error handling is straightforward: exceptions in `_poll()` propagate to the executor and are caught in the async wrapper.

**Negative:**
- Thread pool usage adds memory overhead (one thread per poll cycle that is in-flight).
- Concurrent access to `imaplib` connection objects is not thread-safe; this is avoided by creating a new connection per poll cycle.
- The `process_email()` call inside `_poll()` is synchronous; any async side effects (MQTT publish) are scheduled via `loop.create_task()` from the ingest module's notifier, which is safe because the loop is still running.

**Note:** The scheduler uses native `asyncio` (no thread executor) because `httpx.AsyncClient` is natively async. The two subsystems deliberately use different concurrency patterns suited to their I/O characteristics.
