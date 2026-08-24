import { Component, inject, signal } from '@angular/core';
import { Quotes } from '../../core/quotes';

@Component({
  selector: 'app-quotes-explorer',
  imports: [],
  templateUrl: './quotes-explorer.html',
  styleUrl: './quotes-explorer.css',
})
export class QuotesExplorer {
  protected readonly quotes = inject(Quotes);
  readonly selectedId = signal<number | null>(null);

  constructor() {
    this.quotes.loadList();
  }

  select(id: number): void {
    this.selectedId.set(id);
    this.quotes.loadDetail(id);
  }
}
