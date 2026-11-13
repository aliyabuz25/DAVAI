import { Component, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonHeader, IonToolbar, IonIcon, IonSpinner, ToastController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { chevronBack, copyOutline, checkmarkCircle, alertCircleOutline } from 'ionicons/icons';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

export interface Plan {
  id: string;
  name: string;
  price: string;
  period: string;
  usd: number;
}

const PLANS: Plan[] = [
  { id: 'pro',     name: 'Pro',     price: '$4',  period: '/month', usd: 4  },
  { id: 'pro_max', name: 'Pro Max', price: '$8',  period: '/month', usd: 8  },
];

@Component({
  selector: 'app-payment',
  templateUrl: 'payment.page.html',
  styleUrls: ['payment.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonHeader, IonToolbar, IonIcon, IonSpinner],
})
export class PaymentPage {
  plan: Plan = PLANS[0];

  // Alıcı bilgileri — sunucudan dinamik yüklenir, çevrimdışı için yerel yedekli
  recipient = {
    name:     'David Salahov',
    bank:     'Kapital Bank',
    card:     '4169 7388 1234 5678',
    iban:     'AZ21 AIIB 0000 0000 1234 5678 901',
    currency: 'AZN',
    note:     'DAVAI Pro — ',
  };

  step = signal<'info' | 'confirm'>('info');
  senderName  = '';
  senderRef   = '';
  loading     = signal(false);
  copied      = signal('');

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private toast: ToastController,
    private http: HttpClient,
    private auth: AuthService,
  ) {
    addIcons({ chevronBack, copyOutline, checkmarkCircle, alertCircleOutline });

    const planId = this.route.snapshot.queryParamMap.get('plan') ?? 'pro';
    this.plan = PLANS.find(p => p.id === planId) ?? PLANS[0];

    // Sunucudan güncel banka bilgilerini dinamik al
    this.http.get<any>(`${environment.apiUrl}/payment/recipient-info`).subscribe({
      next: (info) => {
        if (info && info.card) {
          this.recipient = {
            name:     info.name     || this.recipient.name,
            bank:     info.bank     || this.recipient.bank,
            card:     info.card     || this.recipient.card,
            iban:     info.iban     || this.recipient.iban,
            currency: info.currency || this.recipient.currency,
            note:     info.note     || this.recipient.note,
          };
        }
      },
      error: () => {}
    });
  }

  async copy(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(label);
      setTimeout(() => this.copied.set(''), 2000);
      const t = await this.toast.create({ message: `${label} copied`, duration: 1400, position: 'bottom' });
      await t.present();
    } catch {}
  }

  goNext(): void {
    if (!this.senderName.trim()) return;
    this.step.set('confirm');
  }

  async submitConfirm(): Promise<void> {
    if (!this.senderName.trim()) return;
    this.loading.set(true);
    try {
      await firstValueFrom(
        this.http.post(`${environment.apiUrl}/payment/submit`, {
          planId:     this.plan.id,
          senderName: this.senderName.trim(),
          senderRef:  this.senderRef.trim() || null,
          userId:     this.auth.user()?.id || null,
        })
      );
      this.loading.set(false);
      this.router.navigateByUrl('/payment-done', { replaceUrl: false });
    } catch (err: any) {
      this.loading.set(false);
      const msg = err.error?.message || 'Payment submission failed. Please try again.';
      const t = await this.toast.create({
        message: msg,
        duration: 2500,
        position: 'bottom',
        color: 'danger',
      });
      await t.present();
    }
  }

  goBack(): void {
    if (this.step() === 'confirm') { this.step.set('info'); return; }
    this.location.back();
  }

  get transferNote(): string {
    return `${this.recipient.note}${this.plan.name}`;
  }
}