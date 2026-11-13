import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'onboarding',
    pathMatch: 'full',
  },
  {
    path: 'onboarding',
    loadComponent: () =>
      import('./pages/onboarding/onboarding.page').then(m => m.OnboardingPage),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.page').then(m => m.LoginPage),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./pages/register/register.page').then(m => m.RegisterPage),
  },
  {
    path: 'tabs',
    loadComponent: () =>
      import('./tabs/tabs.page').then(m => m.TabsPage),
    children: [
      {
        path: 'home',
        loadComponent: () =>
          import('./pages/home/home.page').then(m => m.HomePage),
      },
      {
        path: 'chat',
        loadComponent: () =>
          import('./pages/chat/chat.page').then(m => m.ChatPage),
      },
      {
        path: 'homework',
        loadComponent: () =>
          import('./pages/homework/homework.page').then(m => m.HomeworkPage),
      },
      {
        path: 'tools',
        loadComponent: () =>
          import('./pages/tools/tools.page').then(m => m.ToolsPage),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./pages/profile/profile.page').then(m => m.ProfilePage),
      },
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: 'payment',
    loadComponent: () =>
      import('./pages/payment/payment.page').then(m => m.PaymentPage),
  },
  {
    path: 'payment-done',
    loadComponent: () =>
      import('./pages/payment-done/payment-done.page').then(m => m.PaymentDonePage),
  },
  {
    path: '**',
    redirectTo: 'tabs',
  },
];