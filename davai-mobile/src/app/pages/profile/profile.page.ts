import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  IonContent, IonHeader, IonToolbar, IonIcon,
  AlertController, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  checkmarkOutline, logInOutline, logOutOutline,
  trashOutline, chevronForward,
} from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';
import { HomeworkService } from '../../services/homework.service';
import { ChatService } from '../../services/chat.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-profile',
  templateUrl: 'profile.page.html',
  styleUrls: ['profile.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonHeader, IonToolbar, IonIcon],
})
export class ProfilePage {
  readonly user       = this.auth.user;
  readonly initials   = this.auth.userInitials;
  readonly planLabel  = this.auth.planLabel;
  readonly isLoggedIn = this.auth.isLoggedIn;

  showProModal = signal(false);
  proCode      = '';

  stats = { totalTasks: 0, completedTasks: 0, chatMessages: 0 };

  plans = [
    {
      id: 'free', name: 'Free', price: '$0', period: 'forever',
      features: ['AI Study Assistant', '10 messages/hour', 'Homework Tracker', 'Vocab Cards', 'Pomodoro Timer'],
    },
    {
      id: 'pro', name: 'Pro', price: '$4', period: '/month',
      features: ['Everything in Free', 'Unlimited AI messages', 'All study modes', 'Priority responses', 'Export notes'],
    },
    {
      id: 'pro_max', name: 'Pro Max', price: '$8', period: '/month',
      features: ['Everything in Pro', 'Advanced analytics', 'Parent portal', 'Email digest', 'Early features'],
    },
  ];

  constructor(
    private auth: AuthService,
    private hw: HomeworkService,
    private chat: ChatService,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private http: HttpClient,
  ) {
    addIcons({ checkmarkOutline, logInOutline, logOutOutline, trashOutline, chevronForward });
    this.loadStats();
    if (this.auth.isLoggedIn()) {
      this.auth.refreshProfile().subscribe({ error: () => {} });
    }
  }

  loadStats(): void {
    this.stats.totalTasks     = this.hw.items().length;
    this.stats.completedTasks = this.hw.done().length;
    this.stats.chatMessages   = this.chat.messages().length;
    if (this.auth.isLoggedIn()) {
      this.auth.refreshProfile().subscribe({ error: () => {} });
    }
  }

  get completionRate(): number {
    if (!this.stats.totalTasks) return 0;
    return Math.round((this.stats.completedTasks / this.stats.totalTasks) * 100);
  }

  goToPayment(planId: string): void {
    this.router.navigateByUrl(`/payment?plan=${planId}`);
  }

  async redeemProCode(): Promise<void> {
    const code = this.proCode.trim();
    if (!code) {
      this.toast('Please enter a pro code', 'danger');
      return;
    }
    try {
      const res: any = await firstValueFrom(
        this.http.post(
          `${environment.apiUrl}/payment/redeem`,
          { code, userId: this.auth.user()?.id },
          { headers: this.auth.getAuthHeaders() }
        )
      );
      if (res && res.ok) {
        if (res.user) {
          this.auth.updateUser(res.user);
        } else {
          this.auth.updateUser({ plan: res.plan || 'pro' });
        }
        this.proCode = '';
        this.toast(res.message || 'Pro plan activated!', 'success');
        this.loadStats();
      }
    } catch (err: any) {
      const msg = err.error?.message || 'Invalid or already used code.';
      this.toast(msg, 'danger');
    }
  }

  async confirmLogout(): Promise<void> {
    const a = await this.alertCtrl.create({
      header: 'Sign Out',
      message: 'Are you sure?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Sign Out', role: 'destructive', handler: () => this.doLogout() },
      ],
    });
    await a.present();
  }

  doLogout(): void {
    this.auth.logout();
    this.router.navigateByUrl('/onboarding', { replaceUrl: true });
  }

  goToLogin(): void { this.router.navigateByUrl('/login'); }

  async clearAllData(): Promise<void> {
    const a = await this.alertCtrl.create({
      header: 'Clear All Data',
      message: 'This deletes all local homework and chat history. Cannot be undone.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Clear',
          role: 'destructive',
          handler: () => {
            this.chat.clearHistory();
            (this.hw as any)['_items'].set([]);
            (this.hw as any)['storage'].remove('davai_homework');
            this.loadStats();
            this.toast('All data cleared');
          },
        },
      ],
    });
    await a.present();
  }

  private async toast(msg: string, color = 'success'): Promise<void> {
    const t = await this.toastCtrl.create({ message: msg, duration: 1800, position: 'bottom', color });
    await t.present();
  }
}