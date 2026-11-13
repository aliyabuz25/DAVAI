import { Component, signal, computed, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonHeader, IonToolbar, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  timerOutline, textOutline, listOutline, radioOutline,
  informationCircleOutline, bulbOutline,
  refreshOutline, play, pause,
  chevronBack, chevronForward,
} from 'ionicons/icons';

type TimerState = 'idle' | 'work' | 'break';

interface VocabWord {
  word: string; type: string; definition: string; example: string; ib: boolean; ielts: boolean;
}

const VOCAB: VocabWord[] = [
  { word: 'Corroborate',  type: 'verb', definition: 'To confirm or give support to a statement or theory', example: 'The evidence corroborates the initial hypothesis.', ib: true, ielts: true },
  { word: 'Epistemology', type: 'noun', definition: 'The branch of philosophy concerned with knowledge', example: 'TOK is essentially a study of epistemology.', ib: true, ielts: false },
  { word: 'Ambiguous',    type: 'adj',  definition: 'Open to more than one interpretation; unclear', example: 'The data is ambiguous and requires further analysis.', ib: true, ielts: true },
  { word: 'Ubiquitous',   type: 'adj',  definition: 'Present, appearing, or found everywhere', example: 'Smartphones have become ubiquitous in modern society.', ib: false, ielts: true },
  { word: 'Pragmatic',    type: 'adj',  definition: 'Dealing with things sensibly and realistically', example: 'A pragmatic approach to policy-making is essential.', ib: true, ielts: true },
  { word: 'Mitigate',     type: 'verb', definition: 'To make less severe, serious, or painful', example: 'Renewable energy can mitigate the effects of climate change.', ib: true, ielts: true },
  { word: 'Paradigm',     type: 'noun', definition: 'A typical example or pattern; a framework', example: 'This discovery represents a paradigm shift in biology.', ib: true, ielts: true },
  { word: 'Juxtapose',    type: 'verb', definition: 'To place side by side to highlight contrasts', example: 'The author juxtaposes wealth and poverty effectively.', ib: true, ielts: true },
  { word: 'Extrapolate',  type: 'verb', definition: 'To extend known data into unknown areas', example: 'We can extrapolate future trends from this data.', ib: true, ielts: false },
  { word: 'Dichotomy',    type: 'noun', definition: 'A division or contrast between two things', example: 'There is a dichotomy between theory and practice.', ib: true, ielts: true },
  { word: 'Proliferate',  type: 'verb', definition: 'To increase rapidly in number', example: 'Social media platforms have proliferated in recent years.', ib: false, ielts: true },
  { word: 'Substantiate', type: 'verb', definition: 'To provide evidence to prove the truth of', example: 'You must substantiate your claims with evidence.', ib: true, ielts: true },
  { word: 'Nuanced',      type: 'adj',  definition: 'Having subtle distinctions; not simplistic', example: 'A nuanced argument considers multiple perspectives.', ib: true, ielts: true },
  { word: 'Consensus',    type: 'noun', definition: 'General agreement among a group', example: 'There is a scientific consensus on climate change.', ib: true, ielts: true },
  { word: 'Scepticism',   type: 'noun', definition: 'A doubtful or questioning attitude', example: 'Healthy scepticism is vital in scientific inquiry.', ib: true, ielts: false },
];

const IB_CRITERIA: Record<string, { criteria: string[]; maxMarks: number }> = {
  'TOK Essay': {
    criteria: ['Understanding Knowledge Questions (10)', 'Quality of Analysis (10)', 'Connections and Implications (10)', 'Organisation and Argument (10)'],
    maxMarks: 10,
  },
  'Extended Essay': {
    criteria: ['Focus and Method (6)', 'Knowledge and Understanding (6)', 'Critical Thinking (12)', 'Presentation (4)', 'Engagement (6)'],
    maxMarks: 34,
  },
  'Internal Assessment': {
    criteria: ['Personal Engagement (2)', 'Exploration (6)', 'Analysis (6)', 'Evaluation (6)', 'Communication (4)'],
    maxMarks: 24,
  },
  'IELTS Writing Task 2': {
    criteria: ['Task Achievement (25%)', 'Coherence and Cohesion (25%)', 'Lexical Resource (25%)', 'Grammatical Range and Accuracy (25%)'],
    maxMarks: 9,
  },
};

@Component({
  selector: 'app-tools',
  templateUrl: 'tools.page.html',
  styleUrls: ['tools.page.scss'],
  standalone: true,
  imports: [CommonModule, IonContent, IonHeader, IonToolbar, IonIcon],
})
export class ToolsPage implements OnDestroy {
  readonly Math = Math;

  activeTab = signal<'timer' | 'vocab' | 'criteria' | 'podcasts'>('timer');

  // ── Timer ─────────────────────────────────────────────────
  workMins  = 25;
  breakMins = 5;
  timerState  = signal<TimerState>('idle');
  secondsLeft = signal(25 * 60);
  cycle       = signal(0);
  private _interval: any = null;

  timerDisplay = computed(() => {
    const s = this.secondsLeft();
    return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  });

  timerProgress = computed(() => {
    const total = (this.timerState() === 'break' ? this.breakMins : this.workMins) * 60;
    return 1 - this.secondsLeft() / total;
  });

  // ── Vocab ─────────────────────────────────────────────────
  vocabFilter  = signal<'all' | 'ib' | 'ielts'>('all');
  vocabIndex   = signal(0);
  showVocabDef = signal(false);

  filteredVocab = computed(() => {
    const f = this.vocabFilter();
    if (f === 'ib')    return VOCAB.filter(v => v.ib);
    if (f === 'ielts') return VOCAB.filter(v => v.ielts);
    return VOCAB;
  });

  currentWord = computed(() => {
    const list = this.filteredVocab();
    return list[this.vocabIndex() % Math.max(list.length, 1)] ?? VOCAB[0];
  });

  // ── Criteria ─────────────────────────────────────────────
  criteriaKeys = Object.keys(IB_CRITERIA);
  selectedCrit = signal('TOK Essay');
  currentCrit  = computed(() => IB_CRITERIA[this.selectedCrit()]);

  // ── Podcasts ─────────────────────────────────────────────
  podcasts = [
    { title: 'TOK Explained: Ways of Knowing',       duration: '18 min', topic: 'TOK',   ionicon: 'bulb-outline' },
    { title: 'IELTS Band 7+ Writing Strategies',     duration: '22 min', topic: 'IELTS', ionicon: 'pencil-outline' },
    { title: 'Extended Essay: Getting Started',       duration: '15 min', topic: 'EE',    ionicon: 'document-text-outline' },
    { title: 'IB Maths IA: Choosing Your Topic',     duration: '20 min', topic: 'IA',    ionicon: 'calculator-outline' },
    { title: 'Revision Techniques That Work',        duration: '12 min', topic: 'Study', ionicon: 'flash-outline' },
    { title: 'TOK Exhibition: Object Selection',     duration: '16 min', topic: 'TOK',   ionicon: 'image-outline' },
  ];

  constructor() {
    addIcons({
      timerOutline, textOutline, listOutline, radioOutline,
      informationCircleOutline, bulbOutline,
      refreshOutline, play, pause,
      chevronBack, chevronForward,
    });
  }

  // Timer
  startTimer(): void {
    if (this._interval) return;
    if (this.timerState() === 'idle') this.timerState.set('work');
    if (this.secondsLeft() === 0)
      this.secondsLeft.set(this.timerState() === 'work' ? this.workMins * 60 : this.breakMins * 60);

    this._interval = setInterval(() => {
      const s = this.secondsLeft();
      if (s <= 1) {
        clearInterval(this._interval); this._interval = null;
        const next: TimerState = this.timerState() === 'work' ? 'break' : 'work';
        this.timerState.set(next);
        this.secondsLeft.set(next === 'work' ? this.workMins * 60 : this.breakMins * 60);
        if (next === 'work') this.cycle.update(c => c + 1);
      } else {
        this.secondsLeft.update(v => v - 1);
      }
    }, 1000);
  }

  pauseTimer(): void { clearInterval(this._interval); this._interval = null; }

  resetTimer(): void {
    this.pauseTimer();
    this.timerState.set('idle');
    this.secondsLeft.set(this.workMins * 60);
    this.cycle.set(0);
  }

  get timerRunning(): boolean { return !!this._interval; }

  // Vocab
  nextWord(): void {
    this.showVocabDef.set(false);
    this.vocabIndex.update(i => (i + 1) % this.filteredVocab().length);
  }
  prevWord(): void {
    this.showVocabDef.set(false);
    const max = this.filteredVocab().length;
    this.vocabIndex.update(i => (i - 1 + max) % max);
  }
  flipCard(): void { this.showVocabDef.update(v => !v); }
  setVocabFilter(f: 'all' | 'ib' | 'ielts'): void {
    this.vocabFilter.set(f); this.vocabIndex.set(0); this.showVocabDef.set(false);
  }

  ngOnDestroy(): void { this.pauseTimer(); }
}