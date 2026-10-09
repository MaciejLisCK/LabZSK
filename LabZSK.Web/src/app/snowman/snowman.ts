import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SimService } from '../sim.service';

type Hint = {
  text: string;
  reg?: string;
  after?: string;
  wave: boolean;
  sign: boolean;
  ask: boolean;
};

/** Snowman of the Christmas skin – shows the hints of the control panel in a speech bubble. */
@Component({
  selector: 'app-snowman',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let h = hint();
    @let sim = svc.at(svc.version());
    <div class="snowman">
      <svg viewBox="0 0 100 112" aria-hidden="true" [class.wave]="h.wave">
        <ellipse cx="45" cy="108" rx="34" ry="4" class="ground" />
        <circle cx="45" cy="88" r="20" class="body" />
        <circle cx="45" cy="58" r="15" class="body" />
        <circle cx="45" cy="33" r="11" class="body" />
        <path d="M 35 42 Q 45 48 55 42 L 56 46 Q 45 52 34 46 Z M 52 45 L 58 58 L 53 59 L 49 46 Z" class="scarf" />
        <rect x="31" y="21" width="28" height="3.5" rx="1" class="hat" />
        <rect x="36" y="6" width="18" height="16" rx="1.5" class="hat" />
        <rect x="36" y="17" width="18" height="3" class="band" />
        <circle cx="41" cy="31" r="1.6" class="coal" />
        <circle cx="49" cy="31" r="1.6" class="coal" />
        <path d="M 45 34 L 57 36.5 L 45 37.8 Z" class="carrot" />
        <circle cx="45" cy="56" r="1.6" class="coal" />
        <circle cx="45" cy="64" r="1.6" class="coal" />
        <circle cx="45" cy="82" r="1.8" class="coal" />
        <path d="M 31 56 L 12 44 M 17 47 L 12 49 M 17 47 L 15 41" class="arm" />
        @if (h.sign) {
          <path d="M 59 56 L 78 28" class="arm" />
          <g class="sign">
            <rect x="54" y="-10" width="50" height="38" rx="3" />
            <text x="79" y="1">OCENA</text>
            <text x="79" y="23" class="mark">{{ sim.mark }}</text>
          </g>
        } @else {
          <g class="right-arm">
            <path d="M 59 56 L 80 42 M 75 45 L 80 47 M 75 45 L 77 39" class="arm" />
          </g>
        }
      </svg>
      <p class="bubble" [class.ask]="h.ask" aria-live="polite">
        {{ h.text }}
        @if (h.reg) {
          <b>{{ h.reg }}</b>
        }
        {{ h.after }}
      </p>
    </div>
  `,
  styles: `
    .snowman {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    svg {
      flex: none;
      width: 96px;
      margin-top: 10px;
      height: auto;
      overflow: visible;
    }
    .ground {
      fill: var(--surface-2);
    }
    .body {
      fill: #fbfdff;
      stroke: #9fb3c8;
      stroke-width: 1.2;
    }
    .hat {
      fill: #1d2430;
    }
    .band,
    .scarf {
      fill: #d61f26;
    }
    .coal {
      fill: #1d2430;
    }
    .carrot {
      fill: #f08a24;
    }
    .arm {
      fill: none;
      stroke: #7a4b2a;
      stroke-width: 2.5;
      stroke-linecap: round;
    }
    .right-arm {
      transform-origin: 59px 56px;
    }
    .wave .right-arm {
      animation: wave 0.9s ease-in-out infinite alternate;
    }
    @keyframes wave {
      from {
        transform: rotate(10deg);
      }
      to {
        transform: rotate(-35deg);
      }
    }
    .sign rect {
      fill: #fff6d6;
      stroke: #7a4b2a;
      stroke-width: 2;
    }
    .sign text {
      fill: #1d2430;
      font: 700 9px var(--sans);
      text-anchor: middle;
      letter-spacing: 0.06em;
    }
    .sign .mark {
      font: 800 21px var(--mono);
      letter-spacing: 0;
    }
    .sign {
      transform-origin: 79px 28px;
      animation: hold 2.4s ease-in-out infinite;
    }
    @keyframes hold {
      0%,
      100% {
        transform: rotate(-3deg);
      }
      50% {
        transform: rotate(3deg);
      }
    }
    .bubble {
      position: relative;
      flex: 1;
      min-width: 0;
      margin: 0;
      padding: 8px 10px;
      border-radius: 10px;
      background: var(--surface-2);
      color: var(--text);
      border: 2px solid var(--border);
    }
    .bubble::before {
      content: '';
      position: absolute;
      left: -9px;
      top: 50%;
      margin-top: -8px;
      border: 8px solid transparent;
      border-left: 0;
      border-right-color: var(--border);
    }
    .bubble.ask {
      background: var(--check-bg);
      color: var(--check-text);
      border: 2px dashed var(--check-border);
    }
    .bubble.ask::before {
      border-right-color: var(--check-border);
    }
    @media (prefers-reduced-motion: reduce) {
      .wave .right-arm,
      .sign {
        animation: none;
      }
    }
  `,
})
export class Snowman {
  protected readonly svc = inject(SimService);

  protected readonly hint = computed<Hint>(() => {
    this.svc.version();
    const sim = this.svc.sim;
    const base = { wave: false, sign: false, ask: false };
    if (sim.inEditMode) return { ...base, text: 'Edytujesz rejestry. Kliknij „Zakończ edycję”, gdy skończysz.' };
    if (sim.waitingFor === 'ok') {
      const reg = sim.registerToCheck;
      if (reg && sim.regs[reg].needCheck)
        return {
          ...base,
          wave: true,
          ask: true,
          text: 'Teraz policz',
          reg,
          after: '– wpisz nową wartość (np. 12, -3, 1Fh) i zatwierdź.',
        };
      return { ...base, wave: true, ask: true, text: 'Zatwierdź wykonanie mikrooperacji.' };
    }
    if (sim.waitingFor === 'tact') return { ...base, wave: true, text: 'Kliknij „Następny takt”, aby iść dalej.' };
    if (sim.isRunning) return { ...base, text: sim.autoRun ? 'Liczę automatycznie…' : 'Liczę…' };
    if (!sim.canSimulate) return { ...base, sign: true, text: `Koniec symulacji! Błędy: ${sim.mistakes}.` };
    if (sim.cycle > 0)
      return {
        ...base,
        sign: true,
        text: `Koniec cyklu! Błędy: ${sim.mistakes}. Kliknij MAKRO lub MIKRO, aby wykonać kolejny.`,
      };
    return { ...base, text: 'Kliknij MAKRO (cały cykl) lub MIKRO (takt po takcie).' };
  });
}
