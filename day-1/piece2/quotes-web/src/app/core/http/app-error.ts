import { HttpContextToken, HttpErrorResponse } from '@angular/common/http';

export interface AppError {
  readonly status: number;
  readonly title: string;
  readonly message: string;
  readonly fieldErrors: Readonly<Record<string, string>> | null;
}

// Opt-in: the error-mapping interceptor only converts HttpErrorResponse ->
// AppError for requests that ask for it via this context token. Applying it
// globally would silently change the error type every existing catch block
// in this app depends on (HttpErrorResponse) - see auth-interceptor.ts,
// create-quote-form.ts, quotes.ts, all written before this and all checking
// `error instanceof HttpErrorResponse`.
export const MAP_ERRORS = new HttpContextToken<boolean>(() => false);

interface ValidationProblemBody {
  readonly title?: string;
  readonly errors?: Record<string, string[]>;
}

interface ProblemDetailsBody {
  readonly title?: string;
  readonly detail?: string;
}

// Confirmed live against the real API (contract/quotes-api.characterization.test.mjs):
// 401/403/404 all come back with an EMPTY body, not ProblemDetails. Only a
// 400 from Results.ValidationProblem() carries JSON. These fallbacks exist
// because there is nothing to read a message off for those statuses.
const STATUS_FALLBACKS: Record<number, { title: string; message: string }> = {
  401: {
    title: 'Not signed in',
    message: 'You need to sign in again to continue.',
  },
  403: {
    title: 'Not allowed',
    message: "You don't have permission to do that.",
  },
  404: {
    title: 'Not found',
    message: 'That could not be found.',
  },
};

export function toAppError(error: HttpErrorResponse): AppError {
  if (error.status === 0) {
    return {
      status: 0,
      title: 'Network error',
      message: 'Could not reach the server. Check your connection and try again.',
      fieldErrors: null,
    };
  }

  if (error.status >= 500) {
    return {
      status: error.status,
      title: 'Server error',
      message: 'Something went wrong on our end. Please try again shortly.',
      fieldErrors: null,
    };
  }

  if (error.status === 400 && isValidationProblem(error.error)) {
    const body = error.error;
    const fieldErrors = extractFieldErrors(body.errors);

    return {
      status: 400,
      title: body.title ?? 'Validation failed',
      message:
        Object.keys(fieldErrors).length > 0
          ? 'Please fix the highlighted fields.'
          : (body.title ?? 'That request was invalid.'),
      fieldErrors,
    };
  }

  const fallback = STATUS_FALLBACKS[error.status];
  if (fallback) {
    return { status: error.status, ...fallback, fieldErrors: null };
  }

  // Anything else that does carry a plain ProblemDetails body (title/detail,
  // no errors dict) - not observed on this API today, but Results.Problem()
  // is a real ASP.NET helper and a future endpoint could return one.
  const body = error.error as ProblemDetailsBody | null;
  return {
    status: error.status,
    title: body?.title ?? 'Request failed',
    message: body?.detail ?? body?.title ?? `The request failed (status ${error.status}).`,
    fieldErrors: null,
  };
}

function isValidationProblem(body: unknown): body is ValidationProblemBody {
  return (
    !!body &&
    typeof body === 'object' &&
    'errors' in body &&
    typeof (body as ValidationProblemBody).errors === 'object'
  );
}

function extractFieldErrors(errors: Record<string, string[]> | undefined): Record<string, string> {
  if (!errors) return {};

  const result: Record<string, string> = {};
  for (const [field, messages] of Object.entries(errors)) {
    // The API includes every field key even when that field has no error
    // (an empty array) - confirmed live in the characterization test - so
    // those must be filtered out rather than treated as a real error.
    if (messages.length > 0) {
      result[field] = messages[0];
    }
  }
  return result;
}
