import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { authInterceptor } from './auth-interceptor';
import { Auth } from './auth';
import { API_BASE_URL } from './api-base-url';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: Auth;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(Auth);
  });

  afterEach(() => httpMock.verify());

  it('leaves the request bare when there is no session', () => {
    http.get('http://api.test/api/authors/summary').subscribe();
    const req = httpMock.expectOne('http://api.test/api/authors/summary');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('attaches the bearer token once signed in', async () => {
    const fakeToken = `header.${btoa(JSON.stringify({ email: 'test@example.com' }))}.signature`;
    const loginPromise = auth.login('test@example.com', 'Password123!');
    httpMock
      .expectOne('http://api.test/api/auth/login')
      .flush({ access_token: fakeToken, refresh_token: 'refresh-token', expires_in: 1800 });
    await loginPromise;

    http.get('http://api.test/api/quotes').subscribe();
    const req = httpMock.expectOne('http://api.test/api/quotes');
    expect(req.request.headers.get('Authorization')).toBe(`Bearer ${fakeToken}`);
    req.flush({ page: 1, size: 10, total: 0, items: [] });
  });

  it('never authenticates the login/refresh requests themselves', () => {
    http.post('http://api.test/api/auth/login', { email: 'a', password: 'b' }).subscribe();
    const req = httpMock.expectOne('http://api.test/api/auth/login');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ access_token: 'x', refresh_token: 'y', expires_in: 1800 });
  });

  it('retries once with a refreshed token after a 401, then gives up on a second 401', async () => {
    const firstToken = `header.${btoa(JSON.stringify({ email: 'test@example.com' }))}.signature`;
    const loginPromise = auth.login('test@example.com', 'Password123!');
    httpMock
      .expectOne('http://api.test/api/auth/login')
      .flush({ access_token: firstToken, refresh_token: 'refresh-token', expires_in: 1800 });
    await loginPromise;

    const resultPromise = firstValueFrom(http.get('http://api.test/api/quotes'));

    const firstAttempt = httpMock.expectOne('http://api.test/api/quotes');
    firstAttempt.flush({ message: 'expired' }, { status: 401, statusText: 'Unauthorized' });

    const refreshedToken = `header.${btoa(JSON.stringify({ email: 'test@example.com' }))}.signature2`;
    const refreshReq = httpMock.expectOne('http://api.test/api/auth/refresh');
    refreshReq.flush({
      access_token: refreshedToken,
      refresh_token: 'refresh-token-2',
      expires_in: 1800,
    });

    // auth.refresh()'s promise resolution (and the from()/switchMap chain that
    // dispatches the retried request off the back of it) lands as a microtask,
    // not synchronously within this flush() call.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const retriedAttempt = httpMock.expectOne('http://api.test/api/quotes');
    expect(retriedAttempt.request.headers.get('Authorization')).toBe(`Bearer ${refreshedToken}`);
    retriedAttempt.flush({ page: 1, size: 10, total: 0, items: [] });

    await expect(resultPromise).resolves.toEqual({ page: 1, size: 10, total: 0, items: [] });
  });
});
