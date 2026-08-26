import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { retry, throwError, timer } from 'rxjs';

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 250;

function isTransient(error: unknown): boolean {
  return error instanceof HttpErrorResponse && (error.status === 0 || error.status >= 500);
}

// Retries idempotent GETs on transient failures only (a network error, or a
// 5xx from the server) with exponential backoff - never on a 4xx, since a
// client error will fail the exact same way on every retry and just wastes
// round trips. Per RxJS's own retry() docs: the delay notifier must ERROR
// (not throw synchronously, not complete) to make retry() stop and
// propagate that error immediately instead of silently swallowing it.
export const retryInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.method !== 'GET') {
    return next(req);
  }

  return next(req).pipe(
    retry({
      count: MAX_RETRIES,
      delay: (error: unknown, retryCount: number) => {
        if (!isTransient(error)) {
          return throwError(() => error);
        }
        return timer(BASE_DELAY_MS * 2 ** (retryCount - 1));
      },
    }),
  );
};
