import { Component, inject, output, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { form, Field, FormField, maxLength, requiredError, submit, validate } from '@angular/forms/signals';
import { API_BASE_URL } from '../../../core/api-base-url';
import type { Quote } from '../../../models/quote';

// Same real constraints as the reactive-forms version, read off the live
// API (QuotesApi/Models/Quote.cs's Quote.Create), not guessed:
// author/text both required, capped at 200/1000 characters.
const AUTHOR_MAX_LENGTH = 200;
const TEXT_MAX_LENGTH = 1000;

interface CreateQuoteModel {
  author: string;
  text: string;
}

// The real 400 shape (ASP.NET's Results.ValidationProblem), same as the
// reactive-forms version - confirmed live against QuotesApi.
interface ValidationProblemBody {
  errors?: Record<string, string[]>;
}

@Component({
  selector: 'app-create-quote-form-signal',
  imports: [FormField],
  templateUrl: './create-quote-form-signal.html',
  styleUrl: './create-quote-form-signal.css',
})
export class CreateQuoteFormSignal {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  readonly created = output<Quote>();

  readonly authorMaxLength = AUTHOR_MAX_LENGTH;
  readonly textMaxLength = TEXT_MAX_LENGTH;

  private readonly model = signal<CreateQuoteModel>({ author: '', text: '' });

  readonly quoteForm = form(this.model, (path) => {
    // required() alone would repeat the exact same gap Validators.required
    // has in the reactive-forms version: @angular/forms/signals' own
    // isEmpty() only checks `value === ''`, not whitespace - confirmed by
    // reading its source, not assumed. Quote.Create uses
    // string.IsNullOrWhiteSpace, so a custom validate() replaces required()
    // on both fields to actually match the API.
    validate(path.author, (ctx) => (ctx.value().trim().length === 0 ? requiredError() : undefined));
    maxLength(path.author, AUTHOR_MAX_LENGTH);

    validate(path.text, (ctx) => (ctx.value().trim().length === 0 ? requiredError() : undefined));
    maxLength(path.text, TEXT_MAX_LENGTH);
  });

  readonly serverError = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);

  async submitForm(): Promise<void> {
    this.serverError.set(null);
    this.successMessage.set(null);

    // quoteForm().submitting() (bound in the template) already reflects
    // this while the action below is in flight - submit() manages it
    // internally, no separate signal needed the way the reactive-forms
    // version's `submitting` signal was.
    const succeeded = await submit(this.quoteForm, async (field) => {
      try {
        const { author, text } = field().value();
        const created = await firstValueFrom(
          this.http.post<Quote>(`${this.baseUrl}/api/quotes`, { author, text }),
        );

        this.model.set({ author: '', text: '' });
        this.successMessage.set('Quote added.');
        this.created.emit(created);
        return [];
      } catch (error) {
        if (error instanceof HttpErrorResponse && error.status === 400) {
          const body = error.error as ValidationProblemBody | null;
          const fieldErrors = [];

          for (const key of ['author', 'text'] as const) {
            const messages = body?.errors?.[key];
            if (messages?.length) {
              fieldErrors.push({ kind: 'server', message: messages[0], fieldTree: this.quoteForm[key] });
            }
          }

          if (fieldErrors.length) return fieldErrors;
        }

        this.serverError.set(
          error instanceof HttpErrorResponse && error.status === 401
            ? 'You need to sign in again to add a quote.'
            : 'Could not create that quote. Please try again.',
        );
        return [];
      }
    });

    // submit() resolves false both when client validation blocked the
    // action and when the action itself returned field errors - either
    // way, something is invalid and needs focus. A non-field failure (the
    // 401 case above) resolves true here since no field is actually
    // invalid, so there's nothing to focus - the serverError banner is
    // already doing that job instead.
    if (!succeeded) {
      this.focusFirstInvalidControl();
    }
  }

  fieldError(field: Field<string>): string | null {
    const state = field();
    if (!state.touched()) return null;
    const errors = state.errors();
    return errors.length > 0 ? errors[0].message ?? 'This field is invalid.' : null;
  }

  describedBy(field: Field<string>, name: 'author' | 'text'): string {
    return this.fieldError(field) ? `${name}-error ${name}-hint` : `${name}-hint`;
  }

  private focusFirstInvalidControl(): void {
    if (this.quoteForm.author().invalid()) {
      this.quoteForm.author().focusBoundControl();
    } else if (this.quoteForm.text().invalid()) {
      this.quoteForm.text().focusBoundControl();
    }
  }
}
