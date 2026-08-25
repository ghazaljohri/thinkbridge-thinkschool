import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { CreateQuoteFormSignal } from './create-quote-form-signal';
import { API_BASE_URL } from '../../../core/api-base-url';

describe('CreateQuoteFormSignal', () => {
  let fixture: ComponentFixture<CreateQuoteFormSignal>;
  let component: CreateQuoteFormSignal;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateQuoteFormSignal],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_BASE_URL, useValue: 'http://api.test' },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CreateQuoteFormSignal);
    component = fixture.componentInstance;
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function authorInput(): HTMLInputElement {
    return (fixture.nativeElement as HTMLElement).querySelector('#author-sf')!;
  }

  // --- pristine / untouched state -----------------------------------------

  it('shows no errors and no aria-invalid before anything is touched (pristine)', () => {
    expect(component.quoteForm().dirty()).toBe(false);
    expect(component.quoteForm.author().touched()).toBe(false);
    expect(authorInput().getAttribute('aria-invalid')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeNull();
  });

  it('marks dirty through the bound control, but NOT through a direct field().value.set()', () => {
    // A real gap worth knowing about, found while writing this test, not
    // assumed from the docs: field().value is a plain WritableSignal, and
    // setting it updates the model, but markAsDirty() only lives inside the
    // wrapped controlValue.set() that the actual bound <input> goes
    // through - confirmed by reading the source. Programmatic value
    // changes that skip the real control silently skip dirty-tracking too.
    component.quoteForm.author().value.set('Ada');
    expect(component.quoteForm.author().dirty()).toBe(false);

    const input = authorInput();
    input.value = 'Ada Lovelace';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.quoteForm.author().dirty()).toBe(true);
    expect(component.quoteForm.author().touched()).toBe(false);
  });

  // --- invalid state + a11y wiring ----------------------------------------

  it('marks fields touched, wires aria-invalid/aria-describedby, and focuses the first error on a blocked submit', async () => {
    await component.submitForm();
    fixture.detectChanges();

    expect(component.quoteForm().invalid()).toBe(true);
    expect(component.quoteForm.author().touched()).toBe(true);
    expect(authorInput().getAttribute('aria-invalid')).toBe('true');
    expect(authorInput().getAttribute('aria-describedby')).toBe('author-error author-hint');
    expect(document.activeElement).toBe(authorInput());

    httpMock.expectNone(() => true);
  });

  it('flags a value over the real API limit via maxLength, matching the server limit exactly', () => {
    component.quoteForm.author().value.set('A'.repeat(201));
    component.quoteForm.author().markAsTouched();
    fixture.detectChanges();

    expect(component.quoteForm.author().invalid()).toBe(true);
    expect(authorInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('rejects a whitespace-only author the same way Quote.Create does server-side', () => {
    // Same real gap as the reactive-forms version's Validators.required:
    // @angular/forms/signals' own required() calls isEmpty(), which for a
    // string only checks `value === ''`, not whitespace - confirmed by
    // reading its source. Quote.Create uses string.IsNullOrWhiteSpace, so
    // a plain required() here would let "   " through exactly like
    // Validators.required did.
    component.quoteForm.author().value.set('   ');
    component.quoteForm.author().markAsTouched();
    fixture.detectChanges();

    expect(component.quoteForm.author().invalid()).toBe(true);
  });

  // --- submitting state -----------------------------------------------------

  it('disables the submit button and marks aria-busy while the request is in flight', async () => {
    component.quoteForm.author().value.set('Ada Lovelace');
    component.quoteForm.text().value.set('Some real quote text');
    const submitPromise = component.submitForm();
    fixture.detectChanges();

    const button = (fixture.nativeElement as HTMLElement).querySelector('button[type="submit"]')!;
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(component.quoteForm().submitting()).toBe(true);

    httpMock
      .expectOne('http://api.test/api/quotes')
      .flush({ id: 1, author: 'Ada Lovelace', text: 'Some real quote text', isDeleted: false, createdAtUtc: 'x' });
    await submitPromise;
  });

  it('posts exactly {author, text} and emits the created quote on a clean submit', async () => {
    const createdSpy = vi.fn();
    component.created.subscribe(createdSpy);

    component.quoteForm.author().value.set('Ada Lovelace');
    component.quoteForm.text().value.set('Some real quote text');
    const submitPromise = component.submitForm();

    const req = httpMock.expectOne('http://api.test/api/quotes');
    expect(req.request.body).toEqual({ author: 'Ada Lovelace', text: 'Some real quote text' });
    req.flush({ id: 1, author: 'Ada Lovelace', text: 'Some real quote text', isDeleted: false, createdAtUtc: 'x' });
    await submitPromise;

    expect(createdSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, author: 'Ada Lovelace' }),
    );
    expect(component.quoteForm.author().value()).toBe('');
  });

  // --- server-error state -----------------------------------------------

  it('maps a real 400 ValidationProblem onto the specific field and refocuses it', async () => {
    component.quoteForm.author().value.set('Ada Lovelace');
    component.quoteForm.text().value.set('Some real quote text');
    const submitPromise = component.submitForm();

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

    expect(component.fieldError(component.quoteForm.author)).toContain('200 characters or fewer');
    expect(component.serverError()).toBeNull();
    expect(authorInput().getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(authorInput());
  });

  it('shows a clear message on a 401 without pretending a field was invalid', async () => {
    component.quoteForm.author().value.set('Ada Lovelace');
    component.quoteForm.text().value.set('Some real quote text');
    const submitPromise = component.submitForm();

    httpMock
      .expectOne('http://api.test/api/quotes')
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await submitPromise;
    fixture.detectChanges();

    expect(component.serverError()).toBe('You need to sign in again to add a quote.');
    expect(component.quoteForm().invalid()).toBe(false);
    expect(component.quoteForm.author().value()).toBe('Ada Lovelace');
  });
});
