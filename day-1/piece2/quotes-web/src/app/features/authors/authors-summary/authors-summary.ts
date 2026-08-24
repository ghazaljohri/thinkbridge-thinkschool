import { Component, inject } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { API_BASE_URL } from '../../../core/api-base-url';
import type { AuthorSummary } from '../../../models/author-summary';

@Component({
  selector: 'app-authors-summary',
  imports: [],
  templateUrl: './authors-summary.html',
  styleUrl: './authors-summary.css',
})
export class AuthorsSummary {
  private readonly baseUrl = inject(API_BASE_URL);

  readonly summaryResource = httpResource<AuthorSummary[]>(
    () => `${this.baseUrl}/api/authors/summary`,
    { defaultValue: [] },
  );
}
