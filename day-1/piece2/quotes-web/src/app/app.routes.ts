import { Routes } from '@angular/router';
import { authGuard } from './core/auth-guard';
import { Shell } from './shell/shell';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'quotes', pathMatch: 'full' },
      {
        path: 'quotes',
        loadComponent: () =>
          import('./features/quotes/quotes-list/quotes-list').then((m) => m.QuotesList),
      },
      {
        // The real route param: GET /api/quotes/{id:int}'s id. A separate
        // lazy chunk from 'quotes' above - confirmed in the build output,
        // not assumed - and protected by the same authGuard on the parent
        // route, which Angular re-evaluates for every segment on any
        // navigation, including a direct deep link straight to this URL.
        path: 'quotes/:id',
        loadComponent: () =>
          import('./features/quotes/quote-detail/quote-detail').then((m) => m.QuoteDetail),
      },
      {
        path: 'authors',
        loadComponent: () =>
          import('./features/authors/authors-summary/authors-summary').then(
            (m) => m.AuthorsSummary,
          ),
      },
      {
        path: 'browse',
        loadComponent: () =>
          import('./features/quotes-explorer/quotes-explorer').then((m) => m.QuotesExplorer),
      },
      {
        path: 'signal-forms',
        loadComponent: () =>
          import('./features/signal-forms-demo/signal-forms-demo').then((m) => m.SignalFormsDemo),
      },
      {
        path: 'collections',
        loadComponent: () =>
          import('./features/collections/collections-page/collections-page').then(
            (m) => m.CollectionsPage,
          ),
      },
    ],
  },
  { path: '**', redirectTo: 'quotes' },
];
