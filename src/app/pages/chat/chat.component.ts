import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RealtimeChannel } from '@supabase/supabase-js';
import { AuthService } from '../../services/auth.service';
import { ChatMessage, ChatService } from '../../services/chat.service';
import { MessageNotificationService } from '../../services/message-notification.service';

interface ChatMessageView extends ChatMessage {
  pending?: boolean;
}

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
        <div class="alert alert-info" *ngIf="infoMessage">{{ infoMessage }}</div>

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

        <div *ngIf="!loadingThread" class="chat-list d-flex flex-column gap-2">
          <div *ngFor="let msg of messages" class="d-flex" [class.justify-content-end]="msg.sender_id === currentUserId">
            <div class="chat-bubble p-2 rounded" [class.self]="msg.sender_id === currentUserId" [class.other]="msg.sender_id !== currentUserId">
              <div class="small fw-semibold mb-1">
                {{ msg.sender_id === currentUserId ? 'Me' : (senderNames[msg.sender_id] || 'User') }}
                <span class="badge text-bg-warning ms-1" *ngIf="msg.pending">Sending…</span>
              </div>
              <div>{{ msg.body }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .chat-bubble {
        max-width: min(85%, 520px);
      }

      .chat-bubble.self {
        background: #d9ecff;
      }

      .chat-bubble.other {
        background: #f1f3f5;
      }
    `
  ]
})
export class ChatComponent implements OnDestroy {
  messages: ChatMessageView[] = [];
  senderNames: Record<string, string> = {};
  threadId: string | null = null;
  currentUserId = '';

  errorMessage = '';
  infoMessage = '';
  loadingThread = false;
  loadingSend = false;
  private channel: RealtimeChannel | null = null;

  form = this.fb.group({
    content: ['', Validators.required]
  });

  constructor(
    private fb: FormBuilder,
    private chatService: ChatService,
    private authService: AuthService,
    private route: ActivatedRoute,
    private messageNotificationService: MessageNotificationService
  ) {
    this.currentUserId = this.authService.currentSession?.user.id ?? '';
    this.init();
    this.messageNotificationService.clearUnread();
  }

  async init() {
    this.loadingThread = true;
    this.errorMessage = '';
    this.infoMessage = '';

    try {
      const requestId = this.route.snapshot.paramMap.get('requestId') ?? '';
      const thread = await this.chatService.getThreadByRequest(requestId);
      if (thread.error || !thread.data?.id) {
        this.errorMessage = thread.error ?? 'No chat thread found. Wait for request acceptance.';
        return;
      }

      this.threadId = thread.data.id as string;
      const activeThreadId: string = this.threadId;

      const names = await this.chatService.getProfileNames([thread.data.owner_id, thread.data.requester_id]);
      this.senderNames = { ...this.senderNames, ...names };

      const history = await this.chatService.listMessages(activeThreadId);
      if (history.error) {
        this.errorMessage = history.error;
      } else {
        this.messages = history.data;
        await this.ensureSenderNames(this.messages.map((m) => m.sender_id));
      }

      this.channel = this.chatService.subscribeToThread(activeThreadId, (payload: any) => {
        if (!payload?.new) return;
        this.upsertMessage({
          id: payload.new.id,
          body: payload.new.body,
          sender_id: payload.new.sender_id,
          created_at: payload.new.created_at
        });
        this.ensureSenderNames([payload.new.sender_id]);
      });
    } finally {
      this.loadingThread = false;
    }
  }

  async send() {
    const userId = this.authService.currentSession?.user.id;
    const content = (this.form.value.content ?? '').trim();
    if (!userId || !content || !this.threadId || this.loadingSend) return;

    this.loadingSend = true;
    this.errorMessage = '';
    this.infoMessage = '';

    const tempId = `temp-${Date.now()}`;
    this.upsertMessage({ id: tempId, body: content, sender_id: userId, pending: true });

    try {
      const result = await this.chatService.sendMessage(this.threadId, userId, content);
      if (result.error || !result.data) {
        this.messages = this.messages.filter((m) => m.id !== tempId);
        this.errorMessage = result.error ?? 'Failed to send message.';
        return;
      }

      this.messages = this.messages.filter((m) => m.id !== tempId);
      this.upsertMessage(result.data);
      this.form.reset();
    } finally {
      this.loadingSend = false;
    }
  }

  private upsertMessage(message: ChatMessageView) {
    const exists = this.messages.find((m) => m.id === message.id);
    if (exists) return;
    this.messages = [...this.messages, message];
  }

  private async ensureSenderNames(userIds: string[]) {
    const missing = [...new Set(userIds.filter((id) => id && !this.senderNames[id]))];
    if (!missing.length) return;

    const names = await this.chatService.getProfileNames(missing);
    this.senderNames = { ...this.senderNames, ...names };
  }

  ngOnDestroy() {
    this.channel?.unsubscribe();
  }
}
