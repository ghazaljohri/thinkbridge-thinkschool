import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { MAP_ERRORS, toAppError } from './app-error';

// Only converts HttpErrorResponse -> AppError for requests that opt in via
// the MAP_ERRORS HttpContext token. See app-error.ts for why this isn't
// global.
export const errorMappingInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.context.get(MAP_ERRORS)) {
    return next(req);
  }

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        return throwError(() => toAppError(error));
      }
      return throwError(() => error);
    }),
  );
};
