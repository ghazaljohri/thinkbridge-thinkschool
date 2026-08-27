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

interface TokenClaims {
  readonly email: string | null;
  readonly userId: number | null;
}

const EMPTY_CLAIMS: TokenClaims = { email: null, userId: null };

function decodeClaims(accessToken: string): TokenClaims {
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    // JwtTokenService.CreateAccessToken sets `sub` to the real
    // QuotesApi.Models.Auth.User.Id (an int, stringified per the JWT spec's
    // sub claim being a string) - this is the same id Collection.OwnerId
    // and CollectionSummary/CollectionDetail's ownerId field mean.
    const sub = payload.sub as string | undefined;
    const userId = sub !== undefined ? Number(sub) : NaN;

    return {
      email: (payload.email as string | undefined) ?? null,
      userId: Number.isInteger(userId) ? userId : null,
    };
  } catch {
    return EMPTY_CLAIMS;
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

  private readonly claims = computed<TokenClaims>(() => {
    const token = this.accessToken();
    return token ? decodeClaims(token) : EMPTY_CLAIMS;
  });

  readonly email = computed(() => this.claims().email);
  readonly userId = computed(() => this.claims().userId);

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
