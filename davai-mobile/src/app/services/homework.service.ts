import { Injectable, signal, computed } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

export type Subject  = 'Mathematics' | 'Physics' | 'Chemistry' | 'Biology' | 'English' |
                       'History' | 'Economics' | 'Geography' | 'Computer Science' |
                       'Psychology' | 'Art' | 'TOK' | 'EE' | 'Other';
export type Priority = 'low' | 'medium' | 'high';
export type HWStatus = 'pending' | 'in_progress' | 'done';

export interface HomeworkItem {
  id:        string;
  title:     string;
  subject:   Subject;
  dueDate:   string;
  dueTime?:  string;
  priority:  Priority;
  status:    HWStatus;
  notes?:    string;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class HomeworkService {
  private readonly KEY = 'davai_homework';

  _items = signal<HomeworkItem[]>(
    this.storage.get<HomeworkItem[]>(this.KEY, [])
  );

  readonly items        = this._items.asReadonly();
  readonly pending      = computed(() => this._items().filter(i => i.status !== 'done'));
  readonly done         = computed(() => this._items().filter(i => i.status === 'done'));
  readonly overdue      = computed(() => this._items().filter(i => this.isOverdue(i)));
  readonly dueToday     = computed(() => this._items().filter(i => {
    if (i.status === 'done') return false;
    return i.dueDate === new Date().toISOString().slice(0, 10);
  }));
  readonly overdueCount = computed(() => this.overdue().length);

  constructor(
    private http:    HttpClient,
    private storage: StorageService,
    private auth:    AuthService,
  ) {
    // Sync from server on init if logged in
    if (this.auth.isLoggedIn()) this.syncFromServer();
  }

  // ── CRUD ─────────────────────────────────────────────────
  add(data: Omit<HomeworkItem, 'id' | 'createdAt' | 'updatedAt'>): void {
    const now  = new Date().toISOString();
    const item: HomeworkItem = {
      ...data,
      id:        crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this._items.update(list => [item, ...list]);
    this.persist();
    if (this.auth.isLoggedIn()) this.serverCreate(item);
  }

  update(id: string, data: Partial<HomeworkItem>): void {
    this._items.update(list => list.map(i =>
      i.id === id ? { ...i, ...data, updatedAt: new Date().toISOString() } : i
    ));
    this.persist();
    if (this.auth.isLoggedIn()) {
      const item = this._items().find(i => i.id === id);
      if (item) this.serverUpdate(id, item);
    }
  }

  remove(id: string): void {
    this._items.update(list => list.filter(i => i.id !== id));
    this.persist();
    if (this.auth.isLoggedIn()) this.serverDelete(id);
  }

  toggleStatus(id: string): void {
    const item = this._items().find(i => i.id === id);
    if (!item) return;
    const next: HWStatus =
      item.status === 'pending'     ? 'in_progress' :
      item.status === 'in_progress' ? 'done'         : 'pending';
    this.update(id, { status: next });
  }

  markDone(id: string): void { this.update(id, { status: 'done' }); }
  getById(id: string): HomeworkItem | undefined { return this._items().find(i => i.id === id); }

  // ── Helpers ──────────────────────────────────────────────
  isOverdue(item: HomeworkItem): boolean {
    if (item.status === 'done') return false;
    return item.dueDate < new Date().toISOString().slice(0, 10);
  }

  daysUntilDue(item: HomeworkItem): number {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due   = new Date(item.dueDate + 'T00:00:00');
    return Math.round((due.getTime() - today.getTime()) / 86400000);
  }

  dueDateLabel(item: HomeworkItem): string {
    const d = this.daysUntilDue(item);
    if (d < 0)  return `${Math.abs(d)}d overdue`;
    if (d === 0) return 'Due today';
    if (d === 1) return 'Due tomorrow';
    return `Due in ${d}d`;
  }

  // ── Server sync ──────────────────────────────────────────
  async syncFromServer(): Promise<void> {
    try {
      const items = await firstValueFrom(
        this.http.get<HomeworkItem[]>(`${environment.apiUrl}/homework`, { headers: this.headers() })
      );
      this._items.set(items);
      this.persist();
    } catch { /* stay offline */ }
  }

  async syncToServer(): Promise<void> {
    try {
      const items = await firstValueFrom(
        this.http.post<HomeworkItem[]>(
          `${environment.apiUrl}/homework/sync`,
          { items: this._items() },
          { headers: this.headers() }
        )
      );
      this._items.set(items);
      this.persist();
    } catch { /* stay offline */ }
  }

  private async serverCreate(item: HomeworkItem): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post<HomeworkItem>(`${environment.apiUrl}/homework`, item, { headers: this.headers() })
      );
    } catch {}
  }

  private async serverUpdate(id: string, item: HomeworkItem): Promise<void> {
    try {
      await firstValueFrom(
        this.http.patch<HomeworkItem>(`${environment.apiUrl}/homework/${id}`, item, { headers: this.headers() })
      );
    } catch {}
  }

  private async serverDelete(id: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.delete(`${environment.apiUrl}/homework/${id}`, { headers: this.headers() })
      );
    } catch {}
  }

  private headers(): HttpHeaders {
    const token = this.auth.token();
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }

  private persist(): void {
    this.storage.set(this.KEY, this._items());
  }
}