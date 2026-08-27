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

# Day 14 — Signal Forms preview, same form rebuilt

`create-quote-form-signal/` rebuilds the exact same form against the exact
same contract (`POST /api/quotes`, `{author, text}`, same 200/1000 limits
read off `Quote.Create`) using `@angular/forms/signals` - Angular's preview
signal-based forms API, shipped in this project's installed `@angular/forms`
22.1.3 - instead of `ReactiveFormsModule`. It's wired in at `/signal-forms`
("Signal Forms" in the nav) alongside the reactive version rather than
replacing it, since the point here is the comparison, not a rewrite. Before
writing a line of it, I read the actual shipped source in
`node_modules/@angular/forms/fesm2022/signals.mjs` and
`_validation_errors-chunk.mjs` for `required()`, `submit()`, and the
`formField` directive - not the guide docs, the code that actually runs -
because a preview API is exactly where "the docs said X" and "the code does
X" are most likely to have drifted.

## States and edges exercised

Same list as the reactive-forms version, run against this rebuild:
pristine/untouched (no `aria-invalid`, nothing with `role="alert"`),
dirty-vs-touched as two independently observable signals, validators firing
(required and the real 200-char `maxLength` boundary), a blocked submit
that touches every field and focuses the first invalid one, a clean submit
that posts exactly `{author, text}` and resets the model, and both
server-error shapes - a 401 banner that leaves the typed values alone, and
a real 400 `ValidationProblem` mapped onto the specific field with focus
moved to it. All of it re-verified against the live API the same way as the
reactive version (see the curl output further up this file - same endpoint,
same 400/401/201 responses either way).

## The bug I caught here too

`required()` has the *exact same* whitespace gap `Validators.required` has
in the reactive-forms version, and I confirmed it by reading
`@angular/forms/signals`' own `isEmpty()`:

```js
function isEmpty(value) {
  if (typeof value === 'number') return isNaN(value);
  return value === '' || value === false || value == null;
}
```

`value === ''` only - no trim. So a first draft using plain `required(path.author)`
lets `"   "` through client-side for the identical reason
`Validators.required` did, and the real API rejects it identically (confirmed
live: `author: "   "` still 400s with the same `errors.author` message).
I proved this the same way as the reactive version: swapped to plain
`required()`, ran the whitespace test, watched it fail
(`quoteForm.author().invalid()` came back `false` for `"   "`), then
replaced it with a custom `validate(path.author, ctx => ctx.value().trim().length === 0 ? requiredError() : undefined)`
on both fields and reran to confirm it passes. Same underlying API contract
mismatch, same fix shape, different forms library - which is itself the
finding: switching form libraries doesn't validate your fields for you: you
still have to know what the API actually requires.

## A second real gap, found by testing rather than assumed

Writing the `dirty` test surfaced something not obvious from the docs:
`field().value` is a plain `WritableSignal`, and the guide text for it
("updating this signal will update the data model") doesn't mention that
calling `.value.set(...)` directly skips dirty-tracking entirely. Reading
`_validation_errors-chunk.mjs`'s `controlValueSignal()` confirmed why:
`markAsDirty()` is only called inside the *wrapped* `controlValue.set()`
that the actual bound `<input>` writes through, not inside `value`'s own
setter. My test originally asserted `field().value.set('Ada')` would mark
the field dirty - it didn't, so the test was wrong, not the library. Fixed
the test to drive the real DOM element (`input.dispatchEvent(new
Event('input'))`) instead, which does mark it dirty, and left the finding
in the test as a comment rather than deleting the evidence that it took a
failing assertion to notice.

## Where Signal Forms is actually simpler

- **Focus management needs no `ElementRef`.** The reactive-forms version
  needed `viewChild<ElementRef>('authorInput')` plus a template ref
  variable just to call `.nativeElement.focus()`. Here,
  `quoteForm.author().focusBoundControl()` does the same thing directly off
  the field state - no template plumbing.
- **Submitting state is built in.** `quoteForm().submitting()` is already a
  signal on the field tree, set around the submit action automatically. The
  reactive-forms version needed its own separate `submitting` signal set and
  cleared by hand around the `try`/`finally`.
- **Server errors merge into `.errors()` for free.** Returning
  `{kind, message, fieldTree}` objects from the submit action lands them in
  that field's `errors()` signal automatically (confirmed in the source:
  `submissionErrors` is concatenated into the same `errors` computation that
  backs validator errors), and it's a `linkedSignal` keyed off the field's
  value, so editing the field clears it automatically too. The reactive
  version does this by hand with `control.setErrors({server: message})` and
  relies on Angular re-running validators on the next edit to drop it.
- **No `ReactiveFormsModule`/`FormsModule` import at all** - just
  `imports: [FormField]`, one directive, for the whole form.

## Where it's still rough

- **No a11y wiring for free, at all.** I checked - there is no `aria-`
  string anywhere in the compiled `@angular/forms/signals` package. Every
  `aria-invalid`/`aria-describedby` binding in the template here is exactly
  as manual as the reactive-forms version's. If I'd assumed the newer API
  handled this because it manages so much else automatically, that
  assumption would have been wrong and the form would have shipped
  inaccessible - this is the "over-claim of parity" the exercise warns
  about, and the honest answer is there's no parity here at all, in either
  direction: reactive forms doesn't give you this either.
- **`submit()`'s boolean return conflates two different failures.** It
  resolves `false` when a field is genuinely invalid, but `true` when the
  action ran and simply returned no *field* errors - which is also what
  happens on a 401, since there's no field to blame for "you're logged
  out." That's not wrong, but it means you can't use the return value alone
  to know "did this succeed," and I had to keep a separate `serverError`
  signal for exactly the same reason the reactive-forms version needed one.
- **The whitespace-validator gap above** - a preview API inheriting the
  exact same rough edge as a stable one.
- **Bundle size, measured, not guessed:** the `/signal-forms` route's lazy
  chunk is 43.76 kB raw (12.12 kB transferred) for one form, versus 8.33 kB
  raw (2.82 kB transferred) for the entire reactive-forms `quotes-list`
  route, which includes a form, a paginated list, and delete. That's from
  `ng build`'s own output, not an estimate.
- **It's still a preview.** The package ships under the stable
  `@angular/forms` version here, but the API surface (`required`,
  `schema`, `submit`, `FormField`) is explicitly marked `@publicApi 22.0`/
  `22.1` in its own type declarations with no deprecation path documented
  yet either way - it's new enough that reading the shipped source instead
  of trusting a blog post's description of it was the only way to get any
  of the above right.

# Day 15 — HttpClient + interceptors, verification note

The order here was deliberate and matches the exercise: pin the real
contract with a characterization test first, green before any interceptor
code exists, then build the interceptors against what that test actually
found - not against what a REST API "usually" looks like.

## The characterization test (`contract/quotes-api.characterization.test.mjs`)

This is plain Node (`node:test` + `fetch`), not an Angular/Vitest spec - it
makes real network calls against a real running `QuotesApi`, deliberately
outside `HttpTestingController`'s mocking, because the whole point is
pinning what the server actually does, not what a mock says it does. Run
with `npm run test:contract` while the API is running. It passed cleanly on
the first real run and again just now as a final check before writing this
note - 4/4, against `GET /api/quotes?page=1&size=5` and the same endpoint
with an invalid page.

What it pinned, all confirmed live, not assumed:

- The real paged shape: `{page, size, total, items}`, each item
  `{id, author, text, isDeleted, createdAtUtc}` - exact field names, exact
  types.
- A 400 from that same GET endpoint (`page=0`) really is a
  `ValidationProblemDetails`: `application/problem+json`,
  `{type, title, status, errors, traceId}`. `errors` includes **every**
  field key, even ones with no problem (`size: []` here) - not just the
  field that actually failed.
- **The finding that mattered most for the interceptor design:** 401
  (unauthenticated DELETE) and 404 (missing quote) both come back with a
  **completely empty body** - `Content-Length: 0`, no JSON at all. Only the
  400 validation path returns a body in this API. An error mapper built on
  the assumption that "a 4xx has a ProblemDetails body" - a completely
  reasonable assumption for a REST API in general - would be wrong for two
  out of three of the 4xx cases this app actually has to handle, and would
  either throw parsing nothing or silently show "undefined" in the UI. This
  is exactly the kind of thing a characterization test is for: it turned a
  plausible-sounding assumption into a checked fact before any code that
  depended on it got written.

## What got built on top of it

- `core/http/app-error.ts` - a typed `AppError` (`status`, `title`,
  `message`, `fieldErrors`) and a pure `toAppError(HttpErrorResponse)`
  mapper. Every fixture in its test file is the literal body captured by
  the characterization test, not invented JSON. 401/403/404 go through a
  fixed per-status fallback message specifically because there's no body to
  read one from; 400 with an `errors` dict gets real field-level messages,
  filtering out the empty-array fields the API always includes.
- `core/http/retry-interceptor.ts` - retries GETs only, only on a transient
  failure (network error or 5xx), with exponential backoff, never on a 4xx.
- `core/http/error-mapping-interceptor.ts` - converts `HttpErrorResponse`
  to `AppError`, but **only for requests that opt in** via an
  `HttpContext` token (`MAP_ERRORS`), not globally.
- Wired together in `app.config.ts` as
  `withInterceptors([errorMappingInterceptor, authInterceptor, retryInterceptor])`,
  and `core/quotes.ts` (`loadList`/`loadDetail`, from Day 13) now opts into
  it and uses `AppError.message` directly instead of its previous
  hand-rolled `error.status === 404 ? ... : ...` check.

## Be ready to defend: the interceptor order

`withInterceptors([errorMappingInterceptor, authInterceptor, retryInterceptor])` -
first in the array is outermost for the request, and by the same token the
**last** to see the response/error on the way back (Angular's interceptors
unwind in reverse). That ordering is load-bearing, not arbitrary:

- `retryInterceptor` has to be **closest to the backend** so it sees the
  *raw* transient failure and can retry before anything else touches it.
- `authInterceptor` sits in the middle so it sees a genuine raw 401 (to
  decide whether to refresh the token) rather than something already
  rewritten into an `AppError`, which wouldn't carry a `.status` property
  `authInterceptor`'s own `instanceof HttpErrorResponse` check depends on.
- `errorMappingInterceptor` is **outermost** so it only converts whatever
  survives both of the above - the final, real failure - not an
  intermediate state mid-retry or mid-refresh.

I didn't just assert this ordering works - `core/http/http-pipeline.spec.ts`
composes all three in this exact order (not each interceptor tested alone)
and proves: the bearer token still gets attached and a 401 still triggers a
refresh-and-retry with error-mapping and retry both present in the chain;
a transient 500 on a GET still gets retried with auth and error-mapping
ahead of it; and a request that opts into `MAP_ERRORS` still gets a real
`AppError` even when it took a failed-refresh detour through `authInterceptor`
first. Getting this order backwards is exactly the kind of thing that looks
fine in each interceptor's own isolated unit tests and only breaks when
they're actually composed - which is why that file exists.

## Be ready to defend: why error-mapping is opt-in, not global

The obvious simpler design is to make `errorMappingInterceptor` unconditional
so every request gets an `AppError`. I didn't do that, on purpose: this app
already has three real, shipped, tested call sites from Day 13/14
(`auth-interceptor.ts`, `auth.ts`, `create-quote-form.ts`) that catch errors
with `error instanceof HttpErrorResponse` and read `.status` off them
directly. Making error-mapping global would silently change what type every
one of those `catch` blocks receives, breaking working, reviewed code for a
Day 15 change that has no reason to touch it. The `HttpContext`-token opt-in
(`MAP_ERRORS`) means new code (`core/quotes.ts`'s `loadList`/`loadDetail`)
can use `AppError` deliberately while nothing else changes behavior.

## Verification: RxJS's own contract for `retry()`'s delay function

The one place I checked documentation before writing code, specifically
because getting it wrong would fail silently: `retry({count, delay})`'s
`delay` callback needs to *return an errored Observable* to stop retrying
and propagate that error - not throw synchronously. `retry.d.ts`'s own
comment says so directly: "If the notifier completes without emitting, the
resulting observable will complete without error; if the notifier errors,
the error will be pushed to the result." A synchronous throw isn't
mentioned as part of that contract at all. Returning `EMPTY` instead of
`throwError(() => error)` for a non-transient error would have made a 4xx
on a GET **complete silently with no error and no value** instead of
failing - the kind of bug that wouldn't show up in a quick manual check,
only in a test that actually asserts what the rejected promise contains,
which is what `retry-interceptor.spec.ts`'s "does not retry a 4xx" test
does.

## States and edges exercised

Transient-failure retry-then-succeed, transient failure exhausting all
retries and rethrowing the real error, a 4xx never retried at all, a
non-GET never retried even on a 500 (POST/DELETE aren't idempotent - a
duplicate quote from a retried create would be a worse bug than a failed
one), the opt-in boundary itself (same 404, mapped for one request and left
as a plain `HttpErrorResponse` for another), and the full composed chain
under both a successful-refresh and a failed-refresh 401.

## What breaks if the contract changes

If a future endpoint starts returning a real ProblemDetails body on 401/403/404
instead of an empty one, nothing breaks - `toAppError` already has a generic
ProblemDetails fallback for exactly that shape, it just wouldn't be reached
today since the fallback map catches those statuses first. If the
`errors` dict's key casing changed (e.g. `Page` instead of `page`), field
errors would stop attaching to specific controls in the create-quote form
and the generic `body.title` message would show instead - a real regression,
not a crash, and one the characterization test would catch on its next run
since it asserts the literal message text, not just the presence of a body.
If `GET /api/quotes` ever became non-idempotent (it can't, but hypothetically
paired with a side effect), the retry interceptor would need to move past a
blanket `req.method === 'GET'` check - today that's a safe assumption
because it's true of this API, not because GET is inherently always safe to
retry everywhere.

# Day 16 — Routing, lazy loading, guards, verification note

`features/quotes/quote-detail/` is a real routed page - `/quotes/:id` -
against `GET /api/quotes/{id:int}`, the same endpoint `core/quotes.ts`
already talked to from the non-routed `QuotesExplorer` master-detail view
(Day 13). The brief: lazy-loaded, guarded by the existing `authGuard`, the
route param bound to the real `id` field the API returns, and a View
Transition between the quotes list and this detail page - not four separate
half-built things, one path through the app that uses all four.

## What's real here, checked, not asserted

- **Lazy-loaded.** `ng build`'s own output is the proof, not a claim:
  `quote-detail` shows up as its own chunk (1.54 kB / 768 bytes transferred),
  separate from `main` and from `quotes-list`. If it weren't code-split, it
  would be sitting inside `main.js` and there would be no separate chunk to
  point at.
- **The guard actually redirects an unauthenticated deep link.** Not by
  re-testing `authGuard` in isolation again (already covered from Day 13) -
  `app-routing.spec.ts` drives the *actual* `routes` array from
  `app.routes.ts` through `RouterTestingHarness.create('/quotes/5')` with no
  session in `localStorage`, and asserts `router.url === '/login'` plus that
  no HTTP request to the detail endpoint was ever made. `/quotes/:id` has no
  `canActivate` of its own - it inherits the parent `Shell` route's guard,
  and this test is what actually confirms Angular re-evaluates that parent
  guard for a direct deep link into a nested child, not just for the parent
  path itself, rather than taking that on faith.
- **The real route param, bound the modern way.** `withComponentInputBinding()`
  in `app.config.ts` binds `:id` straight to `QuoteDetail`'s `id` input
  signal - no `ActivatedRoute.paramMap` subscription. `quote-detail.spec.ts`
  sets that input directly and asserts the resulting request goes to
  `/api/quotes/5`, i.e. the exact real field name and endpoint shape, not a
  mock of some generic "detail" concept.
- **A View Transition, not just the router feature flag flipped on.**
  `withViewTransitions()` wraps navigation in `document.startViewTransition()`
  (a no-op where unsupported). The quote card in `quotes-list.html` and the
  card in `quote-detail.html` share the same `view-transition-name`
  (`'quote-' + id`) - the same element identity across both routes, so the
  browser morphs the clicked card into the detail view instead of a hard
  cut or a generic page-level crossfade. No browser tool was available this
  session to watch the transition itself animate, which is a real
  limitation worth stating plainly rather than claiming a visual check that
  didn't happen - what's actually verified is the DOM wiring that makes it
  possible (matching names, real route activation) and that the app boots
  and serves the deep link correctly under `ng serve`.

## The bug I caught reviewing this before calling it done

The first version of `quote-detail.html` had three states -
`detailLoading()`, `detailError()`, `detail()` - as an `@if`/`@else if`
chain with no final `@else`. That's the *exact* shape of bug fixed on
Day 13 in a different component (a 200-with-null-body falling through every
branch and rendering nothing), and I still nearly repeated it here: a
non-numeric `:id` in the URL (`/quotes/not-a-number`) means `Number.isInteger`
never passes, `loadDetail()` is never called, and none of the three
branches match - a blank page under the back link, no error, no
explanation. Caught it while reading my own diff before writing the test,
not after a failure, and added a final `@else` plus a
`quote-detail.spec.ts` test that types a garbage id and asserts the actual
message renders instead of nothing. Worth logging as the concrete catch
because it's the second time this exact class of bug showed up in this
codebase - which says the lesson is "always write the terminal `@else`
before considering a state chain done," not "this one component had a bug."

Two smaller ones caught by just running the suite, not by inspection:
`quotes-list.spec.ts` broke the moment `RouterLink` was added to that
component's imports, because its test module never provided `provideRouter([])` -
a real, mechanical consequence of adding routing to a component whose test
predates routing being wired up anywhere in the app. And the first
`app-routing.spec.ts` draft tried to assert
`harness.routeDebugElement?.componentInstance instanceof QuoteDetail` -
wrong, because that debug element belongs to `Shell` (the outer routed
component under the harness's synthetic root), not the nested child inside
Shell's own `<router-outlet>`. Fixed by asserting on the resolved URL and
the presence of `app-quote-detail` in the rendered DOM plus the actual
dispatched request instead of guessing at the debug-element tree's shape.

## What breaks if the contract changes

If `GET /api/quotes/{id:int}` ever became a `string` id instead of an
`int` (a GUID, say), `Number.isInteger(Number(this.id()))` would reject
every real id and the page would show "That's not a valid quote id." for
every quote - a loud, visible failure, not a silent one, but a real
behavior change nonetheless since the current guard assumes numeric ids
specifically because that's what `{id:int}` in the real route constraint
promises today. If the detail endpoint were ever nested under a different
path (`/api/quotes/{id}/full`, say), only `core/quotes.ts`'s `loadDetail()`
needs to change - `QuoteDetail` itself doesn't know the URL shape, only the
service does, which is exactly the point of keeping that URL construction
in one place rather than duplicating it per consumer.
