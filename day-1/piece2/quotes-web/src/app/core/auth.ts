import { Service, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE_URL } from './api-base-url';

const STORAGE_KEY = 'quotes-web.session';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function decodeEmail(accessToken: string): string | null {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    return (payload.email as string | undefined) ?? null;
  } catch {
    return null;
  }
}

// Talks to the Week-1 API's local JWT scheme (POST /api/auth/login,
// /api/auth/refresh) - not the Entra scheme, which browser users never
// exchange a password for directly.
@Service()
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  private readonly session = signal<StoredSession | null>(readStoredSession());

  readonly accessToken = computed(() => this.session()?.accessToken ?? null);
  readonly isAuthenticated = computed(() => this.accessToken() !== null);
  readonly email = computed(() => {
    const token = this.accessToken();
    return token ? decodeEmail(token) : null;
  });

  constructor() {
    // Keeps the session in sync with localStorage so a page refresh doesn't
    // sign the user out; runs once per session change, not per render.
    effect(() => {
      const current = this.session();
      if (current) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    });
  }

  async login(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<TokenResponse>(`${this.baseUrl}/api/auth/login`, { email, password }),
    );

    this.session.set({
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
    });
  }

  logout(): void {
    this.session.set(null);
  }

  // Used by the auth interceptor to retry a request once after a 401.
  // Returns null (and clears the session) if the refresh token is itself
  // invalid or expired, so the interceptor knows to give up.
  async refresh(): Promise<string | null> {
    const current = this.session();
    if (!current) return null;

    try {
      const response = await firstValueFrom(
        this.http.post<TokenResponse>(`${this.baseUrl}/api/auth/refresh`, {
          refreshToken: current.refreshToken,
        }),
      );

      this.session.set({
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
      });

      return response.access_token;
    } catch {
      this.session.set(null);
      return null;
    }
  }
}
