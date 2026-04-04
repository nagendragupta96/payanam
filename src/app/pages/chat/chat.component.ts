import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { AuthService } from '../../services/auth.service';
import { ChatMessage, ChatService, ChatThread } from '../../services/chat.service';
import { MessageNotificationService } from '../../services/message-notification.service';
import { supabase } from '../../services/supabase-client';
import { Subscription } from 'rxjs';

interface ThreadView extends ChatThread {
  otherUserId: string;
  otherUserLabel: string;
  otherUserDisplay: string;
  lastMessage?: ChatMessage;
  unreadCount: number;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="card shadow-sm">
      <div class="card-body">
        <h2 class="h4 mb-3">Messages</h2>

        <div class="alert alert-danger" *ngIf="errorMessage">{{ errorMessage }}</div>
        <div class="alert alert-info" *ngIf="infoMessage">{{ infoMessage }}</div>
        <div class="alert alert-secondary" *ngIf="loadingData">Loading conversations…</div>

        <div class="row g-3">
          <div class="col-lg-4">
            <div class="border rounded p-2 inbox-panel">
              <h6 class="px-2">Conversations</h6>
              <div class="list-group">
                <button
                  type="button"
                  class="list-group-item list-group-item-action"
                  *ngFor="let thread of threadViews"
                  [class.active]="thread.id === selectedThreadId"
                  (click)="selectThread(thread.id)">
                  <div class="d-flex justify-content-between align-items-start">
                    <div>
                      <div class="fw-semibold">{{ thread.otherUserDisplay }}</div>
                      <div class="small text-muted text-truncate" style="max-width: 220px;">
                        {{ thread.lastMessage?.body || 'No messages yet' }}
                      </div>
                    </div>
                    <span class="badge text-bg-danger" *ngIf="thread.unreadCount > 0">{{ thread.unreadCount }}</span>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <div class="col-lg-8">
            <div class="border rounded p-3">
              <div *ngIf="!selectedThreadId" class="text-muted">Select a conversation to view messages.</div>

              <ng-container *ngIf="selectedThreadId">
                <div class="conversation-header mb-2">{{ selectedConversationTitle }}</div>

                <div class="chat-list d-flex flex-column gap-2 mb-3" style="min-height: 280px; max-height: 50vh; overflow:auto;">
                  <div *ngFor="let msg of messages" class="d-flex" [class.justify-content-end]="msg.sender_id === currentUserId">
                    <div class="chat-bubble p-2 rounded" [class.self]="msg.sender_id === currentUserId" [class.other]="msg.sender_id !== currentUserId">
                      <div class="small fw-semibold mb-1">{{ msg.sender_id === currentUserId ? 'Me' : getSenderLabel(msg.sender_id) }}</div>
                      <div>{{ msg.body }}</div>
                    </div>
                  </div>
                </div>

                <form [formGroup]="form" (ngSubmit)="send()">
                  <textarea class="form-control mb-2" rows="3" formControlName="content" placeholder="Type your message"></textarea>
                  <button class="btn btn-primary" type="submit" [disabled]="loadingSend || !selectedThreadId">
                    <span *ngIf="loadingSend" class="spinner-border spinner-border-sm me-2"></span>
                    Send
                  </button>
                </form>
              </ng-container>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .chat-bubble { max-width: min(85%, 520px); }
      .chat-bubble.self { background: #d9ecff; }
      .chat-bubble.other { background: #f1f3f5; }
      .inbox-panel { max-height: 70vh; overflow: auto; }

      .conversation-header {
        background: #e9f0f7;
        color: #1f2937;
        border: 1px solid #d7e0eb;
        border-radius: 0.5rem;
        padding: 0.5rem 0.75rem;
        font-weight: 600;
      }

      .list-group-item.active .text-muted {
        color: rgba(255, 255, 255, 0.9) !important;
      }
    `
  ]
})
export class ChatComponent implements OnDestroy {
  threadViews: ThreadView[] = [];
  messages: ChatMessage[] = [];
  senderLabels: Record<string, string> = {};

  selectedThreadId: string | null = null;
  currentUserId = '';

  errorMessage = '';
  infoMessage = '';
  loadingSend = false;
  loadingData = false;

  private messageChannel: RealtimeChannel | null = null;
  private threadChannel: RealtimeChannel | null = null;
  private readonly subscriptions = new Subscription();
  private initInFlight = false;

  form = this.fb.group({ content: ['', Validators.required] });

  constructor(
    private fb: FormBuilder,
    private chatService: ChatService,
    private authService: AuthService,
    private route: ActivatedRoute,
    private router: Router,
    private messageNotificationService: MessageNotificationService
  ) {
    this.currentUserId = this.authService.currentSession?.user.id ?? '';
    this.subscriptions.add(this.authService.appForeground$.subscribe(() => {
      console.debug('[chat] foreground event -> reloading threads/messages');
      void this.init();
    }));
    void this.init();
  }

  async init() {
    if (this.initInFlight) return;
    const userId = this.authService.currentSession?.user.id;
    if (!userId) return;
    this.initInFlight = true;
    this.loadingData = true;

    try {
      this.errorMessage = '';
      this.infoMessage = '';

      const threadsResult = await this.chatService.listThreadsForUser(userId);
      if (threadsResult.error) {
        this.errorMessage = threadsResult.error;
        return;
      }

      const otherIds = threadsResult.data.map((t) => (t.owner_id === userId ? t.requester_id : t.owner_id));
      this.senderLabels = await this.chatService.getProfileNames(otherIds);

      const lastMessagesResult = await this.chatService.listLastMessagesByThread(threadsResult.data.map((t) => t.id));
      const lastByThread = lastMessagesResult.data;

      this.threadViews = threadsResult.data
        .map((thread) => {
          const otherUserId = thread.owner_id === userId ? thread.requester_id : thread.owner_id;
          const otherUserLabel = this.senderLabels[otherUserId] || 'User';
          return {
            ...thread,
            otherUserId,
            otherUserLabel,
            otherUserDisplay: `${otherUserLabel} (${this.formatRequestType(thread.request_type)})`,
            lastMessage: lastByThread[thread.id],
            unreadCount: 0
          };
        })
        .sort((a, b) => {
          const ad = a.lastMessage?.created_at || a.created_at || '';
          const bd = b.lastMessage?.created_at || b.created_at || '';
          return bd.localeCompare(ad);
        });

      const routeThreadId = this.route.snapshot.paramMap.get('threadId');
      if (routeThreadId && this.threadViews.some((t) => t.id === routeThreadId)) {
        await this.selectThread(routeThreadId);
      } else if (this.threadViews.length) {
        await this.selectThread(this.threadViews[0].id);
      }

      this.subscribeThreadListUpdates();
    } finally {
      this.initInFlight = false;
      this.loadingData = false;
    }
  }

  getSenderLabel(userId: string): string {
    return this.senderLabels[userId] || 'User';
  }

  async selectThread(threadId: string) {
    if (this.selectedThreadId === threadId) return;

    this.selectedThreadId = threadId;
    this.errorMessage = '';
    this.infoMessage = '';

    await this.router.navigate(['/messages', threadId]);

    const selected = this.threadViews.find((t) => t.id === threadId);
    if (selected) selected.unreadCount = 0;
    this.messageNotificationService.clearUnread();

    const history = await this.chatService.listMessages(threadId);
    if (history.error) {
      this.errorMessage = history.error;
      return;
    }

    this.messages = history.data;
    await this.loadSenderLabelsFromMessages();

    this.threadChannel?.unsubscribe();
    this.threadChannel = this.chatService.subscribeToThread(threadId, (payload: any) => {
      if (!payload?.new) return;

      const incoming = payload.new as ChatMessage;
      const exists = this.messages.some((m) => m.id === incoming.id);
      if (!exists) this.messages = [...this.messages, incoming];

      const row = this.threadViews.find((t) => t.id === threadId);
      if (row) row.lastMessage = incoming;

      if (incoming.sender_id !== this.currentUserId && this.selectedThreadId !== threadId) {
        if (row) row.unreadCount += 1;
      }

      this.reorderThreads();
    });
  }

  async send() {
    const userId = this.authService.currentSession?.user.id;
    const content = (this.form.value.content ?? '').trim();
    if (!userId || !content || !this.selectedThreadId || this.loadingSend) return;

    this.loadingSend = true;
    this.errorMessage = '';

    const temp: ChatMessage = {
      id: `temp-${Date.now()}`,
      thread_id: this.selectedThreadId,
      body: content,
      sender_id: userId,
      created_at: new Date().toISOString()
    };
    this.messages = [...this.messages, temp];

    try {
      const result = await this.chatService.sendMessage(this.selectedThreadId, userId, content);
      if (result.error || !result.data) {
        this.messages = this.messages.filter((m) => m.id !== temp.id);
        this.errorMessage = result.error ?? 'Failed to send message.';
        return;
      }

      this.messages = this.messages.filter((m) => m.id !== temp.id);
      if (!this.messages.some((m) => m.id === result.data!.id)) {
        this.messages = [...this.messages, result.data];
      }

      const row = this.threadViews.find((t) => t.id === this.selectedThreadId);
      if (row) row.lastMessage = result.data;
      this.reorderThreads();
      this.form.reset();
    } finally {
      this.loadingSend = false;
    }
  }

  private async loadSenderLabelsFromMessages() {
    const ids = [...new Set(this.messages.map((m) => m.sender_id))].filter((id) => !this.senderLabels[id]);
    if (!ids.length) return;
    const names = await this.chatService.getProfileNames(ids);
    this.senderLabels = { ...this.senderLabels, ...names };
  }

  private reorderThreads() {
    this.threadViews = [...this.threadViews].sort((a, b) => {
      const ad = a.lastMessage?.created_at || a.created_at || '';
      const bd = b.lastMessage?.created_at || b.created_at || '';
      return bd.localeCompare(ad);
    });
  }

  get selectedConversationTitle(): string {
    if (!this.selectedThreadId) return 'Conversation';
    const selected = this.threadViews.find((thread) => thread.id === this.selectedThreadId);
    return selected?.otherUserDisplay ?? 'Conversation';
  }

  private formatRequestType(type?: ChatThread['request_type']): string {
    if (type === 'ASSISTANCE') return 'Assistance';
    if (type === 'CONTACT_DETAILS') return 'Contact Details';
    return 'Companion';
  }

  private subscribeThreadListUpdates() {
    const userId = this.authService.currentSession?.user.id;
    if (!userId || !this.threadViews.length) return;

    const filter = `thread_id=in.(${this.threadViews.map((t) => t.id).join(',')})`;
    this.messageChannel?.unsubscribe();
    this.messageChannel = supabase
      .channel(`messages-inbox:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter }, (payload: any) => {
        const incoming = payload?.new as ChatMessage;
        if (!incoming?.thread_id) return;

        const row = this.threadViews.find((t) => t.id === incoming.thread_id);
        if (!row) return;

        row.lastMessage = incoming;
        if (incoming.sender_id !== this.currentUserId && this.selectedThreadId !== incoming.thread_id) {
          row.unreadCount += 1;
        }
        this.reorderThreads();
      })
      .subscribe();
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    this.messageChannel?.unsubscribe();
    this.threadChannel?.unsubscribe();
  }
}
