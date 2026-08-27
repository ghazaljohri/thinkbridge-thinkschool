import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Collections } from '../../../core/collections';
import { Auth } from '../../../core/auth';

@Component({
  selector: 'app-collections-page',
  imports: [FormsModule],
  templateUrl: './collections-page.html',
  styleUrl: './collections-page.css',
})
export class CollectionsPage {
  protected readonly collections = inject(Collections);
  private readonly auth = inject(Auth);

  readonly newName = signal('');
  readonly newQuoteId = signal('');
  readonly selectedId = signal<number | null>(null);

  constructor() {
    // Reloads if the signed-in user actually changes (a real login swap),
    // not on every render - userId() is a computed signal, so a same-value
    // recompute (e.g. a token refresh for the same user) doesn't re-fire
    // this effect at all.
    effect(() => {
      const ownerId = this.auth.userId();
      if (ownerId !== null) {
        this.collections.loadSummaries(ownerId);
      }
    });
  }

  async createCollection(): Promise<void> {
    const ownerId = this.auth.userId();
    if (ownerId === null) return;

    const created = await this.collections.createCollection(this.newName(), ownerId);
    if (created) {
      this.newName.set('');
    }
  }

  select(id: number): void {
    this.selectedId.set(id);
    this.collections.loadDetail(id);
  }

  async addItem(): Promise<void> {
    const id = this.selectedId();
    const quoteId = Number(this.newQuoteId());
    if (id === null || !Number.isInteger(quoteId)) return;

    await this.collections.addItem(id, quoteId);
    this.newQuoteId.set('');
  }

  removeItem(quoteId: number): void {
    const id = this.selectedId();
    if (id === null) return;
    this.collections.removeItem(id, quoteId);
  }
}
