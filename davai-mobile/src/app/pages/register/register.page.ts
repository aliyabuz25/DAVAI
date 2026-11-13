import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  personOutline, mailOutline, lockClosedOutline,
  eyeOutline, eyeOffOutline, alertCircleOutline, chevronBack,
} from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  templateUrl: 'register.page.html',
  styleUrls: ['register.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonIcon, IonSpinner],
})
export class RegisterPage {
  name          = '';
  email         = '';
  password      = '';
  program       = 'IB';
  showPw        = false;
  nameFocused   = false;
  emailFocused  = false;
  pwFocused     = false;
  loading       = signal(false);
  error         = signal('');
  programs      = ['IB', 'IELTS', 'Both'];

  constructor(private router: Router, private auth: AuthService) {
    addIcons({ personOutline, mailOutline, lockClosedOutline, eyeOutline, eyeOffOutline, alertCircleOutline, chevronBack });
  }

  togglePw(): void { this.showPw = !this.showPw; }

  async submit(): Promise<void> {
    this.error.set('');
    if (!this.name.trim())        { this.error.set('Please enter your name.'); return; }
    if (!this.email)               { this.error.set('Please enter your email.'); return; }
    if (this.password.length < 6)  { this.error.set('Password must be at least 6 characters.'); return; }
    this.loading.set(true);
    try {
      await this.auth.register(this.name, this.email, this.password, this.program).toPromise();
      this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
    } catch (e: any) {
      this.error.set(e?.error?.message ?? 'Registration failed. Try again.');
    } finally {
      this.loading.set(false);
    }
  }

  goToLogin():       void { this.router.navigateByUrl('/login'); }
  goBack():          void { this.router.navigateByUrl('/onboarding'); }
  continueAsGuest(): void {
    this.auth.loginAsGuest();
    this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
  }
}