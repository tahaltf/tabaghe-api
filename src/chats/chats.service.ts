import { Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid'; // npm install uuid و @types/uuid نیاز است
// اگر uuid ندارید، فعلا از Math.random استفاده کنید

@Injectable()
export class ChatsService {
  // دیتابیس موقت در حافظه رم
  private chats = [];
  private messages = [];

  initiateChat(userId: string, listingId: string) {
    // چک کن قبلا چت بوده؟
    let chat = this.chats.find(
      (c) =>
        c.listingId === listingId &&
        (c.buyerId === userId || c.sellerId === userId),
    );

    if (!chat) {
      chat = {
        id: uuidv4(), // یا Date.now().toString()
        listingId,
        buyerId: userId,
        sellerId: 'seller-id-fixed', // فرض میکنیم فروشنده ثابت است
        createdAt: new Date(),
      };
      this.chats.push(chat);

      // یک پیام خوش‌آمدگویی پیش‌فرض
      this.messages.push({
        id: uuidv4(),
        chatId: chat.id,
        senderId: 'seller-id-fixed',
        text: 'سلام! چطور میتونم کمکتون کنم؟',
        createdAt: new Date().toISOString(),
      });
    }

    // برگرداندن فرمت مورد انتظار فرانت‌اند (ChatSession)
    return {
      ...chat,
      messages: this.messages.filter((m) => m.chatId === chat.id),
    };
  }

  getMessages(chatId: string) {
    return this.messages.filter((m) => m.chatId === chatId);
  }

  sendMessage(chatId: string, senderId: string, text: string) {
    const chat = this.chats.find((c) => c.id === chatId);
    if (!chat) throw new NotFoundException('Chat not found');

    const newMessage = {
      id: uuidv4(), // یا Date.now().toString()
      chatId,
      senderId,
      text,
      createdAt: new Date().toISOString(),
    };

    this.messages.push(newMessage);
    return newMessage;
  }
}
