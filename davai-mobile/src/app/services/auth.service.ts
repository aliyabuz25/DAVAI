import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { StorageService } from './storage.service';
import { environment } from '../../environments/environment';

export interface User {
  id: string;
  name: string;
  email: string;
  plan: 'free' | 'pro' | 'pro_max';
  school?: string;
  program?: 'IB' | 'IELTS' | 'Both';
  avatar?: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly TOKEN_KEY = 'davai_token';
  private readonly USER_KEY  = 'davai_user';

  private _user   = signal<User | null>(this.storage.get<User | null>(this.USER_KEY, null));
  private _token  = signal<string | null>(this.storage.get<string | null>(this.TOKEN_KEY, null));

  readonly user         = this._user.asReadonly();
  readonly token        = this._token.asReadonly();
  readonly isLoggedIn   = computed(() => !!this._token());
  readonly userInitials = computed(() => {
    const u = this._user();
    if (!u) return 'D';
    return u.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  });
  readonly planLabel = computed(() => {
    const plan = this._user()?.plan ?? 'free';
    return plan === 'free' ? 'Free' : plan === 'pro' ? 'Pro' : 'Pro Max';
  });

  constructor(private http: HttpClient, private storage: StorageService) {
    if (this._token()) {
      this.refreshProfile().subscribe({ error: () => {} });
    }
  }

  refreshProfile(): Observable<User> {
    return this.http
      .get<User>(`${environment.apiUrl}/auth/me`, { headers: this.getAuthHeaders() })
      .pipe(
        tap(user => {
          if (user) {
            this._user.set(user);
            this.storage.set(this.USER_KEY, user);
          }
        })
      );
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/login`, { email, password })
      .pipe(tap(res => this.saveSession(res)));
  }

  register(name: string, email: string, password: string, program: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/auth/register`, { name, email, password, program })
      .pipe(tap(res => this.saveSession(res)));
  }

  loginAsGuest(): void {
    const guest: User = {
      id: 'guest',
      name: 'Guest Student',
      email: '',
      plan: 'free',
      program: 'IB',
      createdAt: new Date().toISOString(),
    };
    this._user.set(guest);
    this.storage.set(this.USER_KEY, guest);
  }

  logout(): void {
    this._user.set(null);
    this._token.set(null);
    this.storage.remove(this.USER_KEY);
    this.storage.remove(this.TOKEN_KEY);
  }

  updateUser(partial: Partial<User>): void {
    const current = this._user();
    if (!current) return;
    const updated = { ...current, ...partial };
    this._user.set(updated);
    this.storage.set(this.USER_KEY, updated);
  }

  getAuthHeaders(): Record<string, string> {
    const t = this._token();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  private saveSession(res: AuthResponse): void {
    this._token.set(res.token);
    this._user.set(res.user);
    this.storage.set(this.TOKEN_KEY, res.token);
    this.storage.set(this.USER_KEY, res.user);
  }
}