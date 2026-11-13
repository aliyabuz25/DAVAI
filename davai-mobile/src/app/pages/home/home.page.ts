import { Component, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  IonContent, IonHeader, IonToolbar,
  IonRefresher, IonRefresherContent, IonIcon,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  calendarOutline, warningOutline, layersOutline,
  chevronForward, checkmarkCircleOutline,
  timerOutline, textOutline, listOutline, radioOutline,
  sparklesOutline, bookOutline, pencilOutline, documentTextOutline, flashOutline,
  bulbOutline, closeOutline,
} from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';
import { HomeworkService } from '../../services/homework.service';
import { ChatService, CHAT_MODES } from '../../services/chat.service';
import { environment } from '../../../environments/environment';

export interface Announcement {
  active: boolean;
  id?: string;
  title?: string;
  message?: string;
  type?: 'info' | 'warning' | 'success';
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent, IonHeader, IonToolbar,
    IonRefresher, IonRefresherContent, IonIcon,
  ],
})
export class HomePage {
  readonly user      = this.auth.user;
  readonly initials  = this.auth.userInitials;
  readonly planLabel = this.auth.planLabel;
  chatModes          = CHAT_MODES;

  announcement = signal<Announcement | null>(null);

  greeting = computed(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  });

  recentTasks = computed(() => this.hw.pending().slice(0, 4));

  constructor(
    public hw: HomeworkService,
    private auth: AuthService,
    private chat: ChatService,
    private router: Router,
    private http: HttpClient,
  ) {
    addIcons({
      calendarOutline, warningOutline, layersOutline,
      chevronForward, checkmarkCircleOutline,
      timerOutline, textOutline, listOutline, radioOutline,
      sparklesOutline, bookOutline, pencilOutline, documentTextOutline, flashOutline,
      bulbOutline, closeOutline,
    });

    this.fetchAnnouncement();
  }

  fetchAnnouncement(): void {
    this.http.get<Announcement>(`${environment.apiUrl}/config/announcement`).subscribe({
      next: (data) => {
        if (data && data.active && data.title) {
          this.announcement.set(data);
        } else {
          this.announcement.set(null);
        }
      },
      error: () => this.announcement.set(null),
    });
  }

  dismissAnnouncement(): void {
    this.announcement.set(null);
  }

  refresh(event: any): void {
    this.fetchAnnouncement();
    this.hw.syncFromServer().finally(() => {
      setTimeout(() => event.target.complete(), 400);
    });
  }

  goToChat(modeId: string): void {
    this.chat.setMode(modeId as any);
    this.router.navigateByUrl('/tabs/chat');
  }

  goToHomework(): void { this.router.navigateByUrl('/tabs/homework'); }
  goToTools():    void { this.router.navigateByUrl('/tabs/tools'); }

  dueDateLabel(item: any): string { return this.hw.dueDateLabel(item); }
  isOverdue(item: any):    boolean { return this.hw.isOverdue(item); }
}
