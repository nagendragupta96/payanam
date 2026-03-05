import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <h2 class="h4">Messages</h2>
        <p class="text-muted">Chat opens only after request acceptance.</p>

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>

        <form [formGroup]="form" (ngSubmit)="send()" class="mb-3">
          <textarea class="form-control mb-2" rows="3" formControlName="content" placeholder="Type your message"></textarea>
          <button class="btn btn-primary" type="submit" [disabled]="loadingSend || !threadId">
            <span *ngIf="loadingSend" class="spinner-border spinner-border-sm me-2"></span>
            Send
          </button>
        </form>

        <div *ngIf="loadingThread" class="text-center py-4">
          <div class="spinner-border text-primary"></div>
        </div>

        <ul class="list-group" *ngIf="!loadingThread">
          <li class="list-group-item" *ngFor="let msg of messages">{{ msg.body }}</li>
        </ul>
      </div>
    </div>
  `
})
export class ChatComponent implements OnDestroy {
  messages: { id: string; body: string; sender_id: string }[] = [];
  threadId: string | null = null;
  errorMessage = '';
  loadingThread = false;
  loadingSend = false;
  private channel: { unsubscribe: () => void } | null = null;

  form = this.fb.group({
    content: ['', Validators.required]
  });

  constructor(
    private fb: FormBuilder,
    private chatService: ChatService,
    private authService: AuthService,
    private route: ActivatedRoute
  ) {
    this.init();
  }

  async init() {
    this.loadingThread = true;
    this.errorMessage = '';

    try {
      const requestId = this.route.snapshot.paramMap.get('requestId') ?? '';
      const thread = await this.chatService.getThreadByRequest(requestId);
      if (thread.error || !thread.data?.id) {
        this.errorMessage = thread.error ?? 'No chat thread found. Wait for request acceptance.';
        return;
      }

      this.threadId = thread.data.id;

      if (!this.threadId) return;
      const threadId: string = this.threadId;
      const history = await this.chatService.listMessages(threadId);
      if (history.error) {
        this.errorMessage = history.error;
      } else {
        this.messages = history.data;
      }

      this.channel = this.chatService.subscribeToThread(threadId, (payload: any) => {
        if (payload.new) {
          this.messages.push({ id: payload.new.id, body: payload.new.body, sender_id: payload.new.sender_id });
        }
      });
    } finally {
      this.loadingThread = false;
    }
  }

  async send() {
    const userId = this.authService.currentSession?.user.id;
    const content = this.form.value.content ?? '';
    if (!userId || !content || !this.threadId || this.loadingSend) return;

    this.loadingSend = true;
    this.errorMessage = '';

    try {
      const error = await this.chatService.sendMessage(this.threadId, userId, content);
      if (error) {
        this.errorMessage = error;
        return;
      }
      this.form.reset();
    } finally {
      this.loadingSend = false;
    }
  }

  ngOnDestroy() {
    this.channel?.unsubscribe();
  }
}
