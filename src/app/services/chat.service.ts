import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';
import { AuthService } from './auth.service';

export interface ChatMessage {
  id: string;
  thread_id?: string;
  body: string;
  sender_id: string;
  created_at?: string;
}

export interface ChatThread {
  id: string;
  owner_id: string;
  requester_id: string;
  request_id: string;
  request_type?: 'COMPANION' | 'ASSISTANCE' | 'CONTACT_DETAILS';
  created_at?: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  constructor(private authService: AuthService) {}

  isSafeMessage(message: string): { safe: boolean; reason?: string } {
    const emailPattern = /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/i;
    const phonePattern = /(?:\+?\d[\d\s().-]{7,}\d)/;
    const messengerPattern = /\b(whatsapp|telegram|signal|wechat)\b/i;
    const paymentPattern = /\b(paypal|venmo|cash\s?app|zelle|upi|wire\s?transfer|bank\s?account|crypto|bitcoin)\b/i;

    if (emailPattern.test(message)) return { safe: false, reason: 'Email addresses are not allowed.' };
    if (phonePattern.test(message)) return { safe: false, reason: 'Phone numbers are not allowed.' };
    if (messengerPattern.test(message)) return { safe: false, reason: 'External messenger mentions are blocked.' };
    if (paymentPattern.test(message)) return { safe: false, reason: 'Payment coordination keywords are blocked.' };
    return { safe: true };
  }

  async listThreadsForUser(userId: string): Promise<{ data: ChatThread[]; error: string | null }> {
    console.debug('[chat-service] listThreadsForUser start', { userId });
    const runQuery = () => supabase
      .from('chat_threads')
      .select('id, owner_id, requester_id, request_id, created_at, requests(request_type)')
      .or(`owner_id.eq.${userId},requester_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    let { data, error } = await runQuery();
    if (error) {
      this.handleAuthFailure('listThreadsForUser', error.message);
      const recovered = await this.authService.recoverSessionForDataQuery('chat.listThreadsForUser', error.message);
      if (recovered) {
        const retry = await runQuery();
        data = retry.data;
        error = retry.error;
      }
    }

    const mapped = ((data ?? []) as any[]).map((row) => ({
      id: row.id,
      owner_id: row.owner_id,
      requester_id: row.requester_id,
      request_id: row.request_id,
      created_at: row.created_at,
      request_type: row.requests?.request_type
    })) as ChatThread[];

    this.handleAuthFailure('listThreadsForUser', error?.message ?? '');
    const result = { data: mapped, error: error?.message ?? null };
    console.debug('[chat-service] listThreadsForUser end', { count: result.data.length, hasError: !!result.error });
    return result;
  }

  async getThreadByRequest(requestId: string): Promise<{ data: ChatThread | null; error: string | null }> {
    const { data, error } = await supabase
      .from('chat_threads')
      .select('id, owner_id, requester_id, request_id, created_at, requests(request_type)')
      .eq('request_id', requestId)
      .maybeSingle();

    const mapped = data
      ? ({
          id: (data as any).id,
          owner_id: (data as any).owner_id,
          requester_id: (data as any).requester_id,
          request_id: (data as any).request_id,
          created_at: (data as any).created_at,
          request_type: (data as any).requests?.request_type
        } as ChatThread)
      : null;

    this.handleAuthFailure('getThreadByRequest', error?.message ?? '');
    return { data: mapped, error: error?.message ?? null };
  }

  async listMessages(threadId: string): Promise<{ data: ChatMessage[]; error: string | null }> {
    console.debug('[chat-service] listMessages start', { threadId });
    const runQuery = () => supabase
      .from('chat_messages')
      .select('id, thread_id, body, sender_id, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });

    let { data, error } = await runQuery();
    if (error) {
      this.handleAuthFailure('listMessages', error.message);
      const recovered = await this.authService.recoverSessionForDataQuery('chat.listMessages', error.message);
      if (recovered) {
        const retry = await runQuery();
        data = retry.data;
        error = retry.error;
      }
    }

    this.handleAuthFailure('listMessages', error?.message ?? '');
    const result = { data: (data as ChatMessage[]) ?? [], error: error?.message ?? null };
    console.debug('[chat-service] listMessages end', { threadId, count: result.data.length, hasError: !!result.error });
    return result;
  }

  async listLastMessagesByThread(threadIds: string[]): Promise<{ data: Record<string, ChatMessage>; error: string | null }> {
    if (!threadIds.length) return { data: {}, error: null };

    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, thread_id, body, sender_id, created_at')
      .in('thread_id', threadIds)
      .order('created_at', { ascending: false });

    if (error) {
      this.handleAuthFailure('listLastMessagesByThread', error.message);
      return { data: {}, error: error.message };
    }

    const map: Record<string, ChatMessage> = {};
    for (const msg of (data as ChatMessage[]) ?? []) {
      if (!msg.thread_id) continue;
      if (!map[msg.thread_id]) map[msg.thread_id] = msg;
    }

    return { data: map, error: null };
  }

  async sendMessage(threadId: string, senderId: string, body: string): Promise<{ data: ChatMessage | null; error: string | null }> {
    const safety = this.isSafeMessage(body);
    if (!safety.safe) return { data: null, error: safety.reason ?? 'Message blocked by safety policy.' };

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ thread_id: threadId, sender_id: senderId, body })
      .select('id, thread_id, body, sender_id, created_at')
      .single();

    this.handleAuthFailure('sendMessage', error?.message ?? '');
    return { data: (data as ChatMessage) ?? null, error: error?.message ?? null };
  }

  async getProfileNames(userIds: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return {};

    const { data } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', unique);

    const result: Record<string, string> = {};
    for (const row of data ?? []) {
      const item = row as { id: string; display_name?: string | null };
      result[item.id] = item.display_name || 'User';
    }

    return result;
  }

  subscribeToThread(threadId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`thread:${threadId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${threadId}` }, callback)
      .subscribe();
  }

  private handleAuthFailure(operation: string, message: string): void {
    if (!message) return;
    this.authService.reportAuthFailure(`chat.${operation}`, message);
  }
}
