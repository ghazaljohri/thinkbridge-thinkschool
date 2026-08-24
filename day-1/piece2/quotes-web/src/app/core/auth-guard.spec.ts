import { TestBed } from '@angular/core/testing';
import { CanActivateFn, provideRouter, Router, UrlTree } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { authGuard } from './auth-guard';
import { Auth } from './auth';

describe('authGuard', () => {
  const executeGuard: CanActivateFn = (...guardParameters) =>
    TestBed.runInInjectionContext(() => authGuard(...guardParameters));

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
  });

  it('redirects to /login when there is no session', () => {
    const result = executeGuard({} as never, {} as never);

    expect(result).toBeInstanceOf(UrlTree);
    expect((result as UrlTree).toString()).toBe('/login');
  });

  it('allows navigation once a session exists', () => {
    localStorage.setItem(
      'quotes-web.session',
      JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }),
    );
    TestBed.inject(Auth);
    TestBed.inject(Router);

    expect(executeGuard({} as never, {} as never)).toBe(true);
  });
});
