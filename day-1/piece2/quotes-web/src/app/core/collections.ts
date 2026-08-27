import { Service, inject, signal } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from './api-base-url';
import { MAP_ERRORS, type AppError } from './http/app-error';
import type { CollectionDetail, CollectionSummary } from '../models/collection';

const MAPPED = new HttpContext().set(MAP_ERRORS, true);

// Mirrors QuotesApi/Models/Collections/Collection.cs's own ValidateName and
// AddItem invariants exactly - see createCollection()/addItem() below for
// why these are checked here instead of just trusting the API's error
// response.
const NAME_MIN_LENGTH = 3;
const NAME_MAX_LENGTH = 80;
const MAX_ITEMS = 50;

@Service()
export class Collections {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private readonly _summaries = signal<CollectionSummary[]>([]);
  private readonly _summariesLoading = signal(false);
  private readonly _summariesError = signal<string | null>(null);

  private readonly _detail = signal<CollectionDetail | null>(null);
  private readonly _detailLoading = signal(false);
  private readonly _detailError = signal<string | null>(null);

  private readonly _creating = signal(false);
  private readonly _createError = signal<string | null>(null);

  private readonly _mutatingItemId = signal<number | null>(null);
  private readonly _itemError = signal<string | null>(null);

  readonly summaries = this._summaries.asReadonly();
  readonly summariesLoading = this._summariesLoading.asReadonly();
  readonly summariesError = this._summariesError.asReadonly();

  readonly detail = this._detail.asReadonly();
  readonly detailLoading = this._detailLoading.asReadonly();
  readonly detailError = this._detailError.asReadonly();

  readonly creating = this._creating.asReadonly();
  readonly createError = this._createError.asReadonly();

  readonly mutatingItemId = this._mutatingItemId.asReadonly();
  readonly itemError = this._itemError.asReadonly();

  // Same stale-response guard as core/quotes.ts (Day 13) - independent
  // per concern, since a summaries reload and a detail reload can be in
  // flight at once.
  private summariesRequestId = 0;
  private detailRequestId = 0;

  async loadSummaries(ownerId: number): Promise<void> {
    const requestId = ++this.summariesRequestId;
    this._summariesLoading.set(true);
    this._summariesError.set(null);

    try {
      const summaries = await firstValueFrom(
        this.http.get<CollectionSummary[]>(`${this.baseUrl}/api/collections`, {
          params: { ownerId },
          context: MAPPED,
        }),
      );
      if (requestId !== this.summariesRequestId) return;
      this._summaries.set(summaries);
    } catch (error) {
      if (requestId !== this.summariesRequestId) return;
      this._summariesError.set((error as AppError).message);
    } finally {
      if (requestId === this.summariesRequestId) this._summariesLoading.set(false);
    }
  }

  async loadDetail(id: number): Promise<void> {
    const requestId = ++this.detailRequestId;
    this._detail.set(null);
    this._detailLoading.set(true);
    this._detailError.set(null);

    try {
      const detail = await firstValueFrom(
        this.http.get<CollectionDetail>(`${this.baseUrl}/api/collections/${id}`, {
          context: MAPPED,
        }),
      );
      if (requestId !== this.detailRequestId) return;
      this._detail.set(detail);
    } catch (error) {
      if (requestId !== this.detailRequestId) return;
      this._detailError.set((error as AppError).message);
    } finally {
      if (requestId === this.detailRequestId) this._detailLoading.set(false);
    }
  }

  // Checked client-side because the API can't tell this apart from any
  // other failure in its response: confirmed live, POST /api/collections
  // with an invalid name (e.g. too short) returns a generic 500
  // "An unexpected error occurred." - Collection's constructor throws a
  // plain ArgumentException that nothing in CollectionEndpointExtensions
  // catches, unlike QuoteEndpointExtensions' POST /api/quotes. Catching it
  // here means a real, specific message instead of "something went wrong."
  async createCollection(name: string, ownerId: number): Promise<CollectionSummary | null> {
    this._createError.set(null);
    const trimmed = name.trim();

    if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
      this._createError.set(
        `Collection name must be between ${NAME_MIN_LENGTH} and ${NAME_MAX_LENGTH} characters.`,
      );
      return null;
    }

    this._creating.set(true);

    try {
      const created = await firstValueFrom(
        this.http.post<CollectionDetail>(
          `${this.baseUrl}/api/collections`,
          { name: trimmed, ownerId },
          { context: MAPPED },
        ),
      );

      const summary: CollectionSummary = {
        id: created.id,
        name: created.name,
        ownerId: created.ownerId,
        itemCount: created.items.length,
        lastAddedAt: null,
      };
      this._summaries.update((current) => [...current, summary]);
      return summary;
    } catch (error) {
      this._createError.set((error as AppError).message);
      return null;
    } finally {
      this._creating.set(false);
    }
  }

  // Same reasoning as createCollection() above: Collection.AddItem's own
  // duplicate-item and 50-item-cap checks throw a plain
  // InvalidOperationException that also isn't caught anywhere in
  // CollectionEndpointExtensions - confirmed live, both cases 500 with the
  // identical generic ProblemDetails body a real server bug would produce.
  // There is no way to tell them apart from the HTTP response alone, so
  // the same two rules are mirrored here and checked before ever calling
  // the API, against the detail already loaded for this exact collection.
  async addItem(collectionId: number, quoteId: number): Promise<void> {
    this._itemError.set(null);
    const current = this._detail();

    if (current?.id === collectionId) {
      if (current.items.some((item) => item.quoteId === quoteId)) {
        this._itemError.set('That quote is already in this collection.');
        return;
      }
      if (current.items.length >= MAX_ITEMS) {
        this._itemError.set(`A collection can't hold more than ${MAX_ITEMS} quotes.`);
        return;
      }
    }

    this._mutatingItemId.set(quoteId);

    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/api/collections/${collectionId}/items`,
          { quoteId },
          { context: MAPPED },
        ),
      );
      await this.loadDetail(collectionId);
    } catch (error) {
      this._itemError.set((error as AppError).message);
    } finally {
      this._mutatingItemId.set(null);
    }
  }

  async removeItem(collectionId: number, quoteId: number): Promise<void> {
    this._itemError.set(null);
    this._mutatingItemId.set(quoteId);

    try {
      await firstValueFrom(
        this.http.delete(`${this.baseUrl}/api/collections/${collectionId}/items/${quoteId}`, {
          context: MAPPED,
        }),
      );
      await this.loadDetail(collectionId);
    } catch (error) {
      this._itemError.set((error as AppError).message);
    } finally {
      this._mutatingItemId.set(null);
    }
  }
}
