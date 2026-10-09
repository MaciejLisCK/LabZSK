import { ChangeDetectionStrategy, Component, ElementRef, viewChild } from '@angular/core';
import { APP_VERSION } from '../core/simulator';

@Component({
  selector: 'app-about-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="dialog">
      <h2>O programie LabZSK</h2>
      <p>Symulator dydaktycznej maszyny cyfrowej z mikroprogramowaniem – wersja przeglądarkowa {{ version }}.</p>
      <p>
        Port aplikacji LabZSK (Konrad Ziarko, WAT) z Windows Forms do Angulara. Logika wykonywania mikroinstrukcji,
        formaty plików <code>.pm</code>, <code>.po</code> i <code>.log</code> są zgodne z wersją desktopową.
      </p>
      <h3>Skróty klawiszowe</h3>
      <ul>
        <li><kbd>Enter</kbd> – Zatwierdź / Następny takt / MAKRO</li>
        <li><kbd>Esc</kbd> – zakończ edycję rejestrów</li>
        <li>Tabele: strzałki, <kbd>Enter</kbd> – edycja komórki, <kbd>Delete</kbd> – wyczyszczenie</li>
        <li>
          Wartość rejestru: <code>12</code> (dziesiętnie), <code>-3</code>, <code>1Fh</code> (szesnastkowo); można też
          przeciągnąć wartość z innego rejestru.
        </li>
      </ul>
      <div class="actions"><button type="button" class="primary" (click)="dlg.close()">Zamknij</button></div>
    </dialog>
  `,
})
export class AboutDialog {
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly version = APP_VERSION;

  open(): void {
    this.dlg().nativeElement.showModal();
  }
}
