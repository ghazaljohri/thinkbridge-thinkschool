import { Component, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../../core/api-base-url';
import { Auth } from '../../../core/auth';
import type { PagedResult } from '../../../models/paged-result';
import type { Quote } from '../../../models/quote';

@Component({
  selector: 'app-quotes-list',
  imports: [FormsModule],
  templateUrl: './quotes-list.html',
  styleUrl: './quotes-list.css',
})
export class QuotesList {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  protected readonly auth = inject(Auth);

  readonly page = signal(1);
  readonly pageSize = signal(5);

  // Re-fetches whenever page/pageSize change - no manual subscription
  // management, no OnInit/ngOnChanges wiring.
  readonly quotesResource = httpResource<PagedResult<Quote>>(() => ({
    url: `${this.baseUrl}/api/quotes`,
    params: { page: this.page(), size: this.pageSize() },
  }));

  readonly totalPages = computed(() => {
    const result = this.quotesResource.value();
    return result ? Math.max(1, Math.ceil(result.total / result.size)) : 1;
  });

  // Derived from page() and pageSize() alone - no need to wait on the
  // resource's response to know what range of rows we asked the API for.
  readonly rangeLabel = computed(() => {
    const start = (this.page() - 1) * this.pageSize() + 1;
    const end = this.page() * this.pageSize();
    return `${start}–${end}`;
  });

  readonly newAuthor = signal('');
  readonly newText = signal('');
  readonly isCreating = signal(false);
  readonly formError = signal<string | null>(null);

  readonly pendingDeleteId = signal<number | null>(null);
  readonly deleteError = signal<string | null>(null);

  goToPage(target: number): void {
    if (target < 1 || target > this.totalPages()) return;
    this.page.set(target);
  }

  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
  }

  async createQuote(): Promise<void> {
    this.formError.set(null);

    if (!this.newAuthor().trim() || !this.newText().trim()) {
      this.formError.set('Author and text are both required.');
      return;
    }

    this.isCreating.set(true);

    try {
      await firstValueFrom(
        this.http.post(`${this.baseUrl}/api/quotes`, {
          author: this.newAuthor(),
          text: this.newText(),
        }),
      );

      this.newAuthor.set('');
      this.newText.set('');
      this.page.set(1);
      this.quotesResource.reload();
    } catch (error) {
      this.formError.set(
        error instanceof HttpErrorResponse && error.status === 401
          ? 'You need to sign in again to add a quote.'
          : 'Could not create that quote.',
      );
    } finally {
      this.isCreating.set(false);
    }
  }

  // can-delete-own-quote only succeeds when the caller's email matches the
  // quote's author, so this fails for most quotes here on purpose - it's
  // the edge case worth exercising, not a bug.
  async deleteQuote(quote: Quote): Promise<void> {
    this.deleteError.set(null);
    this.pendingDeleteId.set(quote.id);

    try {
      await firstValueFrom(this.http.delete(`${this.baseUrl}/api/quotes/${quote.id}`));
      this.quotesResource.reload();
    } catch (error) {
      this.deleteError.set(
        error instanceof HttpErrorResponse && error.status === 403
          ? `Only ${quote.author} can delete this quote.`
          : 'Could not delete that quote.',
      );
    } finally {
      this.pendingDeleteId.set(null);
    }
  }
}
