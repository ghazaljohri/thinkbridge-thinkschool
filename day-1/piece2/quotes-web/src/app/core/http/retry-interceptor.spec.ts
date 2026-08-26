import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { retryInterceptor } from './retry-interceptor';

describe('retryInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([retryInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('retries a GET on a transient 500, then resolves once it succeeds', async () => {
    const resultPromise = firstValueFrom(http.get('/api/quotes'));

    httpMock.expectOne('/api/quotes').flush(null, { status: 500, statusText: 'Server Error' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    httpMock.expectOne('/api/quotes').flush({ ok: true });

    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it('gives up after the max retries and rethrows the last transient error', async () => {
    const resultPromise = firstValueFrom(http.get('/api/quotes')).catch((error) => error);

    httpMock.expectOne('/api/quotes').flush(null, { status: 500, statusText: 'Server Error' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    httpMock.expectOne('/api/quotes').flush(null, { status: 500, statusText: 'Server Error' });
    await new Promise((resolve) => setTimeout(resolve, 600));

    httpMock.expectOne('/api/quotes').flush(null, { status: 500, statusText: 'Server Error' });

    const error = await resultPromise;
    expect(error.status).toBe(500);
  });

  it('does not retry a 4xx - a client error fails on the first attempt', async () => {
    const resultPromise = firstValueFrom(http.get('/api/quotes')).catch((error) => error);

    httpMock.expectOne('/api/quotes').flush(null, { status: 404, statusText: 'Not Found' });

    const error = await resultPromise;
    expect(error.status).toBe(404);
    httpMock.expectNone(() => true);
  });

  it('never retries a non-GET request, even on a 500', async () => {
    const resultPromise = firstValueFrom(http.post('/api/quotes', {})).catch((error) => error);

    httpMock.expectOne('/api/quotes').flush(null, { status: 500, statusText: 'Server Error' });

    const error = await resultPromise;
    expect(error.status).toBe(500);
    httpMock.expectNone(() => true);
  });
});
