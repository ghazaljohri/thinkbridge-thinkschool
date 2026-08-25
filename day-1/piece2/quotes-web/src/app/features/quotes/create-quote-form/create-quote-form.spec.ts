import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { CreateQuoteForm } from './create-quote-form';
import { API_BASE_URL } from '../../../core/api-base-url';

describe('CreateQuoteForm', () => {
  let fixture: ComponentFixture<CreateQuoteForm>;
  let component: CreateQuoteForm;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateQuoteForm],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateQuoteForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function authorInput(): HTMLInputElement {
    return (fixture.nativeElement as HTMLElement).querySelector('#author')!;
  }

  function textArea(): HTMLTextAreaElement {
    return (fixture.nativeElement as HTMLElement).querySelector('#text')!;
  }

  // --- empty / untouched state -------------------------------------------

  it('shows no errors and no aria-invalid before anything is touched', () => {
    expect(authorInput().getAttribute('aria-invalid')).toBeNull();
    expect(textArea().getAttribute('aria-invalid')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeNull();
  });

  // --- invalid state + a11y wiring ----------------------------------------

  it('marks empty required fields invalid, wires aria-invalid/aria-describedby, and moves focus to the first error on submit', async () => {
    await component.submit();
    fixture.detectChanges();

    expect(component.form.invalid).toBe(true);
    expect(authorInput().getAttribute('aria-invalid')).toBe('true');
    expect(authorInput().getAttribute('aria-describedby')).toBe('author-error author-hint');
    expect(document.activeElement).toBe(authorInput());

    httpMock.expectNone(() => true);
  });

  it('flags a value over the real API limit the same way the server would (maxlength, not a guessed number)', () => {
    component.form.controls.author.setValue('A'.repeat(201));
    component.form.controls.author.markAsTouched();
    fixture.detectChanges();

    expect(component.fieldError('author')).toContain('201/200');
    expect(authorInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('rejects a whitespace-only author the same way Quote.Create does server-side', () => {
    // QuotesApi's Quote.Create uses string.IsNullOrWhiteSpace, not a plain
    // emptiness check - confirmed live: POST with author: "   " returns a
    // 400 with errors.author. Validators.required alone does not catch
    // this (it only fails on an exactly empty string), so a first draft
    // built on it would let this through client-side and only find out
    // from the server.
    component.form.controls.author.setValue('   ');
    component.form.controls.author.markAsTouched();
    fixture.detectChanges();

    expect(component.form.controls.author.invalid).toBe(true);
    expect(component.fieldError('author')).toBe('This field is required.');
  });

  // --- submitting state -----------------------------------------------------

  it('disables the submit button and marks aria-busy while the request is in flight', async () => {
    component.form.setValue({ author: 'Ada Lovelace', text: 'Some real quote text' });
    const submitPromise = component.submit();
    fixture.detectChanges();

    const button = (fixture.nativeElement as HTMLElement).querySelector('button[type="submit"]')!;
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');

    httpMock
      .expectOne('http://api.test/api/quotes')
      .flush({ id: 1, author: 'Ada Lovelace', text: 'Some real quote text', isDeleted: false, createdAtUtc: 'x' });
    await submitPromise;
  });

  it('posts exactly {author, text} and emits the created quote on success', async () => {
    const createdSpy = vi.fn();
    component.created.subscribe(createdSpy);

    component.form.setValue({ author: 'Ada Lovelace', text: 'Some real quote text' });
    const submitPromise = component.submit();

    const req = httpMock.expectOne('http://api.test/api/quotes');
    expect(req.request.body).toEqual({ author: 'Ada Lovelace', text: 'Some real quote text' });
    req.flush({ id: 1, author: 'Ada Lovelace', text: 'Some real quote text', isDeleted: false, createdAtUtc: 'x' });
    await submitPromise;

    expect(createdSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, author: 'Ada Lovelace' }),
    );
    expect(component.form.controls.author.value).toBe('');
  });

  // --- server-error state -----------------------------------------------

  it('maps a real 400 ValidationProblem onto the specific field, not a generic banner', async () => {
    component.form.setValue({ author: 'Ada Lovelace', text: 'Some real quote text' });
    const submitPromise = component.submit();

    // The exact shape ASP.NET's Results.ValidationProblem sends back,
    // confirmed live against QuotesApi.
    httpMock.expectOne('http://api.test/api/quotes').flush(
      {
        type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { author: ["Author must be 200 characters or fewer. (Parameter 'author')"] },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await submitPromise;
    fixture.detectChanges();

    expect(component.fieldError('author')).toContain('200 characters or fewer');
    expect(component.serverError()).toBeNull();
    expect(authorInput().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(authorInput());
  });

  it('shows a clear message on a 401 without pretending the form itself was invalid', async () => {
    component.form.setValue({ author: 'Ada Lovelace', text: 'Some real quote text' });
    const submitPromise = component.submit();

    httpMock
      .expectOne('http://api.test/api/quotes')
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await submitPromise;
    fixture.detectChanges();

    expect(component.serverError()).toBe('You need to sign in again to add a quote.');
    expect(component.form.controls.author.value).toBe('Ada Lovelace');
  });
});
