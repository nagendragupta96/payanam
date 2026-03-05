import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';

@Injectable({ providedIn: 'root' })
export class ChatService {
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

  async getThreadByRequest(requestId: string): Promise<{ data: any | null; error: string | null }> {
    const { data, error } = await supabase
      .from('chat_threads')
      .select('*')
      .eq('request_id', requestId)
      .maybeSingle();

    return { data, error: error?.message ?? null };
  }

  async listMessages(threadId: string): Promise<{ data: { id: string; body: string; sender_id: string }[]; error: string | null }> {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, body, sender_id, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });

    return { data: (data as any[]) ?? [], error: error?.message ?? null };
  }

  async sendMessage(threadId: string, senderId: string, body: string): Promise<string | null> {
    const safety = this.isSafeMessage(body);
    if (!safety.safe) return safety.reason ?? 'Message blocked by safety policy.';

    const { error } = await supabase.from('chat_messages').insert({
      thread_id: threadId,
      sender_id: senderId,
      body
    });

    return error?.message ?? null;
  }

  subscribeToThread(threadId: string, callback: (payload: any) => void) {
    return supabase
      .channel(`thread:${threadId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${threadId}` }, callback)
      .subscribe();
  }
}
