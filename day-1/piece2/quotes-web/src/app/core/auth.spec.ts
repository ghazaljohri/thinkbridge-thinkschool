import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Auth } from './auth';
import { API_BASE_URL } from './api-base-url';

describe('Auth', () => {
  let service: Auth;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });

    service = TestBed.inject(Auth);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('starts signed out with no stored session', () => {
    expect(service.isAuthenticated()).toBe(false);
    expect(service.accessToken()).toBeNull();
  });

  it('becomes authenticated and exposes the decoded email after a successful login', async () => {
    const payload = { email: 'test@example.com' };
    const fakeToken = `header.${btoa(JSON.stringify(payload))}.signature`;

    const loginPromise = service.login('test@example.com', 'Password123!');

    const req = httpMock.expectOne('http://api.test/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'test@example.com', password: 'Password123!' });

    req.flush({ access_token: fakeToken, refresh_token: 'refresh-token', expires_in: 1800 });
    await loginPromise;
    TestBed.tick();

    expect(service.isAuthenticated()).toBe(true);
    expect(service.accessToken()).toBe(fakeToken);
    expect(service.email()).toBe('test@example.com');
    expect(JSON.parse(localStorage.getItem('quotes-web.session')!).accessToken).toBe(fakeToken);
  });

  it('clears the session on logout', async () => {
    const fakeToken = `header.${btoa(JSON.stringify({ email: 'test@example.com' }))}.signature`;
    const loginPromise = service.login('test@example.com', 'Password123!');
    httpMock
      .expectOne('http://api.test/api/auth/login')
      .flush({ access_token: fakeToken, refresh_token: 'refresh-token', expires_in: 1800 });
    await loginPromise;

    service.logout();
    TestBed.tick();

    expect(service.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('quotes-web.session')).toBeNull();
  });

  it('clears the session when the refresh token is rejected', async () => {
    const fakeToken = `header.${btoa(JSON.stringify({ email: 'test@example.com' }))}.signature`;
    const loginPromise = service.login('test@example.com', 'Password123!');
    httpMock
      .expectOne('http://api.test/api/auth/login')
      .flush({ access_token: fakeToken, refresh_token: 'refresh-token', expires_in: 1800 });
    await loginPromise;

    const refreshPromise = service.refresh();
    httpMock
      .expectOne('http://api.test/api/auth/refresh')
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });

    expect(await refreshPromise).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });
});
