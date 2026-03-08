import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, Input } from '@angular/core';

@Component({
  selector: 'app-help-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span class="help-icon-wrap">
      <button type="button" class="info-icon" (click)="toggle($event)" [attr.aria-label]="ariaLabel || 'Field help'">ⓘ</button>
      <div class="help-popover" *ngIf="open" role="tooltip">
        <button type="button" class="btn-close btn-close-sm help-close" aria-label="Close" (click)="open = false"></button>
        <div class="help-text">{{ text }}</div>
      </div>
    </span>
  `,
  styles: [
    `
      .help-icon-wrap { position: relative; display: inline-flex; margin-left: 0.35rem; vertical-align: middle; }
      .info-icon {
        border: 1px solid #0d6efd;
        border-radius: 999px;
        background: #fff;
        width: 1.5rem;
        height: 1.5rem;
        line-height: 1;
        text-align: center;
        padding: 0;
        color: #0d6efd;
        cursor: pointer;
        font-size: 0.85rem;
      }
      .help-popover {
        position: absolute;
        top: calc(100% + 0.35rem);
        left: 0;
        z-index: 1200;
        width: min(280px, 72vw);
        background: #fff;
        border: 1px solid #d0d7e2;
        border-radius: 0.5rem;
        box-shadow: 0 8px 20px rgba(0,0,0,0.16);
        padding: 0.6rem 0.75rem 0.55rem;
      }
      .help-close { position: absolute; top: 0.3rem; right: 0.3rem; font-size: 0.7rem; }
      .help-text { font-size: 0.85rem; color: #1f2937; padding-right: 1rem; }
    `
  ]
})
export class HelpIconComponent {
  @Input({ required: true }) text = '';
  @Input() ariaLabel = '';
  open = false;

  constructor(private host: ElementRef<HTMLElement>) {}

  toggle(event: Event): void {
    event.stopPropagation();
    this.open = !this.open;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.open) return;
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.open = false;
    }
  }
}
