import { Component, signal } from '@angular/core';
import { CreateQuoteFormSignal } from '../quotes/create-quote-form-signal/create-quote-form-signal';
import type { Quote } from '../../models/quote';

@Component({
  selector: 'app-signal-forms-demo',
  imports: [CreateQuoteFormSignal],
  templateUrl: './signal-forms-demo.html',
  styleUrl: './signal-forms-demo.css',
})
export class SignalFormsDemo {
  readonly lastCreated = signal<Quote | null>(null);

  onCreated(quote: Quote): void {
    this.lastCreated.set(quote);
  }
}
