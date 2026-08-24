import { Service, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { API_BASE_URL } from './api-base-url';
import type { PagedResult } from '../models/paged-result';
import type { Quote } from '../models/quote';

@Service()
export class Quotes {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private readonly _list = signal<Quote[]>([]);
  private readonly _listLoading = signal(false);
  private readonly _listError = signal<string | null>(null);

  private readonly _detail = signal<Quote | null>(null);
  private readonly _detailLoading = signal(false);
  private readonly _detailError = signal<string | null>(null);

  readonly list = this._list.asReadonly();
  readonly listLoading = this._listLoading.asReadonly();
  readonly listError = this._listError.asReadonly();

  readonly detail = this._detail.asReadonly();
  readonly detailLoading = this._detailLoading.asReadonly();
  readonly detailError = this._detailError.asReadonly();

  // Bumped on every call so a response from an earlier, superseded call can
  // recognize itself as stale and drop itself instead of overwriting a
  // newer selection - list and detail track this independently since a
  // second loadList() and a loadDetail() can be in flight at the same time.
  private listRequestId = 0;
  private detailRequestId = 0;

  loadList(page = 1, size = 20): void {
    const requestId = ++this.listRequestId;
    this._listLoading.set(true);
    this._listError.set(null);

    this.http
      .get<PagedResult<Quote>>(`${this.baseUrl}/api/quotes`, { params: { page, size } })
      .subscribe({
        next: (result) => {
          if (requestId !== this.listRequestId) return;
          this._list.set(result.items);
          this._listLoading.set(false);
        },
        error: () => {
          if (requestId !== this.listRequestId) return;
          this._listError.set('Could not load the quotes list.');
          this._listLoading.set(false);
        },
      });
  }

  loadDetail(id: number): void {
    const requestId = ++this.detailRequestId;
    this._detail.set(null);
    this._detailLoading.set(true);
    this._detailError.set(null);

    this.http.get<Quote>(`${this.baseUrl}/api/quotes/${id}`).subscribe({
      next: (quote) => {
        if (requestId !== this.detailRequestId) return;
        this._detail.set(quote);
        this._detailLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        if (requestId !== this.detailRequestId) return;
        this._detailError.set(
          error.status === 404 ? 'That quote no longer exists.' : 'Could not load that quote.',
        );
        this._detailLoading.set(false);
      },
    });
  }
}
