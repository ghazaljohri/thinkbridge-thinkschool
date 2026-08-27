import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Collections } from './collections';
import { API_BASE_URL } from './api-base-url';
import { errorMappingInterceptor } from './http/error-mapping-interceptor';

describe('Collections', () => {
  let service: Collections;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorMappingInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });

    service = TestBed.inject(Collections);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // --- summaries -----------------------------------------------------------

  it('loads summaries for the real ownerId query param', async () => {
    const loadPromise = service.loadSummaries(1);

    const req = httpMock.expectOne((r) => r.url === 'http://api.test/api/collections');
    expect(req.request.params.get('ownerId')).toBe('1');
    req.flush([{ id: 1, name: 'Favorites', ownerId: 1, itemCount: 2, lastAddedAt: '2026-01-01T00:00:00' }]);
    await loadPromise;

    expect(service.summaries()).toEqual([
      { id: 1, name: 'Favorites', ownerId: 1, itemCount: 2, lastAddedAt: '2026-01-01T00:00:00' },
    ]);
    expect(service.summariesLoading()).toBe(false);
  });

  it('surfaces a mapped AppError message on a summaries load failure', async () => {
    const loadPromise = service.loadSummaries(1);
    httpMock
      .expectOne((r) => r.url === 'http://api.test/api/collections')
      .flush(null, { status: 500, statusText: 'Server Error' });
    await loadPromise;

    expect(service.summariesError()).toBe('Something went wrong on our end. Please try again shortly.');
  });

  // --- create ----------------------------------------------------------------

  it('rejects a too-short name client-side, matching Collection.ValidateName, without ever calling the API', async () => {
    const result = await service.createCollection('ab', 1);

    expect(result).toBeNull();
    expect(service.createError()).toBe('Collection name must be between 3 and 80 characters.');
    httpMock.expectNone(() => true);
  });

  it('creates a collection and appends the new summary to the existing list', async () => {
    const createPromise = service.createCollection('Favorites', 1);

    const req = httpMock.expectOne('http://api.test/api/collections');
    expect(req.request.body).toEqual({ name: 'Favorites', ownerId: 1 });
    req.flush({ id: 1, name: 'Favorites', ownerId: 1, items: [] });

    const result = await createPromise;
    expect(result).toEqual({ id: 1, name: 'Favorites', ownerId: 1, itemCount: 0, lastAddedAt: null });
    expect(service.summaries()).toEqual([
      { id: 1, name: 'Favorites', ownerId: 1, itemCount: 0, lastAddedAt: null },
    ]);
  });

  it('surfaces the real generic 500 message when the API rejects a name for a reason not mirrored client-side', async () => {
    // Confirmed live: the API's own validation failure for an invalid name
    // is indistinguishable from any other failure - a generic 500 with no
    // field-level detail. This is what a name that's long enough to pass
    // the client check but still gets rejected server-side would surface.
    const createPromise = service.createCollection('Valid Length Name', 1);

    httpMock.expectOne('http://api.test/api/collections').flush(
      {
        type: 'https://tools.ietf.org/html/rfc9110#section-15.6.1',
        title: 'An unexpected error occurred.',
        status: 500,
      },
      { status: 500, statusText: 'Server Error' },
    );

    expect(await createPromise).toBeNull();
    expect(service.createError()).toBe('Something went wrong on our end. Please try again shortly.');
  });

  // --- items -----------------------------------------------------------------

  it('rejects adding a quote already in the loaded collection client-side, without calling the API', async () => {
    const loadPromise = service.loadDetail(1);
    httpMock.expectOne('http://api.test/api/collections/1').flush({
      id: 1,
      name: 'Favorites',
      ownerId: 1,
      items: [{ quoteId: 5, author: 'Ada Lovelace', text: 'Q1', addedAt: 'x' }],
    });
    await loadPromise;

    await service.addItem(1, 5);

    expect(service.itemError()).toBe('That quote is already in this collection.');
    httpMock.expectNone(() => true);
  });

  it('rejects adding a 51st quote client-side, matching the real 50-item cap, without calling the API', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      quoteId: i + 1,
      author: 'Author',
      text: `Q${i + 1}`,
      addedAt: 'x',
    }));
    const loadPromise = service.loadDetail(1);
    httpMock
      .expectOne('http://api.test/api/collections/1')
      .flush({ id: 1, name: 'Favorites', ownerId: 1, items });
    await loadPromise;

    await service.addItem(1, 999);

    expect(service.itemError()).toBe("A collection can't hold more than 50 quotes.");
    httpMock.expectNone(() => true);
  });

  it('adds a genuinely new item by calling the real endpoint, then reloads detail', async () => {
    const loadPromise = service.loadDetail(1);
    httpMock
      .expectOne('http://api.test/api/collections/1')
      .flush({ id: 1, name: 'Favorites', ownerId: 1, items: [] });
    await loadPromise;

    const addPromise = service.addItem(1, 5);

    const addReq = httpMock.expectOne(
      (r) => r.url === 'http://api.test/api/collections/1/items' && r.method === 'POST',
    );
    expect(addReq.request.body).toEqual({ quoteId: 5 });
    addReq.flush(null);

    // addItem()'s `await this.loadDetail(...)` continuation - and the GET
    // it dispatches - lands as a microtask after flush() returns, not
    // synchronously within this call stack (same timing as the interceptor
    // retry test from Day 15).
    await new Promise((resolve) => setTimeout(resolve, 0));

    httpMock.expectOne('http://api.test/api/collections/1').flush({
      id: 1,
      name: 'Favorites',
      ownerId: 1,
      items: [{ quoteId: 5, author: 'Ada Lovelace', text: 'Q1', addedAt: 'x' }],
    });
    await addPromise;

    expect(service.detail()?.items).toEqual([
      { quoteId: 5, author: 'Ada Lovelace', text: 'Q1', addedAt: 'x' },
    ]);
    expect(service.itemError()).toBeNull();
    expect(service.mutatingItemId()).toBeNull();
  });

  it('removes an item by calling the real endpoint, then reloads detail', async () => {
    const loadPromise = service.loadDetail(1);
    httpMock.expectOne('http://api.test/api/collections/1').flush({
      id: 1,
      name: 'Favorites',
      ownerId: 1,
      items: [{ quoteId: 5, author: 'Ada Lovelace', text: 'Q1', addedAt: 'x' }],
    });
    await loadPromise;

    const removePromise = service.removeItem(1, 5);

    httpMock
      .expectOne((r) => r.url === 'http://api.test/api/collections/1/items/5' && r.method === 'DELETE')
      .flush(null);

    await new Promise((resolve) => setTimeout(resolve, 0));

    httpMock
      .expectOne('http://api.test/api/collections/1')
      .flush({ id: 1, name: 'Favorites', ownerId: 1, items: [] });
    await removePromise;

    expect(service.detail()?.items).toEqual([]);
  });
});
