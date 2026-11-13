import { Component, ViewChild, ElementRef, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { marked } from 'marked';
import {
  IonContent, IonHeader, IonToolbar,
  IonIcon, IonSpinner,
  AlertController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  trashOutline, arrowUp,
  schoolOutline, pencilOutline, bulbOutline,
  documentTextOutline, flashOutline,
} from 'ionicons/icons';
import { ChatService, CHAT_MODES, ChatMode } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-chat',
  templateUrl: 'chat.page.html',
  styleUrls: ['chat.page.scss'],
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonHeader, IonToolbar,
    IonIcon, IonSpinner,
  ],
})
export class ChatPage {
  @ViewChild('scrollEnd') scrollEnd!: ElementRef;

  inputText    = '';
  inputFocused = false;
  chatModes    = CHAT_MODES;

  readonly messages    = this.chatSvc.messages;
  readonly isLoading   = this.chatSvc.isLoading;
  readonly currentMode = this.chatSvc.currentMode;
  readonly initials    = this.auth.userInitials;

  constructor(
    public chatSvc: ChatService,
    private auth: AuthService,
    private alertCtrl: AlertController,
    private sanitizer: DomSanitizer,
  ) {
    addIcons({
      trashOutline, arrowUp,
      schoolOutline, pencilOutline, bulbOutline,
      documentTextOutline, flashOutline,
    });
    effect(() => {
      const _ = this.messages();
      setTimeout(() => this.scrollToBottom(), 80);
    });
  }

  setMode(id: ChatMode): void { this.chatSvc.setMode(id); }

  async send(): Promise<void> {
    const text = this.inputText.trim();
    if (!text || this.isLoading()) return;
    this.inputText = '';
    await this.chatSvc.sendMessage(text);
  }

  async quickSend(text: string): Promise<void> {
    this.inputText = text;
    await this.send();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  async clearChat(): Promise<void> {
    const a = await this.alertCtrl.create({
      header: 'Clear Chat',
      message: 'Delete all messages?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Clear', role: 'destructive', handler: () => this.chatSvc.clearHistory() },
      ],
    });
    await a.present();
  }

  getCurrentModeLabel():   string { return this.chatModes.find(m => m.id === this.currentMode())?.label ?? 'Study Assistant'; }
  getCurrentModeIonicon(): string { return this.chatModes.find(m => m.id === this.currentMode())?.ionicon ?? 'flash-outline'; }

  formatTime(date: Date): string {
    return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private scrollToBottom(): void {
    try { this.scrollEnd?.nativeElement?.scrollIntoView({ behavior: 'smooth' }); } catch {}
  }

  renderMarkdown(content: string): SafeHtml {
    const html = marked.parse(content, { async: false }) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  trackById(_: number, m: any): string { return m.id; }
}