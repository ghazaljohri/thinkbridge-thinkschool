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

## List + detail: the two bugs the first draft actually had

`core/quotes.ts` and `features/quotes-explorer/` are a master-detail view over
the same real endpoints: `GET /api/quotes?page&size` for the list, and
`GET /api/quotes/{id}` for a single quote (200 with the `Quote` shape, or a
genuinely empty-bodied 404 — confirmed with `curl -i`, not assumed). The
service holds `list`/`listLoading`/`listError` and
`detail`/`detailLoading`/`detailError` as signals, injected into the
component with `inject(Quotes)`.

The first version I wrote called `.subscribe((result) => ...)` with only a
`next` callback on both `loadList()` and `loadDetail()`. Writing
`quotes.spec.ts` against it surfaced two real problems, not hypothetical
ones — the test run itself failed with an **uncaught `HttpErrorResponse`**
for both a simulated 500 on the list and a 404 on the detail: RxJS doesn't
silently drop an unhandled `error` on a `subscribe()` call, it throws. So the
bug wasn't "the error gets swallowed," it was worse — `listLoading`/
`detailLoading` stay `true` forever (nothing ever sets them back to `false`
on that path) while the error itself escapes as an unhandled exception
instead of ever reaching `listError`/`detailError`. Confirmed by running the
test file before making any fix, watching it fail on exactly that assertion,
then adding an `error` callback to both `subscribe()` calls and re-running to
confirm green.

The second problem is the one the exercise specifically asks to check for: a
stale-response race between list and detail. Selecting quote 1 (slow to
respond) and then quote 2 (fast) before quote 1's response lands means quote
1's response arrives *after* quote 2's — and with no guard, whichever
response lands last wins, even though the user is looking at quote 2 by
then. `quotes.spec.ts`'s
`'does not let a slow, stale detail response overwrite a newer selection'`
test reproduces this exactly (flush the fast request first, then the slow
one, assert the detail is still quote 2) and failed against the first draft
for real — `service.detail()?.id` came back `1`. The fix is a
generation-counter guard: `loadDetail`/`loadList` each bump a private
request-id counter on every call, and each response callback checks whether
its own captured id still matches the current one before touching any
signal; a superseded response just returns. `quotes-explorer.spec.ts` proves
the same thing one level up, through the component's `select()` method and
the actual rendered detail pane, not just the service in isolation.

What would break if the contract changed here: if `/api/quotes/{id}`'s 404
ever started returning a JSON error body instead of an empty one, nothing
breaks — the check is on `error.status`, not the body. If it stopped
returning 404 for a missing id and instead returned `200` with a null body,
`detailError` would never be set and `quotes.detail()` would stay falsy —
originally every branch in the `@if`/`@else if` chain in
`quotes-explorer.html` failed to match that case (`selectedId()` isn't null,
not loading, no error, and `detail()` is falsy), so the detail pane rendered
nothing at all, silently. That's a third real gap this verification pass
turned up while writing this note, not a hypothetical one, so it's fixed
rather than just written down: there's now a final `@else` in that chain
rendering a generic error instead of going blank. It's still worth listing
here, because a naked `200` with a null body is exactly the kind of contract
drift that's easy to leave unhandled if nobody deliberately exercises it
against the real endpoint the way the curl check above did.

# Day 14 — Reactive form + accessibility, verification note

`create-quote-form/` replaces the old ad hoc `ngModel` inputs in
`quotes-list.ts` with an actual reactive form (`FormGroup`/`FormControl`)
against the real `POST /api/quotes` contract. The brief I gave myself before
building it: hold `author` and `text` as controls, validate them to the same
limits the API itself enforces (not a guessed number), wire proper labels
and `aria-invalid`/`aria-describedby`, move focus to the first invalid field
on submit, and handle loading/server-error states without inventing a field
the API doesn't have.

Before writing any client validation, I hit the real API directly to find
out what its actual rules are, instead of assuming:

```
POST /api/quotes  { author: "   ", text: "Some real text" }
→ 400 { errors: { author: ["Author is required. (Parameter 'author')"] } }

POST /api/quotes  { author: "A"*201, text: "hi" }
→ 400 { errors: { author: ["Author must be 200 characters or fewer. ..."] } }

POST /api/quotes  (no Authorization header)
→ 401, empty body
```

That's `QuotesApi/Models/Quote.cs`'s `Quote.Create`: `author`/`text` both
required via `string.IsNullOrWhiteSpace`, capped at 200 and 1000 characters
respectively - so `Validators.maxLength(200)`/`Validators.maxLength(1000)`
on the two controls, not a round number picked because it looked reasonable.

## The bug I actually caught

First draft used `Validators.required` for both fields. I wrote the test
suite before checking anything by hand, and one test - typing `"   "` into
the author field and expecting the form to be invalid - failed against that
draft: `Validators.required` only fails on an *exactly* empty string, so
three spaces sail through client-side validation and the form reports
itself as submittable. The real API disagrees, as the curl output above
shows - it uses `IsNullOrWhiteSpace`, which a plain "is it non-empty" check
doesn't reproduce. Fixed it with a small custom validator
(`requiredNonBlank`) that trims before checking, matching the server rule
exactly, then reran the same test to confirm it now fails the way the real
API would. This wasn't a hypothetical either - I ran the exact whitespace
payload against the live API first (see the curl output above) before
writing the validator, so the fix is grounded in what the server actually
does, not in what I assumed it does.

Once that was proven client-side, I still didn't drop the server-response
handling to only "it worked or it didn't" - a genuine 400 `ValidationProblem`
(confirmed live, exact shape above) now maps onto the specific control
(`setErrors({ server: message })`) and refocuses it, rather than a generic
banner the user can't act on. This matters beyond nice-to-have: if the
API's own rules ever drift from what's encoded in the client validators,
a real field-level error still lands on the right field instead of vanishing
into "something went wrong."

## States and edges exercised

- Empty/untouched: no `aria-invalid`, no error text, confirmed by querying
  for `[role="alert"]` and finding nothing.
- Invalid on submit: submitting an empty form marks both controls touched,
  sets `aria-invalid="true"` and `aria-describedby="author-error
  author-hint"` on the author input, and moves focus to it -
  `document.activeElement` is asserted directly, not assumed from reading
  the template.
- Over the real length limit: setting author to 201 characters produces
  the same "too long" state a 200-character API limit would actually
  trigger, and the message reports the real numbers (`201/200`), not a
  static string.
- The whitespace-only bug above.
- Submitting: the button disables and gets `aria-busy="true"` while the
  request is in flight, confirmed while the mocked request is still
  pending, not after it resolves.
- Success: posts exactly `{author, text}` (no extra invented fields),
  resets the form, and emits the created quote for `QuotesList` to react to.
- Server error, unauthenticated: a 401 shows a real "sign in again" message
  and leaves the entered values in place - it doesn't relabel a server
  failure as if the form itself were invalid.
- Server error, field-level 400: mapped onto the specific control as shown
  above, with focus moved to it.

## What breaks if the contract changes

If `Quote.Create`'s limits change (say, `Text` grows to 2000 characters),
the client validator becomes stricter than the server for no reason - users
get blocked on the client for something the API would actually accept. The
two numbers only agree because I checked them against the real model, not
because they're derived from a shared source; a contract change means
`AUTHOR_MAX_LENGTH`/`TEXT_MAX_LENGTH` need a matching edit, and nothing
here would flag that they'd drifted apart. If the 400 error shape ever
changed key casing (e.g. `Author` instead of `author`), `applyServerFieldErrors`
would silently find no matching field and fall through to the generic
"could not create" banner - the request would still fail loudly, just
without pointing at the specific field, which is a worse but not silent
failure.

One honest limitation: this was verified with unit tests asserting real DOM
attributes (`aria-invalid`, `aria-describedby`, `document.activeElement`)
in jsdom, and against the live API via curl for the actual validation
contract - not with a real screen reader or axe run in a browser, since no
browser tool was available this session.
