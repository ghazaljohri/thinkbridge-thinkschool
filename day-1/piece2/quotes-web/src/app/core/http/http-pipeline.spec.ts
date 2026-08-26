import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from '../auth-interceptor';
import { Auth } from '../auth';
import { API_BASE_URL } from '../api-base-url';
import { errorMappingInterceptor } from './error-mapping-interceptor';
import { retryInterceptor } from './retry-interceptor';
import { MAP_ERRORS } from './app-error';

// Composes all three interceptors in the exact order app.config.ts uses,
// instead of only testing each in isolation - ordering bugs (an interceptor
// seeing an already-transformed error instead of the raw one) don't show up
// in an isolated test of a single interceptor.
describe('the composed HTTP pipeline (errorMapping, auth, retry - app.config.ts order)', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: Auth;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorMappingInterceptor, authInterceptor, retryInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
  });

  afterEach(() => httpMock.verify());

  it('still attaches the bearer token and refreshes on 401 with error-mapping and retry both in the chain', async () => {
    const firstToken = `header.${btoa(JSON.stringify({ email: 'test@example.com' }))}.signature`;
    const loginPromise = auth.login('test@example.com', 'Password123!');
    httpMock
      .expectOne('http://api.test/api/auth/login')
      .flush({ access_token: firstToken, refresh_token: 'r1', expires_in: 1800 });
    await loginPromise;

    const resultPromise = firstValueFrom(http.get('http://api.test/api/quotes'));

    const firstAttempt = httpMock.expectOne('http://api.test/api/quotes');
    expect(firstAttempt.request.headers.get('Authorization')).toBe(`Bearer ${firstToken}`);
    firstAttempt.flush({ message: 'expired' }, { status: 401, statusText: 'Unauthorized' });

    const refreshedToken = `header.${btoa(JSON.stringify({ email: 'test@example.com' }))}.signature2`;
    httpMock
      .expectOne('http://api.test/api/auth/refresh')
      .flush({ access_token: refreshedToken, refresh_token: 'r2', expires_in: 1800 });

    // auth's own refresh promise resolves as a microtask, same as
    // auth-interceptor.spec.ts's equivalent wait.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const retriedAttempt = httpMock.expectOne('http://api.test/api/quotes');
    expect(retriedAttempt.request.headers.get('Authorization')).toBe(`Bearer ${refreshedToken}`);
    retriedAttempt.flush({ page: 1, size: 10, total: 0, items: [] });

    await expect(resultPromise).resolves.toEqual({ page: 1, size: 10, total: 0, items: [] });
  });

  it('still retries a transient 500 on a GET even with auth/error-mapping ahead of it', async () => {
    const resultPromise = firstValueFrom(http.get('http://api.test/api/quotes'));

    httpMock
      .expectOne('http://api.test/api/quotes')
      .flush(null, { status: 500, statusText: 'Server Error' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    httpMock.expectOne('http://api.test/api/quotes').flush({ page: 1, size: 10, total: 0, items: [] });

    await expect(resultPromise).resolves.toEqual({ page: 1, size: 10, total: 0, items: [] });
  });

  it('still maps to an AppError for an opted-in request after auth gives up refreshing', async () => {
    const firstToken = `header.${btoa(JSON.stringify({ email: 'test@example.com' }))}.signature`;
    const loginPromise = auth.login('test@example.com', 'Password123!');
    httpMock
      .expectOne('http://api.test/api/auth/login')
      .flush({ access_token: firstToken, refresh_token: 'r1', expires_in: 1800 });
    await loginPromise;

    const context = new HttpContext().set(MAP_ERRORS, true);
    const resultPromise = firstValueFrom(http.get('http://api.test/api/quotes', { context })).catch(
      (error) => error,
    );

    httpMock
      .expectOne('http://api.test/api/quotes')
      .flush({ message: 'expired' }, { status: 401, statusText: 'Unauthorized' });

    // The refresh call itself also fails - auth gives up and rethrows the
    // original 401, which errorMapping (outermost) should still catch and
    // convert, since it wraps auth's entire retry dance.
    httpMock
      .expectOne('http://api.test/api/auth/refresh')
      .flush({ message: 'invalid' }, { status: 401, statusText: 'Unauthorized' });

    const error = await resultPromise;
    expect(error.status).toBe(401);
    expect(error.message).toBe('You need to sign in again to continue.');
  });
});
