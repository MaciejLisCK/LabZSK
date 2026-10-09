import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { CellType, cellBinary, cellHex, cellMnemonic, describeCell } from '../core/memory';
import { SimService } from '../sim.service';

const TYPE_LABEL: Record<CellType, string> = {
  [CellType.Empty]: '',
  [CellType.Data]: 'dana',
  [CellType.Simple]: '',
  [CellType.Complex]: '',
};

/** Operating memory grid with the description of the selected cell (Grid_Mem + cellDescription). */
@Component({
  selector: 'app-pao-table',
  templateUrl: './pao-table.html',
  styleUrl: './pao-table.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaoTable {
  protected readonly svc = inject(SimService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly selected = signal(0);
  readonly edit = output<number>();
  protected readonly bin = cellBinary;
  protected readonly hex = cellHex;
  protected readonly description = computed(() => {
    this.svc.version();
    const i = this.selected();
    return describeCell(i, this.svc.sim.pao[i]);
  });
  private lastCursor: number | null = null;

  constructor() {
    effect(() => {
      this.svc.version();
      const cursor = this.svc.sim.paoCursor;
      if (cursor !== null && cursor !== this.lastCursor) {
        this.lastCursor = cursor;
        this.selected.set(cursor);
        setTimeout(() => this.scrollTo(cursor));
      }
    });
  }

  protected kind(i: number): string {
    const cell = this.svc.sim.pao[i];
    return cell.type === CellType.Data ? TYPE_LABEL[cell.type] : cellMnemonic(cell);
  }

  private scrollTo(row: number): void {
    this.host.nativeElement.querySelector(`tr[data-row="${row}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  protected open(i: number): void {
    this.selected.set(i);
    if (!this.svc.sim.isRunning) this.edit.emit(i);
  }

  protected onKey(event: KeyboardEvent): void {
    const i = this.selected();
    const move = (n: number) => {
      event.preventDefault();
      const r = Math.min(255, Math.max(0, n));
      this.selected.set(r);
      this.scrollTo(r);
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`tr[data-row="${r}"]`)?.focus());
    };
    switch (event.key) {
      case 'ArrowUp':
        return move(i - 1);
      case 'ArrowDown':
        return move(i + 1);
      case 'PageUp':
        return move(i - 16);
      case 'PageDown':
        return move(i + 16);
      case 'Enter':
      case 'F2':
        event.preventDefault();
        event.stopPropagation();
        return this.open(i);
      case 'Delete':
        event.preventDefault();
        if (!this.svc.sim.isRunning) this.svc.editPao(i, { word: 0, type: CellType.Empty });
    }
  }
}
