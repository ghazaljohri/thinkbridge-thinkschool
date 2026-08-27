import { Component, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Quotes } from '../../../core/quotes';

// The real route param, bound straight to this input by
// withComponentInputBinding() (see app.config.ts) - no manual
// ActivatedRoute.paramMap subscription needed. It's the id GET
// /api/quotes/{id:int} actually takes, and route params always arrive as
// strings regardless of the underlying type.
@Component({
  selector: 'app-quote-detail',
  imports: [RouterLink],
  templateUrl: './quote-detail.html',
  styleUrl: './quote-detail.css',
})
export class QuoteDetail {
  protected readonly quotes = inject(Quotes);

  readonly id = input.required<string>();

  constructor() {
    // Quotes.loadDetail() already guards against stale responses via its
    // own request-id counter (see core/quotes.ts, Day 13), so navigating
    // directly from one quote's URL to another's - which reuses this same
    // component instance rather than recreating it - is race-safe for free.
    effect(() => {
      const parsedId = Number(this.id());
      if (Number.isInteger(parsedId)) {
        this.quotes.loadDetail(parsedId);
      }
    });
  }
}
