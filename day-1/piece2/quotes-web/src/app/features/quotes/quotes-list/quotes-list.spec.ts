import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { QuotesList } from './quotes-list';
import { API_BASE_URL } from '../../../core/api-base-url';

describe('QuotesList', () => {
  let component: QuotesList;
  let fixture: ComponentFixture<QuotesList>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuotesList],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(QuotesList);
    component = fixture.componentInstance;
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushList(
    items: { id: number; author: string; text: string }[],
    total = items.length,
  ) {
    httpMock
      .expectOne((req) => req.url === 'http://api.test/api/quotes')
      .flush({ page: component.page(), size: component.pageSize(), total, items });
  }

  it('should create', async () => {
    flushList([]);
    await fixture.whenStable();
    expect(component).toBeTruthy();
  });

  it('requests the first page on load and exposes it through the resource', async () => {
    flushList([{ id: 1, author: 'Ada Lovelace', text: 'First quote' }]);
    await fixture.whenStable();

    expect(component.quotesResource.value()?.items).toEqual([
      { id: 1, author: 'Ada Lovelace', text: 'First quote' },
    ]);
    expect(component.totalPages()).toBe(1);
  });

  it('re-requests when the page signal changes', async () => {
    flushList([{ id: 1, author: 'Ada Lovelace', text: 'First quote' }], 12);
    await fixture.whenStable();
    expect(component.totalPages()).toBe(3);

    component.goToPage(2);
    fixture.detectChanges();

    const req = httpMock.expectOne(
      (r) => r.url === 'http://api.test/api/quotes' && r.params.get('page') === '2',
    );
    req.flush({ page: 2, size: 5, total: 12, items: [{ id: 2, author: 'Grace Hopper', text: 'Second' }] });
    await fixture.whenStable();

    expect(component.page()).toBe(2);
  });

  it('does not page past the last page or before the first', async () => {
    flushList([{ id: 1, author: 'Ada Lovelace', text: 'First quote' }], 5);
    await fixture.whenStable();
    expect(component.totalPages()).toBe(1);

    component.goToPage(0);
    component.goToPage(2);

    expect(component.page()).toBe(1);
  });

  it('rejects an empty create form without calling the API', async () => {
    flushList([]);
    await fixture.whenStable();

    await component.createQuote();

    expect(component.formError()).toBe('Author and text are both required.');
    httpMock.expectNone((req) => req.method === 'POST');
  });

  it('creates a quote, resets the form, and reloads the list', async () => {
    flushList([]);
    await fixture.whenStable();

    component.newAuthor.set('Ada Lovelace');
    component.newText.set('A new quote');
    const createPromise = component.createQuote();

    const postReq = httpMock.expectOne(
      (r) => r.url === 'http://api.test/api/quotes' && r.method === 'POST',
    );
    expect(postReq.request.body).toEqual({ author: 'Ada Lovelace', text: 'A new quote' });
    postReq.flush({ id: 2, author: 'Ada Lovelace', text: 'A new quote' });
    await createPromise;
    fixture.detectChanges();

    expect(component.newAuthor()).toBe('');
    expect(component.newText()).toBe('');

    flushList([{ id: 2, author: 'Ada Lovelace', text: 'A new quote' }]);
    await fixture.whenStable();

    expect(component.formError()).toBeNull();
  });

  it('surfaces a 403 as an ownership error without touching the list', async () => {
    flushList([{ id: 1, author: 'Ada Lovelace', text: 'First quote' }]);
    await fixture.whenStable();

    const quote = component.quotesResource.value()!.items[0];
    const deletePromise = component.deleteQuote(quote);

    httpMock
      .expectOne((r) => r.url === 'http://api.test/api/quotes/1' && r.method === 'DELETE')
      .flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
    await deletePromise;

    expect(component.deleteError()).toBe('Only Ada Lovelace can delete this quote.');
    expect(component.pendingDeleteId()).toBeNull();
  });

  it('reloads the list after a successful delete', async () => {
    flushList([{ id: 1, author: 'Ada Lovelace', text: 'First quote' }]);
    await fixture.whenStable();

    const quote = component.quotesResource.value()!.items[0];
    const deletePromise = component.deleteQuote(quote);

    httpMock
      .expectOne((r) => r.url === 'http://api.test/api/quotes/1' && r.method === 'DELETE')
      .flush(null);
    await deletePromise;
    fixture.detectChanges();

    flushList([]);
    await fixture.whenStable();

    expect(component.deleteError()).toBeNull();
    expect(component.quotesResource.value()?.items).toEqual([]);
  });
});
