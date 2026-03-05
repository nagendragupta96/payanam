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

        <form [formGroup]="form" (ngSubmit)="send()">
          <textarea class="form-control mb-2" rows="3" formControlName="content" placeholder="Type your message"></textarea>
          <button class="btn btn-primary" type="submit">Send</button>
        </form>

        <p class="mt-3" [class.text-danger]="warning">{{ warning }}</p>

        <ul class="list-group">
          <li class="list-group-item" *ngFor="let msg of messages">{{ msg.body }}</li>
        </ul>
      </div>
    </div>
  `
})
export class ChatComponent implements OnDestroy {
  warning = '';
  messages: { id: string; body: string; sender_id: string }[] = [];
  private threadId: string | null = null;
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
    const requestId = this.route.snapshot.paramMap.get('requestId') ?? '';
    const { threadId, error } = await this.chatService.getOrCreateThreadByRequest(requestId);

    if (error || !threadId) {
      this.warning = error ?? 'Unable to open chat thread.';
      return;
    }

    this.threadId = threadId;
    const history = await this.chatService.listMessages(threadId);
    if (history.error) this.warning = history.error;
    else this.messages = history.data;

    this.channel = this.chatService.subscribeToThread(threadId, (payload: any) => {
      if (payload.new) this.messages.push({ id: payload.new.id, body: payload.new.body, sender_id: payload.new.sender_id });
    });
  }

  async send() {
    const userId = this.authService.currentSession?.user.id;
    const content = this.form.value.content ?? '';
    if (!userId || !content || !this.threadId) return;

    const error = await this.chatService.sendMessage(this.threadId, userId, content);
    this.warning = error ?? '';
    if (!error) this.form.reset();
  }

  ngOnDestroy() {
    this.channel?.unsubscribe();
  }
}
