import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonToolbar, IonIcon,
  IonFab, IonFabButton, IonModal,
  IonRefresher, IonRefresherContent,
  AlertController, ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  add, createOutline, trashOutline,
  checkmarkCircle, timeOutline, ellipseOutline,
  checkmarkDoneOutline, close,
} from 'ionicons/icons';
import { HomeworkService, HomeworkItem, Subject, Priority, HWStatus } from '../../services/homework.service';

type FilterTab = 'pending' | 'done' | 'all';

@Component({
  selector: 'app-homework',
  templateUrl: 'homework.page.html',
  styleUrls: ['homework.page.scss'],
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonHeader, IonToolbar, IonIcon,
    IonFab, IonFabButton, IonModal,
    IonRefresher, IonRefresherContent,
  ],
})
export class HomeworkPage {
  filterTab = signal<FilterTab>('pending');
  showModal = signal(false);
  editingId = signal<string | null>(null);

  form = {
    title: '', subject: 'Mathematics' as Subject,
    dueDate: '', dueTime: '', priority: 'medium' as Priority,
    status: 'pending' as HWStatus, notes: '',
  };

  subjects: Subject[] = [
    'Mathematics','Physics','Chemistry','Biology','English',
    'History','Economics','Geography','Computer Science',
    'Psychology','Art','TOK','EE','Other',
  ];
  priorities = [
    { value: 'low' as Priority, label: 'Low' },
    { value: 'medium' as Priority, label: 'Medium' },
    { value: 'high' as Priority, label: 'High' },
  ];
  statuses = [
    { value: 'pending' as HWStatus, label: 'Pending' },
    { value: 'in_progress' as HWStatus, label: 'In Progress' },
    { value: 'done' as HWStatus, label: 'Done' },
  ];

  readonly overdueCount  = this.hw.overdueCount;
  filteredItems = computed(() => {
    const tab = this.filterTab();
    const all = this.hw.items();
    if (tab === 'pending') return all.filter(i => i.status !== 'done');
    if (tab === 'done')    return all.filter(i => i.status === 'done');
    return all;
  });

  constructor(
    public hw: HomeworkService,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
  ) {
    addIcons({ add, createOutline, trashOutline, checkmarkCircle, timeOutline, ellipseOutline, checkmarkDoneOutline, close });
    this.form.dueDate = new Date().toISOString().slice(0, 10);
  }

  setFilter(tab: FilterTab): void { this.filterTab.set(tab); }

  openAdd(): void {
    this.editingId.set(null);
    this.form = {
      title: '', subject: 'Mathematics', priority: 'medium',
      status: 'pending', notes: '',
      dueDate: new Date().toISOString().slice(0, 10), dueTime: '',
    };
    this.showModal.set(true);
  }

  openEdit(item: HomeworkItem): void {
    this.editingId.set(item.id);
    this.form = { title: item.title, subject: item.subject, dueDate: item.dueDate,
      dueTime: item.dueTime ?? '', priority: item.priority, status: item.status, notes: item.notes ?? '' };
    this.showModal.set(true);
  }

  closeModal(): void { this.showModal.set(false); }

  save(): void {
    if (!this.form.title.trim()) return;
    const id = this.editingId();
    if (id) { this.hw.update(id, { ...this.form }); }
    else     { this.hw.add({ ...this.form }); }
    this.showModal.set(false);
    this.toast(id ? 'Task updated' : 'Task added');
  }

  toggleStatus(item: HomeworkItem): void { this.hw.toggleStatus(item.id); }

  async deleteItem(item: HomeworkItem): Promise<void> {
    const a = await this.alertCtrl.create({
      header: 'Delete Task',
      message: `Delete "${item.title}"?`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive', handler: () => { this.hw.remove(item.id); this.toast('Deleted'); } },
      ],
    });
    await a.present();
  }

  refresh(ev: any): void { setTimeout(() => ev.target.complete(), 600); }

  dueDateLabel(i: HomeworkItem): string { return this.hw.dueDateLabel(i); }
  isOverdue(i: HomeworkItem):    boolean { return this.hw.isOverdue(i); }
  trackById(_: number, i: HomeworkItem): string { return i.id; }
  get modalTitle(): string { return this.editingId() ? 'Edit Task' : 'New Task'; }

  private async toast(msg: string): Promise<void> {
    const t = await this.toastCtrl.create({ message: msg, duration: 1600, position: 'bottom' });
    await t.present();
  }
}