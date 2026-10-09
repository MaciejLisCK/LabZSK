import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { SimSettings } from '../core/simulator';
import { SimService, Skin } from '../sim.service';

/** Options window (Other/Options.cs). Changes of teacher settings are written to the log. */
@Component({
  selector: 'app-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dialog">
      <form method="dialog" (submit)="ok($event)">
        <h2>Opcje</h2>
        <fieldset>
          <legend>Wygląd schematu</legend>
          <div class="row">
            @for (s of skins; track s.id) {
              <label
                ><input type="radio" name="skin" [checked]="skin() === s.id" (change)="skin.set(s.id)" />
                {{ s.label }}</label
              >
            }
          </div>
        </fieldset>
        <fieldset>
          <legend>Ustawienia prowadzącego</legend>
          <p class="hint">Każda zmiana tych ustawień jest zapisywana w logu.</p>
          <div class="grid3">
            <label class="field"
              ><span>Ocena 4 od błędów</span
              ><input #m1 type="number" min="0" [value]="s().firstMark" (input)="set('firstMark', +m1.value)"
            /></label>
            <label class="field"
              ><span>Ocena 3 od błędów</span
              ><input #m2 type="number" min="0" [value]="s().secondMark" (input)="set('secondMark', +m2.value)"
            /></label>
            <label class="field"
              ><span>Ocena 2 od błędów</span
              ><input #m3 type="number" min="0" [value]="s().thirdMark" (input)="set('thirdMark', +m3.value)"
            /></label>
          </div>
          <label class="check"
            ><input type="checkbox" [checked]="s().canCloseLog" (change)="set('canCloseLog', !s().canCloseLog)" />
            Pozwól zamykać log</label
          >
          <label class="check"
            ><input type="checkbox" [checked]="s().devConsole" (change)="set('devConsole', !s().devConsole)" /> Konsola
            deweloperska (automatyczne wykonywanie)</label
          >
          <label class="field"
            ><span>Opóźnienie kroku automatycznego [ms]</span
            ><input #d type="number" min="0" [value]="s().delay" (input)="set('delay', +d.value)"
          /></label>
        </fieldset>
        <div class="actions">
          <button type="button" (click)="dlg.close()">Anuluj</button>
          <button type="submit" class="primary">Zapisz</button>
        </div>
      </form>
    </dialog>
  `,
})
export class SettingsDialog {
  private readonly svc = inject(SimService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly s = signal<SimSettings>(this.svc.sim.settings);
  protected readonly skin = signal<Skin>('light');
  protected readonly skins: { id: Skin; label: string }[] = [
    { id: 'light', label: 'Systemowy' },
    { id: 'green', label: 'Zielony' },
    { id: 'blue', label: 'Niebieski' },
    { id: 'red', label: 'Czerwony' },
    { id: 'grey', label: 'Czarny' },
  ];

  open(): void {
    this.s.set({ ...this.svc.sim.settings });
    this.skin.set(this.svc.skin());
    this.dlg().nativeElement.showModal();
  }

  protected set<K extends keyof SimSettings>(key: K, value: SimSettings[K]): void {
    if (typeof value === 'number' && !(Number.isFinite(value) && value >= 0)) return;
    this.s.set({ ...this.s(), [key]: value });
  }

  protected ok(event: Event): void {
    event.preventDefault();
    this.svc.setSkin(this.skin());
    this.svc.updateSettings({ ...this.s(), canEditOptions: this.svc.sim.settings.canEditOptions });
    this.dlg().nativeElement.close();
  }
}
