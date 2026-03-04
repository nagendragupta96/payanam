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

  async sendMessage(chatId: string, senderId: string, content: string): Promise<string | null> {
    const safety = this.isSafeMessage(content);
    if (!safety.safe) return safety.reason ?? 'Message blocked by safety policy.';

    const { error } = await supabase.from('messages').insert({
      chat_id: chatId,
      sender_id: senderId,
      content
    });

    return error?.message ?? null;
  }

  subscribeToChat(chatId: string, callback: (payload: unknown) => void) {
    return supabase
      .channel(`chat:${chatId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, callback)
      .subscribe();
  }
}
