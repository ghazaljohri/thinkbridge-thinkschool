import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withViewTransitions } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth-interceptor';
import { errorMappingInterceptor } from './core/http/error-mapping-interceptor';
import { retryInterceptor } from './core/http/retry-interceptor';
import { API_BASE_URL } from './core/api-base-url';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      // Binds the :id route param straight to QuoteDetail's `id` input
      // signal - no ActivatedRoute.paramMap subscription needed.
      withComponentInputBinding(),
      // Wraps navigation in document.startViewTransition() when the
      // browser supports it (a no-op fallback otherwise). Elements sharing
      // a view-transition-name across the two routes - the clicked quote
      // card in quotes-list.html and the same id's card in
      // quote-detail.html - morph between states instead of a hard cut.
      withViewTransitions(),
    ),
    // Order matters - interceptors see the request in this order going out,
    // and the REVERSE order coming back (errors included). So retry sees
    // the raw transient failure closest to the backend and retries GETs
    // before auth ever sees them; auth sees a real 401 to decide whether to
    // refresh, before errorMapping gets the final say and converts
    // whatever's left into an AppError (only for requests that opted in).
    provideHttpClient(withInterceptors([errorMappingInterceptor, authInterceptor, retryInterceptor])),
    { provide: API_BASE_URL, useValue: environment.apiBaseUrl },
  ],
};
