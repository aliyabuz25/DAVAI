import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircle } from 'ionicons/icons';

@Component({
  selector: 'app-payment-done',
  templateUrl: 'payment-done.page.html',
  styleUrls: ['payment-done.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonIcon],
})
export class PaymentDonePage {
  constructor(private router: Router) {
    addIcons({ checkmarkCircle });
  }
  goHome(): void { this.router.navigateByUrl('/tabs/profile', { replaceUrl: true }); }
}