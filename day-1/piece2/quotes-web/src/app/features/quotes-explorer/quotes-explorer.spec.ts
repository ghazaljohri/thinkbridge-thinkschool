import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { QuotesExplorer } from './quotes-explorer';
import { API_BASE_URL } from '../../core/api-base-url';
import { errorMappingInterceptor } from '../../core/http/error-mapping-interceptor';

describe('QuotesExplorer', () => {
  let fixture: ComponentFixture<QuotesExplorer>;
  let component: QuotesExplorer;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [QuotesExplorer],
      providers: [
        provideHttpClient(withInterceptors([errorMappingInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(QuotesExplorer);
    component = fixture.componentInstance;
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushList(items: { id: number; author: string; text: string }[]) {
    httpMock
      .expectOne((req) => req.url === 'http://api.test/api/quotes')
      .flush({ page: 1, size: 20, total: items.length, items });
  }

  it('loads the list on creation and shows the empty state with none', async () => {
    flushList([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No quotes yet.');
  });

  it('shows a prompt until a quote is selected, then loads and renders its detail', async () => {
    flushList([{ id: 1, author: 'Ada Lovelace', text: 'Q1' }]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Select a quote to see its detail.',
    );

    component.select(1);
    fixture.detectChanges();

    httpMock
      .expectOne('http://api.test/api/quotes/1')
      .flush({ id: 1, author: 'Ada Lovelace', text: 'Q1', isDeleted: false, createdAtUtc: '2026-01-01' });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('Q1');
  });

  it('keeps the newer selection when an earlier detail request resolves late', async () => {
    flushList([
      { id: 1, author: 'Ada Lovelace', text: 'Q1' },
      { id: 2, author: 'Grace Hopper', text: 'Q2' },
    ]);
    await fixture.whenStable();
    fixture.detectChanges();

    component.select(1);
    fixture.detectChanges();
    const slow = httpMock.expectOne('http://api.test/api/quotes/1');

    component.select(2);
    fixture.detectChanges();
    const fast = httpMock.expectOne('http://api.test/api/quotes/2');

    fast.flush({ id: 2, author: 'Grace Hopper', text: 'Q2', isDeleted: false, createdAtUtc: 'x' });
    await fixture.whenStable();
    fixture.detectChanges();

    function detailText(): string {
      return (
        (fixture.nativeElement as HTMLElement).querySelector('.explorer-detail')?.textContent ?? ''
      );
    }

    expect(detailText()).toContain('Grace Hopper');

    // The stale request for quote 1 - selected first, but slower to
    // respond - lands last. It must not clobber the detail pane, which
    // is showing quote 2 because that's what the user actually selected.
    slow.flush({ id: 1, author: 'Ada Lovelace', text: 'Q1', isDeleted: false, createdAtUtc: 'x' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(detailText()).toContain('Grace Hopper');
    expect(detailText()).not.toContain('Ada Lovelace');
  });

  it('shows a friendly message, not a raw error, when a selected quote 404s', async () => {
    flushList([{ id: 1, author: 'Ada Lovelace', text: 'Q1' }]);
    await fixture.whenStable();
    fixture.detectChanges();

    component.select(1);
    fixture.detectChanges();

    // Confirmed live: a missing quote returns 404 with an EMPTY body - no
    // JSON to read a message off, which is exactly why the app error
    // mapper's per-status fallback text matters here.
    httpMock
      .expectOne('http://api.test/api/quotes/1')
      .flush(null, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();

    const detailText =
      (fixture.nativeElement as HTMLElement).querySelector('.explorer-detail')?.textContent ?? '';
    expect(detailText).toContain('That could not be found.');
  });
});
