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
    ],
  },
  { path: '**', redirectTo: 'quotes' },
];
