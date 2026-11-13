import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowForward } from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';

interface Slide {
  emoji3d:  string;
  title:    string;
  subtitle: string;
}

@Component({
  selector: 'app-onboarding',
  templateUrl: 'onboarding.page.html',
  styleUrls: ['onboarding.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon],
})
export class OnboardingPage {
  currentSlide = 0;

  // Fluent Emoji 3D from Microsoft CDN
  private readonly EMOJI_BASE = 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@latest/assets';

  slides: Slide[] = [
    {
      emoji3d:  `${this.EMOJI_BASE}/Sparkles/3D/sparkles_3d.png`,
      title:    'Study Smarter',
      subtitle: 'DAVAI is a free AI study companion built for IB Diploma and IELTS students.',
    },
    {
      emoji3d:  `${this.EMOJI_BASE}/Books/3D/books_3d.png`,
      title:    'IB & IELTS Ready',
      subtitle: 'Criteria-aligned feedback on TOK, Extended Essay, IA, and IELTS writing — without doing the work for you.',
    },
    {
      emoji3d:  `${this.EMOJI_BASE}/Check%20Mark%20Button/3D/check_mark_button_3d.png`,
      title:    'Track Every Deadline',
      subtitle: 'Homework tracker with subjects, priorities, and overdue alerts so nothing slips through.',
    },
    {
      emoji3d:  `${this.EMOJI_BASE}/Rocket/3D/rocket_3d.png`,
      title:    'Free. Forever.',
      subtitle: 'No paywalls, no signup required. Start now as a guest or create a free account.',
    },
  ];

  constructor(private router: Router, private auth: AuthService) {
    addIcons({ arrowForward });
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
    }
  }

  next(): void { if (this.currentSlide < this.slides.length - 1) this.currentSlide++; }
  goTo(i: number): void { this.currentSlide = i; }

  goToLogin():    void { this.router.navigateByUrl('/login'); }
  goToRegister(): void { this.router.navigateByUrl('/register'); }

  continueAsGuest(): void {
    this.auth.loginAsGuest();
    this.router.navigateByUrl('/tabs/home', { replaceUrl: true });
  }

  get isLast(): boolean { return this.currentSlide === this.slides.length - 1; }
}