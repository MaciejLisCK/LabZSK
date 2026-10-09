import { ChangeDetectionStrategy, Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { SimService } from '../sim.service';

/** Before the first simulation a log has to be created ("Konieczne jest utworzenie pliku LOG"). */
@Component({
  selector: 'app-start-log-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dialog">
      <form method="dialog" (submit)="ok($event)">
        <h2>Nowy log pracy</h2>
        <p class="hint">Przed rozpoczęciem symulacji trzeba utworzyć log. Zapisuje on przebieg pracy, błędy i ocenę.</p>
        <label class="field">
          <span>Imię i nazwisko</span>
          <input #n required [value]="name()" (input)="name.set(n.value)" autocomplete="name" />
        </label>
        <label class="field">
          <span>Grupa</span>
          <input #g [value]="group()" (input)="group.set(g.value)" />
        </label>
        <div class="actions">
          <button type="button" (click)="dlg.close()">Anuluj</button>
          <button type="submit" class="primary" [disabled]="!name().trim()">Utwórz log</button>
        </div>
      </form>
    </dialog>
  `,
})
export class StartLogDialog {
  private readonly svc = inject(SimService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly name = signal('');
  protected readonly group = signal('');
  /** Emitted after the log is created. */
  readonly created = output<void>();

  open(): void {
    this.dlg().nativeElement.showModal();
  }

  protected ok(event: Event): void {
    event.preventDefault();
    if (!this.name().trim()) return;
    this.svc.openLog({ name: this.name().trim(), group: this.group().trim() });
    this.dlg().nativeElement.close();
    this.created.emit();
  }
}
