import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  mailOutline, lockClosedOutline, eyeOutline, eyeOffOutline,
  alertCircleOutline, chevronBack,
} from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: 'login.page.html',
  styleUrls: ['login.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonIcon, IonSpinner],
})
export class LoginPage {
  email       = '';
  password    = '';
  showPw      = false;
  emailFocused = false;
  pwFocused    = false;
  loading     = signal(false);
  error       = signal('');

  constructor(private router: Router, private auth: AuthService) {
    addIcons({ mailOutline, lockClosedOutline, eyeOutline, eyeOffOutline, alertCircleOutline, chevronBack });
  }

  togglePw(): void { this.showPw = !this.showPw; }

  async submit(): Promise<void> {
    this.error.set('');
    if (!this.email || !this.password) {
      this.error.set('Please enter your email and password.');
      return;
    }
    this.loading.set(true);
    try {
      await this.auth.login(this.email, this.password).toPromise();
      this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
    } catch (e: any) {
      this.error.set(e?.error?.message ?? 'Login failed. Check your credentials.');
    } finally {
      this.loading.set(false);
    }
  }

  goToRegister():    void { this.router.navigateByUrl('/register'); }
  goBack():          void { this.router.navigateByUrl('/onboarding'); }
  continueAsGuest(): void {
    this.auth.loginAsGuest();
    this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
  }
}