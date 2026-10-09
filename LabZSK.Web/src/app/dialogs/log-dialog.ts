import { ChangeDetectionStrategy, Component, ElementRef, computed, signal, viewChild } from '@angular/core';

type LineKind = 'mistake' | 'auto' | 'change' | 'cycle' | 'mode' | 'plain';

const ICON: Record<LineKind, string> = { mistake: '✗', auto: 'A', change: '±', cycle: '', mode: '▶', plain: '' };

/** Classifies log lines the same way the original coloured them (SimView.ShowLog). */
function classify(line: string): LineKind {
  if (
    /Błąd\(|BŁĄD KRYTYCZNY|Edycja ustawień dozwolona|nie jest w trybie dla studenta|==Wznowienie|^==[^=].*==$/.test(
      line,
    )
  )
    return 'mistake';
  if (/^\s*AUTO:/.test(line)) return 'auto';
  if (/-zmiana->|==Zmiana ustawień/.test(line)) return 'change';
  if (/^={6}|CEA|RRC|CWC|IWC|END/.test(line)) return 'cycle';
  if (/^(MAKRO|MIKRO)$|^={8}/.test(line)) return 'mode';
  return 'plain';
}

/** Log viewer ("Pokaż log"). */
@Component({
  selector: 'app-log-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dialog log">
      <h2>Podgląd logu</h2>
      @if (valid() === false) {
        <p class="banner error">✗ Log pracy programu jest niespójny – plik został zmodyfikowany.</p>
      } @else if (valid() === true) {
        <p class="banner ok">✓ Suma kontrolna logu jest poprawna.</p>
      }
      <label class="check"
        ><input type="checkbox" [checked]="onlyMarked()" (change)="onlyMarked.set(!onlyMarked())" /> Pokaż tylko
        wyróżnione wiersze (błędy, zmiany, AUTO)</label
      >
      <div class="legend">
        <span class="mistake">✗ błąd / ostrzeżenie</span>
        <span class="change">± ręczna zmiana</span>
        <span class="auto">A przebieg automatyczny</span>
        <span class="cycle">cykl / operacje pamięci</span>
      </div>
      <pre
        class="lines"
      >@for (l of visible(); track $index) {<span [class]="l.kind"><i aria-hidden="true">{{ l.icon }}</i>{{ l.text }}
</span>}</pre>
      <div class="actions">
        <button type="button" class="primary" (click)="dlg.close()">Zamknij</button>
      </div>
    </dialog>
  `,
})
export class LogDialog {
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly text = signal('');
  protected readonly valid = signal<boolean | null>(null);
  protected readonly onlyMarked = signal(false);
  private readonly lines = computed(() =>
    this.text()
      .split('\n')
      .map((text) => {
        const kind = classify(text);
        return { text, kind, icon: ICON[kind] };
      }),
  );
  protected readonly visible = computed(() =>
    this.onlyMarked()
      ? this.lines().filter((l) => l.kind === 'mistake' || l.kind === 'change' || l.kind === 'auto')
      : this.lines(),
  );

  open(text: string, valid: boolean | null = null): void {
    this.text.set(text);
    this.valid.set(valid);
    this.onlyMarked.set(false);
    this.dlg().nativeElement.showModal();
    setTimeout(() => {
      const pre = this.dlg().nativeElement.querySelector('pre');
      if (pre && valid === null) pre.scrollTop = pre.scrollHeight;
    });
  }
}
