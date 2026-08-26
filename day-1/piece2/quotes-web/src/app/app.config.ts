import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth-interceptor';
import { errorMappingInterceptor } from './core/http/error-mapping-interceptor';
import { retryInterceptor } from './core/http/retry-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // Order matters - interceptors see the request in this order going out,
    // and the REVERSE order coming back (errors included). So retry sees
    // the raw transient failure closest to the backend and retries GETs
    // before auth ever sees them; auth sees a real 401 to decide whether to
    // refresh, before errorMapping gets the final say and converts
    // whatever's left into an AppError (only for requests that opted in).
    provideHttpClient(withInterceptors([errorMappingInterceptor, authInterceptor, retryInterceptor])),
  ],
};
