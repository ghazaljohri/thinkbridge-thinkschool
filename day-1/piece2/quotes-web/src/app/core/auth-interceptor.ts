import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { Auth } from './auth';

// /api/auth/login and /api/auth/refresh must go out unauthenticated - there
// is no access token yet (login) or the one on hand may already be the
// expired one that triggered this call (refresh).
const UNAUTHENTICATED_PATHS = ['/api/auth/login', '/api/auth/refresh'];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (UNAUTHENTICATED_PATHS.some((path) => req.url.includes(path))) {
    return next(req);
  }

  const auth = inject(Auth);
  const token = auth.accessToken();
  const authorized = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || !token) {
        return throwError(() => error);
      }

      // One retry with a refreshed access token; a second 401 propagates.
      return from(auth.refresh()).pipe(
        switchMap((newToken) => {
          if (!newToken) {
            return throwError(() => error);
          }

          const retried = req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } });
          return next(retried);
        }),
      );
    }),
  );
};
