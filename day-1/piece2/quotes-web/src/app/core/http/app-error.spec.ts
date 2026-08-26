import { HttpErrorResponse } from '@angular/common/http';
import { toAppError } from './app-error';

// Every fixture body below is the literal shape captured in
// contract/quotes-api.characterization.test.mjs against the real, running
// API - not invented.

describe('toAppError', () => {
  it('maps a real ValidationProblemDetails 400 to field errors, dropping fields with no error', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: {
        type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { page: ['Page must be at least 1.'], size: [] },
        traceId: '00-31e3fcdc8c3b8f1f974ba785136e0d1b-8d8141c7027a421c-01',
      },
    });

    const appError = toAppError(error);

    expect(appError.status).toBe(400);
    expect(appError.fieldErrors).toEqual({ page: 'Page must be at least 1.' });
    expect(appError.fieldErrors).not.toHaveProperty('size');
    expect(appError.message).toBe('Please fix the highlighted fields.');
  });

  it('falls back to a fixed message on a 401, since the real API sends an empty body', () => {
    // Confirmed live: DELETE with no Authorization header -> 401, empty
    // body. error.error is null here, not a ProblemDetails object.
    const error = new HttpErrorResponse({ status: 401, error: null });

    const appError = toAppError(error);

    expect(appError.status).toBe(401);
    expect(appError.message).toBe('You need to sign in again to continue.');
    expect(appError.fieldErrors).toBeNull();
  });

  it('falls back to a fixed message on a 403, since the real API sends an empty body', () => {
    const error = new HttpErrorResponse({ status: 403, error: null });
    const appError = toAppError(error);

    expect(appError.status).toBe(403);
    expect(appError.message).toBe("You don't have permission to do that.");
  });

  it('falls back to a fixed message on a 404, since the real API sends an empty body', () => {
    const error = new HttpErrorResponse({ status: 404, error: null });
    const appError = toAppError(error);

    expect(appError.status).toBe(404);
    expect(appError.message).toBe('That could not be found.');
  });

  it('treats status 0 as a network error, not a generic request failure', () => {
    const error = new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') });
    const appError = toAppError(error);

    expect(appError.status).toBe(0);
    expect(appError.message).toContain('Could not reach the server');
  });

  it('treats any 5xx as a server error regardless of body', () => {
    const error = new HttpErrorResponse({ status: 503, error: null });
    const appError = toAppError(error);

    expect(appError.status).toBe(503);
    expect(appError.message).toContain('Something went wrong on our end');
  });

  it('falls back gracefully on an unrecognized 4xx with no body, instead of throwing', () => {
    const error = new HttpErrorResponse({ status: 409, error: null });
    const appError = toAppError(error);

    expect(appError.status).toBe(409);
    expect(appError.message).toContain('409');
  });

  it('reads title/detail off a plain ProblemDetails body when one is present', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { title: 'Conflict', detail: 'That quote was already deleted.' },
    });
    const appError = toAppError(error);

    expect(appError.title).toBe('Conflict');
    expect(appError.message).toBe('That quote was already deleted.');
  });
});
