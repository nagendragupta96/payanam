import { CommonModule } from '@angular/common';
import { Component, OnDestroy } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <h2>Chat</h2>
    <p>Chat opens only after request acceptance.</p>

    <form [formGroup]="form" (ngSubmit)="send()">
      <textarea formControlName="content" placeholder="Type your message"></textarea>
      <button type="submit">Send</button>
    </form>

    <p>{{ warning }}</p>
    <ul>
      <li *ngFor="let msg of messages">{{ msg }}</li>
    </ul>
  `
})
export class ChatComponent implements OnDestroy {
  warning = '';
  chatId = 'DEMO_CHAT_ID';
  messages: string[] = [];
  private channel: { unsubscribe: () => void } | null = null;

  form = this.fb.group({
    content: ['', Validators.required]
  });

  constructor(
    private fb: FormBuilder,
    private chatService: ChatService,
    private authService: AuthService
  ) {
    this.channel = this.chatService.subscribeToChat(this.chatId, (payload: any) => {
      this.messages.push(payload.new?.content ?? 'New message');
    });
  }

  async send() {
    const userId = this.authService.currentSession?.user.id;
    const content = this.form.value.content ?? '';
    if (!userId || !content) return;

    const error = await this.chatService.sendMessage(this.chatId, userId, content);
    this.warning = error ?? '';

    if (!error) this.form.reset();
  }

  ngOnDestroy() {
    this.channel?.unsubscribe();
  }
}
