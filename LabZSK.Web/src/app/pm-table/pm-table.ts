import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, output, signal } from '@angular/core';
import { PM_COLUMNS, microOpDescription } from '../core/microcode';
import { SimService } from '../sim.service';

/** Microprogram memory grid (Grid_PM in SimView / PMView). */
@Component({
  selector: 'app-pm-table',
  templateUrl: './pm-table.html',
  styleUrl: './pm-table.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PmTable {
  protected readonly svc = inject(SimService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly columns = PM_COLUMNS;
  protected readonly colIdx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  protected readonly selected = signal<{ row: number; col: number }>({ row: 0, col: 1 });
  /** Request to edit a cell (opens the PMSubmit-like dialog). */
  readonly edit = output<{ row: number; col: number }>();
  protected readonly describe = microOpDescription;

  constructor() {
    effect(() => {
      this.svc.version();
      const sim = this.svc.sim;
      const row = sim.pmCursor?.row ?? sim.regs.RAPS.value;
      if (sim.isRunning) setTimeout(() => this.scrollTo(row));
    });
  }

  private scrollTo(row: number): void {
    this.host.nativeElement.querySelector(`tr[data-row="${row}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  protected select(row: number, col: number): void {
    this.selected.set({ row, col });
  }

  protected open(row: number, col: number): void {
    this.select(row, col);
    if (!this.svc.sim.isRunning) this.edit.emit({ row, col });
  }

  protected onKey(event: KeyboardEvent): void {
    const { row, col } = this.selected();
    const move = (r: number, c: number) => {
      event.preventDefault();
      const nr = Math.min(255, Math.max(0, r));
      const nc = Math.min(11, Math.max(1, c));
      this.select(nr, nc);
      this.scrollTo(nr);
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`td[data-cell="${nr}-${nc}"]`)?.focus());
    };
    switch (event.key) {
      case 'ArrowUp':
        return move(row - 1, col);
      case 'ArrowDown':
        return move(row + 1, col);
      case 'ArrowLeft':
        return move(row, col - 1);
      case 'ArrowRight':
        return move(row, col + 1);
      case 'PageUp':
        return move(row - 16, col);
      case 'PageDown':
        return move(row + 16, col);
      case 'Enter':
      case 'F2':
        event.preventDefault();
        event.stopPropagation();
        return this.open(row, col);
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        if (!this.svc.sim.isRunning) this.svc.editPm(row, col, '');
    }
  }
}
