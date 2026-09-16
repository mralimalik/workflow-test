import { create } from 'zustand'
import { createId } from '@/shared/lib/id'
import type { ChatMessage } from './types'

interface ChatState {
  messages: ChatMessage[]
  /** For UI-originated messages (composer input, system notices) — generates id/createdAt. */
  addMessage: (message: Omit<ChatMessage, 'id' | 'createdAt'>) => ChatMessage
  /** For fully-formed messages coming out of the execution engine. */
  pushMessage: (message: ChatMessage) => void
  clear: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],

  addMessage: (message) => {
    const full: ChatMessage = {
      ...message,
      id: createId('msg'),
      createdAt: new Date().toISOString(),
    }
    set((state) => ({ messages: [...state.messages, full] }))
    return full
  },

  pushMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),

  clear: () => set({ messages: [] }),
}))
