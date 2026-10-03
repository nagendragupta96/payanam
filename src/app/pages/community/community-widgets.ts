import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, ThumbsUp, Heart, HandHeart, Lightbulb } from 'lucide-angular';
import { CommunityAuthor, Reaction, ReactionSummary, REPORT_REASONS } from '../../models/community.model';
import { CommunityService } from '../../services/community.service';

@Component({
  selector: 'app-community-author', standalone: true, imports: [CommonModule],
  template: `<div class="d-flex align-items-center gap-2 author">
    <img *ngIf="author.avatar_url && !failed; else initials" [src]="author.avatar_url" alt="" referrerpolicy="no-referrer" (error)="failed = true" />
    <ng-template #initials><span class="avatar" aria-hidden="true">{{ author.display_name.slice(0, 1).toUpperCase() }}</span></ng-template>
    <div class="name"><strong>{{ author.display_name }}</strong><div class="small text-secondary"><time [attr.datetime]="date" [title]="date | date:'medium'">{{ date | date:'medium' }}</time></div></div>
  </div>`,
  styles: [`.author{min-width:0}.name{min-width:0;overflow-wrap:anywhere}img,.avatar{width:36px;height:36px;border-radius:50%;flex-shrink:0;object-fit:cover}.avatar{display:grid;place-items:center;background:#dbece5;color:#215941}`]
})
export class CommunityAuthorComponent { @Input({ required: true }) author!: CommunityAuthor; @Input() date = ''; failed = false; }

@Component({
  selector: 'app-community-reactions', standalone: true, imports: [CommonModule, LucideAngularModule],
  template: `<div class="d-flex flex-wrap gap-1" aria-label="Reactions">
    <button *ngFor="let item of options" type="button" class="btn btn-sm reaction" [class.selected]="value.my_reaction === item.type"
      [disabled]="busy" [attr.aria-pressed]="value.my_reaction === item.type" [attr.aria-label]="item.label" [title]="item.label"
      [attr.data-activity]="'community-react-' + item.type" (click)="react.emit(item.type)">
      <lucide-icon [img]="item.icon" [size]="17"></lucide-icon><span>{{ value.reactions[item.type] || 0 }}</span>
    </button></div>`,
  styles: [`.reaction{display:inline-flex;align-items:center;gap:6px;min-width:52px;min-height:40px;border:1px solid #cbd5d1;color:#38554a}.selected{background:#dbece5;border-color:#287554;color:#174b34}`]
})
export class CommunityReactionsComponent {
  @Input({ required: true }) value!: ReactionSummary; @Input() busy = false; @Output() react = new EventEmitter<Reaction>();
  readonly options: {type: Reaction; label: string; icon: any}[] = [
    { type: 'like', label: 'Like', icon: ThumbsUp }, { type: 'support', label: 'Support', icon: Heart },
    { type: 'thanks', label: 'Thanks', icon: HandHeart }, { type: 'helpful', label: 'Helpful', icon: Lightbulb }
  ];
}

@Component({
  selector: 'app-community-report', standalone: true, imports: [CommonModule, FormsModule],
  template: `<section class="border rounded p-3 my-3" aria-label="Report content">
    <h3 class="h6">Report content</h3><p *ngIf="error" class="text-danger" role="alert">{{ error }}</p>
    <form (ngSubmit)="submit()">
      <label class="form-label" for="reportReason">Reason</label>
      <select id="reportReason" class="form-select mb-2" [(ngModel)]="reason" name="reason" required><option *ngFor="let item of reasons">{{ item }}</option></select>
      <label class="form-label" for="reportDetails">Details (optional)</label>
      <textarea id="reportDetails" class="form-control mb-2" [(ngModel)]="details" name="details" maxlength="2000" rows="3"></textarea>
      <button class="btn btn-primary me-2" type="submit" [disabled]="busy">{{ busy ? 'Submitting...' : 'Submit report' }}</button>
      <button class="btn btn-outline-secondary" type="button" [disabled]="busy" (click)="closed.emit(false)">Cancel</button>
    </form></section>`
})
export class CommunityReportComponent {
  @Input({required:true}) target!: { id: string; comment: boolean }; @Output() closed = new EventEmitter<boolean>();
  readonly reasons = REPORT_REASONS; reason: string = REPORT_REASONS[0]; details = ''; busy = false; error = '';
  constructor(private service: CommunityService) {}
  async submit() {
    if (this.busy) return; this.busy = true; this.error = '';
    try { await this.service.report(this.target.id, this.target.comment, this.reason, this.details.trim()); this.closed.emit(true); }
    catch (error) { this.error = error instanceof Error ? error.message : 'Report could not be submitted.'; }
    finally { this.busy = false; }
  }
}
