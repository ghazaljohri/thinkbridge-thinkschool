import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpContext,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { errorMappingInterceptor } from './error-mapping-interceptor';
import { MAP_ERRORS } from './app-error';

describe('errorMappingInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorMappingInterceptor])),
        provideHttpClientTesting(),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('leaves the error as a plain HttpErrorResponse when the request does not opt in', async () => {
    const resultPromise = firstValueFrom(http.get('/api/quotes')).catch((error) => error);

    httpMock.expectOne('/api/quotes').flush(null, { status: 404, statusText: 'Not Found' });

    const error = await resultPromise;
    expect(error).toBeInstanceOf(HttpErrorResponse);
  });

  it('converts to an AppError for a request that opts in via MAP_ERRORS', async () => {
    const context = new HttpContext().set(MAP_ERRORS, true);
    const resultPromise = firstValueFrom(http.get('/api/quotes', { context })).catch(
      (error) => error,
    );

    httpMock.expectOne('/api/quotes').flush(null, { status: 404, statusText: 'Not Found' });

    const error = await resultPromise;
    expect(error).not.toBeInstanceOf(HttpErrorResponse);
    expect(error.status).toBe(404);
    expect(error.message).toBe('That could not be found.');
  });

  it('does not touch a successful response either way', async () => {
    const context = new HttpContext().set(MAP_ERRORS, true);
    const resultPromise = firstValueFrom(http.get('/api/quotes', { context }));

    httpMock.expectOne('/api/quotes').flush({ ok: true });

    await expect(resultPromise).resolves.toEqual({ ok: true });
  });
});
