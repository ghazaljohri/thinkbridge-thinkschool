# Day 13 — Verification Note

`quotes-web` is a standalone, zoneless Angular app against the real Week-1 API
(`QuotesApi`), not a mocked one. No `NgModule` anywhere, no `zone.js` in the
dependency tree at all (`provideZonelessChangeDetection()` in `app.config.ts`),
state as `signal`/`computed`/`effect` end to end, and `@if`/`@for`/`@switch`
instead of structural directives. `inject()` replaces every constructor
injection, including in the functional route guard and HTTP interceptor,
which don't have a constructor to put it in.

## What was actually exercised, not just written

Directing an agent to scaffold this is the easy 80%. The verification is the
part that matters, so this is what got checked against the running API rather
than assumed from reading the code:

- **The ownership rule on delete is real, and it fails by default.**
  `can-delete-own-quote` only succeeds when the caller's JWT email matches
  the quote's `Author` string exactly. Logged in as the seeded
  `test@example.com`, deleting someone else's quote returns 403 and the UI
  surfaces "Only \<author\> can delete this quote." without touching the list;
  deleting a quote authored as `test@example.com` returns 204 and the list
  reloads. Both paths were driven against the live API with curl before
  trusting the component test that asserts the same thing.
- **Pagination bounds.** `goToPage` clamps at 1 and at `totalPages()`; verified
  with a 12-item / 5-per-page fixture that page 3 is the last one and neither
  boundary button does anything past it.
- **The empty-form guard never reaches the network.** Submitting the create
  form with a blank author or text sets a validation error and asserts (via
  `HttpTestingController`) that no `POST` goes out.
- **The 401 → refresh → retry path.** A request that comes back 401 triggers
  exactly one `/api/auth/refresh` call and one retry with the new token; a
  refresh that itself fails clears the session instead of looping.
- **CORS is opt-in, not wide open.** `AllowedOrigins` is empty by default; only
  `appsettings.Development.json` sets it to `http://localhost:4200`, so a
  production deploy doesn't inherit the dev server's origin unless someone
  configures it on purpose.
- **Loading/error/empty states render, not just exist in the template.** Both
  resource-backed views are asserted mid-flight (before the response lands,
  status is still `loading`) and on a 500 (the `@switch`'s `'error'` case /
  the `@else if` branch), not just on the happy path.

30 Angular unit tests cover the above (`npm test`), the existing 62 .NET unit
tests still pass unchanged, both `ng build` and `dotnet build` are clean, and
the full loop — login, create as two different authors, list, author summary,
delete (403 then 204) — was run end to end against a live `dotnet run`
instance via curl. The one thing not done: clicking through it in an actual
browser, since no browser tool was available this session. Everything above
was checked at the HTTP/component level instead.

## What zoneless actually changes

With `zone.js`, Angular has no idea what changed after an async callback —
it just knows *something* might have, because zone.js patched every async API
(`setTimeout`, `Promise`, DOM events, XHR) to say "the app might be dirty, walk
every component and check." That's why classic Angular change detection is a
tree walk from the root on every tick, regardless of how small the actual
change was.

Zoneless removes that patching entirely. There's no global "something async
happened" signal, so re-rendering has to come from something more precise:
Angular now schedules a check only when a `signal` a template actually reads
gets written to. `httpResource()`'s `value`/`status`/`error` are signals for
exactly this reason — the resource writing to them *is* the notification, not
a side effect of one. A `computed()` like `totalPages()` only recalculates
when the signals inside it change, and a component whose template doesn't
read any changed signal is never touched at all.

The practical edge this produces: in a unit test, calling
`component.goToPage(2)` directly (not through a click Angular's event
binding instruments) changes the `page` signal, but nothing forces Angular to
flush the reactive graph and act on it — there's no zone patch catching "an
async thing happened, go check." In the real app this is invisible, because
the signal write always finds its way to a scheduled render. In a test
driving the component by hand, it doesn't get that for free, which is why
`quotes-list.spec.ts` calls `fixture.detectChanges()` right after `goToPage`
and after `createQuote`/`deleteQuote` resolve — to explicitly ask for the
flush that a real click would have triggered implicitly.
