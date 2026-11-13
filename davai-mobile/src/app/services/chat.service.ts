import { Injectable, signal, computed } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { StorageService } from './storage.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

export type ChatMode = 'ib' | 'ielts' | 'tok' | 'ee' | 'general';

export const CHAT_MODES: { id: ChatMode; label: string; icon: string; ionicon: string; desc: string }[] = [
  { id: 'ib',      label: 'IB Diploma',     icon: '', ionicon: 'school-outline',        desc: 'IA, EE, CAS, subject help' },
  { id: 'ielts',   label: 'IELTS',          icon: '', ionicon: 'pencil-outline',         desc: 'Writing, Speaking, Reading' },
  { id: 'tok',     label: 'TOK',            icon: '', ionicon: 'bulb-outline',           desc: 'Theory of Knowledge' },
  { id: 'ee',      label: 'Extended Essay', icon: '', ionicon: 'document-text-outline',  desc: 'Research question & structure' },
  { id: 'general', label: 'General Study',  icon: '', ionicon: 'flash-outline',          desc: 'Any subject, any question' },
];

export interface ChatMessage {
  id:        string;
  role:      'user' | 'assistant';
  content:   string;
  timestamp: Date;
  mode:      ChatMode;
}

// Offline fallback responses per mode
const OFFLINE: Record<ChatMode, string[]> = {
  ib: [
    'For IB essays, always address the knowledge question directly and use real-world examples to support your claims.',
    'In your IA, make sure your research question is focused and measurable. Examiners reward specificity.',
    'The IB Extended Essay requires a clear argument throughout — every paragraph should link back to your research question.',
  ],
  ielts: [
    'For IELTS Task 2, structure your essay: introduction (paraphrase + thesis), 2 body paragraphs, conclusion.',
    'Use a range of cohesive devices in IELTS Writing — however, furthermore, in contrast — but avoid overusing them.',
    'In IELTS Speaking Part 2, use the 1 minute preparation time to jot down 3-4 key points.',
  ],
  tok: [
    'A strong TOK essay identifies a genuine knowledge question and explores it from multiple perspectives.',
    'Use "Areas of Knowledge" and "Ways of Knowing" to structure your TOK arguments.',
    'In TOK, real-life examples should illustrate your point — not just describe an event.',
  ],
  ee: [
    'Your Extended Essay research question should be specific, arguable, and researchable within 4,000 words.',
    'In the EE, criterion A (Focus) is worth 6 marks — make sure your introduction clearly states your argument.',
    'Use your supervisor meetings wisely — come prepared with questions and drafts.',
  ],
  general: [
    'Break complex problems into smaller parts and tackle each one systematically.',
    'Active recall is one of the most effective study techniques — test yourself instead of re-reading notes.',
    'Spaced repetition beats cramming. Review material at increasing intervals for long-term retention.',
  ],
};

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly HISTORY_KEY = 'davai_chat_history';
  private readonly MAX_HISTORY = 50;

  private _messages    = signal<ChatMessage[]>(
    this.storage.get<ChatMessage[]>(this.HISTORY_KEY, [])
  );
  private _isLoading   = signal(false);
  private _currentMode = signal<ChatMode>('general');

  readonly messages    = this._messages.asReadonly();
  readonly isLoading   = this._isLoading.asReadonly();
  readonly currentMode = this._currentMode.asReadonly();

  constructor(
    private http:    HttpClient,
    private storage: StorageService,
    private auth:    AuthService,
  ) {}

  setMode(mode: ChatMode): void { this._currentMode.set(mode); }

  async sendMessage(content: string): Promise<void> {
    const mode = this._currentMode();
    const userMsg: ChatMessage = {
      id:        crypto.randomUUID(),
      role:      'user',
      content,
      timestamp: new Date(),
      mode,
    };

    this._messages.update(msgs => [...msgs, userMsg]);
    this._isLoading.set(true);

    try {
      const reply = await this.callApi(content, mode);
      const assistantMsg: ChatMessage = {
        id:        crypto.randomUUID(),
        role:      'assistant',
        content:   reply,
        timestamp: new Date(),
        mode,
      };
      this._messages.update(msgs => [...msgs, assistantMsg]);
    } catch {
      const fallbacks = OFFLINE[mode];
      const fallback  = fallbacks[Math.floor(Math.random() * fallbacks.length)];
      const offlineMsg: ChatMessage = {
        id:        crypto.randomUUID(),
        role:      'assistant',
        content:   fallback + '\n\n*(Offline — connect server for live AI)*',
        timestamp: new Date(),
        mode,
      };
      this._messages.update(msgs => [...msgs, offlineMsg]);
    } finally {
      this._isLoading.set(false);
      this.persistHistory();
    }
  }

  private async callApi(message: string, mode: ChatMode): Promise<string> {
    const history = this._messages().slice(-10).map(m => ({
      role:    m.role,
      content: m.content,
    }));

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.auth.token();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${environment.apiUrl}/chat`, {
      method:  'POST',
      headers,
      body: JSON.stringify({ message, mode, history }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.content ?? data.message ?? data.reply ?? 'No response.';
  }

  clearHistory(): void {
    this._messages.set([]);
    this.storage.remove(this.HISTORY_KEY);
  }

  private persistHistory(): void {
    const trimmed = this._messages().slice(-this.MAX_HISTORY);
    this._messages.set(trimmed);
    this.storage.set(this.HISTORY_KEY, trimmed);
  }
}