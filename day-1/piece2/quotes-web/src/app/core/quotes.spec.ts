import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Quotes } from './quotes';
import { API_BASE_URL } from './api-base-url';
import { errorMappingInterceptor } from './http/error-mapping-interceptor';

describe('Quotes', () => {
  let service: Quotes;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        // Quotes opts its GETs into MAP_ERRORS, so the interceptor needs to
        // actually be registered here for `error` in its subscribe() calls
        // to really be an AppError, the same as it is wired in app.config.ts.
        provideHttpClient(withInterceptors([errorMappingInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });

    service = TestBed.inject(Quotes);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loads the list into signals', () => {
    service.loadList(1, 20);
    httpMock
      .expectOne('http://api.test/api/quotes?page=1&size=20')
      .flush({ page: 1, size: 20, total: 1, items: [{ id: 1, author: 'Ada', text: 'Q1' }] });

    expect(service.list()).toEqual([{ id: 1, author: 'Ada', text: 'Q1' }]);
    expect(service.listLoading()).toBe(false);
  });

  it('surfaces a list load failure instead of leaving listLoading stuck true', () => {
    service.loadList(1, 20);
    httpMock
      .expectOne((r) => r.url === 'http://api.test/api/quotes')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(service.listLoading()).toBe(false);
    expect(service.listError()).toBe('Something went wrong on our end. Please try again shortly.');
  });

  it('surfaces the real ValidationProblemDetails 400 on a bad page/size, not a generic message', () => {
    // The exact shape confirmed live against the real endpoint in
    // contract/quotes-api.characterization.test.mjs.
    service.loadList(0, 20);
    httpMock.expectOne((r) => r.url === 'http://api.test/api/quotes').flush(
      {
        type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { page: ['Page must be at least 1.'], size: [] },
        traceId: '00-abc',
      },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(service.listError()).toBe('Please fix the highlighted fields.');
  });

  it('surfaces a 404 on detail via the fallback AppError message, not a stuck spinner', () => {
    // Confirmed live: GET /api/quotes/{id} for a missing id returns 404
    // with an EMPTY body, so this has to come from the status-code
    // fallback, not from reading a body that isn't there.
    service.loadDetail(999);
    httpMock
      .expectOne('http://api.test/api/quotes/999')
      .flush(null, { status: 404, statusText: 'Not Found' });

    expect(service.detailLoading()).toBe(false);
    expect(service.detailError()).toBe('That could not be found.');
  });

  it('does not let a slow, stale detail response overwrite a newer selection', () => {
    // Select quote 1 first (slow) ...
    service.loadDetail(1);
    const slowReq = httpMock.expectOne('http://api.test/api/quotes/1');

    // ... then quote 2, before quote 1's response has arrived.
    service.loadDetail(2);
    const fastReq = httpMock.expectOne('http://api.test/api/quotes/2');

    // Quote 2's response lands first, as it would for a smaller/faster row.
    fastReq.flush({ id: 2, author: 'Grace Hopper', text: 'Q2', isDeleted: false, createdAtUtc: 'x' });
    expect(service.detail()?.id).toBe(2);

    // Quote 1's slow response finally lands - it must be ignored, not
    // clobber the quote 2 the user is now actually looking at.
    slowReq.flush({ id: 1, author: 'Ada Lovelace', text: 'Q1', isDeleted: false, createdAtUtc: 'x' });
    expect(service.detail()?.id).toBe(2);
    expect(service.detailLoading()).toBe(false);
  });
});
