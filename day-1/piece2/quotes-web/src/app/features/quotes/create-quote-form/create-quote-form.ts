import { Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from '../../../core/api-base-url';
import type { Quote } from '../../../models/quote';

// Mirrors QuoteRequest/Quote.Create in the real API exactly:
// QuotesApi/Extensions/QuoteEndpointExtensions.cs (author, text)
// QuotesApi/Models/Quote.cs (the length limits Quote.Create enforces).
const AUTHOR_MAX_LENGTH = 200;
const TEXT_MAX_LENGTH = 1000;

// Quote.Create rejects a value with string.IsNullOrWhiteSpace, not a plain
// emptiness check - Validators.required alone lets "   " through client-side
// only to have the real API 400 on it. Confirmed live: POST with
// author: "   " returns errors.author = "Author is required.".
function requiredNonBlank(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.trim().length === 0 ? { required: true } : null;
}

// The real 400 shape (ASP.NET's Results.ValidationProblem), confirmed live -
// e.g. { errors: { author: ["Author is required. (Parameter 'author')"] } }.
interface ValidationProblemBody {
  errors?: Record<string, string[]>;
}

const FIELD_NAMES = ['author', 'text'] as const;
type FieldName = (typeof FIELD_NAMES)[number];

@Component({
  selector: 'app-create-quote-form',
  imports: [ReactiveFormsModule],
  templateUrl: './create-quote-form.html',
  styleUrl: './create-quote-form.css',
})
export class CreateQuoteForm {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  readonly created = output<Quote>();

  readonly authorInput = viewChild<ElementRef<HTMLInputElement>>('authorInput');
  readonly textInput = viewChild<ElementRef<HTMLTextAreaElement>>('textInput');

  readonly authorMaxLength = AUTHOR_MAX_LENGTH;
  readonly textMaxLength = TEXT_MAX_LENGTH;

  readonly form = new FormGroup({
    author: new FormControl('', {
      nonNullable: true,
      validators: [requiredNonBlank, Validators.maxLength(AUTHOR_MAX_LENGTH)],
    }),
    text: new FormControl('', {
      nonNullable: true,
      validators: [requiredNonBlank, Validators.maxLength(TEXT_MAX_LENGTH)],
    }),
  });

  readonly submitting = signal(false);
  readonly serverError = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  async submit(): Promise<void> {
    this.serverError.set(null);
    this.successMessage.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusFirstInvalidControl();
      return;
    }

    this.submitting.set(true);

    try {
      const { author, text } = this.form.getRawValue();
      const created = await firstValueFrom(
        this.http.post<Quote>(`${this.baseUrl}/api/quotes`, { author, text }),
      );

      this.form.reset({ author: '', text: '' });
      this.successMessage.set('Quote added.');
      this.created.emit(created);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 400 && this.applyServerFieldErrors(error)) {
        this.focusFirstInvalidControl();
      } else {
        this.serverError.set(
          error instanceof HttpErrorResponse && error.status === 401
            ? 'You need to sign in again to add a quote.'
            : 'Could not create that quote. Please try again.',
        );
      }
    } finally {
      this.submitting.set(false);
    }
  }

  // The client-side validators mirror the API's rules, but this stays as a
  // second line of defense: if the API's rules ever drift from what's
  // encoded here, a field-level 400 still lands on the right field instead
  // of a generic banner the user can't act on.
  private applyServerFieldErrors(error: HttpErrorResponse): boolean {
    const body = error.error as ValidationProblemBody | null;
    let applied = false;

    for (const field of FIELD_NAMES) {
      const messages = body?.errors?.[field];
      if (!messages?.length) continue;

      this.form.controls[field].setErrors({ server: messages[0] });
      this.form.controls[field].markAsTouched();
      applied = true;
    }

    return applied;
  }

  fieldError(name: FieldName): string | null {
    const control = this.form.controls[name];
    if (!control.touched || !control.errors) return null;

    if (control.errors['required']) return 'This field is required.';
    if (control.errors['maxlength']) {
      const { requiredLength, actualLength } = control.errors['maxlength'];
      return `Too long: ${actualLength}/${requiredLength} characters.`;
    }
    if (control.errors['server']) return control.errors['server'] as string;
    return 'This field is invalid.';
  }

  describedBy(name: FieldName): string {
    return this.fieldError(name) ? `${name}-error ${name}-hint` : `${name}-hint`;
  }

  private focusFirstInvalidControl(): void {
    if (this.form.controls.author.invalid) {
      this.authorInput()?.nativeElement.focus();
    } else if (this.form.controls.text.invalid) {
      this.textInput()?.nativeElement.focus();
    }
  }
}
