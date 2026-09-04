/**
 * VROZEK AI — Telegram Bot API client (raw fetch, serverless friendly).
 */

const TG_API = 'https://api.telegram.org';

export interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
}

export interface TgChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
  reply_to_message?: TgMessage;
  entities?: { type: string; offset: number; length: number }[];
  photo?: unknown[];
  sticker?: { file_id: string; emoji?: string; set_name?: string };
  document?: { mime_type?: string };
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function displayName(u?: TgUser): string {
  if (!u) return '';
  if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`;
  return u.first_name || u.username || `User ${u.id}`;
}

export class TgClient {
  constructor(
    private token: string,
    private log: (msg: string) => void = () => {}
  ) {}

  private url(method: string): string {
    return `${TG_API}/bot${this.token}/${method}`;
  }

  async call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(this.url(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data: any = await res.json().catch(() => null);
    if (!data || !data.ok) {
      this.log(`tg:${method} failed: ${JSON.stringify(data)}`);
      return null;
    }
    return data.result;
  }

  sendMessage(chatId: number | string, text: string, extra: Record<string, unknown> = {}): Promise<any> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  }

  sendSticker(chatId: number | string, sticker: string, extra: Record<string, unknown> = {}): Promise<any> {
    return this.call('sendSticker', { chat_id: chatId, sticker, ...extra });
  }

  editMessageText(chatId: number | string, messageId: number, text: string, extra: Record<string, unknown> = {}): Promise<any> {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  }

  answerCallback(cbId: string, text?: string, extra: Record<string, unknown> = {}): Promise<any> {
    return this.call('answerCallbackQuery', {
      callback_query_id: cbId,
      ...(text ? { text: text.slice(0, 200) } : {}),
      ...extra,
    });
  }

  deleteMessage(chatId: number | string, messageId: number): Promise<any> {
    return this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  restrictChatMember(chatId: number | string, userId: number, seconds = 3600): Promise<any> {
    const until = seconds ? Math.floor(Date.now() / 1000) + seconds : Math.floor(Date.now() / 1000) + 3660 * 24 * 30;
    return this.call('restrictChatMember', {
      chat_id: chatId,
      user_id: userId,
      until_date: until,
      permissions: {
        can_send_messages: false,
        can_send_media_messages: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
      },
    });
  }

  unrestrictChatMember(chatId: number | string, userId: number): Promise<any> {
    return this.call('restrictChatMember', {
      chat_id: chatId,
      user_id: userId,
      permissions: {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_send_polls: true,
        can_send_inline: true,
      },
    });
  }

  getMe(): Promise<any> {
    return this.call('getMe');
  }

  setWebhook(url: string, secret?: string): Promise<any> {
    return this.call('setWebhook', {
      url,
      allowed_updates: ['message', 'callback_query'],
      ...(secret ? { secret_token: secret } : {}),
    });
  }

  setCommands(commands: { command: string; description: string }[], scope?: Record<string, unknown>): Promise<any> {
    return this.call('setMyCommands', { commands, ...(scope ? { scope } : {}) });
  }
}
