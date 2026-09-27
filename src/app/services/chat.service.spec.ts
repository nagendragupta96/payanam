import { AuthService } from './auth.service';
import { ChatService } from './chat.service';
import { supabase } from './supabase-client';

describe('Chat phone sharing', () => {
  const service = new ChatService({} as AuthService);

  for (const text of ['Call +1 202 555 0123', '(202) 555-0123', '+44 7700 900123', '2025550123']) {
    it('allows ' + text, () => expect(service.isSafeMessage(text).safe).toBeTrue());
  }

  it('keeps unrelated message restrictions', () => {
    expect(service.isSafeMessage('person@example.com').safe).toBeFalse();
    expect(service.isSafeMessage('Send via PayPal').safe).toBeFalse();
  });

  it('persists the original phone message', async () => {
    const body = 'Call me on +1 (202) 555-0123';
    const record = { id: 'message', thread_id: 'thread', sender_id: 'sender', body };
    const query: { insert: jasmine.Spy; select: jasmine.Spy; single: jasmine.Spy } = {
      insert: jasmine.createSpy('insert').and.callFake(() => query),
      select: jasmine.createSpy('select').and.callFake(() => query),
      single: jasmine.createSpy('single').and.resolveTo({ data: record, error: null })
    };
    spyOn(supabase, 'from').and.returnValue(query as any);
    const result = await service.sendMessage('thread', 'sender', body);
    expect(query.insert).toHaveBeenCalledWith({ thread_id: 'thread', sender_id: 'sender', body });
    expect(result.data?.body).toBe(body);
    expect(result.error).toBeNull();
  });
});
