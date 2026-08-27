import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideRouter, Router, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { routes } from './app.routes';
import { API_BASE_URL } from './core/api-base-url';
import { errorMappingInterceptor } from './core/http/error-mapping-interceptor';

// Exercises the REAL route config end to end (the same `routes` app.config.ts
// wires up), not the authGuard function in isolation - this is what actually
// proves a direct deep link to a guarded, lazy-loaded child route redirects
// unauthenticated users, per the exercise's "don't take the agent's word for
// it" ask.
describe('app routing', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes, withComponentInputBinding()),
        provideHttpClient(withInterceptors([errorMappingInterceptor])),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('redirects an unauthenticated direct navigation to the guarded, lazy-loaded /quotes/:id route to /login', async () => {
    const harness = await RouterTestingHarness.create('/quotes/5');
    const router = TestBed.inject(Router);

    expect(router.url).toBe('/login');
    // No detail request should ever have been attempted - the guard has to
    // block navigation before the route (and its data fetch) even loads.
    httpMock.expectNone(() => true);
    void harness;
  });

  it('activates the lazy-loaded QuoteDetail route and binds the real :id route param once authenticated', async () => {
    localStorage.setItem(
      'quotes-web.session',
      JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }),
    );

    const harness = await RouterTestingHarness.create('/quotes/5');
    const router = TestBed.inject(Router);

    // The harness's own routeDebugElement is Shell (the outer routed
    // component) - QuoteDetail is nested inside Shell's own <router-outlet>,
    // so its selector in the rendered DOM plus the actual dispatched
    // request to the real per-id endpoint (only QuoteDetail's effect
    // triggers this) is the real proof the correct lazy child activated
    // with the right id, not a guess about the debug tree's shape.
    expect(router.url).toBe('/quotes/5');
    expect(harness.routeNativeElement?.querySelector('app-quote-detail')).not.toBeNull();

    httpMock.expectOne('http://api.test/api/quotes/5').flush({
      id: 5,
      author: 'Grace Hopper',
      text: 'It is easier to ask forgiveness than it is to get permission.',
      isDeleted: false,
      createdAtUtc: 'x',
    });
  });
});
