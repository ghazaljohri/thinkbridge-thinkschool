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
